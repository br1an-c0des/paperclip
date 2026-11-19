import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express, { type Request } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { approvals, authUsers, companies, companyMemberships, createDb, issues, mcpMutationReceipts, mcpOauthGrants } from "@paperclipai/db";
import type { AgentAccessLevel } from "@paperclipai/shared";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentRoutePolicy } from "../middleware/agent-route-policy.js";
import { errorHandler } from "../middleware/error-handler.js";
import { resolveMcpCaller } from "../mcp/caller.js";
import { catalogDeps } from "../mcp/catalog-deps.js";
import { createPaperclipCatalog } from "../mcp/catalog/index.js";
import { approvalRoutes } from "../routes/approvals.js";
import { issueRoutes } from "../routes/issues.js";
import { publicMcpIngressRoutes } from "../routes/public-mcp.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { createPermissionRequestReplayer, permissionRequestCreator, readPermissionRequestPayload } from "../services/permission-requests.js";
import { createMcpApiDispatch } from "../services/public-mcp/capabilities.js";
import { createPublicMcpCatalog } from "../services/public-mcp/catalog.js";
import { createPublicMcpTransfers } from "../services/public-mcp/file-transfers.js";
import { createPublicMcpOAuth } from "../services/public-mcp/oauth.js";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { createStorageService } from "../storage/service.js";

const support = await getEmbeddedPostgresTestSupport();
const config = { origin: "https://paperclip.example", resource: "https://paperclip.example/mcp/paperclip" };
const redirectUri = "https://client.example/callback";
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

type Tool = { name: string; description: string; inputSchema: { properties?: Record<string, unknown> }; annotations?: Record<string, unknown> };

