import type {
  CompanySecret,
  CompanySecretProviderConfig,
  RemoteSecretImportCandidate,
  RemoteSecretImportResult,
  SecretProvider,
  SecretProviderConfigDiscoveryPreviewResult,
} from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { Check, CloudDownload, Ellipsis, Plus, Search, ShieldCheck } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { queryKeys } from "@/api/queryKeys";
import { secretsApi } from "@/api/secrets";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, FieldButton, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { TonePill, type Tone } from "@/ui/Status";
import { Switch } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import {
  applyCandidate,
  discoveryQuery,
  emptyVaultForm,
  importableVaults,
  importDraft,
  importDraftProblem,
  importResultLine,
  listedProviders,
  providerName,
  secretCounts,
  secretsLabel,
  VAULT_FIELDS,
  VAULT_PROVIDERS,
  vaultBlockReason,
  vaultComingSoon,
  vaultConfig,
  vaultForm,
  vaultProblem,
  vaultStatus,
  type ImportDraft,
  type VaultForm,
} from "./secrets-model";
import { CardHead, CardNoteLine, failure, shortDate } from "./shared";

/*
 * Secrets → Providers (the old Secrets page's Provider vaults tab). A provider is where values are
 * stored; a vault is this organization's settings for one (AWS region and naming, say), and one
 * vault can be the default new secrets go to. Each vault can be checked, edited, made the default,
 * turned off or removed. GCP and HashiCorp Vault vaults save settings only, as in the old UI.
 *
 * AWS vaults add two flows that read AWS metadata, never values:
 * - Discovery, in the vault dialog, suggests routing settings from existing secrets
 *   (`POST …/secret-provider-configs/discovery/preview`).
 * - Import secrets lists a vault's existing secrets and imports the chosen ones as references
 *   (`POST …/secrets/remote-import/preview`, then `…/remote-import`).
 */

type VaultEdit = { mode: "new"; provider: SecretProvider } | { mode: "edit"; config: CompanySecretProviderConfig };

const healthTone = (status: string | null): Tone | null => (status === "ready" ? "green" : status === "warning" ? "amber" : status === "error" ? "red" : null);
const providerMark = (provider: SecretProvider) =>
  provider === "aws_secrets_manager" ? "AW" : provider === "gcp_secret_manager" ? "GC" : provider === "vault" ? "HV" : "PV";

