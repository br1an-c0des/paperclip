import type { ExecutionContinuationEnvelope } from "@paperclipai/shared";

/**
 * Wake payloads for the claude_local wake's golden tests (render.test.ts): one per event row in
 * fork/step-5-wake.md, as `buildPaperclipWakePayload` stores them in `context.paperclipWake`,
 * with the step 5 phase 2 fields (`names`, `actor`, `approval`, `timeZone`, the issue's assignee
 * and routine) supplied directly. The woken agent is `SELF` ("Ada").
 */

export const SELF = "agent-ada";
export const BRIAN = "user-brian";
export const CODER = "agent-coder";

export const names = {
  [`user:${BRIAN}`]: "Brian",
  [`agent:${SELF}`]: "Ada",
  [`agent:${CODER}`]: "Coder",
  "user:user-sam": "Sam",
};

export const issue = {
  id: "issue-45",
  identifier: "TES-45",
  title: "Add a dark mode toggle",
  description: "Add a toggle to the settings page that switches the app to dark mode.",
  status: "in_progress",
  workMode: "standard",
  priority: "medium",
  assigneeAgentId: SELF,
};

const base = { names, timeZone: "Europe/Berlin", fallbackFetchNeeded: false };

function message(id: string, body: string, author: { type: string; id: string }, createdAt: string, updatedAt = createdAt) {
  return { id, body, authorType: author.type, authorId: author.id, createdAt, updatedAt, deleted: false, sourceTrust: "human" };
}

const brian = { type: "user", id: BRIAN };
const ada = { type: "agent", id: SELF };

export function continuation(overrides: Partial<ExecutionContinuationEnvelope> = {}): ExecutionContinuationEnvelope {
  return {
    version: 1,
    companyId: "company-1",
    issueId: issue.id,
    trigger: { reason: "issue_commented", interactionId: null, sourceRunId: null },
    originCommentIds: [],
    objective: issue.description,
    messages: [],
    interactionOutcomes: [],
    completedWork: null,
    unresolvedInteractionIds: [],
    coverage: { kind: "full_task_history", throughCommentId: null, summaryThroughCommentId: null },
    ...overrides,
  };
}

const remember = message("comment-remember", "Can you make the toggle remember the choice?\nIt resets every time I reload.", brian, "2026-11-24T09:20:00.000Z");
const history = [
  message("comment-request", "Please add a dark mode toggle to the settings page.", brian, "2026-11-22T08:00:00.000Z"),
  message("comment-ada-1", "Added the toggle. It switches the theme on the settings page.", ada, "2026-11-23T15:30:00.000Z"),
];

