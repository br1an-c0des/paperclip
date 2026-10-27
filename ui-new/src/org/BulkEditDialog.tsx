import type { Agent, AiConnectionList } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ArrowRight, Check } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { aiConnectionsApi } from "@/api/ai-connections";
import { adapterModelKeyOptions, agentsApi } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { FieldButton, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import {
  agentConnection,
  agentDefaultModel,
  alreadyApplied,
  catalogPlan,
  changesAgent,
  commonModels,
  connectionChoices,
  connectionName,
  mapBulk,
  modelProblems,
  providerForHarness,
  resolveConnection,
  runtimePatch,
  sameBinding,
  type BulkChange,
  type ModelCatalog,
} from "./bulk-model";

/*
 * Edit connection and model for the selected agents of one harness, as upstream's roster bulk edit
 * does it (ui/src/components/agents/AgentBulkSettingsSheet.tsx): tick what to change, pick the
 * connection (the responsible user's or a company-shared one) and the default model from what every
 * agent's connection allows, review the changes, then save one `runtimeSettings` patch per agent.
 * Agents that fail keep their row with the reason; Retry re-reads each one first so a save that
 * landed without an answer isn't sent twice.
 */

type Failure = { agent: Agent; message: string };
type Catalog = ModelCatalog & { accounts: AiConnectionList };

export function BulkEditDialog(props: {
  harness: string;
  /** The harness as the agent page names it ("Claude Code"). */
  harnessLabel: string;
  agents: Agent[];
  /** How many agents are selected in all, so the dialog can say how many it leaves alone. */
  totalSelected: number;
  onClose: (updatedIds: string[]) => void;
}) {
  const company = useCompany();
  const client = useQueryClient();
  const label = () => props.harnessLabel;
  const provider = () => providerForHarness(props.harness);

  const [changeConnection, setChangeConnection] = createSignal(false);
  const [changeModel, setChangeModel] = createSignal(false);
  const [choiceId, setChoiceId] = createSignal<string | null>(null);
  const [model, setModel] = createSignal("");
  const [custom, setCustom] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [failures, setFailures] = createSignal<Failure[] | null>(null);
  const [updated, setUpdated] = createSignal<string[]>([]);

  const targets = () => failures()?.map((failure) => failure.agent) ?? props.agents;

  // The connection list for the first agent drives the picker; each agent's own list is checked below.
  const accounts = createQuery(() => ({
    queryKey: [...queryKeys.aiConnections.list(company().id), "agent", props.agents[0]?.id ?? ""] as const,
    queryFn: () => aiConnectionsApi.list(company().id, props.agents[0]!.id),
    enabled: props.agents.length > 0 && provider() !== undefined,
    retry: false,
  }));
  const choices = createMemo(() => (provider() ? connectionChoices(accounts.data, provider()!) : []));
  const binding = () => (changeConnection() ? choices().find((choice) => choice.id === choiceId())?.binding : undefined);
  const chosenModel = () => (changeModel() ? custom().trim() || model() || undefined : undefined);
  const change = (): BulkChange => ({ binding: binding(), model: chosenModel() });
  const missing = () => (!changeConnection() && !changeModel()) || (changeConnection() && !binding()) || (changeModel() && !chosenModel());

  const catalogs = createQuery(() => {
    const ids = targets().map((agent) => agent.id);
    const chosen = binding();
    return {
      queryKey: queryKeys.org.bulkCatalog(company().id, ids, chosen ? JSON.stringify(chosen) : null),
      retry: false,
      staleTime: 60_000,
      queryFn: async () => {
        // Each part is the request other screens make, under its own key: agents with the same
        // catalog share one fetch, and a catalog another screen loaded is reused.
        const companyId = company().id;
        const results = await mapBulk(targets(), async (agent): Promise<Catalog> => {
          const list = await client.fetchQuery({
            queryKey: [...queryKeys.aiConnections.list(companyId), "agent", agent.id],
            queryFn: () => aiConnectionsApi.list(companyId, agent.id),
            staleTime: 60_000,
          });
          const current = agentConnection(agent);
          const effective = chosen ?? (current?.mode !== "router" ? current : undefined);
          const routing = resolveConnection(effective, list)?.routing;
          const plan = catalogPlan({ harness: props.harness, binding: effective, routing, agent });
          if (plan.kind === "fixed") return { agentId: agent.id, models: plan.models, restricted: true, accounts: list };
          const options = plan.options;
          let models = await client.fetchQuery({
            queryKey: queryKeys.agents.adapterModels(companyId, plan.type, adapterModelKeyOptions(options)),
            queryFn: () => agentsApi.adapterModels(companyId, plan.type, options),
            staleTime: 60_000,
          });
          if (plan.stripOpenRouter) models = models.map((entry) => ({ ...entry, id: entry.id.replace(/^openrouter\//, "") }));
          return { agentId: agent.id, models, restricted: plan.restricted, accounts: list };
        });
        return results.map((result, index) =>
          result.status === "fulfilled"
            ? result.value
            : { agentId: targets()[index]!.id, error: result.reason instanceof Error ? result.reason.message : "Couldn't load connections or models" },
        );
      },
    };
  });
  const loaded = createMemo(() => (catalogs.data ?? []).filter((entry): entry is Catalog => !("error" in entry)));
  const loadErrors = createMemo(() => (catalogs.data ?? []).filter((entry): entry is { agentId: string; error: string } => "error" in entry));
  const available = createMemo(() => commonModels(loaded()));

  const changed = createMemo(() => (missing() ? [] : targets().filter((agent) => changesAgent(agent, change()))));
  const problems = createMemo(() => {
    if (missing()) return [];
    const list = modelProblems(targets(), loaded(), change());
    const chosen = binding();
    if (chosen && chosen.mode === "shared") {
      for (const agent of targets()) {
        const accountsFor = loaded().find((entry) => entry.agentId === agent.id)?.accounts;
        if (accountsFor && !resolveConnection(chosen, accountsFor))
          list.push({ agentId: agent.id, name: agent.name, message: "This connection isn't available to this agent." });
      }
    }
    return list;
  });
  const nameOf = (agentId: string) => targets().find((agent) => agent.id === agentId)?.name ?? "An agent";
  const accountsOf = (agentId: string) => loaded().find((entry) => entry.agentId === agentId)?.accounts;

  const canSave = () =>
    !saving() &&
    !missing() &&
    !catalogs.isFetching &&
    !catalogs.error &&
    loadErrors().length === 0 &&
    loaded().length === targets().length &&
    problems().length === 0 &&
    changed().length > 0;

  const currentConnections = () => [...new Set(props.agents.map((agent) => connectionName(agentConnection(agent), accountsOf(agent.id) ?? accounts.data)))];
  const currentModels = () => [...new Set(props.agents.map((agent) => agentDefaultModel(agent) ?? "Harness default"))];
  const others = () => props.totalSelected - props.agents.length;

  const close = () => {
    if (!saving()) props.onClose(updated());
  };

  async function save() {
    if (!canSave()) return;
    setSaving(true);
    const retrying = failures() !== null;
    const next = change();
    const list = changed();
    const results = await mapBulk(list, async (agent) => {
      // A lost response may hide a save that landed: re-read before sending again.
      if (retrying) {
        const latest = await agentsApi.get(agent.id, company().id);
        if (alreadyApplied(latest, props.harness, next)) return latest;
      }
      return agentsApi.updateRuntimeSettings(agent.id, runtimePatch(agent, next)!, company().id);
    });
    const successes: Agent[] = [];
    const nextFailures: Failure[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") successes.push(result.value);
      else nextFailures.push({ agent: list[index]!, message: result.reason instanceof Error ? result.reason.message : "Couldn't save this agent. Try again." });
    });
    const allUpdated = [...updated(), ...successes.map((agent) => agent.id)];
    setUpdated(allUpdated);
    client.setQueryData<Agent[]>(queryKeys.agents.list(company().id), (current) =>
      current?.map((agent) => successes.find((saved) => saved.id === agent.id) ?? agent),
    );
    for (const agent of successes) void client.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
    void client.invalidateQueries({ queryKey: queryKeys.agents.list(company().id) });
    setSaving(false);
    if (nextFailures.length > 0) setFailures(nextFailures);
    else props.onClose(allUpdated);
  }

  const count = (n: number) => `${n} ${n === 1 ? "agent" : "agents"}`;
  const modelLabel = (id: string) => available().models.find((entry) => entry.id === id)?.label ?? id;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && close()}
      width={560}
      title={`Update ${count(props.agents.length)} on ${label()}`}
      description={others() > 0 ? `${count(others())} also selected won't change: they run on another harness.` : "Change their connection, default model, or both."}
      hideClose={saving()}
      footer={
        <div class="org-dialog-foot">
          <Button variant="quiet" onClick={close} disabled={saving()}>
            {failures() ? "Close" : "Cancel"}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!canSave()}>
            {saving() ? "Updating…" : failures() ? `Retry ${count(failures()!.length)}` : `Update ${count(changed().length || props.agents.length)}`}
          </Button>
        </div>
      }
    >
      <div class="org-bulk">
        <div class="org-bulk-agents" aria-label="Agents to update">
          <For each={props.agents}>
            {(agent) => (
              <span class="org-chip">
                <AgentAvatar agent={agent} size={20} />
                {agent.name}
              </span>
            )}
          </For>
        </div>

        <Show when={failures()}>
          {(list) => (
            <div role="alert" class="org-bulk-alert">
              <p class="org-strong">
                {updated().length} updated · {list().length} couldn't be saved
              </p>
              <For each={list()}>
                {(failure) => (
                  <p>
                    {failure.agent.name}: {failure.message}
                  </p>
                )}
              </For>
              <p class="org-muted">Retry updates only these agents. Close and reopen to review their settings.</p>
            </div>
          )}
        </Show>

        <fieldset class="org-bulk-fields" disabled={saving() || failures() !== null}>
          <section class="org-bulk-section">
            <label class="org-tick">
              <input type="checkbox" checked={changeConnection()} disabled={!provider()} onChange={(event) => setChangeConnection(event.currentTarget.checked)} />
              <span>
                <span class="org-strong">Change connection</span>
                <span class="org-muted">
                  {provider() ? `Now: ${currentConnections().length === 1 ? currentConnections()[0] : `${currentConnections().length} different connections`}` : `${label()} doesn't use a Paperclip connection`}
                </span>
              </span>
            </label>
            <Show when={changeConnection()}>
              <div class="org-options" role="radiogroup" aria-label="Connection">
                <Show when={!accounts.isPending} fallback={<p class="org-muted">Loading connections…</p>}>
                  <For each={choices()}>
                    {(choice) => (
                      <button
                        type="button"
                        role="radio"
                        class="org-option"
                        aria-checked={choiceId() === choice.id}
                        disabled={choice.disabled}
                        onClick={() => setChoiceId(choice.id)}
                      >
                        <span class="org-radio" aria-hidden="true" />
                        <span>
                          <span class="org-strong">{choice.name}</span>
                          <span class="org-muted">{choice.description}</span>
                        </span>
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </section>

          <section class="org-bulk-section">
            <label class="org-tick">
              <input type="checkbox" checked={changeModel()} onChange={(event) => setChangeModel(event.currentTarget.checked)} />
              <span>
                <span class="org-strong">Change default model</span>
                <span class="org-muted">Now: {currentModels().length === 1 ? currentModels()[0] : `${currentModels().length} different models`}</span>
              </span>
            </label>
            <Show when={changeModel()}>
              <div class="org-bulk-model">
                <Menu>
                  <Menu.Trigger as={FieldButton} aria-label="Default model">
                    {model() ? modelLabel(model()) : catalogs.isFetching ? "Loading models…" : "Choose a model"}
                  </Menu.Trigger>
                  <Menu.Content label="Models" width={320}>
                    <For each={available().models} fallback={<p class="org-muted org-pad">No models in common.</p>}>
                      {(entry) => (
                        <Menu.Item
                          onSelect={() => {
                            setModel(entry.id);
                            setCustom("");
                          }}
                          hint={model() === entry.id ? <Check size={14} aria-hidden="true" /> : undefined}
                          description={entry.label !== entry.id ? <span class="mono">{entry.id}</span> : undefined}
                        >
                          {entry.label}
                        </Menu.Item>
                      )}
                    </For>
                  </Menu.Content>
                </Menu>
                <Show when={available().allowCustom}>
                  <TextInput
                    class="mono"
                    placeholder="Or type a model ID"
                    aria-label="Model ID"
                    value={custom()}
                    onInput={(event) => setCustom(event.currentTarget.value)}
                  />
                </Show>
                <p class="org-muted">
                  {available().allowCustom
                    ? "Pick a suggested model or type one your harness supports."
                    : `Only models every agent's ${changeConnection() ? "new" : "current"} connection offers.`}
                </p>
              </div>
            </Show>
          </section>
        </fieldset>

        <Show when={catalogs.isFetching}>
          <p role="status" class="org-muted">
            Checking connections and models…
          </p>
        </Show>
        <Show when={catalogs.error || loadErrors().length > 0}>
          <div role="alert" class="org-bulk-alert">
            <Show when={catalogs.error}>{(error) => <p>{error().message}</p>}</Show>
            <For each={loadErrors()}>
              {(entry) => (
                <p>
                  {nameOf(entry.agentId)}: {entry.error}
                </p>
              )}
            </For>
            <Button size="compact" onClick={() => void catalogs.refetch()}>
              Try again
            </Button>
          </div>
        </Show>
        <Show when={problems().length > 0}>
          <div role="alert" class="org-bulk-alert">
            <For each={problems()}>
              {(problem) => (
                <p>
                  <span class="org-strong">{problem.name}:</span> {problem.message}
                </p>
              )}
            </For>
          </div>
        </Show>

        <Show when={!missing()}>
          <Show when={changed().length > 0} fallback={<p class="org-muted">All of these agents already have these settings.</p>}>
            <section class="org-bulk-preview" aria-label="Changes to apply">
              <h3 class="org-cap">Changes to apply</h3>
              <For each={changed()}>
                {(agent) => (
                  <div class="org-bulk-change">
                    <span class="org-strong">{agent.name}</span>
                    <Show when={binding() && !sameBinding(binding(), agentConnection(agent))}>
                      <span class="org-muted org-arrow">
                        {connectionName(agentConnection(agent), accountsOf(agent.id))}
                        <ArrowRight size={12} aria-label="to" />
                        <span class="org-text">{connectionName(binding(), accountsOf(agent.id))}</span>
                      </span>
                    </Show>
                    <Show when={chosenModel() && chosenModel() !== agentDefaultModel(agent)}>
                      <span class="org-muted org-arrow mono">
                        {agentDefaultModel(agent) ?? "Harness default"}
                        <ArrowRight size={12} aria-label="to" />
                        <span class="org-text">{chosenModel()}</span>
                      </span>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={targets().length > changed().length}>
                <p class="org-muted">{count(targets().length - changed().length)} already have these settings.</p>
              </Show>
            </section>
          </Show>
        </Show>

        <p class="org-muted org-small">
          Applies to future runs; running work keeps its settings, and task-specific model overrides stay. A model change may start a fresh session, and existing
          sessions may keep their connection until they're reset.
        </p>
      </div>
    </Dialog>
  );
}
