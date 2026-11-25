import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issues } from "@paperclipai/db";
import { FAST_RESPONSE_AGENT_GUIDANCE, joinRunPromptSections, type RunPromptPlan, type RunPromptSection } from "@paperclipai/shared";
import { composeClaudeCliPrompt, planClaudeInstructionsDirective, resolveClaudePromptTemplate } from "@paperclipai/adapter-claude-local/server";
import { asString, hydrateFreshSessionHandoff } from "@paperclipai/adapter-utils/server-utils";
import { createPromptContextFixture } from "@paperclipai/adapter-utils/test-fixtures/prompt-context";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { createRunSecretRedactionRegistry } from "../run-secret-redaction.js";
import { copyTaskMarkdownParts, prepareHeartbeatTaskContext } from "../heartbeat/task-context.js";
import { buildPaperclipTaskMarkdown, buildPaperclipTaskMarkdownParts, type PaperclipTaskMarkdownInput } from "../heartbeat/task-markdown.js";
import { buildClaudeRunPromptPlan, type ClaudeRunPromptInput } from "./build-claude-run-prompt.js";

// The golden test (step 5, Task 4): for every kind of run (research section 3.1), fresh and
// resumed, the builder's sections join to exactly the prompt today's CLI join sends.

let instructionsDir: string;
let instructionsFilePath: string;

beforeAll(async () => {
  instructionsDir = await fs.mkdtemp(path.join(os.tmpdir(), "run-prompt-builder-"));
  instructionsFilePath = path.join(instructionsDir, "AGENTS.md");
  await fs.writeFile(instructionsFilePath, "# Ada\n\nYou keep the release ledger.\n");
});

afterAll(async () => {
  await fs.rm(instructionsDir, { recursive: true, force: true });
});

const agent = { id: "agent-1", companyId: "company-1", name: "Ada", adapterType: "claude_local" };

/** What execute.ts sends for one attempt: the same inputs, through today's join. */
async function sentPrompt(input: ClaudeRunPromptInput, resumed: boolean): Promise<string> {
  // The adapter hydrates the handoff onto its own context at a fresh attempt.
  const context = resumed ? input.context : { ...input.context };
  if (!resumed) {
    await hydrateFreshSessionHandoff({ context, getFreshSessionHandoff: input.loadFreshSessionHandoff }, { resumedSession: false });
  }
  const { directive } = await planClaudeInstructionsDirective(input.config);
  const env: Record<string, string> = input.paperclipApiReachable
    ? { PAPERCLIP_API_URL: "http://127.0.0.1:3100", PAPERCLIP_API_KEY: "run-jwt" }
    : {};
  return composeClaudeCliPrompt({
    context,
    resumed,
    instructionsPathDirective: directive,
    bootstrapPromptTemplate: asString(input.config.bootstrapPromptTemplate, ""),
    promptTemplate: resolveClaudePromptTemplate(input.config, input.context),
    templateData: {
      agentId: input.agent.id,
      companyId: input.agent.companyId,
      runId: input.runId,
      company: { id: input.agent.companyId },
      agent: input.agent,
      run: { id: input.runId, source: "on_demand" },
      context,
    },
    sealed: input.sealed,
    env,
  }).prompt;
}

function expectPartsJoin(sections: RunPromptSection[]) {
  for (const section of sections) {
    expect(section.chars).toBe(section.text.length);
    expect(section.text).toBe(section.text.trim());
    if (section.parts) {
      expect(section.parts.map((part) => part.text).join(""), `${section.id} parts`).toBe(section.text);
      for (const part of section.parts) expect(part.chars).toBe(part.text.length);
    }
  }
}

