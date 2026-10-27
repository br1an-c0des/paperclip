import type { Agent, CharacterState, Project } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQueries, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Book, FolderOpen, GitBranch } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { approvalsApi } from "@/api/approvals";
import { costsApi } from "@/api/costs";
import { interactionsApi } from "@/api/interactions";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/api/queryKeys";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useLiveRunsQuery } from "@/lib/company-data";
import { RequestCard } from "@/requests/RequestCard";
import { taskRequests } from "@/requests/request-model";
import { updatedLabel } from "@/tasks/list-model";
import { useTaskPeople } from "@/tasks/people";
import { AssigneeItems } from "@/tasks/pickers";
import type { useTaskList } from "@/tasks/TasksView";
import { AgentAvatar } from "@/ui/Avatar";
import { Button, buttonClass } from "@/ui/Button";
import { Markdown } from "@/ui/Markdown";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { Capsule, RunningPill, StatusCapsule, TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import {
  budgetView,
  codeView,
  crew,
  crewSummary,
  formatCents,
  monthWindow,
  openRequests,
  projectSpend,
  requestFilters,
  stuckWork,
  waitingTargets,
  type CrewMember,
  type ProjectTask,
  type RequestFilter,
  type StuckItem,
} from "./dashboard-model";
import "./ProjectDashboard.css";

/*
 * The project dashboard (board 8), the project's home: the header card's title links here.
 *
 * - One card with three wells: Brief (the project's description and goals), Budget (this month's
 *   spend against the project's budget, with the month's pace) and Code (repositories, open task
 *   checkouts and their dev servers). Below a divider, Agents at work: each agent on the project's
 *   tasks, with what it's on and, on hover, its run to watch.
 * - Waiting on you: request cards from the project's tasks that the attention feed says need you,
 *   with a kind filter, and tasks waiting on your sign-off.
 * - Stuck work: open tasks waiting on someone without a request to answer.
 *
 * Not drawn from the board, because the API has no source for them: the AI brief with its revisions
 * (summaries sit behind an experimental flag), daily spend bars (costs come only as totals per
 * range), and each agent's recent activity on hover.
 */

type Tasks = ReturnType<typeof useTaskList>;

const POSE: Record<CrewMember["state"], CharacterState> = {
  running: "working",
  queued: "loading",
  blocked: "confused",
  error: "confused",
  paused: "sleepy",
  idle: "idle",
};

export function ProjectDashboard(props: { project: Project; tasks: Tasks; base: string }) {
  const company = useCompany();
  const commands = useCommands();
  const agents = useAgentsQuery();
  const liveRuns = useLiveRunsQuery();
  const people = useTaskPeople();

  const tasks = createMemo<ProjectTask[]>(() => (props.tasks.data ?? []) as ProjectTask[]);
  const taskById = createMemo(() => new Map(tasks().map((task) => [task.id, task] as const)));
  const agentById = (id: string) => (agents.data ?? []).find((agent) => agent.id === id);
  const openTask = (task: Pick<ProjectTask, "id" | "identifier" | "title">) =>
    commands.openTaskModal({ id: task.id, identifier: task.identifier, title: task.title, projectId: props.project.id });

  // Waiting on you: the attention feed names the tasks; their requests come from the task.
  const attention = createQuery(() => ({
    queryKey: queryKeys.attention(company().id),
    queryFn: ({ signal }) => projectsApi.attention(company().id, signal),
    staleTime: 30_000,
  }));
  const targets = createMemo(() => waitingTargets(attention.data?.items, props.project.id, new Set(taskById().keys())));
  const requestSources = createQueries(() => ({
    queries: targets().requestTaskIds.flatMap((taskId) => [
      {
        queryKey: queryKeys.issues.section(taskId, "interactions"),
        queryFn: ({ signal }: { signal: AbortSignal }) => interactionsApi.list(taskId, signal),
      },
      {
        queryKey: queryKeys.issues.section(taskId, "approvals"),
        queryFn: ({ signal }: { signal: AbortSignal }) => approvalsApi.forIssue(taskId, signal),
      },
    ]),
  }));
  const waiting = createMemo(() =>
    openRequests(
      targets().requestTaskIds.map((taskId, index) => {
        const task = taskById().get(taskId);
        const interactions = (requestSources[index * 2]?.data ?? []) as Parameters<typeof taskRequests>[0]["interactions"];
        const approvals = (requestSources[index * 2 + 1]?.data ?? []) as Parameters<typeof taskRequests>[0]["approvals"];
        return {
          taskId,
          requests: taskRequests(
            { interactions, approvals },
            {
              youId: people.youId(),
              agentName: (id) => people.agent(id)?.name,
              personName: (id) => people.personName(id),
              task: task ? { id: task.id, identifier: task.identifier, title: task.title } : null,
            },
          ),
        };
      }),
    ),
  );
  const signoffs = createMemo(() => targets().signoffs.filter((entry) => taskById().has(entry.taskId)));
  const [kind, setKind] = createSignal<RequestFilter>("all");
  const filters = createMemo(() => requestFilters(waiting(), signoffs().length));
  const shownRequests = () => waiting().filter((entry) => kind() === "all" || entry.request.kind === kind());
  const shownSignoffs = () => (kind() === "all" || kind() === "signoff" ? signoffs() : []);
  const waitingLoading = () => attention.isPending || requestSources.some((query) => query.isPending);

  const liveTaskIds = createMemo(() => new Set((liveRuns.data ?? []).flatMap((run) => (run.issueId ? [run.issueId] : []))));
  const stuck = createMemo(() =>
    stuckWork({
      tasks: tasks(),
      liveTaskIds: liveTaskIds(),
      exclude: new Set([...targets().requestTaskIds, ...signoffs().map((entry) => entry.taskId)]),
      agentName: (id) => agentById(id)?.name,
      now: new Date(),
    }),
  );

  return (
    <div class="pd">
      <section class="card pd-overview" aria-label="Overview">
        <div class="pd-wells">
          <Brief project={props.project} />
          <Budget project={props.project} />
          <CodeWell project={props.project} settingsHref={`${props.base}/settings`} />
        </div>
        <Crew tasks={tasks()} agents={agents.data} base={props.base} onOpenTask={openTask} />
      </section>

      <section class="pd-waiting" aria-labelledby="pd-waiting-h">
        <div class="pd-waiting-head">
          <h2 id="pd-waiting-h" class="disp">
            Waiting on you
          </h2>
          <Show when={filters()[0]!.count > 0}>
            <Segmented
              label="Request kinds"
              value={kind()}
              options={filters().map((filter) => ({ value: filter.value, label: `${filter.label} ${filter.count}` }))}
              onChange={setKind}
            />
          </Show>
          <A class="pd-link" href={`/${company().issuePrefix}/inbox`}>
            Open in Inbox
          </A>
        </div>
        <Switch>
          <Match when={attention.isError}>
            <p class="card pd-empty">Couldn't load what's waiting on you: {(attention.error as Error).message}</p>
          </Match>
          <Match when={!waitingLoading() && shownRequests().length === 0 && shownSignoffs().length === 0}>
            <p class="card pd-empty">Nothing in this project is waiting on you.</p>
          </Match>
          <Match when={true}>
            <div class="pd-requests">
              <For each={shownRequests()}>
                {(entry) => <RequestCard request={entry.request} taskId={entry.taskId} people={people} />}
              </For>
              <For each={shownSignoffs()}>
                {(entry) => {
                  const task = () => taskById().get(entry.taskId);
                  return (
                    <Show when={task()}>
                      {(found) => (
                        <article class="card pd-signoff" aria-label={`Sign-off for ${found().identifier ?? found().title}`}>
                          <div class="pd-signoff-top">
                            <TonePill tone="green" compact>
                              Sign-off
                            </TonePill>
                            <span class="mono">{found().identifier}</span>
                            <span class="pd-signoff-when">{updatedLabel(entry.since)}</span>
                          </div>
                          <h3 class="disp">{found().title}</h3>
                          <p>{entry.whyNow}</p>
                          <div>
                            <Button size="compact" variant="primary" onClick={() => openTask(found())}>
                              Review
                            </Button>
                          </div>
                        </article>
                      )}
                    </Show>
                  );
                }}
              </For>
              <Show when={waitingLoading()}>
                <p class="cap">Loading requests…</p>
              </Show>
            </div>
          </Match>
        </Switch>
      </section>

      <section class="card pd-stuck" aria-labelledby="pd-stuck-h">
        <div class="pd-section-head">
          <h2 id="pd-stuck-h" class="disp">
            Stuck work
          </h2>
          <span class="cap">Not a request, but waiting on someone</span>
        </div>
        <Show when={props.tasks.data} fallback={<p class="pd-note">Loading tasks…</p>}>
          <ul class="pd-stuck-list">
            <For each={stuck()} fallback={<li class="pd-note">Nothing is stuck. Every open task is moving or waiting on a request.</li>}>
              {(item) => <StuckRow item={item} onOpen={() => openTask(item.task)} />}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  );
}

function Well(props: { id: string; title: string; aside?: JSX.Element; children: JSX.Element }) {
  return (
    <section class="pd-well" aria-labelledby={props.id}>
      <div class="pd-well-head">
        <h2 id={props.id} class="disp">
          {props.title}
        </h2>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

function Brief(props: { project: Project }) {
  return (
    <Well id="pd-brief" title="Brief">
      <Show when={props.project.description?.trim()} fallback={<p class="pd-note">No description yet. Agents read it before every task; add one in Settings.</p>}>
        {(text) => <Markdown source={text()} class="pd-brief" />}
      </Show>
      <Show when={props.project.goals.length > 0}>
        <p class="pd-goals">
          <span class="lbl">{props.project.goals.length === 1 ? "Goal" : "Goals"}</span>
          {props.project.goals.map((goal) => goal.title).join(" · ")}
        </p>
      </Show>
    </Well>
  );
}

function Budget(props: { project: Project }) {
  const company = useCompany();
  const now = new Date();
  const month = monthWindow(now);
  const lifetime = () => props.project.budget?.windowKind === "lifetime";
  const monthCosts = createQuery(() => ({
    queryKey: queryKeys.costs(company().id, month.from),
    queryFn: ({ signal }) => costsApi.byProject(company().id, month.from, undefined, signal),
    staleTime: 60_000,
  }));
  const allCosts = createQuery(() => ({
    queryKey: queryKeys.costs(company().id),
    queryFn: ({ signal }) => costsApi.byProject(company().id, undefined, undefined, signal),
    enabled: lifetime(),
    staleTime: 60_000,
  }));
  const view = createMemo(() =>
    budgetView({
      budget: props.project.budget,
      monthCents: projectSpend(monthCosts.data, props.project.id),
      allTimeCents: projectSpend(allCosts.data, props.project.id),
      now,
    }),
  );
  const loading = () => (lifetime() ? allCosts.isPending : monthCosts.isPending);
  return (
    <Well id="pd-budget" title="Budget" aside={<span class="pd-well-aside">{view().period}</span>}>
      <Switch>
        <Match when={(lifetime() ? allCosts : monthCosts).isError}>
          <p class="pd-note">Couldn't load the spend.</p>
        </Match>
        <Match when={true}>
          <div class="pd-spend">
            <span class="disp pd-amount">{loading() ? "…" : formatCents(view().spentCents)}</span>
            <span class="cap">{view().limitLabel}</span>
          </div>
          <Show when={view().percent !== null}>
            <div
              class="pd-meter"
              classList={{ "pd-meter--warn": view().tone === "warn", "pd-meter--over": view().tone === "over" }}
              role="meter"
              aria-label="Budget used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={view().percent!}
            >
              <span style={{ width: `${view().percent}%` }} />
            </div>
          </Show>
          <Show when={view().pace}>{(pace) => <p class="pd-note">{pace()}</p>}</Show>
          <Show when={view().limitCents === null}>
            <p class="pd-note">Set a monthly budget in Settings to stop work before it overspends.</p>
          </Show>
        </Match>
      </Switch>
    </Well>
  );
}

function CodeWell(props: { project: Project; settingsHref: string }) {
  const company = useCompany();
  const overview = createQuery(() => ({
    queryKey: queryKeys.workspaceOverview(company().id, props.project.id),
    queryFn: ({ signal }) => projectsApi.workspaceOverview(company().id, props.project.id, signal),
    staleTime: 30_000,
  }));
  const view = createMemo(() => codeView(props.project, overview.data?.items));
  const plural = (count: number) => `${count} task checkout${count === 1 ? "" : "s"}`;
  return (
    <Well
      id="pd-code"
      title="Code"
      aside={
        <A class="pd-link pd-well-aside" href={props.settingsHref}>
          Settings
        </A>
      }
    >
      <ul class="pd-code">
        <For each={view().repos}>
          {(repo) => (
            <li>
              <Book size={15} aria-hidden="true" />
              <span class="mono pd-code-name">{repo.name}</span>
              <Show when={repo.branch}>
                <span class="mono pd-chip">{repo.branch}</span>
              </Show>
            </li>
          )}
        </For>
        <Show when={view().folder}>
          {(folder) => (
            <li>
              <FolderOpen size={15} aria-hidden="true" />
              <span class="mono pd-code-name">{folder()}</span>
            </li>
          )}
        </Show>
        <Show when={view().repos.length === 0 && !view().folder}>
          <li class="pd-note">No repository. Agents work in a folder Paperclip manages for the project.</li>
        </Show>
        <Show when={view().checkouts.count > 0}>
          <li>
            <GitBranch size={15} aria-hidden="true" />
            <span>
              <b>{plural(view().checkouts.count)}</b> open
              <Show when={view().checkouts.tasks.length > 0}>: {view().checkouts.tasks.join(", ")}</Show>
            </span>
          </li>
        </Show>
        <For each={view().services}>
          {(service) => (
            <li>
              <Capsule gradient="lagoon" size="tiny" live />
              <b>{service.name}</b>
              <Show when={service.url}>
                {(url) => (
                  <>
                    <span class="mono pd-code-name">{url().replace(/^https?:\/\//, "")}</span>
                    <a class="pd-link pd-push" href={url()} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </>
                )}
              </Show>
            </li>
          )}
        </For>
      </ul>
    </Well>
  );
}

function Crew(props: {
  tasks: ProjectTask[];
  agents: Agent[] | undefined;
  base: string;
  onOpenTask: (task: ProjectTask) => void;
}) {
  const company = useCompany();
  const commands = useCommands();
  const liveRuns = useLiveRunsQuery();
  const members = createMemo(() => crew({ tasks: props.tasks, liveRuns: liveRuns.data, agents: props.agents }));
  const agent = (id: string) => props.agents?.find((candidate) => candidate.id === id);
  return (
    <section class="pd-crew" aria-labelledby="pd-crew-h">
      <div class="pd-section-head">
        <h2 id="pd-crew-h" class="disp">
          Agents at work
        </h2>
        <Show when={members().length > 0}>
          <span class="cap">{crewSummary(members())}</span>
        </Show>
        <A class="pd-link pd-push" href={`${props.base}/workload`}>
          Agent workload
        </A>
      </div>
      <Show when={members().length > 0} fallback={<p class="pd-note">No agent has work in this project right now.</p>}>
        <div class="pd-crew-grid">
          <For each={members()}>
            {(member) => {
              const found = () => agent(member.agentId);
              const name = () => found()?.name ?? "Agent";
              return (
                <div class="pd-crew-col">
                  <A class="pd-crew-top" href={`/${company().issuePrefix}/agents/${found()?.urlKey ?? member.agentId}`}>
                    <span class={`pd-crew-av pd-crew-av--${member.state}`}>
                      <AgentAvatar agent={found() ?? { id: member.agentId, name: name() }} size={96} pose={POSE[member.state]} ring={false} label={name()} />
                    </span>
                    <span class="pd-crew-name">
                      <b>{name()}</b>
                      <CrewPill state={member.state} />
                    </span>
                    <span class="pd-crew-task">{member.task ? `${member.task.identifier ?? ""} · ${member.task.title}` : "No active task"}</span>
                  </A>
                  <div class="pd-crew-pop" role="group" aria-label={`${name()}: ${member.openCount} open`}>
                    <h4>
                      {name()} · {member.openCount} open
                    </h4>
                    <Show when={member.task}>
                      {(task) => (
                        <div class="pd-crew-now" data-state={member.state}>
                          <div class="pd-crew-now-head">
                            <span>{member.state === "running" ? "Working now" : member.state === "queued" ? "Queued" : member.state === "blocked" ? "Blocked" : "Next up"}</span>
                            <Show when={member.runId}>
                              {(runId) => (
                                <button type="button" class={`${buttonClass({ size: "compact" })} pd-push`} onClick={() => commands.openRunModal(runId())}>
                                  Watch
                                </button>
                              )}
                            </Show>
                          </div>
                          <button type="button" class="pd-crew-task-link" onClick={() => props.onOpenTask(task())}>
                            {task().identifier} · {task().title}
                          </button>
                        </div>
                      )}
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </section>
  );
}

function CrewPill(props: { state: CrewMember["state"] }) {
  return (
    <Switch fallback={<TonePill tone="cyan" compact icon={<Capsule gradient="ash" size="tiny" />}>Idle</TonePill>}>
      <Match when={props.state === "running"}>
        <RunningPill compact />
      </Match>
      <Match when={props.state === "queued"}>
        <TonePill tone="run" compact icon={<Capsule gradient="ion" size="tiny" />}>
          Queued
        </TonePill>
      </Match>
      <Match when={props.state === "blocked"}>
        <TonePill tone="red" compact icon={<Capsule gradient="flare" size="tiny" />}>
          Blocked
        </TonePill>
      </Match>
      <Match when={props.state === "error"}>
        <TonePill tone="red" compact icon={<Capsule gradient="flare" size="tiny" />}>
          Error
        </TonePill>
      </Match>
      <Match when={props.state === "paused"}>
        <TonePill tone="amber" compact icon={<Capsule gradient="ember" size="tiny" />}>
          Paused
        </TonePill>
      </Match>
    </Switch>
  );
}

function StuckRow(props: { item: StuckItem; onOpen: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const people = useTaskPeople();
  const assign = async (pick: { agentId: string | null; userId: string | null }) => {
    try {
      await issuesApi.update(props.item.task.id, { assigneeAgentId: pick.agentId, assigneeUserId: pick.userId });
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't assign the task", body: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <li class="pd-stuck-row">
      <StatusCapsule status={props.item.task.status} size="row" />
      <div class="pd-stuck-text">
        <div class="pd-stuck-title">
          <span class="mono">{props.item.task.identifier}</span>
          <button type="button" onClick={() => props.onOpen()}>
            {props.item.task.title}
          </button>
        </div>
        <div class="cap">{props.item.detail}</div>
      </div>
      <Show
        when={props.item.action === "assign"}
        fallback={
          <Button size="compact" onClick={() => props.onOpen()}>
            Open
          </Button>
        }
      >
        <Menu placement="bottom-end">
          <Menu.Trigger class={buttonClass({ size: "compact" })}>Assign</Menu.Trigger>
          <Menu.Content label={`Assign ${props.item.task.identifier ?? "the task"}`} width={260}>
            <AssigneeItems people={people} current="none" onPick={(pick) => void assign(pick)} />
          </Menu.Content>
        </Menu>
      </Show>
    </li>
  );
}

