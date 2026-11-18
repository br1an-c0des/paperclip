import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  authUsers,
  companies,
  companyMemberships,
  createDb,
  issues,
  mcpOauthClients,
  mcpOauthGrants,
  principalPermissionGrants,
} from "@paperclipai/db";
import { hasAgentAccess, resolveAgentAccess } from "@paperclipai/shared";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { loadAgentAccess } from "../services/agent-access.js";
import { authorizationService, type AuthorizationActor } from "../services/authorization.js";
import { agentRouteRequirement } from "../middleware/agent-route-policy-table.js";

const MIGRATION = fileURLToPath(new URL("../../../packages/db/src/migrations/0491_agent_access.sql", import.meta.url));
const CARRY_OVER_MARKER = "-- Carry over today's access";

/**
 * The data half of migration 0491. The test database has already applied it (to no rows), so the
 * test inserts agents and grants as they exist before the migration and runs the carry-over again:
 * its statements only touch rows that have no access yet.
 */
function carryOverStatements() {
  const text = readFileSync(MIGRATION, "utf8");
  const start = text.indexOf(CARRY_OVER_MARKER);
  expect(start, "0491 has a carry-over section").toBeGreaterThan(0);
  return text.slice(start).split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
}

const support = await getEmbeddedPostgresTestSupport();