/** The four brief variants and their parts, as prepareHeartbeatTaskContext stores them. */
function withBrief(
  context: Record<string, unknown>,
  markdownInput: PaperclipTaskMarkdownInput,
  options: { chatCompletion?: string } = {},
): Record<string, unknown> {
  const completion = options.chatCompletion ?? "";
  const variant = (extra: Partial<PaperclipTaskMarkdownInput>) =>
    "" + buildPaperclipTaskMarkdown({ ...markdownInput, ...extra }) + completion;
  const partsOf = (extra: Partial<PaperclipTaskMarkdownInput>) => [
    ...(buildPaperclipTaskMarkdownParts({ ...markdownInput, ...extra })
      ?? [{ id: "task_brief.null", label: "No task brief", source: "no task", text: "null" }]),
    ...(completion ? [{ id: "task_brief.chat_completion", label: "Delegated work completed", source: "chat completion updates", text: completion }] : []),
  ];
  const plain = variant({});
  const assignment = variant({ includeWakeComments: false });
  const compact = variant({ includeDescription: false });
  const assignmentCompact = variant({ includeDescription: false, includeWakeComments: false });
  const result: Record<string, unknown> = { ...context, paperclipTaskMarkdown: plain, paperclipTaskMarkdownAssignment: assignment };
  if (compact !== plain) result.paperclipTaskMarkdownCompact = compact;
  if (assignmentCompact !== assignment) result.paperclipTaskMarkdownAssignmentCompact = assignmentCompact;
  copyTaskMarkdownParts({
    paperclipTaskMarkdownAssignmentParts: partsOf({ includeWakeComments: false }),
    ...(assignmentCompact !== assignment
      ? { paperclipTaskMarkdownAssignmentCompactParts: partsOf({ includeDescription: false, includeWakeComments: false }) }
      : {}),
  }, result);
  return result;
}

const issue = { id: "issue-1", identifier: "PAP-1", title: "Release ledger", status: "in_progress", priority: "medium", workMode: "standard" };
const description = "Keep the release ledger current and publish the launch checklist.";
const guidance = FAST_RESPONSE_AGENT_GUIDANCE;
/** The payload's history (step 5 phase 2, the handoff), as buildPaperclipWakePayload adds it. */
const wakeHistory = {
  lastRun: { runId: "prior-run", agentId: agent.id, ownRun: true, status: "succeeded", finishedAt: "2026-11-20T09:00:00.000Z",
    body: "Drafted the ledger.", bodyTruncated: false },
  answered: [], answeredOmitted: 0, open: [], documents: [{ key: "notes", title: null, inBrief: false }],
};

interface RunKind {
  name: string;
  /** Text the fresh prompt must contain: the branch this kind exercises. */
  shows: string[];
  input: () => ClaudeRunPromptInput;
}

function runInput(context: Record<string, unknown>, overrides: Partial<ClaudeRunPromptInput> = {}): ClaudeRunPromptInput {
  return {
    agent,
    runId: "run-1",
    config: { instructionsFilePath },
    context,
    sealed: true,
    paperclipApiReachable: true,
    loadFreshSessionHandoff: async () => null,
    ...overrides,
  };
}

