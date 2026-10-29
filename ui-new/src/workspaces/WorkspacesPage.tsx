import type { ExecutionWorkspaceStatus, WorkspaceOverviewItem, WorkspaceOverviewResponse } from "@paperclipai/shared";
import { A, useSearchParams } from "@solidjs/router";
import { createInfiniteQuery, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Copy, ExternalLink, FolderOpen, GitBranch, LoaderCircle, Play, Square } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { ApiError } from "@/api/client";
import { executionWorkspacesApi } from "@/api/execution-workspaces";
import { queryKeys } from "@/api/queryKeys";
import { workspacesApi } from "@/api/workspaces";
import { isCompact } from "@/layout/breakpoints";
import { useCommands } from "@/lib/commands";
import { useCompany } from "@/lib/company";
import { useExperimentalSettingsQuery } from "@/lib/company-data";
import { OrgHeader } from "@/org/OrgHeader";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { Capsule } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { stampLabel } from "@/tasks/thread-model";
import { CloseWorkspaceDialog } from "./CloseWorkspaceDialog";
import { cardActions, groupWorkspaces, MODES, shortPath, STATUS, type WorkspaceGroup } from "./workspaces-model";
import "./Workspaces.css";

/*
 * `/:companyPrefix/workspaces`, the organization's Workspaces tab (`workspaces/overview`; decided
 * Oct 28, 2026), drawn with the org header like Workload, Skills and Activity. It keeps the old
 * UI's address.
 *
 * Every workspace grouped by project, projects with running services first (workspaces-model.ts).
 * Each card: the workspace's status and kind, its branch and folder (copyable), its services with
 * the main one's address, and the tasks using it. Start or stop its services; close it, with the
 * server's close check first (CloseWorkspaceDialog). "Closed" lists closed workspaces: one reopens
 * from its task, when the task gets a new message or is resumed.
 *
 * The old page shows only when isolated workspaces are switched on; the overview itself isn't
 * gated by the server, so here the tab is always there (no switches).
 */

type View = "open" | "closed";

const VIEWS: { value: View; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
];

const CLOSED: ExecutionWorkspaceStatus[] = ["archived"];

