import type { ExecutionWorkspace, Issue } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink, Play, RotateCw, Square } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { executionWorkspacesApi, type RuntimeCommandAction } from "@/api/execution-workspaces";
import { instanceSettingsApi } from "@/api/instance-settings";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { WorkspacePlugins } from "@/plugins/WorkspacePlugins";
import { isActiveService, runtimeControls, type RuntimeControl } from "@/workspaces/runtime-commands";
import { WorkspaceOperations } from "@/workspaces/WorkspaceOperations";
import { TaskBranch } from "./TaskBranch";
import { stampLabel } from "./thread-model";
import "./TaskWorkspace.css";

/*
 * The task panel's Workspace section: the execution workspace the task's runs use (where it is,
 * which branch, its state), its git state with branch reconcile when a run found the branch out of
 * step (TaskBranch.tsx), its services and jobs, and what Paperclip has done to it. Browsing the
 * workspace's files is Docs and files' "Browse workspace files".
 *
 * Services and jobs come from the workspace's runtime config (workspaces/runtime-commands.ts): a
 * configured service can be started even if it has never run, restarted and stopped, and a job
 * run once (`POST /execution-workspaces/:id/runtime-commands/:action`). A task on its project's
 * main checkout runs its services from the project's settings, so only the services already
 * running there show, to restart or stop (`runtime-services`). Each start, stop or run starts or
 * ends a process on the machine running the workspace, and is recorded as an operation.
 */

const MODES: Record<string, string> = {
  shared_workspace: "Shared workspace",
  isolated_workspace: "Isolated worktree",
  operator_branch: "Operator branch",
  adapter_managed: "Managed by the adapter",
  cloud_sandbox: "Cloud sandbox",
};

const SERVICE_TONE: Record<string, string> = {
  provisioning: "amber",
  starting: "amber",
  running: "green",
  stopped: "neutral",
  failed: "red",
};

const PENDING: Record<RuntimeCommandAction, string> = { start: "Starting…", stop: "Stopping…", restart: "Restarting…", run: "Running…" };
const DONE: Record<RuntimeCommandAction, string> = { start: "Started", stop: "Stopped", restart: "Restarted", run: "Ran" };

const words = (value: string) => value.replace(/_/g, " ");

/**
 * Whether the task works in its project's main checkout (a shared workspace over the project's
 * primary workspace), as the old task properties decide it (`isMainIssueWorkspace`).
 */
export function onMainCheckout(task: Pick<Issue, "projectWorkspaceId" | "project">, workspace: Pick<ExecutionWorkspace, "mode" | "projectWorkspaceId">) {
  if (workspace.mode !== "shared_workspace") return false;
  const linked = workspace.projectWorkspaceId ?? task.projectWorkspaceId ?? null;
  const primary = task.project?.primaryWorkspace?.id ?? null;
  return !linked || !primary || linked === primary;
}

