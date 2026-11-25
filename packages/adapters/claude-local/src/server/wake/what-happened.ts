import type { PaperclipWakePayload } from "@paperclipai/adapter-utils/server-utils";
import { COMMENT_OWNING_EVENTS, wakeContinuation, type ClaudeWakeComment, type ClaudeWakeEventKind } from "./events.js";
import {
  actor,
  byline,
  capitalize,
  code,
  commentItem,
  inline,
  jsonData,
  lines,
  list,
  person,
  quoteClaudeWakeText,
  quotedComment,
  t,
  time,
  type Ctx,
  type WakeBlock,
  type WakePartMeta,
} from "./context.js";
import { COMMENTS, EVENTS, HEADINGS, PEOPLE, SESSION_NOTES } from "./templates.js";
import {
  approvalDecisionWords,
  approvalTypeWords,
  livenessWords,
  ownerTypeWords,
  reasonWords,
  recoveryCauseWords,
  statusWords,
} from "./words.js";

/**
 * "What happened": each event, quoted, then the other new comments, the earlier ones, the
 * left-out count and the session note. Each event's rules go to "What to do now".
 */

const EVENT_LABELS: Record<ClaudeWakeEventKind, string> = {
  assigned: "Assigned",
  comment: "New comment",
  mentioned: "Mentioned",
  reopened: "Reopened",
  questions_answered: "Questions answered",
  options_picked: "Options picked",
  plan_accepted: "Plan accepted",
  plan_rejected: "Plan rejected",
  approval: "Approval decided",
  connection_review: "Connection action reviewed",
  review_requested: "Review requested",
  changes_requested: "Changes requested",
  children_done: "Subtasks finished",
  blocker_resolved: "Blocker resolved",
  blocker_stalled: "Subtask stuck",
  comment_edited: "Comment edited",
  interrupted: "Previous run interrupted",
  retry_workspace: "Retry in a fresh workspace",
  retry: "Retry of a failed run",
  run_stopped: "Your last run stopped",
  continue: "Continue the work",
  recovery: "A task needs recovering",
  run_only_planned: "Run only planned",
  run_unfinished: "Run didn't finish properly",
  review_comments: "Open review comments",
  status_changed: "Status changed",
  monitor_due: "Monitor due",
  watchdog: "Watchdog",
  held: "Held or waiting",
  chat_message: "Chat message",
  other: "Other wake",
};

const EVENT_SOURCES: Record<ClaudeWakeEventKind, string> = {
  assigned: "wake payload: reason, actor, issue",
  comment: "wake payload: comments (and a resumed session's resumeDelta)",
  mentioned: "wake payload: reason, comments, issue assignee",
  reopened: "wake payload: reason, comments",
  questions_answered: "wake payload: questionResponse",
  options_picked: "wake payload: checkboxSelection",
  plan_accepted: "wake payload: interaction, planReviewContext",
  plan_rejected: "wake payload: planReviewContext.interaction",
  approval: "wake payload: approval",
  connection_review: "wake payload: agentMessage (tool_action_review)",
  review_requested: "wake payload: executionStage",
  changes_requested: "wake payload: executionStage, comments",
  children_done: "wake payload: childIssueSummaries",
  blocker_resolved: "wake payload: reason",
  blocker_stalled: "wake payload: blockerStall",
  comment_edited: "wake payload: executionContinuation.resumeDelta",
  interrupted: "wake payload: executionContinuation.interruptedRunId",
  retry_workspace: "wake payload: executionContinuation.priorWorkspace, recoveredFiles",
  retry: "wake payload: reason (a retry), executionContinuation.trigger.retriedReason",
  run_stopped: "wake payload: recovery, reason",
  continue: "wake payload: reason (a continuation with no recovery)",
  recovery: "wake payload: recovery, executionContinuation.recoveryOutcomes",
  run_only_planned: "wake payload: livenessContinuation",
  run_unfinished: "wake payload: dispositionRepair",
  review_comments: "wake payload: planReviewContext, documentReviewContext",
  status_changed: "wake payload: reason, actor, issue status",
  monitor_due: "wake payload: reason",
  watchdog: "wake payload: taskWatchdog",
  held: "wake payload: treeHoldInteraction, dependencyBlockedInteraction",
  chat_message: "wake payload: comments, agentMessage",
  other: "wake payload: reason",
};

