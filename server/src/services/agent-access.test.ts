import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@paperclipai/db";
import { resolveAgentAccess } from "@paperclipai/shared";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { loadAgentAccess } from "./agent-access.js";

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
});
