import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

// Per-worker test state for the server's setup file (setup-supertest.ts).
//
// In the `shared` Vitest project (`isolate: false`) one worker process runs many test files one
// after another, and the setup file runs again before each of them. Vitest itself restores spies
// (`vi.restoreAllMocks()`) between files, but nothing else: an environment variable, a stubbed
// global, fake timers or a changed working directory left by one file would reach the next. The
// first time the setup file runs in a worker this records a baseline; each later time it puts the
// process back to it before the next file starts. See fork/test-suite-audit/results-leaks.md.
//
// The worker's registry lives on globalThis, which survives the setup file being re-evaluated.
//
// Finding leaks: PAPERCLIP_TEST_LEAK_REPORT=<file> appends one JSON line per test file that left
// something behind (`file` is the file that leaked it); PAPERCLIP_TEST_NO_RESET=1 as well reports
// without restoring, to reproduce a leak.

export type Registry = {
  baselineEnvObject: NodeJS.ProcessEnv;
  baselineEnv: Record<string, string | undefined>;
  baselineCwd: string;
  baselineGlobals: Map<PropertyKey, PropertyDescriptor>;
  /** Directories made for this worker (test homes, the Codex home), removed when it stops. */
  cleanups: Array<() => void>;
  codexHome?: string;
  previousFile?: string;
  filesRun: number;
  reportedGlobals: Set<PropertyKey>;
};

type Leak = { kind: string; detail: string };

const REGISTRY = Symbol.for("paperclip.test.sharedWorkerState");

// Globals Vitest owns or replaces itself between files.
function isVitestGlobal(key: PropertyKey) {
  return typeof key === "string" && (key.startsWith("__vitest") || key.startsWith("__VITEST"));
}

function sameDescriptor(a: PropertyDescriptor, b: PropertyDescriptor) {
  return Object.is(a.value, b.value) && a.get === b.get && a.set === b.set;
}

type WorkerState = { filepath?: string; onCleanup?: (listener: () => unknown) => void };
function vitestWorkerState(): WorkerState | undefined {
  return (globalThis as { __vitest_worker__?: WorkerState }).__vitest_worker__;
}

function runCleanups(registry: Registry) {
  const cleanups = registry.cleanups.splice(0);
  let firstError: unknown;
  for (const cleanup of cleanups) {
    try { cleanup(); }
    catch (error) { firstError ??= error; }
  }
  if (firstError) throw firstError;
}

function createRegistry(): Registry {
  const registry: Registry = {
    baselineEnvObject: process.env,
    baselineEnv: { ...process.env },
    baselineCwd: process.cwd(),
    baselineGlobals: new Map(
      Reflect.ownKeys(globalThis)
        .filter((key) => !isVitestGlobal(key))
        .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)!]),
    ),
    cleanups: [],
    filesRun: 0,
    reportedGlobals: new Set(),
  };
  // Vitest stops a fork worker with SIGTERM, which never reaches Node's `exit` event, so the
  // directories are removed from Vitest's own worker teardown (run on its "stop" message, after
  // every file's hooks). The `exit` listener covers a worker that ends some other way.
  vitestWorkerState()?.onCleanup?.(() => runCleanups(registry));
  process.once("exit", () => runCleanups(registry));
  return registry;
}

function envDiff(baseline: Record<string, string | undefined>, kind: string, leaks: Leak[]) {
  const changed: string[] = [];
  for (const key of new Set([...Object.keys(process.env), ...Object.keys(baseline)])) {
    if (process.env[key] !== baseline[key]) changed.push(key);
  }
  for (const key of changed) if (!key.startsWith("VITEST")) leaks.push({ kind, detail: key });
  return changed;
}