export const WHAT_HAPPENED_PART_META: WakePartMeta = {
  "wake.what_happened": { label: "What happened", source: "claude_local wake: heading" },
  "wake.comments": { label: "Other new comments", source: "wake payload: comments" },
  "wake.earlier_comments": { label: "Earlier comments", source: "wake payload: comments read by an earlier run, record origin comments" },
  "wake.omitted_comments": { label: "Omitted comments", source: "wake payload: comment window" },
  "wake.session_note": { label: "Session note", source: "claude_local wake: resumed or fresh session" },
};

export interface EventText {
  text: string;
  rules?: readonly string[];
  /** A block of rules (the watchdog mandate), after the event rules' list. */
  ruleBlock?: string;
}

function renderEvent(kind: ClaudeWakeEventKind, ctx: Ctx, owned: ClaudeWakeComment | null): EventText {
  const { wake, taskRef, task } = ctx;
  const data = { taskRef, task };
  switch (kind) {
    case "assigned": {
      const routine = wake.issue?.routineName;
      const who = wake.actor && (wake.actor.type === "user" || wake.actor.type === "agent")
        ? person(ctx, wake.actor.type, wake.actor.id) : null;
      const text = routine
        ? t(EVENTS.assigned.routine, { ...data, routine: inline(routine) })
        : who ? t(EVENTS.assigned.byWho, { ...data, who }) : t(EVENTS.assigned.plain, data);
      return { text, rules: EVENTS.assigned.rules };
    }
    case "comment": {
      const news = ctx.comments.news;
      if (news.length === 1) {
        return {
          text: lines(t(EVENTS.comment.one, { ...data, byline: byline(ctx, news[0]!) }), quotedComment(news[0]!)),
          rules: EVENTS.comment.rulesOne,
        };
      }
      return {
        text: lines(t(EVENTS.comment.many, { ...data, count: news.length }), ...news.map((comment) => commentItem(ctx, comment))),
        rules: EVENTS.comment.rulesMany,
      };
    }
    case "mentioned": {
      const who = owned ? person(ctx, owned.authorType, owned.authorId, true) : actor(ctx);
      const issue = wake.issue;
      const assignee = issue?.assigneeAgentId ? person(ctx, "agent", issue.assigneeAgentId)
        : issue?.assigneeUserId ? person(ctx, "user", issue.assigneeUserId) : null;
      const sentence = assignee
        ? t(EVENTS.mentioned.withAssignee, { ...data, who, assignee })
        : t(EVENTS.mentioned.plain, { ...data, who });
      return { text: lines(sentence, owned && quotedComment(owned)), rules: EVENTS.mentioned.rules.map((rule) => t(rule, data)) };
    }
    case "reopened": {
      const who = owned ? person(ctx, owned.authorType, owned.authorId, true) : actor(ctx);
      return { text: lines(t(EVENTS.reopened.text, { ...data, who }), owned && quotedComment(owned)), rules: EVENTS.reopened.rules };
    }
    case "questions_answered": {
      const response = wake.questionResponse!;
      const who = actor(ctx);
      return {
        text: lines(
          t(wake.issue ? EVENTS.questions_answered.onTask : EVENTS.questions_answered.plain, { ...data, who }),
          quoteClaudeWakeText(answersText(response.summaryMarkdown)),
          response.truncated && EVENTS.questions_answered.cutShort,
        ),
        rules: EVENTS.questions_answered.rules,
      };
    }
    case "options_picked": {
      const selection = wake.checkboxSelection!;
      const picked = selection.selectedOptions.map((option) => `"${inline(option.label || option.id)}"`);
      const labels = picked.length > 0 ? picked : selection.selectedOptionIds.map((id) => `"${inline(id)}"`);
      const who = actor(ctx);
      return {
        text: labels.length > 0
          ? t(EVENTS.options_picked.text, { who, options: list(labels, 20) })
          : t(EVENTS.options_picked.none, { who }),
        rules: EVENTS.options_picked.rules,
      };
    }
    case "plan_accepted": {
      const interaction = wake.planReviewContext?.interaction;
      const revision = interaction?.acceptedTargetRevision?.revisionNumber ?? interaction?.target?.revisionNumber ??
        wake.planReviewContext?.latestRevisionNumber ?? null;
      const who = actor(ctx);
      return {
        text: revision ? t(EVENTS.plan_accepted.withRevision, { who, revision }) : t(EVENTS.plan_accepted.plain, { who }),
        rules: EVENTS.plan_accepted.rules,
      };
    }
    case "plan_rejected": {
      const reason = wake.planReviewContext?.interaction?.result?.reason ?? null;
      const who = actor(ctx);
      return {
        text: reason
          ? lines(t(EVENTS.plan_rejected.withReason, { who }), quoteClaudeWakeText(reason))
          : t(EVENTS.plan_rejected.plain, { who }),
        rules: EVENTS.plan_rejected.rules,
      };
    }
    case "approval":
      return renderApproval(ctx);
    case "connection_review": {
      const message = wake.agentMessage!;
      const tools = [...new Set((message.untrustedToolResults ?? []).map((result) => result.toolName).filter(Boolean))].map(code);
      const who = actor(ctx);
      return {
        text: lines(
          tools.length > 0 ? t(EVENTS.connection_review.withTools, { who, tools: list(tools) }) : t(EVENTS.connection_review.plain, { who }),
          EVENTS.connection_review.message,
          quoteClaudeWakeText(message.text),
          message.untrustedToolResults?.length
            ? `${EVENTS.connection_review.results}\n${jsonData({ untrustedToolResults: message.untrustedToolResults }, 2)}`
            : null,
        ),
        rules: EVENTS.connection_review.rules,
      };
    }
    case "review_requested": {
      const stage = wake.executionStage;
      const role = stage?.wakeRole === "approver" || (!stage?.wakeRole && wake.reason === "execution_approval_requested")
        ? "approver" : "reviewer";
      const principal = stage?.returnAssignee;
      const assignee = principal?.type === "agent" && principal.agentId ? person(ctx, "agent", principal.agentId)
        : principal?.type === "user" && principal.userId ? person(ctx, "user", principal.userId) : null;
      const instructions = stage?.reviewRequest?.instructions?.trim();
      return {
        text: lines(
          assignee
            ? t(EVENTS.review_requested.withAssignee, { ...data, role, assignee })
            : t(EVENTS.review_requested.plain, { ...data, role }),
          instructions && EVENTS.review_requested.instructions,
          instructions && quoteClaudeWakeText(instructions),
        ),
        rules: EVENTS.review_requested.rules,
      };
    }
    case "changes_requested": {
      const who = owned ? person(ctx, owned.authorType, owned.authorId, true) : actor(ctx, PEOPLE.reviewer);
      return {
        text: owned
          ? lines(t(EVENTS.changes_requested.withComment, { ...data, who }), quotedComment(owned))
          : t(EVENTS.changes_requested.plain, { ...data, who }),
        rules: EVENTS.changes_requested.rules,
      };
    }
    case "children_done": {
      const children = wake.childIssueSummaries.map((child) => {
        const ref = child.identifier ?? child.id ?? "a subtask";
        const head = `- ${ref}${child.title ? ` "${inline(child.title)}"` : ""}${child.status ? ` (${statusWords(child.status)})` : ""}`;
        return child.summary
          ? `${head}\n${quoteClaudeWakeText(child.summary).split("\n").map((line) => `  ${line}`).join("\n")}`
          : head;
      });
      return {
        text: lines(t(EVENTS.children_done.text, data), children.join("\n"), wake.childIssueSummaryTruncated && EVENTS.children_done.more),
        rules: EVENTS.children_done.rules.map((rule) => t(rule, data)),
      };
    }
    case "blocker_resolved":
      return { text: t(EVENTS.blocker_resolved.text, data), rules: EVENTS.blocker_resolved.rules.map((rule) => t(rule, data)) };
    case "blocker_stalled": {
      const stall = wake.blockerStall;
      const stalledRef = stall?.stalledIssueIdentifier ?? stall?.stalledIssueId ?? "the stuck task";
      const stalled = stall?.stalledIssueTitle ? `${stalledRef} "${inline(stall.stalledIssueTitle)}"` : stalledRef;
      const relation = stall?.relation === "blocker" ? `a task ${taskRef} is waiting on` : "your subtask";
      const action = stall?.recoveryAction;
      const cause = action?.cause ? recoveryCauseWords(action.cause) : "it waits on a recovery action";
      const sentence = t(EVENTS.blocker_stalled.text, { stalled, relation, cause, owner: ownerTypeWords(action?.ownerType ?? null) });
      return {
        text: action?.nextAction ? `${sentence} ${t(EVENTS.blocker_stalled.nextAction, { nextAction: inline(action.nextAction, 400) })}` : sentence,
        rules: EVENTS.blocker_stalled.rules.map((rule) => t(rule, { ...data, stalledRef })),
      };
    }
    case "comment_edited":
      return {
        text: lines(...ctx.comments.edited.map((comment) => {
          const who = person(ctx, comment.authorType, comment.authorId, true);
          const when = time(ctx, comment.createdAt);
          return lines(
            when ? t(EVENTS.comment_edited.withTime, { who, time: when }) : t(EVENTS.comment_edited.plain, { who }),
            quotedComment(comment),
          );
        })),
        rules: EVENTS.comment_edited.rules,
      };
    case "interrupted":
      return { text: t(EVENTS.interrupted.text, data), rules: EVENTS.interrupted.rules };
    case "retry_workspace": {
      const continuation = wakeContinuation(wake);
      const prior = continuation?.priorWorkspace;
      const files = (paths: string[], total: number) => {
        const shown = paths.slice(0, 20).map(code);
        const rest = Math.max(total, paths.length) - shown.length;
        return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
      };
      const workspace = !prior
        ? EVENTS.retry_workspace.fresh
        : !prior.changedFilesKnown
          ? t(EVENTS.retry_workspace.unknown, { path: prior.path })
          : prior.changedFiles.length === 0 && prior.changedFileCount === 0
            ? t(EVENTS.retry_workspace.unchanged, { path: prior.path })
            : t(EVENTS.retry_workspace.changed, { path: prior.path, files: files(prior.changedFiles, prior.changedFileCount) });
      const recovered = continuation?.recoveredFiles ?? [];
      return {
        text: recovered.length > 0
          ? `${workspace} ${t(EVENTS.retry_workspace.recovered, { files: files(recovered.map((file) => file.path), recovered.length) })}`
          : workspace,
        rules: EVENTS.retry_workspace.rules,
      };
    }
    case "retry": {
      const retried = wakeContinuation(wake)?.trigger?.retriedReason;
      return { text: retried ? t(EVENTS.retry.text, { reason: reasonWords(retried) }) : EVENTS.retry.plain };
    }
    case "run_stopped": {
      const cause = causeText(wake.recovery);
      return {
        text: cause ? t(EVENTS.run_stopped.withCause, { ...data, cause }) : t(EVENTS.run_stopped.plain, data),
        rules: EVENTS.run_stopped.rules,
      };
    }
    case "continue":
      return { text: t(EVENTS.continue.text, data), rules: EVENTS.continue.rules };
    case "recovery":
      return renderRecovery(ctx);
    case "run_only_planned": {
      const liveness = wake.livenessContinuation;
      const state = livenessWords(liveness?.state ?? null);
      return {
        text: liveness?.attempt && liveness.maxAttempts
          ? t(EVENTS.run_only_planned.withAttempt, { ...data, state, attempt: liveness.attempt, maxAttempts: liveness.maxAttempts })
          : t(EVENTS.run_only_planned.text, { ...data, state }),
        rules: EVENTS.run_only_planned.rules,
      };
    }
    case "run_unfinished": {
      const repair = wake.dispositionRepair;
      return {
        text: repair?.attempt && repair.maxAttempts
          ? t(EVENTS.run_unfinished.withAttempt, { ...data, attempt: repair.attempt, maxAttempts: repair.maxAttempts })
          : t(EVENTS.run_unfinished.text, data),
        rules: EVENTS.run_unfinished.rules,
      };
    }
    case "review_comments":
      return renderReviewComments(ctx);
    case "status_changed": {
      const status = wake.issue?.status ? statusWords(wake.issue.status) : "changed";
      const who = wake.actor && (wake.actor.type === "user" || wake.actor.type === "agent")
        ? person(ctx, wake.actor.type, wake.actor.id, true) : null;
      return {
        text: who ? t(EVENTS.status_changed.byWho, { ...data, who, status }) : capitalize(t(EVENTS.status_changed.plain, { ...data, status })),
        rules: wake.issue?.status === "cancelled" ? EVENTS.status_changed.rulesCancelled : EVENTS.status_changed.rules,
      };
    }
    case "monitor_due":
      return { text: t(EVENTS.monitor_due.text, data), rules: EVENTS.monitor_due.rules };
    case "watchdog":
      return renderWatchdog(ctx);
    case "held": {
      const notices: string[] = [];
      if (wake.treeHoldInteraction) notices.push(capitalize(t(EVENTS.held.treeHold, data)));
      if (wake.dependencyBlockedInteraction) {
        const blockers = wake.unresolvedBlockerSummaries.map((blocker) =>
          `${blocker.identifier ?? blocker.id ?? "a task"}${blocker.title ? ` "${inline(blocker.title)}"` : ""}${blocker.status ? ` (${statusWords(blocker.status)})` : ""}`);
        const ids = blockers.length > 0 ? blockers : wake.unresolvedBlockerIssueIds;
        notices.push(capitalize(ids.length > 0
          ? t(EVENTS.held.dependency, { ...data, blockers: list(ids) })
          : t(EVENTS.held.dependencyPlain, data)));
      }
      return { text: notices.join(" ") };
    }
    case "chat_message": {
      const news = ctx.comments.news;
      const message = wake.agentMessage && wake.agentMessage.source !== "tool_action_review" ? wake.agentMessage : null;
      const blocks: string[] = [];
      if (news.length === 1) {
        blocks.push(t(EVENTS.chat_message.one, { byline: byline(ctx, news[0]!) }), quotedComment(news[0]!));
      } else if (news.length > 1) {
        blocks.push(t(EVENTS.chat_message.many, { count: news.length }), ...news.map((comment) => commentItem(ctx, comment)));
      }
      if (message) {
        const source = message.pluginKey ? `${message.source ?? "a plugin"} ${message.pluginKey}` : message.source ?? "a plugin";
        blocks.push(t(EVENTS.chat_message.fromSource, { source: inline(source) }), quoteClaudeWakeText(message.text));
      }
      return { text: lines(...blocks) };
    }
    case "other": {
      const reason = wake.reason ? reasonWords(wake.reason) : null;
      const text = wake.issue
        ? reason ? t(EVENTS.other.withReason, { ...data, reason }) : t(EVENTS.other.onTask, data)
        : reason ? t(EVENTS.other.reasonOnly, { reason }) : EVENTS.other.plain;
      return { text };
    }
  }
}

