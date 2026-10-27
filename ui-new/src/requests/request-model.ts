import type { Approval, IssueThreadInteraction } from "@paperclipai/shared";

/*
 * The request view model (proposals/unifying-requests.md, "Proposed model: requests"): anything
 * waiting on someone's response, described by the same properties whatever table it lives in.
 * Board 15 draws it. This module builds requests from a task's interactions and approvals; the
 * Inbox (M3) adds the attention feed's other kinds.
 *
 * - kind: question (the answer goes back to the agent), proposal (approving applies a change),
 *   approval (a formal request with its own discussion), sign-off (a review stage's turn).
 * - shape: the response controls the card draws.
 * - outcome: return, apply, or apply and remember.
 * - audience: who may answer, and whether that's you.
 * - subject: what it's about. Hidden inside a task's own thread.
 * - next: the "what happens if I click this?" line.
 * - state: open, set aside (dismissed back to history, still answerable), or settled.
 */

export type RequestKind = "question" | "proposal" | "approval" | "signoff";

export type RequestShape =
  | "form"
  | "yes_no"
  | "pick_several"
  | "verdicts"
  | "suggested_tasks"
  | "tool_call"
  | "connection"
  | "approval";

export type RequestOutcome = "return" | "apply" | "apply_and_remember";

export type RequestAudience = {
  kind: "anyone" | "not_creator" | "people_only" | "named";
  label: string;
};

export type RequestSubject = { kind: "task" | "tasks" | "agent" | "budget" | "company"; label: string; issueId?: string };

export type RequestState = "open" | "set_aside" | "settled";

export type Tone = "ok" | "bad" | "mid" | "muted";

export type RequestSource =
  | { type: "interaction"; interaction: IssueThreadInteraction }
  | { type: "approval"; approval: Approval };

export type Request = {
  key: string;
  source: RequestSource;
  kind: RequestKind;
  shape: RequestShape;
  outcome: RequestOutcome;
  audience: RequestAudience;
  subject: RequestSubject | null;
  /** Approvals: own discussion thread and revision loop. */
  formal: boolean;
  /** Approving runs something (a tool call, a secret write), so the card is marked "Acts". */
  acts: boolean;
  asker: { agentId: string | null; userId: string | null; name: string };
  /** "asks you", "suggests 3 tasks", "requests approval"… */
  askVerb: string;
  title: string;
  body: string | null;
  next: string;
  lifetime: string;
  lifetimeSoon: boolean;
  state: RequestState;
  /** Whether you can answer it, and if not, why. */
  respond: { allowed: boolean; reason: string | null };
  /** For settled requests: what was decided, and what came of it. */
  verdict: { text: string; tone: Tone; at: Date | null } | null;
  result: { text: string; tone: Tone } | null;
  createdAt: Date;
};

export type RequestContext = {
  youId: string | null;
  agentName: (id: string) => string | undefined;
  personName: (id: string) => string;
  /** The task the request sits on, when rendering outside its thread. */
  task?: { id: string; identifier: string | null; title: string } | null;
  now?: Date;
};

const date = (value: Date | string | null | undefined) => (value ? new Date(value) : null);

