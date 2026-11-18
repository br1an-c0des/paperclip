import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, companies, companyMemberships, createDb, heartbeatRuns, issueLabels, issues, labels } from "@paperclipai/db";
import type { AgentAccess } from "@paperclipai/shared";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import type { AuthorizationActor } from "../services/authorization.js";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();

describe.skipIf(!support.supported)("access checks on the issue routes", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;
  let companyId = "";
  let prefixCount = 0;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("paperclip-issues-access-routes-");
    db = createDb(temporary.connectionString, { maxConnections: 4 });
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => {
    await db?.$client.end();
    await temporary?.cleanup();
  });

  async function company() {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const [row] = await db.insert(companies).values({
      name: "Issue access", issuePrefix: `IA${letters[prefixCount++ % 26]}`,
    }).returning();
    companyId = row!.id;
    return row!;
  }

  async function agentWith(access: AgentAccess) {
    const [agent] = await db.insert(agents).values({
      companyId, name: `Agent ${randomUUID().slice(0, 8)}`, role: "engineer", adapterType: "process",
      permissions: { access },
    }).returning();
    await db.insert(companyMemberships).values({
      companyId, principalType: "agent", principalId: agent!.id, status: "active", membershipRole: "member",
    });
    return agent!;
  }

  async function task(input: { assigneeAgentId?: string | null; status?: string } = {}) {
    const [issue] = await db.insert(issues).values({
      companyId, title: `Task ${randomUUID().slice(0, 8)}`, status: input.status ?? "todo", priority: "medium",
      assigneeAgentId: input.assigneeAgentId ?? null, originKind: "manual",
    }).returning();
    return issue!;
  }

  function appAs(actor: AuthorizationActor) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor as typeof req.actor;
      next();
    });
    app.use("/api", issueRoutes(db, {} as never));
    app.use(errorHandler);
    return app;
  }

  const asAgent = (agent: { id: string }) =>
    appAs({ type: "agent", agentId: agent.id, companyId, source: "agent_key" });
  const asBoard = () =>
    appAs({ type: "board", userId: "board-user", companyIds: [companyId], isInstanceAdmin: true, source: "local_implicit" });

  const requestableDenial = (missingAction: string) => ({
    error: expect.any(String), code: "access_denied", missingAction, requestable: true,
  });

  it("DELETE /issues/:id needs tasks:delete", async () => {
    await company();
    const manager = await agentWith({ level: "manager" });
    const own = await task({ assigneeAgentId: manager.id });
    const denied = await request(asAgent(manager)).delete(`/api/issues/${own.id}`);
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(denied.body).toEqual(requestableDenial("tasks:delete"));
    expect(await db.select().from(issues).where(eq(issues.id, own.id))).toHaveLength(1);

    const deleter = await agentWith({ level: "worker", overrides: { "tasks:delete": true } });
    const deletable = await task({ assigneeAgentId: deleter.id });
    const deleted = await request(asAgent(deleter)).delete(`/api/issues/${deletable.id}`);
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(await db.select().from(issues).where(eq(issues.id, deletable.id))).toHaveLength(0);

    const boardDeletable = await task();
    expect((await request(asBoard()).delete(`/api/issues/${boardDeletable.id}`)).status).toBe(200);
  });

  it("archiving another agent's task needs tasks:update_any", async () => {
    await company();
    const worker = await agentWith({ level: "worker" });
    const manager = await agentWith({ level: "manager" });
    const others = await task({ assigneeAgentId: manager.id });
    const hiddenAt = new Date().toISOString();

    const denied = await request(asAgent(worker)).patch(`/api/issues/${others.id}`).send({ hiddenAt });
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(denied.body).toEqual(requestableDenial("tasks:update_any"));
    const labelled = await request(asAgent(worker)).patch(`/api/issues/${others.id}`).send({ labelIds: [] });
    expect(labelled.body).toEqual(requestableDenial("tasks:update_any"));

    // Every agent task write is attributed to a heartbeat run.
    async function inRun(agent: { id: string }, sourceIssueId: string) {
      const [run] = await db.insert(heartbeatRuns).values({
        companyId, agentId: agent.id, status: "running", contextSnapshot: { issueId: sourceIssueId },
      }).returning();
      return appAs({ type: "agent", agentId: agent.id, companyId, runId: run!.id, source: "agent_jwt" });
    }

    const own = await task({ assigneeAgentId: worker.id });
    const archivedOwn = await request(await inRun(worker, own.id)).patch(`/api/issues/${own.id}`).send({ hiddenAt });
    expect(archivedOwn.status, JSON.stringify(archivedOwn.body)).toBe(200);

    // The manager's run is on its own task, so archiving the worker's task is a cross-issue write.
    const managersTask = await task({ assigneeAgentId: manager.id, status: "in_progress" });
    const archivedOthers = await request(await inRun(manager, managersTask.id))
      .patch(`/api/issues/${(await task({ assigneeAgentId: worker.id })).id}`)
      .send({ hiddenAt });
    expect(archivedOthers.status, JSON.stringify(archivedOthers.body)).toBe(200);
  });

  it("label definitions need labels:manage", async () => {
    await company();
    const worker = await agentWith({ level: "worker" });
    const manager = await agentWith({ level: "manager" });

    const denied = await request(asAgent(worker)).post(`/api/companies/${companyId}/labels`).send({ name: "bug", color: "#ff0000" });
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(denied.body).toEqual(requestableDenial("labels:manage"));

    const created = await request(asAgent(manager)).post(`/api/companies/${companyId}/labels`).send({ name: "bug", color: "#ff0000" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const deleteDenied = await request(asAgent(worker)).delete(`/api/labels/${created.body.id}`);
    expect(deleteDenied.body).toEqual(requestableDenial("labels:manage"));
    expect(await db.select().from(labels).where(eq(labels.id, created.body.id))).toHaveLength(1);
    expect((await request(asAgent(manager)).delete(`/api/labels/${created.body.id}`)).status).toBe(200);
  });

  describe("PATCH /labels/:labelId", () => {
    async function label(name = "bug", color = "#ff0000") {
      const created = await request(asBoard()).post(`/api/companies/${companyId}/labels`).send({ name, color });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      return created.body as { id: string; name: string; color: string };
    }

    it("renames a label", async () => {
      await company();
      const bug = await label();
      const renamed = await request(asBoard()).patch(`/api/labels/${bug.id}`).send({ name: "  defect " });
      expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
      expect(renamed.body).toMatchObject({ id: bug.id, name: "defect", color: "#ff0000" });
      const [activity] = await db.select().from(activityLog).where(and(
        eq(activityLog.entityId, bug.id), eq(activityLog.action, "label.updated"),
      ));
      expect(activity?.details).toEqual({ before: { name: "bug", color: "#ff0000" }, after: { name: "defect", color: "#ff0000" } });
    });

    it("recolors a label", async () => {
      await company();
      const bug = await label();
      const recolored = await request(asBoard()).patch(`/api/labels/${bug.id}`).send({ color: "#00ff00" });
      expect(recolored.status, JSON.stringify(recolored.body)).toBe(200);
      expect(recolored.body).toMatchObject({ name: "bug", color: "#00ff00" });
    });

    it("refuses an empty patch", async () => {
      await company();
      const bug = await label();
      expect((await request(asBoard()).patch(`/api/labels/${bug.id}`).send({})).status).toBe(400);
      expect((await request(asBoard()).patch(`/api/labels/${bug.id}`).send({ color: "red" })).status).toBe(400);
      expect((await request(asBoard()).patch(`/api/labels/${bug.id}`).send({ name: "x", extra: true })).status).toBe(400);
    });

    it("a name clash returns 409", async () => {
      await company();
      const bug = await label("bug");
      await label("feature", "#0000ff");
      const clash = await request(asBoard()).patch(`/api/labels/${bug.id}`).send({ name: "feature" });
      expect(clash.status, JSON.stringify(clash.body)).toBe(409);
      expect(clash.body.error).toMatch(/feature/);
      // Keeping its own name is not a clash.
      expect((await request(asBoard()).patch(`/api/labels/${bug.id}`).send({ name: "bug", color: "#123456" })).status).toBe(200);
    });

    it("an agent without labels:manage gets the requestable 403", async () => {
      await company();
      const bug = await label();
      const worker = await agentWith({ level: "worker" });
      const denied = await request(asAgent(worker)).patch(`/api/labels/${bug.id}`).send({ name: "defect" });
      expect(denied.status).toBe(403);
      expect(denied.body).toEqual(requestableDenial("labels:manage"));
      const manager = await agentWith({ level: "manager" });
      expect((await request(asAgent(manager)).patch(`/api/labels/${bug.id}`).send({ name: "defect" })).status).toBe(200);
    });

    it("issues keep the label after a rename", async () => {
      await company();
      const bug = await label();
      const labelled = await task();
      await db.insert(issueLabels).values({ companyId, issueId: labelled.id, labelId: bug.id });
      await request(asBoard()).patch(`/api/labels/${bug.id}`).send({ name: "defect" }).expect(200);
      const read = await request(asBoard()).get(`/api/issues/${labelled.id}`);
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect(read.body.labelIds).toEqual([bug.id]);
      expect(read.body.labels).toEqual([expect.objectContaining({ id: bug.id, name: "defect" })]);
    });
  });

  it("a 403 for a missing action is requestable; other refusals are not", async () => {
    await company();
    const worker = await agentWith({ level: "worker" });
    const manager = await agentWith({ level: "manager" });
    const others = await task({ assigneeAgentId: worker.id });
    const levelRefusal = await request(asAgent(await agentWith({ level: "read_only" })))
      .post(`/api/issues/${others.id}/comments`).send({ body: "Hello" });
    expect(levelRefusal.status, JSON.stringify(levelRefusal.body)).toBe(403);
    expect(levelRefusal.body).toEqual(requestableDenial("tasks:comment"));

    // Another run's lock on an in-progress task is a plain denial: approving a request can't lift it.
    const locked = await task({ assigneeAgentId: worker.id, status: "in_progress" });
    const lockRefusal = await request(asAgent(manager)).patch(`/api/issues/${locked.id}`).send({ title: "Mine now" });
    expect(lockRefusal.status).toBeGreaterThanOrEqual(400);
    expect(lockRefusal.body.requestable).not.toBe(true);
  });
});
