import type { Issue } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import { Repeat, UserCheck, UserMinus } from "lucide-solid";
import { Match, Show, Switch } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { recurringPath, useRoutineQuery } from "@/recurring/queries";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import type { TaskPeople } from "./people";
import { originRoutineId, originTask, originText, requester, reviewPolicyBadge } from "./task-origin";

/*
 * The Details rows about where a task came from (task-origin.ts): who asked for it, the recurring
 * task or the other task it was made for, and how deep in a chain of delegations it sits. Also the
 * review-policy badge beside the Review row.
 */

/** "You", a person, or an agent; a person working through an agent reads "Ana via Builder". */
export function RequesterValue(props: { task: Issue; people: TaskPeople }) {
  const who = () => requester(props.task);
  return (
    <Show when={who()}>
      {(found) => (
        <span class="td-inline">
          <Switch>
            <Match when={found().kind === "agent" && props.people.agent(found().id)}>
              {(agent) => (
                <>
                  <AgentAvatar agent={agent()} size={20} />
                  <span>{agent().name}</span>
                </>
              )}
            </Match>
            <Match when={found().kind === "user"}>
              <InitialsDisc name={props.people.personName(found().id)} seed={found().id} size={20} you={found().id === props.people.youId()} />
              <span>{found().id === props.people.youId() ? "You" : props.people.personName(found().id)}</span>
              <Show when={found().kind === "user" && (found() as { viaAgentId?: string }).viaAgentId}>
                {(agentId) => <span class="td-muted">via {props.people.agent(agentId())?.name ?? "an agent"}</span>}
              </Show>
            </Match>
            <Match when={true}>
              <span class="td-muted">An agent</span>
            </Match>
          </Switch>
        </span>
      )}
    </Show>
  );
}

/** Whether the task has an origin row to show. */
export function hasOrigin(task: Issue) {
  return !!originRoutineId(task) || !!originTask(task) || !!originText(task.originKind);
}

/** The recurring task that made this one, the task Paperclip raised it for, or the origin in words. */
export function OriginValue(props: { task: Issue; onOpenTask: (task: { id: string; identifier: string | null }) => void }) {
  const company = useCompany();
  const routine = useRoutineQuery(() => originRoutineId(props.task));
  const source = () => originTask(props.task);
  const sourceTask = createQuery(() => ({
    queryKey: queryKeys.issues.detail(source()?.taskId ?? ""),
    queryFn: ({ signal }) => issuesApi.get(source()!.taskId, signal),
    enabled: !!source(),
    staleTime: 60_000,
  }));
  return (
    <Switch fallback={<span class="td-muted">{originText(props.task.originKind)}</span>}>
      <Match when={originRoutineId(props.task)}>
        {(routineId) => (
          <A class="td-chip td-chip--link" href={recurringPath(company().issuePrefix, routineId())} title="Open the recurring task">
            <Repeat size={13} aria-hidden="true" />
            <span class="td-ellipsis">{routine.data?.title ?? (routine.isError ? "A recurring task" : "Recurring task…")}</span>
          </A>
        )}
      </Match>
      <Match when={source()}>
        {(found) => (
          <span class="td-inline">
            <span class="td-muted">{found().label}</span>
            <Show when={sourceTask.data} fallback={<span class="td-muted">{sourceTask.isError ? "a task you can't see" : "…"}</span>}>
              {(task) => (
                <button type="button" class="td-link td-ellipsis" onClick={() => props.onOpenTask(task())}>
                  <span class="mono td-id">{task().identifier}</span>
                  {task().title}
                </button>
              )}
            </Show>
          </span>
        )}
      </Match>
    </Switch>
  );
}

/** "Anyone else" or "Human only" beside the review stages, when the policy narrows who may approve. */
export function ReviewPolicyBadge(props: { task: Issue }) {
  const badge = () => reviewPolicyBadge(props.task.reviewPolicy);
  return (
    <Show when={badge()}>
      {(found) => (
        <span class="td-chip td-chip--small" title={found().description}>
          <Show when={props.task.reviewPolicy === "human_only"} fallback={<UserMinus size={12} aria-hidden="true" />}>
            <UserCheck size={12} aria-hidden="true" />
          </Show>
          {found().label}
        </span>
      )}
    </Show>
  );
}