/**
 * The server's answer summary without its own heading ("Resolved questions and answers:",
 * question-response-delivery.ts), which the wake's sentence already says.
 */
function answersText(summary: string): string {
  const [first, ...rest] = summary.replace(/\r\n?/g, "\n").split("\n");
  const remainder = rest.join("\n").trim();
  return /^\s*resolved questions and answers[:.]?\s*$/i.test(first ?? "") && remainder ? remainder : summary;
}

function causeText(recovery: PaperclipWakePayload["recovery"]): string | null {
  if (!recovery?.cause) return null;
  const words = recoveryCauseWords(recovery.cause);
  return recovery.failureSummary ? `${words} (${inline(recovery.failureSummary, 300)})` : words;
}

function renderApproval(ctx: Ctx): EventText {
  const { wake } = ctx;
  const approval = wake.approval ?? null;
  const status = approval?.status ??
    (wake.reason === "approval_approved" ? "approved" : wake.reason === "approval_rejected" ? "rejected" : "cancelled");
  const decision = approvalDecisionWords(status);
  const who = approval?.decidedByUserId ? person(ctx, "user", approval.decidedByUserId, true) : actor(ctx);
  const sentence = !approval
    ? t(EVENTS.approval.unknown, { decision })
    : approval.summary
      ? t(EVENTS.approval.withSummary, { who, decision, summary: inline(approval.summary), type: approvalTypeWords(approval.type) })
      : t(EVENTS.approval.plain, { who, decision, type: approvalTypeWords(approval.type) });
  const rules = status === "approved"
    ? EVENTS.approval.rulesApproved
    : wake.issue ? EVENTS.approval.rulesDeclined : EVENTS.approval.rulesDeclinedNoTask;
  return {
    text: lines(sentence, approval?.decisionNote && EVENTS.approval.note, approval?.decisionNote && quoteClaudeWakeText(approval.decisionNote)),
    rules,
  };
}

