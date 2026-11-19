// Runtime selection on the legacy path: a preparation failure stops before selection, and a legacy
// selection keeps only server-owned evidence. Native (Paperclip Runner) selection, sandboxes,
// connectors and managed providers are in runtime-selection.dormant.test.ts (opt-in tier); shared
// setup is in runtime-selection.fixture.ts.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, applyPendingMigrations, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, type Db } from "@paperclipai/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { resolveExternalTestDatabaseUrl } from "../../__tests__/helpers/external-test-database.js";
import { CHAT_CONTROL_RECOVERY_ADMISSION_KEY } from "../chat-control-recovery-stop.js";
import { buildNativeRuntimeContext } from "../native-runtime/runtime-context.js";
import { nativeRuntimeContextFixture } from "../native-runtime/runtime-context.test-fixture.js";
import { prepareNativeWorkspaceSync } from "../native-runtime/native-workspace-sync.js";
import { canonicalNativeRuntimeContextDigest } from "../../vendor/paperclip-runner/index.js";
import { prepareAndSelectHeartbeatRuntime, selectHeartbeatRuntime } from "./runtime-selection.js";
import { readRun, runCoordinators, runtimeSelectionFixture } from "./runtime-selection.fixture.js";

// Keep the real contract, session, and runtime-selection transactions. Replace only
// filesystem materialization and sandbox synchronization at their external boundaries.
vi.mock("../native-runtime/runtime-context.js", async (original) => ({
  ...await original<typeof import("../native-runtime/runtime-context.js")>(),
  buildNativeRuntimeContext: vi.fn(async () => nativeRuntimeContextFixture()),
}));
vi.mock("../native-runtime/native-workspace-sync.js", async (original) => ({
  ...await original<typeof import("../native-runtime/native-workspace-sync.js")>(),
  prepareNativeWorkspaceSync: vi.fn(async () => null),
}));

const externalDatabaseUrl = resolveExternalTestDatabaseUrl("PAPERCLIP_RUNTIME_SELECTION_TEST_DATABASE_URL");
const support = externalDatabaseUrl ? { supported: true } : await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("heartbeat runtime selection boundary", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  let instructionRoot: string;
  beforeAll(async () => {
    instructionRoot = await mkdtemp(join(tmpdir(), "paperclip-selection-instructions-"));
    await writeFile(join(instructionRoot, "AGENTS.md"), "Complete the assigned task.\n");
    if (externalDatabaseUrl) await applyPendingMigrations(externalDatabaseUrl);
    database = externalDatabaseUrl ? { connectionString: externalDatabaseUrl, cleanup: async () => {} }
      : await startEmbeddedPostgresTestDatabase("paperclip-runtime-selection");
    db = createDb(database.connectionString);
    await db.execute(sql`set client_min_messages = warning`);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); if (instructionRoot) await rm(instructionRoot, { recursive: true, force: true }); });
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(async () => {
    await db.execute(sql`truncate table companies restart identity cascade`);
    vi.clearAllMocks();
    vi.mocked(prepareNativeWorkspaceSync).mockResolvedValue(null);
    vi.mocked(buildNativeRuntimeContext).mockImplementation(async () => {
      const context = nativeRuntimeContextFixture();
      context.instructions.bundle.rootPath = instructionRoot;
      return { ...context, aggregateDigest: canonicalNativeRuntimeContextDigest(context) };
    });
  });

  const fixture = (adapterType?: string) => runtimeSelectionFixture(db, adapterType);
  const read = (id: string) => readRun(db, id);
  const coordinators = (id: string) => runCoordinators(db, id);

  it("preserves preparation failure and skips runtime selection", async () => {
    const { input, run } = await fixture();
    const initiating = new Error("Synthetic preparation failure");
    const phases: string[] = [];
    await expect(prepareAndSelectHeartbeatRuntime(db, input, {
      measure: async (phase, work) => { phases.push(phase); return work(); },
      prepareInstructions: async () => { throw initiating; },
    })).rejects.toBe(initiating);
    expect(phases).toEqual(["instructions"]);
    expect(await coordinators(run.id)).toEqual([]);
    expect(buildNativeRuntimeContext).not.toHaveBeenCalled();
  });

  it("preserves only server-owned admission and dispatch evidence when recording legacy selection", async () => {
    const { input, run } = await fixture("process");
    const admission = { version: 1, kind: "fixture" }, dispatch = { entered: true };
    await db.update(heartbeatRuns).set({ runnerProfileJson: { [CHAT_CONTROL_RECOVERY_ADMISSION_KEY]: admission, adapterDispatch: dispatch, unrelated: "drop" } }).where(eq(heartbeatRuns.id, run.id));
    input.trace = { providerTraceRequested: true, providerTraceCapture: { metadata: { id: "trace-id" } } };
    expect(await selectHeartbeatRuntime(db, input)).toMatchObject({ selected: true, nativeExecution: null, nativeWorkspaceSync: null });
    expect((await read(run.id)).runnerProfileJson).toEqual({ [CHAT_CONTROL_RECOVERY_ADMISSION_KEY]: admission, adapterDispatch: dispatch, providerTrace: { mode: "raw", traceId: "trace-id", maxBytes: 64 * 1024 * 1024 } });
    expect(await coordinators(run.id)).toHaveLength(0);
    expect(input.stopControllerLease).not.toHaveBeenCalled();
    expect(buildNativeRuntimeContext).not.toHaveBeenCalled();
  });
});
