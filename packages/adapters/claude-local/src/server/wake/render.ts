import {
  asString,
  joinPaperclipPromptParts,
  normalizePaperclipWakePayload,
  parseObject,
  renderTemplate,
  type PaperclipPromptPart,
  type PaperclipPromptPartMeta,
  type PaperclipWakePayload,
} from "@paperclipai/adapter-utils/server-utils";
import {
  COMMENT_OWNING_EVENTS,
  detectClaudeWakeEvents,
  selectClaudeWakeComments,
  wakeContinuation,
  type ClaudeWakeComment,
  type ClaudeWakeComments,
  type ClaudeWakeEventKind,
  type ClaudeWakeRenderOptions,
} from "./events.js";
import {
  COMMENTS,
  COMMON_RULES,
  EVENTS,
  HEADINGS,
  HISTORY,
  INTERACTION_LANGUAGE,
  PEOPLE,
  SESSION_NOTES,
  TASK_LINE,
  WHERE_THINGS_STAND,
} from "./templates.js";
import {
  approvalDecisionWords,
  approvalTypeWords,
  livenessWords,
  ownerTypeWords,
  reasonWords,
  recoveryCauseWords,
  requestDecisionWords,
  requestNounWords,
  runEndingWords,
  statusWords,
} from "./words.js";

/**
 * The claude_local wake (step 5 phase 2, fork/step-5-wake.md "The shape"): what happened, quoted;
 * where things stand on a fresh session or a recovery; the task in one line; and what to do now.
 * Pure: the CLI (`composeClaudeCliPrompt`) sends `renderClaudeWake`'s text and the run prompt
 * builder labels `renderClaudeWakeParts`, which join to it exactly. The shared
 * `renderPaperclipWakePrompt` stays for ACP and the dormant adapters.
 */

export type { ClaudeWakeEventKind, ClaudeWakeRenderOptions } from "./events.js";
export { detectClaudeWakeEvents } from "./events.js";

/**
 * About 12,000 characters of earlier comments on a fresh session (the spec's cap); with the
 * payload's history, of the whole "Where things stand" section.
 */
export const CLAUDE_WAKE_HISTORY_CAP = 12_000;

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

const PART_META: Readonly<Record<string, PaperclipPromptPartMeta>> = {
  "wake.what_happened": { label: "What happened", source: "claude_local wake: heading" },
  "wake.comments": { label: "Other new comments", source: "wake payload: comments" },
  "wake.earlier_comments": { label: "Earlier comments", source: "wake payload: comments read by an earlier run, record origin comments" },
  "wake.omitted_comments": { label: "Omitted comments", source: "wake payload: comment window" },
  "wake.session_note": { label: "Session note", source: "claude_local wake: resumed or fresh session" },
  "wake.where_things_stand": { label: "Where things stand", source: "wake payload: history (older payloads: continuationSummary), executionContinuation.messages" },
  "wake.last_run": { label: "Last run's summary", source: "wake payload: history.lastRun" },
  "wake.requests": { label: "Answered requests", source: "wake payload: history.answered, history.answeredOmitted" },
  "wake.open_requests": { label: "Open requests", source: "wake payload: history.open" },
  "wake.documents": { label: "Task documents", source: "wake payload: history.documents" },
  "wake.history_comments": { label: "The task's comments", source: "wake payload: executionContinuation.messages" },
  "wake.task": { label: "The task", source: "wake payload: issue, checkedOutByHarness, executionWorkspace" },
  "wake.to_do": { label: "What to do now", source: "claude_local wake: each event's rules" },
  "wake.common_rules": { label: "Rules every wake keeps", source: "claude_local wake: common rules" },
  "wake.interaction_language": { label: "Interaction language", source: "wake payload: simplifiedEnglishInteractions (experimental setting)" },
  "wake.connection_instructions": { label: "Connection instructions", source: "wake payload: connectionInstructions" },
  "wake.mcp_app_context": { label: "MCP app context", source: "wake payload: mcpAppContext" },
};

