import type { Agent } from "@paperclipai/shared";
import { createMemo, Match, Switch } from "solid-js";
import { personName } from "@/api/access";
import { useAgentsQuery, useLiveRunsQuery, usePeopleQuery } from "@/lib/company-data";
import { useSession } from "@/lib/session";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import "./people.css";

/*
 * Who a task belongs to, for the task list and panel: agents by id, people by id from the company's
 * user directory, and you. Also which tasks have a run going right now.
 */

export type TaskPeople = ReturnType<typeof useTaskPeople>;

export function useTaskPeople() {
  const agents = useAgentsQuery();
  const people = usePeopleQuery();
  const liveRuns = useLiveRunsQuery();
  const session = useSession();

  const agentsById = createMemo(() => new Map((agents.data ?? []).map((agent) => [agent.id, agent] as const)));
  const namesById = createMemo(
    () => new Map((people.data?.users ?? []).map((entry) => [entry.principalId, personName(entry)] as const)),
  );
  const liveIssueIds = createMemo(
    () => new Set((liveRuns.data ?? []).flatMap((run) => (run.issueId ? [run.issueId] : []))),
  );

  return {
    agent: (id: string | null | undefined): Agent | undefined => (id ? agentsById().get(id) : undefined),
    personName: (id: string) => namesById().get(id) ?? (id === "local-board" ? "Board" : `User ${id.slice(0, 6)}`),
    youId: () => session.youId(),
    liveIssueIds,
  };
}

type Assigned = { assigneeAgentId: string | null; assigneeUserId: string | null };

/** The assignee cell: an agent's avatar, a person's disc, or a dashed empty disc. */
export function Assignee(props: { task: Assigned; people: TaskPeople; size?: 20 | 24 }) {
  const size = () => props.size ?? 24;
  const agent = () => props.people.agent(props.task.assigneeAgentId);
  const you = () => props.task.assigneeUserId !== null && props.task.assigneeUserId === props.people.youId();
  return (
    <span class="assignee">
      <Switch fallback={<span class="assignee-none" style={{ width: `${size()}px`, height: `${size()}px` }} aria-hidden="true" />}>
        <Match when={agent()}>{(found) => <AgentAvatar agent={found()} size={size()} />}</Match>
        <Match when={props.task.assigneeUserId}>
          {(id) => <InitialsDisc name={props.people.personName(id())} seed={id()} size={size()} you={you()} />}
        </Match>
      </Switch>
      <span class="assignee-name" classList={{ "assignee-name--none": !agent() && !props.task.assigneeUserId }}>
        <Switch fallback="Unassigned">
          <Match when={agent()}>{(found) => found().name}</Match>
          <Match when={you()}>You</Match>
          <Match when={props.task.assigneeUserId}>{(id) => props.people.personName(id())}</Match>
        </Switch>
      </span>
    </span>
  );
}
