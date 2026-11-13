import type {
  CompanySecret,
  CompanySecretProviderConfig,
  RemoteSecretImportCandidate,
  RemoteSecretImportResult,
  SecretProvider,
  SecretProviderConfigDiscoveryPreviewResult,
  SecretProviderDescriptor,
} from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Cloud, Database, Ellipsis, KeyRound, Plus, Search, ShieldCheck } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch as Choose } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { queryKeys } from "@/api/queryKeys";
import { secretsApi } from "@/api/secrets";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { Menu } from "@/ui/Menu";
import { Switch } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import {
  applyCandidate,
  builtInStores,
  discoveryQuery,
  emptyVaultForm,
  importDraft,
  importDraftProblem,
  importResultLine,
  orderedVaults,
  providerKind,
  secretsLabel,
  VAULT_FIELDS,
  VAULT_PROVIDERS,
  vaultBlockReason,
  vaultComingSoon,
  vaultConfig,
  vaultDefaultBadge,
  vaultForm,
  vaultProblem,
  vaultSecretCounts,
  vaultStatus,
  whenLabel,
  type ImportDraft,
  type VaultForm,
} from "./secrets-model";
import { CardHead, CardNoteLine, failure } from "./shared";

/*
 * Secrets → Vaults (upstream's redesigned Vaults tab, #21225): where secret values are kept, as one
 * flat list with each place's health and how many secrets it holds. Paperclip's own storage is
 * always first (the default until the organization has a usable Paperclip-encrypted vault), then a
 * provider set up for the whole deployment, then the organization's vaults: each can be edited,
 * checked, made the default, turned off or on, removed, and an AWS one imported from. A new vault is
 * checked as soon as it's saved. GCP and HashiCorp Vault can't store values yet: existing drafts
 * still show and can be edited, but Add vault no longer makes new ones.
 *
 * AWS vaults add two flows that read AWS metadata, never values:
 * - Discovery, in the vault dialog, suggests routing settings from existing secrets
 *   (`POST …/secret-provider-configs/discovery/preview`).
 * - Import lists a vault's existing secrets and imports the chosen ones as references
 *   (`POST …/secrets/remote-import/preview`, then `…/remote-import`).
 */

type VaultEdit = { mode: "new"; provider: SecretProvider } | { mode: "edit"; config: CompanySecretProviderConfig };

const providerIcon = (provider: SecretProvider) => (provider === "local_encrypted" ? Database : provider === "aws_secrets_manager" ? Cloud : provider === "gcp_secret_manager" ? ShieldCheck : KeyRound);

