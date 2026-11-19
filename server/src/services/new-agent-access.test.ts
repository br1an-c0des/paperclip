import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, approvals, companies, createDb } from "@paperclipai/db";
import { LOW_TRUST_REVIEW_PRESET, resolveAgentAccess } from "@paperclipai/shared";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { loadAgentAccess, newAgentAccess, withStoredAccess } from "./agent-access.js";
import { createAgentLifecycle } from "./agent-lifecycle.js";

const hiring = { "agents:create": true } as const;

describe("newAgentAccess", () => {
  const person = (role: string, requestedPermissions: unknown) => newAgentAccess({ role, requestedPermissions, explicitAllowed: true });

  it("a new CEO starts at manager with agents:create", () => {
    expect(person("ceo", {})).toEqual({ level: "manager", overrides: hiring });
    expect(person("ceo", undefined)).toEqual({ level: "manager", overrides: hiring });
    // A plain false on a CEO isn't a hiring restriction (only a recorded denial is).
    expect(person("ceo", { canCreateAgents: false })).toEqual({ level: "manager", overrides: hiring });
  });

  it("a low-trust CEO starts at manager without hiring unless hiring was asked for", () => {
    expect(person("ceo", { trustPreset: LOW_TRUST_REVIEW_PRESET })).toEqual({ level: "manager" });
    expect(person("ceo", { trustPreset: LOW_TRUST_REVIEW_PRESET, canCreateAgents: true })).toEqual({ level: "manager", overrides: hiring });
  });

  it("canCreateAgents: true adds agents:create at the default level; otherwise nothing is stored", () => {
    expect(person("engineer", { canCreateAgents: true })).toEqual({ level: "worker", overrides: hiring });
    expect(person("engineer", {})).toBeNull();
    expect(person("engineer", { canCreateAgents: false })).toBeNull();
    expect(person("general", null)).toBeNull();
  });

  it("keeps a person's explicit access as given", () => {
    expect(person("ceo", { access: { level: "worker" } })).toEqual({ level: "worker" });
    expect(person("engineer", { canCreateAgents: true, access: { level: "read_only" } })).toEqual({ level: "read_only" });
    expect(() => person("engineer", { access: { level: "owner" } })).toThrow(/access level/);
  });

  it("drops an agent creator's access and applies the rule", () => {
    const byAgent = (role: string, requestedPermissions: unknown) => newAgentAccess({ role, requestedPermissions, explicitAllowed: false });
    expect(byAgent("engineer", { access: { level: "admin" } })).toBeNull();
    expect(byAgent("engineer", { access: { level: "admin" }, canCreateAgents: true })).toEqual({ level: "worker", overrides: hiring });
    expect(byAgent("ceo", { access: { level: "admin" } })).toEqual({ level: "manager", overrides: hiring });
    // Invalid access from an agent is ignored, not an error.
    expect(byAgent("engineer", { access: { level: "owner" } })).toBeNull();
  });

  it("withStoredAccess sets or removes access", () => {
    expect(withStoredAccess({ canCreateAgents: true, access: { level: "admin" } }, null)).toEqual({ canCreateAgents: true });
    expect(withStoredAccess({ canCreateAgents: true }, { level: "manager" })).toEqual({ canCreateAgents: true, access: { level: "manager" } });
  });
});

const support = await getEmbeddedPostgresTestSupport();

describe.skipIf(!support.supported)("new agents' access through hiring", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId = "";
  let creatorAgentId = "";
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-new-agent-access-");
    db = createDb(tempDb.connectionString);
    const [company] = await db.insert(companies).values({ name: "Hiring", issuePrefix: "HIR" }).returning();
    companyId = company.id;
    const [creator] = await db.insert(agents).values({
      companyId, name: "Hiring manager", role: "ceo",
      permissions: { canCreateAgents: true, access: { level: "manager", overrides: hiring } },
    }).returning();
    creatorAgentId = creator.id;
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await tempDb?.cleanup();
  });

  const hire = (name: string, role: string, permissions: Record<string, unknown>, options?: { byAgent?: boolean; pending?: boolean }) =>
    createAgentLifecycle(db).requestHire(companyId, {
      name, role, adapterType: "process", adapterConfig: {}, runtimeConfig: {}, permissions,
      ...(options?.pending ? { status: "pending_approval" } : {}),
    }, options?.byAgent ? { createdByAgentId: creatorAgentId } : undefined);

  const storedAccess = async (agentId: string) => {
    const [row] = await db.select({ permissions: agents.permissions }).from(agents).where(eq(agents.id, agentId));
    return (row?.permissions as Record<string, unknown> | null)?.access;
  };

  it("a CEO starts at manager and can hire; a plain agent at worker; canCreateAgents adds hiring", async () => {
    const ceo = await hire("New CEO", "ceo", {});
    expect(await storedAccess(ceo.id)).toEqual({ level: "manager", overrides: hiring });
    expect(await loadAgentAccess(db, ceo.id)).toEqual(resolveAgentAccess({ level: "manager", overrides: hiring }));

    const plain = await hire("Plain engineer", "engineer", {});
    expect(await storedAccess(plain.id)).toBeUndefined();
    expect((await loadAgentAccess(db, plain.id))["agents:create"]).toBe(false);

    const recruiter = await hire("Recruiter", "engineer", { canCreateAgents: true }, { byAgent: true });
    expect(await storedAccess(recruiter.id)).toEqual({ level: "worker", overrides: hiring });
    expect((await loadAgentAccess(db, recruiter.id))["agents:create"]).toBe(true);
  });

  it("a person's explicit access is kept; an agent's is dropped", async () => {
    const chosen = await hire("Chosen", "ceo", { access: { level: "worker" } });
    expect(await storedAccess(chosen.id)).toEqual({ level: "worker" });

    const escalated = await hire("Escalated", "engineer", { access: { level: "admin" } }, { byAgent: true });
    expect(await storedAccess(escalated.id)).toBeUndefined();
    expect((await loadAgentAccess(db, escalated.id))["api:raw"]).toBe(false);
  });

  it("approving a pending hire keeps the access set at creation and ignores the payload's", async () => {
    const pending = await hire("Pending CEO", "ceo", {}, { byAgent: true, pending: true });
    expect(await storedAccess(pending.id)).toEqual({ level: "manager", overrides: hiring });
    const [approval] = await db.insert(approvals).values({
      companyId, type: "hire_agent", requestedByAgentId: creatorAgentId,
      payload: { agentId: pending.id, name: "Pending CEO", role: "ceo", permissions: { access: { level: "admin" } } },
    }).returning();
    await createAgentLifecycle(db).approveHire({ approvalId: approval.id });
    expect(await storedAccess(pending.id)).toEqual({ level: "manager", overrides: hiring });
  });

  it("approving a pending hire without stored access applies the rule to the approved request", async () => {
    const pending = await hire("Pending engineer", "engineer", {}, { byAgent: true, pending: true });
    expect(await storedAccess(pending.id)).toBeUndefined();
    const [approval] = await db.insert(approvals).values({
      companyId, type: "hire_agent", requestedByAgentId: creatorAgentId,
      payload: { agentId: pending.id, name: "Pending engineer", role: "engineer", permissions: { canCreateAgents: true, access: { level: "admin" } } },
    }).returning();
    await createAgentLifecycle(db).approveHire({ approvalId: approval.id });
    expect(await storedAccess(pending.id)).toEqual({ level: "worker", overrides: hiring });
  });
});
