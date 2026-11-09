import type { CompanySecret, CompanySecretProviderConfig, SecretProposalView, SecretProviderDescriptor, UserSecretDefinition } from "@paperclipai/shared";
import { useSearchParams } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { ChevronRight, Ellipsis, Folder, FolderPlus, Plus, RefreshCw, ShieldCheck } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { secretsApi, type MyUserSecretEntry } from "@/api/secrets";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { InitialsDisc } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { Popover } from "@/ui/Popover";
import { Segmented } from "@/ui/Segmented";
import { TonePill, type Tone } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import {
  coverageLabel,
  folderCrumbs,
  folderListing,
  folderNameProblem,
  hasFolders,
  keyFromName,
  keyProblem,
  nameInFolder,
  normalizeFolderPath,
  organizationSecrets,
  proposalMeta,
  proposalTitle,
  providerName,
  referencePlaceholder,
  rotateKinds,
  rotateLabel,
  storeChoices,
  storedIn,
  supportsReferences,
  usesLabel,
  type SecretKind,
} from "./secrets-model";
import { AccessLogDialog } from "./SecretAccessLog";
import { ImportFromVaultButton, ProvidersCard } from "./SecretVaults";
import { CardHead, CardNoteLine, failure, SectionTitle, shortDate } from "./shared";

/*
 * Secrets (board 24): keys and tokens agents use. Values are never shown again after they're
 * saved: a secret can be rotated (a new version), renamed, described, turned off or deleted.
 *
 * - Requests from agents: secrets and bindings an agent proposed while working. The agent supplied
 *   the value with its request, so approving stores it; declining needs a reason the agent reads.
 * - Organization secrets, with where each is used (`/secrets/:id/usage`) and who read it (its
 *   access log, SecretAccessLog.tsx), and an import of an AWS vault's existing secrets. Slashes in
 *   names make folders (`?folder=` opens one; `?view=all` lists every secret flat), as on the old
 *   page. A secret stores a value or links an external reference (a secret that stays in AWS, GCP
 *   or Vault); a reference's update points it elsewhere, or writes a value through when the
 *   provider takes writes.
 * - Providers: where values are stored, this organization's vaults, their health and the default
 *   (SecretVaults.tsx).
 * - Per-person secrets: definitions each person fills in with their own value, and yours.
 */

export function SecretsSection() {
  const company = useCompany();
  const client = useQueryClient();
  const secrets = createQuery(() => ({
    queryKey: queryKeys.projectSettings.secrets(company().id),
    queryFn: ({ signal }) => secretsApi.list(company().id, signal),
  }));
  const configs = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretProviderConfigs(company().id),
    queryFn: ({ signal }) => secretsApi.providerConfigs(company().id, signal),
    retry: false,
  }));
  const refreshSecrets = () => client.invalidateQueries({ queryKey: queryKeys.projectSettings.secrets(company().id) });

  return (
    <>
      <SectionTitle title="Secrets">Keys and tokens agents use. Values are never shown again after you save them.</SectionTitle>
      <ProposalsCard onChanged={refreshSecrets} />
      <OrganizationSecretsCard secrets={secrets.data} loading={secrets.isLoading} error={secrets.isError ? failure(secrets.error, "") : null} configs={configs.data} onChanged={refreshSecrets} />
      <ProvidersCard secrets={organizationSecrets(secrets.data)} />
      <PerPersonCard />
    </>
  );
}

