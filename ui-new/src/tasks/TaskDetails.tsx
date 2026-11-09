import type { CompactIssue, Issue, IssueDisplayStatus, IssueRelationIssueSummary } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import {
  Box,
  Brain,
  Calendar,
  ChevronDown,
  CircleDot,
  Clock,
  CornerDownRight,
  Eye,
  FileText,
  Flag,
  FolderGit2,
  Gauge,
  GitFork,
  GitPullRequest,
  Hash,
  ListTree,
  Plus,
  Layers3,
  Send,
  RotateCcw,
  ShieldCheck,
  Tag,
  Target,
  UserRound,
  X,
} from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch, type JSX } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useNow } from "@/lib/clock";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery, useLiveRunsQuery } from "@/lib/company-data";
import { Capsule, RunningPill } from "@/ui/Status";
import { STATUS_META, statusLook, type StatusSource } from "@/ui/status-meta";
import { Assignee, useTaskPeople } from "./people";
import { stageKeys } from "./review-stages";
import { blockerIds, blockersEdit, workspacePickerAvailable } from "./task-edits";
import {
  AddBlocker,
  AssigneeControl,
  BillingControl,
  DescriptionEditor,
  GoalControl,
  LabelsControl,
  ParentControl,
  PriorityControl,
  ProjectControl,
  ReviewControl,
  StatusControl,
  TitleEditor,
  useTaskChange,
  WorkspaceControl,
} from "./TaskEditors";
import { MonitorControl, ScheduledRetryControl, WatchdogControl } from "./TaskExecution";
import { hasOrigin, OriginValue, RequesterValue, ReviewPolicyBadge } from "./TaskAbout";
import { requester } from "./task-origin";
import { PlanDecompositions } from "./PlanDecompositions";
import { ExternalObjects } from "./ExternalObjects";
import { UsageLimitValue, useUsageLimit } from "./UsageLimit";
import { ContextUsageValue, useTaskContext } from "./TaskContext";
import "./TaskDetails.css";

