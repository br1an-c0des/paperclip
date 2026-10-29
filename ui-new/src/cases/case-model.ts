import type { Tone } from "@/ui/Status";
import type { Gradient } from "@/ui/status-meta";
import type { CaseDetail, CaseHandoffView, CaseLinkRole, CaseStatus, CaseSummary } from "@/api/cases";
import { findPhase, type WorkflowDiagram } from "./workflow-diagram";

/*
 * What the case boards (C1, C2, C5) draw, worked out from what the API stores (decision 16):
 *
 * - The phase track: the workflow diagram's phases (workflow-diagram.ts), each done, current, queued
 *   or still to come, with the agent who took it and how many rounds it took, from the hand-offs.
 *   Phases before the current one count as done; so do later ones the case has been through and
 *   looped back from. Without a diagram there's no track, only the current phase as text.
 * - Ticks: the same states, one small mark per phase, for chips and group headings.
 * - Membership: which cases each task is in, and as what. A case's main task comes with the case
 *   list (`workIssueId`); its other tasks need the case itself (`GET /cases/:id`), one request per
 *   case rather than one per task.
 */

export const CASE_STATUS_META: Record<CaseStatus, { label: string; gradient: Gradient; tone: Tone | null }> = {
  draft: { label: "Draft", gradient: "ash", tone: null },
  in_progress: { label: "In progress", gradient: "ion", tone: "run" },
  in_review: { label: "In review", gradient: "orchid", tone: "violet" },
  approved: { label: "Approved", gradient: "lagoon", tone: "green" },
  done: { label: "Done", gradient: "lagoon", tone: "green" },
  cancelled: { label: "Cancelled", gradient: "ash", tone: null },
};

export function caseStatusMeta(status: string) {
  return CASE_STATUS_META[status as CaseStatus] ?? { label: status, gradient: "ash" as Gradient, tone: null };
}

export function isClosedCase(status: string) {
  return status === "done" || status === "cancelled";
}

/** The task's part in a case: its main task, work toward it, or related context. */
export type CaseRole = "main" | CaseLinkRole;

export const ROLE_LABEL: Record<CaseRole, string> = {
  main: "Main task",
  work: "Work",
  origin: "Started it",
  reference: "Reference",
};

/** A hand-off still on its way: not delivered, finished or cancelled. */
export function isPendingHandoff(handoff: Pick<CaseHandoffView, "state"> | null | undefined) {
  return !!handoff && ["awaiting_release", "pending_dispatch", "awaiting_completion"].includes(handoff.state);
}

/** Hand-offs that moved the work (cancelled before the transfer didn't). */
function counted(handoffs: readonly CaseHandoffView[]) {
  return handoffs.filter((handoff) => handoff.state !== "cancelled" || !!handoff.assignmentAppliedAt);
}

export type PhaseState = "done" | "current" | "queued" | "future";

export type TrackStep = {
  name: string;
  state: PhaseState;
  /** The agent who last took this phase, from the hand-offs. */
  agentId: string | null;
  agentName: string | null;
  /** Hand-offs into this phase. */
  rounds: number;
  /** What the step says under its name: "working now", "hand-off queued", "2 rounds". */
  note: string;
  /** The finish (`[*]`), drawn as a flag. */
  end?: boolean;
};

/** What the current phase is doing, from the main task's status and a hand-off waiting to start. */
export function currentNote(taskStatus: string | null | undefined, pending: CaseHandoffView | null | undefined): string {
  if (pending && isPendingHandoff(pending) && pending.assignmentAppliedAt && pending.destinationKind === "agent") return "waiting to start";
  switch (taskStatus) {
    case "in_progress":
      return "working now";
    case "todo":
    case "backlog":
      return "up next";
    case "in_review":
      return "in review";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    default:
      return "";
  }
}

export type TrackInput = {
  diagram: WorkflowDiagram;
  phase: string | null;
  status: string;
  taskStatus?: string | null;
  pending?: CaseHandoffView | null;
  handoffs?: readonly CaseHandoffView[];
};

/**
 * The phase track. A hand-off that hasn't been applied yet (`awaiting_release`: the agent is still
 * finishing) is queued on the phase it goes to; once applied, the case's phase already names it.
 */
