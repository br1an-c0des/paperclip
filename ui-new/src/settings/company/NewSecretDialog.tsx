import type { Agent, CompanySecretProviderConfig, SecretProviderDescriptor, UserSecretDefinition } from "@paperclipai/shared";
import { Building2, ChevronRight, Eye, EyeOff, Folder, Plus, Users, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { secretsApi, type CreateSecretInput, type SecretProviderHealthResponse } from "@/api/secrets";
import { useCompany } from "@/lib/company";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { Menu } from "@/ui/Menu";
import { pushToast } from "@/ui/Toast";
import { grantEach } from "./secret-access";
import {
  awsPathPreview,
  createProblems,
  createStores,
  defaultStore,
  keyFromName,
  parseEnvAssignment,
  secretKeyFromName,
  type CreateForm,
  type SecretRow,
} from "./secrets-model";
import { failure } from "./shared";

/*
 * New secret, in one step (upstream's redesigned dialog, #21225): a name, who provides the value
 * (the organization, or each user), a masked value, the agents that can use it, and where it's
 * stored only when there's a choice. Pasting `NAME=value` into Name fills both. Create stays
 * enabled and says what's missing. A value can instead link a secret that already lives in a vault
 * (an external reference, read at run time).
 *
 * Agents picked here get an environment variable after the secret is saved, one request each; a
 * failed one leaves the secret saved and says so. The new secret then opens in its details.
 *
 * The same dialog edits a secret each user provides: its name, description and instructions (the
 * key can't change).
 */

export type NewSecretTarget = { mode: "new"; prefix: string } | { mode: "edit"; definition: UserSecretDefinition };

const EMPTY_FORM: CreateForm = { providedBy: "company", mode: "managed", name: "", prefix: "", value: "", externalRef: "", key: "", agentIds: [] };

export function NewSecretDialog(props: {
  target: NewSecretTarget | null;
  descriptors: SecretProviderDescriptor[] | undefined;
  configs: CompanySecretProviderConfig[] | undefined;
  health: SecretProviderHealthResponse | undefined;
  agents: Agent[] | undefined;
  onClose: () => void;
  onSaved: (row: SecretRow | null) => Promise<unknown>;
  onManageVaults: () => void;
}) {
  const company = useCompany();
  const [form, setForm] = createStore<CreateForm>({ ...EMPTY_FORM });
  const [description, setDescription] = createSignal("");
  const [guidance, setGuidance] = createSignal("");
  const [version, setVersion] = createSignal("");
  const [keyDirty, setKeyDirty] = createSignal(false);
  const [storeValue, setStoreValue] = createSignal("");
  const [visible, setVisible] = createSignal(false);
  const [more, setMore] = createSignal(false);
  const [attempted, setAttempted] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const editing = () => (props.target?.mode === "edit" ? props.target.definition : null);

  const stores = createMemo(() => createStores(props.descriptors, props.configs, props.health));
  const store = createMemo(() => stores().find((entry) => entry.value === storeValue()) ?? defaultStore(stores(), props.configs));
  const storeLabel = () => store()?.label.replace(" (default)", "") ?? "Paperclip";
  const problems = createMemo(() => createProblems(form, store(), !!editing()));
  const leaf = () => form.name.slice(form.prefix.length);
  const pathPreview = () => (form.providedBy === "company" && form.mode === "managed" ? awsPathPreview(store(), props.health, company().id, form.key.trim() || form.name) : null);
  const activeAgents = createMemo(() => (props.agents ?? []).filter((agent) => agent.status !== "terminated"));
  const picked = createMemo(() => activeAgents().filter((agent) => form.agentIds.includes(agent.id)));

  // Each opening starts afresh, or from the definition it edits.
  createEffect(
    on(
      () => props.target,
      (target) => {
        if (!target) return;
        const definition = target.mode === "edit" ? target.definition : null;
        setForm({ ...EMPTY_FORM, providedBy: definition ? "user" : "company", prefix: target.mode === "new" ? target.prefix : "", name: definition?.name ?? (target.mode === "new" ? target.prefix : ""), key: definition?.key ?? "", agentIds: [] });
        setDescription(definition?.description ?? "");
        setGuidance(definition?.usageGuidance ?? "");
        setVersion("");
        setKeyDirty(!!definition);
        setStoreValue("");
        setVisible(false);
        setMore(false);
        setAttempted(false);
        setError(null);
      },
    ),
  );
  // A store that only takes references (a deployment's HashiCorp Vault, say) links one.
  createEffect(() => {
    const current = store();
    if (current && !current.managed && form.mode === "managed") setForm("mode", "external");
    if (current && !current.external && form.mode === "external") setForm("mode", "managed");
  });

  const autoKey = (name: string, providedBy = form.providedBy) => (providedBy === "user" ? keyFromName(name) : secretKeyFromName(name));
  const setName = (leafValue: string) => {
    const name = `${form.prefix}${leafValue}`;
    setForm({ name, ...(keyDirty() ? {} : { key: autoKey(name) }) });
  };
  // Only the Name field splits a pasted NAME=value: a value can itself hold "=" (base64, connection strings).
  const splitPaste = (event: ClipboardEvent) => {
    if (form.providedBy !== "company" || form.mode !== "managed" || editing()) return;
    const pair = parseEnvAssignment(event.clipboardData?.getData("text") ?? "");
    if (!pair) return;
    event.preventDefault();
    const name = `${form.prefix}${pair.name}`;
    setForm({ name, value: pair.value, ...(keyDirty() ? {} : { key: autoKey(name) }) });
  };
  const setProvidedBy = (providedBy: "company" | "user") => setForm({ providedBy, ...(keyDirty() ? {} : { key: autoKey(form.name, providedBy) }) });
  const toggleAgent = (agentId: string, on: boolean) => setForm("agentIds", (ids) => (on ? [...ids, agentId] : ids.filter((id) => id !== agentId)));

  const save = async () => {
    setAttempted(true);
    const found = problems();
    if (found.key) setMore(true);
    if (found.blocked || busy()) return;
    setBusy(true);
    setError(null);
    try {
      const definition = editing();
      if (definition) {
        await secretsApi.updateUserDefinition(company().id, definition.id, { name: form.name.trim(), description: description().trim() || null, usageGuidance: guidance().trim() || null });
        pushToast({ tone: "success", title: `Saved ${form.name.trim()}` });
        await props.onSaved(null);
        props.onClose();
        return;
      }
      let row: SecretRow;
      let failures: string[];
      if (form.providedBy === "user") {
        const created = await secretsApi.createUserDefinition(company().id, {
          name: form.name.trim(),
          key: form.key.trim(),
          description: description().trim() || null,
          usageGuidance: guidance().trim() || null,
          status: "active",
        });
        row = { id: `user:${created.id}`, kind: "user", name: created.name, key: created.key, status: created.status, definition: created };
        failures = await grantEach(company().id, form.agentIds, created.key, { kind: "user", definition: created });
      } else {
        const target = store()!;
        const input: CreateSecretInput = {
          name: form.name.trim(),
          provider: target.provider,
          providerConfigId: target.providerConfigId || null,
          managedMode: form.mode === "external" ? "external_reference" : "paperclip_managed",
          description: description().trim() || null,
        };
        if (form.key.trim()) input.key = form.key.trim();
        if (form.mode === "managed") input.value = form.value;
        else {
          input.externalRef = form.externalRef.trim();
          input.providerVersionRef = version().trim() || null;
        }
        const created = await secretsApi.create(company().id, input);
        row = { id: `company:${created.id}`, kind: "company", name: created.name, key: created.key, status: created.status, secret: created };
        failures = await grantEach(company().id, form.agentIds, problems().envKey, { kind: "company", secret: created });
      }
      if (failures.length > 0) pushToast({ tone: "error", title: "Some agents weren't given access", body: `${failures.join(" ")} Add them from the secret's details.` });
      setForm("value", "");
      await props.onSaved(row);
      props.onClose();
    } catch (caught) {
      setError(failure(caught, "Couldn't save the secret."));
    } finally {
      setBusy(false);
    }
  };

  const shown = (problem: string | null) => (attempted() ? problem : null);

  return (
    <Dialog
      open={!!props.target}
      onOpenChange={(open) => !open && !busy() && props.onClose()}
      title={editing() ? `Edit ${editing()!.name}` : "New secret"}
      width={560}
      footer={
        <>
          <Show when={error()}>
            <span class="nt-error ps-foot-error" role="alert">
              {error()}
            </span>
          </Show>
          <Button variant="quiet" disabled={busy()} onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy()} onClick={() => void save()}>
            {busy() ? "Saving…" : editing() ? "Save changes" : form.providedBy === "company" && form.mode === "external" ? "Link secret" : "Create secret"}
          </Button>
        </>
      }
    >
      <form
        class="cs-dialog-body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field
          label={
            <span class="info-line">
              Name
              <InfoTip label="About the name">Use a slash to put it in a folder, like staging/API_KEY. Paste NAME=value and both the name and the value fill in.</InfoTip>
            </span>
          }
          for="sec-new-name"
          error={shown(problems().name) ?? undefined}
          help={!editing() && problems().envKey && problems().envKey !== leaf().trim() ? <>Agents read it as <code class="mono">{problems().envKey}</code>.</> : undefined}
        >
          <div class="sec-name-field">
            <Show when={form.prefix && !editing()}>
              <span class="sec-prefix" title={form.prefix}>
                <Folder size={13} aria-hidden="true" />
                <span>{form.prefix.replace(/\/$/, "")}</span>
                <button type="button" aria-label="Remove folder prefix" onClick={() => setForm({ prefix: "", name: leaf() })}>
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            </Show>
            <TextInput
              id="sec-new-name"
              class="mono"
              autocomplete="off"
              spellcheck={false}
              autofocus
              placeholder={form.providedBy === "user" ? "Personal GitHub token" : "GITHUB_TOKEN"}
              invalid={!!shown(problems().name)}
              value={leaf()}
              onInput={(event) => setName(event.currentTarget.value)}
              onPaste={splitPaste}
            />
          </div>
        </Field>

        <Show when={!editing()}>
          <div class="field-stack" role="radiogroup" aria-labelledby="sec-provided-label">
            <span class="field-label info-line" id="sec-provided-label">
              Who provides the value
              <InfoTip label="About who provides the value">
                Organization: one value, shared by every agent you choose. Each user: every member adds their own under My secrets, and an agent uses the value of the person it's working for.
              </InfoTip>
            </span>
            <div class="sec-choice">
              <label>
                <input type="radio" name="sec-provided" value="company" checked={form.providedBy === "company"} disabled={busy()} onChange={() => setProvidedBy("company")} />
                <Building2 size={16} aria-hidden="true" />
                Organization
              </label>
              <label>
                <input type="radio" name="sec-provided" value="user" checked={form.providedBy === "user"} disabled={busy()} onChange={() => setProvidedBy("user")} />
                <Users size={16} aria-hidden="true" />
                Each user
              </label>
            </div>
          </div>
        </Show>

        <Show when={!editing() && form.providedBy === "company" && form.mode === "managed"}>
          <Field
            label={
              <span class="info-line">
                Value
                <InfoTip label="About the value">After saving it can be replaced, never viewed. {stores().length > 1 ? "" : "It's encrypted and stored in Paperclip."}</InfoTip>
              </span>
            }
            for="sec-new-value"
            error={shown(problems().value) ?? undefined}
            help={pathPreview() ? <>It's created in AWS at <code class="mono">{pathPreview()}</code>.</> : undefined}
          >
            <div class="sec-value" classList={{ "sec-value--masked": !visible() }}>
              <TextArea
                id="sec-new-value"
                rows={2}
                autocomplete="off"
                spellcheck={false}
                invalid={!!shown(problems().value)}
                value={form.value}
                onInput={(event) => setForm("value", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void save();
                }}
              />
              <Button variant="icon" ghost size="compact" aria-label={visible() ? "Hide value" : "Show value"} aria-pressed={visible()} onClick={() => setVisible(!visible())}>
                {visible() ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
              </Button>
            </div>
          </Field>
          <Show when={store()?.external && store()?.provider !== "local_encrypted"}>
            <button type="button" class="sec-text-link" onClick={() => setForm("mode", "external")}>
              Use a secret that already exists in {storeLabel()} instead
            </button>
          </Show>
        </Show>

        <Show when={!editing() && form.providedBy === "company" && form.mode === "external"}>
          <Field
            label={
              <span class="info-line">
                Existing secret in {storeLabel()}
                <InfoTip label="About linking a secret">Its name, path or ARN. Paperclip reads the value from your vault when a run starts, and never stores it. Change the value there.</InfoTip>
              </span>
            }
            for="sec-new-ref"
            error={shown(problems().value) ?? undefined}
          >
            <TextInput
              id="sec-new-ref"
              class="mono"
              autocomplete="off"
              spellcheck={false}
              placeholder="arn:aws:secretsmanager:us-east-1:…"
              invalid={!!shown(problems().value)}
              value={form.externalRef}
              onInput={(event) => setForm("externalRef", event.currentTarget.value)}
            />
          </Field>
          <Show when={store()?.managed}>
            <button type="button" class="sec-text-link" onClick={() => setForm("mode", "managed")}>
              Store a new value instead
            </button>
          </Show>
        </Show>

        <Show when={form.providedBy === "user"}>
          <Field
            label={
              <span class="info-line">
                Instructions for members (optional)
                <InfoTip label="About instructions">Members without a value are asked for one; these say where to get it. An agent uses the value of the person it's working for.</InfoTip>
              </span>
            }
            for="sec-new-guidance"
          >
            <TextArea id="sec-new-guidance" rows={2} placeholder="Where to create the key and which permissions it needs" value={guidance()} onInput={(event) => setGuidance(event.currentTarget.value)} />
          </Field>
        </Show>

        <Show when={!editing() && form.providedBy === "company" && stores().length > 1}>
          <Field label="Stored in" for="sec-new-store">
            <select id="sec-new-store" class="input sec-select" value={store()?.value ?? ""} aria-invalid={!!problems().store || undefined} onChange={(event) => setStoreValue(event.currentTarget.value)}>
              <For each={stores()}>
                {(entry) => (
                  <option value={entry.value}>
                    {entry.label}
                    {entry.blockReason ? " — unavailable" : ""}
                  </option>
                )}
              </For>
            </select>
          </Field>
        </Show>
        <Show when={!editing() && form.providedBy === "company" && problems().store}>
          <p class="cs-bad" role="alert">
            {problems().store} Choose another place, or{" "}
            <button
              type="button"
              class="cs-link-button"
              onClick={() => {
                props.onClose();
                props.onManageVaults();
              }}
            >
              fix it in Vaults
            </button>
            .
          </p>
        </Show>

        <Show when={!editing()}>
          <div class="field-stack">
            <span class="field-label info-line">
              Agents that can use it (optional)
              <InfoTip label="About agent access">Each agent gets it as an environment variable. You can also give access later, from the secret or from an agent's settings.</InfoTip>
            </span>
            <div class="sec-picked">
              <For each={picked()}>
                {(agent) => (
                  <span class="sec-picked-agent">
                    <AgentAvatar agent={agent} size={24} />
                    {agent.name}
                    <button type="button" aria-label={`Remove ${agent.name}`} onClick={() => toggleAgent(agent.id, false)}>
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </For>
              <Menu>
                <Menu.Trigger as={Button} size="compact" icon={<Plus size={14} aria-hidden="true" />} disabled={busy()}>
                  Add agent
                </Menu.Trigger>
                <Menu.Content label="Agents" width={280}>
                  <For each={activeAgents()} fallback={<p class="cs-note">{props.agents ? "No agents yet." : "Loading agents…"}</p>}>
                    {(agent) => (
                      <Menu.CheckboxItem icon={<AgentAvatar agent={agent} size={24} />} checked={form.agentIds.includes(agent.id)} onChange={(on) => toggleAgent(agent.id, on)}>
                        {agent.name}
                      </Menu.CheckboxItem>
                    )}
                  </For>
                </Menu.Content>
              </Menu>
            </div>
            <Show when={shown(problems().access)}>
              <span class="field-error" role="alert">
                {problems().access}
              </span>
            </Show>
          </div>
        </Show>

        <button type="button" class="sec-more" aria-expanded={more()} aria-controls="sec-new-more" onClick={() => setMore(!more())}>
          <ChevronRight size={15} aria-hidden="true" />
          More options
        </button>
        <Show when={more()}>
          <div id="sec-new-more" class="cs-dialog-body">
            <Field label="Description" for="sec-new-description">
              <TextInput id="sec-new-description" placeholder="What it's for" value={description()} onInput={(event) => setDescription(event.currentTarget.value)} />
            </Field>
            <Field
              label={
                <span class="info-line">
                  {form.providedBy === "user" ? "Environment variable" : "Key"}
                  <InfoTip label="About the key">
                    {form.providedBy === "user"
                      ? "The name agents read. It follows the secret's name unless you change it, and stays fixed after creation."
                      : "A stable id for the CLI and API. It follows the name unless you change it, and stays fixed after creation."}
                  </InfoTip>
                </span>
              }
              for="sec-new-key"
              error={shown(problems().key) ?? undefined}
              help={editing() ? "It can't change after creation." : undefined}
            >
              <TextInput
                id="sec-new-key"
                class="mono"
                autocomplete="off"
                spellcheck={false}
                disabled={!!editing()}
                placeholder={form.providedBy === "user" ? "PERSONAL_GH_TOKEN" : "github-token"}
                invalid={!!shown(problems().key)}
                value={form.key}
                onInput={(event) => {
                  setKeyDirty(true);
                  setForm("key", event.currentTarget.value);
                }}
              />
            </Field>
            <Show when={!editing() && form.providedBy === "company" && form.mode === "external"}>
              <Field label={<span class="info-line">Version (optional)<InfoTip label="About the version">Pin one version of the secret. Empty follows the latest.</InfoTip></span>} for="sec-new-version">
                <TextInput id="sec-new-version" class="mono" autocomplete="off" value={version()} onInput={(event) => setVersion(event.currentTarget.value)} />
              </Field>
            </Show>
          </div>
        </Show>
      </form>
    </Dialog>
  );
}
