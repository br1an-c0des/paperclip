import type { Agent } from "@paperclipai/shared";
import { createMemo, Match, Switch } from "solid-js";
import { personName } from "@/api/access";
import { useAgentsQuery, useLiveRunsQuery, usePeopleQuery } from "@/lib/company-data";
import { useSession } from "@/lib/session";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import "./people.css";

/*
 * Who a task belongs to, for the task list and panel: agents by id, people by id from the company's
 * user directory, and you; who a task can be assigned to. Also which tasks have a run going right now.
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

  const assignableAgents = createMemo(() =>
    (agents.data ?? []).filter((agent) => agent.status !== "terminated").sort((a, b) => a.name.localeCompare(b.name)),
  );
  const otherPeople = createMemo(() =>
    (people.data?.users ?? [])
      .filter((entry) => entry.principalId !== session.youId())
      .map((entry) => ({ id: entry.principalId, name: personName(entry) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  return {
    agent: (id: string | null | undefined): Agent | undefined => (id ? agentsById().get(id) : undefined),
    /** Agents a task can go to, by name: everyone but terminated agents. */
    assignableAgents,
    /** The company's people other than you, by name. */
    otherPeople,
    personName: (id: string) => namesById().get(id) ?? (id === "local-board" ? "Board" : `User ${id.slice(0, 6)}`),
    youId: () => session.youId(),
    liveIssueIds,
  };
}

type Assigned = { assigneeAgentId: string | null; assigneeUserId: string | null };

/** Who a task is assigned to, in words: an agent's name, "You", a person's name, or "Unassigned". */
export function assigneeName(task: Assigned, people: TaskPeople) {
  const agent = people.agent(task.assigneeAgentId);
  if (agent) return agent.name;
  if (task.assigneeUserId) return task.assigneeUserId === people.youId() ? "You" : people.personName(task.assigneeUserId);
  return "Unassigned";
}

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