export function ProvidersCard(props: { secrets: CompanySecret[] }) {
  const company = useCompany();
  const client = useQueryClient();
  const descriptors = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretProviders(company().id),
    queryFn: ({ signal }) => secretsApi.providers(company().id, signal),
  }));
  const configs = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretProviderConfigs(company().id),
    queryFn: ({ signal }) => secretsApi.providerConfigs(company().id, signal),
    retry: false,
  }));
  const counts = createMemo(() => secretCounts(props.secrets));
  const listed = createMemo(() => listedProviders(descriptors.data, counts()));
  const [busy, setBusy] = createSignal<string | null>(null);
  const [edit, setEdit] = createSignal<VaultEdit | null>(null);
  const [removing, setRemoving] = createSignal<CompanySecretProviderConfig | null>(null);
  const [importing, setImporting] = createSignal<CompanySecretProviderConfig | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.companySettings.secretProviderConfigs(company().id) });
  const label = (provider: SecretProvider) => descriptors.data?.find((entry) => entry.id === provider)?.label ?? providerName(provider);

  const act = async (config: CompanySecretProviderConfig, work: () => Promise<unknown>, done: string, fallback: string) => {
    setBusy(config.id);
    try {
      await work();
      await refresh();
      pushToast({ tone: "success", title: done });
    } catch (caught) {
      pushToast({ tone: "error", title: fallback, body: failure(caught, "") || undefined });
    } finally {
      setBusy(null);
    }
  };
  const check = async (config: CompanySecretProviderConfig) => {
    setBusy(config.id);
    try {
      const result = await secretsApi.checkProviderConfig(config.id);
      await refresh();
      pushToast({ tone: result.status === "ready" ? "success" : "warn", title: result.message });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't check the vault", body: failure(caught, "") || undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section class="card settings-card" aria-labelledby="cs-providers">
      <CardHead
        id="cs-providers"
        title="Providers"
        note="Where secret values are stored. A vault is this organization's settings for a provider."
        actions={
          <Menu placement="bottom-end">
            <Menu.Trigger as={Button} size="compact" icon={<Plus size={14} aria-hidden="true" />}>
              Add vault
            </Menu.Trigger>
            <Menu.Content label="Providers" width={280}>
              <For each={VAULT_PROVIDERS}>
                {(provider) => (
                  <Menu.Item onSelect={() => setEdit({ mode: "new", provider })} description={vaultComingSoon(provider) ? "Settings only for now" : undefined}>
                    {label(provider)}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
        }
      />
      <Show when={descriptors.isError}>
        <CardNoteLine alert>Couldn't load the providers. {failure(descriptors.error, "")}</CardNoteLine>
      </Show>
      <For each={listed()}>
        {(descriptor) => (
          <div class="cs-lrow">
            <div class="cs-person cs-grow">
              <span class="cs-conn-mark" aria-hidden="true">
                <ShieldCheck size={15} />
              </span>
              <span class="cs-person-text">
                <span class="cs-strong">{providerName(descriptor.id)}</span>
                <span class="cs-muted">
                  {[descriptor.id === "local_encrypted" ? "Built in · encrypted on this server" : "The deployment's own settings", secretsLabel(counts().get(descriptor.id))]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </div>
            <Show when={descriptor.configured} fallback={<span class="cs-pill">Not set up</span>}>
              <TonePill tone="green" compact>
                Ready
              </TonePill>
            </Show>
          </div>
        )}
      </For>
      <For each={configs.data ?? []}>
        {(config) => {
          const blocked = () => vaultBlockReason(config);
          return (
            <div class="cs-lrow cs-lrow--wrap" classList={{ "cs-lrow--quiet": config.status === "disabled" || config.status === "coming_soon" }}>
              <div class="cs-person cs-grow">
                <span class="cs-conn-mark" aria-hidden="true">
                  {providerMark(config.provider)}
                </span>
                <span class="cs-person-text">
                  <span class="cs-strong">
                    {config.displayName}
                    <Show when={config.isDefault}>
                      <span class="cs-pill">Default</span>
                    </Show>
                  </span>
                  <span class="cs-muted">
                    {[
                      providerName(config.provider),
                      config.status === "coming_soon" ? "settings only" : config.status === "disabled" ? "turned off" : null,
                      config.healthMessage,
                      config.healthCheckedAt ? `checked ${shortDate(config.healthCheckedAt)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <Show when={config.healthDetails?.guidance?.length}>
                    <ul class="cs-bullets fhelp">
                      <For each={config.healthDetails!.guidance}>{(item) => <li>{item}</li>}</For>
                    </ul>
                  </Show>
                </span>
              </div>
              <Show when={healthTone(config.healthStatus)} fallback={<span class="cs-pill">{config.status === "disabled" ? "Off" : "Not checked"}</span>}>
                {(tone) => (
                  <TonePill tone={tone()} compact>
                    {config.healthStatus === "ready" ? "Healthy" : config.healthStatus === "warning" ? "Warning" : "Error"}
                  </TonePill>
                )}
              </Show>
              <div class="cs-inline">
                <Button size="compact" disabled={busy() === config.id} onClick={() => void check(config)}>
                  {busy() === config.id ? "Checking…" : "Check"}
                </Button>
                <Menu placement="bottom-end">
                  <Menu.Trigger as={Button} variant="icon" ghost size="compact" aria-label={`More actions for ${config.displayName}`}>
                    <Ellipsis size={16} aria-hidden="true" />
                  </Menu.Trigger>
                  <Menu.Content label="Vault actions" width={260}>
                    <Menu.Item onSelect={() => setEdit({ mode: "edit", config })}>Edit…</Menu.Item>
                    <Show when={config.provider === "aws_secrets_manager"}>
                      <Menu.Item
                        icon={<CloudDownload size={14} />}
                        disabled={!!blocked()}
                        description={blocked() ?? "Bring in its existing secrets as references"}
                        onSelect={() => setImporting(config)}
                      >
                        Import secrets…
                      </Menu.Item>
                    </Show>
                    <Show when={!config.isDefault}>
                      <Menu.Item
                        disabled={!!blocked()}
                        description={blocked() ?? "New secrets are stored here"}
                        onSelect={() => void act(config, () => secretsApi.setDefaultProviderConfig(config.id), `New secrets go to ${config.displayName} now`, "Couldn't change the default")}
                      >
                        Make default
                      </Menu.Item>
                    </Show>
                    <Menu.Separator />
                    <Show when={config.status !== "disabled"}>
                      <Menu.Item
                        description="Secrets stored there stop resolving"
                        onSelect={() => void act(config, () => secretsApi.updateProviderConfig(config.id, { status: "disabled" }), `Turned ${config.displayName} off`, "Couldn't turn the vault off")}
                      >
                        Turn off
                      </Menu.Item>
                    </Show>
                    <Menu.Item danger onSelect={() => setRemoving(config)}>
                      Remove…
                    </Menu.Item>
                  </Menu.Content>
                </Menu>
              </div>
            </div>
          );
        }}
      </For>
      <Show when={configs.data && configs.data.length === 0 && !configs.isError}>
        <CardNoteLine>No vaults of this organization's own; secrets use the deployment's provider settings.</CardNoteLine>
      </Show>
      <VaultDialog edit={edit()} label={label} onClose={() => setEdit(null)} onSaved={refresh} />
      <ImportSecretsDialog vault={importing()} secrets={props.secrets} onClose={() => setImporting(null)} />
      <ConfirmDialog
        open={!!removing()}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing()?.displayName ?? ""}?`}
        body="Its settings are removed. Secrets stored there keep their values in the provider but stop resolving here."
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          const config = removing();
          if (!config) return;
          try {
            await secretsApi.removeProviderConfig(config.id);
            await refresh();
            pushToast({ tone: "success", title: `Removed ${config.displayName}` });
          } catch (caught) {
            pushToast({ tone: "error", title: "Couldn't remove the vault", body: failure(caught, "") || undefined });
            throw caught;
          }
        }}
      />
    </section>
  );
}

function VaultDialog(props: { edit: VaultEdit | null; label: (provider: SecretProvider) => string; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const company = useCompany();
  const [form, setForm] = createStore<VaultForm>(emptyVaultForm("local_encrypted"));
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [discovery, setDiscovery] = createSignal<SecretProviderConfigDiscoveryPreviewResult | null>(null);
  const [discovering, setDiscovering] = createSignal(false);
  const [discoveryProblem, setDiscoveryProblem] = createSignal<string | null>(null);
  const editing = () => (props.edit?.mode === "edit" ? props.edit.config : null);

  createEffect(
    on(
      () => props.edit,
      (edit) => {
        setForm(reconcile(edit?.mode === "edit" ? vaultForm(edit.config) : emptyVaultForm(edit?.provider ?? "local_encrypted")));
        setProblem(null);
        setDiscovery(null);
        setDiscoveryProblem(null);
      },
    ),
  );

  const discover = async () => {
    setDiscovering(true);
    setDiscoveryProblem(null);
    try {
      setDiscovery(await secretsApi.discoverProviderConfig(company().id, { provider: "aws_secrets_manager", config: vaultConfig(form), query: discoveryQuery(form), pageSize: 50 }));
    } catch (caught) {
      setDiscovery(null);
      setDiscoveryProblem(failure(caught, "Couldn't read AWS."));
    } finally {
      setDiscovering(false);
    }
  };

  const save = async () => {
    const found = vaultProblem(form);
    if (found) return setProblem(found);
    setProblem(null);
    setBusy(true);
    try {
      const config = editing();
      const body = { displayName: form.displayName.trim(), isDefault: form.isDefault, config: vaultConfig(form) };
      if (config) await secretsApi.updateProviderConfig(config.id, body);
      else await secretsApi.createProviderConfig(company().id, { ...body, provider: form.provider, status: vaultStatus(form.provider) });
      await props.onSaved();
      pushToast({ tone: "success", title: config ? `Saved ${body.displayName}` : `Added ${body.displayName}` });
      props.onClose();
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the vault."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!props.edit}
      onOpenChange={(open) => !open && props.onClose()}
      title={editing() ? `Edit ${editing()!.displayName}` : `New ${props.label(form.provider)} vault`}
      description={vaultComingSoon(form.provider) ? "Paperclip can save these settings, but can't store or read values there yet." : undefined}
      width={600}
      footer={
        <>
          <Show when={problem()}>
            <span class="nt-error ps-foot-error" role="alert">
              {problem()}
            </span>
          </Show>
          <Button variant="quiet" disabled={busy()} onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy()} onClick={() => void save()}>
            {busy() ? "Saving…" : editing() ? "Save" : "Add vault"}
          </Button>
        </>
      }
    >
      <div class="cs-dialog-body">
        <Field label="Name" for="cs-vault-name" help="How secrets and people refer to it.">
          <TextInput id="cs-vault-name" value={form.displayName} autocomplete="off" onInput={(event) => setForm("displayName", event.currentTarget.value)} />
        </Field>
        <Show when={VAULT_FIELDS[form.provider].length}>
          <div class="cs-env-grid">
            <For each={VAULT_FIELDS[form.provider]}>
              {(field) => (
                <Field label={field.required ? field.label : `${field.label} (optional)`} for={`cs-vault-${field.key}`}>
                  <TextInput
                    id={`cs-vault-${field.key}`}
                    class="mono"
                    spellcheck={false}
                    autocomplete="off"
                    placeholder={field.placeholder}
                    value={form.fields[field.key] ?? ""}
                    onInput={(event) => setForm("fields", field.key, event.currentTarget.value)}
                  />
                </Field>
              )}
            </For>
          </div>
        </Show>
        <Show when={form.provider === "local_encrypted"}>
          <Switch
            label="I know how to back it up"
            description="Restoring these secrets needs both the database and this server's encryption key file."
            checked={form.backupReminderAcknowledged}
            onChange={(value) => setForm("backupReminderAcknowledged", value)}
          />
        </Show>
        <Show when={!vaultComingSoon(form.provider) && editing()?.status !== "disabled"}>
          <Switch label="Make it the default" description="New secrets are stored here." checked={form.isDefault} onChange={(value) => setForm("isDefault", value)} />
        </Show>

        <Show when={form.provider === "aws_secrets_manager"}>
          <div class="cs-discovery">
            <div class="cs-inline">
              <span class="cs-person-text cs-grow">
                <span class="cs-strong">Find existing AWS settings</span>
                <span class="fhelp">Reads AWS Secrets Manager metadata with the region and fields above to suggest settings. Values aren't read.</span>
              </span>
              <Button size="compact" icon={<Search size={14} aria-hidden="true" />} disabled={!(form.fields.region ?? "").trim() || discovering()} onClick={() => void discover()}>
                {discovering() ? "Searching…" : "Search AWS"}
              </Button>
            </div>
            <Show when={discoveryProblem()}>
              <p class="cs-bad" role="alert">
                {discoveryProblem()}
              </p>
            </Show>
            <For each={discovery()?.warnings ?? []}>{(warning) => <p class="fhelp cs-warn">{warning}</p>}</For>
            <Show when={discovery()}>
              {(found) => (
                <Show when={found().candidates.length} fallback={<p class="fhelp">Nothing found; enter the settings by hand.</p>}>
                  <p class="fhelp">
                    {found().candidates.length} {found().candidates.length === 1 ? "suggestion" : "suggestions"} from {found().sampledSecretCount} secrets
                  </p>
                  <For each={found().candidates}>
                    {(candidate) => (
                      <div class="cs-lrow cs-lrow--flush">
                        <span class="cs-person-text cs-grow">
                          <span class="cs-strong">{candidate.displayName}</span>
                          <span class="cs-muted mono cs-ellipsis">
                            {[candidate.signals.namespace, candidate.signals.secretNamePrefix, candidate.signals.environmentTag].filter(Boolean).join(" · ") ||
                              `${candidate.sampleCount} secrets`}
                          </span>
                        </span>
                        <Button size="compact" onClick={() => setForm(reconcile(applyCandidate({ ...form, fields: { ...form.fields } }, candidate)))}>
                          Use
                        </Button>
                      </div>
                    )}
                  </For>
                </Show>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </Dialog>
  );
}

const PAGE_SIZE = 50;

/** Import a vault's existing secrets as references: pick, name, import, then the result. */
function ImportSecretsDialog(props: { vault: CompanySecretProviderConfig | null; secrets: CompanySecret[]; onClose: () => void }) {
  const company = useCompany();
  const client = useQueryClient();
  const [query, setQuery] = createSignal("");
  const [candidates, setCandidates] = createSignal<RemoteSecretImportCandidate[]>([]);
  const [nextToken, setNextToken] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [selected, setSelected] = createStore<Record<string, ImportDraft | undefined>>({});
  const [importing, setImporting] = createSignal(false);
  const [result, setResult] = createSignal<RemoteSecretImportResult | null>(null);
  const drafts = createMemo(() => Object.values(selected).filter((draft): draft is ImportDraft => !!draft));
  const problems = createMemo(() => new Map(drafts().map((draft) => [draft.candidate.externalRef, importDraftProblem(draft, props.secrets, drafts())])));
  const blocked = () => [...problems().values()].some(Boolean);
  let generation = 0;

  const load = async (more: boolean) => {
    const vault = props.vault;
    if (!vault) return;
    const id = ++generation;
    setLoading(true);
    setProblem(null);
    try {
      const page = await secretsApi.remoteImportPreview(company().id, {
        providerConfigId: vault.id,
        query: query().trim() || null,
        nextToken: more ? nextToken() : null,
        pageSize: PAGE_SIZE,
      });
      if (id !== generation) return;
      setCandidates(more ? [...candidates(), ...page.candidates.filter((entry) => !candidates().some((known) => known.externalRef === entry.externalRef))] : page.candidates);
      setNextToken(page.nextToken);
    } catch (caught) {
      if (id === generation) setProblem(failure(caught, "Couldn't list the vault's secrets."));
    } finally {
      if (id === generation) setLoading(false);
    }
  };

  createEffect(
    on(
      () => props.vault,
      (vault) => {
        setQuery("");
        setCandidates([]);
        setNextToken(null);
        setSelected(reconcile({}));
        setResult(null);
        setProblem(null);
        if (vault) void load(false);
      },
    ),
  );

  const toggle = (candidate: RemoteSecretImportCandidate, on: boolean) => {
    if (on) setSelected(candidate.externalRef, importDraft(candidate));
    else setSelected(candidate.externalRef, undefined);
  };

  const runImport = async () => {
    const vault = props.vault;
    if (!vault || drafts().length === 0 || blocked()) return;
    setImporting(true);
    setProblem(null);
    try {
      const done = await secretsApi.remoteImport(company().id, {
        providerConfigId: vault.id,
        secrets: drafts().map((draft) => ({
          externalRef: draft.candidate.externalRef,
          name: draft.name.trim(),
          key: draft.key.trim(),
          providerVersionRef: draft.candidate.providerVersionRef,
          providerMetadata: draft.candidate.providerMetadata,
        })),
      });
      setResult(done);
      await client.invalidateQueries({ queryKey: queryKeys.projectSettings.secrets(company().id) });
      pushToast({ tone: done.errorCount ? "warn" : "success", title: done.errorCount ? "Imported with problems" : "Imported the secrets", body: importResultLine(done) });
    } catch (caught) {
      setProblem(failure(caught, "The import failed."));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog
      open={!!props.vault}
      onOpenChange={(open) => !open && props.onClose()}
      title={`Import from ${props.vault?.displayName ?? ""}`}
      description="Existing secrets come in as references: Paperclip reads their values from the provider when a run needs them."
      width={720}
      footer={
        <>
          <Show when={problem()}>
            <span class="nt-error ps-foot-error" role="alert">
              {problem()}
            </span>
          </Show>
          <Show
            when={!result()}
            fallback={
              <Button variant="primary" onClick={props.onClose}>
                Done
              </Button>
            }
          >
            <Button variant="quiet" disabled={importing()} onClick={props.onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={importing() || drafts().length === 0 || blocked()} onClick={() => void runImport()}>
              {importing() ? "Importing…" : drafts().length ? `Import ${drafts().length}` : "Import"}
            </Button>
          </Show>
        </>
      }
    >
      <div class="cs-dialog-body">
        <Show
          when={result()}
          fallback={
            <>
              <form
                class="cs-inline"
                onSubmit={(event) => {
                  event.preventDefault();
                  void load(false);
                }}
              >
                <TextInput class="cs-grow" type="search" placeholder="Search by name" aria-label="Search the vault's secrets" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
                <Button size="compact" type="submit" disabled={loading()}>
                  Search
                </Button>
              </form>
              <div class="cs-import-list" role="list" aria-label="The vault's secrets">
                <For each={candidates()} fallback={<p class="cs-muted">{loading() ? "Loading…" : "No secrets found."}</p>}>
                  {(candidate) => {
                    const draft = () => selected[candidate.externalRef];
                    const rowProblem = () => problems().get(candidate.externalRef) ?? null;
                    return (
                      <div class="cs-import-row" role="listitem" classList={{ "cs-lrow--quiet": !candidate.importable }}>
                        <label class="cs-import-pick">
                          <input type="checkbox" disabled={!candidate.importable} checked={!!draft()} onChange={(event) => toggle(candidate, event.currentTarget.checked)} />
                          <span class="cs-person-text">
                            <span class="cs-strong mono cs-ellipsis">{candidate.remoteName}</span>
                            <span class="cs-muted">
                              {candidate.status === "duplicate" ? "Already imported" : candidate.status === "conflict" ? (candidate.conflicts[0]?.message ?? "Conflicts with a secret") : "Ready"}
                            </span>
                          </span>
                        </label>
                        <Show when={draft()}>
                          {(current) => (
                            <div class="cs-import-names">
                              <TextInput aria-label={`Name for ${candidate.remoteName}`} value={current().name} onInput={(event) => setSelected(candidate.externalRef, "name", event.currentTarget.value)} />
                              <TextInput class="mono" aria-label={`Key for ${candidate.remoteName}`} value={current().key} onInput={(event) => setSelected(candidate.externalRef, "key", event.currentTarget.value)} />
                              <Show when={rowProblem()}>
                                <span class="field-error" role="alert">
                                  {rowProblem()}
                                </span>
                              </Show>
                            </div>
                          )}
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
              <Show when={nextToken()}>
                <Button size="compact" variant="quiet" class="cs-self-start" disabled={loading()} onClick={() => void load(true)}>
                  {loading() ? "Loading…" : "Load more"}
                </Button>
              </Show>
            </>
          }
        >
          {(done) => (
            <>
              <p class="cs-strong">{importResultLine(done())}</p>
              <ul class="cs-usage">
                <For each={done().results}>
                  {(row) => (
                    <li>
                      <span class="cs-strong">
                        <Show when={row.status === "imported"}>
                          <Check size={13} aria-hidden="true" />{" "}
                        </Show>
                        {row.name}
                      </span>
                      <span class={row.status === "error" ? "cs-bad" : "cs-muted"}>{row.status === "imported" ? `Imported as ${row.key}` : (row.reason ?? row.status)}</span>
                    </li>
                  )}
                </For>
              </ul>
            </>
          )}
        </Show>
      </div>
    </Dialog>
  );
}

/** Opens the import from the organization's secrets card, with a vault picker when there are several. */
export function ImportFromVaultButton(props: { secrets: CompanySecret[] }) {
  const company = useCompany();
  const configs = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretProviderConfigs(company().id),
    queryFn: ({ signal }) => secretsApi.providerConfigs(company().id, signal),
    retry: false,
  }));
  const vaults = createMemo(() => importableVaults(configs.data).filter((config) => !vaultBlockReason(config)));
  const [vault, setVault] = createSignal<CompanySecretProviderConfig | null>(null);
  return (
    <Show when={vaults().length}>
      <Show
        when={vaults().length > 1}
        fallback={
          <Button size="compact" icon={<CloudDownload size={14} aria-hidden="true" />} onClick={() => setVault(vaults()[0]!)}>
            Import from AWS
          </Button>
        }
      >
        <Menu placement="bottom-end">
          <Menu.Trigger as={FieldButton} icon={<CloudDownload size={14} aria-hidden="true" />}>
            Import from AWS
          </Menu.Trigger>
          <Menu.Content label="Vaults" width={260}>
            <For each={vaults()}>{(config) => <Menu.Item onSelect={() => setVault(config)}>{config.displayName}</Menu.Item>}</For>
          </Menu.Content>
        </Menu>
      </Show>
      <ImportSecretsDialog vault={vault()} secrets={props.secrets} onClose={() => setVault(null)} />
    </Show>
  );
}