export function phaseTrack(input: TrackInput): TrackStep[] {
  const { diagram } = input;
  const handoffs = counted(input.handoffs ?? []);
  const closed = input.status === "done";
  const current = closed ? -1 : findPhase(diagram, input.phase);
  const pending = isPendingHandoff(input.pending) ? input.pending! : null;
  const queued = pending && !pending.assignmentAppliedAt && pending.destinationKind === "agent" ? findPhase(diagram, pending.phase) : -1;
  const visited = new Set(handoffs.map((handoff) => findPhase(diagram, handoff.phase)).filter((at) => at >= 0));
  const steps: TrackStep[] = diagram.phases.map((phase, at) => {
    const into = handoffs.filter((handoff) => findPhase(diagram, handoff.phase) === at);
    // The list is newest first.
    const last = into[0];
    let state: PhaseState = "future";
    if (closed || (current >= 0 && at < current) || (visited.has(at) && at !== current)) state = "done";
    if (at === current) state = queued >= 0 ? "done" : "current";
    if (at === queued) state = "queued";
    const rounds = into.length;
    const note =
      state === "current" ? currentNote(input.taskStatus, pending) : state === "queued" ? "hand-off queued" : rounds > 1 ? `${rounds} rounds` : "";
    return { name: phase.name, state, agentId: last?.toAgentId ?? null, agentName: last?.toAgentName ?? null, rounds, note };
  });
  if (diagram.ends) {
    steps.push({ name: "Done", state: closed ? "done" : "future", agentId: null, agentName: null, rounds: 0, note: "", end: true });
  }
  return steps;
}

/** "Phase 2 of 4", counting the workflow's phases (not the finish); null off the diagram. */
export function phasePosition(diagram: WorkflowDiagram, phase: string | null): string | null {
  const at = findPhase(diagram, phase);
  return at >= 0 ? `Phase ${at + 1} of ${diagram.phases.length}` : null;
}

/** One tick per step: done, current, queued, or to come. */
export type Tick = PhaseState;

export function phaseTicks(input: TrackInput): Tick[] {
  return phaseTrack(input).map((step) => step.state);
}

/** Hand-offs into the current phase: how many rounds it has taken, for a case without a diagram. */
export function roundsOf(handoffs: readonly CaseHandoffView[], phase: string | null) {
  if (!phase) return 0;
  const wanted = phase.trim().toLowerCase();
  return counted(handoffs).filter((handoff) => handoff.phase.trim().toLowerCase() === wanted).length;
}

/** "Research → Build", or "Started · Research" for the first hand-off. */
export function handoffMove(handoff: Pick<CaseHandoffView, "phase" | "destinationKind" | "workflowTransition">) {
  if (handoff.destinationKind === "done") return "Closed the case";
  const from = handoff.workflowTransition?.from.phase;
  return from && from !== handoff.phase ? `${from} → ${handoff.phase}` : from ? handoff.phase : `Started · ${handoff.phase}`;
}

/** A hand-off's state as a short label, after the old UI's history rows. */
export function handoffStateLabel(handoff: Pick<CaseHandoffView, "state" | "assignmentAppliedAt" | "destinationKind">) {
  switch (handoff.state) {
    case "delivered":
    case "completed":
      return "Delivered";
    case "cancelled":
      return handoff.assignmentAppliedAt ? "Delivery cancelled" : "Cancelled";
    case "awaiting_completion":
      return "Waiting for the task to finish";
    case "awaiting_release":
      return "Queued";
    default:
      return handoff.destinationKind === "agent" && handoff.assignmentAppliedAt ? "Waiting to start" : "Queued";
  }
}

export type Membership = { case: CaseSummary; role: CaseRole };

/**
 * Each task's cases, by task id: the main task from the case list, other links from each case's
 * detail. Main tasks come first, then by the case list's order (newest change first).
 */
export function caseMembership(cases: readonly CaseSummary[], details: ReadonlyMap<string, CaseDetail>): Map<string, Membership[]> {
  const byTask = new Map<string, Membership[]>();
  const add = (taskId: string, entry: Membership) => {
    const list = byTask.get(taskId) ?? [];
    if (list.some((each) => each.case.id === entry.case.id)) return;
    list.push(entry);
    byTask.set(taskId, list);
  };
  for (const kase of cases) if (kase.workIssueId) add(kase.workIssueId, { case: kase, role: "main" });
  for (const kase of cases) {
    for (const link of details.get(kase.id)?.issueLinks ?? []) {
      if (link.issueId === kase.workIssueId) continue;
      add(link.issueId, { case: kase, role: link.role });
    }
  }
  return byTask;
}

