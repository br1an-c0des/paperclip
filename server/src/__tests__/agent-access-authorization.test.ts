import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  issues,
  principalPermissionGrants,
} from "@paperclipai/db";
import type { AgentAccess } from "@paperclipai/shared";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { authorizationService, type AuthorizationActor } from "../services/authorization.js";
import { grantTemporaryAccess, loadAgentAccess } from "../services/agent-access.js";
import { errorHandler } from "../middleware/error-handler.js";
import { accessRoutes } from "../routes/access.js";
import { agentPermissionGrantRoutes } from "../routes/agent-permission-grants.js";
import { agentRoutes } from "../routes/agents.js";

const support = await getEmbeddedPostgresTestSupport();
type TestDb = ReturnType<typeof createDb>;

let prefixCount = 0;
async function createCompany(db: TestDb) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const n = prefixCount++;
  return db.insert(companies).values({
    name: `Access ${n}`,
    issuePrefix: `AA${letters[Math.floor(n / 26) % 26]}${letters[n % 26]}`,
  }).returning().then(rows => rows[0]!);
}

async function createAgent(db: TestDb, companyId: string, input: {
  access?: AgentAccess; reportsTo?: string | null; role?: string; permissions?: Record<string, unknown>;
} = {}) {
  const [agent] = await db.insert(agents).values({
    companyId,
    name: `Agent ${randomUUID().slice(0, 8)}`,
    role: input.role ?? "engineer",
    reportsTo: input.reportsTo ?? null,
    permissions: { ...(input.permissions ?? {}), ...(input.access ? { access: input.access } : {}) },
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
  }).returning();
  await db.insert(companyMemberships).values({
    companyId, principalType: "agent", principalId: agent.id, status: "active", membershipRole: "member",
  });
  return agent!;
}

async function createIssue(db: TestDb, companyId: string, input: {
  parentId?: string | null; assigneeAgentId?: string | null; createdByAgentId?: string | null; status?: string;
} = {}) {
  const [issue] = await db.insert(issues).values({
    companyId,
    title: `Task ${randomUUID().slice(0, 8)}`,
    status: input.status ?? "todo",
    priority: "medium",
    parentId: input.parentId ?? null,
    assigneeAgentId: input.assigneeAgentId ?? null,
    createdByAgentId: input.createdByAgentId ?? null,
    originKind: "manual",
  }).returning();
  return issue!;
}

function agentActor(agent: { id: string; companyId: string }, runId: string | null = null): AuthorizationActor {
  return { type: "agent", agentId: agent.id, companyId: agent.companyId, runId, source: runId ? "agent_jwt" : "agent_key" };
}

function issueResource(issue: typeof issues.$inferSelect) {
  return {
    type: "issue" as const,
    companyId: issue.companyId,
    issueId: issue.id,
    projectId: issue.projectId,
    parentIssueId: issue.parentId,
    assigneeAgentId: issue.assigneeAgentId,
    assigneeUserId: issue.assigneeUserId,
    status: issue.status,
  };
}

