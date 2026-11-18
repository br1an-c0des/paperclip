import { randomUUID } from "node:crypto";
import express, { Router, type Request } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agents, heartbeatRuns, issueComments, issues, type Db } from "@paperclipai/db";
import { resolveAgentAccess, type AgentAccess } from "@paperclipai/shared";
import { errorHandler } from "../middleware/error-handler.js";

vi.mock("../services/agent-access.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/agent-access.js")>();
  return { ...actual, loadAgentAccess: vi.fn(), actualLoadAgentAccess: actual.loadAgentAccess };
});

const agentAccessModule = await import("../services/agent-access.js");
const { loadAgentAccess } = agentAccessModule;
const actualLoadAgentAccess = (agentAccessModule as unknown as { actualLoadAgentAccess: typeof loadAgentAccess }).actualLoadAgentAccess;
const { paperclipMcpRoutes } = await import("../routes/paperclip-mcp.js");
const { readRunDisposition } = await import("../services/heartbeat/run-disposition.js");

const COMPANY = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";

type Tool = { name: string; description: string; inputSchema: { type: string }; annotations?: Record<string, unknown> };

/** The endpoint mounted the way app.ts mounts it, with a fixed actor and fake REST routes. */
function testApp(actor: Request["actor"]) {
  const api = Router();
  const seen: Array<{ method: string; path: string; actor: Request["actor"]; runHeader?: string; body: unknown }> = [];
  api.use(paperclipMcpRoutes({} as Db, api));
  api.post("/issues/:id/comments", (req, res) => {
    seen.push({ method: req.method, path: req.path, actor: req.actor, runHeader: req.header("x-paperclip-run-id"), body: req.body });
    res.status(201).json({ id: "comment-1", body: req.body.body, authorAgentId: req.actor.agentId, secret: "hidden" });
  });
  api.delete("/issues/:id", (_req, res) => {
    res.status(403).json({ error: "Deleting tasks needs tasks:delete", code: "access_denied", missingAction: "tasks:delete", requestable: true });
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.actor = actor; next(); });
  app.use("/api", api);
  app.use(errorHandler);
  return { app, seen };
}

const runActor = (): Request["actor"] => ({ type: "agent", source: "agent_jwt", agentId: AGENT, companyId: COMPANY, runId: RUN });
const keyActor = (): Request["actor"] => ({ type: "agent", source: "agent_key", agentId: AGENT, companyId: COMPANY, keyId: "key-1" });

function withAccess(access: AgentAccess) {
  vi.mocked(loadAgentAccess).mockResolvedValue(resolveAgentAccess(access));
}

async function rpc(app: express.Express, method: string, params?: unknown, id: number | null = 1) {
  const response = await request(app).post("/api/mcp/paperclip").send({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) });
  return response;
}

async function listTools(app: express.Express): Promise<Tool[]> {
  const response = await rpc(app, "tools/list");
  expect(response.status).toBe(200);
  return response.body.result.tools;
}