// --- Text helpers ------------------------------------------------------------------

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Every line as a Markdown quote, so quoted text can't pass for a heading or a rule. */
export function quoteClaudeWakeText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(CONTROL_CHARACTERS, "").trim().split("\n");
  if (lines.length === 1 && !lines[0]) return "> (empty)";
  return lines.map((line) => (line.trimEnd() ? `> ${line.trimEnd()}` : ">")).join("\n");
}

/** A fenced block that the text inside can't close. */
function fenced(text: string, info = "text"): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${info}\n${text}\n${fence}`;
}

function jsonData(value: unknown, indent?: number): string {
  return fenced(JSON.stringify(value, (_key, entry) =>
    entry === null ? undefined : typeof entry === "string" ? entry.replace(CONTROL_CHARACTERS, "") : entry, indent,
  ).replace(/</g, "\\u003c").replace(/>/g, "\\u003e"), "json");
}

/** Inline text: one line, capped. */
function inline(text: string, max = 200): string {
  const flat = text.replace(CONTROL_CHARACTERS, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function code(text: string): string {
  return `\`${inline(text).replace(/`/g, "'")}\``;
}

function list(items: string[], max = 10): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

function t(template: string, data: Record<string, unknown> = {}): string {
  return renderTemplate(template, data);
}

function validTimeZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

// --- The wake's context ------------------------------------------------------------

interface Ctx {
  wake: PaperclipWakePayload;
  options: ClaudeWakeRenderOptions;
  comments: ClaudeWakeComments;
  names: Record<string, string>;
  timeZone: string | null;
  taskRef: string;
  task: string;
}

function makeCtx(wake: PaperclipWakePayload, options: ClaudeWakeRenderOptions): Ctx {
  const issue = wake.issue;
  const taskRef = issue?.identifier ?? (issue?.title ? `"${inline(issue.title)}"` : "the task");
  const task = issue?.identifier && issue.title
    ? t(TASK_LINE.titled, { identifier: issue.identifier, title: inline(issue.title) })
    : taskRef;
  return {
    wake,
    options,
    comments: selectClaudeWakeComments(wake, options),
    names: wake.names ?? {},
    timeZone: validTimeZone(wake.timeZone),
    taskRef,
    task,
  };
}

/** A person or agent: "Brian", "the agent Coder", "a person", "you". */
function person(ctx: Ctx, type: string | null | undefined, id: string | null | undefined, start = false): string {
  const text = (() => {
    if (type === "agent") {
      if (id && id === ctx.options.agentId) return PEOPLE.you;
      const name = id ? ctx.names[`agent:${id}`] : undefined;
      return name ? t(PEOPLE.agentNamed, { name }) : PEOPLE.agent;
    }
    if (type === "user") {
      const name = id ? ctx.names[`user:${id}`] : undefined;
      if (name) return name;
      return PEOPLE.person;
    }
    if (type === "system") return PEOPLE.paperclip;
    return PEOPLE.someone;
  })();
  return start ? capitalize(text) : text;
}

/** Who caused the wake, at the start of a sentence; `fallback` when the wake doesn't say. */
function actor(ctx: Ctx, fallback: string = PEOPLE.person): string {
  const ref = ctx.wake.actor;
  if (ref && (ref.type === "user" || ref.type === "agent")) return person(ctx, ref.type, ref.id, true);
  return capitalize(fallback);
}

/** "Nov 24, 10:20" in the wake's time zone, or "Nov 24, 10:20 UTC" without one. */
function time(ctx: Ctx, iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const text = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    timeZone: ctx.timeZone ?? "UTC",
  }).format(date);
  return ctx.timeZone ? text : `${text} UTC`;
}

function byline(ctx: Ctx, comment: ClaudeWakeComment): string {
  const when = time(ctx, comment.createdAt);
  const who = person(ctx, comment.authorType, comment.authorId);
  return `${who}${when ? `, ${when}` : ""}${comment.seen ? ` ${COMMENTS.seen}` : ""}`;
}

function quotedComment(comment: ClaudeWakeComment): string {
  return [quoteClaudeWakeText(comment.body), ...(comment.bodyTruncated ? ["", COMMENTS.cutShort] : [])].join("\n");
}

