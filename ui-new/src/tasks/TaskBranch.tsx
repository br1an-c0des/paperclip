import type { Issue } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { GitBranch, Lock, OctagonAlert, RefreshCw, Wrench } from "lucide-solid";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/api/queryKeys";
import { workspacesApi, type ReconcileBranchInput } from "@/api/workspaces";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextArea } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { branchStateLines, canManageRuntime, readableGit, readDivergence, reconcileOptions, reconcileWorkspaceId, shortSha, VERDICT, type Divergence } from "./branch-reconcile";
import "./TaskBranch.css";

/*
 * The Git part of a task's Workspace section (`workspaces/files-git`): the branch's state against
 * its base (from the workspace's close check, which reads git), and, when a run found the branch out
 * of step with the one Paperclip recorded, what happened and the fixes for it (branch-reconcile.ts),
 * each confirmed in a dialog that restates the divergence, as the old recovery card does.
 */

type Mode = ReconcileBranchInput["mode"];

export function TaskBranch(props: { task: Issue; workspaceId: string }) {
  const client = useQueryClient();
  const company = useCompany();
  const readiness = createQuery(() => ({
    queryKey: queryKeys.workspaces.closeReadiness(props.workspaceId),
    queryFn: ({ signal }) => workspacesApi.closeReadiness(props.workspaceId, signal),
    staleTime: 30_000,
    retry: false,
  }));
  const access = createQuery(() => ({ queryKey: queryKeys.access.currentBoardAccess, queryFn: accessApi.currentBoardAccess, retry: false }));
  const divergence = () => readDivergence(props.task.activeRecoveryAction);
  const options = () => (divergence() ? reconcileOptions(divergence()!, canManageRuntime(company().id, access.data)) : null);
  const git = () => readableGit(readiness.data?.git);
  const [confirming, setConfirming] = createSignal<Mode | null>(null);
  const [reason, setReason] = createSignal("");
  const [pending, setPending] = createSignal(false);

  const reconcile = async (mode: Mode) => {
    const target = reconcileWorkspaceId(props.task.activeRecoveryAction, props.workspaceId);
    if (!target) return;
    const input: ReconcileBranchInput = mode === "override" ? { mode, reason: reason().trim() } : { mode };
    setPending(true);
    try {
      await workspacesApi.reconcileBranch(target, input);
      pushToast(
        mode === "quarantine_restore"
          ? { tone: "success", title: "Workspace repaired", body: "Uncommitted changes went to a rescue branch and the recorded branch is back. The task will resume." }
          : { tone: "success", title: "Branch reconciled", body: "The recorded branch now matches the live one. The task will resume." },
      );
      setConfirming(null);
      setReason("");
      void client.invalidateQueries({ queryKey: queryKeys.issues.detail(props.task.id) });
      void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
      void client.invalidateQueries({ queryKey: queryKeys.workspaces.closeReadiness(target) });
    } catch (error) {
      pushToast({ tone: "error", title: mode === "quarantine_restore" ? "Couldn't repair the workspace" : "Couldn't reconcile the branch", body: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(false);
    }
  };

  return (
    <section class="tb" aria-label="Git">
      <h3 class="tw-heading">Git</h3>
      <Show when={divergence()}>
        {(found) => (
          <div class="tb-diverged" role="status">
            <div class="tb-diverged-head">
              <OctagonAlert size={15} aria-hidden="true" />
              <b>The branch is out of step</b>
              <span class="tw-tag" data-tone={VERDICT[found().verdict].tone}>
                {VERDICT[found().verdict].label}
              </span>
            </div>
            <BranchPair divergence={found()} />
            <Show when={found().reason}>{(text) => <p class="tb-text">{text()}</p>}</Show>
            <Show when={found().heldBy}>
              {(held) => (
                <p class="tb-text tb-held">
                  <Lock size={13} aria-hidden="true" /> {held().label} {held().activeRun ? "is running on" : "holds"} the live branch, so the repair can't run now.
                </p>
              )}
            </Show>
            <div class="tb-actions">
              <Show when={options()?.forward}>
                <Button size="compact" variant="primary" disabled={pending()} onClick={() => setConfirming("forward")}>
                  <RefreshCw size={13} aria-hidden="true" />
                  Reconcile forward
                </Button>
              </Show>
              <Show when={options()?.repair}>
                <Button size="compact" disabled={pending() || !!options()?.repairBlocked} title={options()?.repairBlocked ?? undefined} onClick={() => setConfirming("quarantine_restore")}>
                  <Wrench size={13} aria-hidden="true" />
                  Repair: move changes aside
                </Button>
              </Show>
              <Show when={options()?.override}>
                <Button size="compact" variant="danger" disabled={pending()} onClick={() => setConfirming("override")}>
                  Reconcile anyway
                </Button>
              </Show>
            </div>
          </div>
        )}
      </Show>
      <Switch>
        <Match when={readiness.isPending}>
          <p class="tsec-muted">Reading the repository…</p>
        </Match>
        <Match when={readiness.isError}>
          <p class="tsec-muted">The repository's state couldn't be read: {(readiness.error as Error).message}</p>
        </Match>
        <Match when={!git()}>
          <p class="tsec-muted">No git state for this workspace.</p>
        </Match>
        <Match when={git()}>
          {(found) => (
            <div class="card tb-card">
              <div class="tb-branch">
                <GitBranch size={14} aria-hidden="true" />
                <span class="mono">{found().branchName ?? "Detached"}</span>
                <Show when={found().headSha}>{(sha) => <span class="mono tsec-muted">@ {shortSha(sha())}</span>}</Show>
              </div>
              <ul class="tb-lines">
                <For each={branchStateLines(found())}>{(line) => <li>{line}</li>}</For>
              </ul>
            </div>
          )}
        </Match>
      </Switch>

      <Show when={divergence()}>
        {(found) => (
          <Dialog
            open={confirming() !== null}
            onOpenChange={(open) => {
              if (!open && !pending()) setConfirming(null);
            }}
            title={confirming() === "quarantine_restore" ? "Repair the workspace?" : confirming() === "override" ? "Reconcile without the safety check?" : "Reconcile the branch forward?"}
            width={560}
            hideClose
            footer={
              <>
                <Button disabled={pending()} onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
                <Button
                  variant={confirming() === "override" ? "danger" : "primary"}
                  disabled={pending() || (confirming() === "override" && !reason().trim())}
                  onClick={() => void reconcile(confirming()!)}
                >
                  {pending() ? (confirming() === "quarantine_restore" ? "Repairing…" : "Reconciling…") : confirming() === "quarantine_restore" ? "Move changes and restore" : confirming() === "override" ? "Reconcile anyway" : "Reconcile forward"}
                </Button>
              </>
            }
          >
            <div class="tb-confirm">
              <Switch>
                <Match when={confirming() === "forward"}>
                  <p>The live branch carries the recorded one forward, so Paperclip adopts it as the task's branch. The server checks the ancestry again first. The task then resumes.</p>
                  <BranchPair divergence={found()} />
                </Match>
                <Match when={confirming() === "quarantine_restore"}>
                  <p>Nothing is lost: the uncommitted changes are committed to a new rescue branch, then the recorded branch is checked out again so the task can resume. The live branch stays as it is.</p>
                  <dl class="tb-facts">
                    <dt>Changes</dt>
                    <dd>{found().dirtyFileCount === null ? "Uncommitted changes" : `${found().dirtyFileCount} uncommitted change${found().dirtyFileCount === 1 ? "" : "s"}`}</dd>
                    <dt>Live branch</dt>
                    <dd class="mono">{found().liveBranch ?? "detached"} (left as is)</dd>
                    <dt>Rescue branch</dt>
                    <dd class="mono">{found().rescueBranchPrefix}&lt;time&gt;</dd>
                    <dt>Restores</dt>
                    <dd class="mono">{found().expectedBranch ?? "the recorded branch"}</dd>
                  </dl>
                  <Show when={found().dirtyPathSample.length > 0}>
                    <ul class="tb-paths">
                      <For each={found().dirtyPathSample}>{(path) => <li class="mono">{path}</li>}</For>
                    </ul>
                  </Show>
                </Match>
                <Match when={confirming() === "override"}>
                  <p>
                    This skips Paperclip's safety check and points the task at the live branch <b>without proof that it carries the recorded one forward</b>.
                    Check the branches below, and say why. The reason goes in the audit log.
                  </p>
                  <BranchPair divergence={found()} />
                  <Field label="Reason (required)" for="tb-reason">
                    <TextArea
                      id="tb-reason"
                      rows={3}
                      value={reason()}
                      placeholder="For example: checked the live branch, it only adds the follow-up commits we wanted"
                      aria-required="true"
                      onInput={(event) => setReason(event.currentTarget.value)}
                    />
                  </Field>
                </Match>
              </Switch>
            </div>
          </Dialog>
        )}
      </Show>
    </section>
  );
}

function BranchPair(props: { divergence: Divergence }) {
  return (
    <dl class="tb-facts">
      <dt>Recorded</dt>
      <dd class="mono">
        {props.divergence.expectedBranch ?? "detached"}
        <Show when={shortSha(props.divergence.expectedHeadSha)}>{(sha) => <span class="tsec-muted"> @ {sha()}</span>}</Show>
      </dd>
      <dt>Live</dt>
      <dd class="mono">
        {props.divergence.liveBranch ?? "detached"}
        <Show when={shortSha(props.divergence.liveHeadSha)}>{(sha) => <span class="tsec-muted"> @ {sha()}</span>}</Show>
      </dd>
      <dt>Ancestry</dt>
      <dd>{VERDICT[props.divergence.verdict].label}</dd>
    </dl>
  );
}
