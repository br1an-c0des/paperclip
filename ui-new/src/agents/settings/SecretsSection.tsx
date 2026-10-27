import type { AgentDetail, AgentEnvConfig } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { Check, KeyRound, Plus, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { queryKeys } from "@/api/queryKeys";
import { secretsApi } from "@/api/secrets";
import { envDirty, envFromRows, envProblem, envRows, newEnvRow, type EnvRow, type EnvRowKind } from "@/projects/settings/settings-model";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsCard, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { CardNote, FootError, SectionTitle, useAgentSaver } from "../shared";

/*
 * Secrets and variables (board 30's outline): the environment variables the agent's runs get
 * (`adapterConfig.env`), in the same editor as a project's: plain text, one of the company's
 * secrets by reference, or a personal secret each person sets. Values of secrets are never shown,
 * and the server keeps any value it sent back redacted. Saving is explicit and replaces the
 * variables as a set.
 *
 * Creating a company secret lives in the project settings and company settings; here a variable
 * picks an existing one.
 */

const KIND_LABEL: Record<EnvRowKind, string> = { text: "Text", secret: "Secret", user_secret: "Personal secret" };

export function SecretsSection(props: { agent: AgentDetail }) {
  const company = useCompany();
  const saver = useAgentSaver(() => props.agent);
  const env = () => ((props.agent.adapterConfig as Record<string, unknown>).env ?? null) as AgentEnvConfig | null;
  const [rows, setRows] = createStore<EnvRow[]>(envRows(env()));
  const [problem, setProblem] = createSignal<string | null>(null);
  const secrets = createQuery(() => ({
    queryKey: queryKeys.projectSettings.secrets(company().id),
    queryFn: ({ signal }) => secretsApi.list(company().id, signal),
  }));
  const definitions = createQuery(() => ({
    queryKey: queryKeys.projectSettings.userSecretDefinitions(company().id),
    queryFn: ({ signal }) => secretsApi.userDefinitions(company().id, signal),
    retry: false,
  }));
  const activeSecrets = createMemo(() => (secrets.data ?? []).filter((secret) => secret.status === "active" && secret.scope === "company"));
  const dirty = () => envDirty(env(), rows);
  createEffect(on(() => JSON.stringify(env()), () => !dirty() && setRows(reconcile(envRows(env()))), { defer: true }));

  const update = (id: string, change: (row: EnvRow) => void) => {
    setProblem(null);
    setRows((row) => row.id === id, produce(change));
  };
  const save = async () => {
    const found = envProblem(rows);
    if (found) return setProblem(found);
    setProblem(null);
    const next = envFromRows(rows);
    if (await saver.save({ adapterConfig: { env: next } })) {
      setRows(reconcile(envRows(next)));
      pushToast({ tone: "success", title: "Saved the variables" });
    }
  };
  const secretName = (id: string) => (secrets.data ?? []).find((secret) => secret.id === id)?.name ?? (id ? "A secret you can't see" : "Pick a secret");
  const definitionName = (key: string) => (definitions.data ?? []).find((definition) => definition.key === key)?.name ?? (key || "Pick a personal secret");

  return (
    <>
      <SectionTitle title="Secrets and variables">Values {props.agent.name}'s runs receive as environment variables.</SectionTitle>
      <SettingsCard
        title="Variables"
        description={
          <CardNote state={saver.state()} error={saver.error()}>
            Set for every run of this agent, on top of the project's. Secret values are never shown here.
          </CardNote>
        }
        footer={
          <>
            <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setRows(rows.length, newEnvRow())}>
              Add variable
            </Button>
            <Show when={dirty()}>
              <span class="ps-foot-end">
                <FootError message={problem()} />
                <Button size="compact" variant="quiet" onClick={() => setRows(reconcile(envRows(env())))}>
                  Discard
                </Button>
                <Button size="compact" variant="primary" disabled={saver.state() === "saving"} onClick={() => void save()}>
                  {saver.state() === "saving" ? "Saving…" : "Save variables"}
                </Button>
              </span>
            </Show>
          </>
        }
      >
        <div class="ps-env">
          <div class="ps-env-head" aria-hidden="true">
            <span>Name</span>
            <span>Value</span>
            <span />
          </div>
          <For each={rows} fallback={<p class="ps-list-note">No variables yet.</p>}>
            {(row) => (
              <div class="ps-env-row">
                <TextInput
                  class="mono"
                  aria-label="Variable name"
                  placeholder="NAME"
                  spellcheck={false}
                  autocomplete="off"
                  value={row.name}
                  onInput={(event) => update(row.id, (draft) => void (draft.name = event.currentTarget.value))}
                />
                <div class="ps-env-value">
                  <Menu>
                    <Menu.Trigger as={FieldButton} class="ps-env-kind" aria-label={`${row.name || "Variable"} is ${KIND_LABEL[row.kind]}`}>
                      {KIND_LABEL[row.kind]}
                    </Menu.Trigger>
                    <Menu.Content label="Value type" width={240}>
                      <For each={["text", "secret", "user_secret"] as EnvRowKind[]}>
                        {(kind) => (
                          <Menu.Item
                            onSelect={() => update(row.id, (draft) => void (draft.kind = kind))}
                            description={kind === "text" ? "Shown here and in run logs" : kind === "secret" ? "One of the company's secrets" : "Each person sets their own value"}
                            hint={row.kind === kind ? <Check size={14} /> : undefined}
                          >
                            {KIND_LABEL[kind]}
                          </Menu.Item>
                        )}
                      </For>
                    </Menu.Content>
                  </Menu>
                  <Show when={row.kind === "text"}>
                    <TextInput
                      class="mono"
                      aria-label={`Value of ${row.name || "the variable"}`}
                      spellcheck={false}
                      autocomplete="off"
                      value={row.value}
                      onInput={(event) => update(row.id, (draft) => void (draft.value = event.currentTarget.value))}
                    />
                  </Show>
                  <Show when={row.kind === "secret"}>
                    <Menu>
                      <Menu.Trigger as={FieldButton} class="ps-env-secret" icon={<KeyRound size={13} aria-hidden="true" />} aria-label={`Secret for ${row.name || "the variable"}`}>
                        {secretName(row.secretId)}
                      </Menu.Trigger>
                      <Menu.Content label="Company secrets" width={300}>
                        <For each={activeSecrets()} fallback={<p class="nt-menu-note">The company has no secrets yet. Add one in company settings.</p>}>
                          {(secret) => (
                            <Menu.Item onSelect={() => update(row.id, (draft) => void (draft.secretId = secret.id))} hint={row.secretId === secret.id ? <Check size={14} /> : undefined}>
                              {secret.name}
                            </Menu.Item>
                          )}
                        </For>
                      </Menu.Content>
                    </Menu>
                  </Show>
                  <Show when={row.kind === "user_secret"}>
                    <Menu>
                      <Menu.Trigger as={FieldButton} class="ps-env-secret" icon={<KeyRound size={13} aria-hidden="true" />} aria-label={`Personal secret for ${row.name || "the variable"}`}>
                        {definitionName(row.userKey)}
                      </Menu.Trigger>
                      <Menu.Content label="Personal secrets" width={300}>
                        <For each={definitions.data ?? []} fallback={<p class="nt-menu-note">The company has no personal secrets defined.</p>}>
                          {(definition) => (
                            <Menu.Item onSelect={() => update(row.id, (draft) => void (draft.userKey = definition.key))} description={definition.key} hint={row.userKey === definition.key ? <Check size={14} /> : undefined}>
                              {definition.name}
                            </Menu.Item>
                          )}
                        </For>
                        <Menu.Separator />
                        <Menu.CheckboxItem checked={row.required} onChange={(value) => update(row.id, (draft) => void (draft.required = value))} description="Runs wait until the person has set it">
                          Required
                        </Menu.CheckboxItem>
                      </Menu.Content>
                    </Menu>
                  </Show>
                </div>
                <button
                  type="button"
                  class="nt-icon nt-icon--small"
                  aria-label={`Remove ${row.name || "the variable"}`}
                  onClick={() => {
                    setProblem(null);
                    setRows((list) => list.filter((entry) => entry.id !== row.id));
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            )}
          </For>
          <Show when={!dirty()}>
            <FootError message={problem()} />
          </Show>
        </div>
      </SettingsCard>
    </>
  );
}