export function WorkspacesPage() {
  const company = useCompany();
  const commands = useCommands();
  const client = useQueryClient();
  const experimental = useExperimentalSettingsQuery();
  const hidePaths = () => experimental.data === undefined || experimental.data.enableManagedSandboxOnly === true;
  const [view, setView] = createSignal<View>("open");
  const [closing, setClosing] = createSignal<{ id: string; name: string; status: ExecutionWorkspaceStatus } | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);

  const overview = createInfiniteQuery(() => ({
    queryKey: queryKeys.workspaces.overview(company().id, view()),
    queryFn: ({ pageParam, signal }) => workspacesApi.overview(company().id, { offset: pageParam, status: view() === "closed" ? CLOSED : undefined }, signal),
    initialPageParam: 0,
    getNextPageParam: (last: WorkspaceOverviewResponse) => last.nextOffset ?? undefined,
  }));
  const items = createMemo(() => overview.data?.pages.flatMap((page) => page.items) ?? []);
  const total = () => overview.data?.pages[0]?.total ?? items().length;
  const groups = createMemo(() => groupWorkspaces(items()));

  // `?workspace=<id>`, where old `/execution-workspaces/:id` links land (routes/legacy-model.ts):
  // the page has no detail view, so it shows that workspace's card, switching to Closed when it's
  // closed and loading more pages until the card is there.
  const [params, setParams] = useSearchParams<{ workspace?: string }>();
  const focusId = () => params.workspace || null;
  const focused = createQuery(() => ({
    queryKey: ["execution-workspace", focusId() ?? "", "detail"] as const,
    queryFn: ({ signal }) => executionWorkspacesApi.get(focusId()!, signal),
    enabled: focusId() !== null,
    retry: false,
  }));
  createEffect(
    on(
      () => focused.data,
      (workspace) => {
        if (workspace && workspace.id === focusId()) setView(CLOSED.includes(workspace.status) ? "closed" : "open");
      },
    ),
  );
  const listed = () => {
    const id = focusId();
    return id !== null && items().some((item) => item.executionWorkspaceId === id);
  };
  createEffect(() => {
    if (focusId() === null || !focused.data || listed() || !overview.hasNextPage || overview.isFetchingNextPage) return;
    void overview.fetchNextPage();
  });
  const focusNote = (): string | null => {
    if (focusId() === null || listed()) return null;
    if (focused.isError) {
      const missing = focused.error instanceof ApiError && focused.error.status === 404;
      return missing ? "The workspace from that link wasn't found. It may have been removed." : `The workspace from that link couldn't be loaded: ${(focused.error as Error).message}`;
    }
    if (!focused.data || overview.isPending || overview.hasNextPage) return null;
    return `${focused.data.name} isn't in this list.`;
  };

  const openTask = (task: { id: string; identifier: string | null; title: string }, projectId: string | null) =>
    commands.openTaskModal({ id: task.id, identifier: task.identifier, title: task.title, projectId });

  const services = async (item: WorkspaceOverviewItem, action: "start" | "stop") => {
    setBusy(`${item.key}:${action}`);
    try {
      await executionWorkspacesApi.controlRuntimeServices(item.executionWorkspaceId, action);
      pushToast({ tone: "success", title: action === "start" ? "Starting services" : "Stopping services", body: item.workspaceName });
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't ${action} the services`, body: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
      void client.invalidateQueries({ queryKey: ["workspace-overview", company().id] });
    }
  };

  return (
    <div class="org-page ws-page">
      <Show when={!isCompact()} fallback={<h1 class="org-phone-title disp">Workspaces</h1>}>
        <OrgHeader />
      </Show>
      <div class="ws-toolbar">
        <Segmented label="Show" options={VIEWS} value={view()} onChange={setView} />
        <Show when={overview.data}>
          <span class="ws-muted">
            {total()} workspace{total() === 1 ? "" : "s"}
          </span>
        </Show>
        <Show when={view() === "closed"}>
          <span class="ws-muted ws-toolbar-note">A closed workspace reopens from its task: a new message or resuming the task reopens it.</span>
        </Show>
      </div>
      <Show when={focusNote()}>
        {(note) => (
          <p class="ws-focus-note" role="status">
            <span>{note()}</span>
            <Button size="compact" variant="quiet" onClick={() => setParams({ workspace: undefined })}>
              Dismiss
            </Button>
          </p>
        )}
      </Show>
      <Switch>
        <Match when={overview.isPending}>
          <p class="ws-muted">Loading workspaces…</p>
        </Match>
        <Match when={overview.isError}>
          <p class="ws-muted">The workspaces couldn't be loaded: {(overview.error as Error).message}</p>
        </Match>
        <Match when={groups().length === 0}>
          <div class="ws-empty card">
            <p>{view() === "open" ? "No open workspaces. A task's first run sets one up, following its project's workspace settings." : "No closed workspaces."}</p>
          </div>
        </Match>
        <Match when={true}>
          <For each={groups()}>
            {(group) => (
              <ProjectGroup
                group={group}
                hidePaths={hidePaths()}
                busy={busy()}
                focusId={focusId()}
                onServices={(item, action) => void services(item, action)}
                onClose={(item) => setClosing({ id: item.executionWorkspaceId, name: item.workspaceName, status: item.executionWorkspaceStatus })}
                onOpenTask={(task) => openTask(task, group.projectId)}
              />
            )}
          </For>
          <Show when={overview.hasNextPage}>
            <div class="ws-more">
              <span class="ws-muted">
                Showing {items().length} of {total()}
              </span>
              <Button size="compact" disabled={overview.isFetchingNextPage} onClick={() => void overview.fetchNextPage()}>
                {overview.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          </Show>
        </Match>
      </Switch>
      <CloseWorkspaceDialog workspace={closing()} onClose={() => setClosing(null)} onOpenTask={(task) => openTask(task, null)} />
    </div>
  );
}

function ProjectGroup(props: {
  group: WorkspaceGroup;
  hidePaths: boolean;
  busy: string | null;
  focusId: string | null;
  onServices: (item: WorkspaceOverviewItem, action: "start" | "stop") => void;
  onClose: (item: WorkspaceOverviewItem) => void;
  onOpenTask: (task: { id: string; identifier: string | null; title: string }) => void;
}) {
  const company = useCompany();
  const count = () => props.group.items.length + props.group.failed.length;
  const card = (item: WorkspaceOverviewItem) => (
    <WorkspaceCard
      item={item}
      hidePaths={props.hidePaths}
      busy={props.busy}
      focused={props.focusId === item.executionWorkspaceId}
      onServices={props.onServices}
      onClose={props.onClose}
      onOpenTask={props.onOpenTask}
    />
  );
  return (
    <section class="ws-group" aria-label={props.group.projectName}>
      <div class="ws-group-head">
        <Show when={props.group.projectId} fallback={<h2 class="disp">{props.group.projectName}</h2>}>
          {(id) => (
            <h2 class="disp">
              <A href={`/${company().issuePrefix}/projects/${props.group.projectUrlKey ?? id()}`}>{props.group.projectName}</A>
            </h2>
          )}
        </Show>
        <span class="ws-muted">
          {count()} workspace{count() === 1 ? "" : "s"}
          <Show when={props.group.runningServices > 0}>
            {" "}
            · {props.group.runningServices} service{props.group.runningServices === 1 ? "" : "s"} running
          </Show>
        </span>
      </div>
      <div class="ws-grid">
        <For each={props.group.items}>{card}</For>
      </div>
      <Show when={props.group.failed.length > 0}>
        <h3 class="ws-subhead">Cleanup needs attention</h3>
        <div class="ws-grid">
          <For each={props.group.failed}>{card}</For>
        </div>
      </Show>
    </section>
  );
}