function restoreEnv(registry: Registry, leaks: Leak[], apply: boolean) {
  // Some files save `{ ...process.env }` and assign it back (`process.env = saved`). The copy is
  // a plain object, and Vitest's `vi.stubEnv` deletes from the original one (its env proxy has no
  // delete trap), so after that a stub set to `undefined`, or undone, stays in the copy for every
  // later file. Put the real object back first.
  if (process.env !== registry.baselineEnvObject) {
    leaks.push({ kind: "env-object", detail: "process.env was replaced" });
    if (apply) process.env = registry.baselineEnvObject;
  }
  // A file's own `vi.stubEnv` calls are undone next, so their saved originals don't come back
  // later in another file's `vi.unstubAllEnvs()`.
  const before = { ...process.env };
  if (apply) vi.unstubAllEnvs();
  for (const key of new Set([...Object.keys(before), ...Object.keys(process.env)])) {
    if (before[key] !== process.env[key]) leaks.push({ kind: "env-stub", detail: key });
  }
  const baseline = registry.baselineEnv;
  // Vitest sets VITEST_WORKER_ID (and friends) for each file before the setup file runs.
  const changed = envDiff(baseline, "env", leaks).filter((key) => !key.startsWith("VITEST"));
  if (!apply) return;
  for (const key of changed) {
    if (baseline[key] === undefined) delete process.env[key];
    else process.env[key] = baseline[key];
  }
}

function restoreGlobals(registry: Registry, leaks: Leak[], apply: boolean) {
  if (apply) vi.unstubAllGlobals();
  for (const [key, descriptor] of registry.baselineGlobals) {
    const current = Object.getOwnPropertyDescriptor(globalThis, key);
    if (current && sameDescriptor(current, descriptor)) continue;
    leaks.push({ kind: current ? "global-changed" : "global-removed", detail: String(key) });
    if (!apply) continue;
    try { Object.defineProperty(globalThis, key, descriptor); }
    catch { /* a non-configurable global that was replaced in place; nothing more to do */ }
  }
  // Globals added since the baseline are left alone (libraries register theirs once per process,
  // as zod and undici do); report mode names each one once, after the file that added it.
  if (registry.baselineEnv.PAPERCLIP_TEST_LEAK_REPORT) {
    for (const key of Reflect.ownKeys(globalThis)) {
      if (isVitestGlobal(key) || key === REGISTRY || registry.baselineGlobals.has(key)) continue;
      if (registry.reportedGlobals.has(key)) continue;
      registry.reportedGlobals.add(key);
      leaks.push({ kind: "global-added", detail: String(key) });
    }
  }
}

/**
 * Called at the top of the setup file, before it sets this file's environment. Returns the
 * worker's registry, so the setup file can register directories for removal.
 */
export function resetSharedWorkerState(): Registry {
  const holder = globalThis as { [REGISTRY]?: Registry };
  const currentFile = vitestWorkerState()?.filepath;
  let registry = holder[REGISTRY];
  if (!registry) {
    registry = createRegistry();
    holder[REGISTRY] = registry;
  } else {
    const apply = !registry.baselineEnv.PAPERCLIP_TEST_NO_RESET;
    const leaks: Leak[] = [];
    if (vi.isFakeTimers()) {
      leaks.push({ kind: "fake-timers", detail: "still installed" });
      if (apply) vi.useRealTimers();
    }
    restoreEnv(registry, leaks, apply);
    restoreGlobals(registry, leaks, apply);
    if (process.cwd() !== registry.baselineCwd) {
      leaks.push({ kind: "cwd", detail: process.cwd() });
      if (apply) {
        try { process.chdir(registry.baselineCwd); }
        catch { /* the baseline directory is gone; leave the cwd */ }
      }
    }
    reportLeaks(registry, leaks, currentFile);
  }
  registry.previousFile = currentFile;
  registry.filesRun += 1;
  return registry;
}

// Set again for every file by the setup file itself, so not leaks.
const PER_FILE_ENV = new Set([
  "PAPERCLIP_HOME", "PAPERCLIP_CONFIG", "PAPERCLIP_INSTANCE_ID", "CODEX_HOME",
  "PAPERCLIP_MANAGED_RUNTIME_HTTPS", "PAPERCLIP_TEST_HOST_HOME",
]);

