import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRunEvents, heartbeatRuns, issues } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { activityService } from "../services/activity.ts";

// A task's run list marks the runs that compacted their context (bug 96), so the task thread reads
// those runs' compaction dividers even when no context reading counts them (`claude_local` runs
// record none).

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
if (!support.supported) console.warn(`Skipping issue runs compacted tests: ${support.reason}`);

describePostgres("a task's runs: compacted", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("issue-runs-compacted-");
    db = createDb(temporary.connectionString);
  }, 30_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  async function company() {
    const companyId = randomUUID(), agentId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Compacted fixture", issuePrefix: `C${companyId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Claude", adapterType: "claude_local", status: "idle" });
    return { companyId, agentId };
  }

  let seq = 0;
  async function event(input: { companyId: string; agentId: string; runId: string; eventType: string }) {
    await db.insert(heartbeatRunEvents).values({ ...input, seq: ++seq, stream: "system", level: "info", message: "event",
      payload: { prpEvent: { schema: "paperclip.prp.event.v1", schemaVersion: 1, eventType: input.eventType, sourceKind: "claude_local",
        payload: { schema: "paperclip.context.compacted.v1", compactionId: randomUUID() } } } });
  }

  it("is true for a run with a context.compacted event of its company, false otherwise", async () => {
    const { companyId, agentId } = await company();
    const other = await company();
    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, companyId, title: "Compact me", assigneeAgentId: agentId });
    const run = async () => {
      const id = randomUUID();
      await db.insert(heartbeatRuns).values({ id, companyId, agentId, issueId, scopeKind: "issue", status: "succeeded",
        finishedAt: new Date(), contextSnapshot: { issueId } });
      return id;
    };
    const compacted = await run(), plain = await run(), otherEvent = await run(), foreign = await run();
    await event({ companyId, agentId, runId: compacted, eventType: "context.compacted" });
    await event({ companyId, agentId, runId: compacted, eventType: "context.compacted" });
    await event({ companyId, agentId, runId: otherEvent, eventType: "lifecycle" });
    // Another company's event on this run's id doesn't count.
    await event({ companyId: other.companyId, agentId: other.agentId, runId: foreign, eventType: "context.compacted" });

    const rows = await activityService(db).runsForIssue(companyId, issueId, null, undefined, undefined, { skipLivenessBackfill: true });
    const byId = new Map(rows.map((row) => [row.runId, row.compacted]));
    expect(byId).toEqual(new Map([[compacted, true], [plain, false], [otherEvent, false], [foreign, false]]));
  });
});
