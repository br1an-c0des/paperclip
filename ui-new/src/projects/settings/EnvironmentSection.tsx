import type { Project } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, KeyRound, Plus, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { queryKeys } from "@/api/queryKeys";
import { secretsApi } from "@/api/secrets";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { FieldButton, SettingsCard, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";
import { pushToast } from "@/ui/Toast";
import { envDirty, envFromRows, envProblem, envRows, newEnvRow, type EnvRow, type EnvRowKind } from "./settings-model";
import { CardNote, failure, FootError, useProjectSaver } from "./shared";

/*
 * Environment (board 10, `section` = environment): the variables every run in the project gets
 * (`env`, as the old UI's environment variables editor saves it). A value is plain text, one of the
 * company's secrets, or a personal secret each person sets for themselves. Secret values are never
 * shown; a new secret can be created here and is stored on the server. Saving is explicit.
 *
 * Where runs execute is set per agent or for the instance; a project only picks an environment for
 * its separate task checkouts (Code and workspaces).
 */

const KIND_LABEL: Record<EnvRowKind, string> = { text: "Text", secret: "Secret", user_secret: "Personal secret" };

export function EnvironmentSection(props: { project: Project; base: string }) {
  const company = useCompany();
  const client = useQueryClient();
  const saver = useProjectSaver(() => props.project);
  const [rows, setRows] = createStore<EnvRow[]>(envRows(props.project.env));
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
  const dirty = () => envDirty(props.project.env, rows);
  // Follows the saved variables when they change elsewhere, unless you're editing.
  createEffect(
    on(
      () => JSON.stringify(props.project.env ?? null),
      () => {
        if (!dirty()) setRows(reconcile(envRows(props.project.env)));
      },
      { defer: true },
    ),
  );

  const update = (id: string, change: (row: EnvRow) => void) => {
    setProblem(null);
    setRows((row) => row.id === id, produce(change));
  };
  const save = async () => {
    const found = envProblem(rows);
    if (found) return setProblem(found);
    setProblem(null);
    if (await saver.save({ env: envFromRows(rows) })) {
      setRows(reconcile(envRows(envFromRows(rows))));
      pushToast({ tone: "success", title: "Saved the environment variables" });
    }
  };
  const secretName = (id: string) => (secrets.data ?? []).find((secret) => secret.id === id)?.name ?? (id ? "A secret you can't see" : "Pick a secret");
  const definitionName = (key: string) => (definitions.data ?? []).find((definition) => definition.key === key)?.name ?? (key || "Pick a personal secret");

  return (
    <>
      <SettingsCard
        title="Environment variables"
        description={
          <CardNote state={saver.state()} error={saver.error()}>
            Set for every run in this project. Secret values are never shown here.
          </CardNote>
        }
        footer={
          <>
            <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setRows(rows.length, newEnvRow())}>
              Add variable
            </Button>
            <NewSecret
              onCreated={(secret) => {
                void client.invalidateQueries({ queryKey: queryKeys.projectSettings.secrets(company().id) });
                const name = secret.name.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");
                setRows(rows.length, { ...newEnvRow("secret"), name, secretId: secret.id });
              }}
            />
            <Show when={dirty()}>
              <span class="ps-foot-end">
                <FootError message={problem()} />
                <Button size="compact" variant="quiet" onClick={() => setRows(reconcile(envRows(props.project.env)))}>
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
                    <TextInput class="mono" aria-label={`Value of ${row.name || "the variable"}`} spellcheck={false} autocomplete="off" value={row.value} onInput={(event) => update(row.id, (draft) => void (draft.value = event.currentTarget.value))} />
                  </Show>
                  <Show when={row.kind === "secret"}>
                    <Menu>
                      <Menu.Trigger as={FieldButton} class="ps-env-secret" icon={<KeyRound size={13} aria-hidden="true" />} aria-label={`Secret for ${row.name || "the variable"}`}>
                        {secretName(row.secretId)}
                      </Menu.Trigger>
                      <Menu.Content label="Company secrets" width={300}>
                        <For each={activeSecrets()} fallback={<p class="nt-menu-note">The company has no secrets yet. Create one with New secret.</p>}>
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

      <SettingsCard title="Execution environment" description="Where agents run this project's work.">
        <p class="ps-list-note">
          Runs use the environment their agent is set to, or the instance's default. A project picks one only for separate task checkouts, under{" "}
          <A class="ps-link" href={`${props.base}/code`}>
            Code and workspaces
          </A>
          .
        </p>
      </SettingsCard>
    </>
  );
}

/** Creates a company secret and hands it back, so a variable can point to it. */
export function NewSecret(props: { onCreated: (secret: { id: string; name: string }) => void }) {
  const company = useCompany();
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal("");
  const [value, setValue] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const create = async (event: Event) => {
    event.preventDefault();
    if (!name().trim() || !value()) return setProblem("Give the secret a name and a value.");
    setBusy(true);
    setProblem(null);
    try {
      const secret = await secretsApi.create(company().id, { name: name().trim(), value: value() });
      props.onCreated(secret);
      setName("");
      setValue("");
      setOpen(false);
      pushToast({ tone: "success", title: `Created the secret ${secret.name}`, body: "Save the variables to use it." });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't create the secret."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover open={open()} onOpenChange={setOpen} placement="top-start">
      <Popover.Trigger class="btn btn--secondary btn--compact">
        <KeyRound size={14} aria-hidden="true" />
        New secret
      </Popover.Trigger>
      <Popover.Content title="New secret" width={340}>
        <form class="ps-popover-form" onSubmit={(event) => void create(event)}>
          <label class="ps-form-field">
            <span class="field-label">Name</span>
            <TextInput value={name()} placeholder="hyperliquid-api-key" autocomplete="off" onInput={(event) => setName(event.currentTarget.value)} autofocus />
          </label>
          <label class="ps-form-field">
            <span class="field-label">Value</span>
            <TextInput type="password" value={value()} autocomplete="new-password" onInput={(event) => setValue(event.currentTarget.value)} />
          </label>
          <p class="fhelp">Stored encrypted on the server for the whole company. It isn't shown again.</p>
          <div class="ps-form-foot">
            <Show when={problem()}>
              <span class="nt-error" role="alert">
                {problem()}
              </span>
            </Show>
            <Button size="compact" variant="primary" type="submit" disabled={busy()}>
              {busy() ? "Creating…" : "Create secret"}
            </Button>
          </div>
        </form>
      </Popover.Content>
    </Popover>
  );
}