describe.skipIf(!support.supported)("agent access in the authorization service", () => {
  let db!: TestDb;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-access-authz-");
    db = createDb(tempDb.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await tempDb?.cleanup();
  });

  it("a worker may change its own task but not another's", async () => {
    const company = await createCompany(db);
    const worker = await createAgent(db, company.id, { access: { level: "worker" } });
    const other = await createAgent(db, company.id, { access: { level: "manager" } });
    const authz = authorizationService(db);
    const mutate = (issue: typeof issues.$inferSelect) =>
      authz.decide({ actor: agentActor(worker), action: "issue:mutate", resource: issueResource(issue) });

    const assigned = await createIssue(db, company.id, { assigneeAgentId: worker.id });
    const created = await createIssue(db, company.id, { assigneeAgentId: other.id, createdByAgentId: worker.id });
    const below = await createIssue(db, company.id, { parentId: assigned.id, assigneeAgentId: other.id });
    const belowCreated = await createIssue(db, company.id, { parentId: created.id, assigneeAgentId: other.id });
    const othersTask = await createIssue(db, company.id, { assigneeAgentId: other.id });
    const unassigned = await createIssue(db, company.id);

    for (const own of [assigned, created, below, belowCreated]) {
      expect((await mutate(own)).allowed, own.title).toBe(true);
    }
    for (const notOwn of [othersTask, unassigned]) {
      const decision = await mutate(notOwn);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("access_level");
      expect(decision.missingAction).toBe("tasks:update_any");
    }
  });

  it("a worker manager's reports' tasks count as its own", async () => {
    const company = await createCompany(db);
    const lead = await createAgent(db, company.id, { access: { level: "worker" } });
    const report = await createAgent(db, company.id, { access: { level: "worker" }, reportsTo: lead.id });
    const reportsTask = await createIssue(db, company.id, { assigneeAgentId: report.id });
    const decision = await authorizationService(db).decide({
      actor: agentActor(lead), action: "issue:mutate", resource: issueResource(reportsTask),
    });
    expect(decision.allowed).toBe(true);
    // The other way round it isn't: a report doesn't own its manager's tasks.
    const leadsTask = await createIssue(db, company.id, { assigneeAgentId: lead.id });
    const denied = await authorizationService(db).decide({
      actor: agentActor(report), action: "issue:mutate", resource: issueResource(leadsTask),
    });
    expect(denied.reason).toBe("access_level");
  });

  it("a worker may assign a subtask of its own task to another agent", async () => {
    const company = await createCompany(db);
    const worker = await createAgent(db, company.id, { access: { level: "worker" } });
    const other = await createAgent(db, company.id, { access: { level: "worker" } });
    const authz = authorizationService(db);
    const own = await createIssue(db, company.id, { assigneeAgentId: worker.id });

    const newSubtask = await authz.decide({
      actor: agentActor(worker), action: "tasks:assign",
      resource: { type: "issue", companyId: company.id, parentIssueId: own.id, assigneeAgentId: other.id },
    });
    expect(newSubtask.allowed).toBe(true);

    const existingSubtask = await createIssue(db, company.id, { parentId: own.id, assigneeAgentId: worker.id });
    const reassign = await authz.decide({
      actor: agentActor(worker), action: "tasks:assign",
      resource: { ...issueResource(existingSubtask), assigneeAgentId: other.id },
    });
    expect(reassign.allowed).toBe(true);

    const handOff = await authz.decide({
      actor: agentActor(worker), action: "tasks:assign", resource: { ...issueResource(own), assigneeAgentId: other.id },
    });
    expect(handOff.allowed).toBe(true);

    const othersTask = await createIssue(db, company.id, { assigneeAgentId: other.id });
    const reassignOthers = await authz.decide({
      actor: agentActor(worker), action: "tasks:assign", resource: { ...issueResource(othersTask), assigneeAgentId: worker.id },
    });
    expect(reassignOthers.allowed).toBe(false);
    expect(reassignOthers.reason).toBe("access_level");
    expect(reassignOthers.missingAction).toBe("tasks:assign");

    const underOthers = await authz.decide({
      actor: agentActor(worker), action: "tasks:assign",
      resource: { type: "issue", companyId: company.id, parentIssueId: othersTask.id, assigneeAgentId: other.id },
    });
    expect(underOthers.reason).toBe("access_level");
  });

  it("a manager may change any visible task not locked by another run", async () => {
    const company = await createCompany(db);
    const manager = await createAgent(db, company.id, { access: { level: "manager" } });
    const other = await createAgent(db, company.id, { access: { level: "worker" } });
    const authz = authorizationService(db);
    const othersTask = await createIssue(db, company.id, { assigneeAgentId: other.id });
    const unassigned = await createIssue(db, company.id);
    for (const issue of [othersTask, unassigned]) {
      expect((await authz.decide({ actor: agentActor(manager), action: "issue:mutate", resource: issueResource(issue) })).allowed).toBe(true);
      expect((await authz.decide({ actor: agentActor(manager), action: "issue:comment", resource: issueResource(issue) })).allowed).toBe(true);
    }
    const assign = await authz.decide({
      actor: agentActor(manager), action: "tasks:assign", resource: { ...issueResource(othersTask), assigneeAgentId: manager.id },
    });
    expect(assign.allowed).toBe(true);
    for (const action of ["projects:manage", "labels:manage", "tasks:create", "requests:create"] as const) {
      expect((await authz.decide({ actor: agentActor(manager), action, resource: { type: "company", companyId: company.id } })).allowed, action).toBe(true);
    }
  });

  it("a denial for a missing action has reason access_level", async () => {
    const company = await createCompany(db);
    const worker = await createAgent(db, company.id, { access: { level: "worker" } });
    const readOnly = await createAgent(db, company.id, { access: { level: "read_only" } });
    const authz = authorizationService(db);
    const own = await createIssue(db, company.id, { assigneeAgentId: worker.id });

    const deleteOwn = await authz.decide({ actor: agentActor(worker), action: "tasks:delete", resource: issueResource(own) });
    expect(deleteOwn).toMatchObject({ allowed: false, reason: "access_level", missingAction: "tasks:delete" });
    const labels = await authz.decide({ actor: agentActor(worker), action: "labels:manage", resource: { type: "company", companyId: company.id } });
    expect(labels).toMatchObject({ allowed: false, reason: "access_level", missingAction: "labels:manage" });
    const comment = await authz.decide({ actor: agentActor(readOnly), action: "issue:comment", resource: issueResource(own) });
    expect(comment).toMatchObject({ allowed: false, reason: "access_level", missingAction: "tasks:comment" });
    const hire = await authz.decide({ actor: agentActor(worker), action: "agents:create", resource: { type: "company", companyId: company.id } });
    expect(hire).toMatchObject({ allowed: false, reason: "access_level", missingAction: "agents:create" });

    const deleter = await createAgent(db, company.id, { access: { level: "worker", overrides: { "tasks:delete": true } } });
    expect((await authz.decide({ actor: agentActor(deleter), action: "tasks:delete", resource: issueResource(own) })).allowed).toBe(true);
  });

  it("principal_permission_grants are no longer read for an agent's access actions", async () => {
    const company = await createCompany(db);
    const worker = await createAgent(db, company.id, { access: { level: "worker" }, role: "ceo", permissions: { canCreateAgents: true } });
    await db.insert(principalPermissionGrants).values([
      { companyId: company.id, principalType: "agent", principalId: worker.id, permissionKey: "tasks:assign", scope: null },
      { companyId: company.id, principalType: "agent", principalId: worker.id, permissionKey: "agents:create", scope: null },
    ]);
    const other = await createAgent(db, company.id);
    const othersTask = await createIssue(db, company.id, { assigneeAgentId: other.id });
    const authz = authorizationService(db);
    expect((await authz.decide({
      actor: agentActor(worker), action: "tasks:assign", resource: { ...issueResource(othersTask), assigneeAgentId: worker.id },
    })).reason).toBe("access_level");
    expect((await authz.decide({ actor: agentActor(worker), action: "agents:create", resource: { type: "company", companyId: company.id } })).reason)
      .toBe("access_level");
  });

  it("a worker's write to a new subtask is judged by its parent", async () => {
    const company = await createCompany(db);
    const worker = await createAgent(db, company.id, { access: { level: "worker" } });
    const other = await createAgent(db, company.id, { access: { level: "manager" } });
    const authz = authorizationService(db);
    const newChildOf = (parent: typeof issues.$inferSelect) => authz.decide({
      actor: agentActor(worker), action: "issue:mutate",
      resource: { type: "issue", companyId: company.id, parentIssueId: parent.id, assigneeAgentId: worker.id },
    });
    expect((await newChildOf(await createIssue(db, company.id, { assigneeAgentId: worker.id }))).allowed).toBe(true);
    expect(await newChildOf(await createIssue(db, company.id, { assigneeAgentId: other.id })))
      .toMatchObject({ allowed: false, reason: "access_level", missingAction: "tasks:update_any" });
  });

  it("a scoped override allows only inside its scope", async () => {
    const company = await createCompany(db);
    const peer = await createAgent(db, company.id);
    const outsider = await createAgent(db, company.id);
    const configurer = await createAgent(db, company.id, {
      access: { level: "worker", overrides: { "agents:configure": { scope: { agentIds: [peer.id] } } } },
    });
    const authz = authorizationService(db);
    const configure = (target: { id: string }) => authz.decide({
      actor: agentActor(configurer), action: "agent_config:update",
      resource: { type: "agent", companyId: company.id, agentId: target.id }, scope: { targetAgentId: target.id },
    });
    expect((await configure(peer)).allowed).toBe(true);
    expect(await configure(outsider)).toMatchObject({ allowed: false, reason: "deny_scope" });
    // Without a requested scope, a scoped override fails closed, as a scoped grant did.
    expect((await authz.decide({
      actor: agentActor(configurer), action: "agent_config:update",
      resource: { type: "agent", companyId: company.id, agentId: peer.id },
    })).allowed).toBe(false);
    const read = (target: { id: string }) => authz.decide({
      actor: agentActor(configurer), action: "agent_config:read",
      resource: { type: "agent", companyId: company.id, agentId: target.id }, scope: { targetAgentId: target.id },
    });
    expect((await read(peer)).allowed).toBe(true);
    expect((await read(outsider)).allowed).toBe(false);

    const assigner = await createAgent(db, company.id, {
      access: { level: "worker", overrides: { "tasks:assign": { scope: { agentIds: [peer.id] } } } },
    });
    const othersTask = await createIssue(db, company.id, { assigneeAgentId: outsider.id });
    const assign = (target: { id: string }) => authz.decide({
      actor: agentActor(assigner), action: "tasks:assign", resource: { ...issueResource(othersTask), assigneeAgentId: target.id },
    });
    expect((await assign(peer)).allowed).toBe(true);
    expect(await assign(assigner)).toMatchObject({ allowed: false, reason: "deny_scope" });
  });

  it("a temporary grant allows one call", async () => {
    const company = await createCompany(db);
    const worker = await createAgent(db, company.id, { access: { level: "worker" } });
    const own = await createIssue(db, company.id, { assigneeAgentId: worker.id });
    await grantTemporaryAccess(db, {
      companyId: company.id, principal: { type: "agent", id: worker.id }, action: "tasks:delete",
      resource: { type: "issue", id: own.id }, expiresAt: new Date(Date.now() + 60_000), reason: "approved request", usesLeft: 1,
    });
    const authz = authorizationService(db);
    const first = await authz.decide({ actor: agentActor(worker), action: "tasks:delete", resource: issueResource(own) });
    expect(first.allowed).toBe(true);
    const second = await authz.decide({ actor: agentActor(worker), action: "tasks:delete", resource: issueResource(own) });
    expect(second).toMatchObject({ allowed: false, reason: "access_level" });
  });

  describe("retiring the agent grants endpoints", () => {
    function appAs(actor: AuthorizationActor) {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.actor = actor as typeof req.actor;
        next();
      });
      app.use("/api", accessRoutes(db, {
        deploymentMode: "authenticated", deploymentExposure: "private", bindHost: "127.0.0.1", allowedHostnames: [],
      }));
      app.use("/api", agentPermissionGrantRoutes(db));
      app.use("/api", agentRoutes(db));
      app.use(errorHandler);
      return app;
    }
    const localBoard = (companyId: string): AuthorizationActor => ({
      type: "board", userId: "local-board", source: "local_implicit", companyIds: [companyId], isInstanceAdmin: true,
    });

    it("setting grants on an agent member is refused", async () => {
      const company = await createCompany(db);
      const agent = await createAgent(db, company.id, { access: { level: "worker" } });
      const [membership] = await db.select().from(companyMemberships).where(and(
        eq(companyMemberships.companyId, company.id), eq(companyMemberships.principalId, agent.id),
      ));
      const app = appAs(localBoard(company.id));
      const memberGrants = await request(app).patch(`/api/companies/${company.id}/members/${membership!.id}/permissions`)
        .send({ grants: [{ permissionKey: "tasks:assign" }] });
      expect(memberGrants.status, JSON.stringify(memberGrants.body)).toBe(410);
      expect(memberGrants.body.error).toMatch(/permissions\.access/);

      const assignGrant = await request(app).patch(`/api/agents/${agent.id}/permission-grants`)
        .send({ permissionKey: "tasks:assign", enabled: true });
      expect(assignGrant.status, JSON.stringify(assignGrant.body)).toBe(410);
      expect(await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.principalId, agent.id))).toHaveLength(0);
    });

    it("PATCH permissions with access saves it", async () => {
      const company = await createCompany(db);
      const agent = await createAgent(db, company.id, { access: { level: "worker" } });
      const app = appAs(localBoard(company.id));
      const saved = await request(app).patch(`/api/agents/${agent.id}/permissions`)
        .send({ access: { level: "admin", overrides: { "tasks:delete": true } } });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const access = await loadAgentAccess(db, agent.id);
      expect(access["api:raw"]).toBe(true);
      expect(access["tasks:delete"]).toBe(true);

      const invalid = await request(app).patch(`/api/agents/${agent.id}/permissions`).send({ access: { level: "owner" } });
      expect(invalid.status).toBe(400);

      // Once access is stored, the old hiring flag doesn't touch it (bug 46): a stale flag, as the
      // Advanced YAML used to send, can't undo the Access card.
      const hiring = await request(app).patch(`/api/agents/${agent.id}/permissions`).send({ canCreateAgents: false, canAssignTasks: true });
      expect(hiring.status, JSON.stringify(hiring.body)).toBe(200);
      expect((await loadAgentAccess(db, agent.id))["agents:create"]).toBe(true);
      expect((await loadAgentAccess(db, agent.id))["tasks:delete"]).toBe(true);
      const bothSent = await request(app).patch(`/api/agents/${agent.id}/permissions`)
        .send({ access: { level: "worker", overrides: { "agents:create": true } }, canCreateAgents: false });
      expect(bothSent.status, JSON.stringify(bothSent.body)).toBe(200);
      expect(await loadAgentAccess(db, agent.id)).toMatchObject({ "agents:create": true, "api:raw": false });

      // With no access stored, the flag still sets the agents:create override, at the default level.
      const legacy = await createAgent(db, company.id);
      const legacyHiring = await request(app).patch(`/api/agents/${legacy.id}/permissions`).send({ canCreateAgents: true, canAssignTasks: true });
      expect(legacyHiring.status, JSON.stringify(legacyHiring.body)).toBe(200);
      expect((await db.select().from(agents).where(eq(agents.id, legacy.id)))[0]!.permissions.access)
        .toEqual({ level: "worker", overrides: { "agents:create": true } });

      // A CEO's hiring denial still turns agents:create off, and is recorded.
      const hiringCeo = await createAgent(db, company.id, { role: "ceo", access: { level: "manager", overrides: { "agents:create": true } } });
      const denial = await request(app).patch(`/api/agents/${hiringCeo.id}/permissions`).send({ canCreateAgents: false, canAssignTasks: true });
      expect(denial.status, JSON.stringify(denial.body)).toBe(200);
      expect((await loadAgentAccess(db, hiringCeo.id))["agents:create"]).toBe(false);
      expect((await db.select().from(agents).where(eq(agents.id, hiringCeo.id)))[0]!.permissions)
        .toMatchObject({ canCreateAgents: false, ceoHiringDeniedBy: expect.objectContaining({ at: expect.any(String) }) });

      // An agent can't set access, not even a CEO.
      const ceo = await createAgent(db, company.id, { role: "ceo", access: { level: "admin" } });
      const byAgent = await request(appAs(agentActor(ceo))).patch(`/api/agents/${agent.id}/permissions`)
        .send({ access: { level: "admin" } });
      expect(byAgent.status).toBe(403);
    });
  });

  it("people are unaffected: board members keep their task actions", async () => {
    const company = await createCompany(db);
    const authz = authorizationService(db);
    const userId = `user-${randomUUID()}`;
    await db.insert(companyMemberships).values({
      companyId: company.id, principalType: "user", principalId: userId, status: "active", membershipRole: "operator",
    });
    const issue = await createIssue(db, company.id);
    const actor: AuthorizationActor = { type: "board", userId, source: "session", companyIds: [company.id] };
    for (const action of ["tasks:delete", "labels:manage", "tasks:update_any", "projects:manage"] as const) {
      expect((await authz.decide({ actor, action, resource: issueResource(issue) })).allowed, action).toBe(true);
    }
  });
});
