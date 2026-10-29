import type { CompanySecret, UserSecretDefinition } from "@paperclipai/shared";
import { Check, KeyRound, Plus, X } from "lucide-solid";
import { For, Show } from "solid-js";
import { produce, type SetStoreFunction } from "solid-js/store";
import { newEnvRow, type EnvRow, type EnvRowKind } from "@/projects/settings/settings-model";
import { Button } from "@/ui/Button";
import { FieldButton, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";

/*
 * Variables an environment injects into the runs it hosts, in the project settings' editor rows
 * (projects/settings/EnvironmentSection.tsx, whose row model this reuses): plain text, one of the
 * company's secrets, or a personal secret each person sets. The caller owns the rows and saves them.
 *
 * `secretNames` names secrets the company's list can't show: environments are instance-wide, so a
 * variable may point at another organization's secret (`GET /environments/:id/secret-refs`).
 */

const KIND_LABEL: Record<EnvRowKind, string> = { text: "Text", secret: "Secret", user_secret: "Personal secret" };

export function EnvVarsEditor(props: {
  rows: EnvRow[];
  setRows: SetStoreFunction<EnvRow[]>;
  secrets: readonly CompanySecret[];
  definitions: readonly UserSecretDefinition[];
  secretNames?: Record<string, string>;
  onEdit?: () => void;
}) {
  const active = () => props.secrets.filter((secret) => secret.status === "active" && secret.scope === "company");
  const update = (id: string, change: (row: EnvRow) => void) => {
    props.onEdit?.();
    props.setRows((row) => row.id === id, produce(change));
  };
  const secretName = (id: string) =>
    props.secrets.find((secret) => secret.id === id)?.name ?? props.secretNames?.[id] ?? (id ? "A secret you can't see" : "Pick a secret");
  const definitionName = (key: string) => props.definitions.find((definition) => definition.key === key)?.name ?? (key || "Pick a personal secret");

  return (
    <div class="ps-env cs-env">
      <div class="ps-env-head" aria-hidden="true">
        <span>Name</span>
        <span>Value</span>
        <span />
      </div>
      <For each={props.rows} fallback={<p class="ps-list-note">No variables.</p>}>
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
                    <For each={active()} fallback={<p class="nt-menu-note">The company has no secrets yet. Add one under Secrets.</p>}>
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
                    <For each={props.definitions} fallback={<p class="nt-menu-note">The company has no personal secrets defined.</p>}>
                      {(definition) => (
                        <Menu.Item
                          onSelect={() => update(row.id, (draft) => void (draft.userKey = definition.key))}
                          description={definition.key}
                          hint={row.userKey === definition.key ? <Check size={14} /> : undefined}
                        >
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
                props.onEdit?.();
                props.setRows((list) => list.filter((entry) => entry.id !== row.id));
              }}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        )}
      </For>
      <div>
        <Button
          size="compact"
          icon={<Plus size={14} aria-hidden="true" />}
          onClick={() => {
            props.onEdit?.();
            props.setRows(props.rows.length, newEnvRow());
          }}
        >
          Add variable
        </Button>
      </div>
    </div>
  );
}
