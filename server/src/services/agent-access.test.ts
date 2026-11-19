import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@paperclipai/db";
import { resolveAgentAccess } from "@paperclipai/shared";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { consumeTemporaryAccess, grantTemporaryAccess, loadAgentAccess } from "./agent-access.js";

const support = await getEmbeddedPostgresTestSupport();

describe.skipIf(!support.supported)("loadAgentAccess", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-access-");
    db = createDb(tempDb.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await tempDb?.cleanup();
  });

  it("loads worker for an agent without access, and the stored level otherwise", async () => {
    const [company] = await db.insert(companies).values({ name: "Access", issuePrefix: "ACC" }).returning();
    const [plain] = await db.insert(agents).values({ companyId: company.id, name: "Plain" }).returning();
    const [admin] = await db.insert(agents).values({
      companyId: company.id,
      name: "Admin",
      permissions: { canCreateAgents: false, access: { level: "admin", overrides: { "tasks:delete": true } } },
    }).returning();
    const [broken] = await db.insert(agents).values({
      companyId: company.id,
      name: "Broken",
      permissions: { access: { level: "owner" } },
    }).returning();

    expect(await loadAgentAccess(db, plain.id)).toEqual(resolveAgentAccess({ level: "worker" }));
    const adminAccess = await loadAgentAccess(db, admin.id);
    expect(adminAccess).toEqual(resolveAgentAccess({ level: "admin", overrides: { "tasks:delete": true } }));
    expect(adminAccess["api:raw"]).toBe(true);
    expect(adminAccess["tasks:delete"]).toBe(true);
    // A stored value that doesn't parse falls back to the default level, never something wider.
    expect(await loadAgentAccess(db, broken.id)).toEqual(resolveAgentAccess({ level: "worker" }));
    await expect(loadAgentAccess(db, randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  describe("temporary grants", () => {
    let companyCount = 0;
    async function setup() {
      const issuePrefix = `GR${"ABCDEFGHIJ"[companyCount++]}`;
      const [company] = await db.insert(companies).values({ name: "Grants", issuePrefix }).returning();
      const [agent] = await db.insert(agents).values({ companyId: company.id, name: "Worker" }).returning();
      const principal = { type: "agent" as const, id: agent.id };
      return { company, agent, principal };
    }
    const hour = () => new Date(Date.now() + 60 * 60 * 1000);

    it("a grant allows its action on its resource only", async () => {
      const { company, principal } = await setup();
      const issueId = randomUUID();
      const { id } = await grantTemporaryAccess(db, {
        companyId: company.id, principal, action: "tasks:delete",
        resource: { type: "issue", id: issueId }, expiresAt: hour(), reason: "test",
      });
      expect(id).toBeTruthy();
      const base = { companyId: company.id, principal };
      expect(await consumeTemporaryAccess(db, { ...base, action: "tasks:delete", resource: { type: "issue", id: issueId } })).toBe(true);
      // A standing grant (no uses_left) keeps working until it expires.
      expect(await consumeTemporaryAccess(db, { ...base, action: "tasks:delete", resource: { type: "issue", id: issueId } })).toBe(true);
      expect(await consumeTemporaryAccess(db, { ...base, action: "tasks:delete", resource: { type: "issue", id: randomUUID() } })).toBe(false);
      expect(await consumeTemporaryAccess(db, { ...base, action: "tasks:update_any", resource: { type: "issue", id: issueId } })).toBe(false);
      expect(await consumeTemporaryAccess(db, {
        ...base, principal: { type: "agent", id: randomUUID() }, action: "tasks:delete", resource: { type: "issue", id: issueId },
      })).toBe(false);
      expect(await consumeTemporaryAccess(db, { ...base, action: "tasks:delete", resource: { type: "project", id: issueId } })).toBe(false);
    });

    it("a company-wide grant covers every resource in its company and widens the loaded access", async () => {
      const { company, agent, principal } = await setup();
      await grantTemporaryAccess(db, {
        companyId: company.id, principal, action: "labels:manage",
        resource: { type: "company", id: company.id }, expiresAt: hour(), reason: "watch",
      });
      expect(await consumeTemporaryAccess(db, {
        companyId: company.id, principal, action: "labels:manage", resource: { type: "issue", id: randomUUID() },
      })).toBe(true);
      const access = await loadAgentAccess(db, agent.id);
      expect(access["labels:manage"]).toBe(true);
      expect(access["tasks:update_any"]).toBe(false);
    });

    it("an expired grant is ignored", async () => {
      const { company, agent, principal } = await setup();
      const issueId = randomUUID();
      await grantTemporaryAccess(db, {
        companyId: company.id, principal, action: "tasks:delete",
        resource: { type: "issue", id: issueId }, expiresAt: new Date(Date.now() - 1000), reason: "old",
      });
      await grantTemporaryAccess(db, {
        companyId: company.id, principal, action: "labels:manage",
        resource: { type: "company", id: company.id }, expiresAt: new Date(Date.now() - 1000), reason: "old",
      });
      expect(await consumeTemporaryAccess(db, {
        companyId: company.id, principal, action: "tasks:delete", resource: { type: "issue", id: issueId },
      })).toBe(false);
      expect((await loadAgentAccess(db, agent.id))["labels:manage"]).toBe(false);
    });

    it("a one-use grant is consumed once", async () => {
      const { company, agent, principal } = await setup();
      const issueId = randomUUID();
      await grantTemporaryAccess(db, {
        companyId: company.id, principal, action: "tasks:delete",
        resource: { type: "issue", id: issueId }, expiresAt: hour(), reason: "approved request", usesLeft: 1,
      });
      // A one-use grant is for one replayed call, so it never widens the standing access.
      expect((await loadAgentAccess(db, agent.id))["tasks:delete"]).toBe(false);
      const input = { companyId: company.id, principal, action: "tasks:delete" as const, resource: { type: "issue" as const, id: issueId } };
      const results = await Promise.all([consumeTemporaryAccess(db, input), consumeTemporaryAccess(db, input)]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await consumeTemporaryAccess(db, input)).toBe(false);
    });
  });
});
