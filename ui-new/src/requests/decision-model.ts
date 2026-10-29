import type { DecisionEffect, DecisionOption } from "@paperclipai/shared";
import type { DecisionEffectExecution, DecisionOutcome, DecisionTargetSnapshot } from "@/api/decisions";
import { STATUS_META } from "@/ui/status-meta";
import { expiryLabel, type Request, type RequestContext, type Tone } from "./request-model";

/*
 * Proposals (Decisions) as requests (board 15's proposal card, after the old UI's DecisionCard):
 *
 * - Each option lists what choosing it changes ("Set TRA-41 to done", "Create a task…"), its
 *   preview. Picking one applies those changes at once.
 * - An effect marked strict is skipped if its target changed since the proposal, so an option with
 *   one on a changed target is held back, and the card says what changed.
 * - Cancelling a task tree is destructive: the card asks you to type the task's identifier first.
 * - Settled proposals list what each effect did: done, skipped (its target changed), failed (and
 *   why) or still running. Partial and failed outcomes say so on the card.
 * - An archive proposal (an agent proposing to archive aging feed items) applies no effects: its two
 *   options archive the listed items or keep them.
 */

/** A task the card can name: identifier and title, once loaded. */
export type IssueRef = { id: string; identifier: string | null; title: string | null; status: string | null };

export type Resolve = (id: string) => IssueRef | null;

