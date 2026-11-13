import type { CompanySecretProviderConfig, SecretProvider, SecretProviderDescriptor, SecretStatus } from "@paperclipai/shared";
import { useSearchParams } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  Cloud,
  CornerLeftUp,
  Ellipsis,
  Folder,
  FolderPlus,
  Link2,
  ListFilter,
  Plus,
  Search,
  Users,
  X,
} from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { secretsApi } from "@/api/secrets";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Field, TextInput } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { Menu } from "@/ui/Menu";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import { MySecretDialog, MySecrets, type MySecretTarget } from "./MySecrets";
import { NewSecretDialog, type NewSecretTarget } from "./NewSecretDialog";
import { SecretDetails, SecretEditDialog, type SecretEdit } from "./SecretDetails";
import { RowMenu, SecretName, type SecretActions } from "./SecretParts";
import { SecretRequests } from "./SecretRequests";
import {
  agentUsage,
  coverageShort,
  filterChips,
  filterRows,
  folderCountsLabel,
  folderCrumbs,
  folderListing,
  folderNameProblem,
  managedLabel,
  NO_FILTERS,
  normalizeFolderPath,
  parentFolder,
  providerKind,
  rowAgents,
  secretRows,
  splitByOrigin,
  statusLabel,
  usedByLabel,
  vaultLine,
  whenLabel,
  importableVaults,
  type ManagedOrigin,
  type SecretFilters,
  type SecretRow,
} from "./secrets-model";
import { ImportSecretsDialog, VaultsTab } from "./SecretVaults";
import { CardNoteLine, copyText, failure, SectionTitle } from "./shared";
import "./Secrets.css";

/*
 * Settings → Secrets (board 24), following upstream's redesign (#21225, build plan U135). Four
 * tabs, the current one in `?tab=`:
 *
 * - Secrets: the secrets the team added, provided by the organization (one shared value) or by
 *   each user (everyone adds their own; the definitions), with who provides the value and which
 *   agents use it. Folders come from slashes in names and are always on (`?folder=`, or the old
 *   page's `?path=`); a search lists matches across every folder. Credentials Paperclip saved
 *   itself collapse under "Managed by Paperclip", grouped by origin. One Filter menu covers
 *   provided by, storage and status; archived secrets stay hidden until asked for. A row opens its
 *   details (`?secret=<id>` or `?definition=<id>`, SecretDetails.tsx).
 * - My secrets: the values only you provide (MySecrets.tsx).
 * - Vaults: where values are kept (SecretVaults.tsx).
 * - Requests: the secrets agents asked to save or use (SecretRequests.tsx).
 *
 * New secret is one step (NewSecretDialog.tsx). "More secret actions" holds New folder and
 * importing an AWS vault's existing secrets.
 */

type Tab = "secrets" | "mine" | "vaults" | "requests";
const TABS: readonly Tab[] = ["secrets", "mine", "vaults", "requests"];