const kinds: RunKind[] = [
  {
    name: "fresh assignment",
    shows: ["## What happened", "You've been assigned PAP-1 \"Release ledger\".", "branch `pap-1-release-ledger`", "Task plan document doc-1", "Paperclip API access note:", "You are agent agent-1 (Ada)."],
    input: () => runInput(withBrief({
      issueId: issue.id,
      wakeReason: "issue_assigned",
      paperclipTaskCommunicationGuidance: guidance,
      paperclipWake: { reason: "issue_assigned", issue: { ...issue, description }, comments: [], fallbackFetchNeeded: false,
        checkedOutByHarness: true, executionWorkspace: { branchName: "pap-1-release-ledger" } },
    }, {
      issue: { ...issue, description },
      ancestors: [{ id: "parent-1", identifier: "PAP-0", title: "Launch", status: "in_progress" }],
      taskPlan: { documentId: "doc-1", revisionId: "rev-1", revisionNumber: 1, body: "1. Draft the ledger." },
    })),
  },
  {
    name: "resumed comment wake",
    shows: ["## Earlier runs", "This is a new session; the handoff above has the task's history."],
    input: () => {
      const fixture = createPromptContextFixture();
      const comments = fixture.paperclipWake.comments.map(({ id, body }) => ({ id, body }));
      return runInput(withBrief({ ...fixture, paperclipTaskCommunicationGuidance: guidance }, {
        issue: { ...issue, description: fixture.paperclipWake.issue.description },
        wakeComments: comments,
      }), { loadFreshSessionHandoff: async () => "## Earlier runs\n\nThe ledger was drafted in run prior-run." });
    },
  },
  {
    name: "comment with an open plan review",
    shows: ["A person sent your plan back:", "There are open comments on the plan (revision 2):", "There are open comments on the document \"Release notes\":", "Rejected plan review directive:"],
    input: () => runInput(withBrief({
      paperclipTaskCommunicationGuidance: guidance,
      interactionKind: "request_confirmation",
      interactionStatus: "rejected",
      paperclipWake: {
        reason: "issue_commented",
        issue: { ...issue, workMode: "planning", description },
        comments: [{ id: "comment-1", body: "Friday is too soon.", authorType: "user", authorId: "user-1", createdAt: "2026-11-20T10:00:00.000Z" }],
        commentWindow: { requestedCount: 1, includedCount: 1, missingCount: 0 },
        latestCommentId: "comment-1",
        fallbackFetchNeeded: false,
        planReviewContext: {
          documentKey: "plan", issueId: issue.id, latestRevisionNumber: 2, latestRevisionId: "rev-2",
          interaction: { kind: "request_confirmation", status: "rejected", result: { outcome: "rejected", reason: "Move the date." } },
          threads: [{ id: "thread-1", status: "open", selectedText: "Ship Friday", comments: [{ id: "pc-1", body: "Too soon." }] }],
        },
        documentReviewContext: {
          documents: [{ documentKey: "notes", title: "Release notes", latestRevisionNumber: 1,
            threads: [{ id: "doc-thread-1", status: "open", selectedText: "v2", comments: [{ id: "dc-1", body: "Say v2.1." }] }] }],
        },
      },
    }, {
      issue: { ...issue, workMode: "planning", description },
      wakeComments: [{ id: "comment-1", body: "Friday is too soon." }],
      planReview: { status: "rejected", reason: "Move the date." },
    })),
  },
  {
    name: "chat turn",
    shows: ["Chat mode directive:", "Reply in the chat.", "Delegated work has completed."],
    input: () => runInput(withBrief({
      conversationMode: true,
      paperclipTaskCommunicationGuidance: `Reply in the chat.\n\n${guidance}`,
      paperclipWake: {
        reason: "issue_commented",
        issue: { ...issue, identifier: "PAP-7", title: "Chat with Ada" },
        comments: [{ id: "chat-1", body: "What's left on the ledger?", authorType: "user", authorId: "user-1", createdAt: "2026-11-20T10:00:00.000Z" }],
        commentWindow: { requestedCount: 1, includedCount: 1, missingCount: 0 },
        latestCommentId: "chat-1",
        fallbackFetchNeeded: false,
      },
      chatCompletionUpdates: [{ taskId: "issue-9", status: "done" }],
    }, {
      issue: { ...issue, id: "chat-issue", identifier: "PAP-7", title: "Chat with Ada", conversationAgentId: agent.id, description: "Not shown." },
      personTimeZone: "Europe/Paris",
      wakeComments: [{ id: "chat-1", body: "What's left on the ledger?" }],
    }, { chatCompletion: "\n\nDelegated work has completed.\n[{\"taskId\":\"issue-9\",\"status\":\"done\"}]" }), {
      config: { instructionsFilePath, promptTemplate: "" },
    }),
  },
  {
    name: "external chat turn",
    shows: ["## External chat response contract", "External chat file delivery:"],
    input: () => runInput(withBrief({
      paperclipTaskCommunicationGuidance: guidance,
      paperclipWake: {
        reason: "External chat message received",
        externalChatProvider: "slack",
        checkedOutByHarness: true,
        issue: { ...issue, description: "Started from Slack." },
        commentWindow: { requestedCount: 1, includedCount: 1, missingCount: 0 },
        commentIds: ["slack-1"],
        latestCommentId: "slack-1",
        comments: [{ id: "slack-1", issueId: issue.id, body: "Reply with the release marker.", bodyTruncated: false, authorType: "user" }],
        fallbackFetchNeeded: false,
      },
    }, {
      issue: { ...issue, description: "Started from Slack." },
      externalChatProvider: "slack",
      wakeComments: [{ id: "slack-1", body: "Reply with the release marker." }],
    })),
  },
  {
    name: "recovery",
    // The liveness continuation is the specific event; the recovery object doesn't add run_stopped.
    shows: ["Your last run on PAP-1 ended without concrete progress (attempt 1 of 2)."],
    input: () => runInput(withBrief({
      paperclipTaskCommunicationGuidance: guidance,
      paperclipWake: {
        reason: "issue_continuation_needed",
        issue: { ...issue, description },
        recovery: { cause: "process_lost", failureSummary: "the process exited", originalAssignee: { id: agent.id, name: "Ada" },
          attemptCount: 1, maxAttempts: 3, nextAction: "retry" },
        livenessContinuation: { attempt: 1, maxAttempts: 2, state: "stalled", instruction: "Finish or block." },
        comments: [],
        fallbackFetchNeeded: false,
      },
    }, { issue: { ...issue, description } })),
  },
  {
    name: "routine",
    shows: ["Hello Ada.", "Routine run for Ada (run-1).", "Task title directive:"],
    input: () => runInput(withBrief({
      paperclipTaskCommunicationGuidance: guidance,
      routineId: "routine-1",
      paperclipWake: { reason: "issue_assigned", issue: { ...issue, title: "Weekly ledger check", description: "Check the ledger." },
        comments: [], fallbackFetchNeeded: false, checkedOutByHarness: true },
    }, { issue: { ...issue, title: "Weekly ledger check", titleNeedsGeneration: true, description: "Check the ledger." } }), {
      config: { instructionsFilePath, promptTemplate: "Routine run for {{agent.name}} ({{runId}}).", bootstrapPromptTemplate: "Hello {{agent.name}}." },
    }),
  },
  {
    name: "no task",
    shows: ["\n\nnull\n\n"],
    // An unscoped timer: no issue and no wake payload. Every variant is "" + null + "" (bug 84).
    input: () => {
      const context: Record<string, unknown> = {
        wakeReason: "heartbeat_timer",
        paperclipTaskCommunicationGuidance: guidance,
        paperclipTaskMarkdown: "null",
        paperclipTaskMarkdownAssignment: "null",
      };
      copyTaskMarkdownParts({
        paperclipTaskMarkdownAssignmentParts: [{ id: "task_brief.null", label: "No task brief", source: "no task", text: "null" }],
      }, context);
      return runInput(context);
    },
  },
  {
    name: "approval wake",
    shows: ["Your request was approved."],
    input: () => runInput(withBrief({
      paperclipTaskCommunicationGuidance: guidance,
      approvalId: "approval-1",
      approvalStatus: "approved",
      paperclipWake: { reason: "approval_approved", issue: { ...issue, description }, comments: [], fallbackFetchNeeded: false },
    }, { issue: { ...issue, description } })),
  },
  {
    name: "answered question",
    shows: ["A person answered your questions on PAP-1:", "> **Which date?** Monday."],
    // runtime-execution.ts adds questionResponse to the adapter's wake at dispatch.
    input: () => runInput(withBrief({
      paperclipTaskCommunicationGuidance: guidance,
      interactionKind: "ask_user_questions",
      interactionStatus: "answered",
      paperclipWake: {
        reason: "issue_commented",
        issue: { ...issue, description },
        comments: [{ id: "comment-q", body: "Which date?", authorType: "agent", authorId: agent.id, createdAt: "2026-11-20T10:00:00.000Z" }],
        commentWindow: { requestedCount: 1, includedCount: 1, missingCount: 0 },
        latestCommentId: "comment-q",
        fallbackFetchNeeded: false,
        questionResponse: { interactionId: "interaction-1", summaryMarkdown: "**Which date?** Monday." },
      },
    }, { issue: { ...issue, description }, interaction: { kind: "ask_user_questions", status: "answered" } })),
  },
  {
    // Step 5 phase 2, the handoff: the payload's history replaces the handoff the loader returns.
    name: "fresh session with history",
    shows: ["## Where things stand", "Your last run on PAP-1 (Nov 20, 09:00 UTC) ended with:", "the task's history is under \"Where things stand\""],
    input: () => {
      const fixture = createPromptContextFixture();
      const comments = fixture.paperclipWake.comments.map(({ id, body }) => ({ id, body }));
      return runInput(withBrief({ ...fixture, paperclipTaskCommunicationGuidance: guidance, paperclipWake: { ...fixture.paperclipWake, history: wakeHistory } }, {
        issue: { ...issue, description: fixture.paperclipWake.issue.description },
        wakeComments: comments,
      }), { loadFreshSessionHandoff: async () => "## Earlier runs\n\nThe ledger was drafted in run prior-run." });
    },
  },
  {
    // A chat task gets no history, so its fresh session keeps the handoff.
    name: "chat turn with a handoff",
    shows: ["## Earlier runs", "This is a new session; the handoff above has the task's history."],
    input: () => runInput(withBrief({
      conversationMode: true,
      paperclipTaskCommunicationGuidance: `Reply in the chat.\n\n${guidance}`,
      paperclipWake: {
        reason: "issue_commented",
        issue: { ...issue, identifier: "PAP-7", title: "Chat with Ada" },
        comments: [{ id: "chat-1", body: "What's left on the ledger?", authorType: "user", authorId: "user-1", createdAt: "2026-11-20T10:00:00.000Z" }],
        commentWindow: { requestedCount: 1, includedCount: 1, missingCount: 0 },
        latestCommentId: "chat-1",
        fallbackFetchNeeded: false,
      },
    }, {
      issue: { ...issue, id: "chat-issue", identifier: "PAP-7", title: "Chat with Ada", conversationAgentId: agent.id, description: "Not shown." },
      wakeComments: [{ id: "chat-1", body: "What's left on the ledger?" }],
    }), { loadFreshSessionHandoff: async () => "## Earlier runs\n\nThe chat started yesterday." }),
  },
  {
    name: "execution review stage",
    shows: ["You're the reviewer for PAP-1 \"Release ledger\", which an agent worked on.", "Instructions for the review:", "`paperclip_update_task`"],
    input: () => runInput(withBrief({
      paperclipTaskCommunicationGuidance: guidance,
      paperclipWake: {
        reason: "execution_review_requested",
        issue: { ...issue, status: "in_review", description },
        executionStage: {
          wakeRole: "reviewer", stageType: "review", allowedActions: ["approve", "request_changes"],
          currentParticipant: { type: "agent", agentId: agent.id }, returnAssignee: { type: "agent", agentId: "agent-2" },
          reviewRequest: { instructions: "Check the ledger totals." },
        },
        comments: [],
        fallbackFetchNeeded: false,
      },
    }, { issue: { ...issue, description } })),
  },
];

