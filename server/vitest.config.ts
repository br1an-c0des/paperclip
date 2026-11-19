import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const serverRoot = path.dirname(fileURLToPath(import.meta.url));
const include = ["src/**/*.test.ts", "scripts/**/*.test.mjs"];

// The server's test files run in two projects (see fork/test-suite-audit/results-overhead.md):
//
// - `shared` (`isolate: false`): one worker process runs many files one after another, so the
//   server's module graph (~4 s to evaluate) loads once per worker instead of once per file.
// - `isolated` (`isolate: true`): a fresh process per file, as before.
//
// A file goes to `isolated` when it replaces modules. A module mocked in one file stays mocked,
// through every module that imported it, for the files that run after it in the same worker, and
// a file's own mock doesn't reach modules an earlier file already loaded. These calls mark it:
const MODULE_REPLACEMENT =
  /\bvi\s*\.\s*(?:mock|doMock|unmock|doUnmock|resetModules|importActual|importMock|hoisted)\s*\(/;

// Files without those calls that still fail, or make later files fail, when they share a worker
// with other files. Paths are relative to server/. The setup file already puts back environment
// variables, stubbed globals, fake timers and the working directory between files
// (src/__tests__/helpers/shared-worker-state.ts); these leak, or depend on, module state it
// can't reset. Details in fork/test-suite-audit/results-leaks.md.
const ISOLATED_BY_NAME = new Set<string>([
  // Leave idle-tracked work pending (`beginIdleTrackedWork` in services/task-admission.ts, a
  // module-level counter), so later files that wait for `idleWorkSnapshot().active === 0` fail.
  "src/__tests__/plugin-idle-manager.test.ts",
  "src/__tests__/plugin-loader-activation-timeout.test.ts",
  "src/__tests__/plugin-worker-manager-daytona-close.test.ts",
  "src/__tests__/plugin-worker-manager-duplex.test.ts",
  "src/realtime/live-event-delivery.test.ts",
  "src/services/native-runtime/native-execution-context-worker.test.ts",
  // Point a log store at their own directory or bucket through the environment, but the store is
  // cached on first use for the whole process (`getWorkspaceOperationLogStore` in
  // services/workspace-operation-log-store.ts, `getRunLogStore` in services/run-log-store.ts), so
  // an earlier file's store wins.
  "src/__tests__/ephemeral-migration.test.ts",
  "src/__tests__/issue-recovery-actions.test.ts",
  "src/__tests__/native-result-commit-work.test.ts",
  "src/__tests__/native-status-reassessment-work.test.ts",
  "src/__tests__/native-workspace-finalization-work.test.ts",
  "src/__tests__/workspace-operations-reconciliation.test.ts",
  "src/__tests__/workspace-runtime-control-recovery.test.ts",
  "src/services/native-log-archive.integration.test.ts",
  "src/services/native-runtime/native-workspace-finalization-supersession.test.ts",
  "src/services/native-runtime/native-workspace-finalizer.test.ts",
  "src/services/native-runtime/native-workspace-owner-restart-recovery.test.ts",
  "src/services/native-runtime/native-workspace-queued-wake-recovery.test.ts",
  "src/services/run-evidence-migration-work.integration.test.ts",
  "src/services/run-evidence-migration.integration.test.ts",
  // Read the idle-sleep local-work report (services/idle-local-work.ts), which keeps module-level
  // state for the process: spool directories registered by earlier files (gone by now, so
  // "unknown"), the startup, ingress and scheduled-backup flags, and the tracked-work counter.
  "src/__tests__/delivery-work-coordinator.test.ts",
  "src/__tests__/environment-cleanup-work.test.ts",
  "src/__tests__/heartbeat-agent-status-recovery.test.ts",
  "src/__tests__/historical-cleanup-verification.test.ts",
  "src/__tests__/idle-completed-history.test.ts",
  "src/__tests__/idle-connection-history.test.ts",
  "src/__tests__/idle-domain-deadlines-postgres.test.ts",
  "src/__tests__/idle-incoming-wake.test.ts",
  "src/__tests__/idle-issue-schedule.test.ts",
  "src/__tests__/idle-local-work.test.ts",
  "src/__tests__/idle-native-finalization.test.ts",
  "src/__tests__/idle-response-waits.test.ts",
  "src/__tests__/idle-sleep-diagnostics-postgres.test.ts",
  "src/__tests__/idle-sleep-diagnostics.test.ts",
  "src/__tests__/idle-sleep-preparation.test.ts",
  "src/__tests__/idle-sleep-safety.test.ts",
  "src/__tests__/plugin-lifecycle-delivery.test.ts",
  "src/__tests__/recovery-deadline-acceptance.test.ts",
  "src/__tests__/sandbox-creation-operations.test.ts",
  "src/__tests__/satisfied-connection-intents.test.ts",
  "src/__tests__/slack-enabled-quiet.postgres.test.ts",
  "src/middleware/cloud-tenant-actor.test.ts",
  "src/services/skill-source-sync-work.test.ts",
  // The issue-recovery fixture (src/__tests__/issue-recovery.test-fixture.ts) family: after
  // issue-recovery-assignments in the same worker, two issue-recovery-deadlines tests time out
  // (each passes alone); module state in the recovery workers it starts, not yet pinned down.
  // These files are minutes long each, so isolation costs them little.
  "src/__tests__/assigned-work-recheck-idle.test.ts",
  "src/__tests__/continuation-delivery-unwakeable-agent-idle.test.ts",
  "src/__tests__/issue-recovery-assignments.test.ts",
  "src/__tests__/issue-recovery-conversations.test.ts",
  "src/__tests__/issue-recovery-deadlines.test.ts",
  "src/__tests__/issue-recovery-dependencies.test.ts",
  "src/__tests__/issue-recovery-pass-reads.test.ts",
  "src/__tests__/issue-recovery-recorded-decision-idle.test.ts",
  "src/__tests__/issue-recovery-review-wait-pass.test.ts",
  "src/__tests__/issue-recovery-saved-deferrals.test.ts",
  "src/__tests__/issue-recovery-signal-fanout.test.ts",
  "src/__tests__/issue-recovery-terminal-run-settling.test.ts",
  "src/__tests__/issue-recovery-work-debug-attribution.test.ts",
  "src/__tests__/native-failed-run-owner-release-idle.test.ts",
  "src/__tests__/resolved-dependency-candidates.test.ts",
  // Depends on module evaluation order: when an earlier file in the worker loaded
  // modules/run-dispatch/index.ts first, services/execution-recovery-attempt.ts is evaluated in
  // the middle of that import cycle and its UNCHARGED_RETRY_LANES gets `undefined` instead of
  // AGENT_DIRECTORY_BUSY_RETRY_REASON. A source bug, reported in results-leaks.md.
  "src/services/execution-recovery-attempt.test.ts",
  // Failed once each in a shared full run and pass alone; module-level state not pinned down
  // (provider-pack-layers.ts caches verified archives for the process; upgrade readiness reads
  // process-wide controller and run-admission state).
  "src/services/heartbeat/upgrade-readiness.test.ts",
  "src/services/native-runtime/provider-pack-archive.test.ts",
  // Classifies a deliberate stall by the process's CPU time (`process.cpuUsage()`, every thread);
  // work an earlier file left running in the worker counts as main-thread CPU (failed once in
  // `full4`: 'main_thread_cpu' instead of 'blocked_off_cpu').
  "src/event-loop-stall-monitor.test.ts",
  // Import packages/paperclip-runner/src/drivers/codex/codex-app-server-driver.test-support.ts,
  // which makes its WORKSPACE directory when first loaded and removes it in a module-level
  // afterAll, so in a shared worker the second importer finds it gone.
  "src/__tests__/native-procedure-measurement.test.ts",
  "src/__tests__/runner-api-recovery.test.ts",
]);

function serverTestFiles() {
  return fs
    .globSync(include, { cwd: serverRoot, exclude: (name) => path.basename(name) === "node_modules" })
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}

const allServerTestFiles = serverTestFiles();
for (const name of ISOLATED_BY_NAME) {
  if (!allServerTestFiles.includes(name)) throw new Error(`ISOLATED_BY_NAME names a missing test file: ${name}`);
}

export const isolatedTestFiles = allServerTestFiles.filter(
  (file) =>
    ISOLATED_BY_NAME.has(file) ||
    MODULE_REPLACEMENT.test(fs.readFileSync(path.join(serverRoot, file), "utf8")),
);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@paperclipai\/paperclip-runner\/live$/,
        replacement: fileURLToPath(
          new URL("../packages/paperclip-runner/src/live/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@paperclipai\/paperclip-runner$/,
        replacement: fileURLToPath(
          new URL("../packages/paperclip-runner/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: "node",
    // Each server suite boots + tears down its own embedded Postgres in
    // beforeAll/afterAll. Under the loaded serial shard (maxWorkers=1) the
    // graceful shutdown can occasionally cross vitest's default 10s hookTimeout,
    // producing flaky "Hook timed out in 10000ms" afterAll failures on CI. Give
    // the boot/teardown hooks generous headroom; 30s is far above the observed
    // worst-case teardown yet still catches a genuinely hung hook. teardownTimeout
    // mirrors it for the same reason.
    hookTimeout: 30000,
    teardownTimeout: 30000,
    // The route/authz suites import very large modules (for example
    // src/routes/issues.ts and its dependency graph). The first test in each
    // file pays the one-time transform cost inside its own timeout budget. On
    // the loaded serial shard (maxWorkers=1) that cost can cross vitest's
    // default 5s testTimeout and fail the first test, which also lets its
    // fire-and-forget wake leak into the next test. Give each test generous
    // headroom; 15s is far above the observed module-load cost yet still
    // catches a genuinely hung test well inside the 20 minute job limit.
    testTimeout: 15000,
    // Persist transformed modules across runs (node_modules/.vitest-cache at the workspace root).
    // Keys hash each module's source and the config, so an edited file is re-transformed.
    fsModuleCache: true,
    maxConcurrency: 1,
    maxWorkers: 1,
    pool: "forks",
    // Server suites share process state and one embedded Postgres instance,
    // so tests inside a file must run one at a time. Do not set
    // sequence.concurrent to true.
    sequence: {
      concurrent: false,
      hooks: "list",
    },
    setupFiles: ["./src/__tests__/setup-supertest.ts"],
    // Run from the repo root these are `@paperclipai/server (shared)` and
    // `@paperclipai/server (isolated)`; `--project @paperclipai/server` selects both.
    projects: [
      {
        extends: true,
        test: {
          name: "shared",
          include,
          exclude: [...configDefaults.exclude, ...isolatedTestFiles],
          // Files share a worker's loaded modules. What one file leaves in the process (env,
          // stubbed globals, fake timers, cwd) is put back by the setup file before the next one
          // (src/__tests__/helpers/shared-worker-state.ts); files that leak or depend on module
          // state go in ISOLATED_BY_NAME. Step 3a round 2: fork/test-suite-audit/results-leaks.md.
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: "isolated",
          include: isolatedTestFiles,
          isolate: true,
        },
      },
    ],
  },
});
