import type { IssueExecutionPolicy, IssueExecutionStage, IssueExecutionStageType, IssueExecutionState } from "@paperclipai/shared";
import { newId } from "./new-task";

/*
 * A task's review and approval stages (board 2's Review row), after ui/src/lib/issue-execution-
 * policy.ts and the Reviewers and Approvers pickers in ui/src/components/issue-properties/
 * IssueProperties.tsx:
 *
 * - The policy has at most one `review` stage and one `approval` stage, in that order. Each needs one
 *   decision (`approvalsNeeded: 1`) from any of its participants.
 * - Participants are keyed `agent:<id>` or `user:<id>`, like assignees.
 * - Editing keeps the ids of stages and participants that stay, so the server's execution state
 *   still points at them. Everything else in the policy (mode, monitor, authorization, review
 *   preset, round limit) is kept as it was. With no stages and nothing else left, the policy is
 *   cleared (null).
 * - The old UI checks the policy against the shared zod schema and refuses to edit one that doesn't
 *   parse. ui-new only imports types from the shared package, so readPolicy checks the shape it
 *   edits by hand.
 */

export type StageType = IssueExecutionStageType;

export type ReadPolicy = { ok: true; policy: IssueExecutionPolicy | null } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validStage(stage: unknown): stage is IssueExecutionStage {
  if (!isRecord(stage) || typeof stage.id !== "string") return false;
  if (stage.type !== "review" && stage.type !== "approval") return false;
  if (!Array.isArray(stage.participants)) return false;
  return stage.participants.every(
    (participant) =>
      isRecord(participant) &&
      ((participant.type === "agent" && typeof participant.agentId === "string") ||
        (participant.type === "user" && typeof participant.userId === "string")),
  );
}

/** The policy, if it has the shape the stage editor works on. */
export function readPolicy(policy: unknown): ReadPolicy {
  if (policy === null || policy === undefined) return { ok: true, policy: null };
  if (!isRecord(policy) || !Array.isArray(policy.stages) || !policy.stages.every(validStage)) return { ok: false };
  return { ok: true, policy: policy as unknown as IssueExecutionPolicy };
}

function keyOf(participant: { type: "agent" | "user"; agentId?: string | null; userId?: string | null }) {
  return participant.type === "agent" ? `agent:${participant.agentId}` : `user:${participant.userId}`;
}

/** The participants of one stage, as `agent:<id>` and `user:<id>` keys, in order. */
export function stageKeys(policy: unknown, type: StageType): string[] {
  const read = readPolicy(policy);
  if (!read.ok || !read.policy) return [];
  return read.policy.stages.find((stage) => stage.type === type)?.participants.map(keyOf) ?? [];
}

function participantsFor(existing: IssueExecutionStage | undefined, keys: readonly string[], makeId: () => string) {
  const byKey = new Map((existing?.participants ?? []).map((participant) => [keyOf(participant), participant] as const));
  const seen = new Set<string>();
  return keys.flatMap((key) => {
    if (seen.has(key)) return [];
    seen.add(key);
    const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    if (!id || (kind !== "agent" && kind !== "user")) return [];
    const previous = byKey.get(key);
    return [
      {
        id: previous?.id ?? makeId(),
        type: kind,
        agentId: kind === "agent" ? id : null,
        userId: kind === "user" ? id : null,
      } as IssueExecutionStage["participants"][number],
    ];
  });
}

/**
 * The policy with these reviewers and approvers, or null when nothing is left in it. Throws when
 * the current policy can't be read, so a broken policy is never overwritten.
 */
export function buildPolicy(
  existing: unknown,
  reviewers: readonly string[],
  approvers: readonly string[],
  makeId: () => string = newId,
): IssueExecutionPolicy | null {
  const read = readPolicy(existing);
  if (!read.ok) throw new Error("This task's review stages can't be read, so they can't be changed here.");
  const current = read.policy;
  const stages: IssueExecutionStage[] = [];
  for (const [type, keys] of [
    ["review", reviewers],
    ["approval", approvers],
  ] as const) {
    const previous = current?.stages.find((stage) => stage.type === type);
    const participants = participantsFor(previous, keys, makeId);
    if (participants.length > 0) stages.push({ id: previous?.id ?? makeId(), type, approvalsNeeded: 1, participants });
  }
  const monitor = current?.monitor ?? null;
  if (stages.length === 0 && !monitor && !current?.authorizationPolicy && !current?.reviewPreset && current?.maxReviewRounds == null) {
    return null;
  }
  return {
    ...current,
    mode: current?.mode ?? "normal",
    commentRequired: true,
    stages,
    ...(monitor ? { monitor } : {}),
  };
}