function renderRecovery(ctx: Ctx): EventText {
  const { wake, task, taskRef } = ctx;
  const recovery = wake.recovery;
  const original = recovery?.originalAssignee;
  const assignee = original?.name ?? (original?.id ? ctx.names[`agent:${original.id}`] : undefined) ?? null;
  const cause = causeText(recovery) ?? reasonWords(wake.reason ?? "source_scoped_recovery_action");
  const sentence = assignee
    ? t(EVENTS.recovery.text, { task, assignee, cause })
    : t(EVENTS.recovery.textNoAssignee, { task, cause });
  const attempt = recovery?.attemptCount && recovery.maxAttempts
    ? t(EVENTS.recovery.attempt, { attempt: recovery.attemptCount, maxAttempts: recovery.maxAttempts }) : null;
  const outcomes = wakeContinuation(wake)?.recoveryOutcomes ?? [];
  return {
    text: lines(
      capitalize(attempt ? `${sentence} ${attempt}` : sentence),
      outcomes.length > 0 && `${EVENTS.recovery.outcomes}\n${jsonData(outcomes)}`,
    ),
    rules: EVENTS.recovery.rules.map((rule) => t(rule, { taskRef, assignee: assignee ?? "its assignee" })),
  };
}

type ReviewThread = NonNullable<PaperclipWakePayload["planReviewContext"]>["threads"][number];

