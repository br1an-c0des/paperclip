import { useQueryClient } from "@tanstack/solid-query";
import { Play } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { casesApi, type CaseDetail, type CaseSummary } from "@/api/cases";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { caseStats, handoffStateLabel, isPendingHandoff } from "./case-model";
import { CaseStatusPill, caseTicks, phaseSummary, PhaseTicks } from "./CaseChip";
import { StartWorkflowDialog } from "./StartWorkflow";
import type { WorkflowDiagram } from "./workflow-diagram";
import "./cases.css";

/*
 * A case's group heading under Group: Case (board C2). Beside the title and count: the case's type
 * and identifier, its status, and its phase ticks with the current phase. Under the bar: a few of
 * its fields as stats, its workflow and how many documents its tasks have, then a strip while a
 * hand-off is on its way (with Cancel hand-off), or, for a case with no work yet, Start workflow.
 */

export function CaseHeadAfter(props: { kase: CaseSummary; diagram: WorkflowDiagram | null }) {
  return (
    <>
      <span class="case-chip">
        {props.kase.caseType}
        <span class="mono">{props.kase.identifier}</span>
      </span>
      <CaseStatusPill status={props.kase.status} />
      <CasePhase kase={props.kase} diagram={props.diagram} />
    </>
  );
}

function CasePhase(props: { kase: CaseSummary; diagram: WorkflowDiagram | null }) {
  const ticks = () => caseTicks(props.kase, props.diagram);
  return (
    <span class="case-head-phase">
      <Show when={ticks().length > 0}>
        <PhaseTicks ticks={ticks()} />
      </Show>
      <span>{phaseSummary(props.kase)}</span>
    </span>
  );
}

export function CaseHeadBelow(props: { kase: CaseSummary; detail: CaseDetail | undefined; diagram: WorkflowDiagram | null }) {
  const company = useCompany();
  const client = useQueryClient();
  const stats = () => caseStats(props.kase.fields);
  const docs = () => props.detail?.taskDocuments?.length ?? 0;
  const pending = () => (isPendingHandoff(props.kase.pendingHandoff) ? props.kase.pendingHandoff : null);
  const [cancelling, setCancelling] = createSignal(false);
  const [starting, setStarting] = createSignal(false);
  const meta = () =>
    [props.kase.workflow?.name, props.detail && props.kase.workIssueId ? `${docs()} document${docs() === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  const cancel = async () => {
    const handoff = pending();
    if (!handoff) return;
    setCancelling(true);
    try {
      await casesApi.cancelHandoff(props.kase.id, handoff.id);
      pushToast({ tone: "success", title: "Hand-off cancelled", body: `${props.kase.identifier} stays with its current agent.` });
      void client.invalidateQueries({ queryKey: queryKeys.cases.all(company().id) });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't cancel the hand-off", body: error instanceof Error ? error.message : String(error) });
    } finally {
      setCancelling(false);
    }
  };
  return (
    <>
      {/* On a phone the heading keeps only the name and status; the type, ID and phase move here. */}
      <div class="case-head-phone">
        <span class="case-chip">
          {props.kase.caseType}
          <span class="mono">{props.kase.identifier}</span>
        </span>
        <CasePhase kase={props.kase} diagram={props.diagram} />
      </div>
      <Show when={stats().length > 0 || meta()}>
        <div class="case-head-stats">
          <For each={stats()}>
            {(stat) => (
              <span class="case-stat">
                <b class="disp">{stat.value}</b>
                <span>{stat.key}</span>
              </span>
            )}
          </For>
          <Show when={meta()}>
            <span class="case-head-meta">{meta()}</span>
          </Show>
        </div>
      </Show>
      <Show when={pending()}>
        {(handoff) => (
          <div class="case-head-strip" role="status">
            <span class="capsule capsule--row" style={{ background: "var(--g-ion)" }} aria-hidden="true" />
            <span class="case-head-strip-text">
              <strong>{handoff().destinationKind === "done" ? "Closing" : `Hand-off to ${handoff().phase}`}</strong>{" "}
              {handoff().toAgentName ? `${handoff().toAgentName}: ` : ""}
              {handoffStateLabel(handoff()).toLowerCase()}
            </span>
            <Show when={handoff().destinationKind === "agent"}>
              <Button size="compact" disabled={cancelling()} onClick={() => void cancel()}>
                {cancelling() ? "Cancelling…" : "Cancel hand-off"}
              </Button>
            </Show>
          </div>
        )}
      </Show>
      <Show when={!props.kase.workIssueId && props.kase.status !== "done" && props.kase.status !== "cancelled"}>
        <div class="case-head-strip case-head-strip--draft">
          <span class="case-head-strip-text">
            <strong>No work yet.</strong> Starting its workflow hands the case to an agent, with a new main task.
          </span>
          <Button size="compact" icon={<Play size={13} aria-hidden="true" />} onClick={() => setStarting(true)}>
            Start workflow
          </Button>
        </div>
        <StartWorkflowDialog kase={props.kase} open={starting()} onOpenChange={setStarting} />
      </Show>
    </>
  );
}