export function SecretsSection() {
  const company = useCompany();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams<{ tab?: string; folder?: string; path?: string; secret?: string; definition?: string }>();
  const tab = (): Tab => (TABS.includes(params.tab as Tab) ? (params.tab as Tab) : "secrets");
  const setTab = (next: Tab) => setParams({ tab: next === "secrets" ? undefined : next });

  const secrets = createQuery(() => ({
    queryKey: queryKeys.projectSettings.secrets(company().id),
    queryFn: ({ signal }) => secretsApi.list(company().id, signal),
  }));
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
  const descriptors = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretProviders(company().id),
    queryFn: ({ signal }) => secretsApi.providers(company().id, signal),
    staleTime: 5 * 60_000,
  }));
  const configs = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretProviderConfigs(company().id),
    queryFn: ({ signal }) => secretsApi.providerConfigs(company().id, signal),
    retry: false,
  }));
  const health = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretProviderHealth(company().id),
    queryFn: ({ signal }) => secretsApi.providerHealth(company().id, signal),
    retry: false,
    refetchInterval: 60_000,
  }));
  const pending = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretProposals(company().id),
    queryFn: ({ signal }) => secretsApi.proposals(company().id, signal),
    retry: false,
  }));
  const agents = useAgentsQuery();

  const rows = createMemo(() => secretRows(secrets.data, definitions.data));
  const usage = createMemo(() => agentUsage(agents.data));
  const selected = createMemo((): SecretRow | null => {
    if (params.secret) return rows().find((row) => row.kind === "company" && row.secret.id === params.secret) ?? null;
    if (params.definition) return rows().find((row) => row.kind === "user" && row.definition.id === params.definition) ?? null;
    return null;
  });

  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["secrets"] }),
      client.invalidateQueries({ queryKey: ["user-secret-definitions", company().id] }),
      client.invalidateQueries({ queryKey: queryKeys.companySettings.mySecrets(company().id) }),
      client.invalidateQueries({ queryKey: queryKeys.companySettings.secretProviderConfigs(company().id) }),
    ]);

  const [creating, setCreating] = createSignal<NewSecretTarget | null>(null);
  const [edit, setEdit] = createSignal<SecretEdit | null>(null);
  const [deleting, setDeleting] = createSignal<SecretRow | null>(null);
  const [settingMine, setSettingMine] = createSignal<MySecretTarget | null>(null);
  const [importing, setImporting] = createSignal<CompanySecretProviderConfig | null>(null);
  const [newFolder, setNewFolder] = createSignal<string | null>(null);

  const folder = () => normalizeFolderPath(params.folder ?? params.path ?? "");
  const openRow = (row: SecretRow) => setParams(row.kind === "company" ? { secret: row.secret.id, definition: undefined } : { secret: undefined, definition: row.definition.id });
  const closeDetails = () => setParams({ secret: undefined, definition: undefined });
  const importable = createMemo(() => importableVaults(configs.data));

  const setStatus = async (row: SecretRow, status: SecretStatus) => {
    try {
      if (row.kind === "company") await secretsApi.update(row.secret.id, { status });
      else await secretsApi.updateUserDefinition(company().id, row.definition.id, { status });
      await refresh();
      const verb = status === "active" ? (row.status === "archived" ? "Restored" : "Turned on") : status === "disabled" ? "Turned off" : "Archived";
      pushToast({ tone: "success", title: `${verb} ${row.name}` });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't change the secret", body: failure(caught, "") || undefined });
    }
  };

  const remove = async () => {
    const row = deleting();
    if (!row) return;
    try {
      if (row.kind === "company") await secretsApi.remove(row.secret.id);
      else await secretsApi.removeUserDefinition(company().id, row.definition.id);
      // The server rejects the pending binding requests that name a deleted secret (#20193).
      await Promise.all([refresh(), client.invalidateQueries({ queryKey: ["secret-proposals", company().id] })]);
      if (selected()?.id === row.id) closeDetails();
      pushToast({ tone: "success", title: `Deleted ${row.name}` });
    } catch (caught) {
      pushToast({ tone: "error", title: "Couldn't delete the secret", body: failure(caught, "") || undefined });
      throw caught;
    }
  };

  const actions: SecretActions = {
    open: openRow,
    rotate: (secret) => setEdit({ mode: "rotate", secret }),
    rename: (secret) => setEdit({ mode: "edit", secret }),
    editDefinition: (definition) => setCreating({ mode: "edit", definition }),
    setMine: (definition) => setSettingMine({ definition, secret: mine.data?.find((entry) => entry.definition.id === definition.id)?.secret ?? null }),
    setStatus: (row, status) => void setStatus(row, status),
    remove: setDeleting,
    copyLink: () =>
      void copyText(window.location.href).then((ok) => pushToast(ok ? { tone: "success", title: "Copied the link" } : { tone: "error", title: "Couldn't copy the link" })),
    goToVaults: () => setParams({ tab: "vaults", secret: undefined, definition: undefined }),
    hasMine: (definitionId) => !!mine.data?.find((entry) => entry.definition.id === definitionId)?.secret,
    descriptors: () => descriptors.data,
  };

  const deleteBody = () => {
    const row = deleting();
    if (!row) return "";
    if (row.kind === "user") return "It's removed for the whole organization. Everyone's own values stop being used, and agents that rely on it fail until they get another secret.";
    const uses = row.secret.referenceCount ?? 0;
    return (
      (uses ? `It's used in ${uses === 1 ? "one place" : `${uses} places`}; runs there fail until they use another secret. ` : "") +
      (row.secret.managedMode === "external_reference" ? "Only the reference is removed; the secret stays in the provider." : "Its value is deleted and can't be recovered.")
    );
  };

  const pendingCount = () => pending.data?.length ?? 0;

  return (
    <>
      <SectionTitle
        title={
          <span class="info-line">
            Secrets
            <InfoTip label="How secrets work">
              API keys and tokens your agents use while they work. Add a secret once: the organization provides one shared value, or each user adds their own. Choose which agents can use it,
              here or in an agent's settings. When a run starts, the agent reads it as an environment variable, such as GITHUB_TOKEN. Values are never shown again after they're saved.
            </InfoTip>
          </span>
        }
        aside={
          <div class="sec-head-actions">
            <Menu placement="bottom-end">
              <Menu.Trigger as={Button} variant="icon" size="compact" aria-label="More secret actions">
                <Ellipsis size={16} aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Content label="More secret actions" width={280}>
                <Menu.Item
                  icon={<FolderPlus size={14} />}
                  onSelect={() => {
                    setParams({ tab: undefined, secret: undefined, definition: undefined });
                    setNewFolder("");
                  }}
                >
                  New folder
                </Menu.Item>
                <Show
                  when={importable().length > 0}
                  fallback={
                    <Menu.Item icon={<Cloud size={14} />} disabled description="Connect an AWS vault under Vaults first">
                      Import from a vault
                    </Menu.Item>
                  }
                >
                  <For each={importable()}>
                    {(config) => (
                      <Menu.Item icon={<Cloud size={14} />} onSelect={() => setImporting(config)}>
                        Import from {config.displayName}
                      </Menu.Item>
                    )}
                  </For>
                </Show>
              </Menu.Content>
            </Menu>
            <Button size="compact" variant="primary" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setCreating({ mode: "new", prefix: tab() === "secrets" && folder() ? `${folder()}/` : "" })}>
              New secret
            </Button>
          </div>
        }
      />
      <div class="sec-tabs">
        <Segmented
          label="Secrets views"
          options={[
            { value: "secrets", label: "Secrets" },
            { value: "mine", label: "My secrets" },
            { value: "vaults", label: "Vaults" },
            { value: "requests", label: pendingCount() ? `Requests · ${pendingCount()}` : "Requests" },
          ]}
          value={tab()}
          onChange={setTab}
        />
      </div>
      <Switch>
        <Match when={tab() === "secrets"}>
          <SecretList
            rows={rows()}
            loading={secrets.isLoading || definitions.isLoading}
            error={secrets.isError ? failure(secrets.error, "") : definitions.isError ? failure(definitions.error, "") : null}
            folder={folder()}
            goTo={(path) => setParams({ folder: path || undefined, path: undefined })}
            usage={usage()}
            configs={configs.data}
            descriptors={descriptors.data}
            selectedId={selected()?.id}
            newFolder={newFolder()}
            setNewFolder={setNewFolder}
            onCreate={() => setCreating({ mode: "new", prefix: folder() ? `${folder()}/` : "" })}
            actions={actions}
          />
        </Match>
        <Match when={tab() === "mine"}>
          <MySecrets entries={mine.data} loading={mine.isLoading} error={mine.isError ? failure(mine.error, "") : null} onSet={setSettingMine} onChanged={refresh} />
        </Match>
        <Match when={tab() === "vaults"}>
          <VaultsTab secrets={secrets.data} descriptors={descriptors.data} configs={configs.data} configsLoading={configs.isLoading} configsError={configs.isError ? failure(configs.error, "") : null} onImport={setImporting} />
        </Match>
        <Match when={tab() === "requests"}>
          <SecretRequests onChanged={refresh} />
        </Match>
      </Switch>

      <SecretDetails row={selected()} usage={usage()} agents={agents.data} configs={configs.data} actions={actions} onClose={closeDetails} />
      <NewSecretDialog
        target={creating()}
        descriptors={descriptors.data}
        configs={configs.data}
        health={health.data}
        agents={agents.data}
        onClose={() => setCreating(null)}
        onSaved={async (row) => {
          await refresh();
          if (row) openRow(row);
        }}
        onManageVaults={actions.goToVaults}
      />
      <SecretEditDialog edit={edit()} descriptors={descriptors.data} onClose={() => setEdit(null)} onSaved={refresh} />
      <MySecretDialog target={settingMine()} onClose={() => setSettingMine(null)} onSaved={refresh} />
      <ImportSecretsDialog vault={importing()} secrets={secrets.data ?? []} onClose={() => setImporting(null)} />
      <ConfirmDialog
        open={!!deleting()}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting()?.name ?? ""}?`}
        body={deleteBody()}
        confirmLabel="Delete"
        danger
        onConfirm={remove}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The Secrets tab

function SecretList(props: {
  rows: SecretRow[];
  loading: boolean;
  error: string | null;
  folder: string;
  goTo: (path: string) => void;
  usage: ReturnType<typeof agentUsage>;
  configs: CompanySecretProviderConfig[] | undefined;
  descriptors: SecretProviderDescriptor[] | undefined;
  selectedId: string | undefined;
  newFolder: string | null;
  setNewFolder: (value: string | null) => void;
  onCreate: () => void;
  actions: SecretActions;
}) {
  const [filters, setFilters] = createSignal<SecretFilters>(NO_FILTERS);
  const [managedOpen, setManagedOpen] = createSignal(false);
  const [openGroups, setOpenGroups] = createSignal<ReadonlySet<ManagedOrigin>>(new Set());
  const searching = () => filters().search.trim().length > 0;
  const filtered = createMemo(() => filterRows(props.rows, filters()));
  const split = createMemo(() => splitByOrigin(filtered()));
  const listing = createMemo(() => (searching() ? { folders: [], secrets: split().team } : folderListing(split().team, props.folder)));
  const chips = createMemo(() => filterChips(filters(), (provider) => providerKind(provider, props.descriptors)));
  const filtersSet = () => chips().length > 0;
  const showManaged = () => split().managedCount > 0 && (searching() || !props.folder);
  const managedExpanded = () => managedOpen() || searching();
  const noTeamRows = () => listing().folders.length === 0 && listing().secrets.length === 0;
  const setFilter = <K extends keyof SecretFilters>(key: K, value: SecretFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const clearChip = (key: keyof SecretFilters) => setFilter(key, NO_FILTERS[key]);
  const toggleGroup = (id: ManagedOrigin) =>
    setOpenGroups((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const stageFolder = () => {
    const name = props.newFolder ?? "";
    if (folderNameProblem(name)) return;
    props.goTo([props.folder, name.trim()].filter(Boolean).join("/"));
    props.setNewFolder(null);
  };

  return (
    <section class="card settings-card" aria-label="The team's secrets">
      <div class="sec-toolbar" role="toolbar" aria-label="Secrets controls">
        <div class="sec-search">
          <Search size={14} aria-hidden="true" />
          <TextInput type="search" placeholder="Search all secrets" aria-label="Search secrets" value={filters().search} onInput={(event) => setFilter("search", event.currentTarget.value)} />
        </div>
        <FilterMenu filters={filters()} descriptors={props.descriptors} onChange={setFilter} />
        <For each={chips()}>
          {(chip) => (
            <span class="sec-chip">
              {chip.label}
              <button type="button" aria-label={`Remove filter ${chip.label}`} onClick={() => clearChip(chip.key)}>
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          )}
        </For>
      </div>
      <Show when={props.newFolder !== null && !searching()}>
        <form
          class="sec-new-folder"
          aria-label="New folder"
          onSubmit={(event) => {
            event.preventDefault();
            stageFolder();
          }}
        >
          <Field label="Folder name" for="sec-folder-name" error={props.newFolder && folderNameProblem(props.newFolder) ? folderNameProblem(props.newFolder) : undefined}>
            <TextInput
              id="sec-folder-name"
              class="mono"
              placeholder="github"
              autofocus
              value={props.newFolder ?? ""}
              onInput={(event) => props.setNewFolder(event.currentTarget.value)}
              onKeyDown={(event) => event.key === "Escape" && props.setNewFolder(null)}
            />
          </Field>
          <span class="cs-inline sec-folder-buttons">
            <Button size="compact" type="submit" disabled={!!folderNameProblem(props.newFolder ?? "")}>
              Create folder
            </Button>
            <Button size="compact" variant="quiet" onClick={() => props.setNewFolder(null)}>
              Cancel
            </Button>
          </span>
        </form>
      </Show>

      <Switch>
        <Match when={props.error}>
          <CardNoteLine alert>Couldn't load the secrets. {props.error}</CardNoteLine>
        </Match>
        <Match when={props.loading && props.rows.length === 0}>
          <CardNoteLine>Loading…</CardNoteLine>
        </Match>
        <Match when={props.rows.length === 0 && !props.folder}>
          <div class="cs-lrow">
            <span class="cs-muted cs-grow">No secrets yet. Add an API key or token once, then choose which agents can use it.</span>
            <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} onClick={props.onCreate}>
              New secret
            </Button>
          </div>
        </Match>
        <Match when={true}>
          <Show when={!searching() && props.folder}>
            <div class="cs-folder-bar">
              <nav class="cs-crumbs" aria-label="Folder">
                <button type="button" class="cs-link-button" onClick={() => props.goTo("")}>
                  All secrets
                </button>
                <For each={folderCrumbs(props.folder)}>
                  {(crumb) => (
                    <>
                      <ChevronRight size={13} aria-hidden="true" class="cs-muted" />
                      <button type="button" class="cs-link-button" aria-current={crumb.path === props.folder ? "page" : undefined} onClick={() => props.goTo(crumb.path)}>
                        {crumb.name}
                      </button>
                    </>
                  )}
                </For>
              </nav>
              <span class="sec-count">
                {folderCountsLabel(listing().secrets.length + listing().folders.reduce((total, entry) => total + entry.secretCount, 0), listing().folders.length)}
              </span>
            </div>
          </Show>
          <Show when={searching()}>
            <div class="cs-folder-bar">
              <span class="sec-count">
                {filtered().length} {filtered().length === 1 ? "match" : "matches"} across all folders
              </span>
            </div>
          </Show>
          <Show
            when={!noTeamRows()}
            fallback={
              <Switch>
                <Match when={props.folder && !searching() && !filtersSet()}>
                  <div class="cs-lrow">
                    <span class="cs-muted cs-grow">No secrets in this folder yet.</span>
                    <Button size="compact" icon={<Plus size={14} aria-hidden="true" />} onClick={props.onCreate}>
                      New secret here
                    </Button>
                  </div>
                  <UpRow folder={props.folder} goTo={props.goTo} />
                </Match>
                <Match when={showManaged()}>
                  <CardNoteLine>{searching() || filtersSet() ? "None of the secrets your team added match." : "Your team hasn't added a secret yet."}</CardNoteLine>
                </Match>
                <Match when={true}>
                  <CardNoteLine>{searching() ? "No secrets match your search." : "No secrets match your filters."}</CardNoteLine>
                </Match>
              </Switch>
            }
          >
            <div class="sec-list" role="table" aria-label="Secrets">
              <div class="sec-thead" role="row">
                <span role="columnheader">Name</span>
                <span role="columnheader">Provided by</span>
                <span role="columnheader">Used by</span>
                <span role="columnheader">Updated</span>
                <span role="columnheader">
                  <span class="sr-only">Actions</span>
                </span>
              </div>
              <Show when={!searching() && props.folder}>
                <UpRow folder={props.folder} goTo={props.goTo} />
              </Show>
              <For each={listing().folders}>
                {(entry) => (
                  <div class="sec-row sec-folder-row" role="row" onClick={() => props.goTo(entry.path)}>
                    <span role="cell" class="sec-name-line">
                      <button type="button" class="sec-row-open" onClick={(event) => (event.stopPropagation(), props.goTo(entry.path))}>
                        <span class="sec-name-line">
                          <Folder size={15} aria-hidden="true" />
                          <span class="sec-name">{entry.name}</span>
                        </span>
                      </button>
                    </span>
                    <span role="cell" class="sec-count">
                      {folderCountsLabel(entry.secretCount, entry.folderCount)}
                    </span>
                    <span role="cell" />
                    <span role="cell" />
                    <span role="cell" class="sec-end">
                      <ChevronRight size={15} aria-hidden="true" class="cs-muted" />
                    </span>
                  </div>
                )}
              </For>
              <For each={listing().secrets}>
                {(row) => (
                  <SecretRowView row={row} base={searching() ? "" : props.folder} fullPath={searching()} usage={props.usage} configs={props.configs} descriptors={props.descriptors} selected={props.selectedId === row.id} actions={props.actions} />
                )}
              </For>
            </div>
          </Show>
          <Show when={showManaged() && !props.loading}>
            <section class="sec-managed" aria-label="Managed by Paperclip">
              <div class="sec-managed-head">
                <button type="button" class="sec-disclose" aria-expanded={managedExpanded()} onClick={() => setManagedOpen(!managedOpen())}>
                  <ChevronRight size={16} aria-hidden="true" />
                  <span>Managed by Paperclip</span>
                  <span class="sec-disclose-count">{split().managedCount}</span>
                </button>
                <InfoTip label="About secrets managed by Paperclip">Saved by your connections, chat channels and sign-ins, and kept up to date for you.</InfoTip>
              </div>
              <Show when={managedExpanded()}>
                <For each={split().managed}>
                  {({ group, rows }) => {
                    const open = () => searching() || openGroups().has(group.id);
                    return (
                      <div>
                        <button type="button" class="sec-disclose sec-disclose--group" aria-expanded={open()} onClick={() => toggleGroup(group.id)}>
                          <ChevronRight size={15} aria-hidden="true" />
                          <span>{group.label}</span>
                          <span class="sec-disclose-detail">{group.detail}</span>
                          <span class="sec-disclose-count">{rows.length === 1 ? "1 secret" : `${rows.length} secrets`}</span>
                        </button>
                        <Show when={open()}>
                          <div class="sec-list" role="table" aria-label={group.label}>
                            <For each={rows}>
                              {(row) => (
                                <SecretRowView
                                  row={row}
                                  label={managedLabel(row, group.id)}
                                  base=""
                                  fullPath={false}
                                  usage={props.usage}
                                  configs={props.configs}
                                  descriptors={props.descriptors}
                                  selected={props.selectedId === row.id}
                                  actions={props.actions}
                                />
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </section>
          </Show>
        </Match>
      </Switch>
    </section>
  );
}

function UpRow(props: { folder: string; goTo: (path: string) => void }) {
  const parent = () => parentFolder(props.folder);
  return (
    <button type="button" class="sec-up" onClick={() => props.goTo(parent())}>
      <CornerLeftUp size={14} aria-hidden="true" />
      Up to {parent() ? parent().split("/").pop() : "All secrets"}
    </button>
  );
}

function SecretRowView(props: {
  row: SecretRow;
  label?: string;
  base: string;
  fullPath: boolean;
  usage: ReturnType<typeof agentUsage>;
  configs: CompanySecretProviderConfig[] | undefined;
  descriptors: SecretProviderDescriptor[] | undefined;
  selected: boolean;
  actions: SecretActions;
}) {
  const agents = () => rowAgents(props.row, props.usage);
  const otherUses = () => (props.row.kind === "company" ? Math.max(0, (props.row.secret.referenceCount ?? 0) - agents().length) : 0);
  const line = () => (props.row.kind === "company" ? vaultLine(props.row.secret, props.configs, props.descriptors) : null);
  const updated = () => (props.row.kind === "company" ? props.row.secret.updatedAt : props.row.definition.updatedAt);
  const updatedTitle = () =>
    props.row.kind === "company"
      ? `Updated ${whenLabel(props.row.secret.updatedAt)} · value replaced ${whenLabel(props.row.secret.lastRotatedAt)} · last used ${whenLabel(props.row.secret.lastResolvedAt)}`
      : `Updated ${whenLabel(props.row.definition.updatedAt)}`;
  return (
    <div class="sec-row" classList={{ "sec-row--quiet": props.row.status !== "active" }} role="row" aria-current={props.selected ? "true" : undefined} onClick={() => props.actions.open(props.row)}>
      <span role="cell" class="cs-person-text">
        <button
          type="button"
          class="sec-row-open"
          onClick={(event) => {
            event.stopPropagation();
            props.actions.open(props.row);
          }}
        >
          <span class="sec-name-line">
            <Show when={props.label} fallback={<SecretName name={props.row.name} base={props.base} full={props.fullPath} />}>
              <span class="sec-name" title={props.row.name}>
                {props.label}
              </span>
            </Show>
            <Show when={props.row.status !== "active"}>
              <span class="cs-pill">{statusLabel(props.row.status)}</span>
            </Show>
          </span>
          <Show when={line()}>
            {(found) => (
              <span class="sec-sub">
                {found().linked ? <Link2 size={13} aria-hidden="true" /> : <Cloud size={13} aria-hidden="true" />}
                <span>{found().text}</span>
                <Show when={found().unavailable}>
                  <span class="sec-bad">
                    <AlertTriangle size={13} aria-hidden="true" />
                    Vault unavailable
                  </span>
                </Show>
              </span>
            )}
          </Show>
        </button>
      </span>
      <span role="cell" class="sec-cell">
        <ProvidedBy row={props.row} />
      </span>
      <span role="cell" class="sec-cell">
        <Show when={agents().length > 0}>
          <span class="sec-faces" aria-hidden="true">
            <For each={agents().slice(0, 3)}>{(agent) => <AgentAvatar agent={agent} size={24} />}</For>
          </span>
        </Show>
        <span classList={{ "cs-muted": agents().length === 0 }}>{usedByLabel(agents(), otherUses())}</span>
      </span>
      <span role="cell" class="sec-when" title={updatedTitle()}>
        {whenLabel(updated())}
      </span>
      <span role="cell" class="sec-end" onClick={(event) => event.stopPropagation()}>
        <RowMenu row={props.row} actions={props.actions} />
      </span>
    </div>
  );
}

function ProvidedBy(props: { row: SecretRow }) {
  const company = useCompany();
  const coverage = createQuery(() => ({
    queryKey: queryKeys.companySettings.userSecretCoverage(company().id, props.row.kind === "user" ? props.row.definition.id : ""),
    queryFn: ({ signal }) => secretsApi.userDefinitionCoverage(company().id, (props.row as Extract<SecretRow, { kind: "user" }>).definition.id, signal),
    enabled: props.row.kind === "user",
    retry: false,
    staleTime: 30_000,
  }));
  return (
    <Show
      when={props.row.kind === "user"}
      fallback={
        <>
          <Building2 size={14} aria-hidden="true" />
          <span>Organization</span>
        </>
      }
    >
      <Users size={14} aria-hidden="true" />
      <span>
        Each user
        <Show when={coverage.data}>{(found) => <> · {coverageShort(found())}</>}</Show>
      </span>
    </Show>
  );
}

/** One Filter menu: who provides the value, where it's stored, and status. */
function FilterMenu(props: { filters: SecretFilters; descriptors: SecretProviderDescriptor[] | undefined; onChange: <K extends keyof SecretFilters>(key: K, value: SecretFilters[K]) => void }) {
  const choice = <K extends "providedBy" | "provider" | "status">(key: K, value: SecretFilters[K], label: string) => (
    <Menu.CheckboxItem checked={props.filters[key] === value} onChange={() => props.onChange(key, value)}>
      {label}
    </Menu.CheckboxItem>
  );
  return (
    <Menu>
      <Menu.Trigger as={Button} size="compact" icon={<ListFilter size={14} aria-hidden="true" />}>
        Filter
      </Menu.Trigger>
      <Menu.Content label="Filter secrets" width={250}>
        <Menu.Group label="Provided by">
          {choice("providedBy", "all", "Anyone")}
          {choice("providedBy", "company", "Organization")}
          {choice("providedBy", "user", "Each user")}
        </Menu.Group>
        <Show when={(props.descriptors?.length ?? 0) > 1}>
          <Menu.Separator />
          <Menu.Group label="Stored in">
            {choice("provider", "all", "Any vault")}
            <For each={props.descriptors}>{(descriptor) => choice("provider", descriptor.id as SecretProvider, descriptor.id === "local_encrypted" ? "Paperclip" : descriptor.label)}</For>
          </Menu.Group>
        </Show>
        <Menu.Separator />
        <Menu.Group label="Status">
          {choice("status", "current", "Active and turned off")}
          {choice("status", "disabled", "Turned off only")}
          {choice("status", "archived", "Archived")}
        </Menu.Group>
      </Menu.Content>
    </Menu>
  );
}