describe.skipIf(!support.supported)("migration 0491: carrying over today's access", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId = "";

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-access-migration-");
    db = createDb(tempDb.connectionString);
    const [company] = await db.insert(companies).values({ name: "Carry over", issuePrefix: "COV" }).returning();
    companyId = company!.id;
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await tempDb?.cleanup();
  });

  async function legacyAgent(input: { role?: string; permissions?: Record<string, unknown> } = {}) {
    const [agent] = await db.insert(agents).values({
      companyId, name: `Legacy ${randomUUID().slice(0, 8)}`, role: input.role ?? "engineer",
      adapterType: "process", permissions: input.permissions ?? {},
    }).returning();
    await db.insert(companyMemberships).values({
      companyId, principalType: "agent", principalId: agent!.id, status: "active", membershipRole: "member",
    });
    return agent!;
  }

  async function grant(agentId: string, permissionKey: string, scope: Record<string, unknown> | null = null) {
    await db.insert(principalPermissionGrants).values({ companyId, principalType: "agent", principalId: agentId, permissionKey, scope });
  }

  async function migrate() {
    for (const statement of carryOverStatements()) await db.execute(sql.raw(statement));
  }

  async function accessOf(agentId: string) {
    const [row] = await db.select({ permissions: agents.permissions }).from(agents).where(eq(agents.id, agentId));
    return row!.permissions.access as { level: string; overrides?: Record<string, unknown> } | undefined;
  }

  it("an existing agent becomes manager", async () => {
    const plain = await legacyAgent({ permissions: { canCreateAgents: false, canCreateSkills: true } });
    const alreadyMigrated = await legacyAgent({ permissions: { access: { level: "worker" } } });
    await migrate();
    expect(await accessOf(plain.id)).toEqual({ level: "manager", overrides: {} });
    const [row] = await db.select({ permissions: agents.permissions }).from(agents).where(eq(agents.id, plain.id));
    expect(row!.permissions).toMatchObject({ canCreateAgents: false, canCreateSkills: true });
    expect(await accessOf(alreadyMigrated.id)).toEqual({ level: "worker" });
    // Running it twice changes nothing.
    await migrate();
    expect(await accessOf(plain.id)).toEqual({ level: "manager", overrides: {} });
  });

  it("canCreateAgents carries over", async () => {
    const hirer = await legacyAgent({ permissions: { canCreateAgents: true } });
    const ceo = await legacyAgent({ role: "ceo", permissions: {} });
    const deniedCeo = await legacyAgent({
      role: "ceo",
      permissions: { canCreateAgents: false, ceoHiringDeniedBy: { actorType: "user", actorId: "u", at: "2026-01-01T00:00:00.000Z" } },
    });
    // A false saved on a CEO without a board-recorded denial kept hiring (stale saves, imports).
    const unrecordedFalseCeo = await legacyAgent({ role: "ceo", permissions: { canCreateAgents: false } });
    const unflagged = await legacyAgent({ permissions: {} });
    const lowTrustCeo = await legacyAgent({ role: "ceo", permissions: { trustPreset: "low_trust_review" } });
    const restricted = await legacyAgent({
      permissions: { interactions: { canEditOtherTasks: false, canAssignTasksToHumans: false, canConfigureOtherAgents: false, canMentionAgents: false } },
    });
    await migrate();
    expect((await accessOf(hirer.id))?.overrides).toEqual({ "agents:create": true });
    expect((await accessOf(ceo.id))?.overrides).toEqual({ "agents:create": true });
    expect((await accessOf(deniedCeo.id))?.overrides).toEqual({});
    expect((await accessOf(unrecordedFalseCeo.id))?.overrides).toEqual({ "agents:create": true });
    expect((await accessOf(unflagged.id))?.overrides).toEqual({});
    expect((await accessOf(lowTrustCeo.id))?.overrides).toEqual({});
    // canMentionAgents and canCommentOnOtherTasks have no matching action and stay as switches.
    expect((await accessOf(restricted.id))?.overrides).toEqual({
      "tasks:update_any": false, "tasks:assign": false, "agents:configure": false,
    });
  });

  it("a scoped grant carries over with its scope", async () => {
    const scoped = await legacyAgent();
    await grant(scoped.id, "tasks:assign_scope", { subtreeRootAgentId: scoped.id });
    await grant(scoped.id, "agents:configure");
    await grant(scoped.id, "tools:use");
    const broad = await legacyAgent();
    await grant(broad.id, "tasks:assign");
    await grant(broad.id, "tasks:assign_scope", { projectIds: ["p"] });
    await grant(broad.id, "agents:create");
    const switchedOff = await legacyAgent({ permissions: { interactions: { canAssignTasksToAgents: false } } });
    await grant(switchedOff.id, "tasks:assign");
    await migrate();
    expect((await accessOf(scoped.id))?.overrides).toEqual({
      "tasks:assign": { scope: { subtreeRootAgentId: scoped.id } }, "agents:configure": true,
    });
    expect((await accessOf(broad.id))?.overrides).toEqual({ "tasks:assign": true, "agents:create": true });
    expect((await accessOf(switchedOff.id))?.overrides).toEqual({ "tasks:assign": false });
    // Grants without a matching action stay where they are and keep working.
    expect(await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.principalId, scoped.id))).toHaveLength(3);
  });

  it("an existing agent that edits a visible task, assigns a subtask and creates a project still can", async () => {
    const legacy = await legacyAgent();
    const peer = await legacyAgent();
    await migrate();
    const access = await loadAgentAccess(db, legacy.id);
    expect(access).toEqual(resolveAgentAccess({ level: "manager" }));
    const actor: AuthorizationActor = { type: "agent", agentId: legacy.id, companyId, source: "agent_key" };
    const authz = authorizationService(db);
    const [peersTask] = await db.insert(issues).values({
      companyId, title: "Peer's idle task", status: "todo", priority: "medium", assigneeAgentId: peer.id, originKind: "manual",
    }).returning();
    const resource = {
      type: "issue" as const, companyId, issueId: peersTask!.id, projectId: null, parentIssueId: null,
      assigneeAgentId: peer.id, assigneeUserId: null, status: "todo",
    };
    expect((await authz.decide({ actor, action: "issue:mutate", resource })).allowed).toBe(true);
    expect((await authz.decide({ actor, action: "issue:comment", resource })).allowed).toBe(true);
    expect((await authz.decide({
      actor, action: "tasks:assign",
      resource: { type: "issue", companyId, parentIssueId: peersTask!.id, assigneeAgentId: peer.id },
    })).allowed).toBe(true);
    expect((await authz.decide({ actor, action: "tasks:assign", resource: { ...resource, assigneeAgentId: legacy.id } })).allowed).toBe(true);
    expect((await authz.decide({ actor, action: "projects:manage", resource: { type: "company", companyId } })).allowed).toBe(true);
    for (const [method, path] of [
      ["POST", `/companies/${companyId}/projects`],
      ["PATCH", `/issues/${peersTask!.id}`],
      ["POST", `/companies/${companyId}/issues`],
      ["POST", `/companies/${companyId}/labels`],
      ["POST", `/companies/${companyId}/routines`],
    ] as const) {
      expect(hasAgentAccess(access, agentRouteRequirement(method, path).actions), `${method} ${path}`).toBe(true);
    }
  });

  it("oauth grants get a level from their scopes", async () => {
    const userId = `user-${randomUUID()}`;
    await db.insert(authUsers).values({ id: userId, name: "Person", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    const clientId = `client-${randomUUID()}`;
    await db.insert(mcpOauthClients).values({ id: clientId, name: "Claude Code", redirectUris: ["http://localhost/cb"] });
    const grantFor = async (scopes: string[]) => {
      const [row] = await db.insert(mcpOauthGrants).values({ companyId, userId, clientId, resource: "https://paperclip.test/mcp", scopes }).returning();
      return row!.id;
    };
    const configure = await grantFor(["paperclip:read", "paperclip:write", "paperclip:configure"]);
    const write = await grantFor(["paperclip:read", "paperclip:write"]);
    const read = await grantFor(["paperclip:read"]);
    await migrate();
    const levels = Object.fromEntries((await db.select({ id: mcpOauthGrants.id, level: mcpOauthGrants.accessLevel }).from(mcpOauthGrants))
      .map((row) => [row.id, row.level]));
    expect(levels[configure]).toBe("admin");
    expect(levels[write]).toBe("manager");
    expect(levels[read]).toBe("read_only");
  });
});