function renderThreads(ctx: Ctx, threads: ReviewThread[]): string[] {
  return threads.map((thread) => {
    const selected = inline(thread.selectedText);
    const comments = thread.comments.map((comment) => {
      const item: ClaudeWakeComment = {
        id: comment.id, body: comment.body, bodyTruncated: comment.bodyTruncated, createdAt: comment.createdAt,
        authorType: comment.author?.type ?? null, authorId: comment.author?.id ?? null, seen: false,
      };
      return commentItem(ctx, item);
    });
    return lines(selected ? t(EVENTS.review_comments.thread, { selected }) : EVENTS.review_comments.threadPlain, ...comments);
  });
}

function renderReviewComments(ctx: Ctx): EventText {
  const { wake } = ctx;
  const blocks: string[] = [];
  let cut = false;
  const plan = wake.planReviewContext;
  if (plan && plan.threads.length > 0) {
    blocks.push(plan.latestRevisionNumber
      ? t(EVENTS.review_comments.planRevision, { revision: plan.latestRevisionNumber })
      : EVENTS.review_comments.plan, ...renderThreads(ctx, plan.threads));
    cut ||= plan.truncated || plan.totals.omittedThreadCount > 0 || plan.totals.omittedCommentCount > 0 ||
      plan.threads.some((thread) => thread.commentsTruncated);
  }
  const documents = wake.documentReviewContext?.documents.filter((document) => document.threads.length > 0) ?? [];
  for (const document of documents) {
    blocks.push(t(EVENTS.review_comments.document, { title: inline(document.title ?? document.documentKey ?? "document") }),
      ...renderThreads(ctx, document.threads));
    cut ||= document.truncated || document.threads.some((thread) => thread.commentsTruncated);
  }
  if (wake.documentReviewContext?.truncated) cut = true;
  if (cut) blocks.push(EVENTS.review_comments.cut);
  return {
    text: lines(...blocks),
    rules: [...EVENTS.review_comments.rules, ...(documents.length > 0 ? EVENTS.review_comments.rulesDocument : [])],
  };
}

