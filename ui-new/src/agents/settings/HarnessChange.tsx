import type { AgentDetail } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check } from "lucide-solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { agentsApi, type AdapterInfo } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { agentConnection, providerForHarness } from "@/org/bulk-model";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { FieldButton, SettingsRow } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { harnessType, runnerCapable, runtimeIdentity } from "../agent-model";
import { harnessChangeChoices, harnessChangePatch } from "../harness-model";
import { failure, refreshAgent } from "../shared";
import { ModelMenu } from "./fields";

/*
 * Changing an agent's harness (the old form's Harness dropdown on an existing agent): pick the new
 * harness and its model, and save at once as a new revision. The instructions, variables, prompt
 * and timeouts carry over; the old harness's own settings, model and effort don't. The AI
 * connection stays when it's for the same provider. Harnesses the Paperclip Runner can carry take
 * the server's recommended runner.
 */

export function HarnessChangeDialog(props: { agent: AgentDetail; adapters: readonly AdapterInfo[] | undefined; onClose: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const current = () => runtimeIdentity(props.agent);
  const choices = createMemo(() => harnessChangeChoices(props.adapters, harnessType(props.agent.adapterType, props.agent.adapterConfig as Record<string, unknown>)));
  const [next, setNext] = createSignal<string | null>(null);
  const [model, setModel] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const models = createQuery(() => ({
    queryKey: queryKeys.agents.adapterModels(company().id, next() ?? "none"),
    queryFn: () => agentsApi.adapterModels(company().id, next()!),
    enabled: !!next(),
    staleTime: 5 * 60_000,
    retry: false,
  }));
  const connection = () => agentConnection(props.agent);
  const keepConnection = () => {
    const binding = connection();
    if (!binding || binding.mode === "router" || !next()) return false;
    return providerForHarness(next()!) === binding.provider;
  };
  const label = (type: string | null) => choices().find((choice) => choice.type === type)?.label ?? "Pick a harness";

  const save = async () => {
    const target = next();
    if (!target) return setProblem("Pick the new harness.");
    setBusy(true);
    setProblem(null);
    try {
      const saved = await agentsApi.update(props.agent.id, harnessChangePatch(props.agent, target, model(), keepConnection()), company().id);
      await Promise.all([
        refreshAgent(client, company().id, props.agent.id),
        client.invalidateQueries({ queryKey: queryKeys.agents.adapters(company().id, props.agent.defaultEnvironmentId ?? null) }),
      ]);
      const warnings = saved.configurationWarnings ?? [];
      pushToast({
        tone: warnings.length ? "warn" : "success",
        title: `${props.agent.name} now runs in ${label(target)}`,
        body: warnings.length ? warnings.map((warning) => warning.message).join(" ") : "Test the environment to check it can start.",
      });
      props.onClose();
    } catch (caught) {
      setProblem(failure(caught, "Couldn't change the harness."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy() && props.onClose()}
      title={`Change ${props.agent.name}'s harness`}
      description={`It runs in ${current().label} now. The change is saved at once, as a new revision you can roll back.`}
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
          <Button variant="primary" disabled={busy() || !next()} onClick={() => void save()}>
            {busy() ? "Changing…" : "Change harness"}
          </Button>
        </>
      }
    >
      <div class="settings-rows">
        <SettingsRow label="New harness">
          <Menu>
            <Menu.Trigger as={FieldButton} class="ps-field-240" aria-label={`New harness: ${label(next())}`}>
              {label(next())}
            </Menu.Trigger>
            <Menu.Content label="New harness" width={260}>
              <For each={choices()} fallback={<p class="nt-menu-note">No other harness is turned on.</p>}>
                {(choice) => (
                  <Menu.Item
                    hint={choice.type === next() ? <Check size={14} /> : undefined}
                    onSelect={() => {
                      setNext(choice.type);
                      setModel("");
                    }}
                  >
                    {choice.label}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
        </SettingsRow>
        <Show when={next()}>
          <SettingsRow label="Model">
            <ModelMenu models={models.data} loading={models.isLoading} value={model()} onChange={setModel} allowDefault />
          </SettingsRow>
        </Show>
      </div>
      <ul class="ag-change-notes">
        <li>Instructions, variables, the prompt template and run limits carry over.</li>
        <li>The model, thinking effort and {current().harnessLabel}'s own settings don't.</li>
        <Show when={connection() && next()}>
          <li>{keepConnection() ? "Its AI connection stays." : "Its AI connection is for another provider, so it's removed. Pick one under Sign-in afterwards."}</li>
        </Show>
        <Show when={next() && runnerCapable(next()!)}>
          <li>Paperclip picks the runner it recommends for this harness.</li>
        </Show>
      </ul>
    </Dialog>
  );
}