export const fixtures = {
  assigned: {
    ...base,
    reason: "issue_assigned",
    actor: { type: "user", id: BRIAN },
    issue: { ...issue, status: "todo" },
    comments: [],
    checkedOutByHarness: true,
    executionWorkspace: { branchName: "pc/tes-45" },
  },
  assigned_routine: {
    ...base,
    reason: "issue_assigned",
    actor: { type: "system", id: null },
    issue: { ...issue, identifier: "TES-50", title: "Weekly ledger check", status: "todo", routineName: "Weekly ledger" },
    comments: [],
    checkedOutByHarness: true,
  },
  /** A comment on the agent's own task, on a resumed session (the deep dive's first wake). */
  resumed_comment: {
    ...base,
    reason: "issue_commented",
    actor: { type: "user", id: BRIAN },
    issue,
    comments: [{ id: remember.id, issueId: issue.id, body: remember.body, createdAt: remember.createdAt, author: brian }],
    commentIds: [remember.id],
    latestCommentId: remember.id,
    commentWindow: { requestedCount: 1, includedCount: 1, missingCount: 0 },
    checkedOutByHarness: true,
    executionWorkspace: { branchName: "pc/tes-45" },
    executionContinuation: continuation({
      originCommentIds: [remember.id],
      messages: [...history, remember],
      resumeDelta: { baseRunId: "run-prior", messages: [remember] },
    }),
    continuationSummary: { body: "Toggle added; persistence not started." },
  },
  comments_many: {
    ...base,
    reason: "issue_commented",
    issue,
    comments: [
      { id: "c-1", body: "Use the system setting by default.", createdAt: "2026-11-24T09:00:00.000Z", author: brian },
      { id: "c-2", body: "The icon should be a moon.", createdAt: "2026-11-24T09:05:00.000Z", author: { type: "agent", id: CODER } },
      { id: "c-3", body: "Ignore the moon, use a switch.", createdAt: "2026-11-23T09:10:00.000Z", author: { type: "user", id: "user-unknown" }, readByEarlierTurn: true },
    ],
    commentWindow: { requestedCount: 5, includedCount: 3, missingCount: 2 },
  },
  mentioned: {
    ...base,
    reason: "issue_comment_mentioned",
    issue: { ...issue, id: "issue-46", identifier: "TES-46", title: "Write the theme docs", status: "in_progress", assigneeAgentId: CODER },
    comments: [{ id: "m-1", issueId: "issue-46", body: "@Ada which colour tokens does dark mode use?", createdAt: "2026-11-24T10:00:00.000Z", author: brian }],
  },
  reopened: {
    ...base,
    reason: "issue_reopened_via_comment",
    issue: { ...issue, status: "todo" },
    comments: [{ id: "r-1", body: "The toggle is gone again after the last deploy.", createdAt: "2026-11-24T10:00:00.000Z", author: brian }],
  },
  /** ask_user_questions answered: the agent's own question comment, and the answers. */
  questions_answered: {
    ...base,
    reason: "issue_commented",
    actor: { type: "user", id: BRIAN },
    issue,
    interactionKind: "ask_user_questions",
    interactionStatus: "answered",
    comments: [{ id: "q-1", body: "Two questions before I go on.", createdAt: "2026-11-24T08:00:00.000Z", author: ada }],
    questionResponse: {
      interactionId: "interaction-1",
      summaryMarkdown: "- **Should the setting sync across devices?** No, this device only.\n- **Which default?** Follow the system setting.",
    },
    checkedOutByHarness: true,
  },
  options_picked: {
    ...base,
    reason: "issue_commented",
    actor: { type: "user", id: BRIAN },
    issue,
    interactionKind: "checkbox",
    interactionStatus: "answered",
    checkboxSelection: {
      prompt: "Which pages get dark mode first?",
      selectedOptionIds: ["settings", "editor"],
      selectedOptions: [{ id: "settings", label: "Settings" }, { id: "editor", label: "Editor" }],
    },
  },
  plan_accepted: {
    ...base,
    reason: "issue_commented",
    actor: { type: "user", id: BRIAN },
    issue: { ...issue, workMode: "planning" },
    interactionKind: "request_confirmation",
    interactionStatus: "accepted",
    planReviewContext: {
      documentKey: "plan", issueId: issue.id, latestRevisionNumber: 3, threads: [],
      interaction: { kind: "request_confirmation", status: "accepted", acceptedTargetRevision: { key: "plan", revisionNumber: 3 } },
    },
  },
  plan_rejected: {
    ...base,
    reason: "issue_commented",
    actor: { type: "user", id: BRIAN },
    issue: { ...issue, workMode: "planning" },
    interactionKind: "request_confirmation",
    interactionStatus: "rejected",
    planReviewContext: {
      documentKey: "plan", issueId: issue.id, latestRevisionNumber: 2, threads: [],
      interaction: { kind: "request_confirmation", status: "rejected", result: { outcome: "rejected", reason: "Split the theme tokens out first." } },
    },
  },
  approval_approved: {
    ...base,
    reason: "approval_approved",
    actor: { type: "user", id: BRIAN },
    issue,
    comments: [],
    approval: {
      id: "approval-1",
      type: "permission_request",
      summary: "Use the GitHub connection to open a pull request",
      status: "approved",
      decisionNote: "Fine, but keep the PR small.",
      decidedByUserId: BRIAN,
    },
  },
  approval_cancelled_no_task: {
    ...base,
    reason: "approval_cancelled",
    actor: { type: "user", id: BRIAN },
    approval: { id: "approval-2", type: "hire_agent", summary: null, status: "cancelled", decisionNote: null, decidedByUserId: null },
  },
  connection_review: {
    ...base,
    reason: "issue_commented",
    actor: { type: "user", id: BRIAN },
    issue,
    agentMessage: {
      text: "There is 1 recorded connection outcome. Do not execute the actions again.\n\nAction request ar-1: The user approved the action.",
      source: "tool_action_review",
      untrustedToolResults: [{ actionRequestId: "ar-1", toolName: "github.create_pull_request", resultSummary: "Opened PR #12", error: null, declineReason: null }],
    },
  },
  review_requested: {
    ...base,
    reason: "execution_review_requested",
    issue: { ...issue, status: "in_review", assigneeAgentId: SELF },
    comments: [],
    executionStage: {
      wakeRole: "reviewer", stageType: "review", allowedActions: ["approve", "request_changes"],
      currentParticipant: { type: "agent", agentId: SELF }, returnAssignee: { type: "agent", agentId: CODER },
      reviewRequest: { instructions: "Check the toggle works in both themes and that the choice survives a reload." },
    },
  },
  changes_requested: {
    ...base,
    reason: "execution_changes_requested",
    issue,
    comments: [{ id: "cr-1", body: "The toggle doesn't work in Safari.", createdAt: "2026-11-24T11:00:00.000Z", author: { type: "agent", id: CODER } }],
    executionStage: { wakeRole: "executor", stageType: "review", lastDecisionOutcome: "changes_requested", allowedActions: [] },
  },
  children_done: {
    ...base,
    reason: "issue_children_completed",
    issue,
    childIssueSummaries: [
      { id: "child-1", identifier: "TES-47", title: "Theme tokens", status: "done", summary: "Added the dark tokens." },
      { id: "child-2", identifier: "TES-48", title: "Toggle UI", status: "cancelled", summary: null },
    ],
  },
  blocker_resolved: {
    ...base,
    reason: "issue_blockers_resolved",
    issue: { ...issue, status: "todo" },
  },
  blocker_stalled: {
    ...base,
    reason: "issue_blocker_stalled",
    issue,
    blockerStall: {
      stalledIssueId: "child-1", stalledIssueIdentifier: "TES-47", stalledIssueTitle: "Theme tokens", stalledIssueStatus: "blocked",
      relation: "child",
      recoveryAction: { kind: "stranded", cause: "process_lost", status: "escalated", ownerType: "board", nextAction: "Press Retry on TES-47." },
    },
  },
  comment_edited: {
    ...base,
    reason: "issue_commented",
    issue,
    comments: [],
    executionContinuation: continuation({
      messages: [...history],
      resumeDelta: {
        baseRunId: "run-prior",
        messages: [message("comment-request", "Please add a dark mode toggle to the settings page and the editor.", brian, "2026-11-22T08:00:00.000Z", "2026-11-24T09:00:00.000Z")],
      },
    }),
  },
  interrupted: {
    ...base,
    reason: "issue_assigned",
    issue,
    checkedOutByHarness: true,
    executionContinuation: continuation({ trigger: { reason: "issue_assigned", interactionId: null, sourceRunId: null }, interruptedRunId: "run-old" }),
  },
  retry_workspace: {
    ...base,
    reason: "issue_assigned",
    issue,
    executionContinuation: continuation({
      trigger: { reason: "issue_assigned", interactionId: null, sourceRunId: null, retriedReason: "issue_commented" },
      priorWorkspace: {
        sourceRunId: "run-old", path: "/work/old/tes-45", branchName: "pc/tes-45", changedFilesKnown: true, changedFileCount: 2,
        changedFiles: ["src/theme.ts", "src/settings.tsx"],
      },
    }),
  },
  run_stopped: {
    ...base,
    reason: "issue_continuation_needed",
    issue,
    recovery: {
      cause: "process_lost", failureSummary: "the process exited with code 137",
      originalAssignee: { id: SELF, name: "Ada" }, attemptCount: 1, maxAttempts: 3, nextAction: "retry",
    },
    continuationSummary: { body: "Toggle added; persistence half done in src/theme.ts." },
  },
  recovery: {
    ...base,
    reason: "source_scoped_recovery_action",
    issue: { ...issue, assigneeAgentId: CODER },
    recovery: {
      cause: "configuration_incomplete", failureSummary: null,
      originalAssignee: { id: CODER, name: "Coder" }, attemptCount: 2, maxAttempts: 3, nextAction: "fix",
    },
    executionContinuation: continuation({ recoveryOutcomes: [{ recoveryActionId: "ra-1", decision: { outcome: "restored" } }] }),
  },
  run_only_planned: {
    ...base,
    reason: "run_liveness_continuation",
    issue,
    livenessContinuation: { attempt: 1, maxAttempts: 2, state: "plan_only", instruction: "Take the first concrete action now." },
  },
  run_unfinished: {
    ...base,
    reason: "issue_disposition_repair",
    issue,
    dispositionRepair: { attempt: 1, maxAttempts: 2, sourceRunId: "run-old", instruction: "Finish, block or report progress." },
  },
  review_comments: {
    ...base,
    reason: "issue_commented",
    issue: { ...issue, workMode: "planning" },
    planReviewContext: {
      documentKey: "plan", issueId: issue.id, latestRevisionNumber: 2,
      threads: [{ id: "thread-1", status: "open", selectedText: "Ship on Friday", comments: [{ id: "pc-1", body: "Friday is too soon.", author: brian, createdAt: "2026-11-24T09:00:00.000Z" }] }],
    },
    documentReviewContext: {
      documents: [{ documentKey: "notes", title: "Release notes", latestRevisionNumber: 1,
        threads: [{ id: "doc-thread-1", status: "open", selectedText: "v2", comments: [{ id: "dc-1", body: "Say v2.1.", author: brian, createdAt: "2026-11-24T09:30:00.000Z" }] }] }],
    },
  },
  status_changed: {
    ...base,
    reason: "issue_status_changed",
    actor: { type: "user", id: BRIAN },
    issue: { ...issue, status: "cancelled" },
  },
  monitor_due: {
    ...base,
    reason: "issue_monitor_due",
    issue,
  },
  watchdog: {
    ...base,
    reason: "task_watchdog_stopped_subtree",
    issue: { ...issue, identifier: "TES-60", title: "Watchdog: TES-45" },
    taskWatchdog: {
      watchedIssueId: issue.id, watchedIssueIdentifier: "TES-45", watchedIssueTitle: issue.title,
      terminalLeafSummaries: [{ id: "child-1", identifier: "TES-47", title: "Theme tokens", status: "blocked", summary: "Waiting for approval." }],
      customInstructions: "Don't reopen design tasks.",
    },
  },
  held: {
    ...base,
    reason: "issue_commented",
    issue,
    comments: [{ id: "h-1", body: "Any news?", createdAt: "2026-11-24T09:00:00.000Z", author: brian }],
    dependencyBlockedInteraction: true,
    unresolvedBlockerSummaries: [{ id: "child-1", identifier: "TES-47", title: "Theme tokens", status: "in_progress" }],
  },
  chat_message: {
    ...base,
    reason: "issue_commented",
    issue: { ...issue, identifier: "TES-70", title: "Chat with Ada" },
    comments: [{ id: "chat-1", body: "What's left on the toggle?", createdAt: "2026-11-24T09:00:00.000Z", author: brian }],
  },
  /** A timer wake on a task: no news fields. */
  other: {
    ...base,
    reason: "heartbeat_timer",
    issue,
  },
  /** A fresh session on a task with history: the deep dive's fresh comment wake. */
  fresh_with_history: {
    ...base,
    reason: "issue_commented",
    issue,
    comments: [{ id: remember.id, body: remember.body, createdAt: remember.createdAt, author: brian }],
    checkedOutByHarness: true,
    executionContinuation: continuation({ messages: [...history, remember] }),
    continuationSummary: { body: "Toggle added; persistence not started." },
  },
  /** Review Focus 4: a comment, answered questions and a checkout, merged into one wake. */
  merged: {
    ...base,
    reason: "issue_commented",
    actor: { type: "user", id: BRIAN },
    issue,
    interactionKind: "ask_user_questions",
    interactionStatus: "answered",
    comments: [{ id: "mg-1", body: "Also, keep the old light theme as the default.", createdAt: "2026-11-24T10:00:00.000Z", author: brian }],
    questionResponse: { interactionId: "interaction-1", summaryMarkdown: "- **Sync across devices?** No." },
    checkedOutByHarness: true,
  },
} satisfies Record<string, Record<string, unknown>>;

export type WakeFixtureName = keyof typeof fixtures;