function renderWatchdog(ctx: Ctx): EventText {
  const watchdog = ctx.wake.taskWatchdog;
  const watched = watchdog
    ? `${watchdog.watchedIssueIdentifier ?? watchdog.watchedIssueId ?? ctx.taskRef}${watchdog.watchedIssueTitle ? ` "${inline(watchdog.watchedIssueTitle)}"` : ""}`
    : ctx.taskRef;
  const leaves = watchdog?.terminalLeafSummaries.map((leaf) => {
    const head = `- ${leaf.identifier ?? leaf.id ?? "a task"}${leaf.title ? ` "${inline(leaf.title)}"` : ""}${leaf.status ? ` (${statusWords(leaf.status)})` : ""}${leaf.role ? ` [${leaf.role}]` : ""}`;
    return leaf.summary ? `${head}\n${quoteClaudeWakeText(leaf.summary).split("\n").map((line) => `  ${line}`).join("\n")}` : head;
  }) ?? [];
  const capabilities = watchdog?.capabilities;
  const capabilityLines: string[] = [];
  if (capabilities?.targetScope) {
    const scope = capabilities.targetScope;
    capabilityLines.push(`- ${t(EVENTS.watchdog.targetScope, {
      watched: scope.watchedIssueIdentifier ?? scope.watchedIssueId ?? watched,
      descendants: scope.includeNonWatchdogDescendants ? "the tasks under it" : "no tasks under it",
    })}`);
    if (scope.watchdogIssueId) capabilityLines.push(`- ${t(EVENTS.watchdog.reusableIssue, { id: scope.watchdogIssueId })}`);
    if (scope.excludedOriginKinds.length > 0) capabilityLines.push(`- ${t(EVENTS.watchdog.excludedOrigins, { kinds: scope.excludedOriginKinds.join(", ") })}`);
  }
  if (capabilities?.operations.length) capabilityLines.push(`- ${t(EVENTS.watchdog.allowed, { operations: capabilities.operations.join(", ") })}`);
  if (capabilities?.deniedOperations.length) capabilityLines.push(`- ${t(EVENTS.watchdog.denied, { operations: capabilities.deniedOperations.join(", ") })}`);
  const instructions = watchdog?.customInstructions?.trim();
  return {
    text: lines(
      t(EVENTS.watchdog.text, { watched }),
      leaves.length > 0 && `${EVENTS.watchdog.leaves}\n\n${leaves.join("\n")}`,
      capabilityLines.length > 0 && `${EVENTS.watchdog.capabilities}\n\n${capabilityLines.join("\n")}`,
    ),
    ruleBlock: lines(
      EVENTS.watchdog.mandate,
      instructions ? `${EVENTS.watchdog.instructions}\n\n${quoteClaudeWakeText(instructions)}` : EVENTS.watchdog.noInstructions,
    ),
  };
}