/** "From Brian, Nov 24, 10:20:" and the quote. */
function commentItem(ctx: Ctx, comment: ClaudeWakeComment): string {
  return `${t(COMMENTS.item, { byline: byline(ctx, comment) })}\n\n${quotedComment(comment)}`;
}

// --- Events ------------------------------------------------------------------------

interface EventText {
  text: string;
  rules?: readonly string[];
  /** A block of rules (the watchdog mandate), after the event rules' list. */
  ruleBlock?: string;
}

function lines(...blocks: Array<string | null | undefined | false>): string {
  return blocks.filter((block): block is string => typeof block === "string" && block.length > 0).join("\n\n");
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

// --- Where things stand ------------------------------------------------------------

function renderHistory(ctx: Ctx, history: ClaudeWakeComment[], cap: number = CLAUDE_WAKE_HISTORY_CAP): string | null {
  if (history.length === 0) return null;
  const items = history.map((comment) => commentItem(ctx, comment));
  const total = items.reduce((sum, item) => sum + item.length + 2, 0);
  let kept: number[];
  if (total <= cap) {
    kept = items.map((_, index) => index);
  } else {
    // Keep the original request (the record's objective comment, else the oldest) and as many of
    // the most recent as fit.
    const objective = wakeContinuation(ctx.wake)?.objectiveSource;
    const originalIndex = Math.max(0, objective?.kind === "comment" ? history.findIndex((comment) => comment.id === objective.id) : 0);
    const chosen = new Set([originalIndex]);
    let used = items[originalIndex]!.length;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (chosen.has(index)) continue;
      if (chosen.size > 1 && used + items[index]!.length + 2 > cap) break;
      chosen.add(index);
      used += items[index]!.length + 2;
    }
    kept = [...chosen].sort((left, right) => left - right);
  }
  const blocks: string[] = [WHERE_THINGS_STAND.history];
  for (const [position, index] of kept.entries()) {
    const gap = position > 0 ? index - kept[position - 1]! - 1 : 0;
    if (gap > 0) blocks.push(gap === 1 ? WHERE_THINGS_STAND.historyCutOne : t(WHERE_THINGS_STAND.historyCut, { count: gap }));
    blocks.push(items[index]!);
  }
  return lines(...blocks);
}

interface WhereBlock { id: string; text: string }

/**
 * Fresh sessions only: a resumed session already holds the history, recovery wakes included.
 * With the payload's `history` (step 5 phase 2, the handoff), the section is the task's one
 * history: the last run's summary, its requests, its documents, then the comments, capped at
 * 12,000 characters together. Without it (older payloads), the continuation summary and the
 * comments, as before.
 */
function renderWhereThingsStand(ctx: Ctx): WhereBlock[] {
  if (ctx.options.resumedSession) return [];
  const taskHistory = ctx.wake.history;
  if (taskHistory) return renderTaskHistory(ctx, taskHistory);
  const summary = ctx.wake.continuationSummary;
  const history = renderHistory(ctx, ctx.comments.history);
  if (!summary && !history) return [];
  return [{
    id: "wake.where_things_stand",
    text: lines(
      HEADINGS.whereThingsStand,
      summary && lines(WHERE_THINGS_STAND.summary, quoteClaudeWakeText(summary.body), summary.bodyTruncated && WHERE_THINGS_STAND.summaryCut),
      history,
    ),
  }];
}

/** The run summary's cap, and each request's (the spec's). */
export const CLAUDE_WAKE_RUN_SUMMARY_CAP = 2_000;
export const CLAUDE_WAKE_REQUEST_CAP = 1_000;
/** Room kept under the cap for the comments' heading and their "left out" line. */
const COMMENTS_SLACK = 200;

type TaskHistory = NonNullable<PaperclipWakePayload["history"]>;
type TaskRequest = TaskHistory["answered"][number];

