import { ChevronDown, ListChecks } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { viewport } from "@/layout/breakpoints";
import { planHeadline, type Plan } from "@/runs/activity-model";
import { PlanChecklist, PlanProgress } from "@/runs/RunActivity";

/*
 * The agent's native plan, docked above the chat's composer while it replies (U42, upstream
 * #19252): what it finished, what it's on and what's next, the same for every harness that reports
 * a plan. The live reply hands the plan up (LiveReply's `onPlan`); the dock sits on the chat's side
 * of the composer, which the chat shares with the task thread.
 *
 * As in the old UI: it's gone once the reply ends; it folds to its header when every step is done
 * (unless the reader opened it again), while a runtime request waits for an answer, and by default
 * on a phone, where the dock's height is scarce; a plan of more than seven steps shows a window
 * around the current step.
 */

export function ChatPlanDock(props: { plan: Plan; asking: boolean }) {
  // The reader's own choice wins over the automatic one; null until they make it.
  const [chosen, setChosen] = createSignal<boolean | null>(null);
  const open = () => !props.asking && (chosen() ?? (viewport() === "desktop" && !props.plan.complete));
  const done = () => props.plan.steps.filter((step) => step.status === "completed").length;
  const problem = () => props.plan.steps.some((step) => step.status === "blocked" || step.status === "failed");
  return (
    <section class="ch-plan" aria-label="The agent's plan" data-state={props.plan.complete ? "complete" : problem() ? "blocked" : "active"}>
      <button type="button" class="ch-plan-head" aria-expanded={open()} disabled={props.asking} onClick={() => setChosen(!open())}>
        <ListChecks size={15} aria-hidden="true" class="ch-plan-icon" />
        <span class="ch-plan-title">{planHeadline(props.plan)}</span>
        <span class="ch-plan-count" aria-hidden="true">
          {done()}/{props.plan.steps.length}
        </span>
        <span class="sr-only">
          {done()} of {props.plan.steps.length} steps done
        </span>
        <Show when={!props.asking}>
          <ChevronDown size={14} aria-hidden="true" class="ch-plan-chev" />
        </Show>
      </button>
      <Show when={open()}>
        <div class="ch-plan-body">
          <PlanProgress plan={props.plan} />
          <div class="ch-plan-list">
            <PlanChecklist plan={props.plan} window />
          </div>
        </div>
      </Show>
    </section>
  );
}
