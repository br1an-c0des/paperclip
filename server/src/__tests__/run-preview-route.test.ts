import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { agentApiKeys, agents, authUsers, companies, companyMemberships, createDb, projects } from "@paperclipai/db";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { agentRoutes } from "../routes/agents.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// Step 4b part 2: GET /api/agents/:id/run-preview is for the board, behind the agent read's
// company check, and the project must be the agent's company's.

const support = await getEmbeddedPostgresTestSupport();

(support.supported ? describe : describe.skip)("GET /api/agents/:id/run-preview", () => {
  it("answers the board, refuses an agent key, and keeps the project in the agent's company", async () => {
    const database = await startEmbeddedPostgresTestDatabase("run-preview-route-");
    const db = createDb(database.connectionString);
    const previousHome = process.env.PAPERCLIP_HOME;
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "run-preview-route-home-"));
    process.env.PAPERCLIP_HOME = home;
    try {
      const companyId = randomUUID(), otherCompanyId = randomUUID(), agentId = randomUUID(), callerId = randomUUID();
      const userId = randomUUID(), otherProjectId = randomUUID();
      const token = randomUUID();
      await db.insert(companies).values([
        { id: companyId, name: "M7 test preview route", issuePrefix: "PRA" },
        { id: otherCompanyId, name: "M7 test other", issuePrefix: "PRB" },
      ]);
      await db.insert(authUsers).values({ id: userId, name: "Owner", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
      await db.insert(companyMemberships).values([
        { companyId, principalType: "user", principalId: userId, membershipRole: "owner" },
        { companyId, principalType: "agent", principalId: callerId, membershipRole: "member" },
      ]);
      await db.insert(agents).values([
        { id: agentId, companyId, name: "M7 test previewed", adapterType: "claude_local", adapterConfig: { engine: "cli", env: {} } },
        { id: callerId, companyId, name: "M7 test caller" },
      ]);
      await db.insert(projects).values({ id: otherProjectId, companyId: otherCompanyId, name: "Elsewhere", status: "in_progress" });
      await db.insert(agentApiKeys).values({ companyId, agentId: callerId, name: "Caller", responsibleUserId: userId,
        keyHash: createHash("sha256").update(token).digest("hex") });

      const board = express();
      board.use(express.json());
      board.use(actorMiddleware(db, { deploymentMode: "local_trusted" }));
      board.use("/api", agentRoutes(db));
      board.use(errorHandler);

      const read = await request(board).get(`/api/agents/${agentId}/run-preview`);
      expect(read.status).toBe(200);
      expect(read.body).toMatchObject({ supported: true, project: null });
      expect(read.body.blockers.map((blocker: { code: string }) => blocker.code)).toContain("claude_credential_missing");

      expect((await request(board).get(`/api/agents/${agentId}/run-preview?projectId=${otherProjectId}`)).status).toBe(404);
      expect((await request(board).get(`/api/agents/${randomUUID()}/run-preview`)).status).toBe(404);

      const agentApp = express();
      agentApp.use(express.json());
      agentApp.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
      agentApp.use("/api", agentRoutes(db));
      agentApp.use(errorHandler);
      const asAgent = await request(agentApp).get(`/api/agents/${agentId}/run-preview`).set("Authorization", `Bearer ${token}`);
      expect(asAgent.status).toBe(403);
    } finally {
      if (previousHome === undefined) delete process.env.PAPERCLIP_HOME;
      else process.env.PAPERCLIP_HOME = previousHome;
      await fs.rm(home, { recursive: true, force: true });
      await db.$client.end();
      await database.cleanup();
    }
  }, 120_000);
});