function reportLeaks(registry: Registry, leaks: Leak[], currentFile: string | undefined) {
  const reportFile = registry.baselineEnv.PAPERCLIP_TEST_LEAK_REPORT;
  if (!reportFile) return;
  const meaningful = leaks.filter((leak) => !(leak.kind.startsWith("env") && PER_FILE_ENV.has(leak.detail)));
  const resources: Record<string, number> = {};
  for (const name of process.getActiveResourcesInfo()) resources[name] = (resources[name] ?? 0) + 1;
  fs.appendFileSync(reportFile, `${JSON.stringify({
    pid: process.pid,
    index: registry.filesRun,
    file: registry.previousFile,
    next: currentFile,
    leaks: meaningful,
    resources,
  })}\n`);
}

// Server modules whose process-wide state an earlier file can leave behind, each with the reset
// its module exports for tests. Only modules this worker has already loaded are reset: one that
// isn't loaded yet starts fresh anyway, and loading it here would cost the file its import time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Resettable = Record<string, any>;
const MODULE_RESETS: Array<[file: string, load: () => Promise<Resettable>, reset: (module: Resettable) => unknown]> = [
  // Run admission closed by a graceful-shutdown test: no later run would start.
  ["../../services/heartbeat/run-admission.ts", () => import("../../services/heartbeat/run-admission.js"),
    (m) => { m.resetProcessRunAdmissionForTests(); m.resetReattachPhaseForTests(); }],
  // The registered controller-instance database (closed with the earlier file's cluster), its
  // lease, and the lease quiesce flag in task-admission.
  ["../../services/controller-instance-lease.ts", () => import("../../services/controller-instance-lease.js"),
    (m) => m.resetControllerInstanceLeaseForTests()],
  // This process's start time, read once from `ps -o lstart` and cached. On WSL a later reading
  // can come out one second off, and the owner proof then calls this live process "pid_reused";
  // a fresh read per file keeps the cached and observed readings close together, as in isolation.
  ["../../services/controller-process-identity.ts", () => import("../../services/controller-process-identity.js"),
    (m) => m.resetCurrentProcessStartedAtForTests()],
  ["../../services/task-admission.ts", () => import("../../services/task-admission.js"),
    (m) => { if (m.readTaskDrain(new Date())) m.stopTaskDrain(); }],
  ["../../startup-recovery-state.ts", () => import("../../startup-recovery-state.js"),
    (m) => m.resetStartupRecoveryStateForTests()],
  ["../../services/cloud-runtime-config-snapshot.ts", () => import("../../services/cloud-runtime-config-snapshot.js"),
    (m) => m.setCloudRuntimeConfigSnapshot(null)],
  ["../../services/cloud-runtime-identity.ts", () => import("../../services/cloud-runtime-identity.js"),
    (m) => { m.resetCloudRuntimeIdentityForTests(); m.resetCloudControlReplayFenceForTests(); }],
  ["../../services/workspace-operations.ts", () => import("../../services/workspace-operations.js"),
    (m) => { m.resetWorkspaceRuntimeControlStateForTests(); m.resetWorkspaceRuntimeControlLocksForTests(); }],
  ["../../services/workspace-runtime.ts", () => import("../../services/workspace-runtime.js"),
    async (m) => { await m.resetRuntimeServicesForTests(); m.resetRuntimeServicePortReservationsForTests(); }],
  ["../../services/workspace-readiness.ts", () => import("../../services/workspace-readiness.js"),
    (m) => m.resetManagedWorkspaceInstanceCacheForTests()],
  ["../../services/fresh-continuation-fallback.ts", () => import("../../services/fresh-continuation-fallback.js"),
    (m) => m.resetBacklogContinuationPacingForTests()],
  ["../../services/native-runtime/native-finalization-reconciler.ts",
    () => import("../../services/native-runtime/native-finalization-reconciler.js"),
    (m) => m.resetSettledCommittedUpkeepForTests()],
  ["../../services/native-runtime/native-failed-run-owner-release.ts",
    () => import("../../services/native-runtime/native-failed-run-owner-release.js"),
    (m) => m.resetAbandonedNativeOwnerReleaseForTests()],
  ["../../telemetry.ts", () => import("../../telemetry.js"), (m) => m.resetTelemetryForTests()],
  ["../../server-info.ts", () => import("../../server-info.js"), (m) => m.resetServerInfoCacheForTests()],
  ["../../adapters/cursor-models.ts", () => import("../../adapters/cursor-models.js"),
    (m) => m.resetCursorModelsCacheForTests()],
  ["../../adapters/codex-models.ts", () => import("../../adapters/codex-models.js"),
    (m) => m.resetCodexModelsCacheForTests()],
];