describe.skipIf(!support.supported)("the public MCP serves the Paperclip catalog", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let storageDir = "";
  let oauth!: ReturnType<typeof createPublicMcpOAuth>;
  let app!: express.Express;
  let api!: express.Router;
  let board: Request["actor"] = { type: "none", source: "none" };
  const labels: Array<{ name: string; actor: Request["actor"] }> = [];

  beforeAll(async () => {
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", randomBytes(32).toString("base64"));
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-public-mcp-catalog-");
    db = createDb(tempDb.connectionString);
    oauth = createPublicMcpOAuth(db, config);
    await instanceSettingsService(db).updateExperimental({ enablePublicMcp: true });
    storageDir = await mkdtemp(join(tmpdir(), "mcp-catalog-files-"));
    const storage = createStorageService(createLocalDiskStorageProvider(storageDir));
    // The API the way app.ts mounts it: the route policy, then the routes (issues are real; labels a stand-in).
    api = express.Router();
    api.use(agentRoutePolicy(db));
    api.post("/companies/:companyId/labels", (req, res) => {
      labels.push({ name: req.body.name, actor: req.actor });
      res.status(201).json({ id: randomUUID(), name: req.body.name, color: req.body.color });
    });
    api.use(issueRoutes(db, storage));
    const replayer = createPermissionRequestReplayer({
      db, api, catalog: createPaperclipCatalog(catalogDeps(db)),
      resolveGrantCaller: async grantId => {
        const principal = await oauth.authorizeGrant(grantId);
        return resolveMcpCaller(db, principal.actor, { grant: principal.grant });
      },
    });
    api.use(approvalRoutes(db, { permissionRequests: replayer }));
    const transfers = createPublicMcpTransfers(db, oauth, createMcpApiDispatch(api), storage);
    app = express();
    app.use(transfers.router);
    app.use(express.json());
    app.use(publicMcpIngressRoutes(oauth, createPublicMcpCatalog(db, oauth, { api, transfers, requestPermission: permissionRequestCreator(db) })));
    app.use((req, _res, next) => { req.actor = board; next(); });
    app.use("/api", api);
    app.use(errorHandler);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await tempDb?.cleanup();
    await rm(storageDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  async function connection(accessLevel?: AgentAccessLevel) {
    const userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "M7 test person", email: `${userId}@example.com`, createdAt: new Date(), updatedAt: new Date() });
    const [company] = await db.insert(companies).values({ name: "M7 test", issuePrefix: "C" + randomBytes(3).toString("hex").toUpperCase() }).returning();
    await db.insert(companyMemberships).values({ companyId: company!.id, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" });
    const actor: Request["actor"] = { type: "board", source: "session", userId, companyIds: [company!.id], memberships: [{ companyId: company!.id, membershipRole: "owner", status: "active" }] };
    const client = await oauth.register({ client_name: "M7 test client", redirect_uris: [redirectUri] }, randomUUID());
    const url = await oauth.authorize({ client_id: client.client_id, redirect_uri: redirectUri, resource: config.resource, scope: "paperclip:read", state: "s", response_type: "code", code_challenge: challenge, code_challenge_method: "S256" });
    const consent = await oauth.consent(url.split("/").at(-1)!, actor, { decision: "approve", companyId: company!.id, ...(accessLevel ? { accessLevel } : {}) });
    const code = new URL(consent.redirectUrl).searchParams.get("code")!;
    const tokens = await oauth.token({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirectUri, resource: config.resource, code, code_verifier: verifier });
    const [task] = await db.insert(issues).values({ companyId: company!.id, title: "M7 test task", status: "backlog" }).returning();
    const rpc = (method: string, params?: unknown) => request(app).post("/mcp/paperclip")
      .set("Authorization", `Bearer ${tokens.access_token}`).set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) });
    const tools = async (): Promise<Tool[]> => (await rpc("tools/list")).body.result.tools;
    const call = async (name: string, args: Record<string, unknown>) => (await rpc("tools/call", { name, arguments: args })).body.result;
    return { actor, company: company!, task: task!, rpc, tools, call };
  }

  it("the public MCP lists the catalog for a personal grant", async () => {
    const c = await connection();
    const tools = await c.tools();
    const names = tools.map(tool => tool.name);
    // A connection acting as the person, at the default manager level.
    for (const name of ["paperclip_me", "paperclip_search_tasks", "paperclip_create_task", "paperclip_update_task", "paperclip_manage_labels",
      "paperclip_deliverables", "paperclip_list_requests", "paperclip_skills", "paperclip_file_upload", "paperclip_file_download"]) {
      expect(names).toContain(name);
    }
    // No run: run-only tools are hidden. Configuring agents needs admin and is hidden below it.
    for (const name of ["paperclip_task_context", "paperclip_finish", "paperclip_block", "paperclip_report_progress"]) expect(names).not.toContain(name);
    expect(names).not.toContain("paperclip_configure_agent");
    expect(names).not.toContain("paperclip_call_api");
    // Changes take an optional retry key on the public MCP.
    expect(tools.find(tool => tool.name === "paperclip_update_task")!.inputSchema.properties).toHaveProperty("requestId");
    expect(tools.find(tool => tool.name === "paperclip_read_task")!.inputSchema.properties).not.toHaveProperty("requestId");
    const me = await c.call("paperclip_me", {});
    expect(me.structuredContent).toMatchObject({ kind: "oauth_person", user: { id: c.actor.userId }, companyId: c.company.id });
    const read = await c.call("paperclip_read_task", { taskId: c.task.id });
    expect(read.structuredContent.task).toMatchObject({ id: c.task.id, title: "M7 test task" });
  });

  it("a read_only grant sees no write tools", async () => {
    const c = await connection("read_only");
    const tools = await c.tools();
    const allowed = tools.filter(tool => !tool.annotations?.paperclipNeedsApproval);
    for (const tool of allowed) {
      // What's listed as usable only reads; a tool that reads or writes says its changes need approval.
      expect(["paperclip_me", "paperclip_search_tasks", "paperclip_read_task", "paperclip_read_document", "paperclip_list_labels",
        "paperclip_list_agents", "paperclip_list_projects", "paperclip_list_project_repositories", "paperclip_list_requests",
        "paperclip_deliverables", "paperclip_skills", "paperclip_file_download"]).toContain(tool.name);
    }
    expect(tools.find(tool => tool.name === "paperclip_deliverables")!.description).toMatch(/Changes need approval\.$/);
    const changed = await c.call("paperclip_update_task", { taskId: c.task.id, title: "Changed" });
    expect(changed.structuredContent).toMatchObject({ status: "requested", missingAction: "tasks:update_own" });
    expect((await db.select().from(issues).where(eq(issues.id, c.task.id)))[0]!.title).toBe("M7 test task");
  });

  it("replays a completed change for the same requestId and refuses different arguments", async () => {
    const c = await connection();
    const requestId = randomUUID();
    const first = await c.call("paperclip_update_task", { taskId: c.task.id, title: "Renamed once", requestId });
    expect(first.isError).toBeFalsy();
    expect(first.structuredContent.task).toMatchObject({ title: "Renamed once" });
    await db.update(issues).set({ title: "Changed in Paperclip" }).where(eq(issues.id, c.task.id));
    expect(await c.call("paperclip_update_task", { taskId: c.task.id, title: "Renamed once", requestId })).toEqual(first);
    expect((await db.select().from(issues).where(eq(issues.id, c.task.id)))[0]!.title).toBe("Changed in Paperclip");
    expect((await c.call("paperclip_update_task", { taskId: c.task.id, title: "Other", requestId })).structuredContent).toMatchObject({ code: "request_id_reused" });
    // A change without a requestId is still recorded.
    await c.call("paperclip_add_comment", { taskId: c.task.id, body: "M7 test note" });
    const receipts = await db.select().from(mcpMutationReceipts).where(eq(mcpMutationReceipts.companyId, c.company.id));
    expect(receipts.map(receipt => receipt.operation).sort()).toEqual(["paperclip_add_comment", "paperclip_update_task"]);
  });

  it("upload then download a file through the catalog tools", async () => {
    const c = await connection();
    const bytes = Buffer.from("M7 test file");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const upload = await c.call("paperclip_file_upload", { taskId: c.task.id, requestId: randomUUID(), filename: "note.txt", contentType: "text/plain", byteSize: bytes.length, sha256 });
    expect(upload.isError).toBeFalsy();
    const uploadUrl = new URL(upload.structuredContent.url as string);
    const put = await request(app).put(uploadUrl.pathname + uploadUrl.search).set("Content-Type", "text/plain").send(bytes);
    expect(put.status).toBe(200);
    const attachmentId = put.body.attachment.id as string;
    const listed = await c.call("paperclip_deliverables", { taskId: c.task.id });
    expect(listed.structuredContent.attachments).toEqual([expect.objectContaining({ id: attachmentId, originalFilename: "note.txt" })]);
    const download = await c.call("paperclip_file_download", { attachmentId });
    const downloadUrl = new URL(download.structuredContent.url as string);
    const got = await request(app).get(downloadUrl.pathname + downloadUrl.search).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(Buffer.from(chunk)));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });
    expect(got.status).toBe(200);
    expect((got.body as Buffer).toString()).toBe("M7 test file");
  });

  it("a connection's denied change becomes a request; approving replays it as the connection", async () => {
    const c = await connection("worker");
    const result = await c.call("paperclip_manage_labels", { create: [{ name: "M7 test", color: "#123456" }] });
    expect(result.structuredContent).toMatchObject({ status: "requested", missingAction: "labels:manage" });
    const [row] = await db.select().from(approvals).where(eq(approvals.id, result.structuredContent.approvalId as string));
    const payload = readPermissionRequestPayload(row!)!;
    expect(payload.caller).toMatchObject({ kind: "oauth_person", userId: c.actor.userId, agentId: null });
    expect(payload.connectionName).toBe("M7 test client");
    expect(row!.requestedByUserId).toBe(c.actor.userId);
    // The connection can't decide its own request.
    expect((await c.call("paperclip_list_requests", {})).structuredContent.requests).toEqual([expect.objectContaining({ id: row!.id, type: "permission_request" })]);
    board = { type: "board", source: "local_implicit", userId: "local-board", isInstanceAdmin: true };
    const approved = await request(app).post(`/api/approvals/${row!.id}/approve`).send({ alwaysAllow: true });
    expect(approved.status).toBe(200);
    expect(labels.at(-1)).toMatchObject({ name: "M7 test", actor: { type: "board", source: "mcp_oauth", userId: c.actor.userId } });
    const [after] = await db.select().from(approvals).where(eq(approvals.id, row!.id));
    expect(readPermissionRequestPayload(after!)!.result).toMatchObject({ status: "done" });
    const [grant] = await db.select().from(mcpOauthGrants).where(eq(mcpOauthGrants.id, payload.caller.grantId!));
    expect(grant!.accessOverrides).toEqual({ "labels:manage": true });
    const again = await c.call("paperclip_manage_labels", { create: [{ name: "M7 test 2", color: "#123456" }] });
    expect(again.structuredContent).toMatchObject({ created: [expect.objectContaining({ name: "M7 test 2" })] });
  });
});
