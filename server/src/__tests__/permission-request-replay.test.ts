import { randomUUID } from "node:crypto";
import express, { type Request } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agents, approvals, companies, createDb, issueApprovals, issues, temporaryAccessGrants } from "@paperclipai/db";
import { resolveAgentAccess } from "@paperclipai/shared";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/error-handler.js";
import { agentRoutePolicy } from "../middleware/agent-route-policy.js";
import { catalogDeps } from "../mcp/catalog-deps.js";
import { createPaperclipCatalog } from "../mcp/catalog/index.js";
import type { McpCaller } from "../mcp/catalog/types.js";
import { createCatalogDispatch, McpToolError } from "../mcp/dispatch.js";
import { approvalRoutes } from "../routes/approvals.js";
import { consumeTemporaryAccess, runWithReplayAccess } from "../services/agent-access.js";
import { authorizationService } from "../services/authorization.js";
import {
  createPermissionRequest,
  createPermissionRequestReplayer,
  readPermissionRequestPayload,
} from "../services/permission-requests.js";

const support = await getEmbeddedPostgresTestSupport();

describe.skipIf(!support.supported)("approving a permission request", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId = "";
  let agentId = "";
  let task = { id: "", identifier: "" };
  let deleted: string[] = [];
  let comments: Array<{ issueId: string; body: string; actor: Request["actor"] }> = [];
  let refuseDelete = false;
  let labels: string[] = [];
  let app!: express.Express;
  let api!: express.Router;

  const board: Request["actor"] = { type: "board", source: "local_implicit", userId: "local-board", isInstanceAdmin: true };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-permission-replay-");
    db = createDb(tempDb.connectionString);
    const [company] = await db.insert(companies).values({ name: "Replay", issuePrefix: "RPL" }).returning();
    companyId = company!.id;

    // The API as app.ts mounts it: the route policy first, then the routes. Task routes are stand-ins
    // that record what reached them; the approval routes are real.
    api = express.Router();
    api.use(agentRoutePolicy(db));
    // The label route's own check, as in routes/issues.ts, after the route policy's.
    api.post("/companies/:companyId/labels", async (req, res) => {
      const decision = await authorizationService(db).decide({
        actor: req.actor, action: "labels:manage", resource: { type: "company", companyId: String(req.params.companyId) },
      });
      if (!decision.allowed) {
        res.status(403).json({ error: decision.explanation, code: "access_denied", missingAction: "labels:manage", requestable: true });
        return;
      }
      labels.push(req.body.name);
      res.status(201).json({ id: randomUUID(), name: req.body.name, color: req.body.color });
    });
    api.delete("/issues/:id", (req, res) => {
      if (refuseDelete) {
        res.status(403).json({ error: "This task is private.", code: "access_denied", requestable: false });
        return;
      }
      deleted.push(String(req.params.id));
      res.status(204).end();
    });
    api.post("/issues/:id/comments", (req, res) => {
      comments.push({ issueId: String(req.params.id), body: req.body.body, actor: req.actor });
      res.status(201).json({ id: randomUUID(), body: req.body.body });
    });
    const replayer = createPermissionRequestReplayer({ db, api, catalog: createPaperclipCatalog(catalogDeps(db)) });
    api.use(approvalRoutes(db, { permissionRequests: replayer }));
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.actor = board; next(); });
    app.use("/api", api);
    app.use(errorHandler);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await tempDb?.cleanup();
  });

  beforeEach(async () => {
    deleted = [];
    comments = [];
    refuseDelete = false;
    labels = [];
    const [agent] = await db.insert(agents).values({
      companyId, name: `M7 test ${randomUUID().slice(0, 8)}`, permissions: { access: { level: "worker" } },
    }).returning();
    agentId = agent!.id;
    const identifier = `RPL-${Math.floor(Math.random() * 1_000_000)}`;
    const [row] = await db.insert(issues).values({ companyId, title: "M7 test task", identifier, status: "todo", assigneeAgentId: agentId }).returning();
    task = { id: row!.id, identifier };
  });

  function caller(): McpCaller {
    return {
      kind: "run", actor: { type: "agent", source: "agent_jwt", agentId, companyId, runId: null }, companyId, agentId,
      userId: null, runId: null, grantId: null, access: resolveAgentAccess({ level: "worker" }),
    };
  }

  async function deleteRequest() {
    const { approvalId } = await createPermissionRequest(db, {
      caller: caller(), tool: "paperclip_delete_task", arguments: { taskId: task.identifier }, missingAction: "tasks:delete", taskId: task.identifier,
    });
    return approvalId;
  }

  const approve = (id: string, body: Record<string, unknown> = {}) => request(app).post(`/api/approvals/${id}/approve`).send(body);
  const approvalRow = async (id: string) => (await db.select().from(approvals).where(eq(approvals.id, id)))[0]!;

  it("approving replays the call once and records done", async () => {
    const id = await deleteRequest();
    const response = await approve(id);
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("approved");
    expect(deleted).toEqual([task.id]);
    const payload = readPermissionRequestPayload(await approvalRow(id))!;
    expect(payload.result).toMatchObject({ status: "done" });
    // Approving again changes nothing and never replays twice.
    expect((await approve(id)).status).toBe(200);
    expect(deleted).toEqual([task.id]);
  });

  it("the replay leaves no grant behind", async () => {
    const id = await deleteRequest();
    await approve(id);
    expect(deleted).toEqual([task.id]);
    expect(await db.select().from(temporaryAccessGrants).where(eq(temporaryAccessGrants.principalId, agentId))).toEqual([]);
    // Without a new approval the agent still can't delete.
    const call = createCatalogDispatch(api, caller())("DELETE", `/issues/${task.id}`);
    await expect(call).rejects.toMatchObject({ status: 403, code: "access_denied", missingAction: "tasks:delete" });
    expect(deleted).toEqual([task.id]);
    const again = await deleteRequest();
    expect(again).not.toBe(id);
  });

  it("a replay covers every write of a multi-write call, and nothing after it", async () => {
    const args = { create: [
      { name: "M7 test one", color: "#111111" }, { name: "M7 test two", color: "#222222" }, { name: "M7 test three", color: "#333333" },
    ] };
    // A run's request records the run's task, though the call itself acts on the company's labels.
    const { approvalId } = await createPermissionRequest(db, {
      caller: caller(), tool: "paperclip_manage_labels", arguments: args, missingAction: "labels:manage", taskId: task.identifier,
    });
    expect((await approve(approvalId)).status).toBe(200);
    expect(labels).toEqual(["M7 test one", "M7 test two", "M7 test three"]);
    expect(readPermissionRequestPayload(await approvalRow(approvalId))!.result).toMatchObject({ status: "done" });
    expect(await db.select().from(temporaryAccessGrants).where(eq(temporaryAccessGrants.principalId, agentId))).toEqual([]);
    // The same call afterwards is refused again at its first write.
    const tool = createPaperclipCatalog(catalogDeps(db)).find(candidate => candidate.name === "paperclip_manage_labels")!;
    const rerun = tool.run(caller(), tool.input.parse(args), createCatalogDispatch(api, caller()));
    await expect(rerun).rejects.toBeInstanceOf(McpToolError);
    await expect(rerun).rejects.toMatchObject({ status: 403, missingAction: "labels:manage" });
    expect(labels).toHaveLength(3);
  });

  it("a replay's allow covers only its action, principal and resource, and ends with the replay", async () => {
    const other = randomUUID();
    const principal = { type: "agent" as const, id: agentId };
    const check = (overrides: Partial<Parameters<typeof consumeTemporaryAccess>[1]> = {}) => consumeTemporaryAccess(db, {
      companyId, principal, action: "tasks:delete", resource: { type: "issue", id: task.id }, ...overrides,
    });
    let later: Promise<boolean> | null = null;
    await runWithReplayAccess({ companyId, principal, action: "tasks:delete", resource: { type: "issue", id: task.id } }, async () => {
      expect(await check()).toBe(true);
      expect(await check({ resource: { type: "issue", id: other } })).toBe(false);
      expect(await check({ resource: { type: "company", id: companyId } })).toBe(false);
      expect(await check({ action: "tasks:update_any" })).toBe(false);
      expect(await check({ principal: { type: "agent", id: other } })).toBe(false);
      expect(await check({ principal: { type: "user", id: agentId } })).toBe(false);
      // Work the replay leaves running doesn't keep the allow.
      later = new Promise<boolean>(resolve => setTimeout(() => resolve(check()), 20));
    });
    expect(await later).toBe(false);
    expect(await check()).toBe(false);
    // A company-wide allow covers any resource in that company, and no other company's.
    await runWithReplayAccess({ companyId, principal, action: "labels:manage", resource: { type: "company", id: companyId } }, async () => {
      expect(await check({ action: "labels:manage", resource: { type: "company", id: companyId } })).toBe(true);
      expect(await check({ action: "labels:manage", resource: { type: "issue", id: other } })).toBe(true);
      expect(await check({ action: "labels:manage", companyId: other, resource: { type: "company", id: other } })).toBe(false);
    });
  });

  it("a replay refused by another check records refused", async () => {
    refuseDelete = true;
    const id = await deleteRequest();
    expect((await approve(id)).status).toBe(200);
    const row = await approvalRow(id);
    expect(row.status).toBe("approved");
    expect(readPermissionRequestPayload(row)!.result).toMatchObject({ status: "refused", detail: "This task is private." });
    // Nothing usable is left behind.
    expect(await db.select().from(temporaryAccessGrants).where(eq(temporaryAccessGrants.principalId, agentId))).toEqual([]);
  });

  it("approve after expiry doesn't replay", async () => {
    const id = await deleteRequest();
    const row = await approvalRow(id);
    await db.update(approvals).set({ payload: { ...row.payload, expiresAt: new Date(Date.now() - 1000).toISOString() } }).where(eq(approvals.id, id));
    expect((await approve(id, { alwaysAllow: true })).status).toBe(200);
    expect(deleted).toEqual([]);
    expect(readPermissionRequestPayload(await approvalRow(id))!.result).toMatchObject({ status: "refused", detail: "expired" });
    // An expired request adds no override either.
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect((agent!.permissions as { access?: { overrides?: unknown } }).access?.overrides).toBeUndefined();
    expect(comments.at(-1)?.body).toMatch(/expired/);
  });

  it("always-allow adds the override", async () => {
    const id = await deleteRequest();
    expect((await approve(id, { alwaysAllow: true })).status).toBe(200);
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(agent!.permissions).toMatchObject({ access: { level: "worker", overrides: { "tasks:delete": true } } });
    expect(deleted).toEqual([task.id]);
  });

  it("always-allow is only for permission requests", async () => {
    const [other] = await db.insert(approvals).values({
      companyId, type: "request_board_approval", payload: { title: "x" }, status: "pending",
    }).returning();
    const response = await approve(other!.id, { alwaysAllow: true });
    expect(response.status).toBe(422);
  });

  it("POST approvals refuses permission_request", async () => {
    const response = await request(app).post(`/api/companies/${companyId}/approvals`).send({ type: "permission_request", payload: {} });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe("permission_request_reserved");
  });

  it("a task comment reports the outcome", async () => {
    const id = await deleteRequest();
    await approve(id);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ issueId: task.id, body: `Permission request approved: Delete task ${task.identifier}. Done.` });
    expect(comments[0]!.actor).toMatchObject({ type: "board", userId: "local-board" });
  });

  it("reject records nothing beyond the normal rejection", async () => {
    const id = await deleteRequest();
    expect((await request(app).post(`/api/approvals/${id}/reject`).send({})).status).toBe(200);
    const row = await approvalRow(id);
    expect(row.status).toBe("rejected");
    expect(readPermissionRequestPayload(row)!.result).toBeUndefined();
    expect(deleted).toEqual([]);
    expect(comments).toEqual([]);
    const links = await db.select().from(issueApprovals).where(and(eq(issueApprovals.approvalId, id), eq(issueApprovals.issueId, task.id)));
    expect(links).toHaveLength(1);
  });
});
