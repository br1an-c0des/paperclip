import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, approvals, companies, createDb, issueApprovals, issues } from "@paperclipai/db";
import { resolveAgentAccess, type AgentAccess } from "@paperclipai/shared";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { catalogDeps } from "../mcp/catalog-deps.js";
import { createPaperclipCatalog } from "../mcp/catalog/index.js";
import type { McpCaller } from "../mcp/catalog/types.js";
import { recordingDispatch } from "../mcp/catalog/test-support.js";
import { McpToolError } from "../mcp/dispatch.js";
import { callTool, type McpSession } from "../mcp/server.js";
import { permissionRequestCreator, permissionRequestSummary, readPermissionRequestPayload } from "./permission-requests.js";

const support = await getEmbeddedPostgresTestSupport();

describe("permissionRequestSummary", () => {
  it("reads as one plain sentence", () => {
    expect(permissionRequestSummary("paperclip_delete_task", "TES-12")).toBe("Delete task TES-12");
    expect(permissionRequestSummary("paperclip_write_document", "TES-12")).toBe("Write document on TES-12");
    expect(permissionRequestSummary("paperclip_manage_labels", null)).toBe("Manage labels");
  });
});

describe.skipIf(!support.supported)("permission requests from a requestable denial", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId = "";
  let agentId = "";
  let task = { id: "", identifier: "" };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-permission-requests-");
    db = createDb(tempDb.connectionString);
    const [company] = await db.insert(companies).values({ name: "Requests", issuePrefix: "REQ" }).returning();
    companyId = company!.id;
    const [agent] = await db.insert(agents).values({ companyId, name: "M7 test worker", permissions: { access: { level: "worker" } } }).returning();
    agentId = agent!.id;
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await tempDb?.cleanup();
  });

  beforeEach(async () => {
    await db.delete(issueApprovals);
    await db.delete(approvals);
    const identifier = `REQ-${Math.floor(Math.random() * 1_000_000)}`;
    const [row] = await db.insert(issues).values({ companyId, title: "M7 test task", identifier, status: "todo" }).returning();
    task = { id: row!.id, identifier };
  });

  function session(input: { access?: AgentAccess; kind?: "run" | "agent_key"; dispatch?: ReturnType<typeof recordingDispatch> } = {}): McpSession {
    const kind = input.kind ?? "agent_key";
    const runId = kind === "run" ? randomUUID() : null;
    const caller: McpCaller = {
      kind,
      actor: { type: "agent", source: kind === "run" ? "agent_jwt" : "agent_key", agentId, companyId, runId },
      companyId, agentId, userId: null, runId, grantId: null,
      access: resolveAgentAccess(input.access ?? { level: "worker" }),
    };
    return {
      caller,
      catalog: createPaperclipCatalog(catalogDeps(db)),
      dispatch: input.dispatch ?? recordingDispatch(),
      requestPermission: permissionRequestCreator(db),
    };
  }

  const requests = () => db.select().from(approvals).where(eq(approvals.type, "permission_request"));

  it("a worker calling paperclip_delete_task creates one permission_request", async () => {
    const dispatch = recordingDispatch();
    const result = await callTool(session({ dispatch }), "paperclip_delete_task", { taskId: task.identifier });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ status: "requested", missingAction: "tasks:delete" });
    expect(result.content[0]!.text).toMatch(/Sent to the board for approval/);
    expect(dispatch.calls).toEqual([]);

    const rows = await requests();
    expect(rows).toHaveLength(1);
    const approval = rows[0]!;
    expect(approval).toMatchObject({ status: "pending", requestedByAgentId: agentId, requestedByUserId: null });
    expect(result.structuredContent).toMatchObject({ approvalId: approval.id, url: `/REQ/approvals/${approval.id}` });
    const payload = readPermissionRequestPayload(approval)!;
    expect(payload).toMatchObject({
      version: 1,
      caller: { kind: "agent_key", agentId, userId: null, runId: null, grantId: null },
      taskId: task.id,
      tool: "paperclip_delete_task",
      // The identifier is stored as the task's UUID, so the replay names the same task.
      arguments: { taskId: task.id },
      missingAction: "tasks:delete",
      summary: `Delete task ${task.identifier}`,
    });
    const expiresIn = Date.parse(payload.expiresAt) - Date.now();
    expect(expiresIn).toBeGreaterThan(6.9 * 24 * 3600_000);
    expect(expiresIn).toBeLessThanOrEqual(7 * 24 * 3600_000);
    const links = await db.select().from(issueApprovals).where(eq(issueApprovals.approvalId, approval.id));
    expect(links.map(link => link.issueId)).toEqual([task.id]);
  });

  it("a second identical call reuses it", async () => {
    const first = await callTool(session(), "paperclip_delete_task", { taskId: task.identifier });
    const second = await callTool(session(), "paperclip_delete_task", { taskId: task.id });
    expect(second.structuredContent?.approvalId).toBe(first.structuredContent?.approvalId);
    expect(await requests()).toHaveLength(1);
    // A different call is a different request.
    await callTool(session(), "paperclip_manage_labels", { create: [{ name: "M7 test", color: "#112233" }] });
    expect(await requests()).toHaveLength(2);
  });

  it("a route's requestable refusal becomes a request too", async () => {
    const dispatch = recordingDispatch(() => {
      throw new McpToolError({ status: 403, code: "access_denied", message: "needs tasks:update_any", missingAction: "tasks:update_any", requestable: true });
    });
    const result = await callTool(session({ dispatch }), "paperclip_update_task", { taskId: task.id, title: "Renamed" });
    expect(result.structuredContent).toMatchObject({ status: "requested", missingAction: "tasks:update_any" });
    const [row] = await requests();
    expect(readPermissionRequestPayload(row!)).toMatchObject({ tool: "paperclip_update_task", arguments: { taskId: task.id, title: "Renamed" } });
  });

  it("a refusal for a reason other than access_level creates nothing", async () => {
    const dispatch = recordingDispatch(() => {
      throw new McpToolError({ status: 403, code: "access_denied", message: "private task", missingAction: "tasks:update_any", requestable: false });
    });
    const plain = await callTool(session({ dispatch }), "paperclip_update_task", { taskId: task.id, title: "Renamed" });
    expect(plain).toMatchObject({ isError: true, structuredContent: { code: "access_denied", requestable: false } });
    const locked = recordingDispatch(() => {
      throw new McpToolError({ status: 409, code: "issue_locked", message: "Another run holds this task" });
    });
    expect((await callTool(session({ dispatch: locked }), "paperclip_add_comment", { taskId: task.id, body: "hi" })).isError).toBe(true);
    // A tool that isn't requestable (call_api) is a plain denial too.
    expect((await callTool(session(), "paperclip_call_api", { operationId: "GET /issues/{id}" })).isError).toBe(true);
    expect(await requests()).toHaveLength(0);
  });

  it("run-only tools never create one", async () => {
    const readOnly = await callTool(session({ kind: "run", access: { level: "read_only" } }), "paperclip_finish", { summary: "done" });
    expect(readOnly).toMatchObject({ isError: true, structuredContent: { code: "access_denied", requestable: false } });
    const dispatch = recordingDispatch(() => {
      throw new McpToolError({ status: 403, code: "access_denied", message: "no", missingAction: "tasks:update_any", requestable: true });
    });
    const s = session({ kind: "run", dispatch });
    s.caller = { ...s.caller };
    // The run tools look up the run's task; give it one.
    const routed = await callTool({ ...s, catalog: createPaperclipCatalog({ ...catalogDeps(db), runTask: async () => ({ taskId: task.id, wakeCommentId: null }) }) },
      "paperclip_finish", { summary: "done" });
    expect(routed).toMatchObject({ isError: true, structuredContent: { code: "access_denied", requestable: true } });
    expect(await requests()).toHaveLength(0);
  });
});
