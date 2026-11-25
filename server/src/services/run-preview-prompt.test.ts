import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, createDb, heartbeatRuns, issueComments, issues } from "@paperclipai/db";
import { joinRunPromptSections, type RunPromptPreview, type RunPromptPreviewKind, type RunPromptSection } from "@paperclipai/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { HttpError } from "../errors.js";
import { prepareHeartbeatTaskContext } from "./heartbeat/task-context.js";
import { createHeartbeatRunPreparation } from "./heartbeat/run-preparation.js";
import { buildClaudeRunPromptPlan } from "./run-prompt/build-claude-run-prompt.js";
import { createRunSecretRedactionRegistry } from "./run-secret-redaction.js";
import { buildRunPreviewPrompt, PREVIEW_CONTEXT_RUN_ID, resolvePreviewPromptTarget } from "./run-preview-prompt.js";

// Step 5 Task 8: the next run's prompt in the agent's run preview, drafted for a task and kind of
// wake through the heartbeat's own task context and the run prompt builder. run-preview.test.ts
// checks the whole preview writes nothing and matches a real run's first message.

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
if (!support.supported) console.warn(`Skipping the run preview prompt tests: ${support.reason}`);

describePostgres("the run preview's prompt draft", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  let instructionsDir: string;
  let instructionsFilePath: string;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("run-preview-prompt-");
    db = createDb(temporary.connectionString);
    instructionsDir = await fs.mkdtemp(path.join(os.tmpdir(), "run-preview-prompt-"));
    instructionsFilePath = path.join(instructionsDir, "AGENTS.md");
    await fs.writeFile(instructionsFilePath, "# M7 test agent\n\nYou keep the ledger.\n");
  }, 30_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
    if (instructionsDir) await fs.rm(instructionsDir, { recursive: true, force: true });
  });

  async function seed() {
    const companyId = randomUUID(), agentId = randomUUID(), userId = randomUUID();
    await db.insert(authUsers).values({ id: userId, name: "M7 test owner", email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(companies).values({ id: companyId, name: "M7 test preview prompt", issuePrefix: `Q${companyId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "M7 test agent", title: "QA engineer", adapterType: "claude_local", status: "idle" });
    const agent = { id: agentId, companyId, name: "M7 test agent", title: "QA engineer", adapterType: "claude_local", adapterConfig: {} };
    return { companyId, agentId, userId, agent };
  }

  let issueNumber = 0;
  async function task(seeded: Awaited<ReturnType<typeof seed>>, values: Partial<typeof issues.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(issues).values({
      id, companyId: seeded.companyId, title: "M7 test ledger", description: "Keep the ledger current.",
      status: "todo", assigneeAgentId: seeded.agentId, issueNumber: ++issueNumber, ...values,
    });
    return id;
  }

  async function comment(seeded: Awaited<ReturnType<typeof seed>>, issueId: string, body: string) {
    const id = randomUUID();
    await db.insert(issueComments).values({ id, companyId: seeded.companyId, issueId, body, authorUserId: seeded.userId });
    return id;
  }

  // No promptTemplate: the run sends the identity line (step 5 phase 2, the light sections).
  const config = () => ({ instructionsFilePath });

  async function draft(
    seeded: Awaited<ReturnType<typeof seed>>,
    issueId: string | null,
    kind: RunPromptPreviewKind | null = null,
  ): Promise<RunPromptPreview> {
    const target = await resolvePreviewPromptTarget(db, seeded.agent, { issueId, kind });
    return buildRunPreviewPrompt(db, {
      agent: seeded.agent,
      target,
      config: config(),
      context: {},
      systemPrompt: [],
      runTokenAvailable: true,
      trustPreset: { kind: "standard" },
      plannedBranchName: null,
      instructionsWorkingCopy: false,
      hasConnections: false,
    });
  }

  const withoutPending = (sections: RunPromptSection[]) => sections.map(({ pending: _pending, ...section }) => ({
    ...section,
    ...(section.parts ? { parts: section.parts.map(({ pending: _partPending, ...part }) => part) } : {}),
  }));

  async function rejection(promise: Promise<unknown>) {
    const error = await promise.then(() => null, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(HttpError);
    const http = error as HttpError;
    return { status: http.status, code: (http.details as { code?: unknown } | undefined)?.code };
  }

  it("drafts a fresh assignment as the builder's fresh set for the same task", async () => {
    const seeded = await seed();
    const issueId = await task(seeded);
    const previewed = await draft(seeded, issueId);
    expect(previewed.kind).toBe("assignment");
    expect(previewed.issueId).toBe(issueId);

    // The context a run on its assignment builds: the harness checks the todo task out first.
    const issue = (await createHeartbeatRunPreparation(db).getIssueExecutionContext(seeded.companyId, issueId))!;
    const context: Record<string, unknown> = { issueId, wakeReason: "issue_assigned", paperclipHarnessCheckedOut: true };
    const checkedOut = { ...issue, status: "in_progress" };
    await prepareHeartbeatTaskContext(db, {
      run: { id: PREVIEW_CONTEXT_RUN_ID },
      agent: { id: seeded.agentId, companyId: seeded.companyId, adapterType: "claude_local" },
      task: { issueRef: checkedOut, issueContext: checkedOut, context, taskSession: null },
      policy: { trustPreset: { kind: "standard" } as never, experimentalInstanceSettings: {} },
      services: { issuesSvc: { getAncestors: async () => [] }, getPinnedSkillTestContext: async () => null },
    });
    const plan = await buildClaudeRunPromptPlan({
      agent: seeded.agent, runId: "preview", config: config(), context, sealed: true, paperclipApiReachable: true,
      loadFreshSessionHandoff: async () => null,
    });

    expect(withoutPending(previewed.firstMessage)).toEqual(plan.fresh);
    expect(previewed.firstMessageChars).toBe(joinRunPromptSections(plan.fresh).length);
    // The claude_local wake's four headings are sections (step 5 phase 2, the task brief); with
    // the task's facts on the context, a non-chat task has no brief.
    // Who the agent is, the instructions location and the tools note come first (step 5 phase 2,
    // the light sections).
    expect(previewed.firstMessage.map((section) => section.id)).toEqual([
      "heartbeat_template", "instructions_directive", "mcp_note", "communication_guidance", "what_happened", "the_task", "to_do",
      ...(context.paperclipRunTask ? [] : ["task_brief"]),
    ]);
    expect(previewed.firstMessage[0]).toMatchObject({ label: "Who you are", text: "You are M7 test agent, QA engineer." });
    expect(previewed.firstMessage[2]).toMatchObject({ label: "Paperclip tools" });
    // The checkout is the harness's, at launch.
    const theTask = previewed.firstMessage.find((section) => section.id === "the_task")!;
    // The claude_local wake holds both on its task line.
    const taskLine = theTask.parts?.find((part) => part.id === "wake.task");
    expect(taskLine?.text).toContain("already checked out to you");
    expect(taskLine?.pending).toMatch(/checks the task out/);
    expect(taskLine?.pending).toMatch(/status/);
  });

  it("drafts a chat turn with the chat directive, woken by the person's latest message", async () => {
    const seeded = await seed();
    const chatId = await task(seeded, {
      title: "Chat with M7 test agent", description: null, status: "in_progress",
      conversationAgentId: seeded.agentId, conversationUserId: seeded.userId, conversationState: "active",
    });
    await comment(seeded, chatId, "What's left on the ledger?");
    const previewed = await draft(seeded, chatId, "chat_turn");
    expect(previewed.kind).toBe("chat_turn");
    const brief = previewed.firstMessage.find((section) => section.id === "task_brief")!;
    expect(brief.parts?.map((part) => part.id)).toContain("task_brief.chat_directive");
    expect(joinRunPromptSections(previewed.firstMessage)).toContain("What's left on the ledger?");
    // A chat task keeps its brief, after the wake's four headings.
    const ids = previewed.firstMessage.map((section) => section.id);
    expect(ids.indexOf("to_do")).toBeGreaterThan(ids.indexOf("the_task"));
    expect(ids.indexOf("task_brief")).toBeGreaterThan(ids.indexOf("to_do"));
  });

  it("drafts a comment wake on the task's latest comment", async () => {
    const seeded = await seed();
    const issueId = await task(seeded, { status: "in_progress" });
    await comment(seeded, issueId, "M7 test: the first note");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await comment(seeded, issueId, "M7 test: please add the March totals");
    const previewed = await draft(seeded, issueId, "comment");
    const happened = previewed.firstMessage.find((section) => section.id === "what_happened")!;
    expect(happened.text).toContain("please add the March totals");
  });

  it("answers 422 for a comment wake on a task without comments, and a chat turn on a task", async () => {
    const seeded = await seed();
    const issueId = await task(seeded);
    expect(await rejection(resolvePreviewPromptTarget(db, seeded.agent, { issueId, kind: "comment" })))
      .toEqual({ status: 422, code: "no_comment" });
    expect(await rejection(resolvePreviewPromptTarget(db, seeded.agent, { issueId, kind: "chat_turn" })))
      .toEqual({ status: 422, code: "not_a_chat" });
  });

  it("redacts a secret registered on the task out of its description", async () => {
    const seeded = await seed();
    const secret = "m7-preview-secret-canary";
    const issueId = await task(seeded, { description: `Sign the ledger with ${secret}.` });
    const earlierRunId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: earlierRunId, companyId: seeded.companyId, agentId: seeded.agentId,
      invocationSource: "assignment", status: "succeeded", contextSnapshot: { issueId } });
    await createRunSecretRedactionRegistry(db).register(seeded.companyId, earlierRunId, secret);

    const previewed = await draft(seeded, issueId);
    // In the brief, or with the task's facts under "The task" (step 5 phase 2, the task brief).
    const description = previewed.firstMessage.flatMap((section) => section.parts ?? [])
      .find((part) => part.id === "task_brief.description" || part.id === "wake.task.description");
    expect(description?.text).toContain("Sign the ledger with");
    expect(JSON.stringify(previewed)).not.toContain(secret);
  });

  it("drafts a run without a task, with today's \"null\" brief", async () => {
    const seeded = await seed();
    const previewed = await draft(seeded, null);
    expect(previewed).toMatchObject({ kind: "no_task", issueId: null });
    expect(previewed.firstMessage.find((section) => section.id === "task_brief")?.text).toBe("null");
  });

  it("marks the branch, the instructions' working copy and connection instructions as filled in at launch", async () => {
    const seeded = await seed();
    const issueId = await task(seeded);
    const target = await resolvePreviewPromptTarget(db, seeded.agent, { issueId, kind: null });
    const previewed = await buildRunPreviewPrompt(db, {
      agent: seeded.agent, target, config: config(), context: {}, systemPrompt: [], runTokenAvailable: true,
      trustPreset: { kind: "standard" }, plannedBranchName: "<task branch>", instructionsWorkingCopy: true, hasConnections: true,
    });
    const byId = (id: string) => previewed.firstMessage.find((section) => section.id === id)!;
    expect(byId("instructions_directive").pending).toMatch(/working copy/);
    // Connection instructions follow "What to do now".
    expect(byId("to_do").pending).toMatch(/connections/);
    expect(previewed.firstMessage.some((section) => section.id === "wake")).toBe(false);
    // The branch is on the claude_local wake's task line.
    const branch = byId("the_task").parts?.find((part) => part.id === "wake.task");
    expect(branch?.text).toContain("branch `<task branch>`");
    expect(branch?.pending).toMatch(/names the branch/);
  });
});
