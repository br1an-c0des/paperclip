import type { Environment, EnvironmentProbeResult } from "@paperclipai/shared";
import { createQuery } from "@tanstack/solid-query";
import { Check, KeyRound } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { environmentsApi } from "@/api/environments";
import { queryKeys } from "@/api/queryKeys";
import { secretsApi } from "@/api/secrets";
import { useCompany } from "@/lib/company";
import { SchemaForm } from "@/plugins/SchemaForm";
import { defaultValues, validateValues } from "@/plugins/schema-form";
import { envFromRows, envProblem, envRows, type EnvRow } from "@/projects/settings/settings-model";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, FieldButton, TextArea, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { TonePill } from "@/ui/Status";
import { Switch } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { emptyEnvironmentForm, environmentForm, environmentFormProblem, environmentPayload, isManaged, sandboxProviders, type EnvironmentForm } from "./environments-model";
import { EnvVarsEditor } from "./EnvVarsEditor";
import { failure } from "./shared";

/*
 * New environment and Edit (the old page's form at `/company/settings/instance/environments/new` and
 * `…/:id/edit`), as a dialog: a name and note, then an SSH host (address, user, workspace path, a
 * private key pasted or picked from the company's secrets, known hosts) or a sandbox provider with
 * the settings its plugin declares, and the variables runs there get.
 *
 * Test probes the draft before it's saved (`POST …/environments/probe-config`): an SSH draft is
 * checked by connecting to the host. A Paperclip-managed environment only takes its variables.
 * Saved changes apply to later runs; Paperclip may start fresh sessions or sandboxes after a change.
 */

export type EnvironmentEdit = { mode: "new" } | { mode: "edit"; environment: Environment };

