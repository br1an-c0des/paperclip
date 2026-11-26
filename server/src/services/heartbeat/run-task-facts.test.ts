import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, companies, createDb, documentRevisions, documents, heartbeatRunEvents, heartbeatRuns, issueDocuments, issues } from "@paperclipai/db";
import { REDACTED_EVENT_VALUE } from "../../redaction.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { createRunSecretRedactionRegistry } from "../run-secret-redaction.js";
import { getTaskPlanContext } from "../task-plan-context.js";
import { buildRunTaskFacts, type PaperclipRunTask } from "./run-task-facts.js";
import { prepareHeartbeatTaskContext } from "./task-context.js";
import type { PaperclipTaskMarkdownInput } from "./task-markdown.js";

// The task's facts for the run (step 5 phase 2, Task 1): what "The task" and the brief's rules in
// "What to do now" are written from, and what changed since the session's last run.

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
if (!support.supported) console.warn(`Skipping run task facts tests: ${support.reason}`);

describePostgres("the task's facts for a run", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("run-task-facts-");
    db = createDb(temporary.connectionString);
  }, 30_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 24, 12, minutes));

  async function seed(input: { description?: string } = {}) {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Facts fixture", issuePrefix: `F${companyId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Facts reader", adapterType: "claude_local", status: "idle" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Add a dark mode toggle",
      description: input.description ?? "Write three one-line ideas.", status: "in_progress", assigneeAgentId: agentId, issueNumber: 45 });
    return { companyId, agentId, issueId };
  }

  async function previousRun(f: { companyId: string; agentId: string; issueId: string }, startedAt: Date) {
    const id = randomUUID();
    await db.insert(heartbeatRuns).values({ id, companyId: f.companyId, agentId: f.agentId, invocationSource: "on_demand",
      status: "succeeded", startedAt, createdAt: startedAt, contextSnapshot: { issueId: f.issueId } });
    return id;
  }

  async function plan(f: { companyId: string; issueId: string }, revisions: Array<{ body: string; createdAt: Date; createdByRunId?: string }>) {
    const documentId = randomUUID();
    const ids = revisions.map(() => randomUUID());
    await db.insert(documents).values({ id: documentId, companyId: f.companyId, title: "Plan", latestBody: revisions.at(-1)!.body,
      latestRevisionNumber: revisions.length });
    await db.insert(documentRevisions).values(revisions.map((revision, index) => ({ id: ids[index]!, companyId: f.companyId, documentId,
      revisionNumber: index + 1, body: revision.body, createdAt: revision.createdAt, createdByRunId: revision.createdByRunId ?? null })));
    await db.update(documents).set({ latestRevisionId: ids.at(-1)! }).where(eq(documents.id, documentId));
    await db.insert(issueDocuments).values({ companyId: f.companyId, issueId: f.issueId, documentId, key: "plan" });
    return { documentId, revisionIds: ids };
  }

  async function describeEdit(f: { companyId: string; issueId: string }, createdAt: Date, runId: string | null = null) {
    await db.insert(activityLog).values({ companyId: f.companyId, actorType: "user", actorId: "facts-user", action: "issue.updated",
      entityType: "issue", entityId: f.issueId, runId, createdAt,
      details: { changes: { description: { from: "old", to: "new", updated: true } } } });
  }

  function markdownInput(f: { issueId: string }, overrides: Partial<PaperclipTaskMarkdownInput> = {}): PaperclipTaskMarkdownInput {
    return {
      issue: { id: f.issueId, identifier: "TES-45", title: "Add a dark mode toggle", workMode: "standard",
        description: "  Write three one-line ideas.  " },
      ...overrides,
    };
  }

  async function facts(f: { companyId: string; issueId: string }, input: {
    markdown?: Partial<PaperclipTaskMarkdownInput>; previousRunId?: string | null; prefix?: { caseMarkdown: string; liveVoice: string };
    approvedRevisionId?: string;
  } = {}): Promise<PaperclipRunTask> {
    return buildRunTaskFacts(db, {
      companyId: f.companyId,
      issueId: f.issueId,
      taskMarkdownInput: markdownInput(f, input.markdown),
      taskPlan: await getTaskPlanContext({ db, companyId: f.companyId, issueId: f.issueId, approvedRevisionId: input.approvedRevisionId }),
      previousRunId: input.previousRunId ?? null,
      prefix: input.prefix ?? { caseMarkdown: "", liveVoice: "" },
    });
  }

  it("carries the description, the plan and the parents", async () => {
    const f = await seed();
    await plan(f, [{ body: "1. Old", createdAt: at(1) }, { body: "  1. Store one theme preference\n", createdAt: at(2) }]);
    const result = await facts(f, { markdown: { ancestors: [
      { id: randomUUID(), identifier: "TES-40", title: "Theme work", status: "in_progress", priority: "high" },
      { id: randomUUID(), identifier: "TES-12", title: "Settings redesign", status: "todo" },
      { id: randomUUID(), identifier: null, title: null, status: null },
    ] } });
    expect(result).toMatchObject({
      issueId: f.issueId,
      ancestors: [
        { identifier: "TES-40", title: "Theme work", status: "in_progress" },
        { identifier: "TES-12", title: "Settings redesign", status: "todo" },
        { identifier: null, title: null, status: null },
      ],
      ancestorsOmitted: 0,
      description: "Write three one-line ideas.",
      plan: { revisionNumber: 2, body: "1. Store one theme preference", truncatedFrom: null },
      workMode: "standard",
      titleNeedsGeneration: false,
      rejectedPlan: null,
      acceptedPlan: null,
      wakeCommentAttachments: [],
      attachmentOmissions: [],
      prefixParts: [],
      compactedSinceLastRun: false,
    });
    expect(result.ancestors[0]).not.toHaveProperty("priority");
  });

  it("keeps up to 6 parents and counts the rest", async () => {
    const f = await seed();
    const chain = Array.from({ length: 8 }, (_, index) => ({ id: randomUUID(), identifier: `TES-${index}`, title: `Parent ${index}`, status: "todo" }));
    const result = await facts(f, { markdown: { ancestors: chain } });
    expect(result.ancestors.map((ancestor) => ancestor.identifier)).toEqual(["TES-0", "TES-1", "TES-2", "TES-3", "TES-4", "TES-5"]);
    expect(result.ancestorsOmitted).toBe(2);
  });

  it("gives an empty description and no plan as null", async () => {
    const f = await seed();
    const result = await facts(f, { markdown: { issue: { id: f.issueId, identifier: "TES-45", title: "T", description: "   " } } });
    expect(result.description).toBeNull();
    expect(result.plan).toBeNull();
    expect(result.workMode).toBeNull();
  });

  it("cuts the plan at 12,000 characters", async () => {
    const f = await seed();
    const body = "x".repeat(12_500);
    await plan(f, [{ body, createdAt: at(1) }]);
    const result = await facts(f);
    expect(result.plan?.body).toHaveLength(12_000);
    expect(result.plan?.truncatedFrom).toBe(12_500);
  });

  it("a plan revision saved after the previous run started is changed; one before isn't", async () => {
    const f = await seed();
    const runId = await previousRun(f, at(10));
    await plan(f, [{ body: "1. Before", createdAt: at(5) }]);
    expect((await facts(f, { previousRunId: runId })).plan?.changedSinceLastRun).toBe(false);

    const later = await seed();
    const laterRun = await previousRun(later, at(10));
    await plan(later, [{ body: "1. Before", createdAt: at(5) }, { body: "2. After", createdAt: at(15) }]);
    expect((await facts(later, { previousRunId: laterRun })).plan).toMatchObject({ revisionNumber: 2, changedSinceLastRun: true });
  });

  it("a plan revision the previous run saved itself isn't changed: the session wrote it", async () => {
    const f = await seed();
    const runId = await previousRun(f, at(10));
    await plan(f, [{ body: "1. Written by the session", createdAt: at(12), createdByRunId: runId }]);
    expect((await facts(f, { previousRunId: runId })).plan?.changedSinceLastRun).toBe(false);
  });

  it("a description edit after the previous run started is changed", async () => {
    const f = await seed();
    const runId = await previousRun(f, at(10));
    await describeEdit(f, at(5));
    expect((await facts(f, { previousRunId: runId })).descriptionChangedSinceLastRun).toBe(false);
    await describeEdit(f, at(12), runId);
    expect((await facts(f, { previousRunId: runId })).descriptionChangedSinceLastRun).toBe(false);
    // An update that didn't change the description doesn't count.
    await db.insert(activityLog).values({ companyId: f.companyId, actorType: "user", actorId: "facts-user", action: "issue.updated",
      entityType: "issue", entityId: f.issueId, createdAt: at(13), details: { changes: { status: { from: "todo", to: "in_progress" } } } });
    expect((await facts(f, { previousRunId: runId })).descriptionChangedSinceLastRun).toBe(false);
    await describeEdit(f, at(15));
    expect((await facts(f, { previousRunId: runId })).descriptionChangedSinceLastRun).toBe(true);
  });

  it("no previous run: nothing is \"changed\"", async () => {
    const f = await seed();
    await plan(f, [{ body: "1. Plan", createdAt: at(15) }]);
    await describeEdit(f, at(15));
    const none = await facts(f);
    expect(none.descriptionChangedSinceLastRun).toBe(false);
    expect(none.plan?.changedSinceLastRun).toBe(false);
    // A previous run id with no row is the same.
    const missing = await facts(f, { previousRunId: randomUUID() });
    expect(missing.descriptionChangedSinceLastRun).toBe(false);
    expect(missing.plan?.changedSinceLastRun).toBe(false);
  });

  let eventSeq = 0;
  async function compaction(f: { companyId: string; agentId: string }, runId: string, eventType = "context.compacted") {
    await db.insert(heartbeatRunEvents).values({ companyId: f.companyId, runId, agentId: f.agentId, seq: ++eventSeq, eventType,
      stream: "system", level: "info", message: "Context compacted",
      payload: { prpEvent: { schema: "paperclip.prp.event.v1", schemaVersion: 1, eventType, sourceKind: "claude_local",
        normalizedSessionId: "claude-session", emittedAt: at(20).toISOString(),
        payload: { schema: "paperclip.context.compacted.v1", compactionId: randomUUID(), reason: "auto", preTokens: 150_000, postTokens: 20_000, sameSession: true } } } });
  }

  it("compactedSinceLastRun: the previous run recorded a compaction", async () => {
    const f = await seed();
    const runId = await previousRun(f, at(10));
    expect((await facts(f, { previousRunId: runId })).compactedSinceLastRun).toBe(false);
    // Another event type on the previous run doesn't count.
    await compaction(f, runId, "lifecycle");
    expect((await facts(f, { previousRunId: runId })).compactedSinceLastRun).toBe(false);
    await compaction(f, runId);
    expect((await facts(f, { previousRunId: runId })).compactedSinceLastRun).toBe(true);
  });

  it("compactedSinceLastRun: only the previous run counts, not another run of the agent", async () => {
    const f = await seed();
    const older = await previousRun(f, at(5));
    const otherTask = await previousRun(f, at(8));
    const runId = await previousRun(f, at(10));
    await compaction(f, older);
    await compaction(f, otherTask);
    expect((await facts(f, { previousRunId: runId })).compactedSinceLastRun).toBe(false);
    expect((await facts(f)).compactedSinceLastRun).toBe(false);
    // The same run in another company isn't this one's.
    const other = await seed();
    expect((await facts({ companyId: other.companyId, issueId: other.issueId }, { previousRunId: older })).compactedSinceLastRun).toBe(false);
  });

  it("rejectedPlan and acceptedPlan follow briefPlanState", async () => {
    const f = await seed();
    const rejected = await facts(f, { markdown: { planReview: { status: "rejected", reason: "  Cover the mobile layout.  " } } });
    expect(rejected.rejectedPlan).toEqual({ reason: "Cover the mobile layout." });
    expect(rejected.acceptedPlan).toBeNull();
    const rejectedNoReason = await facts(f, { markdown: { planReview: { status: "rejected", reason: "  " } } });
    expect(rejectedNoReason.rejectedPlan).toEqual({ reason: null });

    const { revisionIds } = await plan(f, [{ body: "1. Accepted", createdAt: at(1) }, { body: "2. Later draft", createdAt: at(2) }]);
    const accepted = await facts(f, {
      approvedRevisionId: revisionIds[0],
      markdown: {
        issue: { id: f.issueId, identifier: "TES-45", title: "T", workMode: "planning" },
        interaction: { kind: "request_confirmation", status: "accepted" },
        acceptedPlan: { documentId: null, revisionId: revisionIds[0], revisionNumber: null },
      },
    });
    expect(accepted.rejectedPlan).toBeNull();
    expect(accepted.acceptedPlan).toEqual({ revisionNumber: 1 });
    expect(accepted.plan).toMatchObject({ revisionNumber: 1, body: "1. Accepted" });
    expect(accepted.workMode).toBe("planning");

    // A wake comment means "update the plan", not "implement it", as in the brief.
    const commented = await facts(f, { markdown: {
      issue: { id: f.issueId, identifier: "TES-45", title: "T", workMode: "planning" },
      interaction: { kind: "request_confirmation", status: "accepted" },
      wakeComments: [{ id: randomUUID(), body: "One more idea" }],
    } });
    expect(commented.acceptedPlan).toBeNull();

    const continuation = await facts(f, { markdown: { acceptedPlanContinuation: true,
      acceptedPlan: { revisionId: revisionIds[0], revisionNumber: 7 } } });
    expect(continuation.acceptedPlan).toEqual({ revisionNumber: 7 });
  });

  it("lists the wake comments' attachments and omissions", async () => {
    const f = await seed();
    const first = randomUUID(), second = randomUUID(), attachmentId = randomUUID();
    const result = await facts(f, { markdown: {
      wakeComments: [
        { id: first, body: "See the file", attachments: [{ id: attachmentId, filename: "mock.png", contentType: "image/png", byteSize: 2048,
          contentPath: `/api/attachments/${attachmentId}/content` }] },
        { id: second, body: "And this one" },
      ],
      attachmentOmissions: [{ commentId: second, notice: "One file was too large to import." }, { commentId: " ", notice: "dropped" }],
    } });
    expect(result.wakeCommentAttachments).toEqual([{ commentId: first, id: attachmentId, filename: "mock.png", contentType: "image/png", byteSize: 2048 }]);
    expect(result.attachmentOmissions).toEqual([{ commentId: second, notice: "One file was too large to import." }]);
  });

  it("keeps the case context and live-voice guidance as prefix parts", async () => {
    const f = await seed();
    const result = await facts(f, { prefix: { liveVoice: "On a live call.\n\n", caseMarkdown: "\nWorkflow case\n{}\n" } });
    expect(result.prefixParts).toEqual([
      { id: "wake.task.live_voice", text: "On a live call." },
      { id: "wake.task.case", text: "Workflow case\n{}" },
    ]);
  });

  it("carries the provisional-title flag and the work mode", async () => {
    const f = await seed();
    const result = await facts(f, { markdown: { issue: { id: f.issueId, identifier: "TES-45", title: "Add a dark", titleNeedsGeneration: true, workMode: "ask" } } });
    expect(result.titleNeedsGeneration).toBe(true);
    expect(result.workMode).toBe("ask");
  });

  describe("on the run's context", () => {
    async function prepare(f: { companyId: string; agentId: string; issueId: string }, input: { conversation?: boolean; description: string; previousRunId?: string }) {
      const context: Record<string, unknown> = { issueId: f.issueId };
      const runId = await previousRun(f, at(30));
      await prepareHeartbeatTaskContext(db, {
        run: { id: runId },
        agent: { id: f.agentId, companyId: f.companyId, adapterType: "claude_local" },
        task: {
          issueRef: { id: f.issueId, identifier: "TES-45", title: "Add a dark mode toggle", status: "in_progress", priority: "medium",
            workMode: "standard", conversationAgentId: input.conversation ? f.agentId : null, description: input.description, projectId: null },
          issueContext: input.conversation
            ? { id: f.issueId, conversationAgentId: f.agentId, conversationUserId: "chat-user", description: input.description } as never
            : null,
          context,
          taskSession: input.previousRunId ? { lastRunId: input.previousRunId } : null,
        },
        policy: { trustPreset: { kind: "standard" } as never, experimentalInstanceSettings: {} },
        services: { issuesSvc: { getAncestors: async () => [] }, getPinnedSkillTestContext: async () => null },
      });
      return { context, runId };
    }

    it("no paperclipRunTask on a chat task", async () => {
      // The chat identity is on the task's read (issueContext), as the heartbeat passes it.
      const f = await seed();
      const { context } = await prepare(f, { conversation: true, description: "Chat about themes" });
      expect(context).not.toHaveProperty("paperclipRunTask");
      expect(typeof context.paperclipTaskMarkdown).toBe("string");
    });

    it("sets paperclipRunTask on a non-chat task, beside the brief", async () => {
      const f = await seed();
      const earlier = await previousRun(f, at(10));
      await describeEdit(f, at(20));
      const { context } = await prepare(f, { description: "Write three one-line ideas.", previousRunId: earlier });
      expect(context.paperclipRunTask).toMatchObject({ issueId: f.issueId, description: "Write three one-line ideas.",
        descriptionChangedSinceLastRun: true, plan: null, workMode: "standard" });
      expect(typeof context.paperclipTaskMarkdownAssignment).toBe("string");
    });

    it("a registered secret in the description is redacted", async () => {
      const f = await seed();
      const secret = "run-task-facts-secret-canary";
      const holder = await previousRun(f, at(1));
      await createRunSecretRedactionRegistry(db).register(f.companyId, holder, secret);
      const { context } = await prepare(f, { description: `Use the key ${secret} to sign.` });
      const runTask = context.paperclipRunTask as PaperclipRunTask;
      expect(runTask.description).toBe(`Use the key ${REDACTED_EVENT_VALUE} to sign.`);
      expect(JSON.stringify(runTask)).not.toContain(secret);
    });

    it("a later preparation without a task drops a stale paperclipRunTask", async () => {
      const f = await seed();
      const context: Record<string, unknown> = { issueId: f.issueId, paperclipRunTask: { issueId: "stale" } };
      await prepareHeartbeatTaskContext(db, {
        run: { id: await previousRun(f, at(1)) },
        agent: { id: f.agentId, companyId: f.companyId, adapterType: "claude_local" },
        task: { issueRef: null, issueContext: null, context, taskSession: null },
        policy: { trustPreset: { kind: "standard" } as never, experimentalInstanceSettings: {} },
        services: { issuesSvc: { getAncestors: async () => [] }, getPinnedSkillTestContext: async () => null },
      });
      expect(context).not.toHaveProperty("paperclipRunTask");
    });
  });
});
