import type { Approval, IssueExecutionStagePrincipal, IssueExecutionState, IssueStatus, IssueThreadInteraction } from "@paperclipai/shared";
import type { CompanyJoinRequest } from "@/api/access";
import type { DecisionOutcome } from "@/api/decisions";

/*
 * The request view model (proposals/unifying-requests.md, "Proposed model: requests"): anything
 * waiting on someone's response, described by the same properties whatever table it lives in.
 * Board 15 draws it. This module builds requests from a task's interactions and approvals, and
 * from a task waiting on a review stage's sign-off; decision-model.ts builds proposals (Decisions)
 * and join-model.ts join requests. The Inbox draws the attention feed's other kinds as plain cards.
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
  | "approval"
  | "signoff"
  | "decision"
  | "join";

export type RequestOutcome = "return" | "apply" | "apply_and_remember";

export type RequestAudience = {
  kind: "anyone" | "not_creator" | "people_only" | "named";
  label: string;
};

/** `label` is the identifier for a task, with its `title` beside it when there is one. */
export type RequestSubject = { kind: "task" | "tasks" | "agent" | "budget" | "company"; label: string; title?: string; issueId?: string };

export type RequestState = "open" | "set_aside" | "settled";

export type Tone = "ok" | "bad" | "mid" | "muted";

export type RequestSource =
  | { type: "interaction"; interaction: IssueThreadInteraction }
  | { type: "approval"; approval: Approval }
  | { type: "review"; issueId: string; identifier: string; signoff: Signoff; stalled: boolean }
  | { type: "decision"; decision: DecisionOutcome; targetChanged: Record<string, boolean> | null }
  | { type: "join"; join: CompanyJoinRequest };

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
  /** Empty `name` when nobody asked: a review nobody handed over. The card leaves the line out. */
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

