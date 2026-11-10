import type { AttentionItem, AttentionSubject } from "@paperclipai/shared";
import { changedTargets, isArchiveProposal } from "@/requests/decision-model";
import { planLabel, planReviewTarget, type Request, type RequestKind } from "@/requests/request-model";
import { feedKind } from "./inbox-model";

/*
 * Board 14b's collapsed request row: what a Needs you card keeps when it's folded to one line.
 *
 * - The kind's colour (stripe and pill), with the pill naming the specific type: Tool call, Plan
 *   review, Budget stop, Hire, Sign-off…
 * - One title: the request's own, except a sign-off's, which is its task's (every sign-off is titled
 *   "Your sign-off is needed"). A questions card lists up to three of its questions, then "+ n more".
 * - Who's asking (an avatar), the task ID and the age.
 * - Only the signs that change what you do first: an expiry under a day (red under an hour), Blocks
 *   when the request's task is Blocked, then the kind's own: "3 questions", "Plan v2", "Pick from 4",
 *   "4 items", "Task changed", "3 options", "3 tasks", "$80.25 of $80", "Outside agent",
 *   "Step 1 of 2", "No reviewer", "Waiting on …" (a quieter row), and once settled "Partly applied",
 *   "Failed", or "Sign-in needed" for an approved app call waiting on its app (U99, #20340).
 *
 * A row is drawn from the attention feed at once (`AttentionItem.detail` carries the question count,
 * the first question and the suggested-task count) and fills in when the request loads.
 *
 * Who a request belongs to (`owner`, for grouping by agent): whoever asked, except a budget stop,
 * which belongs to the agent it paused. People and outside agents share one group; what Paperclip
 * raised itself (stuck work, budget stops on a project) has its own.
 */

export type SignTone = "plain" | "soon" | "time" | "warn" | "wait" | "bad" | "mid" | "block";
export type SignIcon = "clock" | "warn" | "block" | "plan";
export type RowSign = { tone: SignTone; icon?: SignIcon; text: string };

export type RowWho =
  | { kind: "agent"; agentId: string; name: string }
  | { kind: "person"; userId: string; name: string }
  | { kind: "outside"; name: string }
  | { kind: "paperclip" };

export type RowOwner = { kind: "agent"; agentId: string; name: string } | { kind: "paperclip" } | { kind: "people" };

export type RowModel = {
  kind: RequestKind;
  type: string;
  title: string;
  /** A questions card's questions, up to three; `moreQuestions` counts the rest. */
  questions: string[];
  moreQuestions: number;
  signs: RowSign[];
  who: RowWho | null;
  owner: RowOwner;
  /** Under a day left; `soon` under an hour. Also the first sign. */
  expiry: { text: string; soon: boolean } | null;
  /** The request's task is Blocked. */
  blocks: boolean;
  waiting: boolean;
  settled: boolean;
  /** When it was asked, for the age. */
  at: Date;
};

