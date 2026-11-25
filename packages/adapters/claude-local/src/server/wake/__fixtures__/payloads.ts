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
  /**
   * Run da19589b: answered questions on a resumed session. The comment that woke the run which
   * asked them is an origin of the record, so the resume delta carries it again though that run
   * received it; and the server's summary starts with its own heading.
   */
  answered_after_comment: {
    ...base,
    reason: "issue_commented",
    actor: { type: "user", id: BRIAN },
    issue,
    interactionKind: "ask_user_questions",
    interactionStatus: "answered",
    comments: [{ id: "q-2", body: "Which idea should I take?", createdAt: "2026-11-24T10:30:00.000Z", author: ada }],
    questionResponse: {
      interactionId: "interaction-2",
      summaryMarkdown: "Resolved questions and answers:\n- Idea — Which idea should I take?: Idea 2",
    },
    executionContinuation: continuation({
      originCommentIds: ["da8a07ae"],
      messages: [...history, message("da8a07ae", "Thanks. Go with idea 2.", brian, "2026-11-24T10:00:00.000Z")],
      resumeDelta: { baseRunId: "run-3cca4343", messages: [message("da8a07ae", "Thanks. Go with idea 2.", brian, "2026-11-24T10:00:00.000Z")] },
    }),
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
  /** A person's Retry of a failed run, in a fresh workspace. */
  retry_workspace: {
    ...base,
    reason: "task_retry",
    issue,
    executionContinuation: continuation({
      trigger: { reason: "task_retry", interactionId: null, sourceRunId: null, retriedReason: "issue_commented" },
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
  /** paperclip_report_progress with continue: true (or the assigned-work sweep): no recovery. */
  continue: {
    ...base,
    reason: "issue_continuation_needed",
    issue,
    checkedOutByHarness: true,
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
  /**
   * Run 2bfa012a: a disposition repair whose recovery action is the repair itself, and whose
   * record carries the original assignment as retriedReason (it has a retryOfRunId).
   */
  disposition_repair_with_recovery: {
    ...base,
    reason: "issue_disposition_repair",
    issue,
    checkedOutByHarness: true,
    recovery: {
      cause: "deliberate_wait_without_target", failureSummary: null,
      originalAssignee: { id: SELF, name: "Ada" }, attemptCount: 1, maxAttempts: 2, nextAction: null,
    },
    dispositionRepair: { attempt: 1, maxAttempts: 2, sourceRunId: "run-old", instruction: "Finish, block or report progress." },
    executionContinuation: continuation({
      trigger: { reason: "issue_disposition_repair", interactionId: null, sourceRunId: null, retriedReason: "issue_assigned" },
    }),
    continuationSummary: { body: "# Continuation Summary\n\nToggle added; persistence not started." },
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

// --- The task's history (step 5 phase 2, the handoff) ----------------------------------------

/**
 * Run e365cdbd on TES-45: a fresh session on a task with history, from its recorded first
 * message (the wake's comments, the handoff's run summary and answered question), with plain
 * made-up ids. The user is "Brian" (the design's sketch), the woken agent `SELF`. The request
 * texts and the documents follow the design's sketch; the times are the run's (America/Denver).
 */
const tes45 = { ...issue, id: "issue-tes-45", title: "M7 test wake: dark mode notes", description: "This is a test of how you're woken. Keep each run short.\n\nWrite three one-line ideas for a dark mode toggle in a comment on this task. Then end the run with paperclip_report_progress (without continue), leaving the task open: I'll reply with feedback." };
const tes45Message = (id: string, body: string, author: { type: string; id: string }, createdAt: string) =>
  message(id, body, author, createdAt);
const tes45Messages = [
  tes45Message("c-ideas", "Three dark mode toggle ideas:\n1. A sun/moon icon button in the header that flips theme instantly and remembers the choice in localStorage.\n2. A three-way switch (Light / Dark / System) in settings that follows the OS `prefers-color-scheme` by default.\n3. A keyboard shortcut (e.g. Ctrl+Shift+D) with a brief toast confirming the active theme.", ada, "2026-11-25T00:37:10.000Z"),
  tes45Message("c-posted", "Posted three dark mode toggle ideas in a comment. Leaving the task open for your feedback.", ada, "2026-11-25T00:37:15.000Z"),
  tes45Message("c-already", "Ideas already posted above; waiting on your feedback.", ada, "2026-11-25T00:37:30.000Z"),
  tes45Message("c-still", "Still waiting on board feedback; nothing new to do.", ada, "2026-11-25T00:37:39.608Z"),
  tes45Message("c-no-feedback", "There's still no feedback on TES-45. The three ideas are posted and the task is open. The earlier recovery flag is cleared, so I'm not posting another comment. I'm waiting for your reply.", ada, "2026-11-25T00:37:47.574Z"),
  tes45Message("c-waiting", "Waiting on feedback.", ada, "2026-11-25T00:37:50.828Z"),
  tes45Message("c-three", "Three ideas posted; waiting on board feedback.", ada, "2026-11-25T00:37:58.298Z"),
  tes45Message("c-idea-2", "Thanks. Go with idea 2, the three-way switch. Before you write anything else, ask me one question about it with paperclip_ask_board (give me two or three choices), and wait for my answer.", brian, "2026-11-25T00:39:16.899Z"),
  tes45Message("c-asked", "I asked you one question on TES-45 and I'm waiting for your answer. I haven't written anything else yet.\n\nThe question: where should the Light / Dark / System switch live in the UI? The choices are:\n- Settings page only\n- Header dropdown, always visible\n- Both: header dropdown and settings page", ada, "2026-11-25T00:39:23.519Z"),
  tes45Message("c-approval", "I've requested your approval on TES-45 to build the switch, and I'm waiting for your decision before building anything.\n\nThe request covers a Light / Dark / System switch in both the header dropdown and the settings page, as you answered. System follows the OS `prefers-color-scheme` by default, and the choice is saved in localStorage. I listed one risk: the two entry points must stay in sync with the same stored preference.", ada, "2026-11-25T00:40:06.197Z"),
  tes45Message("c-plan", "Plan for the Light / Dark / System switch:\n1. Store one `theme` preference (`light` | `dark` | `system`) in localStorage, defaulting to `system`.\n2. On load, resolve the theme (using `prefers-color-scheme` for `system`) and set a `data-theme` attribute on the root element; listen for OS changes while on `system`.\n3. Build one shared three-option switch component and render it in both the header dropdown and the settings page, both reading and writing the same stored preference.\n4. Quick manual check: each option applies, the choice survives reload, and the two switches stay in sync.", ada, "2026-11-25T00:40:40.200Z"),
  tes45Message("c-short-plan", "Posted a short plan for the Light/Dark/System switch (header dropdown and settings page, shared stored preference), as approved. No code written.", ada, "2026-11-25T00:40:41.740Z"),
  tes45Message("c-reopen", "Reopening this for one last step: in a single comment, sum up what we agreed (where the switch lives and what you planned), then finish the task.", brian, "2026-11-25T00:41:02.372Z"),
];
const tes45RunSummary = "I posted a four-step plan for the Light / Dark / System switch as a comment on TES-45, and the task is now marked done. I wrote no code, as you asked.\n\nThe plan:\n1. **Storage:** keep one `theme` preference in localStorage, defaulting to `system`.\n2. **Applying it:** on load, resolve the theme and set a `data-theme` attribute on the root element. While on `system`, it follows OS changes.\n3. **UI:** one shared three-option switch component, shown in both the header dropdown and the settings page. Both read and write the same stored preference.\n4. **Check:** each option applies, the choice survives a reload, and the two switches stay in sync.";
/** Today's generated continuation summary: the history leaves it out. */
const tes45ContinuationSummary = `# Continuation Summary\n\n- Issue: TES-45 — M7 test wake: dark mode notes\n- Status: done\n\n## Objective\n\n${tes45.description}\n\n## Recent Concrete Actions\n\n- ${tes45RunSummary}\n\n## Files / Routes Touched\n\n- No file or route paths were detected in the captured run summary.`;

export const brianRef = { type: "user" as const, id: BRIAN };
export const adaRef = { type: "agent" as const, id: SELF };

/** An answered question: "Where should the switch go? → Both places". */
export const answeredQuestion = {
  id: "interaction-where",
  kind: "ask_user_questions",
  status: "answered",
  title: null,
  aboutPlan: false,
  questions: [{
    id: "q-where",
    prompt: "Where should the switch go?",
    options: [
      { id: "settings", label: "Settings page only" },
      { id: "header", label: "Header dropdown" },
      { id: "both", label: "Both places" },
      { id: "paperclip_custom_answer", label: "Other" },
    ],
  }],
  answers: [{ questionId: "q-where", optionIds: ["both"], otherText: null }],
  askedBy: adaRef,
  decidedBy: brianRef,
  askedAt: "2026-11-25T00:39:20.000Z",
  decidedAt: "2026-11-25T00:39:50.000Z",
};

/** An approval linked to the task, approved with a note. */
export const approvedRequest = {
  id: "approval-build",
  kind: "approval",
  status: "approved",
  title: "Build the switch",
  aboutPlan: false,
  outcome: "approved",
  note: "Fine, but plan only.",
  askedBy: adaRef,
  decidedBy: brianRef,
  askedAt: "2026-11-25T00:40:05.000Z",
  decidedAt: "2026-11-25T00:40:25.000Z",
};

export const tes45History = {
  lastRun: {
    runId: "run-ecd990d4", agentId: SELF, ownRun: true, status: "succeeded",
    finishedAt: "2026-11-25T00:40:44.154Z", body: tes45RunSummary, bodyTruncated: false,
  },
  answered: [approvedRequest, answeredQuestion],
  answeredOmitted: 0,
  open: [] as Array<Record<string, unknown>>,
  documents: [{ key: "plan", title: "Plan", inBrief: true }, { key: "notes", title: "Notes", inBrief: false }],
};

export const historyFixtures = {
  /** Run e365cdbd: assigned again on a fresh session, with the task's history. */
  tes45: {
    ...base,
    timeZone: "America/Denver",
    reason: "issue_assigned",
    actor: brianRef,
    issue: tes45,
    comments: [],
    checkedOutByHarness: true,
    executionContinuation: continuation({ issueId: tes45.id, objective: tes45.description, messages: tes45Messages }),
    continuationSummary: { body: tes45ContinuationSummary },
    history: tes45History,
  },
} satisfies Record<string, Record<string, unknown>>;

// --- The task's facts (step 5 phase 2, the task brief) ----------------------------------------

/** Run 28353f5e on TES-45: the plan document as its brief quoted it (revision 1 there). */
export const tes45PlanBody = "# Theme switch plan\n\n1. Store one `theme` preference (light, dark or system) in localStorage, defaulting to system.\n2. Apply it on load with a `data-theme` attribute on the root element.\n3. One shared switch component in the header dropdown and the settings page.\n4. Check each option, reloads and the two switches staying in sync.";

/**
 * `context.paperclipRunTask` as the contract shapes it (fork/step-5-brief-plan.md "The
 * contract"), for `issue` by default: the description, nothing changed, no plan.
 */
export function runTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issueId: issue.id,
    ancestors: [],
    ancestorsOmitted: 0,
    description: issue.description,
    descriptionChangedSinceLastRun: false,
    plan: null,
    workMode: "standard",
    titleNeedsGeneration: false,
    rejectedPlan: null,
    acceptedPlan: null,
    wakeCommentAttachments: [],
    attachmentOmissions: [],
    prefixParts: [],
    compactedSinceLastRun: false,
    ...overrides,
  };
}

export function plan(revisionNumber: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { revisionNumber, body: tes45PlanBody, truncatedFrom: null, changedSinceLastRun: false, ...overrides };
}

export const parents = [
  { identifier: "TES-40", title: "Theme work", status: "in_progress" },
  { identifier: "TES-12", title: "Settings redesign", status: "todo" },
];

/** Run 28353f5e's task facts: TES-45 with its description and plan, for the TES-45 history fixture. */
export const tes45RunTask = runTask({ issueId: tes45.id, description: tes45.description, plan: plan(1) });