export type MonitorPolicy = NonNullable<IssueExecutionPolicy["monitor"]>;

/**
 * The policy with this monitor (a scheduled re-check, such as on an external service), or without
 * one, keeping the stages; null when nothing is left. After `updateMonitor` in the old panel.
 */
export function withMonitor(existing: unknown, monitor: MonitorPolicy | null, makeId: () => string = newId): IssueExecutionPolicy | null {
  const read = readPolicy(existing);
  if (!read.ok) throw new Error("This task's execution policy can't be read, so its monitor can't be changed here.");
  const withoutMonitor = read.policy ? { ...read.policy, monitor: null } : null;
  const base = buildPolicy(withoutMonitor, stageKeys(existing, "review"), stageKeys(existing, "approval"), makeId);
  if (base) delete base.monitor;
  if (!monitor) return base;
  return { ...(base ?? { mode: "normal", commentRequired: true, stages: [] }), monitor };
}

/** A monitor the board schedules: when, what to re-check, and an optional external service. */
export function boardMonitor(input: { at: string; notes: string; service: string }): MonitorPolicy | null {
  const when = new Date(input.at);
  if (!input.at || Number.isNaN(when.getTime())) return null;
  const serviceName = input.service.trim() || null;
  return {
    nextCheckAt: when.toISOString(),
    notes: input.notes.trim() || null,
    scheduledBy: "board",
    kind: serviceName ? "external_service" : null,
    serviceName,
    externalRef: null,
  };
}

/** A date as a `datetime-local` field's value, in local time. */
export function toDateTimeLocal(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Names a participant key: "You", an agent's or a person's name. */
export type NameOf = (key: string) => string;

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** "Sam reviews", "you review", "Sam or Lee approves". Clauses sit mid-sentence, so "You" is "you". */
function clause(keys: string[], nameOf: NameOf, verb: "review" | "approve") {
  const names = keys.map((key) => (nameOf(key) === "You" ? "you" : nameOf(key)));
  const plural = names.length === 1 && names[0] === "you";
  return `${joinNames(names)} ${plural ? verb : `${verb}s`}`;
}

/**
 * The stages in a sentence, as board 2 has it: "When it's done, Sam reviews, then Alex approves".
 * Null when the task has no stages.
 */
export function reviewSentence(policy: unknown, nameOf: NameOf): string | null {
  const reviewers = stageKeys(policy, "review");
  const approvers = stageKeys(policy, "approval");
  const parts = [
    reviewers.length > 0 ? clause(reviewers, nameOf, "review") : null,
    approvers.length > 0 ? clause(approvers, nameOf, "approve") : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return `When it's done, ${parts.join(", then ")}`;
}

/** Where the stages stand: "Review pending with Sam", "Alex asked for changes", or null. */
export function executionStatus(state: IssueExecutionState | null | undefined, nameOf: NameOf): string | null {
  if (!state?.currentStageType) return null;
  const stage = state.currentStageType === "review" ? "Review" : "Approval";
  const who = state.currentParticipant ? nameOf(keyOf(state.currentParticipant)) : null;
  if (state.status === "changes_requested") return who ? `${who} asked for changes in ${stage.toLowerCase()}` : `Changes asked for in ${stage.toLowerCase()}`;
  if (state.status === "pending") return `${stage} pending${who ? ` with ${who === "You" ? "you" : who}` : ""}`;
  return null;
}

/**
 * The stage "Run review now" (or "Run approval now") would start, as the old properties panel works
 * it out: the stage that asked for changes, or, when no stage has started, the first one there is.
 */
export function nextRunnableStage(policy: unknown, state: IssueExecutionState | null | undefined): StageType | null {
  if (state?.status === "changes_requested" && state.currentStageType) return state.currentStageType;
  if (state) return null;
  if (stageKeys(policy, "review").length > 0) return "review";
  if (stageKeys(policy, "approval").length > 0) return "approval";
  return null;
}

/** Ticks or unticks one participant of a stage. */
export function toggleKey(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((each) => each !== key) : [...keys, key];
}