export type RowInput = {
  item: AttentionItem;
  request?: Request | null;
  /** The task it's about (`Inbox.taskOf`), for Blocks. */
  task?: Pick<AttentionSubject, "identifier" | "title" | "status"> | null;
  now?: Date;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SHOWN_QUESTIONS = 3;

/** "38m left", "6h left"; nothing a day or more out. Soon (red) under an hour. */
export function rowExpiry(at: Date | null, now: Date): RowModel["expiry"] {
  if (!at) return null;
  const ms = at.getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return { text: "Expired", soon: true };
  if (ms >= DAY) return null;
  if (ms < HOUR) return { text: `${Math.max(1, Math.ceil(ms / MINUTE))}m left`, soon: true };
  return { text: `${Math.floor(ms / HOUR)}h left`, soon: false };
}

/** "now", "6m", "5h", "3d", then "Oct 18". */
export function shortAge(at: Date, now: Date) {
  const minutes = Math.floor((now.getTime() - at.getTime()) / MINUTE);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}

/** "$80", "$80.25", "$1,250". */
export function money(cents: number) {
  const dollars = cents / 100;
  const whole = Number.isInteger(dollars);
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const plain = (text: string): RowSign => ({ tone: "plain", text });

const APPROVAL_TYPE: Record<string, string> = {
  hire_agent: "Hire",
  budget_override_required: "Budget stop",
  approve_ceo_strategy: "CEO strategy",
  request_board_approval: "Board approval",
};

/** The specific type a loaded request's pill names. */
export function requestType(request: Request): string {
  const source = request.source;
  switch (source.type) {
    case "interaction": {
      const interaction = source.interaction;
      switch (interaction.kind) {
        case "ask_user_questions":
          return (interaction.payload.questions?.length ?? 0) > 1 ? "Questions" : "Question";
        case "request_confirmation":
          if (interaction.payload.toolAction) return "Tool call";
          if (interaction.payload.secretProposal) return "Secret";
          return planReviewTarget(interaction) ? "Plan review" : "Confirm";
        case "request_checkbox_confirmation":
          return "Pick several";
        case "request_item_verdicts":
          return "Verdicts";
        case "suggest_tasks":
          return "Suggested tasks";
        case "connection_intent":
          if (interaction.payload.accessRequest) return "App access";
          return interaction.payload.purpose === "ai" ? "AI connection" : "Connection";
        default:
          return request.kind === "proposal" ? "Proposal" : "Question";
      }
    }
    case "approval":
      return APPROVAL_TYPE[source.approval.type] ?? "Approval";
    case "review":
      return "Sign-off";
    case "decision":
      return isArchiveProposal(source.decision) ? "Archive" : "Proposal";
    case "join":
      return "Join request";
  }
}

/** The type from the feed alone, before the request loads. */
export function feedType(item: Pick<AttentionItem, "sourceKind" | "subject" | "detail">): string {
  const detail = item.detail;
  switch (item.sourceKind) {
    case "issue_thread_interaction": {
      if (item.subject.metadata?.kind === "connection_intent") return "Connection";
      switch (detail?.kind) {
        case "questions":
          return detail.questionCount > 1 ? "Questions" : "Question";
        case "plan_approval":
          return "Plan review";
        case "confirmation":
          return "Confirm";
        case "suggested_tasks":
          return "Suggested tasks";
        case "checkbox_confirmation":
          return "Pick several";
        case "item_verdicts":
          return "Verdicts";
      }
      return feedKind(item) === "proposal" ? "Proposal" : "Question";
    }
    case "approval": {
      const type = detail?.kind === "approval" ? detail.approvalType : item.subject.metadata?.type;
      return (typeof type === "string" && APPROVAL_TYPE[type]) || "Approval";
    }
    case "review":
      return "Sign-off";
    case "decision":
      return "Proposal";
    case "join_request":
      return "Join request";
    case "recovery_action":
      return "Stuck work";
    default:
      return "Request";
  }
}

/** When a loaded request expires: a tool call's or a secret's approval window, a proposal's deadline. */
function requestExpiresAt(request: Request): Date | null {
  const source = request.source;
  if (source.type === "decision") return new Date(source.decision.expiresAt);
  if (source.type === "interaction" && source.interaction.kind === "request_confirmation") {
    const at = source.interaction.payload.toolAction?.expiresAt ?? source.interaction.payload.secretProposal?.expiresAt;
    return at ? new Date(at) : null;
  }
  return null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A budget stop's spend against its limit, and the agent it paused when the scope is one. */
function budgetOf(request: Request) {
  if (request.source.type !== "approval" || request.source.approval.type !== "budget_override_required") return null;
  const payload = request.source.approval.payload ?? {};
  const limit = typeof payload.budgetAmount === "number" ? payload.budgetAmount : null;
  const spent = typeof payload.observedAmount === "number" ? payload.observedAmount : null;
  const agentId = payload.scopeType === "agent" ? text(payload.scopeId) : null;
  return { limit, spent, agentId, scopeName: text(payload.scopeName) };
}

/** A settled request's one sign: what still needs a look. */
export function settledSign(request: Request): RowSign | null {
  // An approved call waiting for its app to be signed in again (U99, #20340): not failed, but it needs you.
  if (request.reconnect) return { tone: "warn", icon: "warn", text: "Sign-in needed" };
  if (request.source.type === "decision" && request.source.decision.executionStatus === "partial") return { tone: "mid", text: "Partly applied" };
  if (request.result?.tone === "bad" || request.verdict?.text === "Failed") return { tone: "bad", text: "Failed" };
  if (request.result?.tone === "mid") return { tone: "mid", text: request.source.type === "decision" ? "Partly applied" : "Didn't run" };
  return null;
}

function kindSigns(request: Request): RowSign[] {
  const source = request.source;
  const signs: RowSign[] = [];
  switch (source.type) {
    case "interaction": {
      const interaction = source.interaction;
      if (interaction.kind === "ask_user_questions") {
        const count = interaction.payload.questions?.length ?? 0;
        if (count > 1) signs.push(plain(`${count} questions`));
      } else if (interaction.kind === "request_confirmation") {
        const plan = planReviewTarget(interaction);
        if (plan) signs.push({ tone: "plain", icon: "plan", text: planLabel(plan) });
      } else if (interaction.kind === "request_checkbox_confirmation") {
        signs.push(plain(`Pick from ${interaction.payload.options.length}`));
      } else if (interaction.kind === "request_item_verdicts") {
        signs.push(plain(plural(interaction.payload.items.length, "item")));
      } else if (interaction.kind === "suggest_tasks") {
        signs.push(plain(plural(interaction.payload.tasks.filter((task) => !task.hiddenInPreview).length, "task")));
      }
      break;
    }
    case "decision": {
      if (changedTargets(source.targetChanged).size > 0) signs.push({ tone: "warn", icon: "warn", text: "Task changed" });
      if (isArchiveProposal(source.decision)) signs.push(plain(plural(Object.keys(source.decision.targetSnapshots ?? {}).length, "item")));
      else if (source.decision.options.length > 1) signs.push(plain(`${source.decision.options.length} options`));
      break;
    }
    case "approval": {
      const budget = budgetOf(request);
      if (budget?.spent != null && budget.limit != null) {
        signs.push({ tone: budget.spent >= budget.limit ? "bad" : "plain", text: `${money(budget.spent)} of ${money(budget.limit)}` });
      }
      break;
    }
    case "review": {
      if (source.stalled) signs.push({ tone: "warn", text: "No reviewer" });
      else {
        const steps = source.signoff.steps;
        const at = steps.findIndex((step) => step.now);
        if (steps.length > 1 && at >= 0) signs.push(plain(`Step ${at + 1} of ${steps.length}`));
      }
      break;
    }
    case "join":
      if (source.join.requestType === "agent") signs.push({ tone: "wait", text: "Outside agent" });
      break;
  }
  if (request.respond.waitingOn) signs.push({ tone: "wait", text: `Waiting on ${request.respond.waitingOn}` });
  return signs;
}

function requestWho(request: Request): RowWho | null {
  const budget = budgetOf(request);
  if (budget) return budget.agentId ? { kind: "agent", agentId: budget.agentId, name: budget.scopeName ?? "An agent" } : { kind: "paperclip" };
  if (request.source.type === "join") return { kind: "outside", name: request.asker.name };
  if (request.asker.agentId) return { kind: "agent", agentId: request.asker.agentId, name: request.asker.name };
  if (request.asker.userId) return { kind: "person", userId: request.asker.userId, name: request.asker.name };
  // A review nobody handed over has nobody to show.
  if (request.source.type === "review") return null;
  return request.asker.name ? null : { kind: "paperclip" };
}

/** Who asked, from the feed: an interaction's creator, an approval's requester. */
function feedWho(item: AttentionItem): RowWho | null {
  const meta = item.subject.metadata ?? {};
  switch (item.sourceKind) {
    case "issue_thread_interaction": {
      const audience = item.resolverAudience;
      if (audience?.createdByAgentId) return { kind: "agent", agentId: audience.createdByAgentId, name: audience.createdByAgentName ?? item.originAgentName ?? "An agent" };
      return null;
    }
    case "approval": {
      if (typeof meta.requestedByAgentId === "string") return { kind: "agent", agentId: meta.requestedByAgentId, name: item.originAgentName ?? "An agent" };
      if (typeof meta.requestedByUserId === "string") return { kind: "person", userId: meta.requestedByUserId, name: "" };
      return { kind: "paperclip" };
    }
    case "join_request":
      return { kind: "outside", name: item.subject.title ?? "Outside agent" };
    case "recovery_action":
      return { kind: "paperclip" };
    default:
      return null;
  }
}

export function ownerOf(who: RowWho | null): RowOwner {
  if (!who) return { kind: "paperclip" };
  if (who.kind === "agent") return { kind: "agent", agentId: who.agentId, name: who.name };
  if (who.kind === "paperclip") return { kind: "paperclip" };
  return { kind: "people" };
}

/** The question lines from the feed: the first one, and how many more. */
function feedQuestions(item: AttentionItem): { questions: string[]; more: number } {
  const detail = item.detail;
  if (detail?.kind !== "questions" || detail.questionCount < 2) return { questions: [], more: 0 };
  return detail.firstQuestionText ? { questions: [detail.firstQuestionText], more: detail.questionCount - 1 } : { questions: [], more: 0 };
}

function feedSigns(item: AttentionItem): RowSign[] {
  const detail = item.detail;
  switch (detail?.kind) {
    case "questions":
      return detail.questionCount > 1 ? [plain(`${detail.questionCount} questions`)] : [];
    case "suggested_tasks":
      return [plain(plural(detail.taskCount, "task"))];
    case "checkbox_confirmation":
      return [plain(`Pick from ${detail.optionCount}`)];
    case "item_verdicts":
      return [plain(plural(detail.itemCount, "item"))];
  }
  if (item.sourceKind === "review" && item.subject.metadata?.reviewAttentionState === "stalled") return [{ tone: "warn", text: "No reviewer" }];
  if (item.sourceKind === "join_request") return [{ tone: "wait", text: "Outside agent" }];
  return [];
}

function feedTitle(item: AttentionItem, task: RowInput["task"]) {
  const detail = item.detail;
  if (item.sourceKind === "review") {
    const stalled = item.subject.metadata?.reviewAttentionState === "stalled";
    const identifier = item.subject.identifier ?? task?.identifier ?? null;
    if (stalled && identifier) return `${identifier} is in review with nobody to review it`;
  }
  if (detail?.kind === "questions" && detail.questionCount === 1 && !item.subject.title) return detail.firstQuestionText ?? "Question";
  return item.subject.title ?? task?.title ?? feedType(item);
}

/** The collapsed row for a Needs you item: from its request once loaded, from the feed until then. */
export function rowModel(input: RowInput): RowModel {
  const { item, request } = input;
  const now = input.now ?? new Date();
  const task = input.task ?? null;
  const settled = request?.state === "settled";
  const blocks = !settled && task?.status === "blocked" && item.sourceKind !== "recovery_action";
  const blockSign: RowSign[] = blocks ? [{ tone: "block", icon: "block", text: task?.identifier ? `Blocks ${task.identifier}` : "Blocks work" }] : [];

  if (!request) {
    const expiry = rowExpiry(item.expiresAt ? new Date(item.expiresAt) : null, now);
    const who = feedWho(item);
    const { questions, more } = feedQuestions(item);
    return {
      kind: feedKind(item),
      type: feedType(item),
      title: feedTitle(item, task),
      questions,
      moreQuestions: more,
      signs: [...(expiry ? [expirySign(expiry)] : []), ...blockSign, ...feedSigns(item)],
      who,
      owner: ownerOf(who),
      expiry,
      blocks,
      waiting: false,
      settled: false,
      at: new Date(item.createdAt),
    };
  }

  const expiry = settled ? null : rowExpiry(requestExpiresAt(request) ?? (item.expiresAt ? new Date(item.expiresAt) : null), now);
  const interaction = request.source.type === "interaction" ? request.source.interaction : null;
  const all = interaction?.kind === "ask_user_questions" && (interaction.payload.questions?.length ?? 0) > 1 ? interaction.payload.questions.map((question) => question.prompt) : [];
  const review = request.source.type === "review" ? request.source : null;
  const title = review && !review.stalled ? (request.subject?.title ?? task?.title ?? request.title) : request.title;
  const who = requestWho(request);
  const signs = settled ? [settledSign(request)].filter((sign): sign is RowSign => !!sign) : [...(expiry ? [expirySign(expiry)] : []), ...blockSign, ...kindSigns(request)];
  return {
    kind: request.kind,
    type: requestType(request),
    title,
    questions: all.slice(0, SHOWN_QUESTIONS),
    moreQuestions: Math.max(0, all.length - SHOWN_QUESTIONS),
    signs,
    who,
    owner: ownerOf(who),
    expiry,
    blocks,
    waiting: !settled && !!request.respond.waitingOn,
    settled,
    at: request.createdAt,
  };
}

function expirySign(expiry: NonNullable<RowModel["expiry"]>): RowSign {
  return { tone: expiry.soon ? "soon" : "time", icon: "clock", text: expiry.text };
}
