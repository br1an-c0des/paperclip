import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb } from "@paperclipai/db";
import type { AgentAccess } from "@paperclipai/shared";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { buildOpenApiDocument } from "../routes/openapi.js";
import { AGENT_ROUTE_POLICY, matchAgentRoutePolicy } from "../middleware/agent-route-policy-table.js";
import { agentRoutePolicy } from "../middleware/agent-route-policy.js";
import { grantTemporaryAccess } from "../services/agent-access.js";
import type { AuthorizationActor } from "../services/authorization.js";

const WRITE_METHODS = ["post", "patch", "put", "delete"] as const;

describe("the agent route policy table", () => {
  it("every write route in the OpenAPI document is tagged", () => {
    const document = buildOpenApiDocument();
    const missing: string[] = [];
    let checked = 0;
    for (const [path, item] of Object.entries(document.paths as Record<string, Record<string, unknown>>)) {
      // The route policy guards the API router under /api; the few documented paths outside it
      // (the run-bound runtime tools and gateway ingress) have their own credentials.
      if (!path.startsWith("/api/")) continue;
      const expressPath = path.slice("/api".length).replace(/\{([^}]+)\}/g, ":$1");
      for (const method of WRITE_METHODS) {
        if (!item[method]) continue;
        checked += 1;
        const match = matchAgentRoutePolicy(method, expressPath);
        const samePattern = match && normalize(match.entry.path) === normalize(expressPath);
        if (!samePattern) missing.push(`${method.toUpperCase()} ${expressPath}`);
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect(missing).toEqual([]);
  });

  it("lists each route once", () => {
    const keys = AGENT_ROUTE_POLICY.map((entry) => `${entry.method} ${normalize(entry.path)}`);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("prefers the most specific pattern", () => {
    expect(matchAgentRoutePolicy("DELETE", "/issues/abc")?.entry.action).toBe("tasks:delete");
    expect(matchAgentRoutePolicy("POST", "/issues/abc/read")?.entry.action).toBe("tasks:read");
    expect(matchAgentRoutePolicy("POST", "/issues/abc/comments")?.entry.action).toBe("route_checks");
    expect(matchAgentRoutePolicy("POST", "/nothing/here")).toBeNull();
  });
});

function normalize(path: string) {
  return path.replace(/:[A-Za-z0-9_]+/g, ":");
}

const support = await getEmbeddedPostgresTestSupport();

describe.skipIf(!support.supported)("agentRoutePolicy", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId = "";
  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-agent-route-policy-");
    db = createDb(tempDb.connectionString);
    const [company] = await db.insert(companies).values({ name: "Policy", issuePrefix: "POL" }).returning();
    companyId = company!.id;
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await tempDb?.cleanup();
  });

  async function agentWith(access: AgentAccess) {
    const [agent] = await db.insert(agents).values({
      companyId, name: `Agent ${randomUUID().slice(0, 8)}`, permissions: { access },
    }).returning();
    return agent!;
  }

  function appFor(actor: AuthorizationActor) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor as typeof req.actor;
      next();
    });
    const api = express.Router();
    api.use(agentRoutePolicy(db));
    api.all("/{*rest}", (_req, res) => {
      res.json({ reached: true });
    });
    app.use("/api", api);
    return app;
  }

  function runActor(agent: { id: string }): AuthorizationActor {
    return { type: "agent", agentId: agent.id, companyId, runId: randomUUID(), source: "agent_jwt" };
  }

  it("an untagged write needs api:raw", async () => {
    const manager = await agentWith({ level: "manager" });
    const denied = await request(appFor(runActor(manager))).post("/api/not-a-documented-route").send({});
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({
      error: expect.any(String), code: "access_denied", missingAction: "api:raw", requestable: true,
    });
    const configuration = await request(appFor(runActor(manager))).patch(`/api/companies/${companyId}/budgets`).send({});
    expect(configuration.status).toBe(403);
    expect(configuration.body.missingAction).toBe("api:raw");

    const admin = await agentWith({ level: "admin" });
    const allowed = await request(appFor(runActor(admin))).post("/api/not-a-documented-route").send({});
    expect(allowed.status).toBe(200);
  });

  it("a worker run may update its checked-out task, comment and write its documents", async () => {
    const worker = await agentWith({ level: "worker" });
    const app = appFor(runActor(worker));
    const issueId = randomUUID();
    const calls = [
      request(app).patch(`/api/issues/${issueId}`).send({ status: "done" }),
      request(app).post(`/api/issues/${issueId}/comments`).send({ body: "Done." }),
      request(app).put(`/api/issues/${issueId}/documents/plan`).send({ body: "# Plan" }),
      request(app).post(`/api/issues/${issueId}/checkout`).send({}),
      request(app).post(`/api/issues/${issueId}/release`).send({}),
      request(app).post(`/api/issues/${issueId}/interactions`).send({}),
      request(app).post(`/api/companies/${companyId}/issues`).send({ title: "Subtask" }),
      request(app).post(`/api/companies/${companyId}/approvals`).send({}),
      request(app).get(`/api/issues/${issueId}`),
    ];
    for (const response of await Promise.all(calls)) {
      expect(response.status, `${response.req.method} ${response.req.path}`).toBe(200);
    }
    const project = await request(app).post(`/api/companies/${companyId}/projects`).send({ name: "Nope" });
    expect(project.status).toBe(403);
    expect(project.body).toMatchObject({ code: "access_denied", missingAction: "projects:manage", requestable: true });
  });

  it("a read-only agent may read but not write", async () => {
    const reader = await agentWith({ level: "read_only" });
    const app = appFor(runActor(reader));
    expect((await request(app).get(`/api/companies/${companyId}/issues`)).status).toBe(200);
    const comment = await request(app).post(`/api/issues/${randomUUID()}/feedback-votes`).send({});
    expect(comment.body).toMatchObject({ code: "access_denied", missingAction: "tasks:comment" });
    const blind = await agentWith({ level: "worker", overrides: { "tasks:read": false } });
    const read = await request(appFor(runActor(blind))).get(`/api/companies/${companyId}/issues`);
    expect(read.status).toBe(403);
    expect(read.body).toMatchObject({ code: "access_denied", missingAction: "tasks:read", requestable: false });
  });

  it("api:raw does not bypass a tagged route's action", async () => {
    const admin = await agentWith({ level: "admin" });
    const response = await request(appFor(runActor(admin))).delete(`/api/issues/${randomUUID()}`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: expect.any(String), code: "access_denied", missingAction: "tasks:delete", requestable: true,
    });
    const deleter = await agentWith({ level: "worker", overrides: { "tasks:delete": true } });
    expect((await request(appFor(runActor(deleter))).delete(`/api/issues/${randomUUID()}`)).status).toBe(200);
  });

  it("a temporary grant lets one call through", async () => {
    const worker = await agentWith({ level: "worker" });
    await grantTemporaryAccess(db, {
      companyId, principal: { type: "agent", id: worker.id }, action: "projects:manage",
      resource: { type: "company", id: companyId }, expiresAt: new Date(Date.now() + 60_000), reason: "approved", usesLeft: 1,
    });
    const app = appFor(runActor(worker));
    expect((await request(app).post(`/api/companies/${companyId}/projects`).send({})).status).toBe(200);
    expect((await request(app).post(`/api/companies/${companyId}/projects`).send({})).status).toBe(403);
  });

  it("board callers are not affected", async () => {
    const board: AuthorizationActor = { type: "board", userId: "user-1", source: "session", companyIds: [companyId] };
    const app = appFor(board);
    expect((await request(app).delete(`/api/issues/${randomUUID()}`)).status).toBe(200);
    expect((await request(app).post("/api/not-a-documented-route").send({})).status).toBe(200);
    expect((await request(appFor({ type: "none", source: "none" })).post("/api/not-a-documented-route")).status).toBe(200);
  });
});
