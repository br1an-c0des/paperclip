import { useNavigate } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, Sparkles } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { agentsApi, builtInAgentsApi, type BuiltInAgentState } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { FieldButton, SettingsRow, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { harnessLabel } from "./agent-model";
import { budgetCents, provisionHarnesses } from "./built-in-model";
import { NEW_AGENT_HARNESSES } from "./new/new-agent-model";
import { ModelMenu } from "./settings/fields";
import { useBuiltInAgents } from "./settings/BuiltInCard";
import { failure } from "./shared";
import "./BuiltInSetup.css";

/*
 * Setting up a built-in agent (`enableBuiltInAgents`), as the old UI's ConfigureBuiltInAgentModal
 * does it: pick its harness and model, and a monthly budget if you like; Set up provisions it
 * (`POST /companies/:id/built-in-agents/:key/provision`). A company that approves new agents
 * queues it in the Inbox; otherwise it lands on its page, ready or needing setup.
 *
 * `AvailableBuiltIns` lists the built-ins not set up yet, for Manage agents.
 */

export function AvailableBuiltIns() {
  const builtIns = useBuiltInAgents();
  const available = createMemo(() => (builtIns.states() ?? []).filter((state) => state.status === "not_provisioned"));
  const [setting, setSetting] = createSignal<BuiltInAgentState | null>(null);
  return (
    <Show when={available().length > 0}>
      <ul class="ag-builtins-available" aria-label="Built-in agents you can add">
        <For each={available()}>
          {(state) => (
            <li>
              <span class="ag-builtins-mark" aria-hidden="true">
                <Sparkles size={14} />
              </span>
              <span class="ps-list-name">
                <b>{state.definition.displayName}</b>
                <span class="ps-list-meta">{state.definition.shortPurpose}</span>
              </span>
              <Button size="compact" onClick={() => setSetting(state)}>
                Set up
              </Button>
            </li>
          )}
        </For>
      </ul>
      <Show when={setting()}>{(state) => <BuiltInSetupDialog state={state()} onClose={() => setSetting(null)} />}</Show>
    </Show>
  );
}

export function BuiltInSetupDialog(props: { state: BuiltInAgentState; onClose: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const navigate = useNavigate();
  const adapters = createQuery(() => ({
    queryKey: queryKeys.agents.adapters(company().id, null),
    queryFn: ({ signal }) => agentsApi.adapters(company().id, null, signal),
    staleTime: 60_000,
  }));
  const enabled = createMemo(() =>
    NEW_AGENT_HARNESSES.filter((type) => {
      const adapter = adapters.data?.find((entry) => entry.type === type);
      return adapter && adapter.loaded !== false && !adapter.disabled;
    }),
  );
  const harnesses = createMemo(() => provisionHarnesses(props.state, enabled()));
  const [harness, setHarness] = createSignal(props.state.definition.defaultAdapterType ?? "");
  const current = () => (harnesses().includes(harness()) ? harness() : (harnesses()[0] ?? ""));
  const [model, setModel] = createSignal("");
  const [budget, setBudget] = createSignal(
    props.state.definition.defaultBudgetMonthlyCents ? String(props.state.definition.defaultBudgetMonthlyCents / 100) : "",
  );
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const models = createQuery(() => ({
    queryKey: queryKeys.agents.adapterModels(company().id, current()),
    queryFn: () => agentsApi.adapterModels(company().id, current()),
    enabled: !!current(),
    staleTime: 5 * 60_000,
    retry: false,
  }));

  const submit = async () => {
    const cents = budgetCents(budget());
    if (cents === null) return setProblem("The budget must be an amount in dollars, such as 25.");
    if (!current()) return setProblem("Pick a harness.");
    setBusy(true);
    setProblem(null);
    try {
      const result = await builtInAgentsApi.provision(company().id, props.state.definition.key, {
        adapterType: current(),
        adapterConfig: model() ? { model: model() } : {},
        ...(cents !== undefined ? { budgetMonthlyCents: cents } : {}),
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.org.builtInAgents(company().id) }),
        client.invalidateQueries({ queryKey: queryKeys.agents.list(company().id) }),
      ]);
      props.onClose();
      if (result.status === "pending_approval" || result.approval) {
        pushToast({ tone: "success", title: `${props.state.definition.displayName} is waiting for approval`, body: "Approve it in the Inbox." });
      } else {
        pushToast({ tone: "success", title: `Set up ${props.state.definition.displayName}` });
        if (result.agent) navigate(`/${company().issuePrefix}/agents/${result.agent.urlKey ?? result.agent.id}/profile`);
      }
    } catch (caught) {
      setProblem(failure(caught, "Couldn't set it up."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy() && props.onClose()}
      title={`Set up the ${props.state.definition.displayName}`}
      description={props.state.definition.shortPurpose}
      width={560}
      footer={
        <>
          <Show when={problem()}>
            <span class="nt-error" role="alert">
              {problem()}
            </span>
          </Show>
          <Button variant="quiet" disabled={busy()} onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy() || !current()} onClick={() => void submit()}>
            {busy() ? "Setting up…" : "Set up"}
          </Button>
        </>
      }
    >
      <p class="fhelp">It joins the roster marked Built-in. If your organization approves new agents, it waits in the Inbox first.</p>
      <div class="settings-rows">
        <SettingsRow label="Harness">
          <Menu>
            <Menu.Trigger as={FieldButton} class="ps-field-240" aria-label={`Harness: ${current() ? harnessLabel(current()) : "none"}`}>
              {current() ? harnessLabel(current()) : adapters.isLoading ? "Loading…" : "No harness available"}
            </Menu.Trigger>
            <Menu.Content label="Harness" width={240}>
              <For each={harnesses()}>
                {(type) => (
                  <Menu.Item
                    onSelect={() => {
                      setHarness(type);
                      setModel("");
                    }}
                    hint={type === current() ? <Check size={14} /> : undefined}
                  >
                    {harnessLabel(type)}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
        </SettingsRow>
        <SettingsRow label="Model">
          <ModelMenu models={models.data} loading={models.isLoading} value={model()} onChange={setModel} allowDefault />
        </SettingsRow>
        <SettingsRow label="Monthly budget" help="In dollars. Leave empty for no limit." for="bi-budget">
          <TextInput id="bi-budget" class="ag-num" inputmode="decimal" autocomplete="off" value={budget()} onInput={(event) => setBudget(event.currentTarget.value)} />
        </SettingsRow>
      </div>
    </Dialog>
  );
}