export function EnvironmentDialog(props: { edit: EnvironmentEdit | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const company = useCompany();
  const [form, setForm] = createStore<EnvironmentForm>(emptyEnvironmentForm());
  const [rows, setRows] = createStore<EnvRow[]>([]);
  const [busy, setBusy] = createSignal<"save" | "test" | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [probe, setProbe] = createSignal<EnvironmentProbeResult | null>(null);
  const [showErrors, setShowErrors] = createSignal(false);

  const editing = () => (props.edit?.mode === "edit" ? props.edit.environment : null);
  const managed = () => !!editing() && isManaged(editing()!);
  const open = () => !!props.edit;

  const capabilities = createQuery(() => ({
    queryKey: queryKeys.companySettings.environmentCapabilities(company().id),
    queryFn: ({ signal }) => environmentsApi.capabilities(company().id, signal),
    enabled: open(),
  }));
  const secrets = createQuery(() => ({
    queryKey: queryKeys.projectSettings.secrets(company().id),
    queryFn: ({ signal }) => secretsApi.list(company().id, signal),
    enabled: open(),
  }));
  const definitions = createQuery(() => ({
    queryKey: queryKeys.projectSettings.userSecretDefinitions(company().id),
    queryFn: ({ signal }) => secretsApi.userDefinitions(company().id, signal),
    enabled: open(),
    retry: false,
  }));
  // Environments are instance-wide: a saved one may point at another organization's secrets.
  const refs = createQuery(() => ({
    queryKey: queryKeys.companySettings.environmentSecretRefs(editing()?.id ?? ""),
    queryFn: ({ signal }) => environmentsApi.secretRefs(editing()!.id, signal),
    enabled: !!editing(),
    retry: false,
  }));
  const secretNames = createMemo(() =>
    Object.fromEntries((refs.data?.refs ?? []).map((ref) => [ref.secretId, ref.companyName && ref.companyId !== company().id ? `${ref.name} (${ref.companyName})` : ref.name])),
  );
  const activeSecrets = createMemo(() => (secrets.data ?? []).filter((secret) => secret.status === "active" && secret.scope === "company"));

  const providers = createMemo(() => sandboxProviders(capabilities.data, editing()?.driver === "sandbox" ? form.sandboxProvider : undefined));
  const provider = createMemo(() => providers().find((option) => option.provider === form.sandboxProvider) ?? null);
  const sandboxErrors = createMemo(() => {
    const schema = provider()?.configSchema;
    return form.driver === "sandbox" && schema ? validateValues(schema, form.sandboxConfig) : {};
  });
  const drivers = createMemo(() => [
    ...(providers().length > 0 || form.driver === "sandbox" ? [{ value: "sandbox" as const, label: "Sandbox" }] : []),
    { value: "ssh" as const, label: "SSH host" },
    ...(form.driver === "local" ? [{ value: "local" as const, label: "This machine" }] : []),
  ]);

  // Each opening starts from the environment it edits.
  createEffect(
    on(
      () => props.edit,
      (edit) => {
        setForm(reconcile(edit?.mode === "edit" ? environmentForm(edit.environment) : emptyEnvironmentForm()));
        setRows(reconcile(envRows(edit?.mode === "edit" ? edit.environment.envVars : {})));
        setProblem(null);
        setProbe(null);
        setShowErrors(false);
      },
    ),
  );

  const pickProvider = (key: string) => {
    if (key === form.sandboxProvider) return;
    const schema = providers().find((option) => option.provider === key)?.configSchema;
    setForm({ sandboxProvider: key, sandboxConfig: schema ? defaultValues(schema) : {} });
    setProbe(null);
  };
  const pickDriver = (driver: EnvironmentForm["driver"]) => {
    setForm("driver", driver);
    setProbe(null);
    // A new sandbox starts on the first provider, with its defaults.
    if (driver === "sandbox" && (!form.sandboxProvider || form.sandboxProvider === "fake") && providers()[0]) pickProvider(providers()[0]!.provider);
  };

  /** Why it can't be saved or tested, showing field problems from now on. */
  const check = () => {
    setShowErrors(true);
    if (managed()) return envProblem(rows);
    return environmentFormProblem(form) ?? (Object.keys(sandboxErrors()).length ? "Fix the provider settings first." : null) ?? envProblem(rows);
  };

  const test = async () => {
    const found = check();
    if (found) return setProblem(found);
    setProblem(null);
    setBusy("test");
    try {
      setProbe(await environmentsApi.probeConfig(company().id, environmentPayload(form, envFromRows(rows))));
    } catch (caught) {
      setProbe(null);
      setProblem(failure(caught, "The test couldn't run."));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const found = check();
    if (found) return setProblem(found);
    setProblem(null);
    setBusy("save");
    try {
      const environment = editing();
      const envVars = envFromRows(rows);
      const saved = environment
        ? await environmentsApi.update(environment.id, company().id, managed() ? { envVars } : environmentPayload(form, envVars))
        : await environmentsApi.create(company().id, environmentPayload(form, envVars));
      await props.onSaved();
      pushToast({ tone: "success", title: environment ? `Saved ${saved.name}` : `Added ${saved.name}`, body: "Runs that start from now on use it." });
      props.onClose();
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the environment."));
    } finally {
      setBusy(null);
    }
  };

  const fieldError = (when: boolean, message: string) => (showErrors() && when ? message : undefined);

  return (
    <Dialog
      open={open()}
      onOpenChange={(value) => !value && props.onClose()}
      title={editing() ? `Edit ${editing()!.name}` : "New environment"}
      description={managed() ? "Managed by Paperclip: its name and settings are kept for you; you can add variables." : "A machine agents run on. Saved changes apply to later runs."}
      width={680}
      footer={
        <>
          <Show when={problem()}>
            <span class="nt-error ps-foot-error" role="alert">
              {problem()}
            </span>
          </Show>
          <Button variant="quiet" disabled={!!busy()} onClick={props.onClose}>
            Cancel
          </Button>
          <Show when={!managed() && form.driver !== "local"}>
            <Button disabled={!!busy()} onClick={() => void test()}>
              {busy() === "test" ? "Testing…" : "Test"}
            </Button>
          </Show>
          <Button variant="primary" disabled={!!busy()} onClick={() => void save()}>
            {busy() === "save" ? "Saving…" : editing() ? "Save" : "Add environment"}
          </Button>
        </>
      }
    >
      <div class="cs-dialog-body">
        <Show when={!managed()}>
          <Field label="Name" for="cs-env-name" error={fieldError(!form.name.trim(), "Give it a name.")}>
            <TextInput id="cs-env-name" value={form.name} autocomplete="off" onInput={(event) => setForm("name", event.currentTarget.value)} />
          </Field>
          <Field label="Description" for="cs-env-description" help="Optional: what this machine is for.">
            <TextInput id="cs-env-description" value={form.description} onInput={(event) => setForm("description", event.currentTarget.value)} />
          </Field>
          <Show when={drivers().length > 1}>
            <div class="field-stack">
              <span class="field-label">Runs on</span>
              <Segmented label="Runs on" options={drivers()} value={form.driver} onChange={pickDriver} />
              <Show when={providers().length === 0 && form.driver !== "sandbox"}>
                <span class="fhelp">Sandboxes need a sandbox provider plugin that can run agents.</span>
              </Show>
            </div>
          </Show>

          <Show when={form.driver === "ssh"}>
            <div class="cs-env-grid">
              <Field label="Host" for="cs-env-host" help="DNS name or IP address." error={fieldError(!form.sshHost.trim(), "Enter the host.")}>
                <TextInput id="cs-env-host" class="mono" autocomplete="off" spellcheck={false} value={form.sshHost} onInput={(event) => setForm("sshHost", event.currentTarget.value)} />
              </Field>
              <Field label="Port" for="cs-env-port" help="Usually 22.">
                <TextInput id="cs-env-port" type="number" min={1} max={65535} value={form.sshPort} onInput={(event) => setForm("sshPort", event.currentTarget.value)} />
              </Field>
              <Field label="Username" for="cs-env-user" error={fieldError(!form.sshUsername.trim(), "Enter the username.")}>
                <TextInput id="cs-env-user" class="mono" autocomplete="off" spellcheck={false} value={form.sshUsername} onInput={(event) => setForm("sshUsername", event.currentTarget.value)} />
              </Field>
              <Field
                label="Remote workspace path"
                for="cs-env-path"
                help="An absolute path on the host; Test checks it."
                error={fieldError(!form.sshRemoteWorkspacePath.trim(), "Enter the path.")}
              >
                <TextInput
                  id="cs-env-path"
                  class="mono"
                  placeholder="/home/paperclip/workspace"
                  spellcheck={false}
                  value={form.sshRemoteWorkspacePath}
                  onInput={(event) => setForm("sshRemoteWorkspacePath", event.currentTarget.value)}
                />
              </Field>
            </div>
            <div class="field-stack">
              <span class="field-label">Private key</span>
              <Menu>
                <Menu.Trigger as={FieldButton} class="cs-env-key" icon={<KeyRound size={13} aria-hidden="true" />} aria-label="Private key secret">
                  {form.sshPrivateKeySecretId
                    ? (activeSecrets().find((secret) => secret.id === form.sshPrivateKeySecretId)?.name ?? secretNames()[form.sshPrivateKeySecretId] ?? "A secret you can't see")
                    : "No saved secret"}
                </Menu.Trigger>
                <Menu.Content label="Private key" width={300}>
                  <Menu.Item onSelect={() => setForm("sshPrivateKeySecretId", "")} hint={!form.sshPrivateKeySecretId ? <Check size={14} /> : undefined} description="Paste a key below, or use the server's SSH agent">
                    No saved secret
                  </Menu.Item>
                  <Show when={activeSecrets().length}>
                    <Menu.Separator />
                  </Show>
                  <For each={activeSecrets()}>
                    {(secret) => (
                      <Menu.Item
                        onSelect={() => setForm({ sshPrivateKeySecretId: secret.id, sshPrivateKey: "" })}
                        hint={form.sshPrivateKeySecretId === secret.id ? <Check size={14} /> : undefined}
                      >
                        {secret.name}
                      </Menu.Item>
                    )}
                  </For>
                </Menu.Content>
              </Menu>
              <TextArea
                aria-label="Paste a private key"
                class="mono cs-env-pem"
                rows={4}
                spellcheck={false}
                placeholder={form.sshPrivateKeySecretId ? "Using the secret above" : editing() ? "Leave empty to keep the saved key" : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                disabled={!!form.sshPrivateKeySecretId}
                value={form.sshPrivateKey}
                onInput={(event) => setForm("sshPrivateKey", event.currentTarget.value)}
              />
              <span class="fhelp">Optional. A pasted key is stored as a secret when you save. Without one, the server's SSH agent or default keys are used.</span>
            </div>
            <Field label="Known hosts" for="cs-env-known" help="Optional known_hosts lines, used with strict host key checking.">
              <TextArea id="cs-env-known" class="mono cs-env-pem" rows={3} spellcheck={false} value={form.sshKnownHosts} onInput={(event) => setForm("sshKnownHosts", event.currentTarget.value)} />
            </Field>
            <Switch
              label="Strict host key checking"
              description="Keep this on unless you mean to accept the host's key without checking it."
              checked={form.sshStrictHostKeyChecking}
              onChange={(value) => setForm("sshStrictHostKeyChecking", value)}
            />
          </Show>

          <Show when={form.driver === "sandbox"}>
            <div class="field-stack">
              <span class="field-label">Provider</span>
              <Menu>
                <Menu.Trigger as={FieldButton} aria-label="Sandbox provider">
                  {provider()?.displayName ?? (form.sandboxProvider || "Pick a provider")}
                </Menu.Trigger>
                <Menu.Content label="Sandbox providers" width={300}>
                  <For each={providers()} fallback={<p class="nt-menu-note">No sandbox provider plugin that can run agents is installed.</p>}>
                    {(option) => (
                      <Menu.Item onSelect={() => pickProvider(option.provider)} description={option.description} hint={form.sandboxProvider === option.provider ? <Check size={14} /> : undefined}>
                        {option.displayName}
                      </Menu.Item>
                    )}
                  </For>
                </Menu.Content>
              </Menu>
            </div>
            <Show when={provider()?.configSchema} fallback={<p class="fhelp">This provider has no settings of its own.</p>}>
              {(schema) => (
                <SchemaForm
                  schema={schema()}
                  values={form.sandboxConfig}
                  onChange={(values) => setForm("sandboxConfig", reconcile(values))}
                  errors={showErrors() ? sandboxErrors() : {}}
                  secrets={activeSecrets()}
                />
              )}
            </Show>
            <Switch
              label="Stream run logs"
              description="Show the agent's output live while a run works (recommended). Off: the output arrives when the run finishes."
              checked={form.sandboxConfig.streamRunLogs !== false}
              onChange={(value) => setForm("sandboxConfig", "streamRunLogs", value)}
            />
          </Show>
        </Show>

        <div class="field-stack">
          <span class="field-label">Environment variables</span>
          <span class="fhelp">Given to every run in this environment. Secret values are never shown here.</span>
          <EnvVarsEditor
            rows={rows}
            setRows={setRows}
            secrets={secrets.data ?? []}
            definitions={definitions.data ?? []}
            secretNames={secretNames()}
            onEdit={() => setProblem(null)}
          />
        </div>

        <Show when={probe()}>
          {(result) => (
            <p class="cs-env-probe" role="status">
              <TonePill tone={result().ok ? "green" : "red"} compact>
                {result().ok ? "Test passed" : "Test failed"}
              </TonePill>{" "}
              {result().summary}
            </p>
          )}
        </Show>
      </div>
    </Dialog>
  );
}
