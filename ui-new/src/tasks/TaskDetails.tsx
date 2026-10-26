import type { CompactIssue, Issue, IssuePriority, IssueRelationIssueSummary, IssueStatus } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import {
  Box,
  Calendar,
  ChevronDown,
  CircleDot,
  CornerDownRight,
  FileText,
  Flag,
  FolderGit2,
  GitPullRequest,
  Hash,
  ListTree,
  Plus,
  Tag,
  Target,
  UserRound,
} from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useLiveRunsQuery } from "@/lib/company-data";
import { InitialsDisc } from "@/ui/Avatar";
import { Markdown } from "@/ui/Markdown";
import { Capsule, LabelPill, PriorityBars, RunningPill } from "@/ui/Status";
import { STATUS_META } from "@/ui/status-meta";
import { Assignee, useTaskPeople } from "./people";
import "./TaskDetails.css";

/*
 * The task panel's Details section (board 2): kind and run, title, properties, description with
 * the task's documents and work products, subtasks and dependencies. TaskSections puts it beside
 * the rail with the other sections.
 *
 * Read-only for now: the inline edits come with the list's interactions.
 */

const STATUS_TONE: Record<IssueStatus, string> = {
  in_progress: "run",
  in_review: "violet",
  todo: "amber",
  blocked: "red",
  backlog: "neutral",
  done: "green",
  cancelled: "neutral",
};

const WORKSPACE_MODES: Record<string, string> = {
  shared_workspace: "shared workspace",
  isolated_workspace: "isolated worktree",
  operator_branch: "operator branch",
  adapter_managed: "managed by the adapter",
  cloud_sandbox: "cloud sandbox",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === new Date().getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}