function who(ctx: RequestContext, agentId: string | null | undefined, userId: string | null | undefined, you = "You") {
  if (userId) return userId === ctx.youId ? you : ctx.personName(userId);
  if (agentId) return ctx.agentName(agentId) ?? "An agent";
  return "Someone";
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "Expires in 6 days", "Expires in 12 minutes"; soon under 15 minutes. */
export function expiryLabel(at: Date, now: Date): { text: string; soon: boolean } {
  const ms = at.getTime() - now.getTime();
  if (ms <= 0) return { text: "Expired", soon: true };
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return { text: `Expires in ${plural(Math.max(1, minutes), "minute")}`, soon: minutes < 15 };
  const hours = Math.round(minutes / 60);
  if (hours < 48) return { text: `Expires in ${plural(hours, "hour")}`, soon: false };
  return { text: `Expires in ${plural(Math.round(hours / 24), "day")}`, soon: false };
}

function audienceOf(interaction: IssueThreadInteraction, ctx: RequestContext): RequestAudience {
  if (interaction.addresseeUserId) return { kind: "named", label: interaction.addresseeUserId === ctx.youId ? "You" : `Only ${ctx.personName(interaction.addresseeUserId)}` };
  if (interaction.addresseeAgentId) return { kind: "named", label: `Only ${ctx.agentName(interaction.addresseeAgentId) ?? "an agent"}` };
  switch (interaction.effectiveResolverPolicy) {
    case "human_only":
      return { kind: "people_only", label: "People only" };
    case "not_creator":
      return { kind: "not_creator", label: "Not the asker" };
    default:
      return { kind: "anyone", label: "Anyone" };
  }
}

function respondOf(interaction: IssueThreadInteraction, ctx: RequestContext): Request["respond"] {
  if (interaction.addresseeUserId && interaction.addresseeUserId !== ctx.youId) {
    const name = ctx.personName(interaction.addresseeUserId);
    return { allowed: false, reason: `Waiting on ${name}. Only ${name} can answer this.` };
  }
  if (interaction.addresseeAgentId) {
    return { allowed: false, reason: `Waiting on ${ctx.agentName(interaction.addresseeAgentId) ?? "an agent"}.` };
  }
  if (interaction.effectiveResolverPolicy === "not_creator" && interaction.createdByUserId && interaction.createdByUserId === ctx.youId) {
    return { allowed: false, reason: "You asked this, so someone else answers it." };
  }
  if (interaction.kind === "connection_intent") {
    return { allowed: false, reason: "Connecting an app isn't in this board yet. Use the classic board to finish it." };
  }
  if (interaction.acceptanceBlocker === "workspace_sync_pending") {
    return { allowed: false, reason: "Getting the workspace ready. You can answer in a moment." };
  }
  return { allowed: true, reason: null };
}

type Classified = Pick<Request, "kind" | "shape" | "outcome" | "acts" | "askVerb" | "title" | "body">;

function classify(interaction: IssueThreadInteraction): Classified {
  const titled = (fallback: string) => interaction.title?.trim() || fallback;
  switch (interaction.kind) {
    case "ask_user_questions": {
      const questions = interaction.payload.questions ?? [];
      const single = questions.length === 1 ? questions[0] : null;
      return {
        kind: "question",
        shape: "form",
        outcome: "return",
        acts: false,
        askVerb: questions.length > 1 ? `asks you ${questions.length} questions` : "asks you",
        title: interaction.payload.title?.trim() || titled(single?.prompt ?? `Answer ${questions.length} questions`),
        body: interaction.summary ?? null,
      };
    }
    case "request_confirmation": {
      const payload = interaction.payload;
      if (payload.toolAction) {
        return {
          kind: "proposal",
          shape: "tool_call",
          outcome: payload.toolAction.rememberActionScope ? "apply_and_remember" : "apply",
          acts: true,
          askVerb: "wants to run a tool",
          title: titled(payload.prompt),
          body: payload.toolAction.previewMarkdown || null,
        };
      }
      if (payload.secretProposal) {
        return {
          kind: "proposal",
          shape: "yes_no",
          outcome: "apply",
          acts: true,
          askVerb: "asks for a secret",
          title: titled(payload.prompt),
          body: payload.secretProposal.justification || payload.detailsMarkdown || null,
        };
      }
      const plan = payload.target?.type === "issue_document" && payload.target.key === "plan";
      return {
        kind: "question",
        shape: "yes_no",
        outcome: "return",
        acts: false,
        askVerb: plan ? "asks you to approve the plan" : "asks you",
        title: titled(payload.prompt),
        body: interaction.title?.trim() && interaction.title.trim() !== payload.prompt ? payload.prompt : (payload.detailsMarkdown ?? null),
      };
    }
    case "request_checkbox_confirmation":
      return {
        kind: "question",
        shape: "pick_several",
        outcome: "return",
        acts: false,
        askVerb: "asks you to pick",
        title: titled(interaction.payload.prompt),
        body: interaction.payload.detailsMarkdown ?? null,
      };
    case "request_item_verdicts":
      return {
        kind: "question",
        shape: "verdicts",
        outcome: "return",
        acts: false,
        askVerb: `asks for a verdict on ${plural(interaction.payload.items.length, "item")}`,
        title: titled(interaction.payload.prompt),
        body: interaction.payload.detailsMarkdown ?? null,
      };
    case "suggest_tasks": {
      const count = interaction.payload.tasks.filter((task) => !task.hiddenInPreview).length;
      return {
        kind: "proposal",
        shape: "suggested_tasks",
        outcome: "apply",
        acts: false,
        askVerb: `suggests ${plural(count, "task")}`,
        title: titled(count === 1 ? "Create this task?" : `Create these ${count} tasks?`),
        body: interaction.summary ?? null,
      };
    }
    case "connection_intent":
      return {
        kind: "proposal",
        shape: "connection",
        outcome: "apply",
        acts: false,
        askVerb: "asks to connect an app",
        title: titled(`Connect ${interaction.payload.serviceName}`),
        body: interaction.summary ?? null,
      };
  }
}

function nextLine(c: Classified, interaction: IssueThreadInteraction, asker: string, ctx: RequestContext) {
  const continues = ctx.task?.identifier ? `, which continues ${ctx.task.identifier}` : ", which continues the task";
  switch (c.shape) {
    case "tool_call": {
      const scope = interaction.kind === "request_confirmation" ? interaction.payload.toolAction?.rememberActionScope : undefined;
      return scope ? `Approving runs this call once. Always allow also approves future calls with this scope: ${scope}.` : "Approving runs this call once.";
    }
    case "suggested_tasks":
      return `Creating them adds the tasks you pick, then tells ${asker} which ones.`;
    case "connection":
      return `Connecting lets ${asker} use the app, then it continues.`;
    default:
      if (c.acts) return `Approving applies it now, then tells ${asker}.`;
      return `Your answer goes to ${asker}${continues}.`;
  }
}

function lifetimeOf(interaction: IssueThreadInteraction, now: Date): { text: string; soon: boolean } {
  const payload = interaction.payload as { supersedeOnUserComment?: boolean; toolAction?: { expiresAt: string }; secretProposal?: { expiresAt: string } };
  const expires = payload.toolAction?.expiresAt ?? payload.secretProposal?.expiresAt;
  if (expires) return expiryLabel(new Date(expires), now);
  if (payload.supersedeOnUserComment) return { text: "Ends if you comment instead", soon: false };
  return { text: "Open until answered", soon: false };
}

const ENDED: Record<string, string> = {
  superseded_by_comment: "Ended without an answer: someone commented on the task instead",
  superseded_by_newer_request: "Replaced by a newer request",
  superseded_by_newer_interaction: "Replaced by a newer question",
  stale_target: "Ended: what it asked about changed",
  skipped: "Skipped",
  withdrawn: "Withdrawn by the agent",
  issue_closed: "Ended when the task closed",
  addressee_deleted: "Ended: the person it was for left",
  cancelled: "Cancelled",
};

/** What was decided, and what came of it, for a settled interaction. */
export function settledLines(interaction: IssueThreadInteraction, ctx: RequestContext, asker: string): Pick<Request, "verdict" | "result"> {
  const at = date(interaction.resolvedAt ?? interaction.updatedAt);
  const by = who(ctx, interaction.resolvedByAgentId, interaction.resolvedByUserId);
  const result = interaction.result as Record<string, unknown> | null | undefined;
  const ended = (key: unknown) => (typeof key === "string" ? ENDED[key] : undefined);
  const endedText = ended(result?.outcome) ?? ended(result?.expirationReason);

  if (interaction.status === "cancelled" || interaction.status === "expired" || interaction.status === "failed" || endedText) {
    if (interaction.status === "failed") {
      return { verdict: { text: "Failed", tone: "bad", at }, result: typeof result?.reason === "string" ? { text: result.reason, tone: "bad" } : null };
    }
    return { verdict: { text: endedText ?? (interaction.status === "expired" ? "Expired without an answer" : "Cancelled"), tone: "muted", at }, result: null };
  }

  if (interaction.kind === "request_confirmation" && interaction.result?.toolAction) {
    const tool = interaction.result.toolAction;
    const verdict = { text: interaction.status === "rejected" ? `${by} declined` : `${by} approved${tool.rememberedAction ? " and always allowed it" : " and ran it"}`, tone: interaction.status === "rejected" ? "muted" : "ok", at } as const;
    if (tool.status === "failed") return { verdict, result: { text: `The call failed${tool.errorMessage ? `: ${tool.errorMessage}` : ""}`, tone: "bad" } };
    if (tool.status === "executed") return { verdict, result: { text: tool.resultSummary ?? "The call ran", tone: "ok" } };
    if (tool.status === "expired") return { verdict, result: { text: "The approval expired before the call ran", tone: "mid" } };
    return { verdict, result: { text: "Running the call…", tone: "muted" } };
  }

  if (interaction.kind === "suggest_tasks" && interaction.status === "accepted") {
    const created = interaction.result?.createdTasks ?? [];
    return {
      verdict: { text: `${by} created ${plural(created.length, "task")}`, tone: "ok", at },
      result: created.length > 0 ? { text: created.map((task) => task.identifier ?? task.title ?? "a task").join(", "), tone: "muted" } : null,
    };
  }

  if (interaction.kind === "ask_user_questions" && interaction.status === "answered") {
    const options = new Map(interaction.payload.questions.flatMap((question) => question.options.map((option) => [option.id, option.label] as const)));
    const picked = (interaction.result?.answers ?? []).flatMap((answer) => [
      ...answer.optionIds.map((id) => options.get(id) ?? id),
      ...(answer.otherText?.trim() ? [answer.otherText.trim()] : []),
    ]);
    return {
      verdict: { text: picked.length > 0 ? `${by} answered ${picked.join(", ")}` : `${by} answered`, tone: "ok", at },
      result: { text: `Sent to ${asker}`, tone: "muted" },
    };
  }

  if (interaction.kind === "request_item_verdicts") {
    const items = interaction.result?.items ?? [];
    const count = (verdict: string) => items.filter((item) => item.verdict === verdict).length;
    const parts = [["approve", "approved"], ["reject", "rejected"], ["defer", "deferred"]]
      .map(([verdict, word]) => (count(verdict!) ? `${count(verdict!)} ${word}` : ""))
      .filter(Boolean);
    return { verdict: { text: `${by} gave verdicts${parts.length ? `: ${parts.join(", ")}` : ""}`, tone: "ok", at }, result: { text: `Sent to ${asker}`, tone: "muted" } };
  }

  if (interaction.status === "rejected") {
    const reason = typeof result?.reason === "string" && result.reason.trim() ? `: ${result.reason.trim()}` : "";
    return { verdict: { text: `${by} declined${reason}`, tone: "muted", at }, result: { text: `Sent to ${asker}`, tone: "muted" } };
  }
  return { verdict: { text: `${by} accepted`, tone: "ok", at }, result: { text: `Sent to ${asker}`, tone: "muted" } };
}

export function requestFromInteraction(interaction: IssueThreadInteraction, ctx: RequestContext): Request {
  const now = ctx.now ?? new Date();
  const classified = classify(interaction);
  const askerName = who(ctx, interaction.createdByAgentId, interaction.createdByUserId);
  const state: RequestState = interaction.status !== "pending" ? "settled" : interaction.dismissedAt ? "set_aside" : "open";
  const lifetime = lifetimeOf(interaction, now);
  const settled = state === "settled" ? settledLines(interaction, ctx, askerName) : { verdict: null, result: null };
  return {
    key: `interaction:${interaction.id}`,
    source: { type: "interaction", interaction },
    ...classified,
    audience: audienceOf(interaction, ctx),
    subject: ctx.task ? { kind: "task", label: ctx.task.identifier ?? ctx.task.title, issueId: ctx.task.id } : null,
    formal: false,
    asker: { agentId: interaction.createdByAgentId ?? null, userId: interaction.createdByUserId ?? null, name: askerName },
    next: nextLine(classified, interaction, askerName, ctx),
    lifetime: lifetime.text,
    lifetimeSoon: lifetime.soon,
    state,
    respond: state === "settled" ? { allowed: false, reason: null } : respondOf(interaction, ctx),
    ...settled,
    createdAt: new Date(interaction.createdAt),
  };
}

const APPROVAL_LABELS: Record<string, string> = {
  hire_agent: "Hire an agent",
  approve_ceo_strategy: "CEO strategy",
  budget_override_required: "Budget stop",
  request_board_approval: "Board approval",
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The approval's subject line, after `approvalSubject` in the old UI. */
export function approvalTitle(approval: Pick<Approval, "type" | "payload">) {
  const payload = approval.payload ?? {};
  const subject = text(payload.title) ?? text(payload.name) ?? text(payload.summary) ?? text(payload.recommendedAction);
  if (approval.type === "hire_agent" && text(payload.name)) return `Hire ${text(payload.name)}`;
  return subject ?? APPROVAL_LABELS[approval.type] ?? approval.type;
}

export function requestFromApproval(approval: Approval, ctx: RequestContext): Request {
  const payload = approval.payload ?? {};
  const asker = who(ctx, approval.requestedByAgentId, approval.requestedByUserId);
  const open = approval.status === "pending" || approval.status === "revision_requested";
  const budget = approval.type === "budget_override_required";
  const hire = approval.type === "hire_agent";
  const name = text(payload.name) ?? "the agent";
  const next = budget
    ? "Approving here doesn't lift the pause. Raise the limit or keep it paused from the budget controls."
    : hire
      ? `Approving activates ${name}. It can then be assigned work.`
      : `Your decision goes to ${asker}.`;
  const decidedBy = approval.decidedByUserId ? who(ctx, null, approval.decidedByUserId) : "Someone";
  const verdicts: Record<string, { text: string; tone: Tone }> = {
    approved: { text: `${decidedBy} approved`, tone: "ok" },
    rejected: { text: `${decidedBy} rejected`, tone: "bad" },
    cancelled: { text: "Cancelled", tone: "muted" },
  };
  return {
    key: `approval:${approval.id}`,
    source: { type: "approval", approval },
    kind: "approval",
    shape: "approval",
    outcome: hire || budget ? "apply" : "return",
    audience: { kind: "people_only", label: "People only" },
    subject: hire
      ? { kind: "agent", label: `New agent: ${name}` }
      : budget
        ? { kind: "budget", label: `Budget: ${text(payload.scopeName) ?? "a scope"}` }
        : ctx.task
          ? { kind: "task", label: ctx.task.identifier ?? ctx.task.title, issueId: ctx.task.id }
          : { kind: "company", label: "The company" },
    formal: true,
    acts: false,
    asker: { agentId: approval.requestedByAgentId, userId: approval.requestedByUserId, name: asker },
    askVerb: approval.status === "revision_requested" ? "was asked for changes" : "requests approval",
    title: approvalTitle(approval),
    body: text(payload.summary) && text(payload.summary) !== approvalTitle(approval) ? text(payload.summary) : (text(payload.plan) ?? text(payload.description)),
    next,
    lifetime: approval.status === "revision_requested" ? "Waiting on a revision" : "Open until answered",
    lifetimeSoon: false,
    state: open ? "open" : "settled",
    respond: !open ? { allowed: false, reason: null } : budget ? { allowed: false, reason: "Budget stops are resolved from the budget controls, not approved here." } : { allowed: true, reason: null },
    verdict: open ? null : { ...(verdicts[approval.status] ?? { text: approval.status, tone: "muted" }), at: date(approval.decidedAt ?? approval.updatedAt) },
    result: !open && approval.decisionNote ? { text: approval.decisionNote, tone: "muted" } : null,
    createdAt: new Date(approval.createdAt),
  };
}

/** A task's requests, oldest first. */
export function taskRequests(input: { interactions: readonly IssueThreadInteraction[]; approvals: readonly Approval[] }, ctx: RequestContext): Request[] {
  return [...input.interactions.map((interaction) => requestFromInteraction(interaction, ctx)), ...input.approvals.map((approval) => requestFromApproval(approval, ctx))].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

/** The kind's label and icon name, for the card's top line. */
export const KIND_LABEL: Record<RequestKind, string> = {
  question: "Question",
  proposal: "Proposal",
  approval: "Approval",
  signoff: "Sign-off",
};