describe("POST /api/mcp/paperclip", () => {
  beforeEach(() => vi.mocked(loadAgentAccess).mockReset());

  it("a worker run lists task tools but not delete", async () => {
    withAccess({ level: "worker" });
    const tools = await listTools(testApp(runActor()).app);
    const allowed = tools.filter(tool => !tool.annotations?.paperclipNeedsApproval).map(tool => tool.name);
    for (const name of ["paperclip_task_context", "paperclip_update_task", "paperclip_add_comment", "paperclip_create_task", "paperclip_finish", "paperclip_block"]) {
      expect(allowed).toContain(name);
    }
    expect(allowed).not.toContain("paperclip_delete_task");
    expect(tools.map(tool => tool.name)).not.toContain("paperclip_call_api");
    for (const tool of tools) expect(tool.inputSchema.type).toBe("object");
  });

  it("a worker run sees delete marked as needing approval", async () => {
    withAccess({ level: "worker" });
    const tools = await listTools(testApp(runActor()).app);
    const remove = tools.find(tool => tool.name === "paperclip_delete_task")!;
    expect(remove.annotations).toEqual({ paperclipNeedsApproval: true });
    expect(remove.description.endsWith("Needs approval.")).toBe(true);

    withAccess({ level: "worker", overrides: { "tasks:delete": true } });
    const granted = (await listTools(testApp(runActor()).app)).find(tool => tool.name === "paperclip_delete_task")!;
    expect(granted.annotations).toBeUndefined();
  });

  it("an agent key sees no run tools", async () => {
    withAccess({ level: "worker" });
    const { app } = testApp(keyActor());
    const names = (await listTools(app)).map(tool => tool.name);
    for (const name of ["paperclip_task_context", "paperclip_report_progress", "paperclip_finish", "paperclip_block"]) {
      expect(names).not.toContain(name);
    }
    expect(names).toContain("paperclip_me");
    expect(names).toContain("paperclip_update_task");

    const finish = await rpc(app, "tools/call", { name: "paperclip_finish", arguments: { summary: "done" } });
    expect(finish.body.result.isError).toBe(true);
    expect(finish.body.result.structuredContent).toMatchObject({ code: "run_required" });
    expect(finish.body.result.content[0].text).toMatch(/only during a run/);
  });

  it("calling a denied tool returns access_denied", async () => {
    withAccess({ level: "worker" });
    const { app } = testApp(runActor());
    const denied = await rpc(app, "tools/call", { name: "paperclip_manage_labels", arguments: { create: [{ name: "x", color: "#000000" }] } });
    expect(denied.body.result).toMatchObject({ isError: true, structuredContent: { code: "access_denied", missingAction: "labels:manage", requestable: true } });

    // A route's own access denial comes back the same way.
    withAccess({ level: "worker", overrides: { "tasks:delete": true } });
    const routeDenied = await rpc(app, "tools/call", { name: "paperclip_delete_task", arguments: { taskId: "TES-1" } });
    expect(routeDenied.body.result).toMatchObject({
      isError: true, structuredContent: { code: "access_denied", status: 403, missingAction: "tasks:delete", requestable: true },
    });

    // A tool the caller can't even request is not callable either.
    withAccess({ level: "worker" });
    const raw = await rpc(app, "tools/call", { name: "paperclip_call_api", arguments: { operationId: "GET /issues/{id}" } });
    expect(raw.body.result).toMatchObject({ isError: true, structuredContent: { code: "access_denied", missingAction: "api:raw", requestable: false } });
  });

  it("smoke: initialize, tools/list and tools/call return valid JSON-RPC for a run token", async () => {
    withAccess({ level: "worker" });
    const { app, seen } = testApp(runActor());
    const init = await rpc(app, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body).toEqual({ jsonrpc: "2.0", id: 1, result: {
      protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "paperclip", version: "1" },
    } });
    const notified = await rpc(app, "notifications/initialized", undefined, null);
    expect(notified.status).toBe(202);

    const listed = await rpc(app, "tools/list", undefined, 2);
    expect(listed.body).toMatchObject({ jsonrpc: "2.0", id: 2 });
    expect(Array.isArray(listed.body.result.tools)).toBe(true);

    const called = await rpc(app, "tools/call", { name: "paperclip_add_comment", arguments: { taskId: "TES-1", body: "Progress" } }, 3);
    expect(called.body).toEqual({ jsonrpc: "2.0", id: 3, result: {
      content: [{ type: "text", text: JSON.stringify({ comment: { id: "comment-1", body: "Progress", authorAgentId: AGENT } }) }],
      structuredContent: { comment: { id: "comment-1", body: "Progress", authorAgentId: AGENT } },
    } });
    expect(seen).toEqual([{ method: "POST", path: "/issues/TES-1/comments", actor: runActor(), runHeader: RUN, body: { body: "Progress" } }]);

    const invalid = await rpc(app, "tools/call", { name: "paperclip_add_comment", arguments: { taskId: "TES-1" } }, 4);
    expect(invalid.body.result).toMatchObject({ isError: true, structuredContent: { code: "invalid_arguments" } });
    const unknown = await rpc(app, "tools/call", { name: "paperclip_nope", arguments: {} }, 5);
    expect(unknown.body.result).toMatchObject({ isError: true, structuredContent: { code: "unknown_tool" } });
    const missing = await rpc(app, "resources/list", undefined, 6);
    expect(missing.body).toEqual({ jsonrpc: "2.0", id: 6, error: { code: -32601, message: "Method not found" } });
  });

  it("refuses a board session", async () => {
    const { app } = testApp({ type: "board", source: "session", userId: "user-1" });
    const response = await rpc(app, "tools/list");
    expect(response.status).toBe(401);
  });
});

