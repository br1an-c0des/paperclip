import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns } from "@paperclipai/db";
import type { RunDisposition } from "@paperclipai/shared";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { readRunDisposition, recordRunDisposition } from "./run-disposition.js";

const support = await getEmbeddedPostgresTestSupport();

const finished: RunDisposition = {
  kind: "finished",
  at: "2026-11-17T10:00:00.000Z",
  via: "tool",
  tool: "paperclip_finish",
  taskStatus: "done",
  summary: "Shipped it",
};
const blocked: RunDisposition = {
  kind: "blocked",
  at: "2026-11-17T09:00:00.000Z",
  via: "tool",
  tool: "paperclip_block",
  taskStatus: "blocked",
  blockedOwner: "board",
  unblockAction: "Approve the budget",
};

describe.skipIf(!support.supported)("run disposition", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-run-disposition-");
    db = createDb(tempDb.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await tempDb?.cleanup();
  });

  async function insertRun(resultJson: Record<string, unknown> | null) {
    const [company] = await db.insert(companies).values({ name: "Runs", issuePrefix: `R${Math.random().toString(36).slice(2, 7).toUpperCase()}` }).returning();
    const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Worker" }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, status: "running", resultJson }).returning();
    return run;
  }
  const loadRun = async (runId: string) => (await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0];

  it("records a disposition without dropping other result_json keys", async () => {
    const run = await insertRun({ summary: "adapter summary", stopReason: "end_turn" });
    await recordRunDisposition(db, run.id, finished);
    const stored = await loadRun(run.id);
    expect(stored.resultJson).toEqual({ summary: "adapter summary", stopReason: "end_turn", paperclipDisposition: finished });
    expect(readRunDisposition(stored)).toEqual(finished);

    const empty = await insertRun(null);
    await recordRunDisposition(db, empty.id, finished);
    expect((await loadRun(empty.id)).resultJson).toEqual({ paperclipDisposition: finished });
  });

  it("keeps the first disposition", async () => {
    const run = await insertRun({ summary: "adapter summary" });
    await recordRunDisposition(db, run.id, blocked);
    await recordRunDisposition(db, run.id, finished);
    const stored = await loadRun(run.id);
    expect(stored.resultJson).toEqual({ summary: "adapter summary", paperclipDisposition: blocked });
    expect(readRunDisposition(stored)).toEqual(blocked);
  });

  it("reads null when none was recorded", async () => {
    expect(readRunDisposition({ resultJson: null })).toBeNull();
    expect(readRunDisposition({ resultJson: { summary: "adapter summary" } })).toBeNull();
    expect(readRunDisposition({ resultJson: { paperclipDisposition: { kind: "nonsense" } } })).toBeNull();
    expect(readRunDisposition(await insertRun({ summary: "adapter summary" }))).toBeNull();
  });
});
