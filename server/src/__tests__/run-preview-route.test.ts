import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { agentApiKeys, agents, authUsers, companies, companyMemberships, createDb, goals, issues, projects } from "@paperclipai/db";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { agentRoutes } from "../routes/agents.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

// Step 4b part 2: GET /api/agents/:id/run-preview is for the board, behind the agent read's
// company check, and the project must be the agent's company's. Step 5 Task 8: so must the task
// the prompt draft is for, and a kind of wake the task can't have answers 422.
// The New task dialog's preview (fork/task-prompt-preview.md): POST .../run-preview/draft takes
// issue creation's fields and rules, under the same checks, and its references must be the
// agent's company's.

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
      const taskId = randomUUID(), otherTaskId = randomUUID();
      await db.insert(issues).values([
        { id: taskId, companyId, title: "M7 test route task", status: "todo", assigneeAgentId: agentId },
        { id: otherTaskId, companyId: otherCompanyId, title: "M7 test elsewhere", status: "todo" },
      ]);
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
      expect(read.body.prompt).toMatchObject({ kind: "no_task", issueId: null });

      const previewUrl = (query: string) => `/api/agents/${agentId}/run-preview?${query}`;
      const drafted = await request(board).get(previewUrl(`issueId=${taskId}`));
      expect(drafted.status).toBe(200);
      expect(drafted.body.prompt).toMatchObject({ kind: "assignment", issueId: taskId });
      const noComment = await request(board).get(previewUrl(new URLSearchParams({ issueId: taskId, kind: "comment" }).toString()));
      expect({ status: noComment.status, code: noComment.body.code }).toEqual({ status: 422, code: "no_comment" });
      const notAChat = await request(board).get(previewUrl(new URLSearchParams({ issueId: taskId, kind: "chat_turn" }).toString()));
      expect({ status: notAChat.status, code: notAChat.body.code }).toEqual({ status: 422, code: "not_a_chat" });
      expect((await request(board).get(previewUrl(`issueId=${otherTaskId}`))).status).toBe(404);
      expect((await request(board).get(previewUrl("issueId=not-a-task"))).status).toBe(404);
      expect((await request(board).get(previewUrl("kind=sometime"))).status).toBe(400);
      expect((await request(board).get(previewUrl("kind=comment"))).status).toBe(400);

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

(support.supported ? describe : describe.skip)("POST /api/agents/:id/run-preview/draft", () => {
  it("validates the draft like a new task, and keeps its project, parent and goal in the agent's company", async () => {
    const database = await startEmbeddedPostgresTestDatabase("run-preview-draft-route-");
    const db = createDb(database.connectionString);
    const previousHome = process.env.PAPERCLIP_HOME;
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "run-preview-draft-route-home-"));
    process.env.PAPERCLIP_HOME = home;
    try {
      const companyId = randomUUID(), otherCompanyId = randomUUID(), agentId = randomUUID(), callerId = randomUUID();
      const userId = randomUUID(), token = randomUUID();
      const projectId = randomUUID(), otherProjectId = randomUUID(), goalId = randomUUID(), otherGoalId = randomUUID();
      const parentId = randomUUID(), otherParentId = randomUUID();
      await db.insert(companies).values([
        { id: companyId, name: "M7 test draft route", issuePrefix: "PDA" },
        { id: otherCompanyId, name: "M7 test other", issuePrefix: "PDB" },
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
      await db.insert(projects).values([
        { id: projectId, companyId, name: "Here", status: "in_progress" },
        { id: otherProjectId, companyId: otherCompanyId, name: "Elsewhere", status: "in_progress" },
      ]);
      await db.insert(goals).values([
        { id: goalId, companyId, title: "M7 test goal" },
        { id: otherGoalId, companyId: otherCompanyId, title: "M7 test other goal" },
      ]);
      await db.insert(issues).values([
        { id: parentId, companyId, title: "M7 test parent", status: "todo" },
        { id: otherParentId, companyId: otherCompanyId, title: "M7 test elsewhere", status: "todo" },
      ]);
      await db.insert(agentApiKeys).values({ companyId, agentId: callerId, name: "Caller", responsibleUserId: userId,
        keyHash: createHash("sha256").update(token).digest("hex") });

      const board = express();
      board.use(express.json());
      board.use(actorMiddleware(db, { deploymentMode: "local_trusted" }));
      board.use("/api", agentRoutes(db));
      board.use(errorHandler);
      const url = `/api/agents/${agentId}/run-preview/draft`;
      const post = (body: Record<string, unknown>) => request(board).post(url).send(body);

      const drafted = await post({ title: "M7 test draft", description: "Count the ledger.", projectId, parentId, goalId, workMode: "ask" });
      expect(drafted.status).toBe(200);
      expect(drafted.body).toMatchObject({ supported: true, project: { id: projectId } });
      expect(drafted.body.prompt).toMatchObject({ kind: "assignment", issueId: null });
      // A non-chat task's run message (step 5 phase 2, the task brief): the task under "The task",
      // its mode's rule under "What to do now", and no separate brief.
      const sections = drafted.body.prompt.firstMessage as Array<{ id: string; text: string }>;
      const section = (id: string) => sections.find((entry) => entry.id === id);
      expect(sections.map((entry) => entry.id)).toEqual(expect.arrayContaining(["what_happened", "the_task", "to_do"]));
      expect(section("task_brief")).toBeUndefined();
      expect(section("the_task")!.text).toContain('PDA-1 "M7 test draft"');
      expect(section("the_task")!.text).toContain("work mode: ask");
      expect(section("the_task")!.text).toContain("> Count the ledger.");
      expect(section("to_do")!.text).toContain("This task is in ask mode: answer the question in a comment on the task.");
      // Nothing was made.
      expect((await db.select({ id: issues.id }).from(issues)).length).toBe(2);

      // Creation's rules: a title or a description, the dialog's work modes, a known priority.
      expect((await post({})).status).toBe(400);
      expect((await post({ title: "  ", description: "" })).status).toBe(400);
      expect((await post({ title: "M7 test", workMode: "skill_test" })).status).toBe(400);
      expect((await post({ title: "M7 test", priority: "whenever" })).status).toBe(400);
      expect((await post({ title: "M7 test", projectId: "not-a-uuid" })).status).toBe(400);
      // A task the agent isn't woken for has no prompt.
      const backlog = await post({ title: "M7 test", status: "backlog" });
      expect({ status: backlog.status, code: backlog.body.code }).toEqual({ status: 422, code: "no_wake" });

      // References outside the agent's company, or that don't exist.
      expect((await post({ title: "M7 test", projectId: otherProjectId })).status).toBe(404);
      expect((await post({ title: "M7 test", parentId: otherParentId })).status).toBe(404);
      expect((await post({ title: "M7 test", goalId: otherGoalId })).status).toBe(404);
      expect((await post({ title: "M7 test", executionWorkspaceId: randomUUID() })).status).toBe(404);
      expect((await request(board).post(`/api/agents/${randomUUID()}/run-preview/draft`).send({ title: "M7 test" })).status).toBe(404);

      const agentApp = express();
      agentApp.use(express.json());
      agentApp.use(actorMiddleware(db, { deploymentMode: "authenticated" }));
      agentApp.use("/api", agentRoutes(db));
      agentApp.use(errorHandler);
      const asAgent = await request(agentApp).post(url).set("Authorization", `Bearer ${token}`).send({ title: "M7 test" });
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