function renderTaskHistory(ctx: Ctx, history: TaskHistory): WhereBlock[] {
  const blocks: WhereBlock[] = [];
  const lastRun = renderLastRun(ctx, history.lastRun);
  if (lastRun) blocks.push({ id: "wake.last_run", text: lastRun });
  if (history.answered.length > 0 || history.answeredOmitted > 0) {
    const more = history.answeredOmitted === 1
      ? HISTORY.answeredMoreOne
      : history.answeredOmitted > 1 ? t(HISTORY.answeredMore, { count: history.answeredOmitted }) : null;
    blocks.push({
      id: "wake.requests",
      text: lines(
        history.answered.length > 0 && lines(HISTORY.answered, history.answered.map((request) => renderAnsweredRequest(ctx, request)).join("\n")),
        more,
      ),
    });
  }
  if (history.open.length > 0) {
    blocks.push({ id: "wake.open_requests", text: history.open.map((request) => renderOpenRequest(ctx, request)).join("\n") });
  }
  const documents = renderDocuments(history.documents);
  if (documents) blocks.push({ id: "wake.documents", text: documents });
  // The comments fill what's left of the cap.
  const used = [HEADINGS.whereThingsStand, ...blocks.map((block) => block.text)].reduce((sum, text) => sum + text.length + 2, 0);
  const comments = renderHistory(ctx, ctx.comments.history, CLAUDE_WAKE_HISTORY_CAP - used - COMMENTS_SLACK);
  if (comments) blocks.push({ id: "wake.history_comments", text: comments });
  if (blocks.length === 0) return [];
  return [{ id: "wake.where_things_stand", text: HEADINGS.whereThingsStand }, ...blocks];
}

/** "you" -> "Your", "the agent Coder" -> "The agent Coder's", no one -> "". */
function whose(ctx: Ctx, ref: { type: string; id: string } | null, start: boolean): string {
  if (!ref) return "";
  const who = person(ctx, ref.type, ref.id);
  const text = who === PEOPLE.you ? "your" : `${who}'s`;
  return start ? capitalize(text) : text;
}

function renderLastRun(ctx: Ctx, run: TaskHistory["lastRun"]): string | null {
  if (!run) return null;
  const when = time(ctx, run.finishedAt);
  const ended = runEndingWords(run.status);
  const data = { taskRef: ctx.taskRef, time: when, ended };
  const sentence = run.ownRun
    ? t(when ? HISTORY.lastRunOwn : HISTORY.lastRunOwnNoTime, data)
    : t(when ? HISTORY.lastRunOther : HISTORY.lastRunOtherNoTime, { ...data, whose: whose(ctx, { type: "agent", id: run.agentId }, true) });
  const cut = run.bodyTruncated || run.body.length > CLAUDE_WAKE_RUN_SUMMARY_CAP;
  const body = run.body.length > CLAUDE_WAKE_RUN_SUMMARY_CAP ? `${run.body.slice(0, CLAUDE_WAKE_RUN_SUMMARY_CAP - 1)}…` : run.body;
  return lines(sentence, quoteClaudeWakeText(body), cut && HISTORY.lastRunCut);
}

/** "Where should the switch go? → Both places", one line per question. */
function answerLines(request: TaskRequest): string | null {
  const questions = request.questions ?? [];
  if (questions.length === 0) return null;
  return questions.map((question) => {
    const answer = request.answers?.find((entry) => entry.questionId === question.id);
    const free = new Set(question.options.filter((option) => /^paperclip_(custom|text)_answer/.test(option.id)).map((option) => option.id));
    const picked = (answer?.optionIds ?? [])
      // The free-text option's typed answer is `otherText`, never its id or "Other" (bug 94's id).
      .filter((id) => !free.has(id) && !/^paperclip_(custom|text)_answer/.test(id))
      .map((id) => {
        const label = question.options.find((option) => option.id === id)?.label;
        return label ? inline(label) : HISTORY.unlistedOption;
      });
    if (answer?.otherText) picked.push(inline(answer.otherText, 600));
    return `${inline(question.prompt, 300)} → ${picked.length > 0 ? picked.join(", ") : HISTORY.noAnswer}`;
  }).join("\n");
}