// The real app: a run token, the mount in app.ts, the REST routes and the database.
const { recoveryPostgresSupport: support } = await import("./helpers/recovery-postgres.js");
(support.supported ? describe : describe.skip)("POST /api/mcp/paperclip in the real app", () => {
  let server: Awaited<ReturnType<typeof import("./helpers/runner-api-server.js").startRunnerApiTestServer>>;
  const originalSecret = process.env.PAPERCLIP_AGENT_JWT_SECRET;
  beforeAll(async () => {
    vi.mocked(loadAgentAccess).mockImplementation(actualLoadAgentAccess);
    process.env.PAPERCLIP_AGENT_JWT_SECRET = randomUUID();
    const { startRunnerApiTestServer } = await import("./helpers/runner-api-server.js");
    server = await startRunnerApiTestServer();
  }, 120_000);
  afterAll(async () => {
    await server?.close();
    if (originalSecret === undefined) delete process.env.PAPERCLIP_AGENT_JWT_SECRET; else process.env.PAPERCLIP_AGENT_JWT_SECRET = originalSecret;
  });

  it("serves a run: task context, a comment, and finish recording the disposition", async () => {
    const { createLocalAgentJwt } = await import("../agent-auth-jwt.js");
    const f = await server.fixture({ disableWakeOnDemand: true });
    // The fixture is a native Runner run (dormant here); make it a claude_local CLI run.
    await server.db.update(agents).set({ adapterType: "claude_local", adapterConfig: {} }).where(eq(agents.id, f.agentId));
    await server.db.update(heartbeatRuns).set({ runtimeMode: "legacy", nativeIssueId: null }).where(eq(heartbeatRuns.id, f.runId));
    const token = createLocalAgentJwt(f.agentId, f.companyId, "claude_local", f.runId, f.responsibleUserId)!;
    let id = 0;
    const call = async (method: string, params?: unknown) => {
      const response = await fetch(`${server.apiUrl}/api/mcp/paperclip`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, ...(params ? { params } : {}) }),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { jsonrpc: string; id: number; result: Record<string, any> };
      expect(body).toMatchObject({ jsonrpc: "2.0", id });
      return body.result;
    };

    expect((await call("initialize", { protocolVersion: "2025-03-26" })).serverInfo).toEqual({ name: "paperclip", version: "1" });
    const tools = (await call("tools/list")).tools as Tool[];
    // The fixture's agent has no stored access, so it's a worker.
    expect(tools.map(tool => tool.name)).toContain("paperclip_finish");
    expect(tools.find(tool => tool.name === "paperclip_delete_task")?.annotations).toEqual({ paperclipNeedsApproval: true });

    const context = await call("tools/call", { name: "paperclip_task_context", arguments: {} });
    expect(context.isError).toBeUndefined();
    expect(context.structuredContent.taskId).toBe(f.issueId);
    expect(context.structuredContent.documents.map((doc: { key: string }) => doc.key)).toContain("notes");

    const comment = await call("tools/call", { name: "paperclip_add_comment", arguments: { taskId: f.issueId, body: "MCP smoke comment" } });
    expect(comment.isError).toBeUndefined();
    const comments = await server.db.select().from(issueComments).where(eq(issueComments.issueId, f.issueId));
    expect(comments.map(row => row.body)).toContain("MCP smoke comment");

    const finished = await call("tools/call", { name: "paperclip_finish", arguments: { summary: "Smoke test finished" } });
    expect(finished.isError, JSON.stringify(finished)).toBeUndefined();
    const [task] = await server.db.select().from(issues).where(eq(issues.id, f.issueId));
    expect(task.status).toBe("done");
    const [run] = await server.db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(readRunDisposition(run)).toMatchObject({ kind: "finished", tool: "paperclip_finish", taskStatus: "done", summary: "Smoke test finished" });
  }, 60_000);
});