function ProposalsCard(props: { onChanged: () => Promise<unknown> }) {
  const company = useCompany();
  const client = useQueryClient();
  const proposals = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretProposals(company().id),
    queryFn: ({ signal }) => secretsApi.proposals(company().id, signal),
    retry: false,
  }));
  const [declining, setDeclining] = createSignal<SecretProposalView | null>(null);
  const [reason, setReason] = createSignal("");
  const [busy, setBusy] = createSignal<string | null>(null);
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: queryKeys.companySettings.secretProposals(company().id) }), props.onChanged()]);

  const approve = async (proposal: SecretProposalView) => {
    setBusy(proposal.id);
    try {
      await secretsApi.approveProposal(company().id, proposal.id, proposal.secretProposalId ? { cascade: true } : {});
      await refresh();
      pushToast({ tone: "success", title: `Approved ${proposalTitle(proposal).name}` });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't approve the request", body: failure(caught, "") || undefined });
    } finally {
      setBusy(null);
    }
  };
  const decline = async () => {
    const proposal = declining();
    if (!proposal || !reason().trim()) return;
    try {
      await secretsApi.rejectProposal(company().id, proposal.id, { reason: reason().trim() });
      await refresh();
      pushToast({ tone: "success", title: "Declined the request" });
      setDeclining(null);
      setReason("");
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't decline the request", body: failure(caught, "") || undefined });
    }
  };

  return (
    <Show when={(proposals.data?.length ?? 0) > 0}>
      <section class="card settings-card cs-card-green" aria-labelledby="cs-req-secret">
        <CardHead id="cs-req-secret" title="Requests from agents" note="Secrets an agent asked for while working. The agent sent the value with its request." />
        <For each={proposals.data}>
          {(proposal) => {
            const title = () => proposalTitle(proposal);
            return (
              <div class="cs-lrow">
                <div class="cs-person cs-grow">
                  <InitialsDisc name={title().who} seed={proposal.proposedBy.id} size={30} />
                  <span class="cs-person-text">
                    <span>
                      <span class="cs-strong">{title().who}</span> {title().what} <span class="mono">{title().name}</span>
                    </span>
                    <span class="cs-muted">{proposalMeta(proposal)}</span>
                    <Show when={!proposal.viewerCanApprove && proposal.approveBlockReason}>
                      <span class="fhelp">{proposal.approveBlockReason}</span>
                    </Show>
                  </span>
                </div>
                <div class="cs-inline">
                  <Button size="compact" variant="primary" disabled={!proposal.viewerCanApprove || busy() === proposal.id} onClick={() => void approve(proposal)}>
                    {proposal.kind === "secret" ? "Save it" : "Allow"}
                  </Button>
                  <Button size="compact" disabled={busy() === proposal.id} onClick={() => setDeclining(proposal)}>
                    Decline
                  </Button>
                </div>
              </div>
            );
          }}
        </For>
        <Dialog
          open={!!declining()}
          onOpenChange={(open) => !open && setDeclining(null)}
          title="Decline the request?"
          width={460}
          hideClose
          footer={
            <>
              <Button variant="quiet" onClick={() => setDeclining(null)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={!reason().trim()} onClick={() => void decline()}>
                Decline
              </Button>
            </>
          }
        >
          <div class="cs-dialog-body">
            <Field label="Why" for="cs-decline-reason" help="The agent reads this.">
              <TextArea id="cs-decline-reason" rows={3} value={reason()} onInput={(event) => setReason(event.currentTarget.value)} />
            </Field>
          </div>
        </Dialog>
      </section>
    </Show>
  );
}

type SecretEdit = { mode: "new"; folder: string } | { mode: "rotate"; secret: CompanySecret } | { mode: "edit"; secret: CompanySecret };