/** How many cases use each workflow, from the case list ("Used by 3 cases"). */
export function workflowUse(cases: readonly CaseSummary[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const kase of cases) if (kase.workflowId) counts.set(kase.workflowId, (counts.get(kase.workflowId) ?? 0) + 1);
  return counts;
}

/**
 * Cases in group order: open ones first, each parent followed by its children (to any depth), newest
 * change first among siblings; then closed ones the same way.
 */
export function orderCases(cases: readonly CaseSummary[]): { case: CaseSummary; depth: number }[] {
  const ids = new Set(cases.map((kase) => kase.id));
  const children = new Map<string, CaseSummary[]>();
  const roots: CaseSummary[] = [];
  for (const kase of cases) {
    if (kase.parentCaseId && ids.has(kase.parentCaseId) && kase.parentCaseId !== kase.id) {
      const list = children.get(kase.parentCaseId) ?? [];
      list.push(kase);
      children.set(kase.parentCaseId, list);
    } else roots.push(kase);
  }
  const out: { case: CaseSummary; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (kase: CaseSummary, depth: number) => {
    if (seen.has(kase.id)) return;
    seen.add(kase.id);
    out.push({ case: kase, depth });
    for (const child of children.get(kase.id) ?? []) walk(child, depth + 1);
  };
  for (const kase of roots.filter((each) => !isClosedCase(each.status))) walk(kase, 0);
  for (const kase of roots.filter((each) => isClosedCase(each.status))) walk(kase, 0);
  // A parent loop (which the server should refuse) leaves cases unreached; they go last.
  for (const kase of cases) walk(kase, 0);
  return out;
}

/** A field's value for the fields table and the stats: text, a list of short values, or not set. */
export type FieldValue = { kind: "text"; text: string } | { kind: "list"; items: string[] } | { kind: "unset" };

function short(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * A case's fields, flattened one level (`backtest.sharpe`) so nested results read as rows. Lists of
 * plain values become pills; anything deeper is shown as JSON.
 */
export function caseFields(fields: Record<string, unknown> | null | undefined): { key: string; value: FieldValue }[] {
  const rows: { key: string; value: FieldValue }[] = [];
  const add = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return rows.push({ key, value: { kind: "unset" } });
    if (Array.isArray(value) && value.every((item) => item === null || typeof item !== "object")) {
      return rows.push({ key, value: { kind: "list", items: value.map(short) } });
    }
    rows.push({ key, value: { kind: "text", text: short(value) } });
  };
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) add(`${key}.${inner}`, innerValue);
    } else add(key, value);
  }
  return rows;
}

/** The first few fields with a value, as stats for a case's group heading (board C2). */
export function caseStats(fields: Record<string, unknown> | null | undefined, count = 3): { key: string; value: string }[] {
  return caseFields(fields)
    .filter((row) => row.value.kind !== "unset")
    .slice(0, count)
    .map((row) => ({ key: row.key.split(".").at(-1)!.replace(/_/g, " "), value: row.value.kind === "list" ? row.value.items.join(", ") : row.value.kind === "text" ? row.value.text : "" }));
}

/**
 * The line Start a case adds to a new task's description (board C5, decision F). The API has no
 * field for asking an agent to set up a case, so the request goes in the words the agent reads.
 */
const START_CASE_LINE = "Set up a case for this task and make this task its main task.";

export function startCaseRequest(template: { id: string; name: string } | null) {
  const using = template ? ` Use the company's "${template.name}" workflow (workflowId ${template.id}).` : " Write the case's workflow yourself.";
  return `${START_CASE_LINE}${using}`;
}

/** Whether a task's description asks for a case (Start a case), for "Case requested" on its row. */
export function asksForCase(description: string | null | undefined) {
  return !!description?.includes(START_CASE_LINE);
}

/** The description with the Start a case line appended, after a rule. */
export function withStartCaseRequest(description: string, template: { id: string; name: string } | null) {
  const line = startCaseRequest(template);
  const body = description.trimEnd();
  return body ? `${body}\n\n---\n\n${line}` : line;
}
