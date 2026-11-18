import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { readRunDisposition } from "../services/heartbeat/run-disposition.js";
import { catalogDeps } from "./catalog-deps.js";
import { eq } from "drizzle-orm";

const support = await getEmbeddedPostgresTestSupport();

describe.skipIf(!support.supported)("catalogDeps", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-mcp-catalog-deps-");
    db = createDb(tempDb.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await tempDb?.cleanup();
  });

  it("reads the run's task and wake comment, and records its disposition", async () => {
    const [company] = await db.insert(companies).values({ name: "MCP", issuePrefix: `M${Math.random().toString(36).slice(2, 7).toUpperCase()}` }).returning();
    const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Worker" }).returning();
    const [issue] = await db.insert(issues).values({ companyId: company.id, title: "Task", status: "in_progress" }).returning();
    const [bound] = await db.insert(heartbeatRuns).values({
      companyId: company.id, agentId: agent.id, status: "running",
      contextSnapshot: { issueId: issue.id, wakeCommentId: "c-1" },
    }).returning();
    const [unbound] = await db.insert(heartbeatRuns).values({ companyId: company.id, agentId: agent.id, status: "running" }).returning();

    const deps = catalogDeps(db);
    expect(await deps.runTask(bound.id)).toEqual({ taskId: issue.id, wakeCommentId: "c-1" });
    expect(await deps.runTask(unbound.id)).toEqual({ taskId: null, wakeCommentId: null });

    await deps.recordDisposition(bound.id, { kind: "finished", at: "2026-11-17T10:00:00.000Z", via: "tool", tool: "paperclip_finish" });
    const [stored] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, bound.id));
    expect(readRunDisposition(stored)).toMatchObject({ kind: "finished", tool: "paperclip_finish" });
  });
});
