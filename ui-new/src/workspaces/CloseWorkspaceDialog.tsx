import type { ExecutionWorkspaceStatus } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { LoaderCircle } from "lucide-solid";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { workspacesApi } from "@/api/workspaces";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { pushToast } from "@/ui/Toast";
import { readinessSummary } from "./workspaces-model";

/*
 * Closing a workspace, after ui/src/components/ExecutionWorkspaceCloseDialog.tsx: first the server's
 * close check (tasks still open in it, warnings, git state, services, what cleanup will do), then
 * Close, which archives it and cleans up what Paperclip made. The record and task history stay. A
 * blocked close can't be confirmed; one whose cleanup failed can be retried.
 */

export function CloseWorkspaceDialog(props: {
  workspace: { id: string; name: string; status: ExecutionWorkspaceStatus } | null;
  onClose: () => void;
  onOpenTask?: (task: { id: string; identifier: string | null; title: string }) => void;
}) {
  const client = useQueryClient();
  const company = useCompany();
  const [closing, setClosing] = createSignal(false);
  const readiness = createQuery(() => ({
    queryKey: queryKeys.workspaces.closeReadiness(props.workspace?.id ?? ""),
    queryFn: ({ signal }) => workspacesApi.closeReadiness(props.workspace!.id, signal),
    enabled: !!props.workspace,
    staleTime: 0,
  }));
  const retry = () => props.workspace?.status === "cleanup_failed";
  const label = () => (retry() ? "Retry close" : "Close workspace");
  const summary = () => (readiness.data ? readinessSummary(readiness.data) : null);
  const open = () => readiness.data?.linkedIssues.filter((issue) => !issue.isTerminal) ?? [];
  const blocked = () => !readiness.data || readiness.data.state === "blocked" || props.workspace?.status === "archived";

  const close = async () => {
    const workspace = props.workspace;
    if (!workspace || blocked()) return;
    setClosing(true);
    try {
      await workspacesApi.close(workspace.id);
      pushToast({ tone: "success", title: retry() ? "Close retried" : "Workspace closed", body: workspace.name });
      void client.invalidateQueries({ queryKey: ["workspace-overview", company().id] });
      void client.invalidateQueries({ queryKey: queryKeys.workspaces.closeReadiness(workspace.id) });
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
      props.onClose();
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't close the workspace", body: error instanceof Error ? error.message : String(error) });
    } finally {
      setClosing(false);
    }
  };

  return (
    <Dialog
      open={!!props.workspace}
      onOpenChange={(next) => {
        if (!next && !closing()) props.onClose();
      }}
      title={label()}
      description={
        <>
          Close <b>{props.workspace?.name}</b> and clean up what Paperclip made for it. The workspace record and its tasks' history stay; it
          leaves the open workspaces.
        </>
      }
      width={640}
      hideClose
      footer={
        <>
          <Button disabled={closing()} onClick={() => props.onClose()}>
            Cancel
          </Button>
          <Button variant={retry() ? "primary" : "danger"} disabled={blocked() || closing() || readiness.isFetching} onClick={() => void close()}>
            <Show when={closing()}>
              <LoaderCircle size={14} class="ws-spin" aria-hidden="true" />
            </Show>
            {label()}
          </Button>
        </>
      }
    >
      <div class="ws-close">
        <Switch>
          <Match when={readiness.isPending}>
            <p class="ws-muted">
              <LoaderCircle size={14} class="ws-spin" aria-hidden="true" /> Checking whether this workspace can be closed…
            </p>
          </Match>
          <Match when={readiness.isError}>
            <p class="ws-callout" data-tone="red">
              {(readiness.error as Error).message}
            </p>
          </Match>
          <Match when={readiness.data}>
            {(found) => (
              <>
                <div class="ws-callout" data-tone={summary()!.tone} role="status">
                  <b>{summary()!.title}</b>
                  <span>{summary()!.detail}</span>
                </div>
                <Show when={open().length > 0}>
                  <section class="ws-close-part">
                    <h3>Tasks still open in it</h3>
                    <TaskLines tasks={open()} onOpenTask={props.onOpenTask} />
                  </section>
                </Show>
                <Show when={found().blockingReasons.length > 0}>
                  <section class="ws-close-part">
                    <h3>Why it can't close</h3>
                    <ul class="ws-reasons" data-tone="red">
                      <For each={found().blockingReasons}>{(reason) => <li>{reason}</li>}</For>
                    </ul>
                  </section>
                </Show>
                <Show when={found().warnings.length > 0}>
                  <section class="ws-close-part">
                    <h3>Warnings</h3>
                    <ul class="ws-reasons" data-tone="amber">
                      <For each={found().warnings}>{(warning) => <li>{warning}</li>}</For>
                    </ul>
                  </section>
                </Show>
                <Show when={found().git}>
                  {(git) => (
                    <section class="ws-close-part">
                      <h3>Git</h3>
                      <dl class="ws-git">
                        <dt>Branch</dt>
                        <dd class="mono">{git().branchName ?? "Unknown"}</dd>
                        <dt>Base</dt>
                        <dd class="mono">{git().baseRef ?? "Not set"}</dd>
                        <dt>Merged into base</dt>
                        <dd>{git().isMergedIntoBase == null ? "Unknown" : git().isMergedIntoBase ? "Yes" : "No"}</dd>
                        <dt>Ahead / behind</dt>
                        <dd>
                          {git().aheadCount ?? 0} / {git().behindCount ?? 0}
                        </dd>
                        <dt>Uncommitted</dt>
                        <dd>
                          {git().dirtyEntryCount} changed, {git().untrackedEntryCount} untracked
                        </dd>
                      </dl>
                    </section>
                  )}
                </Show>
                <Show when={found().runtimeServices.length > 0}>
                  <section class="ws-close-part">
                    <h3>Services</h3>
                    <ul class="ws-lines">
                      <For each={found().runtimeServices}>
                        {(service) => (
                          <li>
                            <b>{service.serviceName}</b>
                            <span class="ws-muted">
                              {service.status} · {service.lifecycle}
                              <Show when={service.url ?? service.command}>{(detail) => <> · {detail()}</>}</Show>
                            </span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                </Show>
                <Show when={found().plannedActions.length > 0}>
                  <section class="ws-close-part">
                    <h3>Cleanup</h3>
                    <ul class="ws-lines">
                      <For each={found().plannedActions}>
                        {(action) => (
                          <li>
                            <b>{action.label}</b>
                            <span class="ws-muted">{action.description}</span>
                            <Show when={action.command}>{(command) => <code class="ws-command">{command()}</code>}</Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                </Show>
                <Show when={retry()}>
                  <p class="ws-callout" data-tone="amber">
                    Cleanup failed on this workspace before. Retrying runs the cleanup again and updates its status if it works.
                  </p>
                </Show>
              </>
            )}
          </Match>
        </Switch>
      </div>
    </Dialog>
  );
}

function TaskLines(props: {
  tasks: { id: string; identifier: string | null; title: string; status: string }[];
  onOpenTask?: (task: { id: string; identifier: string | null; title: string }) => void;
}) {
  return (
    <ul class="ws-lines">
      <For each={props.tasks}>
        {(task) => (
          <li>
            <Show when={props.onOpenTask} fallback={<b>{task.identifier ?? task.id.slice(0, 8)}</b>}>
              {(open) => (
                <button type="button" class="ws-link" onClick={() => open()(task)}>
                  {task.identifier ?? task.id.slice(0, 8)}
                </button>
              )}
            </Show>
            <span>{task.title}</span>
            <span class="ws-muted">{task.status.replace(/_/g, " ")}</span>
          </li>
        )}
      </For>
    </ul>
  );
}
