import type { RoutineDetail, RoutineRevision } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { routinesApi, type RestoreRoutineRevisionResponse } from "@/api/routines";
import { useCompany } from "@/lib/company";
import { useProjectsQuery } from "@/lib/company-data";
import { useTaskPeople } from "@/tasks/people";
import { copyText } from "@/tasks/TaskActions";
import { AgentAvatar, InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { pushToast } from "@/ui/Toast";
import { refreshRecurring } from "./queries";
import { revisionChanges } from "./recurring-model";
import { formatFire } from "./schedule";

/*
 * The recurring task's history of changes (board R4): each revision with who made it, when, and
 * what changed from the one before, worked out from the two snapshots; Restore on older ones
 * (`POST /routines/:id/revisions/:revisionId/restore`), which makes a new revision. A restored
 * webhook gets a new secret, shown once.
 */

export function RecurringHistory(props: { routine: RoutineDetail }) {
  const company = useCompany();
  const client = useQueryClient();
  const people = useTaskPeople();
  const projects = useProjectsQuery();
  const revisions = createQuery(() => ({
    queryKey: queryKeys.routines.revisions(props.routine.id),
    queryFn: ({ signal }) => routinesApi.revisions(props.routine.id, signal),
  }));
  const [confirming, setConfirming] = createSignal<string | null>(null);
  const [restored, setRestored] = createSignal<RestoreRoutineRevisionResponse | null>(null);
  const [busy, setBusy] = createSignal(false);

  const ordered = createMemo(() => [...(revisions.data ?? [])].sort((a, b) => b.revisionNumber - a.revisionNumber));
  const names = {
    agent: (id: string) => people.agent(id)?.name,
    project: (id: string) => projects.data?.find((project) => project.id === id)?.name,
  };
  const changes = (revision: RoutineRevision, index: number) => {
    const previous = ordered()[index + 1] ?? null;
    const list = revisionChanges(previous?.snapshot ?? null, revision.snapshot, names);
    if (list.length === 0 && revision.changeSummary) return [revision.changeSummary];
    if (revision.restoredFromRevisionId) {
      const from = ordered().find((each) => each.id === revision.restoredFromRevisionId);
      return [`Restored revision ${from?.revisionNumber ?? "an older revision"}`, ...list];
    }
    return list.length > 0 ? list : ["No visible changes"];
  };

  const restore = async (revision: RoutineRevision) => {
    setBusy(true);
    try {
      const response = await routinesApi.restoreRevision(props.routine.id, revision.id);
      setConfirming(null);
      if (response.secretMaterials.length > 0) setRestored(response);
      pushToast({ tone: "success", title: `Restored revision ${revision.revisionNumber}`, body: `Saved as revision ${response.revision.revisionNumber}.` });
      refreshRecurring(client, company().id);
    } catch (error) {
      pushToast({ tone: "error", title: "Couldn't restore it", body: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div class="tsec-head">
        <h2 class="disp">History</h2>
        <span class="rpn-head-title">{props.routine.title}</span>
      </div>
      <div class="tsec-scroll">
        <Show when={restored()}>
          {(response) => (
            <div class="rpn-secret" role="status">
              <b>The restored webhook has a new secret, shown only now</b>
              <For each={response().secretMaterials}>
                {(material) => (
                  <div class="rpn-secret-row">
                    <code class="mono">{material.webhookUrl}</code>
                    <Button size="compact" onClick={() => void copyText(material.webhookSecret).then(() => pushToast({ tone: "success", title: "Copied the secret" }))}>
                      Copy secret
                    </Button>
                  </div>
                )}
              </For>
              <Button ghost size="compact" onClick={() => setRestored(null)}>
                Done
              </Button>
            </div>
          )}
        </Show>
        <Show when={revisions.data} fallback={<p class="tsec-muted">{revisions.isError ? `The history couldn't be loaded: ${(revisions.error as Error).message}` : "Loading history…"}</p>}>
          <ol class="rpn-revisions" aria-label="Revisions">
            <For each={ordered()}>
              {(revision, index) => {
                const current = () => revision.id === props.routine.latestRevisionId || index() === 0;
                const agent = () => people.agent(revision.createdByAgentId);
                const who = () =>
                  agent()?.name ??
                  (revision.createdByUserId ? (revision.createdByUserId === people.youId() ? "You" : people.personName(revision.createdByUserId)) : "Paperclip");
                return (
                  <li class="rpn-revision" classList={{ "rpn-revision--current": current() }}>
                    <span class="rpn-revision-who">
                      <Show when={agent()} fallback={<InitialsDisc name={who()} seed={revision.createdByUserId ?? "paperclip"} size={28} you={who() === "You"} />}>
                        {(found) => <AgentAvatar agent={found()} size={32} ring={false} />}
                      </Show>
                    </span>
                    <div class="rpn-revision-main">
                      <div class="rpn-revision-top">
                        <b>Revision {revision.revisionNumber}</b>
                        <span>{formatFire(revision.createdAt)}</span>
                        <span>· {who()}</span>
                        <Show when={current()}>
                          <span class="rv-badge">Current</span>
                        </Show>
                      </div>
                      <ul>
                        <For each={changes(revision, index())}>{(change) => <li>{change}</li>}</For>
                      </ul>
                    </div>
                    <Show when={!current()}>
                      <Show
                        when={confirming() === revision.id}
                        fallback={
                          <Button ghost size="compact" onClick={() => setConfirming(revision.id)}>
                            Restore
                          </Button>
                        }
                      >
                        <span class="rpn-confirm">
                          <Button variant="quiet" size="compact" onClick={() => setConfirming(null)}>
                            Cancel
                          </Button>
                          <Button variant="primary" size="compact" disabled={busy()} onClick={() => void restore(revision)}>
                            Restore {revision.revisionNumber}
                          </Button>
                        </span>
                      </Show>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ol>
        </Show>
      </div>
    </>
  );
}
