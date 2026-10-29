import { For, Show } from "solid-js";
import type { CaseSummary } from "@/api/cases";
import { caseStatusMeta, currentNote, phaseTicks, ROLE_LABEL, type CaseRole, type Tick } from "./case-model";
import type { WorkflowDiagram } from "./workflow-diagram";
import "./cases.css";

/*
 * Case marks for task rows and headings (boards C1, C2 and C5): the case chip, solid with the
 * phase ticks on the case's main task and dashed on a task linked to it, and the ticks alone.
 */

/** A briefcase, after the boards' case icon (lucide has none that matches). */
export function CaseIcon(props: { size?: number }) {
  return (
    <svg aria-hidden="true" width={props.size ?? 13} height={props.size ?? 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="7" width="12" height="14" rx="2.5" />
      <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h7A2.5 2.5 0 0 1 20 5.5v9a2.5 2.5 0 0 1-2.5 2.5H16" />
    </svg>
  );
}

export function PhaseTicks(props: { ticks: readonly Tick[] }) {
  return (
    <span class="case-ticks" aria-hidden="true">
      <For each={props.ticks}>{(tick) => <i data-tick={tick} />}</For>
    </span>
  );
}

/** The ticks for a case from the list: its workflow's diagram, its phase and its main task. */
export function caseTicks(kase: CaseSummary, diagram: WorkflowDiagram | null): Tick[] {
  if (!diagram) return [];
  return phaseTicks({ diagram, phase: kase.phase, status: kase.status, taskStatus: kase.workIssue?.status, pending: kase.pendingHandoff });
}

/** "Build, working now", or the case's status when it has no phase yet. */
export function phaseSummary(kase: CaseSummary) {
  if (!kase.workIssueId) return "No work yet";
  if (!kase.phase) return caseStatusMeta(kase.status).label;
  const note = currentNote(kase.workIssue?.status, kase.pendingHandoff);
  return note ? `${kase.phase}, ${note}` : kase.phase;
}

export function CaseChip(props: { kase: CaseSummary; role: CaseRole; diagram: WorkflowDiagram | null; size?: "row" | "head" }) {
  const main = () => props.role === "main";
  const ticks = () => (main() ? caseTicks(props.kase, props.diagram) : []);
  const title = () =>
    main()
      ? `Main task of ${props.kase.identifier}, ${props.kase.title}: ${phaseSummary(props.kase)}`
      : `${ROLE_LABEL[props.role]} in ${props.kase.identifier}, ${props.kase.title}`;
  return (
    <span class="case-chip" classList={{ "case-chip--link": !main(), "case-chip--head": props.size === "head" }} title={title()}>
      <CaseIcon />
      <span class="sr-only">{title()}</span>
      <span class="mono" aria-hidden="true">
        {props.kase.identifier}
      </span>
      <Show when={ticks().length > 0}>
        <PhaseTicks ticks={ticks()} />
      </Show>
    </span>
  );
}

/** The case's status: a tinted pill with its capsule. */
export function CaseStatusPill(props: { status: string }) {
  const meta = () => caseStatusMeta(props.status);
  return (
    <span class="case-status" classList={{ [`case-status--${meta().tone ?? "plain"}`]: true }}>
      <span class="capsule capsule--tiny" style={{ background: `var(--g-${meta().gradient})` }} aria-hidden="true" />
      {meta().label}
    </span>
  );
}