function taskSubject(task: NonNullable<RequestContext["task"]>): RequestSubject {
  return task.identifier ? { kind: "task", label: task.identifier, title: task.title || undefined, issueId: task.id } : { kind: "task", label: task.title, issueId: task.id };
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
    return { allowed: false, reason: `Waiting on ${name.replace(/\.$/, "")}. Only ${name} can answer this.` };
  }
  if (interaction.addresseeAgentId) {
    return { allowed: false, reason: `Waiting on ${ctx.agentName(interaction.addresseeAgentId) ?? "an agent"}.` };
  }
  if (interaction.effectiveResolverPolicy === "not_creator" && interaction.createdByUserId && interaction.createdByUserId === ctx.youId) {
    return { allowed: false, reason: "You asked this, so someone else answers it." };
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
    case "connection_intent": {
      const payload = interaction.payload;
      const access = payload.accessRequest;
      return {
        kind: "proposal",
        shape: "connection",
        outcome: "apply",
        acts: false,
        askVerb: access ? "asks for access to an app" : payload.purpose === "ai" ? "needs an AI connection" : "asks to connect an app",
        title: access
          ? `Give ${payload.requestingAgentName} access to ${access.connectionName}?`
          : titled(payload.purpose === "ai" ? `Connect ${payload.serviceName} so ${payload.requestingAgentName} can run` : `Connect ${payload.serviceName}`),
        body: interaction.summary ?? null,
      };
    }
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
    case "connection": {
      const payload = interaction.kind === "connection_intent" ? interaction.payload : null;
      if (payload?.accessRequest) return `Granting lets ${asker} use these tools on ${payload.accessRequest.connectionName}, then it continues.`;
      if (payload?.purpose === "ai") return `Once ${asker} has a working AI connection, the task resumes on its own.`;
      return `Connecting lets ${asker} use the app, then it continues. Access is added for this agent only.`;
    }
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
  superseded: "Replaced by a newer request",
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

  if (interaction.kind === "connection_intent" && (interaction.status === "accepted" || interaction.status === "rejected")) {
    const access = !!interaction.payload.accessRequest;
    return interaction.status === "accepted"
      ? { verdict: { text: `${by} ${access ? "granted access" : "connected it"}`, tone: "ok", at }, result: { text: `${asker} can use it now`, tone: "muted" } }
      : { verdict: { text: `${by} declined`, tone: "muted", at }, result: { text: `Sent to ${asker}, which continues without it`, tone: "muted" } };
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
    subject: ctx.task ? taskSubject(ctx.task) : null,
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
          ? taskSubject(ctx.task)
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

// ---------------------------------------------------------------------------------------------
// Sign-offs: a review stage's turn (proposal items 8 and 9)

export type Principal = Pick<IssueExecutionStagePrincipal, "type" | "agentId" | "userId">;

/** "agent:<id>" or "user:<id>", as task assignees and stage participants are keyed. */
export function principalKey(principal: Principal) {
  return principal.type === "agent" ? `agent:${principal.agentId}` : `user:${principal.userId}`;
}

export type SignoffStep = { type: "review" | "approval"; label: string; now: boolean };

export type Signoff = {
  steps: SignoffStep[];
  /** "Returns to Strategy Engineer if sent back · round 2 of 3". */
  returns: string | null;
  /** Whether the stage waits on you, so you can sign here. */
  yours: boolean;
  /** Who it waits on, when it isn't you. */
  waitingOn: string | null;
};

type StagePolicy = { stages?: { id: string; type: "review" | "approval"; participants: Principal[] }[]; maxReviewRounds?: number | null } | null;

/**
 * Where a task's review stages stand: the stages in order with the current one marked, where the
 * task returns if it's sent back, and whether it's your turn.
 */
export function signoffOf(
  task: { executionPolicy?: unknown; executionState?: IssueExecutionState | null; assigneeUserId?: string | null },
  youId: string | null,
  nameOf: (key: string) => string,
): Signoff {
  const policy = (task.executionPolicy ?? null) as StagePolicy;
  const state = task.executionState ?? null;
  const pending = state?.status === "pending" ? state : null;
  const stages = Array.isArray(policy?.stages) ? policy.stages : [];
  const steps = stages.map((stage): SignoffStep => {
    const now = pending?.currentStageId === stage.id;
    const who = now && pending?.currentParticipant ? [pending.currentParticipant] : stage.participants;
    const names = who.map((participant) => {
      const name = nameOf(principalKey(participant));
      return name === "You" ? "you" : name;
    });
    return { type: stage.type, label: `${stage.type === "review" ? "Review" : "Approval"} · ${names.join(" or ") || "nobody yet"}`, now };
  });
  const current = pending?.currentParticipant ?? null;
  const yours = current ? current.type === "user" && current.userId === youId : !!youId && task.assigneeUserId === youId;
  const waitingOn = current && !yours ? nameOf(principalKey(current)) : null;
  let returns: string | null = null;
  if (state?.returnAssignee) {
    const rounds = policy?.maxReviewRounds ?? 3;
    const round = (state.changesRequestedCount ?? 0) + 1;
    returns = `Returns to ${nameOf(principalKey(state.returnAssignee))} if sent back · round ${Math.min(round, rounds)} of ${rounds}`;
  }
  return { steps, returns, yours, waitingOn };
}

export type ReviewTask = {
  id: string;
  identifier: string | null;
  title: string;
  status: IssueStatus | string;
  executionPolicy?: unknown;
  executionState?: IssueExecutionState | null;
  assigneeUserId?: string | null;
  updatedAt: Date | string;
};

/** Where a review sits, from the attention feed: stalled when nobody can review it, and why now. */
export type ReviewContext = { stalled?: boolean; whyNow?: string | null; since?: Date | string | null };

/**
 * A task waiting on a review stage, as a sign-off request. On your turn you approve or send it back
 * with the comment the server asks for (`issue-execution-policy.ts`): approving moves the task to
 * done, sending back to in progress, both through `PATCH /issues/:id`. A stalled review (nobody can
 * review it) is any person's to decide, through `POST /issues/:id/stalled-review-decision`: approve,
 * request changes (with a note) or send back. Once the task leaves review, the request is settled
 * with the stage's last decision.
 */
export function requestFromReview(task: ReviewTask, ctx: RequestContext, review: ReviewContext = {}): Request {
  const nameOf = (key: string) => {
    const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    return kind === "agent" ? who(ctx, id, null) : who(ctx, null, id);
  };
  const signoff = signoffOf(task, ctx.youId, nameOf);
  const identifier = task.identifier ?? "the task";
  const stalled = review.stalled === true;
  const open = task.status === "in_review";
  const returnTo = task.executionState?.returnAssignee ?? null;
  const asker = returnTo
    ? { agentId: returnTo.type === "agent" ? (returnTo.agentId ?? null) : null, userId: returnTo.type === "user" ? (returnTo.userId ?? null) : null, name: nameOf(principalKey(returnTo)) }
    : { agentId: null, userId: null, name: "" };
  const steps = signoff.steps;
  const after = steps[steps.findIndex((step) => step.now) + 1];
  const canSign = open && !stalled && signoff.yours;

  const title = stalled
    ? `${identifier} is in review with nobody to review it`
    : canSign
      ? "Your sign-off is needed: approve, or send back"
      : signoff.waitingOn
        ? `Review pending with ${signoff.waitingOn}`
        : `Review ${task.title || identifier}`;
  const next = stalled && open
    ? `Nobody can review ${identifier}, so you decide: approving marks it done; requesting changes or sending it back returns it to its assignee with your note.`
    : canSign
      ? after && steps.some((step) => step.now)
        ? `Approving moves ${identifier} to its next stage: ${after.label.toLowerCase()}.`
        : `Approving finishes ${identifier}.`
      : `Open ${identifier} to see the review.`;

  const outcome = task.executionState?.lastDecisionOutcome;
  const verdict: Request["verdict"] = open
    ? null
    : outcome === "approved" || task.status === "done"
      ? { text: "Approved", tone: "ok", at: date(task.updatedAt) }
      : outcome === "changes_requested"
        ? { text: "Sent back with notes", tone: "muted", at: date(task.updatedAt) }
        : { text: "Left review", tone: "muted", at: date(task.updatedAt) };

  return {
    key: `review:${task.id}`,
    source: { type: "review", issueId: task.id, identifier, signoff, stalled },
    kind: "signoff",
    shape: "signoff",
    outcome: "apply",
    audience: signoff.yours ? { kind: "named", label: "You" } : signoff.waitingOn ? { kind: "named", label: `Only ${signoff.waitingOn}` } : { kind: "people_only", label: "People only" },
    subject: taskSubject({ id: task.id, identifier: task.identifier, title: task.title }),
    formal: false,
    acts: false,
    asker,
    askVerb: canSign ? "handed this to you for review" : "is waiting on a review",
    title,
    body: null,
    next,
    lifetime: "Open until answered",
    lifetimeSoon: false,
    state: open ? "open" : "settled",
    respond: !open
      ? { allowed: false, reason: null }
      : canSign || stalled
        ? { allowed: true, reason: null }
        : { allowed: false, reason: signoff.waitingOn ? `Waiting on ${signoff.waitingOn.replace(/\.$/, "")}.` : null },
    verdict,
    result: null,
    createdAt: new Date(review.since ?? task.updatedAt),
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