function elapsed(since: string | null) {
  if (!since) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The model and effort a task overrides for its agent, as "Opus 5.5, high effort". */
function overrideSummary(task: Issue) {
  const config = task.assigneeAdapterOverrides?.adapterConfig;
  if (!config) return null;
  const model = typeof config.model === "string" ? config.model : null;
  const effortValue = config.effort ?? config.reasoningEffort ?? config.modelReasoningEffort ?? config.thinking;
  const effort = typeof effortValue === "string" ? `${effortValue} effort` : null;
  return [model, effort].filter(Boolean).join(", ") || null;
}

export function StatusChip(props: { status: IssueStatus; small?: boolean }) {
  return (
    <span class="td-status" classList={{ "td-status--small": props.small }} data-tone={STATUS_TONE[props.status]}>
      {STATUS_META[props.status].label}
    </span>
  );
}

type Property = { key: string; icon: JSX.Element; label: string; value: JSX.Element | null };

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
  const run = createMemo(() => (liveRuns.data ?? []).find((candidate) => candidate.issueId === props.taskId));
  const kids = () => subtasks.data ?? [];
  const kidsDone = () => kids().filter((kid) => kid.status === "done").length;
  const parent = () => {
    const current = task();
    if (!current?.parentId) return undefined;
    return current.ancestors?.find((ancestor) => ancestor.id === current.parentId);
  };

  const properties = createMemo<Property[]>(() => {
    const current = task();
    if (!current) return [];
    const overrides = overrideSummary(current);
    const workspace = current.currentExecutionWorkspace;
    const dates = [
      `Created ${shortDate(current.createdAt)}`,
      current.startedAt ? `Started ${shortDate(current.startedAt)}` : null,
      current.completedAt ? `Done ${shortDate(current.completedAt)}` : null,
      current.cancelledAt ? `Cancelled ${shortDate(current.cancelledAt)}` : null,
    ].filter((part): part is string => part !== null);
    return [
      { key: "status", icon: <CircleDot size={15} />, label: "Status", value: <StatusChip status={current.status as IssueStatus} /> },
      {
        key: "assignee",
        icon: <UserRound size={15} />,
        label: "Assignee",
        value: (
          <span class="td-assignee">
            <Assignee task={current} people={people} size={20} />
            <Show when={overrides}>
              <span class="td-muted">· {overrides}</span>
            </Show>
          </span>
        ),
      },
      { key: "priority", icon: <Flag size={15} />, label: "Priority", value: <PriorityBars priority={current.priority as IssuePriority} withLabel /> },
      {
        key: "project",
        icon: <Box size={15} />,
        label: "Project",
        value: current.project ? (
          <span class="td-inline">
            <InitialsDisc name={current.project.name.slice(0, 1)} seed={current.project.id} size={18} />
            {current.project.name}
          </span>
        ) : null,
      },
      {
        key: "parent",
        icon: <CornerDownRight size={15} />,
        label: "Parent",
        value: parent() ? (
          <button type="button" class="td-link" onClick={() => props.onOpenTask(parent()!)}>
            <span class="mono td-id">{parent()!.identifier}</span>
            {parent()!.title}
          </button>
        ) : null,
      },
      { key: "goal", icon: <Target size={15} />, label: "Goal", value: current.goal ? <span>{current.goal.title}</span> : null },
      {
        key: "labels",
        icon: <Tag size={15} />,
        label: "Labels",
        value: current.labels?.length ? (
          <span class="td-inline td-wrap">
            <For each={current.labels}>{(label) => <LabelPill name={label.name} color={label.color} />}</For>
          </span>
        ) : null,
      },
      { key: "dates", icon: <Calendar size={15} />, label: "Dates", value: <span class="td-dates">{dates.join("  →  ")}</span> },
      {
        key: "workspace",
        icon: <FolderGit2 size={15} />,
        label: "Workspace",
        value: workspace ? (
          <span class="td-inline">
            <span class="mono td-ellipsis">{workspace.branchName ?? workspace.name}</span>
            <span class="td-muted">{WORKSPACE_MODES[workspace.mode] ?? workspace.mode.replace(/_/g, " ")}</span>
          </span>
        ) : null,
      },
      { key: "billing", icon: <Hash size={15} />, label: "Billing code", value: current.billingCode ? <span class="mono">{current.billingCode}</span> : null },
    ];
  });
  const filled = () => properties().filter((property) => property.value !== null);
  const empty = () => properties().filter((property) => property.value === null);

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
                <Show when={run()}>{(live) => <RunningPill compact label={`Running · ${elapsed(live().startedAt ?? live().createdAt)}`} />}</Show>
                <Show when={kids().length > 0}>
                  <span class="td-muted">
                    {kidsDone()} of {kids().length} subtasks done
                  </span>
                </Show>
              </div>

              <Show when={!props.hideTitle}>
                <h1 class="disp td-title">{current().title}</h1>
              </Show>

              <dl class="td-props">
                <For each={showEmpty() ? properties() : filled()}>
                  {(property) => (
                    <>
                      <dt>
                        <span aria-hidden="true">{property.icon}</span>
                        {property.label}
                      </dt>
                      <dd>{property.value ?? <span class="td-muted">None</span>}</dd>
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
                <Show when={current().description?.trim()} fallback={<p class="td-muted">No description.</p>}>
                  {(text) => <Markdown source={text()} />}
                </Show>
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
                        </button>
                        <Assignee task={kid} people={people} size={20} />
                        <StatusChip status={kid.status as IssueStatus} small />
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

              <section class="td-section" aria-labelledby={`td-deps-${props.taskId}`}>
                <h2 class="disp td-section-title" id={`td-deps-${props.taskId}`}>
                  Dependencies
                </h2>
                <Show
                  when={(current().blockedBy?.length ?? 0) + (current().blocks?.length ?? 0) > 0}
                  fallback={<p class="td-muted">Nothing blocks this task, and it blocks nothing.</p>}
                >
                  <For each={current().blockedBy ?? []}>
                    {(blocker) => <Relation kind="blocked-by" relation={blocker} people={people} onOpen={props.onOpenTask} />}
                  </For>
                  <For each={current().blocks ?? []}>
                    {(blocked) => <Relation kind="blocking" relation={blocked} people={people} onOpen={props.onOpenTask} />}
                  </For>
                </Show>
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
        <Show when={props.kind === "blocking"} fallback={<StatusChip status={props.relation.status} small />}>
          <Show when={waiter()}>{(name) => <>{name()} {name() === "You" ? "wait" : "waits"} on this</>}</Show>
        </Show>
      </span>
    </div>
  );
}