function requestHead(ctx: Ctx, request: TaskRequest, start: boolean): { noun: string; title: string } {
  const questions = request.questions ?? [];
  const noun = requestNounWords(request.kind, { aboutPlan: request.aboutPlan, questionCount: Math.max(1, questions.length) });
  const titleText = request.title ?? (request.kind === "ask_user_questions" && questions.length === 1 ? questions[0]!.prompt : null);
  const owner = whose(ctx, request.askedBy, start);
  return { noun: owner ? noun : start ? capitalize(noun) : noun, title: titleText ? ` "${inline(titleText).replace(/"/g, "'")}"` : "" };
}

function renderAnsweredRequest(ctx: Ctx, request: TaskRequest): string {
  const { noun, title } = requestHead(ctx, request, true);
  const decision = requestDecisionWords(request.outcome ?? request.status, { aboutPlan: request.aboutPlan });
  const who = request.decidedBy ? person(ctx, request.decidedBy.type, request.decidedBy.id) : null;
  const when = time(ctx, request.decidedAt);
  // A question's title is its answers' line; the head names the question only when it has a title.
  const questionTitle = request.kind === "ask_user_questions" ? (request.title ? title : "") : title;
  const head = t(HISTORY.request, {
    whose: whose(ctx, request.askedBy, true),
    noun,
    title: questionTitle,
    decision,
    by: who ? t(HISTORY.by, { who }) : "",
    on: when ? t(HISTORY.on, { time: when }) : "",
  }).trim();
  const answers = answerLines(request);
  const note = request.note ?? null;
  const quoted = answers ?? note ?? (request.kind === "ask_user_questions" ? null : request.summary ?? null);
  const withWhat = !answers && note ? (request.kind === "approval" ? HISTORY.withNote : HISTORY.withReason) : "";
  const item = (text: string | null, cut: boolean) => {
    if (!text) return `- ${head}${withWhat}.`;
    const quote = quoteClaudeWakeText(text).split("\n").map((line) => `  ${line}`).join("\n");
    return `- ${head}${withWhat}:\n${quote}${cut ? `\n  ${HISTORY.requestCut}` : ""}`;
  };
  let rendered = item(quoted, false);
  if (rendered.length <= CLAUDE_WAKE_REQUEST_CAP || !quoted) return rendered;
  // Over the cap: cut the quoted text so the item, with its "cut short" line, fits.
  let text = quoted;
  for (let attempt = 0; attempt < 4 && rendered.length > CLAUDE_WAKE_REQUEST_CAP; attempt += 1) {
    const over = item(text, true).length - CLAUDE_WAKE_REQUEST_CAP;
    text = `${text.slice(0, Math.max(0, text.length - over - 2)).trimEnd()}…`;
    rendered = item(text, true);
  }
  return rendered;
}

function renderOpenRequest(ctx: Ctx, request: TaskRequest): string {
  const { noun, title } = requestHead(ctx, request, false);
  const owner = whose(ctx, request.askedBy, false);
  const text = `${owner ? `${owner} ` : ""}${noun}${title}`;
  const when = time(ctx, request.askedAt);
  return when ? t(HISTORY.open, { request: text, time: when }) : t(HISTORY.openNoTime, { request: text });
}

function sameName(key: string, title: string): boolean {
  const flat = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  return flat(key) === flat(title);
}

function renderDocuments(documents: TaskHistory["documents"]): string | null {
  if (documents.length === 0) return null;
  const names = documents.map((document) => {
    const name = document.title && !sameName(document.key, document.title)
      ? `${inline(document.key, 100)} ("${inline(document.title, 100).replace(/"/g, "'")}")`
      : inline(document.key, 100);
    return document.inBrief ? t(HISTORY.documentInBrief, { document: name }) : name;
  });
  const rest = documents.filter((document) => !document.inBrief);
  const workflow = rest.some((document) => document.key === "workflow");
  const others = rest.filter((document) => document.key !== "workflow");
  const read = others.length === 0
    ? null
    : documents.some((document) => document.inBrief) ? HISTORY.documentsReadRest : HISTORY.documentsRead;
  return lines([t(HISTORY.documents, { documents: list(names, 20) }), read].filter(Boolean).join(" "), workflow && HISTORY.workflow);
}