function OrganizationSecretsCard(props: {
  secrets: CompanySecret[] | undefined;
  loading: boolean;
  error: string | null;
  configs: CompanySecretProviderConfig[] | undefined;
  onChanged: () => Promise<unknown>;
}) {
  const company = useCompany();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams<{ folder?: string; view?: string }>();
  const descriptors = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretProviders(company().id),
    queryFn: ({ signal }) => secretsApi.providers(company().id, signal),
  }));
  const list = createMemo(() => organizationSecrets(props.secrets));
  const [edit, setEdit] = createSignal<SecretEdit | null>(null);
  const [deleting, setDeleting] = createSignal<CompanySecret | null>(null);
  const [logOf, setLogOf] = createSignal<CompanySecret | null>(null);
  const [newFolder, setNewFolder] = createSignal<string | null>(null);

  // Folders come from slashes in names. The view is folders once any name has one, unless the
  // person picked the flat list; `?folder=` opens one (and keeps it across a reload).
  const folder = () => normalizeFolderPath(params.folder ?? "");
  const folderView = () => (params.view === "all" ? false : params.view === "folders" || hasFolders(list()) || !!folder());
  const listing = createMemo(() => (folderView() ? folderListing(list(), folder()) : { folders: [], secrets: list() }));
  const goTo = (path: string) => setParams({ folder: path || undefined });
  const stageFolder = () => {
    const name = newFolder() ?? "";
    if (folderNameProblem(name)) return;
    setParams({ folder: [folder(), name.trim()].filter(Boolean).join("/"), view: "folders" });
    setNewFolder(null);
  };

  const setStatus = async (secret: CompanySecret, status: "active" | "disabled") => {
    try {
      await secretsApi.update(secret.id, { status });
      await props.onChanged();
      pushToast({ tone: "success", title: status === "active" ? `Turned ${secret.name} on` : `Turned ${secret.name} off` });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't change the secret", body: failure(caught, "") || undefined });
    }
  };
  const remove = async () => {
    const secret = deleting();
    if (!secret) return;
    try {
      await secretsApi.remove(secret.id);
      // The server rejects the pending binding requests that name this secret (#20193), so the
      // Proposals card drops them too.
      await Promise.all([props.onChanged(), client.invalidateQueries({ queryKey: queryKeys.companySettings.secretProposals(company().id) })]);
      pushToast({ tone: "success", title: `Deleted ${secret.name}` });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't delete the secret", body: failure(caught, "") || undefined });
      throw caught;
    }
  };

  return (
    <section class="card settings-card" aria-labelledby="cs-secrets">
      <CardHead
        id="cs-secrets"
        title="Organization secrets"
        note={props.secrets ? (list().length === 1 ? "1 secret" : `${list().length} secrets`) : props.loading ? "Loading…" : ""}
        actions={
          <>
            <ImportFromVaultButton secrets={list()} />
            <Button size="compact" variant="primary" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setEdit({ mode: "new", folder: folderView() ? folder() : "" })}>
              New secret
            </Button>
          </>
        }
      />
      <Show when={props.error}>
        <CardNoteLine alert>Couldn't load the secrets. {props.error}</CardNoteLine>
      </Show>
      <Show when={list().length > 0 || folder()}>
        <div class="cs-folder-bar">
          <Show when={folderView()} fallback={<span class="cs-muted">All secrets, by name</span>}>
            <nav class="cs-crumbs" aria-label="Folder">
              <button type="button" class="cs-link-button" aria-current={folder() ? undefined : "page"} onClick={() => goTo("")}>
                All secrets
              </button>
              <For each={folderCrumbs(folder())}>
                {(crumb) => (
                  <>
                    <ChevronRight size={13} aria-hidden="true" class="cs-muted" />
                    <button type="button" class="cs-link-button mono" aria-current={crumb.path === folder() ? "page" : undefined} onClick={() => goTo(crumb.path)}>
                      {crumb.name}
                    </button>
                  </>
                )}
              </For>
            </nav>
          </Show>
          <span class="cs-folder-tools">
            <Show when={folderView()}>
              <Show
                when={newFolder() !== null}
                fallback={
                  <Button size="compact" variant="quiet" icon={<FolderPlus size={14} aria-hidden="true" />} onClick={() => setNewFolder("")}>
                    New folder
                  </Button>
                }
              >
                <form
                  class="cs-inline"
                  onSubmit={(event) => {
                    event.preventDefault();
                    stageFolder();
                  }}
                >
                  <TextInput
                    class="mono cs-field-160"
                    aria-label="Folder name"
                    placeholder="github"
                    autofocus
                    value={newFolder() ?? ""}
                    invalid={!!newFolder() && !!folderNameProblem(newFolder()!)}
                    onInput={(event) => setNewFolder(event.currentTarget.value)}
                    onKeyDown={(event) => event.key === "Escape" && setNewFolder(null)}
                  />
                  <Button size="compact" type="submit" disabled={!!folderNameProblem(newFolder() ?? "")}>
                    Open
                  </Button>
                  <Button size="compact" variant="quiet" onClick={() => setNewFolder(null)}>
                    Cancel
                  </Button>
                </form>
              </Show>
            </Show>
            <Segmented
              label="Show secrets"
              options={[
                { value: "folders", label: "Folders" },
                { value: "all", label: "All" },
              ]}
              value={folderView() ? "folders" : "all"}
              onChange={(value) => setParams({ view: value, folder: value === "all" ? undefined : params.folder })}
            />
          </span>
        </div>
      </Show>
      <Show
        when={listing().secrets.length + listing().folders.length > 0}
        fallback={
          <Show when={props.secrets}>
            <CardNoteLine>{folder() ? `Nothing in ${folder()} yet. A secret named ${folder()}/… lands here.` : "No secrets yet."}</CardNoteLine>
          </Show>
        }
      >
        <div class="cs-table cs-table--secrets" role="table" aria-label="Organization secrets">
          <div class="cs-thead" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader">Stored in</span>
            <span role="columnheader">Used by</span>
            <span role="columnheader">Updated</span>
            <span role="columnheader">
              <span class="sr-only">Actions</span>
            </span>
          </div>
          <For each={listing().folders}>
            {(entry) => (
              <div class="cs-trow" role="row">
                <span role="cell" class="cs-person-text">
                  <button type="button" class="cs-folder-link" onClick={() => goTo(entry.path)}>
                    <Folder size={14} aria-hidden="true" />
                    <span class="mono cs-strong cs-ellipsis">{entry.name}</span>
                  </button>
                </span>
                <span role="cell" class="cs-muted">
                  {entry.secretCount === 1 ? "1 secret" : `${entry.secretCount} secrets`}
                </span>
                <span role="cell" />
                <span role="cell" />
                <span role="cell" />
              </div>
            )}
          </For>
          <For each={listing().secrets}>
            {(secret) => {
              const rotate = () => rotateLabel(secret);
              return (
                <div class="cs-trow" role="row" classList={{ "cs-trow--quiet": secret.status !== "active" }}>
                  <span role="cell" class="cs-person-text">
                    <span class="mono cs-strong cs-ellipsis" title={secret.name}>
                      {folderView() ? nameInFolder(secret.name, folder()) : secret.name}
                    </span>
                    <Show when={secret.managedMode === "external_reference" && secret.externalRef}>
                      <span class="cs-muted mono cs-ellipsis" title={secret.externalRef!}>
                        → {secret.externalRef}
                      </span>
                    </Show>
                    <Show when={secret.description || secret.status !== "active"}>
                      <span class="cs-muted cs-ellipsis">{secret.status !== "active" ? `Turned off${secret.description ? ` · ${secret.description}` : ""}` : secret.description}</span>
                    </Show>
                  </span>
                  <span role="cell" class="cs-muted">
                    {storedIn(secret, props.configs)}
                    {secret.managedMode === "external_reference" ? " · reference" : ""}
                  </span>
                  <span role="cell">
                    <UsagePopover secret={secret} />
                  </span>
                  <span role="cell" class="cs-muted">
                    {shortDate(secret.lastRotatedAt ?? secret.updatedAt)}
                  </span>
                  <span role="cell" class="cs-cell-end">
                    <Menu placement="bottom-end">
                      <Menu.Trigger as={Button} variant="icon" ghost size="compact" aria-label={`More actions for ${secret.name}`}>
                        <Ellipsis size={16} aria-hidden="true" />
                      </Menu.Trigger>
                      <Menu.Content label="Secret actions" width={260}>
                        <Menu.Item icon={<RefreshCw size={14} />} onSelect={() => setEdit({ mode: "rotate", secret })} description={rotate().help}>
                          {rotate().title}
                        </Menu.Item>
                        <Menu.Item onSelect={() => setEdit({ mode: "edit", secret })} description="A slash in the name files it in a folder">
                          Rename or describe
                        </Menu.Item>
                        <Menu.Item onSelect={() => setLogOf(secret)} description="Each time a run or plugin read it">
                          Access log
                        </Menu.Item>
                        <Show when={secret.status === "active"} fallback={<Menu.Item onSelect={() => void setStatus(secret, "active")}>Turn on</Menu.Item>}>
                          <Menu.Item onSelect={() => void setStatus(secret, "disabled")} description="Runs that need it fail until it's on again">
                            Turn off
                          </Menu.Item>
                        </Show>
                        <Menu.Separator />
                        <Menu.Item danger onSelect={() => setDeleting(secret)}>
                          Delete…
                        </Menu.Item>
                      </Menu.Content>
                    </Menu>
                  </span>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
      <SecretDialog edit={edit()} descriptors={descriptors.data} configs={props.configs} onClose={() => setEdit(null)} onSaved={props.onChanged} />
      <AccessLogDialog secret={logOf()} onClose={() => setLogOf(null)} />
      <ConfirmDialog
        open={!!deleting()}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting()?.name ?? ""}?`}
        body={
          (deleting()?.referenceCount
            ? `It's used in ${deleting()!.referenceCount === 1 ? "one place" : `${deleting()!.referenceCount} places`}; runs there fail until they use another secret. `
            : "") +
          (deleting()?.managedMode === "external_reference" ? "Only the reference is removed; the secret stays in the provider." : "Its value is deleted and can't be recovered.")
        }
        confirmLabel="Delete"
        danger
        onConfirm={remove}
      />
    </section>
  );
}