type EvaluatedModules = { getModulesByFile?: (file: string) => Set<unknown> | undefined };

/** Whether this worker has evaluated the server module at `file` (relative to this helper). */
function loaded(file: string) {
  const modules = (vitestWorkerState() as { evaluatedModules?: EvaluatedModules } | undefined)?.evaluatedModules;
  if (!modules?.getModulesByFile) return true;
  return Boolean(modules.getModulesByFile(fileURLToPath(new URL(file, import.meta.url)))?.size);
}

/**
 * Before every file but a worker's first: reset the module state in MODULE_RESETS. Awaited by the
 * setup file.
 */
export async function resetModuleSingletons(registry: Registry) {
  if (registry.filesRun <= 1 || registry.baselineEnv.PAPERCLIP_TEST_NO_RESET) return;
  const done: string[] = [];
  await Promise.all(MODULE_RESETS.map(async ([file, load, reset]) => {
    if (!loaded(file)) return;
    await reset(await load());
    done.push(file);
  }));
  const reportFile = registry.baselineEnv.PAPERCLIP_TEST_LEAK_REPORT;
  if (reportFile) fs.appendFileSync(reportFile, `${JSON.stringify({ pid: process.pid, resets: done.sort() })}\n`);
}

/**
 * Report mode only: module state that earlier files in this worker may have left set. Awaited at
 * the end of the setup file, so it runs before every file, also one whose tests are all skipped.
 * It reads only modules already loaded: loading one here, before the test file's `vi.hoisted`
 * and `vi.mock` calls, would change what that file sees.
 */
export async function probeModuleSingletons() {
  const reportFile = process.env.PAPERCLIP_TEST_LEAK_REPORT;
  if (!reportFile) return;
  if (!loaded("../../services/task-admission.ts") || !loaded("../../services/cloud-runtime-config-snapshot.ts")) {
    fs.appendFileSync(reportFile, `${JSON.stringify({ pid: process.pid, probe: vitestWorkerState()?.filepath, notLoaded: true })}\n`);
    return;
  }
  const admission = await import("../../services/task-admission.js");
  const cloud = await import("../../services/cloud-runtime-config-snapshot.js");
  let cloudSnapshot = false;
  try { cloud.getCloudRuntimeConfigSnapshot(); cloudSnapshot = true; }
  catch { /* not initialized, as expected */ }
  const idle = admission.idleWorkSnapshot();
  const drain = admission.readTaskDrain(new Date());
  // Background heartbeat runs and wakes an earlier file left in flight (module-level sets in
  // services/heartbeat.ts). Left running past their file's database, they stall the next
  // file's `drainActiveRunExecutions()` until they give up (bug 62).
  let heartbeatWork: unknown = "not-loaded";
  if (loaded("../../services/heartbeat.ts")) {
    const heartbeat = await import("../../services/heartbeat.js");
    const status = heartbeat.getTaskDrainStatus();
    heartbeatWork = { activeRuns: status.activeRuns, pendingWakes: status.pendingWakes };
  }
  fs.appendFileSync(reportFile, `${JSON.stringify({
    pid: process.pid,
    probe: vitestWorkerState()?.filepath,
    idleActive: idle.active,
    drain: Boolean(drain),
    cloudSnapshot,
    heartbeatWork,
  })}\n`);
}
