import type { AcceptedPlanDecompositionSummary } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { GitBranch } from "lucide-solid";
import { For, Show } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import type { TaskPeople } from "./people";
import { StatusChip } from "./TaskDetails";
import { stampLabel } from "./thread-model";

/*
 * The plan revisions an agent accepted and split into subtasks (decision 12: built in, from
 * `enableIssuePlanDecompositions`), after the old UI's IssuePlanDecompositionsSection: each with
 * whether it's finished, how many of the subtasks it asked for exist, who owns it, and the subtasks.
 * Nothing shows until a plan has been split.
 */

export function PlanDecompositions(props: {
  taskId: string;
  people: TaskPeople;
  onOpenTask: (task: { id: string; identifier: string | null }) => void;
}) {
  const query = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "plan-decompositions"),
    queryFn: ({ signal }) => issuesApi.acceptedPlanDecompositions(props.taskId, signal),
    staleTime: 30_000,
  }));
  const items = () => query.data ?? [];
  return (
    <Show when={items().length > 0}>
      <section class="td-section" aria-labelledby={`td-plans-${props.taskId}`}>
        <div class="td-section-head">
          <GitBranch size={16} aria-hidden="true" />
          <h2 class="disp" id={`td-plans-${props.taskId}`}>
            Plan split into subtasks
          </h2>
          <span class="td-muted">
            {items().length} accepted revision{items().length === 1 ? "" : "s"}
          </span>
        </div>
        <For each={items()}>{(record) => <Decomposition record={record} people={props.people} onOpenTask={props.onOpenTask} />}</For>
      </section>
    </Show>
  );
}

function Decomposition(props: {
  record: AcceptedPlanDecompositionSummary;
  people: TaskPeople;
  onOpenTask: (task: { id: string; identifier: string | null }) => void;
}) {
  const requested = () => props.record.requestedChildCount ?? 0;
  const made = () => props.record.childIssueIds?.length ?? 0;
  const revision = () =>
    props.record.acceptedPlanRevisionNumber != null ? `rev ${props.record.acceptedPlanRevisionNumber}` : `rev ${props.record.acceptedPlanRevisionId.slice(0, 8)}`;
  const owner = () => props.people.agent(props.record.ownerAgentId)?.name ?? null;
  const done = () => props.record.status === "completed";
  return (
    <div class="card td-plan">
      <div class="td-plan-head">
        <span class="td-chip td-chip--small" data-tone={done() ? "green" : "amber"}>
          {done() ? "Completed" : "In flight"}
        </span>
        <span>
          Plan {revision()} · {made()} of {requested()} subtask{requested() === 1 ? "" : "s"} made
        </span>
        <Show when={done() && requested() > 0}>
          <span class="td-muted" title="Splitting the same plan again reuses these subtasks instead of making new ones.">
            · repeat-safe
          </span>
        </Show>
      </div>
      <span class="td-muted">
        <Show when={owner()}>{(name) => <>Owner {name()} · </>}</Show>
        Started {stampLabel(props.record.createdAt)}
        <Show when={props.record.completedAt} fallback={<> · updated {stampLabel(props.record.updatedAt)}</>}>
          {(at) => <> · completed {stampLabel(at())}</>}
        </Show>
      </span>
      <Show when={props.record.childIssues.length > 0}>
        <div class="td-plan-kids">
          <For each={props.record.childIssues}>
            {(child) => (
              <button type="button" class="td-link td-plan-kid" title={child.title} onClick={() => props.onOpenTask(child)}>
                <span class="mono td-id">{child.identifier ?? child.id.slice(0, 8)}</span>
                <span class="td-ellipsis">{child.title}</span>
                <StatusChip status={child.status} small />
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