function UsagePopover(props: { secret: CompanySecret }) {
  const [open, setOpen] = createSignal(false);
  const usage = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretUsage(props.secret.id),
    queryFn: ({ signal }) => secretsApi.usage(props.secret.id, signal),
    enabled: open(),
  }));
  return (
    <Show when={props.secret.referenceCount} fallback={<span class="cs-muted">Not used</span>}>
      <Popover open={open()} onOpenChange={setOpen}>
        <Popover.Trigger class="cs-link-button">{usesLabel(props.secret.referenceCount)}</Popover.Trigger>
        <Popover.Content title={`Where ${props.secret.name} is used`} width={360}>
          <Switch>
            <Match when={usage.isLoading}>
              <p class="cs-muted">Loading…</p>
            </Match>
            <Match when={usage.isError}>
              <p class="cs-bad">Couldn't load where it's used.</p>
            </Match>
            <Match when={usage.data}>
              <ul class="cs-usage">
                <For each={usage.data!.bindings} fallback={<li class="cs-muted">Nothing uses it now.</li>}>
                  {(binding) => (
                    <li>
                      <Show when={binding.target.href} fallback={<span class="cs-strong">{binding.target.label}</span>}>
                        <a class="ps-link" href={binding.target.href!}>
                          {binding.target.label}
                        </a>
                      </Show>
                      <span class="cs-muted mono">{binding.configPath}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Match>
          </Switch>
        </Popover.Content>
      </Popover>
    </Show>
  );
}

/*
 * New secret, Rotate (or Update for a reference) and Rename. A new secret stores a value, or links
 * one a provider already holds (an external reference, read at run time), in the default store or
 * a vault. A reference's update points it elsewhere (or at a pinned version), or writes a new value
 * through to the provider when it takes writes (AWS).
 */
function SecretDialog(props: {
  edit: SecretEdit | null;
  descriptors: SecretProviderDescriptor[] | undefined;
  configs: CompanySecretProviderConfig[] | undefined;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const company = useCompany();
  const [name, setName] = createSignal("");
  const [value, setValue] = createSignal("");
  const [reference, setReference] = createSignal("");
  const [version, setVersion] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [kind, setKind] = createSignal<SecretKind>("managed");
  const [store, setStore] = createSignal("");
  const [rotateKind, setRotateKind] = createSignal<"value" | "reference">("value");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const referencesOffered = () => supportsReferences(props.descriptors, props.configs);
  const stores = createMemo(() => storeChoices(kind(), props.descriptors, props.configs));
  const chosenStore = () => stores().find((entry) => entry.value === store()) ?? stores()[0];
  const rotating = () => (props.edit?.mode === "rotate" ? props.edit.secret : null);
  const kinds = () => (rotating() ? rotateKinds(rotating()!, props.descriptors) : (["value"] as const));
  // Each opening starts from the secret it edits.
  createEffect(
    on(
      () => props.edit,
      (edit) => {
        setName(edit && edit.mode !== "new" ? edit.secret.name : edit?.folder ? `${edit.folder}/` : "");
        setDescription(edit && edit.mode !== "new" ? (edit.secret.description ?? "") : "");
        setValue("");
        setReference(edit?.mode === "rotate" ? (edit.secret.externalRef ?? "") : "");
        setVersion("");
        setKind("managed");
        setStore("");
        setRotateKind(edit?.mode === "rotate" ? rotateKinds(edit.secret, props.descriptors)[0]! : "value");
        setProblem(null);
      },
    ),
  );

  const linking = () => (props.edit?.mode === "new" && kind() === "external") || (props.edit?.mode === "rotate" && rotateKind() === "reference");

  const save = async () => {
    const edit = props.edit;
    if (!edit) return;
    setProblem(null);
    if (edit.mode !== "rotate" && (!name().trim() || name().trim().endsWith("/"))) return setProblem("Enter a name.");
    if (edit.mode !== "edit" && !linking() && !value()) return setProblem("Enter the value.");
    if (linking() && !reference().trim()) return setProblem("Enter the reference.");
    if (edit.mode === "new" && kind() === "external" && !chosenStore()) return setProblem("No provider here can hold references.");
    setBusy(true);
    try {
      if (edit.mode === "new") {
        const target = chosenStore();
        await secretsApi.create(company().id, {
          name: normalizeFolderPath(name()),
          description: description().trim() || null,
          providerConfigId: target?.providerConfigId ?? null,
          ...(target?.provider ? { provider: target.provider } : {}),
          ...(kind() === "external"
            ? { managedMode: "external_reference" as const, externalRef: reference().trim(), providerVersionRef: version().trim() || null }
            : { managedMode: "paperclip_managed" as const, value: value() }),
        });
      } else if (edit.mode === "rotate") {
        await secretsApi.rotate(edit.secret.id, linking() ? { externalRef: reference().trim(), providerVersionRef: version().trim() || null } : { value: value() });
      } else {
        await secretsApi.update(edit.secret.id, { name: normalizeFolderPath(name()), description: description().trim() || null });
      }
      await props.onSaved();
      pushToast({
        tone: "success",
        title: edit.mode === "new" ? (kind() === "external" ? `Linked ${normalizeFolderPath(name())}` : `Saved ${normalizeFolderPath(name())}`) : edit.mode === "rotate" ? `Updated ${edit.secret.name}` : "Saved the secret",
      });
      setValue("");
      props.onClose();
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the secret."));
    } finally {
      setBusy(false);
    }
  };

  const title = () => {
    const edit = props.edit;
    if (!edit) return "";
    if (edit.mode === "new") return "New secret";
    if (edit.mode === "rotate") return edit.secret.managedMode === "external_reference" ? `Update ${edit.secret.name}` : `Rotate ${edit.secret.name}`;
    return `Edit ${edit.secret.name}`;
  };
  const describe = () => {
    const edit = props.edit;
    if (edit?.mode !== "rotate") return undefined;
    if (edit.secret.managedMode !== "external_reference") return "Runs that start after this use the new value.";
    return rotateKind() === "value" ? `Written to ${edit.secret.externalRef} in ${providerName(edit.secret.provider)}. Runs that start after this read it.` : "Paperclip reads the secret from here on the next run; nothing is written to the provider.";
  };

  return (
    <Dialog
      open={!!props.edit}
      onOpenChange={(open) => !open && props.onClose()}
      title={title()}
      description={describe()}
      width={540}
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
            {busy() ? "Saving…" : props.edit?.mode === "rotate" ? (rotating()?.managedMode === "external_reference" ? "Update" : "Rotate") : props.edit?.mode === "new" && kind() === "external" ? "Link" : "Save"}
          </Button>
        </>
      }
    >
      <div class="cs-dialog-body">
        <Show when={props.edit?.mode === "new" && referencesOffered()}>
          <Segmented
            label="What it is"
            options={[
              { value: "managed", label: "Store a value" },
              { value: "external", label: "Link a reference" },
            ]}
            value={kind()}
            onChange={(next) => {
              setKind(next);
              setStore("");
            }}
          />
        </Show>
        <Show when={kinds().length > 1}>
          <Segmented
            label="How to update it"
            options={[
              { value: "reference", label: "Point elsewhere" },
              { value: "value", label: "Write a new value" },
            ]}
            value={rotateKind()}
            onChange={setRotateKind}
          />
        </Show>
        <Show when={props.edit?.mode !== "rotate"}>
          <Field label="Name" for="cs-secret-name" help="What variables refer to, such as GITHUB_TOKEN. A slash files it in a folder: github/DEPLOY_TOKEN.">
            <TextInput id="cs-secret-name" class="mono" autocomplete="off" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
          </Field>
        </Show>
        <Show when={props.edit?.mode === "new" && stores().length > 1}>
          <Field label="Stored in" for="cs-secret-store" help={kind() === "external" ? "The provider that holds it." : "Vaults are set up under Providers below."}>
            <select id="cs-secret-store" class="input" value={chosenStore()?.value ?? ""} onChange={(event) => setStore(event.currentTarget.value)}>
              <For each={stores()}>{(entry) => <option value={entry.value}>{entry.label}</option>}</For>
            </select>
          </Field>
        </Show>
        <Show when={props.edit?.mode === "new" && kind() === "external" && stores().length === 1}>
          <p class="cs-muted">In {stores()[0]!.label}.</p>
        </Show>
        <Show when={linking()}>
          <Field label="Reference" for="cs-secret-ref" help="Its name, path or ARN in the provider. Paperclip reads it at run time and never stores the value.">
            <TextInput
              id="cs-secret-ref"
              class="mono"
              autocomplete="off"
              placeholder={referencePlaceholder(props.edit?.mode === "rotate" ? rotating()?.provider : chosenStore()?.provider)}
              value={reference()}
              onInput={(event) => setReference(event.currentTarget.value)}
            />
          </Field>
          <Field label="Version" for="cs-secret-version" help="Optional. Pin one version; empty follows the latest.">
            <TextInput id="cs-secret-version" class="mono" autocomplete="off" value={version()} onInput={(event) => setVersion(event.currentTarget.value)} />
          </Field>
        </Show>
        <Show when={props.edit?.mode !== "edit" && !linking()}>
          <Field label={props.edit?.mode === "rotate" ? "New value" : "Value"} for="cs-secret-value" help="Never shown again after you save it.">
            <TextInput id="cs-secret-value" type="password" autocomplete="new-password" value={value()} onInput={(event) => setValue(event.currentTarget.value)} />
          </Field>
        </Show>
        <Show when={props.edit?.mode !== "rotate"}>
          <Field label="Description" for="cs-secret-description" help="Optional.">
            <TextInput id="cs-secret-description" value={description()} onInput={(event) => setDescription(event.currentTarget.value)} />
          </Field>
        </Show>
      </div>
    </Dialog>
  );
}

function PerPersonCard() {
  const company = useCompany();
  const client = useQueryClient();
  const definitions = createQuery(() => ({
    queryKey: queryKeys.projectSettings.userSecretDefinitions(company().id),
    queryFn: ({ signal }) => secretsApi.userDefinitions(company().id, signal),
    retry: false,
  }));
  const mine = createQuery(() => ({
    queryKey: queryKeys.companySettings.mySecrets(company().id),
    queryFn: ({ signal }) => secretsApi.mySecrets(company().id, signal),
    retry: false,
  }));
  const active = createMemo(() => (definitions.data ?? []).filter((definition) => definition.status !== "deleted"));
  const myEntry = (definitionId: string) => mine.data?.find((entry) => entry.definition.id === definitionId);
  const [defining, setDefining] = createSignal(false);
  const [setting, setSetting] = createSignal<{ definition: UserSecretDefinition; entry: MyUserSecretEntry | undefined } | null>(null);
  const [removing, setRemoving] = createSignal<UserSecretDefinition | null>(null);
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.projectSettings.userSecretDefinitions(company().id) }),
      client.invalidateQueries({ queryKey: queryKeys.companySettings.mySecrets(company().id) }),
    ]);

  const removeMine = async (entry: MyUserSecretEntry) => {
    if (!entry.secret) return;
    try {
      await secretsApi.removeMySecret(company().id, entry.secret.id);
      await refresh();
      pushToast({ tone: "success", title: `Removed your ${entry.definition.key}` });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't remove it", body: failure(caught, "") || undefined });
    }
  };
  const removeDefinition = async () => {
    const definition = removing();
    if (!definition) return;
    try {
      await secretsApi.removeUserDefinition(company().id, definition.id);
      await refresh();
      pushToast({ tone: "success", title: `Deleted ${definition.key}` });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't delete it", body: failure(caught, "") || undefined });
      throw caught;
    }
  };

  return (
    <section class="card settings-card" aria-labelledby="cs-personal">
      <CardHead
        id="cs-personal"
        title="Per-person secrets"
        note="Secrets each person sets for themselves, such as their own GitHub token."
        actions={
          <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setDefining(true)}>
            Define one
          </Button>
        }
      />
      <Show when={definitions.isError}>
        <CardNoteLine alert>Couldn't load them. {failure(definitions.error, "")}</CardNoteLine>
      </Show>
      <For each={active()} fallback={<Show when={definitions.data}><CardNoteLine>None defined yet.</CardNoteLine></Show>}>
        {(definition) => {
          const entry = () => myEntry(definition.id);
          return (
            <div class="cs-lrow">
              <div class="cs-person-text cs-grow">
                <span class="mono cs-strong">{definition.key}</span>
                <span class="cs-muted">
                  {definition.name !== definition.key ? `${definition.name} · ` : ""}
                  <Coverage definitionId={definition.id} />
                </span>
              </div>
              <Show when={entry()?.secret} fallback={<span class="cs-pill">Yours isn't set</span>}>
                <TonePill tone="green" compact>
                  Yours is set
                </TonePill>
              </Show>
              <Button size="compact" onClick={() => setSetting({ definition, entry: entry() })}>
                {entry()?.secret ? "Edit yours" : "Set yours"}
              </Button>
              <Menu placement="bottom-end">
                <Menu.Trigger as={Button} variant="icon" ghost size="compact" aria-label={`More actions for ${definition.key}`}>
                  <Ellipsis size={16} aria-hidden="true" />
                </Menu.Trigger>
                <Menu.Content label="Per-person secret actions" width={240}>
                  <Show when={entry()?.secret}>
                    <Menu.Item onSelect={() => void removeMine(entry()!)}>Remove yours</Menu.Item>
                  </Show>
                  <Menu.Item danger onSelect={() => setRemoving(definition)} description="For everyone">
                    Delete…
                  </Menu.Item>
                </Menu.Content>
              </Menu>
            </div>
          );
        }}
      </For>
      <DefineDialog open={defining()} onOpenChange={setDefining} onSaved={refresh} />
      <MySecretDialog target={setting()} onClose={() => setSetting(null)} onSaved={refresh} />
      <ConfirmDialog
        open={!!removing()}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Delete ${removing()?.key ?? ""}?`}
        body="Everyone's own values for it are deleted too, and variables that use it stop working."
        confirmLabel="Delete"
        danger
        onConfirm={removeDefinition}
      />
    </section>
  );
}

function Coverage(props: { definitionId: string }) {
  const company = useCompany();
  const coverage = createQuery(() => ({
    queryKey: queryKeys.companySettings.userSecretCoverage(company().id, props.definitionId),
    queryFn: ({ signal }) => secretsApi.userDefinitionCoverage(company().id, props.definitionId, signal),
    retry: false,
  }));
  return <>{coverageLabel(coverage.data)}</>;
}

function DefineDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => Promise<unknown> }) {
  const company = useCompany();
  const [name, setName] = createSignal("");
  const [key, setKey] = createSignal("");
  const [keyTouched, setKeyTouched] = createSignal(false);
  const [description, setDescription] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const effectiveKey = () => (keyTouched() ? key() : keyFromName(name()));

  const save = async () => {
    const found = !name().trim() ? "Enter a name." : keyProblem(effectiveKey());
    if (found) return setProblem(found);
    setBusy(true);
    setProblem(null);
    try {
      await secretsApi.createUserDefinition(company().id, { key: effectiveKey().trim(), name: name().trim(), description: description().trim() || null });
      await props.onSaved();
      pushToast({ tone: "success", title: `Defined ${effectiveKey().trim()}` });
      setName("");
      setKey("");
      setKeyTouched(false);
      setDescription("");
      props.onOpenChange(false);
    } catch (caught) {
      setProblem(failure(caught, "Couldn't define it."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Define a per-person secret"
      description="Each person sets their own value; variables can then use whoever's running the work."
      width={520}
      footer={
        <>
          <Show when={problem()}>
            <span class="nt-error ps-foot-error" role="alert">
              {problem()}
            </span>
          </Show>
          <Button variant="quiet" disabled={busy()} onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy()} onClick={() => void save()}>
            {busy() ? "Saving…" : "Define"}
          </Button>
        </>
      }
    >
      <div class="cs-dialog-body">
        <Field label="Name" for="cs-def-name">
          <TextInput id="cs-def-name" value={name()} placeholder="Personal GitHub token" onInput={(event) => setName(event.currentTarget.value)} />
        </Field>
        <Field label="Key" for="cs-def-key" help="What variables refer to.">
          <TextInput
            id="cs-def-key"
            class="mono"
            value={effectiveKey()}
            onInput={(event) => {
              setKeyTouched(true);
              setKey(event.currentTarget.value);
            }}
          />
        </Field>
        <Field label="Description" for="cs-def-description" help="Optional. Tell people where to get the value.">
          <TextInput id="cs-def-description" value={description()} onInput={(event) => setDescription(event.currentTarget.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function MySecretDialog(props: { target: { definition: UserSecretDefinition; entry: MyUserSecretEntry | undefined } | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const company = useCompany();
  const [value, setValue] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);

  const save = async () => {
    const target = props.target;
    if (!target) return;
    if (!value()) return setProblem("Enter the value.");
    setBusy(true);
    setProblem(null);
    try {
      if (target.entry?.secret) await secretsApi.rotateMySecret(company().id, target.entry.secret.id, value());
      else await secretsApi.setMySecret(company().id, target.definition.id, value());
      await props.onSaved();
      pushToast({ tone: "success", title: `Saved your ${target.definition.key}` });
      setValue("");
      props.onClose();
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save it."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={!!props.target}
      onOpenChange={(open) => !open && props.onClose()}
      title={`Your ${props.target?.definition.key ?? ""}`}
      description={props.target?.definition.description ?? props.target?.definition.usageGuidance ?? undefined}
      width={480}
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
            {busy() ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div class="cs-dialog-body">
        <Field label={props.target?.entry?.secret ? "New value" : "Value"} for="cs-my-value" help="Only runs you're responsible for use it. Never shown again after you save it.">
          <TextInput id="cs-my-value" type="password" autocomplete="new-password" value={value()} onInput={(event) => setValue(event.currentTarget.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
