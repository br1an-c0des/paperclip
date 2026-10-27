import type { AgentConfigRevision, AgentDetail } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createInfiniteQuery, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Download } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { agentsApi, type AgentActionsPage } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { runPath } from "@/api/runs";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { SettingsCard } from "@/ui/Field";
import { pushToast } from "@/ui/Toast";
import { changedKeyLabel, revisionConfigChanges } from "../agent-model";
import { dateTime, failure, refreshAgent, SectionTitle } from "../shared";

/*
 * History (board 30's outline): every saved change to the agent's configuration, newest first, with
 * what changed and a roll back to an earlier one (`POST /agents/:id/config-revisions/:id/rollback`
 * restores the settings that revision saved, as a new revision), and the agent's own actions from the audit log, a page at a time, with a CSV export.
 * Comparing two revisions side by side isn't built yet.
 */

export function HistorySection(props: { agent: AgentDetail; base: string }) {
  const company = useCompany();
  const client = useQueryClient();
  const agents = useAgentsQuery();
  const revisions = createQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "config-revisions"),
    queryFn: ({ signal }) => agentsApi.configRevisions(props.agent.id, company().id, signal),
    retry: false,
  }));
  const sorted = createMemo(() => [...(revisions.data ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
  const [rollback, setRollback] = createSignal<{ revision: AgentConfigRevision; number: number } | null>(null);
  const [busy, setBusy] = createSignal(false);
  const who = (revision: AgentConfigRevision) => {
    if (revision.createdByAgentId) return agents.data?.find((agent) => agent.id === revision.createdByAgentId)?.name ?? "an agent";
    if (revision.createdByUserId === "local-board") return "the board";
    return revision.createdByUserId ? "a person" : "Paperclip";
  };
  const doRollback = async () => {
    const target = rollback();
    if (!target) return;
    setBusy(true);
    try {
      await agentsApi.rollbackConfigRevision(props.agent.id, target.revision.id, company().id);
      await refreshAgent(client, company().id, props.agent.id);
      pushToast({ tone: "success", title: `Rolled back to revision ${target.number}` });
      setRollback(null);
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't roll back", body: failure(caught, "") || undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle title="History">Every change to {props.agent.name}'s configuration, and everything it did.</SectionTitle>
      <SettingsCard title="Revisions" description="Each save of the agent's settings is a revision. Rolling back to one restores the settings it saved, as a new revision.">
        <Show when={revisions.isError}>
          <p class="ps-list-note" role="alert">
            Couldn't load the revisions. {failure(revisions.error, "")}
          </p>
        </Show>
        <ul class="ps-list ag-revisions">
          <For each={sorted()} fallback={<Show when={revisions.isSuccess}><li class="ps-list-note">No saved revisions yet.</li></Show>}>
            {(revision, index) => {
              const number = () => sorted().length - index();
              const config = () => revisionConfigChanges(revision);
              return (
                <li class="ps-list-row">
                  <span class="ag-rev-number disp">{number()}</span>
                  <span class="ps-list-name">
                    <b>
                      {revision.changedKeys.map(changedKeyLabel).join(", ") || "No changes"}
                      {revision.source === "rollback" ? " (rollback)" : ""}
                    </b>
                    <span class="ps-list-meta">
                      {dateTime(revision.createdAt)} by {who(revision)}
                      {config().length ? ` · ${config().slice(0, 6).join(", ")}${config().length > 6 ? "…" : ""}` : ""}
                    </span>
                  </span>
                  <Show when={index() === 0} fallback={<Button size="compact" variant="quiet" onClick={() => setRollback({ revision, number: number() })}>Roll back</Button>}>
                    <span class="ag-chip">current</span>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </SettingsCard>
      <ActionsCard agent={props.agent} />
      <Dialog
        open={Boolean(rollback())}
        onOpenChange={(open) => !open && setRollback(null)}
        title={`Roll back to revision ${rollback()?.number ?? ""}?`}
        width={480}
        description={`${props.agent.name}'s settings go back to how revision ${rollback()?.number ?? ""} saved them. That's saved as a new revision, so this can be undone too.`}
        footer={
          <>
            <Button variant="quiet" onClick={() => setRollback(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy()} onClick={() => void doRollback()}>
              {busy() ? "Rolling back…" : "Roll back"}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}

/** The agent's actions from the audit log. */
function ActionsCard(props: { agent: AgentDetail }) {
  const company = useCompany();
  const actions = createInfiniteQuery(() => ({
    queryKey: queryKeys.agents.part(props.agent.id, "actions"),
    queryFn: ({ pageParam, signal }) => agentsApi.actions(company().id, props.agent.id, pageParam, 25, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? null,
    retry: false,
  }));
  const items = createMemo(() => (actions.data?.pages ?? []).flatMap((page) => page.items));
  const label = (action: string) => action.replace(/[._]/g, " ");
  const detail = (item: AgentActionsPage["items"][number]) => {
    const details = item.details ?? {};
    const identifier = typeof details.identifier === "string" ? details.identifier : null;
    const title = typeof details.issueTitle === "string" ? details.issueTitle : null;
    return [identifier, title].filter(Boolean).join(" ");
  };
  return (
    <SettingsCard
      title="Actions"
      description="What the agent did, from the audit log."
      footer={
        <>
          <a class="btn btn--secondary btn--compact" href={agentsApi.actionsCsvUrl(company().id, props.agent.id)} download="">
            <Download size={14} aria-hidden="true" />
            Export CSV
          </a>
          <Show when={actions.hasNextPage}>
            <Button size="compact" variant="quiet" disabled={actions.isFetchingNextPage} onClick={() => void actions.fetchNextPage()}>
              {actions.isFetchingNextPage ? "Loading…" : "Show more"}
            </Button>
          </Show>
        </>
      }
    >
      <Show when={actions.isError}>
        <p class="ps-list-note" role="alert">
          Couldn't load the actions. {failure(actions.error, "")}
        </p>
      </Show>
      <ul class="ps-list">
        <For each={items()} fallback={<Show when={actions.isSuccess}><li class="ps-list-note">No actions yet.</li></Show>}>
          {(item) => (
            <li class="ps-list-row">
              <span class="ps-list-name">
                <b>{label(item.action)}</b>
                <span class="ps-list-meta">
                  {dateTime(item.createdAt)}
                  {detail(item) ? ` · ${detail(item)}` : ""}
                </span>
              </span>
              <Show when={item.runId}>
                {(runId) => (
                  <A class="ps-link mono" href={runPath(company().issuePrefix, props.agent.urlKey, runId())}>
                    {runId().slice(0, 8)}
                  </A>
                )}
              </Show>
            </li>
          )}
        </For>
      </ul>
    </SettingsCard>
  );
}