export function TaskWorkspace(props: { taskId: string }) {
  const client = useQueryClient();
  const task = createQuery(() => ({
    queryKey: queryKeys.issues.detail(props.taskId),
    queryFn: ({ signal }) => issuesApi.get(props.taskId, signal),
  }));
  const workspaceId = () => task.data?.currentExecutionWorkspace?.id ?? task.data?.executionWorkspaceId ?? null;
  const workspace = createQuery(() => ({
    queryKey: queryKeys.issues.section(props.taskId, "workspace", workspaceId() ?? ""),
    queryFn: ({ signal }) => executionWorkspacesApi.get(workspaceId()!, signal),
    enabled: workspaceId() !== null,
  }));
  const operations = createQuery(() => ({
    queryKey: queryKeys.executionWorkspaces.operations(workspaceId() ?? ""),
    queryFn: ({ signal }) => executionWorkspacesApi.operations(workspaceId()!, signal),
    enabled: workspaceId() !== null,
    refetchInterval: (query) => (query.state.data?.some((operation) => operation.status === "running") ? 3_000 : false),
    retry: false,
  }));
  const settings = createQuery(() => ({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: instanceSettingsApi.general,
    staleTime: 60_000,
  }));
  const [busy, setBusy] = createSignal<string | null>(null);

  const controls = createMemo(() => {
    const current = workspace.data;
    if (!current || !task.data) return null;
    const main = onMainCheckout(task.data, current);
    return runtimeControls({
      runtime: main ? null : (current.config?.workspaceRuntime ?? null),
      services: current.runtimeServices ?? [],
      canRun: !!current.cwd,
    });
  });
  // Without a runtime config, the services that have run are what there is to control.
  const configured = () => (controls()?.services.length ?? 0) + (controls()?.jobs.length ?? 0) > 0;
  const ranServices = createMemo<RuntimeControl[]>(() =>
    (workspace.data?.runtimeServices ?? []).map((service) => ({
      key: `runtime:${service.id}`,
      title: service.serviceName,
      kind: "service",
      status: service.status,
      healthStatus: service.healthStatus,
      command: service.command,
      cwd: service.cwd,
      port: service.port,
      url: service.url,
      workspaceCommandId: null,
      runtimeServiceId: service.id,
      serviceIndex: service.configIndex ?? null,
      disabledReason: null,
    })),
  );

  const control = async (item: RuntimeControl, action: RuntimeCommandAction) => {
    const id = workspaceId();
    if (!id) return;
    setBusy(`${item.key}:${action}`);
    try {
      const target = { workspaceCommandId: item.workspaceCommandId, runtimeServiceId: item.runtimeServiceId, serviceIndex: item.serviceIndex };
      if (item.workspaceCommandId) await executionWorkspacesApi.controlRuntimeCommands(id, action, target);
      else if (action !== "run") await executionWorkspacesApi.controlRuntimeServices(id, action, target);
      pushToast({ tone: "success", title: `${DONE[action]} ${item.title}` });
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't ${action} ${item.title}`, body: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
      void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.taskId, "workspace") });
      void client.invalidateQueries({ queryKey: queryKeys.executionWorkspaces.operations(id) });
    }
  };

  const ControlRow = (row: { item: RuntimeControl }) => {
    const item = () => row.item;
    const live = () => item().kind === "service" && isActiveService(item().status);
    const pending = (action: RuntimeCommandAction) => busy() === `${item().key}:${action}`;
    const button = (action: RuntimeCommandAction, label: string, icon: () => JSX.Element, disabled = false) => (
      <Button size="compact" disabled={busy() !== null || disabled} onClick={() => void control(item(), action)}>
        {icon()}
        {pending(action) ? PENDING[action] : label}
      </Button>
    );
    // A service the config no longer defines can only be stopped.
    const orphan = () => !item().workspaceCommandId && !!item().disabledReason;
    return (
      <div class="tw-service">
        <div class="tw-service-main">
          <div class="tw-title">
            <span class="tw-service-name">{item().title}</span>
            <span class="tw-tag" data-tone={item().kind === "job" ? undefined : SERVICE_TONE[item().status]}>
              {item().status}
            </span>
            <Show when={item().healthStatus === "unhealthy"}>
              <span class="tw-tag" data-tone="red">
                unhealthy
              </span>
            </Show>
          </div>
          <span class="tsec-muted">
            <Show when={item().command}>{(command) => <span class="mono">{command()}</span>}</Show>
            <Show when={item().port}>{(port) => <> · port {port()}</>}</Show>
          </span>
          <Show when={item().url && live()}>
            <a class="tw-url" href={item().url!} target="_blank" rel="noopener noreferrer">
              {item().url}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </Show>
          <Show when={item().disabledReason && !live()}>
            <span class="tsec-muted">{item().disabledReason}</span>
          </Show>
        </div>
        <div class="tw-actions">
          <Switch>
            <Match when={item().kind === "job"}>
              {button("run", "Run", () => <Play size={12} aria-hidden="true" />, !!item().disabledReason)}
            </Match>
            <Match when={live()}>
              <Show when={!orphan()}>{button("restart", "Restart", () => <RotateCw size={12} aria-hidden="true" />)}</Show>
              {button("stop", "Stop", () => <Square size={12} aria-hidden="true" />)}
            </Match>
            <Match when={!orphan()}>
              {button("start", "Start", () => <Play size={12} aria-hidden="true" />, !!item().disabledReason)}
            </Match>
          </Switch>
        </div>
      </div>
    );
  };

  return (
    <section class="tw" aria-label="Workspace">
      <div class="tsec-head">
        <h2 class="disp">Workspace</h2>
      </div>
      <div class="tsec-scroll">
        <Switch>
          <Match when={task.isPending || (workspaceId() !== null && workspace.isPending)}>
            <p class="tsec-muted">Loading…</p>
          </Match>
          <Match when={workspaceId() === null}>
            <p class="tsec-muted">This task hasn't run in a workspace yet. Its first run sets one up, following the project's workspace settings.</p>
          </Match>
          <Match when={workspace.isError}>
            <p class="tsec-muted">The workspace couldn't be loaded: {(workspace.error as Error).message}</p>
          </Match>
          <Match when={workspace.data}>
            {(current) => (
              <>
                <div class="card tw-card">
                  <div class="tw-title">
                    <span class="tw-name">{current().name}</span>
                    <span class="tw-tag">{MODES[current().mode] ?? words(current().mode)}</span>
                    <span class="tw-tag" data-tone={current().status === "active" ? "green" : undefined}>
                      {words(current().status)}
                    </span>
                  </div>
                  <dl class="tw-props">
                    <Show when={current().branchName}>
                      {(branch) => (
                        <>
                          <dt>Branch</dt>
                          <dd class="mono">
                            {branch()}
                            <Show when={current().baseRef}>{(base) => <span class="tsec-muted"> from {base()}</span>}</Show>
                          </dd>
                        </>
                      )}
                    </Show>
                    <Show when={current().cwd}>
                      {(cwd) => (
                        <>
                          <dt>Folder</dt>
                          <dd class="mono tw-path">{cwd()}</dd>
                        </>
                      )}
                    </Show>
                    <Show when={current().repoUrl}>
                      {(repo) => (
                        <>
                          <dt>Repository</dt>
                          <dd class="mono tw-path">{repo()}</dd>
                        </>
                      )}
                    </Show>
                    <Show when={current().deliveryState && current().deliveryState !== "unknown"}>
                      <dt>Delivery</dt>
                      <dd>{words(String(current().deliveryState))}</dd>
                    </Show>
                    <dt>Opened</dt>
                    <dd>
                      {stampLabel(current().openedAt)}
                      <span class="tsec-muted"> · last used {stampLabel(current().lastUsedAt)}</span>
                    </dd>
                    <Show when={current().closedAt}>
                      {(closed) => (
                        <>
                          <dt>Closed</dt>
                          <dd>{stampLabel(closed())}</dd>
                        </>
                      )}
                    </Show>
                  </dl>
                </div>

                <TaskBranch task={task.data!} workspaceId={current().id} />

                <section class="tw-services" aria-label="Services">
                  <h3 class="tw-heading">Services</h3>
                  <Show
                    when={configured()}
                    fallback={
                      <Show when={ranServices().length > 0} fallback={<p class="tsec-muted">No services are set up or have run in this workspace.</p>}>
                        <div class="card tw-list">
                          <For each={ranServices()}>{(item) => <ControlRow item={item} />}</For>
                        </div>
                      </Show>
                    }
                  >
                    <Show when={(controls()?.services.length ?? 0) + (controls()?.otherServices.length ?? 0) > 0}>
                      <div class="card tw-list">
                        <For each={[...(controls()?.services ?? []), ...(controls()?.otherServices ?? [])]}>{(item) => <ControlRow item={item} />}</For>
                      </div>
                    </Show>
                    <Show when={(controls()?.jobs.length ?? 0) > 0}>
                      <h3 class="tw-heading">Jobs</h3>
                      <div class="card tw-list">
                        <For each={controls()?.jobs ?? []}>{(item) => <ControlRow item={item} />}</For>
                      </div>
                    </Show>
                  </Show>
                </section>

                <section class="tw-services" aria-label="Operations">
                  <h3 class="tw-heading">Operations</h3>
                  <Switch>
                    <Match when={operations.isPending}>
                      <p class="tsec-muted">Loading…</p>
                    </Match>
                    <Match when={operations.isError}>
                      <p class="tsec-muted">The workspace's operations couldn't be loaded: {(operations.error as Error).message}</p>
                    </Match>
                    <Match when={(operations.data ?? []).length === 0}>
                      <p class="tsec-muted">Nothing has been done to this workspace yet.</p>
                    </Match>
                    <Match when={true}>
                      <WorkspaceOperations operations={operations.data!} censorUsername={settings.data?.censorUsernameInLogs === true} limit={5} />
                    </Match>
                  </Switch>
                </section>
                <WorkspacePlugins kind="execution_workspace" workspaceId={current().id} projectId={current().projectId ?? task.data?.projectId} />
              </>
            )}
          </Match>
        </Switch>
      </div>
    </section>
  );
}
