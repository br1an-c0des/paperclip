import type { WorkspaceRuntimeService } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ExternalLink, Play, RotateCw, Square } from "lucide-solid";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { executionWorkspacesApi } from "@/api/execution-workspaces";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { Button } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { WorkspacePlugins } from "@/plugins/WorkspacePlugins";
import { TaskBranch } from "./TaskBranch";
import { stampLabel } from "./thread-model";
import "./TaskWorkspace.css";

/*
 * The task panel's Workspace section: the execution workspace the task's runs use (where it is,
 * which branch, its state), its git state with branch reconcile when a run found the branch out of
 * step (TaskBranch.tsx), and the services running in it, which can be started, stopped and
 * restarted. Browsing the workspace's files comes with the file viewer slice of M2.
 */

const MODES: Record<string, string> = {
  shared_workspace: "Shared workspace",
  isolated_workspace: "Isolated worktree",
  operator_branch: "Operator branch",
  adapter_managed: "Managed by the adapter",
  cloud_sandbox: "Cloud sandbox",
};

const SERVICE_TONE: Record<WorkspaceRuntimeService["status"], string> = {
  provisioning: "amber",
  starting: "amber",
  running: "green",
  stopped: "neutral",
  failed: "red",
};

type Action = "start" | "stop" | "restart";

const words = (value: string) => value.replace(/_/g, " ");

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
  const [busy, setBusy] = createSignal<string | null>(null);

  const control = async (service: WorkspaceRuntimeService, action: Action) => {
    const id = workspaceId();
    if (!id) return;
    setBusy(`${service.id}:${action}`);
    try {
      await executionWorkspacesApi.controlRuntimeServices(id, action, { runtimeServiceId: service.id, serviceIndex: service.configIndex ?? null });
      void client.invalidateQueries({ queryKey: queryKeys.issues.section(props.taskId, "workspace") });
    } catch (error) {
      pushToast({ tone: "error", title: `Couldn't ${action} ${service.serviceName}`, body: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
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
                    when={(current().runtimeServices ?? []).length > 0}
                    fallback={<p class="tsec-muted">No services have run in this workspace.</p>}
                  >
                    <div class="card tw-list">
                      <For each={current().runtimeServices ?? []}>
                        {(service) => {
                          const live = () => service.status === "running" || service.status === "starting" || service.status === "provisioning";
                          const pending = (action: Action) => busy() === `${service.id}:${action}`;
                          return (
                            <div class="tw-service">
                              <div class="tw-service-main">
                                <div class="tw-title">
                                  <span class="tw-service-name">{service.serviceName}</span>
                                  <span class="tw-tag" data-tone={SERVICE_TONE[service.status]}>
                                    {service.status}
                                  </span>
                                  <Show when={service.healthStatus === "unhealthy"}>
                                    <span class="tw-tag" data-tone="red">
                                      unhealthy
                                    </span>
                                  </Show>
                                </div>
                                <span class="tsec-muted">
                                  <Show when={service.command}>{(command) => <span class="mono">{command()}</span>}</Show>
                                  <Show when={service.port}>{(port) => <> · port {port()}</>}</Show>
                                </span>
                                <Show when={service.url}>
                                  {(url) => (
                                    <a class="tw-url" href={url()} target="_blank" rel="noopener noreferrer">
                                      {url()}
                                      <ExternalLink size={12} aria-hidden="true" />
                                    </a>
                                  )}
                                </Show>
                              </div>
                              <div class="tw-actions">
                                <Show
                                  when={live()}
                                  fallback={
                                    <Button size="compact" disabled={busy() !== null} onClick={() => void control(service, "start")}>
                                      <Play size={12} aria-hidden="true" />
                                      {pending("start") ? "Starting…" : "Start"}
                                    </Button>
                                  }
                                >
                                  <Button size="compact" disabled={busy() !== null} onClick={() => void control(service, "restart")}>
                                    <RotateCw size={12} aria-hidden="true" />
                                    {pending("restart") ? "Restarting…" : "Restart"}
                                  </Button>
                                  <Button size="compact" disabled={busy() !== null} onClick={() => void control(service, "stop")}>
                                    <Square size={12} aria-hidden="true" />
                                    {pending("stop") ? "Stopping…" : "Stop"}
                                  </Button>
                                </Show>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
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