/** The tasks an effect touches, as the shared package's `decisionEffectTargetIssueIds` lists them. */
export function effectTargetIds(effect: DecisionEffect): string[] {
  const ids = new Set([effect.targetIssueId]);
  if (effect.type === "create_issue") {
    if (effect.draft.parentId) ids.add(effect.draft.parentId);
    for (const id of effect.draft.blockedByIssueIds ?? []) ids.add(id);
  }
  if (effect.type === "resolve_blocker") for (const id of effect.removeBlockedByIssueIds) ids.add(id);
  return [...ids];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every task a decision names, to load their identifiers: snapshots, effects and what effects made. */
export function referencedIssueIds(decision: Pick<DecisionOutcome, "targetSnapshots" | "options" | "executions">): string[] {
  const ids = new Set<string>();
  for (const [id, snapshot] of Object.entries(decision.targetSnapshots ?? {})) {
    ids.add(id);
    for (const child of snapshot.descendantIds ?? []) ids.add(child);
  }
  for (const option of decision.options) for (const effect of option.effects) for (const id of effectTargetIds(effect)) ids.add(id);
  for (const execution of decision.executions ?? []) {
    ids.add(execution.targetIssueId);
    if (typeof execution.result?.issueId === "string") ids.add(execution.result.issueId);
  }
  // An archive proposal keys its snapshots by feed item, not by task.
  return [...ids].filter((id) => UUID.test(id));
}

export function isArchiveProposal(decision: Pick<DecisionOutcome, "metadata">) {
  return (decision.metadata as { kind?: unknown } | null)?.kind === "attention_archive_proposal";
}

export function wasDismissed(decision: Pick<DecisionOutcome, "chosenOptionId" | "metadata">) {
  return decision.chosenOptionId === "dismissed" || (decision.metadata as { dismissed?: unknown } | null)?.dismissed === true;
}

function label(ref: IssueRef | null, id: string) {
  return ref?.identifier ?? ref?.title ?? `a task (${id.slice(0, 8)})`;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** A status's label, as the status capsules name it ("In progress"). */
export function statusWord(status: string | null | undefined) {
  if (!status) return "Unknown";
  return (STATUS_META as Record<string, { label: string } | undefined>)[status]?.label ?? status.replaceAll("_", " ");
}

export function cancelTreeEffect(option: DecisionOption) {
  return (option.effects.find((effect) => effect.type === "cancel_issue_tree") ?? null) as Extract<DecisionEffect, { type: "cancel_issue_tree" }> | null;
}

export function isDestructive(option: DecisionOption) {
  return option.style === "destructive" || !!cancelTreeEffect(option);
}

/** What an effect will do, in a line, before you choose it. */
export function effectPreview(
  effect: DecisionEffect,
  resolve: Resolve,
  snapshots: Record<string, DecisionTargetSnapshot>,
  nameOf: (agentId: string | null | undefined, userId: string | null | undefined) => string,
): string {
  const target = label(resolve(effect.targetIssueId), effect.targetIssueId);
  switch (effect.type) {
    case "comment_on_issue":
      return `Comment on ${target}`;
    case "create_issue": {
      const parent = effect.draft.parentId ? label(resolve(effect.draft.parentId), effect.draft.parentId) : target;
      const owner = effect.draft.assigneeAgentId || effect.draft.assigneeUserId ? `, for ${nameOf(effect.draft.assigneeAgentId, effect.draft.assigneeUserId)}` : "";
      return `Create a task "${effect.draft.title}" under ${parent}${owner}`;
    }
    case "update_issue_status":
      return `Set ${target} to ${statusWord(effect.status)}`;
    case "assign_issue":
      return effect.assigneeAgentId || effect.assigneeUserId ? `Assign ${target} to ${nameOf(effect.assigneeAgentId, effect.assigneeUserId)}` : `Unassign ${target}`;
    case "resolve_blocker":
      return `Unblock ${target}: remove ${plural(effect.removeBlockedByIssueIds.length, "blocker")}`;
    case "cancel_issue_tree": {
      const snapshot = snapshots[effect.targetIssueId];
      const below = snapshot?.descendantCount ?? snapshot?.descendantIds?.length ?? snapshot?.childCount ?? 0;
      return `Cancel ${target} and everything under it (${plural(below + 1, "task")})`;
    }
  }
}

/** The comment an effect posts, when it carries one, to show under its line. */
export function effectComment(effect: DecisionEffect): string | null {
  switch (effect.type) {
    case "comment_on_issue":
      return effect.bodyMarkdown;
    case "update_issue_status":
    case "assign_issue":
      return effect.comment ?? null;
    case "cancel_issue_tree":
      return effect.reasonComment;
    default:
      return null;
  }
}

/** Targets that changed since the proposal, from the open list's `targetChanged`. */
export function changedTargets(targetChanged: Record<string, boolean> | null | undefined): Set<string> {
  return new Set(Object.entries(targetChanged ?? {}).flatMap(([id, changed]) => (changed ? [id] : [])));
}

/** An option held back because a strict effect's target changed. */
export function heldBack(option: DecisionOption, changed: ReadonlySet<string>) {
  return option.effects.some((effect) => effect.staleness === "strict" && effectTargetIds(effect).some((id) => changed.has(id)));
}

const FAILURE: Record<string, string> = {
  deny_decision_intersection: "neither you nor the agent may make this change",
  invalid_effect_reference: "a task it names no longer exists",
  target_changed: "the task changed since the proposal",
  effect_execution_failed: "the change failed while running",
};

export type EffectResult = { key: string; tone: Tone; text: string; issueId: string | null };

/** What one effect did, once the proposal is decided. */
export function effectResult(execution: DecisionEffectExecution, resolve: Resolve): EffectResult {
  const target = label(resolve(execution.targetIssueId), execution.targetIssueId);
  const result = execution.result ?? {};
  const base = { key: execution.id, issueId: execution.targetIssueId };
  switch (execution.status) {
    case "skipped":
      return { ...base, tone: "mid", text: `Skipped ${target}: it changed since the proposal` };
    case "failed":
      return { ...base, tone: "bad", text: `Failed on ${target}: ${FAILURE[execution.error ?? ""] ?? execution.error ?? "it couldn't run"}` };
    case "claimed":
      return { ...base, tone: "muted", text: `Running on ${target}…` };
  }
  switch (execution.effectType) {
    case "comment_on_issue":
      return { ...base, tone: "ok", text: `Commented on ${target}` };
    case "create_issue": {
      const createdId = typeof result.issueId === "string" ? result.issueId : null;
      return { ...base, issueId: createdId ?? base.issueId, tone: "ok", text: `Created ${createdId ? label(resolve(createdId), createdId) : "a task"}` };
    }
    case "update_issue_status":
      return { ...base, tone: "ok", text: `Set ${target} to ${statusWord(typeof result.status === "string" ? result.status : null)}` };
    case "assign_issue":
      return { ...base, tone: "ok", text: `Reassigned ${target}` };
    case "resolve_blocker": {
      const removed = Array.isArray(result.removedBlockedByIssueIds) ? result.removedBlockedByIssueIds.length : 0;
      return { ...base, tone: "ok", text: `Removed ${plural(removed, "blocker")} from ${target}` };
    }
    case "cancel_issue_tree": {
      const cancelled = Array.isArray(result.cancelledIssueIds) ? result.cancelledIssueIds.length : 0;
      return { ...base, tone: "ok", text: `Cancelled ${plural(cancelled, "task")} under ${target}` };
    }
    default:
      return { ...base, tone: "ok", text: `Changed ${target}` };
  }
}

const EXPIRED: Record<string, string> = {
  target_gone: "Ended: a task it changes was cancelled first",
  target_completed: "Ended: the tasks it changes were finished first",
};

/** A proposal as a request. Its card loads the tasks the effects name to label them. */
export function requestFromDecision(decision: DecisionOutcome, ctx: RequestContext, targetChanged: Record<string, boolean> | null = null): Request {
  const now = ctx.now ?? new Date();
  const asker = ctx.agentName(decision.originAgentId) ?? "An agent";
  const open = decision.status === "open";
  const archive = isArchiveProposal(decision);
  const lifetime = expiryLabel(new Date(decision.expiresAt), now);
  const wakes = decision.continuationPolicy === "wake_origin_agent";
  const at = decision.decidedAt ? new Date(decision.decidedAt) : new Date(decision.updatedAt);
  const by = decision.decidedByUserId ? (decision.decidedByUserId === ctx.youId ? "You" : ctx.personName(decision.decidedByUserId)) : "Someone";
  const chosen = decision.options.find((option) => option.id === decision.chosenOptionId);

  let verdict: Request["verdict"] = null;
  let result: Request["result"] = null;
  if (!open) {
    const expired = (decision.metadata as { expiredReason?: string } | null)?.expiredReason;
    if (decision.status === "expired") verdict = { text: EXPIRED[expired ?? ""] ?? "Expired without an answer", tone: "muted", at };
    else if (decision.status === "cancelled") verdict = { text: `Withdrawn by ${asker}`, tone: "muted", at };
    else if (wasDismissed(decision)) verdict = { text: `${by} dismissed it: nothing changed`, tone: "muted", at };
    else {
      verdict = { text: `${by} chose ${chosen?.label ?? "an option"}`, tone: "ok", at };
      const status = decision.executionStatus;
      if (status === "partial") result = { text: "Some changes were applied, some weren't", tone: "mid" };
      else if (status === "failed") result = { text: "The changes didn't apply", tone: "bad" };
      else if (status === "running") result = { text: "Applying the changes…", tone: "muted" };
      else if (wakes) result = { text: `Sent to ${asker}`, tone: "muted" };
    }
  }

  return {
    key: `decision:${decision.id}`,
    source: { type: "decision", decision, targetChanged },
    kind: "proposal",
    shape: "decision",
    outcome: "apply",
    audience: { kind: "people_only", label: "People only" },
    subject: ctx.task
      ? ctx.task.identifier
        ? { kind: "task", label: ctx.task.identifier, title: ctx.task.title || undefined, issueId: ctx.task.id }
        : { kind: "task", label: ctx.task.title, issueId: ctx.task.id }
      : null,
    formal: false,
    acts: !archive && decision.options.some((option) => option.effects.length > 0),
    asker: { agentId: decision.originAgentId, userId: null, name: asker },
    askVerb: archive ? "proposes archiving" : "proposes changes",
    title: decision.title,
    body: decision.body?.trim() || null,
    next: archive
      ? `Archiving takes the listed items out of the inbox for good${wakes ? `, then tells ${asker}` : ""}.`
      : `Choosing an option applies its changes now${wakes ? `, then tells ${asker}` : ""}. Dismiss changes nothing.`,
    lifetime: lifetime.text,
    lifetimeSoon: lifetime.soon,
    state: open ? "open" : "settled",
    respond: open ? { allowed: true, reason: null } : { allowed: false, reason: null },
    verdict,
    result,
    createdAt: new Date(decision.createdAt),
  };
}