/** "What happened", and the rules its events bring to "What to do now". */
export interface WhatHappened {
  blocks: WakeBlock[];
  /** Each event's rules, without repeats, in event order. */
  rules: string[];
  /** Blocks of rules (the watchdog mandate), after the rules' list. */
  ruleBlocks: string[];
}

/**
 * The heading, each event, the other new comments, the earlier ones, the left-out count and the
 * session note. `whereRendered`: "Where things stand" follows, which the session note points at.
 */
export function renderWhatHappened(ctx: Ctx, events: readonly ClaudeWakeEventKind[], whereRendered: boolean): WhatHappened {
  const { wake, options } = ctx;
  const blocks: WakeBlock[] = [{ id: "wake.what_happened", text: HEADINGS.whatHappened }];

  // A comment-owning event (mentioned, reopened, changes requested) quotes the latest comment;
  // any others follow as "Other new comments".
  const news = ctx.comments.news;
  const owner = events.find((kind) => COMMENT_OWNING_EVENTS.has(kind));
  const commentsQuoted = events.includes("comment") || events.includes("chat_message");
  const owned = owner && !commentsQuoted ? news.at(-1) ?? null : null;
  const rules: string[] = [];
  const ruleBlocks: string[] = [];
  for (const kind of events) {
    const rendered = renderEvent(kind, ctx, owned);
    blocks.push({ id: `wake.event.${kind}`, text: rendered.text, label: EVENT_LABELS[kind], source: EVENT_SOURCES[kind] });
    for (const rule of rendered.rules ?? []) if (!rules.includes(rule)) rules.push(rule);
    if (rendered.ruleBlock) ruleBlocks.push(rendered.ruleBlock);
  }
  const others = commentsQuoted ? [] : news.filter((comment) => comment !== owned);
  if (others.length > 0) {
    blocks.push({ id: "wake.comments", text: lines(t(COMMENTS.others, { taskRef: ctx.taskRef }), ...others.map((comment) => commentItem(ctx, comment))) });
    const rule = others.length === 1 ? EVENTS.comment.rulesOne[0] : EVENTS.comment.rulesMany[0];
    if (!rules.includes(rule)) rules.push(rule);
  }
  if (ctx.comments.earlier.length > 0) {
    blocks.push({ id: "wake.earlier_comments", text: lines(t(COMMENTS.earlier, { taskRef: ctx.taskRef }),
      ...ctx.comments.earlier.map((comment) => commentItem(ctx, comment))) });
  }
  const omitted = Math.max(wake.missingCount, wake.cutCount);
  if (omitted > 0) {
    blocks.push({ id: "wake.omitted_comments", text: omitted === 1
      ? t(COMMENTS.omittedOne, { taskRef: ctx.taskRef })
      : t(COMMENTS.omitted, { taskRef: ctx.taskRef, count: omitted }) });
  }
  // With the payload's history, the handoff isn't sent (legacy-prompt.ts); the note points at
  // "Where things stand" when it renders, and says nothing when it doesn't.
  const sessionNote = options.resumedSession
    ? SESSION_NOTES.resumed
    : wake.history
      ? whereRendered ? SESSION_NOTES.freshWithHistory : null
      : options.handoffPresent ? SESSION_NOTES.freshWithHandoff : null;
  if (sessionNote) blocks.push({ id: "wake.session_note", text: sessionNote });
  return { blocks, rules, ruleBlocks };
}