/*
 * The task panel's Details section (board 2): kind and run, title, properties, description with
 * the task's documents and work products, subtasks and dependencies. TaskSections puts it beside
 * the rail with the other sections.
 *
 * Everything is edited in place (TaskEditors.tsx): the title and description, each property through
 * the same menus as the task list, the review stages, blockers and subtasks. Fields with no value
 * fold under "Show N empty fields", as on the board.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === new Date().getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}

/** "45s", "4m", "1h 5m": how long a run has been going. */
function elapsed(since: string | Date | null, now: number) {
  if (!since) return "";
  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * A status in its tone. Pass what the task shows (`shownStatus`), so Monitoring reads as Monitoring;
 * for a task, `TaskStatusChip` adds the in-queue look and what a blocked task waits on.
 */
export function StatusChip(props: { status: IssueDisplayStatus; queued?: boolean; title?: string; small?: boolean }) {
  const meta = () => STATUS_META[props.status] ?? STATUS_META.backlog;
  return (
    <span
      class="td-status"
      classList={{ "td-status--small": props.small }}
      data-tone={props.queued ? "run" : meta().tone}
      data-hollow={meta().hollow ? "" : undefined}
      title={props.title && props.title !== meta().label ? props.title : undefined}
    >
      {meta().label}
    </span>
  );
}

/** A task's status chip, through `statusLook`. */
export function TaskStatusChip(props: { task: StatusSource; small?: boolean }) {
  const look = () => statusLook(props.task);
  return <StatusChip status={look().status} queued={look().queued} title={look().title} small={props.small} />;
}

/**
 * One property row. `empty` folds it under "Show N empty fields" until it has a value; `absent`
 * leaves it out altogether, for a row that only exists while there's something to say (Usage limit).
 */
type Property = { key: string; icon: JSX.Element; label: string; empty: (task: Issue) => boolean; absent?: () => boolean; value: () => JSX.Element };

export function TaskDetails(props: {
  taskId: string;
  initial?: Issue;
  /** The page header already shows the title (the full page). */
  hideTitle?: boolean;
  /** Opens another task (a subtask, parent or blocker) in the same place. */
  onOpenTask: (task: { id: string; identifier: string | null }) => void;
}) {
  const company = useCompany();
  const commands = useCommands();
  const people = useTaskPeople();
  const liveRuns = useLiveRunsQuery();
  const settings = useExperimentalSettingsQuery();
  const [showEmpty, setShowEmpty] = createSignal(false);

  const query = createQuery(() => ({
    queryKey: queryKeys.issues.detail(props.taskId),
    queryFn: ({ signal }) => issuesApi.get(props.taskId, signal),
    initialData: props.initial,
  }));
  const subtasks = createQuery(() => ({
    queryKey: queryKeys.issues.view(company().id, { parentId: props.taskId }),
    queryFn: ({ signal }) => issuesApi.list(company().id, { parentId: props.taskId }, signal),
  }));

  const task = () => query.data;
  const change = useTaskChange(task);
  const run = createMemo(() => (liveRuns.data ?? []).find((candidate) => candidate.issueId === props.taskId));
  const now = useNow(() => !!run());
  const kids = () => subtasks.data ?? [];
  const kidsDone = () => kids().filter((kid) => kid.status === "done").length;
  // A subtask another subtask's agent asked for lands here, beside its requester (agents' trees stop
  // at parent → child since the 2026-11-07 sync, upstream #19312); its recorded origin names that
  // subtask. The list's rows carry `originIssueId`, though `CompactIssue` doesn't name it.
  const kidOrigin = (kid: CompactIssue) => {
    const origin = (kid as CompactIssue & { originIssueId?: string | null }).originIssueId;
    if (!origin || origin === props.taskId) return null;
    return kids().find((other) => other.id === origin)?.identifier ?? null;
  };
  // The assignee's provider usage limit (U40), while it has a current window to show.
  const usage = useUsageLimit(() => task()?.assigneeAgentId);
  // The assignee session's context window (U58), once a harness has reported one.
  const context = useTaskContext(() => props.taskId, () => task()?.assigneeAgentId, () => task()?.status);
  const usageHref = () => {
    const agent = people.agent(task()?.assigneeAgentId);
    return agent ? `/${company().issuePrefix}/agents/${agent.urlKey ?? agent.id}/runtime` : undefined;
  };

  // The rows are made once and read the task reactively, so an open menu (labels, the stage editor)
  // stays open while the change it made comes back.
  const t = () => task()!;
  const dates = () =>
    [
      `Created ${shortDate(t().createdAt)}`,
      t().startedAt ? `Started ${shortDate(t().startedAt)}` : null,
      t().completedAt ? `Done ${shortDate(t().completedAt)}` : null,
      t().cancelledAt ? `Cancelled ${shortDate(t().cancelledAt)}` : null,
    ]
      .filter((part): part is string => part !== null)
      .join("  →  ");
  const hasStages = (current: Issue) =>
    stageKeys(current.executionPolicy, "review").length + stageKeys(current.executionPolicy, "approval").length > 0 ||
    !!current.executionState?.currentStageType;
  const workspaceEditable = (current: Issue) => workspacePickerAvailable(current.project, settings.data?.enableIsolatedWorkspaces === true);
  const properties: Property[] = [
    { key: "status", icon: <CircleDot size={15} />, label: "Status", empty: () => false, value: () => <StatusControl status={t().status} look={statusLook(t())} onChange={change} /> },
    { key: "assignee", icon: <UserRound size={15} />, label: "Assignee", empty: () => false, value: () => <AssigneeControl task={t()} people={people} onChange={change} /> },
    {
      key: "usage",
      icon: <Gauge size={15} />,
      label: "Usage limit",
      empty: () => false,
      absent: () => !usage(),
      value: () => <Show when={usage()}>{(limit) => <UsageLimitValue limit={limit()} href={usageHref()} />}</Show>,
    },
    { key: "context", icon: <Brain size={15} />, label: "Context", empty: () => false, absent: () => !context.visible(), value: () => <ContextUsageValue context={context} /> },
    {
      key: "review",
      icon: <Eye size={15} />,
      label: "Review",
      empty: (current) => !hasStages(current) && !current.reviewPolicy,
      value: () => (
        <span class="td-inline td-wrap">
          <ReviewControl task={t()} people={people} onChange={change} />
          <ReviewPolicyBadge task={t()} />
        </span>
      ),
    },
    { key: "priority", icon: <Flag size={15} />, label: "Priority", empty: () => false, value: () => <PriorityControl priority={t().priority} onChange={change} /> },
    { key: "project", icon: <Box size={15} />, label: "Project", empty: (current) => !current.projectId, value: () => <ProjectControl task={t()} onChange={change} /> },
    {
      key: "parent",
      icon: <CornerDownRight size={15} />,
      label: "Parent",
      empty: (current) => !current.parentId,
      value: () => <ParentControl task={t()} onOpenTask={props.onOpenTask} onChange={change} />,
    },
    {
      key: "origin",
      icon: <GitFork size={15} />,
      label: "From",
      empty: (current) => !hasOrigin(current),
      value: () => <OriginValue task={t()} onOpenTask={props.onOpenTask} />,
    },
    { key: "goal", icon: <Target size={15} />, label: "Goal", empty: (current) => !current.goalId, value: () => <GoalControl task={t()} onChange={change} /> },
    { key: "labels", icon: <Tag size={15} />, label: "Labels", empty: (current) => !(current.labels?.length ?? 0), value: () => <LabelsControl task={t()} onChange={change} /> },
    { key: "dates", icon: <Calendar size={15} />, label: "Dates", empty: () => false, value: () => <span class="td-dates">{dates()}</span> },
    {
      key: "workspace",
      icon: <FolderGit2 size={15} />,
      label: "Workspace",
      empty: (current) => !current.currentExecutionWorkspace && !workspaceEditable(current),
      value: () => <WorkspaceControl task={t()} onChange={change} />,
    },
    {
      key: "watchdog",
      icon: <ShieldCheck size={15} />,
      label: "Watchdog",
      empty: (current) => !current.watchdog,
      value: () => <WatchdogControl task={t()} people={people} onOpenTask={props.onOpenTask} />,
    },
    {
      key: "monitor",
      icon: <Clock size={15} />,
      label: "Monitor",
      empty: (current) => !current.executionPolicy?.monitor && !current.executionState?.monitor?.nextCheckAt && !current.monitorNextCheckAt,
      value: () => <MonitorControl task={t()} onChange={change} />,
    },
    {
      key: "retry",
      icon: <RotateCcw size={15} />,
      label: "Scheduled retry",
      empty: (current) => current.scheduledRetry?.status !== "scheduled_retry",
      value: () => <ScheduledRetryControl task={t()} />,
    },
    { key: "billing", icon: <Hash size={15} />, label: "Billing code", empty: (current) => !current.billingCode, value: () => <BillingControl task={t()} onChange={change} /> },
    { key: "requester", icon: <Send size={15} />, label: "Requested by", empty: (current) => !requester(current), value: () => <RequesterValue task={t()} people={people} /> },
    {
      key: "depth",
      icon: <Layers3 size={15} />,
      label: "Depth",
      empty: (current) => !(current.requestDepth > 0),
      value: () => (
        <Show when={t().requestDepth > 0} fallback={<span class="td-muted">The first request</span>}>
          <span class="td-inline" title="How many delegations deep this task is: a request made by another agent's request, and so on.">
            <span class="mono">{t().requestDepth}</span>
            <span class="td-muted">delegation{t().requestDepth === 1 ? "" : "s"} from the first request</span>
          </span>
        </Show>
      ),
    },
  ];
  // A row that has had a value stays put until another task opens, so clearing it (the last label,
  // say) doesn't whisk the row and its open menu away.
  const [pinned, setPinned] = createSignal<ReadonlySet<string>>(new Set());
  createEffect(on(() => props.taskId, () => setPinned(new Set<string>())));
  createEffect(() => {
    const current = task();
    if (!current) return;
    const keys = properties.filter((property) => !property.empty(current) && !pinned().has(property.key)).map((property) => property.key);
    if (keys.length > 0) setPinned((before) => new Set([...before, ...keys]));
  });
  const isEmpty = (property: Property) => {
    const current = task();
    return !!current && property.empty(current) && !pinned().has(property.key);
  };
  const present = () => properties.filter((property) => !property.absent?.());
  const shown = createMemo(() => (task() ? present().filter((property) => showEmpty() || !isEmpty(property)) : []));
  const empty = createMemo(() => (task() ? present().filter(isEmpty) : []));

  return (
    <div class="td-main">
      <Switch>
        <Match when={query.isError && !task()}>
          <p class="td-muted">This task couldn't be loaded: {(query.error as Error).message}</p>
        </Match>
        <Match when={!task()}>
          <p class="td-muted">Loading…</p>
        </Match>
        <Match when={task()}>
          {(current) => (
            <>
              <div class="td-top">
                <span class="td-kind">
                  <Capsule gradient="ash" size="tiny" />
                  Task
                </span>
                <Show when={run()}>
                  {(live) => (
                    <button type="button" class="td-run" onClick={() => commands.openRunModal(live().id)}>
                      <RunningPill compact label={`Running · ${elapsed(live().startedAt ?? live().createdAt, now())}`} />
                    </button>
                  )}
                </Show>
                <Show when={kids().length > 0}>
                  <span class="td-muted">
                    {kidsDone()} of {kids().length} subtasks done
                  </span>
                </Show>
              </div>

              <Show when={!props.hideTitle}>
                <h1 class="disp td-title">
                  <TitleEditor title={current().title} onChange={change} />
                </h1>
              </Show>

              <dl class="td-props">
                <For each={shown()}>
                  {(property) => (
                    <>
                      <dt>
                        <span aria-hidden="true">{property.icon}</span>
                        {property.label}
                      </dt>
                      <dd>{property.value()}</dd>
                    </>
                  )}
                </For>
              </dl>
              <Show when={empty().length > 0}>
                <button type="button" class="td-more" aria-expanded={showEmpty()} onClick={() => setShowEmpty(!showEmpty())}>
                  <ChevronDown size={14} aria-hidden="true" classList={{ "td-more-open": showEmpty() }} />
                  {showEmpty()
                    ? "Hide empty fields"
                    : `Show ${empty().length} empty field${empty().length === 1 ? "" : "s"}: ${empty()
                        .map((property) => property.label.toLowerCase())
                        .join(", ")}`}
                </button>
              </Show>

              <section class="td-section td-description" aria-label="Description">
                <DescriptionEditor task={current()} onChange={change} />
                <Show when={(current().documentSummaries?.length ?? 0) + (current().workProducts?.length ?? 0) > 0}>
                  <div class="td-chips">
                    <For each={current().documentSummaries ?? []}>
                      {(doc) => (
                        <span class="td-chip">
                          <FileText size={14} aria-hidden="true" />
                          {doc.title ?? doc.key}
                          <Show when={doc.latestRevisionNumber > 1}>
                            <span class="td-muted">· rev {doc.latestRevisionNumber}</span>
                          </Show>
                        </span>
                      )}
                    </For>
                    <For each={current().workProducts ?? []}>
                      {(product) => (
                        <Show
                          when={product.url}
                          fallback={
                            <span class="td-chip">
                              <GitPullRequest size={14} aria-hidden="true" />
                              {product.title}
                            </span>
                          }
                        >
                          {(url) => (
                            <a class="td-chip" href={url()} target="_blank" rel="noopener noreferrer">
                              <GitPullRequest size={14} aria-hidden="true" />
                              {product.title}
                              <span class="td-muted">· {String(product.status).replace(/_/g, " ")}</span>
                            </a>
                          )}
                        </Show>
                      )}
                    </For>
                  </div>
                </Show>
              </section>

              <section class="td-section" aria-labelledby={`td-subtasks-${props.taskId}`}>
                <div class="td-section-head">
                  <ListTree size={16} aria-hidden="true" />
                  <h2 class="disp" id={`td-subtasks-${props.taskId}`}>
                    Subtasks
                  </h2>
                  <Show when={kids().length > 0}>
                    <span class="td-muted">
                      {kidsDone()} of {kids().length}
                    </span>
                    <span class="td-progress" aria-hidden="true">
                      <span style={{ width: `${(kidsDone() / kids().length) * 100}%` }} />
                    </span>
                  </Show>
                </div>
                <div class="card td-table">
                  <Show when={kids().length > 0}>
                    <div class="td-table-cols" role="presentation">
                      <span>Name</span>
                      <span>Assignee</span>
                      <span>Status</span>
                    </div>
                  </Show>
                  <For each={kids()}>
                    {(kid: CompactIssue) => (
                      <div class="td-table-row">
                        <button type="button" class="td-link td-ellipsis" onClick={() => props.onOpenTask(kid)}>
                          <span class="mono td-id">{kid.identifier}</span>
                          {kid.title}
                          <Show when={kidOrigin(kid)}>{(from) => <span class="td-muted"> · from {from()}</span>}</Show>
                        </button>
                        <Assignee task={kid} people={people} size={20} />
                        <TaskStatusChip task={kid} small />
                      </div>
                    )}
                  </For>
                  <button
                    type="button"
                    class="td-table-add"
                    onClick={() => commands.openNewTask({ parentId: props.taskId, projectId: current().projectId })}
                  >
                    <Plus size={14} aria-hidden="true" />
                    Add subtask
                  </button>
                </div>
              </section>

              <PlanDecompositions taskId={props.taskId} people={people} onOpenTask={props.onOpenTask} />
              <ExternalObjects taskId={props.taskId} />

              <section class="td-section" aria-labelledby={`td-deps-${props.taskId}`}>
                <h2 class="disp td-section-title" id={`td-deps-${props.taskId}`}>
                  Dependencies
                </h2>
                <Show when={(current().blockedBy?.length ?? 0) + (current().blocks?.length ?? 0) === 0}>
                  <p class="td-muted">Nothing blocks this task, and it blocks nothing.</p>
                </Show>
                <For each={current().blockedBy ?? []}>
                  {(blocker) => (
                    <Relation
                      kind="blocked-by"
                      relation={blocker}
                      people={people}
                      onOpen={props.onOpenTask}
                      onRemove={() => change(blockersEdit(current(), blocker.id, false))}
                    />
                  )}
                </For>
                <For each={current().blocks ?? []}>
                  {(blocked) => <Relation kind="blocking" relation={blocked} people={people} onOpen={props.onOpenTask} />}
                </For>
                <AddBlocker task={current()} selected={blockerIds(current())} onPick={(id) => change(blockersEdit(current(), id, true))} />
              </section>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
}

function Relation(props: {
  kind: "blocked-by" | "blocking";
  relation: IssueRelationIssueSummary;
  people: ReturnType<typeof useTaskPeople>;
  onOpen: (task: { id: string; identifier: string | null }) => void;
  onRemove?: () => void;
}) {
  const waiter = () => {
    const agent = props.people.agent(props.relation.assigneeAgentId);
    if (agent) return agent.name;
    const userId = props.relation.assigneeUserId;
    if (!userId) return null;
    return userId === props.people.youId() ? "You" : props.people.personName(userId);
  };
  return (
    <div class="td-relation" data-kind={props.kind}>
      <span class="td-relation-kind">{props.kind === "blocked-by" ? "Blocked by" : "Blocking"}</span>
      <button type="button" class="td-link td-ellipsis" onClick={() => props.onOpen(props.relation)}>
        <span class="mono td-id">{props.relation.identifier}</span>
        {props.relation.title}
      </button>
      <span class="td-relation-note">
        <Show when={props.kind === "blocking"} fallback={<TaskStatusChip task={props.relation} small />}>
          <Show when={waiter()}>{(name) => <>{name()} {name() === "You" ? "wait" : "waits"} on this</>}</Show>
        </Show>
      </span>
      <Show when={props.onRemove}>
        <button
          type="button"
          class="td-relation-remove"
          aria-label={`Stop ${props.relation.identifier ?? props.relation.title} blocking this task`}
          title="Remove this blocker"
          onClick={() => props.onRemove?.()}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </Show>
    </div>
  );
}