export function VaultsTab(props: {
  secrets: CompanySecret[] | undefined;
  descriptors: SecretProviderDescriptor[] | undefined;
  configs: CompanySecretProviderConfig[] | undefined;
  configsLoading: boolean;
  configsError: string | null;
  onImport: (config: CompanySecretProviderConfig) => void;
}) {
  const company = useCompany();
  const client = useQueryClient();
  const counts = createMemo(() => vaultSecretCounts((props.secrets ?? []).filter((secret) => secret.status !== "deleted")));
  const builtIns = createMemo(() => builtInStores(props.descriptors, props.configs, counts()));
  const vaults = createMemo(() => orderedVaults(props.configs));
  const [busy, setBusy] = createSignal<string | null>(null);
  const [edit, setEdit] = createSignal<VaultEdit | null>(null);
  const [removing, setRemoving] = createSignal<CompanySecretProviderConfig | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.companySettings.secretProviderConfigs(company().id) });
  const kind = (provider: SecretProvider) => providerKind(provider, props.descriptors);

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
      pushToast({
        tone: result.status === "error" ? "error" : result.status === "ready" ? "success" : "warn",
        title: result.status === "error" ? `${config.displayName} can't be reached` : `${config.displayName} is working`,
        body: result.message,
      });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't check the vault", body: failure(caught, "") || undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section class="card settings-card" aria-labelledby="sec-vaults">
      <CardHead
        id="sec-vaults"
        title={
          <span class="info-line">
            Vaults
            <InfoTip label="About vaults">
              Where secret values are kept. Paperclip encrypts them itself unless you connect a vault of your own. Only settings are saved here: credentials stay with Paperclip's server.
            </InfoTip>
          </span>
        }
        actions={
          <Menu placement="bottom-end">
            <Menu.Trigger as={Button} size="compact" icon={<Plus size={14} aria-hidden="true" />}>
              Add vault
            </Menu.Trigger>
            <Menu.Content label="Add a vault" width={280}>
              <For each={VAULT_PROVIDERS}>
                {(provider) => (
                  <Menu.Item disabled={vaultComingSoon(provider)} hint={vaultComingSoon(provider) ? "Coming soon" : undefined} onSelect={() => setEdit({ mode: "new", provider })}>
                    {provider === "local_encrypted" ? "Paperclip-encrypted vault" : kind(provider)}
                  </Menu.Item>
                )}
              </For>
            </Menu.Content>
          </Menu>
        }
      />
      <Show when={props.configsError}>
        <CardNoteLine alert>Couldn't load the vaults. {props.configsError}</CardNoteLine>
      </Show>
      <For each={builtIns()}>
        {(store) => {
          const Icon = providerIcon(store.provider);
          return (
            <div class="cs-lrow sec-vault" data-testid={`vault-built-in-${store.provider}`}>
              <Icon size={16} aria-hidden="true" />
              <div class="sec-vault-text">
                <span class="sec-vault-title">
                  {store.label}
                  <Show when={store.isDefault}>
                    <span class="cs-pill">Default</span>
                  </Show>
                </span>
                <span class="sec-health">
                  {store.provider === "local_encrypted" ? "Encrypted and stored by Paperclip. Always available." : store.configured ? "This deployment's own settings." : "Not set up on this server any more."}
                </span>
              </div>
              <span class="sec-vault-count">{secretsLabel(store.count)}</span>
              <span class="sec-vault-spacer" aria-hidden="true" />
            </div>
          );
        }}
      </For>
      <Show when={props.configsLoading}>
        <CardNoteLine>Loading vaults…</CardNoteLine>
      </Show>
      <For each={vaults()}>
        {(config) => {
          const Icon = providerIcon(config.provider);
          const blocked = () => vaultBlockReason(config);
          const unavailable = () => config.status === "disabled" || config.status === "coming_soon";
          const badge = () => vaultDefaultBadge(config, props.configs, kind(config.provider));
          return (
            <div class="cs-lrow sec-vault" data-testid={`vault-${config.id}`}>
              <Icon size={16} aria-hidden="true" />
              <div class="sec-vault-text">
                <span class="sec-vault-title">
                  {config.displayName}
                  <span class="sec-vault-kind">{kind(config.provider)}</span>
                  <Show when={badge()}>
                    <span class="cs-pill">{badge()}</span>
                  </Show>
                  <Show when={config.status === "disabled"}>
                    <span class="cs-pill">Turned off</span>
                  </Show>
                  <Show when={config.status === "coming_soon"}>
                    <span class="cs-pill">Not available yet</span>
                  </Show>
                </span>
                <Choose>
                  <Match when={unavailable()}>
                    <span class="sec-health">{config.status === "disabled" ? "Secrets can't be stored in or read from it while it's off." : "Paperclip can't store or read secrets here yet."}</span>
                  </Match>
                  <Match when={blocked()}>
                    <span class="sec-health sec-health--bad" role="alert">
                      <AlertTriangle size={13} aria-hidden="true" />
                      {blocked()}
                      <Button size="compact" disabled={busy() === config.id} onClick={() => void check(config)}>
                        {busy() === config.id ? "Checking…" : "Check again"}
                      </Button>
                    </span>
                    <Show when={config.healthDetails?.guidance?.length}>
                      <ul class="cs-bullets fhelp">
                        <For each={config.healthDetails!.guidance}>{(item) => <li>{item}</li>}</For>
                      </ul>
                    </Show>
                  </Match>
                  <Match when={config.healthStatus}>
                    <span class="sec-health">
                      {config.healthStatus === "warning" ? <AlertTriangle size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
                      {config.healthStatus === "warning" ? (config.healthMessage ?? "Working, with a warning") : "Working"} · checked {whenLabel(config.healthCheckedAt)}
                    </span>
                    <Show when={config.healthStatus === "warning" && config.healthDetails?.guidance?.length}>
                      <ul class="cs-bullets fhelp">
                        <For each={config.healthDetails!.guidance}>{(item) => <li>{item}</li>}</For>
                      </ul>
                    </Show>
                  </Match>
                  <Match when={true}>
                    <span class="sec-health">Not checked yet</span>
                  </Match>
                </Choose>
              </div>
              <span class="sec-vault-count">{secretsLabel(counts().get(config.id))}</span>
              <Menu placement="bottom-end">
                <Menu.Trigger as={Button} variant="icon" ghost size="compact" aria-label={`Actions for ${config.displayName}`} disabled={busy() === config.id}>
                  <Ellipsis size={16} aria-hidden="true" />
                </Menu.Trigger>
                <Menu.Content label="Vault actions" width={270}>
                  <Menu.Item onSelect={() => setEdit({ mode: "edit", config })}>Edit connection</Menu.Item>
                  <Menu.Item onSelect={() => void check(config)}>Check connection</Menu.Item>
                  <Show when={config.provider === "aws_secrets_manager"}>
                    <Menu.Item icon={<Cloud size={14} />} disabled={!!blocked()} description={blocked() ?? "Bring in its existing secrets as references"} onSelect={() => props.onImport(config)}>
                      Import secrets from it
                    </Menu.Item>
                  </Show>
                  <Show when={!config.isDefault && !blocked()}>
                    <Menu.Item
                      description="New secrets are stored here"
                      onSelect={() => void act(config, () => secretsApi.setDefaultProviderConfig(config.id), `New secrets go to ${config.displayName} now`, "Couldn't change the default")}
                    >
                      Make default
                    </Menu.Item>
                  </Show>
                  <Menu.Separator />
                  <Show
                    when={config.status === "disabled"}
                    fallback={
                      <Menu.Item
                        description="Secrets stored there stop resolving"
                        onSelect={() => void act(config, () => secretsApi.updateProviderConfig(config.id, { status: "disabled" }), `Turned ${config.displayName} off`, "Couldn't turn the vault off")}
                      >
                        Turn off
                      </Menu.Item>
                    }
                  >
                    <Menu.Item onSelect={() => void act(config, () => secretsApi.updateProviderConfig(config.id, { status: vaultStatus(config.provider) }), `Turned ${config.displayName} on`, "Couldn't turn the vault on")}>
                      Turn on
                    </Menu.Item>
                  </Show>
                  <Menu.Item danger onSelect={() => setRemoving(config)}>
                    Remove vault…
                  </Menu.Item>
                </Menu.Content>
              </Menu>
            </div>
          );
        }}
      </For>
      <VaultDialog edit={edit()} kind={kind} onClose={() => setEdit(null)} onSaved={refresh} />
      <ConfirmDialog
        open={!!removing()}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing()?.displayName ?? ""}?`}
        body={`This removes the vault from Paperclip only. ${removing()?.provider === "aws_secrets_manager" ? "Nothing is deleted in AWS." : "Nothing is deleted in the vault itself."} Secrets stored in it stop working until you move them to another vault.`}
        confirmLabel="Remove vault"
        danger
        onConfirm={async () => {
          const config = removing();
          if (!config) return;
          try {
            await secretsApi.removeProviderConfig(config.id);
            await refresh();
            pushToast({ tone: "success", title: `Removed ${config.displayName}`, body: "From Paperclip only." });
          } catch (caught) {
            pushToast({ tone: "error", title: "Couldn't remove the vault", body: failure(caught, "") || undefined });
            throw caught;
          }
        }}
      />
    </section>
  );
}

/*
 * Connect or edit a vault. AWS asks for a name and a region; its naming and tags sit behind a
 * disclosure, with discovery to fill them from existing secrets. A new vault is checked as soon as
 * it's saved, so the list shows a real result instead of "Not checked yet".
 */
function VaultDialog(props: { edit: VaultEdit | null; kind: (provider: SecretProvider) => string; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const company = useCompany();
  const [form, setForm] = createStore<VaultForm>(emptyVaultForm("local_encrypted"));
  const [busy, setBusy] = createSignal(false);
  const [attempted, setAttempted] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [advanced, setAdvanced] = createSignal(false);
  const [discovery, setDiscovery] = createSignal<SecretProviderConfigDiscoveryPreviewResult | null>(null);
  const [discovering, setDiscovering] = createSignal(false);
  const [discoveryProblem, setDiscoveryProblem] = createSignal<string | null>(null);
  const editing = () => (props.edit?.mode === "edit" ? props.edit.config : null);
  const aws = () => form.provider === "aws_secrets_manager";
  const fields = () => VAULT_FIELDS[form.provider].filter((field) => !(aws() && field.key === "region"));
  const found = () => (attempted() ? vaultProblem(form) : null);

  createEffect(
    on(
      () => props.edit,
      (edit) => {
        setForm(reconcile(edit?.mode === "edit" ? vaultForm(edit.config) : emptyVaultForm(edit?.provider ?? "local_encrypted")));
        setAttempted(false);
        setProblem(null);
        setAdvanced(false);
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
    setAttempted(true);
    if (vaultProblem(form)) return;
    setProblem(null);
    setBusy(true);
    try {
      const config = editing();
      const body = { displayName: form.displayName.trim(), isDefault: form.isDefault, config: vaultConfig(form) };
      if (config) {
        await secretsApi.updateProviderConfig(config.id, body);
        pushToast({ tone: "success", title: `Saved ${body.displayName}` });
      } else {
        const saved = await secretsApi.createProviderConfig(company().id, { ...body, provider: form.provider, status: vaultStatus(form.provider) });
        pushToast({ tone: "success", title: `Connected ${body.displayName}` });
        if (saved.status !== "coming_soon") {
          void secretsApi
            .checkProviderConfig(saved.id)
            .then((health) => {
              if (health.status === "error") pushToast({ tone: "error", title: `${saved.displayName} can't be reached`, body: health.message });
            })
            .catch((caught) =>
              pushToast({ tone: "error", title: `Couldn't check ${saved.displayName}`, body: `${failure(caught, "")} The vault is saved; use Check connection in its menu to try again.` }),
            )
            .finally(() => void props.onSaved());
        }
      }
      await props.onSaved();
      props.onClose();
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the vault."));
    } finally {
      setBusy(false);
    }
  };

  const fieldInputs = () => (
    <div class="cs-env-grid">
      <For each={fields()}>
        {(field) => (
          <Field label={field.required ? field.label : `${field.label} (optional)`} for={`sec-vault-${field.key}`}>
            <TextInput
              id={`sec-vault-${field.key}`}
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
  );

  return (
    <Dialog
      open={!!props.edit}
      onOpenChange={(open) => !open && props.onClose()}
      title={editing() ? `Edit ${editing()!.displayName}` : aws() ? "Connect AWS Secrets Manager" : form.provider === "local_encrypted" ? "Add a Paperclip-encrypted vault" : `Add a ${props.kind(form.provider)} vault`}
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
            {busy() ? "Saving…" : editing() ? "Save changes" : aws() ? "Connect vault" : "Add vault"}
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
        <div class="cs-env-grid">
          <Field
            label={
              <span class="info-line">
                Name
                <InfoTip label="About connecting a vault">
                  {aws() ? "Paperclip connects with the AWS role its server runs as. No access keys are stored." : "Only settings are saved here. Credentials stay with Paperclip's server."}
                </InfoTip>
              </span>
            }
            for="sec-vault-name"
            error={found() === "Give the vault a name." ? "Give the vault a name your team will recognize." : undefined}
          >
            <TextInput id="sec-vault-name" value={form.displayName} autocomplete="off" autofocus placeholder={aws() ? "prod-us-east" : "Production vault"} onInput={(event) => setForm("displayName", event.currentTarget.value)} />
          </Field>
          <Show when={aws()}>
            <Field label="AWS region" for="sec-vault-region" error={found() === "Enter the AWS region." ? "Enter the AWS region, such as us-east-1." : undefined}>
              <TextInput id="sec-vault-region" class="mono" spellcheck={false} autocomplete="off" placeholder="us-east-1" value={form.fields.region ?? ""} onInput={(event) => setForm("fields", "region", event.currentTarget.value)} />
            </Field>
          </Show>
        </div>
        <Choose>
          <Match when={vaultComingSoon(form.provider)}>
            <p class="cs-muted">{props.kind(form.provider)} vaults can be saved, but Paperclip can't store or read secrets in them yet.</p>
          </Match>
          <Match when={editing()?.status === "disabled"}>
            <p class="cs-muted">This vault is turned off. Turn it on from its menu to use it for secrets.</p>
          </Match>
          <Match when={true}>
            <Switch
              label={form.provider === "local_encrypted" ? "Use for new secrets by default" : `Use for new ${props.kind(form.provider)} secrets by default`}
              description="Existing secrets stay where they are."
              checked={form.isDefault}
              onChange={(value) => setForm("isDefault", value)}
            />
          </Match>
        </Choose>
        <Show when={form.provider === "local_encrypted"}>
          <Switch
            label="I know how to back it up"
            description="Restoring these secrets needs both the database and Paperclip's encryption key file."
            checked={form.backupReminderAcknowledged}
            onChange={(value) => setForm("backupReminderAcknowledged", value)}
          />
          <Show when={found() === "Confirm you know how to back it up."}>
            <span class="field-error" role="alert">
              Confirm you know how to back it up.
            </span>
          </Show>
        </Show>
        <Show when={aws()} fallback={<Show when={fields().length}>{fieldInputs()}</Show>}>
          <button type="button" class="sec-more" aria-expanded={advanced()} onClick={() => setAdvanced(!advanced())}>
            <ChevronRight size={15} aria-hidden="true" />
            Naming and tags
          </button>
          <Show when={advanced()}>{fieldInputs()}</Show>
          <div class="cs-discovery">
            <div class="cs-inline">
              <span class="info-line cs-grow">
                <span class="cs-strong">Find existing AWS settings</span>
                <InfoTip label="About finding AWS settings">Reads AWS Secrets Manager metadata with the region and fields above to suggest settings. Values aren't read.</InfoTip>
              </span>
              <Button size="compact" icon={<Search size={14} aria-hidden="true" />} disabled={!(form.fields.region ?? "").trim() || discovering()} onClick={() => void discover()}>
                {discovering() ? "Searching…" : "Search AWS"}
              </Button>
            </div>
            <Show when={!(form.fields.region ?? "").trim()}>
              <p class="fhelp">Enter the region to search.</p>
            </Show>
            <Show when={discoveryProblem()}>
              <p class="cs-bad" role="alert">
                {discoveryProblem()}
              </p>
            </Show>
            <For each={discovery()?.warnings ?? []}>{(warning) => <p class="fhelp cs-warn">{warning}</p>}</For>
            <Show when={discovery()}>
              {(result) => (
                <Show when={result().candidates.length} fallback={<p class="fhelp">Nothing found; enter the settings by hand.</p>}>
                  <p class="fhelp">
                    {result().candidates.length} {result().candidates.length === 1 ? "suggestion" : "suggestions"} from {result().sampledSecretCount} secrets
                  </p>
                  <For each={result().candidates}>
                    {(candidate) => (
                      <div class="cs-lrow cs-lrow--flush">
                        <span class="cs-person-text cs-grow">
                          <span class="cs-strong">{candidate.displayName}</span>
                          <span class="cs-muted mono cs-ellipsis">
                            {[candidate.signals.namespace, candidate.signals.secretNamePrefix, candidate.signals.environmentTag].filter(Boolean).join(" · ") || `${candidate.sampleCount} secrets`}
                          </span>
                        </span>
                        <Button
                          size="compact"
                          onClick={() => {
                            setForm(reconcile(applyCandidate({ ...form, fields: { ...form.fields } }, candidate)));
                            setAdvanced(true);
                          }}
                        >
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
      </form>
    </Dialog>
  );
}

const PAGE_SIZE = 50;

/** Import a vault's existing secrets as references: pick, name, import, then the result. */
export function ImportSecretsDialog(props: { vault: CompanySecretProviderConfig | null; secrets: CompanySecret[]; onClose: () => void }) {
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