function WorkspaceCard(props: {
  item: WorkspaceOverviewItem;
  hidePaths: boolean;
  busy: string | null;
  /** The workspace a link pointed at: marked, and scrolled to once. */
  focused: boolean;
  onServices: (item: WorkspaceOverviewItem, action: "start" | "stop") => void;
  onClose: (item: WorkspaceOverviewItem) => void;
  onOpenTask: (task: { id: string; identifier: string | null; title: string }) => void;
}) {
  let element: HTMLElement | undefined;
  createEffect(
    on(
      () => props.focused,
      (focused) => {
        if (!focused || !element) return;
        element.scrollIntoView?.({ block: "center" });
        element.focus({ preventScroll: true });
      },
    ),
  );
  const item = () => props.item;
  const actions = () => cardActions(item());
  const status = () => STATUS[item().executionWorkspaceStatus];
  const shown = () => item().linkedIssues.slice(0, 4);
  const more = () => Math.max(item().linkedIssueCount - shown().length, 0);
  const pending = (action: "start" | "stop") => props.busy === `${item().key}:${action}`;
  return (
    <article
      ref={element}
      class="card ws-card"
      aria-label={item().workspaceName}
      aria-current={props.focused ? "true" : undefined}
      tabIndex={props.focused ? -1 : undefined}
      data-focused={props.focused ? "" : undefined}
    >
      <div class="ws-card-head">
        <span class="ws-name">{item().workspaceName}</span>
        <span class="ws-tag" data-tone={status().tone}>
          {status().label}
        </span>
        <span class="ws-tag">{MODES[item().mode] ?? item().mode.replace(/_/g, " ")}</span>
        <span class="ws-muted ws-updated">Used {stampLabel(item().lastUpdatedAt)}</span>
      </div>

      <dl class="ws-props">
        <Show when={item().branchName}>
          {(branch) => (
            <>
              <dt>
                <GitBranch size={14} aria-hidden="true" />
                <span class="sr-only">Branch</span>
              </dt>
              <dd>
                <span class="mono ws-value">{branch()}</span>
                <CopyButton text={branch()} label="Copy branch" />
              </dd>
            </>
          )}
        </Show>
        <Show when={!props.hidePaths && item().cwd}>
          {(cwd) => (
            <>
              <dt>
                <FolderOpen size={14} aria-hidden="true" />
                <span class="sr-only">Folder</span>
              </dt>
              <dd>
                <span class="mono ws-value" title={cwd()}>
                  {shortPath(cwd())}
                </span>
                <CopyButton text={cwd()} label="Copy folder path" />
              </dd>
            </>
          )}
        </Show>
        <Show when={item().serviceCount > 0}>
          <dt>
            <Capsule gradient={item().runningServiceCount > 0 ? "lagoon" : "ash"} size="tiny" live={item().runningServiceCount > 0} />
            <span class="sr-only">Services</span>
          </dt>
          <dd>
            <span>
              {item().runningServiceCount} of {item().serviceCount} service{item().serviceCount === 1 ? "" : "s"} running
            </span>
            <Show when={item().primaryServiceUrl}>
              {(url) => (
                <a class="ws-url" classList={{ "ws-url--live": item().primaryServiceUrlRunning }} href={url()} target="_blank" rel="noreferrer">
                  {url().replace(/^https?:\/\//, "")}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              )}
            </Show>
          </dd>
        </Show>
      </dl>

      <Show when={item().linkedIssues.length > 0}>
        <div class="ws-tasks" aria-label="Tasks using it">
          <For each={shown()}>
            {(task) => (
              <button type="button" class="ws-task" title={task.title} onClick={() => props.onOpenTask(task)}>
                <span class="mono">{task.identifier ?? task.id.slice(0, 8)}</span>
                <span class="ws-task-title">{task.title}</span>
              </button>
            )}
          </For>
          <Show when={more() > 0}>
            <span class="ws-muted">+{more()} more</span>
          </Show>
        </div>
      </Show>

      <Show when={actions().services || actions().close}>
        <div class="ws-actions">
          <Show when={actions().services}>
            {(action) => (
              <Button size="compact" disabled={props.busy !== null} onClick={() => props.onServices(item(), action())}>
                <Show when={pending(action())} fallback={action() === "stop" ? <Square size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}>
                  <LoaderCircle size={12} class="ws-spin" aria-hidden="true" />
                </Show>
                {action() === "stop" ? "Stop services" : "Start services"}
              </Button>
            )}
          </Show>
          <Show when={actions().close}>
            {(label) => (
              <Button size="compact" variant="quiet" onClick={() => props.onClose(item())}>
                {label()}
              </Button>
            )}
          </Show>
        </div>
      </Show>
    </article>
  );
}

function CopyButton(props: { text: string; label: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text);
      pushToast({ tone: "success", title: "Copied", body: props.text });
    } catch {
      pushToast({ tone: "error", title: "Couldn't copy", body: props.text });
    }
  };
  return (
    <button type="button" class="ws-copy" aria-label={props.label} title={props.label} onClick={() => void copy()}>
      <Copy size={12} aria-hidden="true" />
    </button>
  );
}
