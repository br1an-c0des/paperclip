import type { AgentConfigRevision, AgentDetail } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createInfiniteQuery, createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, Download, GitCompare } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { agentsApi, type AgentActionsPage } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { runPath } from "@/api/runs";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { FieldButton, SettingsCard } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { changedKeyLabel, configDifferences, configValueText, revisionConfigChanges } from "../agent-model";
import { dateTime, failure, refreshAgent, SectionTitle } from "../shared";

/*
 * History (board 30's outline): every saved change to the agent's configuration, newest first, with
 * what changed and a roll back to an earlier one (`POST /agents/:id/config-revisions/:id/rollback`
 * restores the settings that revision saved, as a new revision), comparing any two revisions
 * setting by setting (each revision stores the whole configuration it saved), and the agent's own
 * actions from the audit log, a page at a time, with a CSV export.
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
  const [comparing, setComparing] = createSignal(false);
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
      <SettingsCard
        title="Revisions"
        description="Each save of the agent's settings is a revision. Rolling back to one restores the settings it saved, as a new revision."
        footer={
          <Show when={sorted().length > 1}>
            <Button size="compact" icon={<GitCompare size={14} aria-hidden="true" />} onClick={() => setComparing(true)}>
              Compare revisions
            </Button>
          </Show>
        }
      >
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
      <Show when={comparing()}>
        <CompareDialog revisions={sorted()} onClose={() => setComparing(false)} />
      </Show>
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

/**
 * Two revisions side by side, setting by setting: by default the one before the current and the
 * current. `revisions` is newest first; a revision's number counts from the oldest.
 */
function CompareDialog(props: { revisions: AgentConfigRevision[]; onClose: () => void }) {
  const number = (revision: AgentConfigRevision) => props.revisions.length - props.revisions.indexOf(revision);
  const [fromId, setFromId] = createSignal(props.revisions[1]?.id ?? props.revisions[0]!.id);
  const [toId, setToId] = createSignal(props.revisions[0]!.id);
  const from = () => props.revisions.find((revision) => revision.id === fromId()) ?? props.revisions[0]!;
  const to = () => props.revisions.find((revision) => revision.id === toId()) ?? props.revisions[0]!;
  const differences = createMemo(() => configDifferences(from().afterConfig as Record<string, unknown>, to().afterConfig as Record<string, unknown>));
  const pickMenu = (label: string, value: () => string, onPick: (id: string) => void) => (
    <Menu>
      <Menu.Trigger as={FieldButton} class="ps-field-220" aria-label={label}>
        {(() => {
          const revision = props.revisions.find((entry) => entry.id === value());
          return revision ? `Revision ${number(revision)} · ${dateTime(revision.createdAt)}` : "Pick a revision";
        })()}
      </Menu.Trigger>
      <Menu.Content label={label} width={300}>
        <For each={props.revisions}>
          {(revision, index) => (
            <Menu.Item
              description={revision.changedKeys.map(changedKeyLabel).join(", ") || undefined}
              hint={revision.id === value() ? <Check size={14} /> : undefined}
              onSelect={() => onPick(revision.id)}
            >
              Revision {props.revisions.length - index()} · {dateTime(revision.createdAt)}
              {index() === 0 ? " (current)" : ""}
            </Menu.Item>
          )}
        </For>
      </Menu.Content>
    </Menu>
  );
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()} title="Compare revisions" width={860}>
      <div class="ag-compare-pick">
        {pickMenu("Compare from", fromId, setFromId)}
        <span class="ps-muted-line">to</span>
        {pickMenu("Compare to", toId, setToId)}
      </div>
      <Show when={differences().length > 0} fallback={<p class="ps-list-note">{fromId() === toId() ? "Pick two different revisions." : "These two revisions saved the same settings."}</p>}>
        <div class="ag-compare-wrap">
          <table class="ag-compare">
            <thead>
              <tr>
                <th scope="col">Setting</th>
                <th scope="col">Revision {number(from())}</th>
                <th scope="col">Revision {number(to())}</th>
              </tr>
            </thead>
            <tbody>
              <For each={differences()}>
                {(difference) => (
                  <tr>
                    <td class="mono">{difference.path}</td>
                    <td class="mono ag-compare-before">{configValueText(difference.before)}</td>
                    <td class="mono ag-compare-after">{configValueText(difference.after)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </Dialog>
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