// --- The task ----------------------------------------------------------------------

function renderTaskLine(ctx: Ctx): string | null {
  const { wake } = ctx;
  const issue = wake.issue;
  if (!issue) return null;
  const pieces = [ctx.task];
  if (issue.status) pieces.push(t(TASK_LINE.status, { status: statusWords(issue.status) }));
  if (issue.workMode && issue.workMode !== "standard") pieces.push(t(TASK_LINE.workMode, { workMode: issue.workMode.replace(/_/g, " ") }));
  if (wake.checkedOutByHarness) pieces.push(TASK_LINE.checkedOut);
  if (wake.executionWorkspace?.branchName) pieces.push(t(TASK_LINE.branch, { branch: inline(wake.executionWorkspace.branchName).replace(/`/g, "'") }));
  return lines(HEADINGS.task, pieces.join(" · "));
}

// --- The wake ----------------------------------------------------------------------

/** The wake as labelled parts that join, with `joinPaperclipPromptParts`, to `renderClaudeWake`. Null payload: []. */
export function renderClaudeWakeParts(payload: unknown, options: ClaudeWakeRenderOptions): PaperclipPromptPart[] {
  const wake = normalizePaperclipWakePayload(payload);
  if (!wake) return [];
  const ctx = makeCtx(wake, options);
  const events = detectClaudeWakeEvents(wake, options);
  const blocks: Array<{ id: string; text: string; label?: string; source?: string; separator?: string }> = [];
  blocks.push({ id: "wake.what_happened", text: HEADINGS.whatHappened });

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
  const where = renderWhereThingsStand(ctx);
  // With the payload's history, the handoff isn't sent (legacy-prompt.ts); the note points at
  // "Where things stand" when it renders, and says nothing when it doesn't.
  const sessionNote = options.resumedSession
    ? SESSION_NOTES.resumed
    : wake.history
      ? where.length > 0 ? SESSION_NOTES.freshWithHistory : null
      : options.handoffPresent ? SESSION_NOTES.freshWithHandoff : null;
  if (sessionNote) blocks.push({ id: "wake.session_note", text: sessionNote });
  blocks.push(...where);
  const task = renderTaskLine(ctx);
  if (task) blocks.push({ id: "wake.task", text: task });
  const bullets = rules.map((rule) => `- ${rule}`).join("\n");
  const toDo = lines(HEADINGS.toDo, bullets, ...ruleBlocks);
  blocks.push({ id: "wake.to_do", text: toDo });
  blocks.push({
    id: "wake.common_rules",
    text: COMMON_RULES.map((rule) => `- ${rule}`).join("\n"),
    // One list with the event rules, unless a block of rules sits between them.
    separator: bullets && ruleBlocks.length === 0 ? "\n" : "\n\n",
  });
  if (wake.simplifiedEnglishInteractions) blocks.push({ id: "wake.interaction_language", text: INTERACTION_LANGUAGE });
  const raw = parseObject(payload);
  const connectionInstructions = asString(parseObject(raw.connectionInstructions).text, "").trim();
  if (connectionInstructions) blocks.push({ id: "wake.connection_instructions", text: connectionInstructions });
  const mcpAppContext = asString(raw.mcpAppContext, "").trim();
  if (mcpAppContext) blocks.push({ id: "wake.mcp_app_context", text: mcpAppContext });

  return blocks.map((block, index) => ({
    id: block.id,
    label: block.label ?? PART_META[block.id]?.label ?? block.id,
    source: block.source ?? PART_META[block.id]?.source ?? block.id,
    text: `${index > 0 ? block.separator ?? "\n\n" : ""}${block.text}`,
  }));
}

/** The wake's text; "" for a null payload. */
export function renderClaudeWake(payload: unknown, options: ClaudeWakeRenderOptions): string {
  return joinPaperclipPromptParts(renderClaudeWakeParts(payload, options));
}
