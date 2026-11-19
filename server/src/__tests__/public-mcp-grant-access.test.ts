import { createHash, randomBytes, randomUUID } from "node:crypto";
import express, { type Request } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, authUsers, companies, companyMemberships, createDb, issues, mcpOauthGrants, principalPermissionGrants } from "@paperclipai/db";
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
import { createCatalogDispatch } from "../mcp/dispatch.js";
import { callTool } from "../mcp/server.js";
import { publicMcpManagementRoutes } from "../routes/public-mcp.js";
import { loadAgentAccess } from "../services/agent-access.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { McpCapabilityError } from "../services/public-mcp/contracts.js";
import { createPublicMcpTransfers } from "../services/public-mcp/file-transfers.js";
import { createPublicMcpOAuth } from "../services/public-mcp/oauth.js";
import type { StorageService } from "../storage/types.js";

const support = await getEmbeddedPostgresTestSupport();
const config = { origin: "https://paperclip.example", resource: "https://paperclip.example/mcp/paperclip" };
const redirectUri = "https://client.example/callback";
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

describe.skipIf(!support.supported)("an outside connection's access level", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let oauth!: ReturnType<typeof createPublicMcpOAuth>;
  let api!: express.Router;
  const reached: Array<{ method: string; path: string; access?: Record<string, unknown> }> = [];

  beforeAll(async () => {
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY", randomBytes(32).toString("base64"));
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-grant-access-");
    db = createDb(tempDb.connectionString);
    oauth = createPublicMcpOAuth(db, config);
    await instanceSettingsService(db).updateExperimental({ enablePublicMcp: true });
    // The API with the real route policy and stand-in routes that record what reached them; the
    // labels route also reports the access the routes' own checks would see.
    api = express.Router();
    api.use(agentRoutePolicy(db));
    api.post("/companies/:companyId/issues", (req, res) => { reached.push({ method: "POST", path: req.path }); res.status(201).json({ id: randomUUID(), title: req.body.title }); });
    api.post("/companies/:companyId/labels", (req, res) => { reached.push({ method: "POST", path: req.path }); res.status(201).json({ id: randomUUID() }); });
    api.patch("/issues/:id", async (req, res) => {
      const access = req.actor.agentId ? await loadAgentAccess(db, req.actor.agentId) : undefined;
      reached.push({ method: "PATCH", path: req.path, access });
      res.json({ id: req.params.id });
    });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await tempDb?.cleanup();
    vi.unstubAllEnvs();
  });

  async function person(role = "owner") {
    const userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "M7 test person", email: `${userId}@example.com`, createdAt: new Date(), updatedAt: new Date() });
    const [company] = await db.insert(companies).values({ name: "M7 test", issuePrefix: "G" + randomBytes(3).toString("hex").toUpperCase() }).returning();
    const [membership] = await db.insert(companyMemberships).values({ companyId: company!.id, principalType: "user", principalId: userId, membershipRole: role, status: "active" }).returning();
    // An owner holds agents:configure, as joining with the owner role grants it.
    if (role === "owner") {
      await db.insert(principalPermissionGrants).values({ companyId: company!.id, principalType: "user", principalId: userId, permissionKey: "agents:configure" });
    }
    // As actorMiddleware builds a signed-in person.
    const actor: Request["actor"] = { type: "board", source: "session", userId, companyIds: [company!.id], memberships: [{ companyId: company!.id, membershipRole: role, status: "active" }], isInstanceAdmin: false };
    return { actor, company: company!, membership: membership! };
  }

  async function agentIn(companyId: string, level: AgentAccessLevel) {
    const [agent] = await db.insert(agents).values({ companyId, name: `M7 test ${randomUUID().slice(0, 6)}`, permissions: { access: { level } } }).returning();
    return agent!;
  }

  async function connect(p: Awaited<ReturnType<typeof person>>, consent: { accessLevel?: AgentAccessLevel; actAsAgentId?: string | null }) {
    const client = await oauth.register({ client_name: "M7 test client", redirect_uris: [redirectUri] }, randomUUID());
    const url = await oauth.authorize({ client_id: client.client_id, redirect_uri: redirectUri, resource: config.resource, scope: "paperclip:read offline_access", state: "s", response_type: "code", code_challenge: challenge, code_challenge_method: "S256" });
    const id = url.split("/").at(-1)!;
    const answer = await oauth.consent(id, p.actor, { decision: "approve", companyId: p.company.id, ...consent });
    const code = new URL(answer.redirectUrl).searchParams.get("code")!;
    const tokens = await oauth.token({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirectUri, resource: config.resource, code, code_verifier: verifier });
    return tokens.access_token;
  }

  async function callerFor(token: string) {
    const principal = await oauth.authenticate(token);
    return resolveMcpCaller(db, principal.actor, { grant: principal.grant });
  }

  it("a personal grant at read_only can't create a task through call_api or a tool", async () => {
    const p = await person();
    const caller = await callerFor(await connect(p, { accessLevel: "read_only" }));
    expect(caller.kind).toBe("oauth_person");
    const dispatch = createCatalogDispatch(api, caller);
    const session = { caller, catalog: createPaperclipCatalog(catalogDeps(db)), dispatch };
    const tool = await callTool(session, "paperclip_create_task", { title: "M7 test" });
    expect(tool).toMatchObject({ isError: true, structuredContent: { code: "access_denied", missingAction: "tasks:create" } });
    const raw = await callTool(session, "paperclip_call_api", { operationId: "POST /companies/{companyId}/issues", pathParams: { companyId: p.company.id }, body: { title: "M7 test" } });
    expect(raw).toMatchObject({ isError: true, structuredContent: { code: "access_denied", missingAction: "api:raw" } });
    // The route policy holds the cap too, for anything that reaches REST as this connection.
    reached.length = 0;
    await expect(dispatch("POST", `/companies/${p.company.id}/issues`, { title: "M7 test" }))
      .rejects.toMatchObject({ status: 403, code: "access_denied", missingAction: "tasks:create", requestable: true });
    await expect(dispatch("PATCH", `/issues/${randomUUID()}`, { title: "x" })).rejects.toMatchObject({ status: 403 });
    expect(reached).toEqual([]);
  });

  it("a grant acting as an agent uses the lower of the two levels", async () => {
    const p = await person();
    const agent = await agentIn(p.company.id, "manager");
    const caller = await callerFor(await connect(p, { accessLevel: "worker", actAsAgentId: agent.id }));
    expect(caller).toMatchObject({ kind: "oauth_agent", agentId: agent.id, userId: p.actor.userId });
    expect(caller.actor).toMatchObject({ type: "agent", source: "mcp_oauth", agentId: agent.id });
    expect(caller.access["labels:manage"]).toBe(false);
    const dispatch = createCatalogDispatch(api, caller);
    await expect(dispatch("POST", `/companies/${p.company.id}/labels`, { name: "x", color: "#000000" }))
      .rejects.toMatchObject({ status: 403, missingAction: "labels:manage" });
    // The routes' own checks see the capped access, not the agent's manager level.
    reached.length = 0;
    await dispatch("PATCH", `/issues/${randomUUID()}`, { title: "x" });
    expect(reached[0]!.access).toMatchObject({ "tasks:update_own": true, "tasks:update_any": false, "labels:manage": false });
    // Outside the connection's requests the agent is still a manager.
    expect((await loadAgentAccess(db, agent.id))["tasks:update_any"]).toBe(true);
  });

  it("consent can't act as an agent the person can't configure", async () => {
    const owner = await person();
    const elsewhere = await agentIn((await person()).company.id, "worker");
    await expect(connect(owner, { actAsAgentId: elsewhere.id })).rejects.toMatchObject({ code: "access_denied", status: 403 });
    const member = await person("member");
    const theirs = await agentIn(member.company.id, "worker");
    await expect(connect(member, { actAsAgentId: theirs.id })).rejects.toMatchObject({ status: 403 });
    const viewer = await person("viewer");
    await expect(connect(viewer, { accessLevel: "manager" })).rejects.toMatchObject({ status: 403 });
    // The consent screen offers only the agents the person may configure.
    const own = await agentIn(owner.company.id, "worker");
    const client = await oauth.register({ client_name: "M7 test client", redirect_uris: [redirectUri] }, randomUUID());
    const url = await oauth.authorize({ client_id: client.client_id, redirect_uri: redirectUri, resource: config.resource, scope: "paperclip:read", state: "s", response_type: "code", code_challenge: challenge, code_challenge_method: "S256", company_id: owner.company.id });
    const described = await oauth.describeRequest(url.split("/").at(-1)!, owner.actor, null);
    expect(described.companies).toEqual([expect.objectContaining({ id: owner.company.id, maxAccessLevel: "admin", actAsAgents: [{ id: own.id, name: own.name }] })]);
  });

  it("PATCH changes the level and the next call sees it", async () => {
    const p = await person();
    const token = await connect(p, {});
    const before = await callerFor(token);
    expect(before.access["projects:manage"]).toBe(true); // manager, the default
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.actor = p.actor; next(); });
    app.use("/api", publicMcpManagementRoutes(oauth));
    app.use(errorHandler);
    const [connection] = await oauth.listConnections(p.actor);
    expect(connection).toMatchObject({ actAsAgent: null, accessLevel: "manager", accessOverrides: {} });
    const response = await request(app).patch(`/api/mcp/connections/${connection!.id}`).set("Origin", config.origin)
      .send({ accessLevel: "worker", accessOverrides: { "tasks:delete": true } });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: connection!.id, accessLevel: "worker", accessOverrides: { "tasks:delete": true } });
    const after = await callerFor(token);
    expect(after.access["projects:manage"]).toBe(false);
    expect(after.access["tasks:delete"]).toBe(true);
    await expect(createCatalogDispatch(api, after)("POST", `/companies/${p.company.id}/labels`, {})).rejects.toMatchObject({ status: 403 });
    // Acting as an agent the person may configure, then back.
    const agent = await agentIn(p.company.id, "worker");
    expect((await request(app).patch(`/api/mcp/connections/${connection!.id}`).set("Origin", config.origin).send({ actAsAgentId: agent.id })).body)
      .toMatchObject({ actAsAgent: { id: agent.id, name: agent.name } });
    expect((await callerFor(token)).kind).toBe("oauth_agent");
    // Someone else's connection is not found, and the browser origin is required.
    const other = await person();
    const otherApp = express();
    otherApp.use(express.json());
    otherApp.use((req, _res, next) => { req.actor = other.actor; next(); });
    otherApp.use("/api", publicMcpManagementRoutes(oauth));
    expect((await request(otherApp).patch(`/api/mcp/connections/${connection!.id}`).set("Origin", config.origin).send({ accessLevel: "admin" })).status).toBe(404);
    expect((await request(app).patch(`/api/mcp/connections/${connection!.id}`).send({ accessLevel: "admin" })).status).toBe(403);
  });

  describe("file uploads through a connection acting as an agent", () => {
    // Storage is never reached before the upload link is issued; the sweep finds nothing to clean.
    const storage = {
      provider: "local_disk",
      putFile: async () => { throw new Error("not used"); },
      getObject: async () => { throw new Error("not used"); },
      headObject: async () => ({ exists: false }),
      deleteObject: async () => undefined,
    } as unknown as StorageService;
    // The public MCP reads the task through REST as the connection; a stand-in returns the row.
    const transfers = () => createPublicMcpTransfers(db, oauth, async (_p, _method, path) => {
      const [row] = await db.select().from(issues).where(eq(issues.id, path.split("/").at(-1)!));
      return row ?? null;
    }, storage);

    async function setup(agentLevel: AgentAccessLevel, connectionLevel: AgentAccessLevel, ownTask: boolean) {
      const p = await person();
      const agent = await agentIn(p.company.id, agentLevel);
      const other = await agentIn(p.company.id, "worker");
      const [task] = await db.insert(issues).values({
        companyId: p.company.id, title: "M7 test task", status: "todo", assigneeAgentId: ownTask ? agent.id : other.id,
      }).returning();
      const principal = await oauth.authenticate(await connect(p, { accessLevel: connectionLevel, actAsAgentId: agent.id }));
      expect(principal.actor).toMatchObject({ type: "agent", agentId: agent.id });
      const upload = (requestId = randomUUID()) => transfers().getUploadUrl(principal, {
        companyId: p.company.id, taskId: task!.id, requestId, filename: "notes.txt", contentType: "text/plain",
        byteSize: 5, sha256: createHash("sha256").update("hello").digest("hex"),
      });
      return { upload };
    }

    it("a manager connection acting as a read-only agent can't upload", async () => {
      const { upload } = await setup("read_only", "manager", true);
      await expect(upload()).rejects.toBeInstanceOf(McpCapabilityError);
    });

    it("a manager connection acting as a worker agent can upload to the agent's own task, not another's", async () => {
      const own = await setup("worker", "manager", true);
      await expect(own.upload()).resolves.toMatchObject({ method: "PUT", uploadId: expect.any(String) });
      const others = await setup("worker", "manager", false);
      await expect(others.upload()).rejects.toBeInstanceOf(McpCapabilityError);
    });

    it("a read-only connection acting as a manager agent can't upload", async () => {
      const { upload } = await setup("manager", "read_only", true);
      await expect(upload()).rejects.toBeInstanceOf(McpCapabilityError);
    });
  });

  it("an existing grant with no new consent fields keeps its backfilled level", async () => {
    const p = await person();
    const token = await connect(p, {});
    // Migration 0491 set existing grants' level from their consent; a configure grant became admin.
    const [grant] = await db.select().from(mcpOauthGrants).where(eq(mcpOauthGrants.userId, p.actor.userId!));
    await db.update(mcpOauthGrants).set({ accessLevel: "admin", accessOverrides: null, scopes: ["paperclip:read", "paperclip:write", "paperclip:configure"] })
      .where(eq(mcpOauthGrants.id, grant!.id));
    const caller = await callerFor(token);
    expect(caller.kind).toBe("oauth_person");
    for (const action of ["tasks:create", "tasks:update_any", "projects:manage", "agents:configure", "api:raw"] as const) {
      expect(caller.access[action]).toBe(true);
    }
    expect(caller.access["tasks:delete"]).toBe(false);
    // A grant without a stored level reads as read-only rather than guessing.
    await db.update(mcpOauthGrants).set({ accessLevel: null }).where(eq(mcpOauthGrants.id, grant!.id));
    expect((await callerFor(token)).access["tasks:create"]).toBe(false);
  });
});