describe("buildClaudeRunPromptPlan", () => {
  it.each(kinds.map((kind) => [kind.name, kind] as const))("joins to today's prompt: %s", async (_name, kind) => {
    const input = kind.input();
    const before = JSON.stringify(input.context);
    const plan = await buildClaudeRunPromptPlan(input);
    expect(plan.version).toBe(1);
    expect(joinRunPromptSections(plan.fresh)).toBe(await sentPrompt(kind.input(), false));
    for (const marker of kind.shows) expect(joinRunPromptSections(plan.fresh)).toContain(marker);
    expect(joinRunPromptSections(plan.resumed)).toBe(await sentPrompt(kind.input(), true));
    expectPartsJoin(plan.fresh);
    expectPartsJoin(plan.resumed);
    // The builder doesn't change the context it was given.
    expect(JSON.stringify(input.context)).toBe(before);
    for (const set of [plan.fresh, plan.resumed]) {
      for (const section of set) {
        expect(section.placement).toBe("first_message");
        expect(section.reason.length).toBeGreaterThan(0);
        expect(section.source.length).toBeGreaterThan(0);
        expect(section.text.length).toBeGreaterThan(0);
      }
      expect(new Set(set.map((section) => section.id)).size).toBe(set.length);
    }
    const wake = plan.fresh.find((section) => section.id === "wake");
    if (wake) expect(wake.parts?.length ?? 0).toBeGreaterThan(0);
    expect(plan.fresh.find((section) => section.id === "task_brief")?.parts?.length ?? 0).toBeGreaterThan(0);
  });

  it("labels a fresh assignment's sections in order, with their delivery", async () => {
    const plan = await buildClaudeRunPromptPlan(kinds[0]!.input());
    expect(plan.fresh.map((section) => section.id)).toEqual([
      "instructions_directive",
      "communication_guidance",
      "wake",
      "task_brief",
      "mcp_note",
      "heartbeat_template",
    ]);
    expect(plan.resumed.map((section) => section.id)).toEqual(["instructions_directive", "wake", "task_brief"]);
    const delivery = Object.fromEntries(plan.fresh.map((section) => [section.id, section.delivery]));
    expect(delivery).toEqual({
      instructions_directive: "every_run",
      communication_guidance: "fresh_only",
      wake: "every_run",
      task_brief: "every_run",
      mcp_note: "fresh_only",
      heartbeat_template: "fresh_only",
    });
    const heartbeat = plan.fresh.find((section) => section.id === "heartbeat_template")!;
    expect(heartbeat.source).toContain("default");
    expect(heartbeat.parts?.map((part) => part.id)).toEqual(["heartbeat_template.identity", "heartbeat_template.connection_guidance"]);
    const brief = plan.fresh.find((section) => section.id === "task_brief")!;
    expect(brief.source).toBe("context: paperclipTaskMarkdownAssignment");
    expect(brief.parts?.map((part) => part.id)).toEqual([
      "task_brief.header",
      "task_brief.question_guidance",
      "task_brief.issue",
      "task_brief.description",
      "task_brief.plan",
      "task_brief.ancestors",
      "task_brief.closing",
    ]);
  });

  it("labels the wake with the claude_local renderer's parts", async () => {
    const plan = await buildClaudeRunPromptPlan(kinds[0]!.input());
    const wake = plan.fresh.find((section) => section.id === "wake")!;
    expect(wake.source).toBe("context: paperclipWake, rendered by renderClaudeWake");
    expect(wake.parts?.map((part) => part.id)).toEqual([
      "wake.what_happened", "wake.event.assigned", "wake.task", "wake.to_do", "wake.common_rules",
    ]);
    expect(wake.parts?.find((part) => part.id === "wake.task")?.text).toContain("already checked out to you");
    for (const set of [plan.fresh, plan.resumed]) {
      const text = joinRunPromptSections(set);
      expect(text).not.toContain("## Paperclip Wake Payload");
      expect(text).not.toContain("Paperclip Resume Delta");
    }
    // An external chat turn keeps the shared renderer, labelled as such.
    const chat = await buildClaudeRunPromptPlan(kinds[4]!.input());
    expect(chat.fresh.find((section) => section.id === "wake")?.source).toContain("renderPaperclipWakePrompt");
  });

  it("labels a chat turn's brief with the chat directive and the completion update", async () => {
    const plan = await buildClaudeRunPromptPlan(kinds[3]!.input());
    const brief = plan.fresh.find((section) => section.id === "task_brief")!;
    expect(brief.parts?.map((part) => part.id)).toEqual([
      "task_brief.header",
      "task_brief.question_guidance",
      "task_brief.issue",
      "task_brief.chat_directive",
      "task_brief.wake_comments",
      "task_brief.closing",
      "task_brief.chat_completion",
    ]);
    expect(brief.parts?.find((part) => part.id === "task_brief.chat_directive")?.text).toContain("Chat mode directive:");
    // The resumed set keeps the whole chat directive (bug 86, reproduced).
    const resumedBrief = plan.resumed.find((section) => section.id === "task_brief")!;
    expect(resumedBrief.parts?.map((part) => part.id)).toContain("task_brief.chat_directive");
    const guidanceSection = plan.fresh.find((section) => section.id === "communication_guidance")!;
    expect(guidanceSection.parts?.map((part) => part.id)).toEqual(["communication_guidance.guidance"]);
  });

  it("splits the communication guidance from the fresh-session handoff", async () => {
    const plan = await buildClaudeRunPromptPlan(kinds[1]!.input());
    const section = plan.fresh.find((entry) => entry.id === "communication_guidance")!;
    expect(section.parts?.map((part) => part.id)).toEqual(["communication_guidance.guidance", "communication_guidance.handoff"]);
    expect(section.reason).toContain("handoff");
    expect(plan.resumed.some((entry) => entry.id === "communication_guidance")).toBe(false);
  });

  it("leaves out the handoff where the wake has the history (step 5 phase 2)", async () => {
    const kind = (name: string) => kinds.find((entry) => entry.name === name)!;
    const plan = await buildClaudeRunPromptPlan(kind("fresh session with history").input());
    const section = plan.fresh.find((entry) => entry.id === "communication_guidance")!;
    expect(section.parts?.map((part) => part.id)).toEqual(["communication_guidance.guidance"]);
    expect(section.reason).not.toContain("handoff follows");
    expect(joinRunPromptSections(plan.fresh)).not.toContain("## Earlier runs");
    const wake = plan.fresh.find((entry) => entry.id === "wake")!;
    expect(wake.parts?.map((part) => part.id)).toEqual(expect.arrayContaining(["wake.where_things_stand", "wake.last_run", "wake.documents"]));
    // A chat task's fresh session keeps it.
    const chat = await buildClaudeRunPromptPlan(kind("chat turn with a handoff").input());
    expect(chat.fresh.find((entry) => entry.id === "communication_guidance")?.parts?.map((part) => part.id))
      .toEqual(["communication_guidance.guidance", "communication_guidance.handoff"]);
  });

  it("a resume that fails and retries fresh: the fresh set has the history and no handoff", async () => {
    // The retry is the fresh set: the builder hydrates the handoff onto the fresh context, as
    // execute.ts does before the retry, and the history still wins.
    const input = kinds.find((entry) => entry.name === "fresh session with history")!.input();
    const plan = await buildClaudeRunPromptPlan(input);
    expect(joinRunPromptSections(plan.fresh)).toBe(await sentPrompt(input, false));
    expect(joinRunPromptSections(plan.fresh)).toContain("## Where things stand");
    expect(joinRunPromptSections(plan.fresh)).not.toContain("The ledger was drafted in run prior-run.");
    expect(joinRunPromptSections(plan.resumed)).not.toContain("## Where things stand");
  });

  it("reproduces the \"null\" brief of a no-task run (bug 84)", async () => {
    const plan = await buildClaudeRunPromptPlan(kinds[7]!.input());
    const brief = plan.fresh.find((section) => section.id === "task_brief")!;
    expect(brief.text).toBe("null");
    expect(brief.reason).toContain("bug 84");
    expect(brief.parts?.map((part) => part.id)).toEqual(["task_brief.null"]);
    expect(plan.fresh.some((section) => section.id === "wake")).toBe(false);
  });

  it("says when the templates are the agent's own settings", async () => {
    const plan = await buildClaudeRunPromptPlan(kinds[6]!.input());
    expect(plan.fresh.find((section) => section.id === "heartbeat_template")).toMatchObject({
      source: "agent setting: promptTemplate", text: "Routine run for Ada (run-1).",
    });
    expect(plan.fresh.find((section) => section.id === "bootstrap_template")).toMatchObject({
      source: "agent setting: bootstrapPromptTemplate", text: "Hello Ada.", delivery: "fresh_only",
    });
    expect(plan.fresh.find((section) => section.id === "heartbeat_template")?.parts).toBeUndefined();
  });

  it("leaves out the MCP note without Paperclip API access, and the directive without an instructions file", async () => {
    const input = runInput(kinds[0]!.input().context, { paperclipApiReachable: false, config: {} });
    const plan = await buildClaudeRunPromptPlan(input);
    expect(plan.fresh.map((section) => section.id)).not.toContain("mcp_note");
    expect(plan.fresh.map((section) => section.id)).not.toContain("instructions_directive");
    expect(joinRunPromptSections(plan.fresh)).toBe(await sentPrompt(input, false));
  });

  it("keeps the handoff the context carries when there is no loader, as the adapter does", async () => {
    const context = { ...kinds[0]!.input().context, paperclipFreshSessionHandoffMarkdown: "Carried handoff." };
    const input = runInput(context, { loadFreshSessionHandoff: undefined });
    const plan = await buildClaudeRunPromptPlan(input);
    expect(joinRunPromptSections(plan.fresh)).toBe(await sentPrompt(input, false));
    expect(joinRunPromptSections(plan.fresh)).toContain("Carried handoff.");
  });

  it("gives the brief an extra part for text a later stage appended", async () => {
    const context = kinds[0]!.input().context;
    // environment-selection.ts appends this note to every variant after the brief was built.
    const note = "shared workspace is concurrently held by run run-2 (issue PAP-2); expect concurrent mutations, coordinate via commits";
    context.paperclipTaskMarkdownAssignment = `${String(context.paperclipTaskMarkdownAssignment).trimEnd()}\n${note}`;
    const plan = await buildClaudeRunPromptPlan(runInput(context));
    const brief = plan.fresh.find((section) => section.id === "task_brief")!;
    expect(brief.parts?.at(-1)).toMatchObject({ id: "task_brief.added", text: `\n${note}` });
    expectPartsJoin(plan.fresh);
  });

  it("drops a section's parts when they don't describe its text", async () => {
    const context = kinds[0]!.input().context;
    context.paperclipTaskMarkdownAssignment = "A different brief.";
    const plan = await buildClaudeRunPromptPlan(runInput(context));
    const brief = plan.fresh.find((section) => section.id === "task_brief")!;
    expect(brief.text).toBe("A different brief.");
    expect(brief.parts).toBeUndefined();
  });
});

