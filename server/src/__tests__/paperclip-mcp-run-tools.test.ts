import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, assets, heartbeatRuns, issueAttachments, issues } from "@paperclipai/db";
import { recoveryPostgresSupport as support } from "./helpers/recovery-postgres.js";

type Result = { isError?: boolean; content: Array<{ text: string }>; structuredContent: Record<string, any> };

/**
 * The run tools that step 5 phase 2's brief names, in the real app: a claude_local run's token,
 * the mount in app.ts, the REST routes and the database. `paperclip_file_download` for runs.
 */
(support.supported ? describe : describe.skip)("run tools in the real app", () => {
  let server: Awaited<ReturnType<typeof import("./helpers/runner-api-server.js").startRunnerApiTestServer>>;
  const saved = { secret: process.env.PAPERCLIP_AGENT_JWT_SECRET, apiUrl: process.env.PAPERCLIP_API_URL };
  beforeAll(async () => {
    process.env.PAPERCLIP_AGENT_JWT_SECRET = randomUUID();
    const { startRunnerApiTestServer } = await import("./helpers/runner-api-server.js");
    server = await startRunnerApiTestServer();
    process.env.PAPERCLIP_API_URL = server.apiUrl;
  }, 120_000);
  afterAll(async () => {
    await server?.close();
    for (const [key, value] of [["PAPERCLIP_AGENT_JWT_SECRET", saved.secret], ["PAPERCLIP_API_URL", saved.apiUrl]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  /** A claude_local CLI run (the fixture is a native Runner run, dormant here) and a tool caller for it. */
  async function claudeRun() {
    const { createLocalAgentJwt } = await import("../agent-auth-jwt.js");
    const f = await server.fixture({ disableWakeOnDemand: true });
    await server.db.update(agents).set({ adapterType: "claude_local", adapterConfig: {} }).where(eq(agents.id, f.agentId));
    await server.db.update(heartbeatRuns).set({ runtimeMode: "legacy", nativeIssueId: null }).where(eq(heartbeatRuns.id, f.runId));
    const token = createLocalAgentJwt(f.agentId, f.companyId, "claude_local", f.runId, f.responsibleUserId)!;
    let id = 0;
    const tool = async (name: string, args: Record<string, unknown>): Promise<Result> => {
      const response = await fetch(`${server.apiUrl}/api/mcp/paperclip`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
      });
      expect(response.status).toBe(200);
      return (await response.json() as { result: Result }).result;
    };
    return { f, tool };
  }

  /** A stored file attached to a task. */
  async function attach(companyId: string, issueId: string, text: string, filename = "notes.txt") {
    const saved = await server.storage.putFile({ companyId, namespace: "issues", originalFilename: filename, contentType: "text/plain", body: Buffer.from(text) });
    const [asset] = await server.db.insert(assets).values({ companyId, ...saved }).returning();
    const [attachment] = await server.db.insert(issueAttachments).values({ companyId, issueId, assetId: asset!.id }).returning();
    return attachment!.id;
  }

  let issueNumber = 10;
  async function task(companyId: string, values: Partial<typeof issues.$inferInsert> = {}) {
    const number = ++issueNumber;
    const [row] = await server.db.insert(issues).values({
      companyId, issueNumber: number, identifier: `T${randomUUID().slice(0, 8)}-${number}`, title: "Another task", status: "todo", ...values,
    }).returning();
    return row!.id;
  }

  describe("paperclip_file_download", () => {
    it("a run gets a link for an attachment on its task, and the link serves the file", async () => {
      const { f, tool } = await claudeRun();
      const attachmentId = await attach(f.companyId, f.issueId, "the wake's attached notes\n");
      const result = await tool("paperclip_file_download", { attachmentId });
      expect(result.isError, JSON.stringify(result)).toBeUndefined();
      const link = result.structuredContent;
      expect(link.url).toMatch(new RegExp(`^${server.apiUrl}/api/mcp/paperclip/files/download\\?ticket=[A-Za-z0-9_-]{43}$`));
      expect(link).toMatchObject({ method: "GET", attachment: { id: attachmentId, issueId: f.issueId, originalFilename: "notes.txt", byteSize: 26 } });
      expect(Date.parse(link.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);

      const download = await fetch(link.url);
      expect(download.status).toBe(200);
      expect(download.headers.get("cache-control")).toBe("no-store");
      expect(download.headers.get("content-disposition")).toMatch(/attachment; filename="notes.txt"/);
      expect(await download.text()).toBe("the wake's attached notes\n");

      // A ticket that was never issued, or a malformed one, is refused.
      expect((await fetch(link.url.replace(/ticket=.*/, `ticket=${"A".repeat(43)}`))).status).toBe(403);
      expect((await fetch(link.url.replace(/ticket=.*/, "ticket=short"))).status).toBe(403);
    }, 60_000);

    it("a run is refused for another company's attachment and for a task it can't read", async () => {
      const { f, tool } = await claudeRun();
      const foreignTask = await task(f.foreignCompanyId);
      const foreign = await attach(f.foreignCompanyId, foreignTask, "foreign-data-must-not-leak");
      const privateTask = await task(f.companyId, { visibility: "private", assigneeAgentId: null });
      const hidden = await attach(f.companyId, privateTask, "private-data-must-not-leak");
      for (const attachmentId of [foreign, hidden, randomUUID()]) {
        const result = await tool("paperclip_file_download", { attachmentId });
        expect(result, attachmentId).toMatchObject({ isError: true, structuredContent: { code: "attachment_not_found", status: 404 } });
        expect(JSON.stringify(result)).not.toMatch(/must-not-leak|ticket=/);
      }

      // The same agent reads an open task of its company's that isn't its own.
      const open = await attach(f.companyId, await task(f.companyId), "open notes");
      expect((await tool("paperclip_file_download", { attachmentId: open })).isError).toBeUndefined();
    }, 60_000);

    it("a link stops working when the run ends or the agent loses the task", async () => {
      const { f, tool } = await claudeRun();
      const attachmentId = await attach(f.companyId, f.issueId, "short-lived");
      const first = (await tool("paperclip_file_download", { attachmentId })).structuredContent.url as string;
      const second = (await tool("paperclip_file_download", { attachmentId })).structuredContent.url as string;
      expect(first).not.toBe(second);

      // The task turns private to someone else: the download rechecks the read.
      await server.db.update(issues).set({ visibility: "private", assigneeAgentId: null }).where(eq(issues.id, f.issueId));
      expect((await fetch(first)).status).toBe(403);
      await server.db.update(issues).set({ visibility: "open", assigneeAgentId: f.agentId }).where(eq(issues.id, f.issueId));
      expect((await fetch(first)).status).toBe(200);

      await server.db.update(heartbeatRuns).set({ status: "succeeded", finishedAt: new Date() }).where(eq(heartbeatRuns.id, f.runId));
      expect((await fetch(second)).status).toBe(403);
      expect(await tool("paperclip_file_download", { attachmentId })).toMatchObject({ isError: true, structuredContent: { code: "run_not_active" } });
    }, 60_000);
  });
});