// One kind end to end: the context comes from prepareHeartbeatTaskContext itself, with a
// registered secret in the description, so the brief's parts are the redacted ones it stores.
const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;
if (!support.supported) console.warn(`Skipping the prepared-context golden test: ${support.reason}`);

describePostgres("buildClaudeRunPromptPlan on a prepared context", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("run-prompt-builder-");
    db = createDb(temporary.connectionString);
  }, 30_000);

  afterAll(async () => {
    await db?.$client.end({ timeout: 0 });
    await temporary?.cleanup();
  });

  it("joins to today's prompt, with the redacted brief's parts", async () => {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    const secret = "builder-secret-canary";
    const issueDescription = `Sign the ledger with ${secret}.`;
    await db.insert(companies).values({ id: companyId, name: "Builder fixture", issuePrefix: `B${companyId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Ada", adapterType: "claude_local", status: "idle" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Sign the ledger", description: issueDescription,
      status: "todo", assigneeAgentId: agentId, issueNumber: 1 });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, invocationSource: "assignment",
      status: "running", contextSnapshot: { issueId } });
    await createRunSecretRedactionRegistry(db).register(companyId, runId, secret);
    const context: Record<string, unknown> = { issueId, wakeReason: "issue_assigned" };
    await prepareHeartbeatTaskContext(db, {
      run: { id: runId },
      agent: { id: agentId, companyId, adapterType: "claude_local" },
      task: {
        issueRef: { id: issueId, identifier: "BLD-1", title: "Sign the ledger", status: "todo", priority: "medium",
          workMode: "standard", conversationAgentId: null, description: issueDescription, projectId: null },
        issueContext: null,
        context,
        taskSession: null,
      },
      policy: { trustPreset: { kind: "standard" } as never, experimentalInstanceSettings: {} },
      services: { issuesSvc: { getAncestors: async () => [] }, getPinnedSkillTestContext: async () => null },
    });
    const input = runInput(context, { agent: { id: agentId, companyId, name: "Ada" }, runId });
    const plan: RunPromptPlan = await buildClaudeRunPromptPlan(input);
    expect(joinRunPromptSections(plan.fresh)).toBe(await sentPrompt(input, false));
    expect(joinRunPromptSections(plan.resumed)).toBe(await sentPrompt(input, true));
    const brief = plan.fresh.find((section) => section.id === "task_brief")!;
    expect(brief.parts?.map((part) => part.id)).toContain("task_brief.description");
    expect(JSON.stringify(plan)).not.toContain(secret);
    expectPartsJoin(plan.fresh);
    expectPartsJoin(plan.resumed);
  });
});
