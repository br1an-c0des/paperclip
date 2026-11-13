import type { Agent, CompanySecret, CompanySecretProviderConfig, SecretProviderDescriptor } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { AlertTriangle, Copy, KeyRound, Plus, RefreshCw, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch, type JSX } from "solid-js";
import { accessApi } from "@/api/access";
import { queryKeys } from "@/api/queryKeys";
import { secretsApi } from "@/api/secrets";
import { useCompany } from "@/lib/company";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextInput } from "@/ui/Field";
import { InfoTip } from "@/ui/InfoTip";
import { Popover } from "@/ui/Popover";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import { revokeAccess, grantAccess } from "./secret-access";
import {
  activityFailed,
  activityLine,
  agentsWithAccess,
  bindingLine,
  defaultEnvKey,
  ENV_KEY,
  normalizeFolderPath,
  providerName,
  referencePlaceholder,
  rotateKinds,
  rotateLabel,
  statusLabel,
  storedIn,
  vaultBlockReason,
  whenLabel,
  type AccessReference,
  type AgentUsage,
  type SecretRow,
} from "./secrets-model";
import { RowMenu, type SecretActions } from "./SecretParts";
import { copyText, failure } from "./shared";

/*
 * A secret's details (upstream's details panel, #21225): one scrolling view, opened from its row
 * and kept in the address (`?secret=<id>` or `?definition=<id>`). A full-screen sheet on a phone.
 *
 * - An organization secret: its key, Replace value (or Change reference), the agents that can use
 *   it (add one with the name it's read under, or take it away), the other places it's set (the
 *   usage read, without agents), its details, and recent activity (`…/access-events`, the last five
 *   with "Show all").
 * - A secret each user provides: its key, Set or Update my value, the agents, how many members have
 *   added theirs, and its details.
 */

export function SecretDetails(props: {
  row: SecretRow | null;
  usage: AgentUsage;
  agents: Agent[] | undefined;
  configs: CompanySecretProviderConfig[] | undefined;
  actions: SecretActions;
  onClose: () => void;
}) {
  // The last secret shown stays drawn while the dialog animates closed.
  const shown = createMemo<SecretRow | null>((previous) => props.row ?? previous, null);
  return (
    <Dialog
      open={!!props.row}
      onOpenChange={(open) => !open && props.onClose()}
      title={
        <span class="sec-name-line">
          <span class="cs-ellipsis">{shown()?.name ?? ""}</span>
          <Show when={shown() && shown()!.status !== "active"}>
            <span class="cs-pill">{statusLabel(shown()!.status)}</span>
          </Show>
        </span>
      }
      width={560}
    >
      <Show when={shown()}>
        {(row) => (
          <div class="sec-details" data-testid="secret-details">
            <div class="sec-details-head">
              <KeyLine value={row().key} />
              <div class="cs-inline">
                <Switch>
                  <Match when={row().kind === "company" && (row() as Extract<SecretRow, { kind: "company" }>)}>
                    {(found) => (
                      <Button size="compact" icon={<RefreshCw size={14} aria-hidden="true" />} onClick={() => props.actions.rotate(found().secret)}>
                        {rotateLabel(found().secret, props.actions.descriptors())}
                      </Button>
                    )}
                  </Match>
                  <Match when={row().kind === "user" && (row() as Extract<SecretRow, { kind: "user" }>)}>
                    {(found) => (
                      <Button size="compact" icon={<KeyRound size={14} aria-hidden="true" />} disabled={found().status !== "active"} onClick={() => props.actions.setMine(found().definition)}>
                        {props.actions.hasMine(found().definition.id) ? "Update my value" : "Set my value"}
                      </Button>
                    )}
                  </Match>
                </Switch>
                <RowMenu row={row()} actions={props.actions} inDetails />
              </div>
            </div>
            <Show when={row().status !== "active"}>
              <p class="cs-muted">
                {row().status === "disabled"
                  ? row().kind === "user"
                    ? "It's turned off: agents don't get it, and members aren't asked for a value."
                    : "It's turned off: agents don't get it. A run that needs it says so."
                  : "It's archived: agents don't get it, and it stays out of the list."}
              </p>
            </Show>
            <AgentAccess reference={row().kind === "company" ? { kind: "company", secret: (row() as Extract<SecretRow, { kind: "company" }>).secret } : { kind: "user", definition: (row() as Extract<SecretRow, { kind: "user" }>).definition }} agents={props.agents} />
            <Switch>
              <Match when={row().kind === "company" && (row() as Extract<SecretRow, { kind: "company" }>)}>
                {(found) => (
                  <>
                    <AlsoSetIn secret={found().secret} />
                    <section class="sec-section" aria-label="Details">
                      <h3>Details</h3>
                      <CompanyDetails secret={found().secret} configs={props.configs} descriptors={props.actions.descriptors()} onManageVaults={props.actions.goToVaults} />
                    </section>
                    <section class="sec-section" aria-label="Activity">
                      <h3>Activity</h3>
                      <SecretActivity secret={found().secret} agents={props.agents} />
                    </section>
                  </>
                )}
              </Match>
              <Match when={row().kind === "user" && (row() as Extract<SecretRow, { kind: "user" }>)}>
                {(found) => (
                  <>
                    <section class="sec-section" aria-label="Members">
                      <h3>Members</h3>
                      <Members definitionId={found().definition.id} />
                    </section>
                    <section class="sec-section" aria-label="Details">
                      <h3>Details</h3>
                      <dl class="sec-dl">
                        <Row label="Provided by">Each user</Row>
                        <Row label="Description">{found().definition.description || <span class="cs-muted">—</span>}</Row>
                        <Row label="Instructions">{found().definition.usageGuidance || <span class="cs-muted">—</span>}</Row>
                        <Row label="Created">{whenLabel(found().definition.createdAt)}</Row>
                        <Row label="Updated">{whenLabel(found().definition.updatedAt)}</Row>
                      </dl>
                    </section>
                  </>
                )}
              </Match>
            </Switch>
          </div>
        )}
      </Show>
    </Dialog>
  );
}

function KeyLine(props: { value: string }) {
  return (
    <div class="sec-keyline">
      <span>Key</span>
      <code class="mono">{props.value}</code>
      <Button
        variant="icon"
        ghost
        size="compact"
        aria-label="Copy key"
        onClick={() => void copyText(props.value).then((ok) => pushToast(ok ? { tone: "success", title: "Copied the key", body: props.value } : { tone: "error", title: "Couldn't copy the key" }))}
      >
        <Copy size={14} aria-hidden="true" />
      </Button>
    </div>
  );
}

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div>
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

function CompanyDetails(props: { secret: CompanySecret; configs: CompanySecretProviderConfig[] | undefined; descriptors: SecretProviderDescriptor[] | undefined; onManageVaults: () => void }) {
  const linked = () => props.secret.managedMode === "external_reference";
  const config = () => props.configs?.find((entry) => entry.id === props.secret.providerConfigId) ?? null;
  const blocked = () => (config() ? vaultBlockReason(config()!) : null);
  const writes = () => rotateKinds(props.secret, props.descriptors).includes("value");
  return (
    <dl class="sec-dl">
      <Row label="Provided by">Organization</Row>
      <Row label={linked() ? "Linked from" : "Stored in"}>
        <button type="button" class="cs-link-button" onClick={props.onManageVaults}>
          {storedIn(props.secret, props.configs, props.descriptors)}
        </button>
        <Show when={blocked()}>
          <span class="sec-sub sec-bad">
            <AlertTriangle size={13} aria-hidden="true" />
            <span>{blocked()} Agents can't read this secret until the vault is fixed.</span>
          </span>
        </Show>
      </Row>
      <Show when={props.secret.externalRef}>
        <Row label="Reference">
          <span class="mono">{props.secret.externalRef}</span>
          <Show when={linked()}>
            <span class="sec-sub">
              <span>{writes() ? "A new value is written to the vault." : "Change the value in the vault; Paperclip reads it at run time."}</span>
            </span>
          </Show>
        </Row>
      </Show>
      <Row label="Description">{props.secret.description || <span class="cs-muted">—</span>}</Row>
      <Row label={linked() && !writes() ? "Reference changed" : "Value replaced"}>
        {whenLabel(props.secret.lastRotatedAt)}
        <span class="cs-muted"> · version {props.secret.latestVersion}</span>
      </Row>
      <Row label="Last used">{whenLabel(props.secret.lastResolvedAt)}</Row>
      <Row label="Created">{whenLabel(props.secret.createdAt)}</Row>
    </dl>
  );
}

/** The agents that can use the secret, with the names they read it under; add one, or take it away. */
function AgentAccess(props: { reference: AccessReference; agents: Agent[] | undefined }) {
  const company = useCompany();
  const client = useQueryClient();
  const refId = () => (props.reference.kind === "company" ? props.reference.secret.id : props.reference.definition.id);
  const holders = createMemo(() => agentsWithAccess(props.agents, props.reference));
  const grantable = createMemo(() => (props.agents ?? []).filter((agent) => agent.status !== "terminated" && !holders().some((entry) => entry.agent.id === agent.id)));
  const [open, setOpen] = createSignal(false);
  const [agentId, setAgentId] = createSignal("");
  const [envKey, setEnvKey] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [problem, setProblem] = createSignal<string | null>(null);
  const key = () => envKey() ?? defaultEnvKey(props.reference);
  const keyValid = () => ENV_KEY.test(key());
  createEffect(
    on(refId, () => {
      setOpen(false);
      setAgentId("");
      setEnvKey(null);
      setProblem(null);
    }),
  );

  const refresh = (changedAgentId: string) =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.agents.list(company().id) }),
      client.invalidateQueries({ queryKey: queryKeys.agents.detail(changedAgentId) }),
      props.reference.kind === "company" ? client.invalidateQueries({ queryKey: queryKeys.companySettings.secretUsage(props.reference.secret.id) }) : undefined,
      props.reference.kind === "company" ? client.invalidateQueries({ queryKey: queryKeys.projectSettings.secrets(company().id) }) : undefined,
    ]);

  const grant = async () => {
    if (!agentId() || !keyValid()) return;
    setBusy("grant");
    setProblem(null);
    try {
      const agent = await grantAccess({ companyId: company().id, agentId: agentId(), envKey: key(), reference: props.reference });
      await refresh(agentId());
      pushToast({ tone: "success", title: `${agent.name} can use it now`, body: `As ${key()}` });
      setOpen(false);
      setAgentId("");
      setEnvKey(null);
    } catch (caught) {
      setProblem(failure(caught, "Couldn't give the agent access."));
    } finally {
      setBusy(null);
    }
  };
  const revoke = async (agent: Agent) => {
    setBusy(agent.id);
    setProblem(null);
    try {
      await revokeAccess({ companyId: company().id, agentId: agent.id, reference: props.reference });
      await refresh(agent.id);
      pushToast({ tone: "success", title: `Took access away from ${agent.name}` });
    } catch (caught) {
      setProblem(failure(caught, "Couldn't take access away."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section class="sec-section" aria-label="Agents that can use it">
      <div class="sec-section-head">
        <span class="info-line">
          <h3>Agents that can use it</h3>
          <InfoTip label="About agent access">
            {props.reference.kind === "company"
              ? "An agent gets it as an environment variable when its run starts. You can also give access from an agent's settings."
              : "An agent gets the value of the person it's working for when its run starts."}
          </InfoTip>
        </span>
        <Show when={props.agents}>
          <Popover open={open()} onOpenChange={setOpen}>
            <Popover.Trigger as={Button} variant="quiet" size="compact" icon={<Plus size={14} aria-hidden="true" />}>
              Add agent
            </Popover.Trigger>
            <Popover.Content title="Give an agent access" width={320}>
              <div class="sec-grant">
                <Show when={grantable().length > 0} fallback={<p class="cs-muted">Every agent already has access.</p>}>
                  <Field label="Agent" for="sec-grant-agent">
                    <select id="sec-grant-agent" class="input sec-select" value={agentId()} onChange={(event) => setAgentId(event.currentTarget.value)}>
                      <option value="">Pick an agent</option>
                      <For each={grantable()}>{(agent) => <option value={agent.id}>{agent.name}</option>}</For>
                    </select>
                  </Field>
                  <Field label="Environment variable" for="sec-grant-key" error={key() && !keyValid() ? "Use letters, digits and underscores, and don't start with a digit." : undefined}>
                    <TextInput id="sec-grant-key" class="mono" value={key()} placeholder="MY_SECRET" onInput={(event) => setEnvKey(event.currentTarget.value.toUpperCase())} />
                  </Field>
                  <Button size="compact" variant="primary" class="cs-self-start" disabled={!agentId() || !keyValid() || busy() === "grant"} onClick={() => void grant()}>
                    {busy() === "grant" ? "Giving access…" : "Give access"}
                  </Button>
                </Show>
              </div>
            </Popover.Content>
          </Popover>
        </Show>
      </div>
      <Switch>
        <Match when={!props.agents}>
          <p class="cs-muted">Loading agents…</p>
        </Match>
        <Match when={holders().length > 0}>
          <ul class="sec-agents">
            <For each={holders()}>
              {(entry) => (
                <li>
                  <AgentAvatar agent={entry.agent} size={24} />
                  <span class="sec-agent-name">{entry.agent.name}</span>
                  <span class="sec-agent-keys mono">{[...entry.envKeys, ...entry.apiAliases.map((alias) => `API · ${alias}`)].join(", ")}</span>
                  <Button variant="icon" ghost size="compact" aria-label={`Take access away from ${entry.agent.name}`} disabled={!!busy()} onClick={() => void revoke(entry.agent)}>
                    <X size={14} aria-hidden="true" />
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Match>
        <Match when={true}>
          <p class="cs-muted">No agent can use it yet.</p>
        </Match>
      </Switch>
      <Show when={problem()}>
        <p class="cs-bad" role="alert">
          {problem()}
        </p>
      </Show>
    </section>
  );
}

/** Every other place the secret is set: projects, environments, plugins, routines (agents are listed above). */
function AlsoSetIn(props: { secret: CompanySecret }) {
  const usage = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretUsage(props.secret.id),
    queryFn: ({ signal }) => secretsApi.usage(props.secret.id, signal),
    retry: false,
  }));
  const others = createMemo(() => (usage.data?.bindings ?? []).filter((binding) => binding.target.type !== "agent"));
  return (
    <Show when={others().length > 0 || usage.isError}>
      <section class="sec-section" aria-label="Also set in">
        <h3>Also set in</h3>
        <Show when={!usage.isError} fallback={<p class="cs-bad">Couldn't load where else it's set.</p>}>
          <ul class="cs-usage">
            <For each={others()}>
              {(binding) => (
                <li>
                  <span>
                    <span class="cs-muted">{binding.target.type.replaceAll("_", " ")} </span>
                    <Show when={binding.target.href} fallback={<span class="cs-strong">{binding.target.label}</span>}>
                      <a class="ps-link" href={binding.target.href!}>
                        {binding.target.label}
                      </a>
                    </Show>
                    <Show when={binding.target.status}>
                      <span class="cs-muted"> · {binding.target.status!.replaceAll("_", " ")}</span>
                    </Show>
                  </span>
                  <span class="cs-muted mono">{bindingLine(binding)}</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  );
}

const PREVIEW = 5;

/** Recent reads of the secret, newest first, by agent name where known. Values are never logged. */
export function SecretActivity(props: { secret: CompanySecret; agents: Agent[] | undefined }) {
  const company = useCompany();
  const [all, setAll] = createSignal(false);
  const events = createQuery(() => ({
    queryKey: queryKeys.companySettings.secretAccessEvents(props.secret.id),
    queryFn: ({ signal }) => secretsApi.accessEvents(props.secret.id, signal),
    staleTime: 0,
    retry: false,
  }));
  const people = createQuery(() => ({
    queryKey: queryKeys.access.userDirectory(company().id),
    queryFn: () => accessApi.userDirectory(company().id),
    enabled: (events.data ?? []).some((event) => event.responsibleUserId || event.credentialOwnerUserId),
    staleTime: 60_000,
  }));
  const agentNames = createMemo(() => new Map((props.agents ?? []).map((agent) => [agent.id, agent.name])));
  const person = (userId: string) => {
    const entry = people.data?.users.find((user) => user.principalId === userId);
    return entry?.user?.name?.trim() || entry?.user?.email?.trim() || "a member";
  };
  const shown = () => (all() ? (events.data ?? []) : (events.data ?? []).slice(0, PREVIEW));
  return (
    <Switch>
      <Match when={events.isLoading}>
        <p class="cs-muted">Loading…</p>
      </Match>
      <Match when={events.isError}>
        <p class="cs-bad">Couldn't load the activity. {failure(events.error, "")}</p>
      </Match>
      <Match when={(events.data?.length ?? 0) === 0}>
        <p class="cs-muted">No activity yet.</p>
      </Match>
      <Match when={true}>
        <ul class="sec-activity">
          <For each={shown()}>
            {(event) => (
              <li>
                <span classList={{ "sec-activity-bad": activityFailed(event.outcome) }}>
                  {activityLine(event, agentNames())}
                  <Show when={event.responsibleUserId}>{(userId) => <span class="cs-muted"> · for {person(userId())}</span>}</Show>
                  <Show when={event.credentialOwnerUserId && event.credentialOwnerUserId !== event.responsibleUserId}>
                    <span class="cs-muted"> · value from {person(event.credentialOwnerUserId!)}</span>
                  </Show>
                  <Show when={event.version != null}>
                    <span class="cs-muted"> · version {event.version}</span>
                  </Show>
                  <Show when={event.errorCode}>
                    <span class="mono cs-small" style={{ display: "block" }}>
                      {event.errorCode}
                    </span>
                  </Show>
                </span>
                <span class="sec-when" title={new Date(event.createdAt).toLocaleString()}>
                  {whenLabel(event.createdAt)}
                </span>
              </li>
            )}
          </For>
        </ul>
        <Show when={!all() && (events.data?.length ?? 0) > PREVIEW}>
          <button type="button" class="sec-text-link" onClick={() => setAll(true)}>
            Show all activity
          </button>
        </Show>
      </Match>
    </Switch>
  );
}

function Members(props: { definitionId: string }) {
  const company = useCompany();
  const coverage = createQuery(() => ({
    queryKey: queryKeys.companySettings.userSecretCoverage(company().id, props.definitionId),
    queryFn: ({ signal }) => secretsApi.userDefinitionCoverage(company().id, props.definitionId, signal),
    retry: false,
    staleTime: 30_000,
  }));
  const total = () => (coverage.data ? coverage.data.configuredCount + coverage.data.missingCount + coverage.data.inactiveCount : 0);
  return (
    <Switch>
      <Match when={coverage.isLoading}>
        <p class="cs-muted">Loading…</p>
      </Match>
      <Match when={!coverage.data}>
        <p class="cs-muted">Member counts aren't available right now.</p>
      </Match>
      <Match when={coverage.data}>
        {(found) => (
          <div class="cs-person-text">
            <span class="info-line">
              <span>
                {found().configuredCount} of {total()} {total() === 1 ? "member has" : "members have"} added their value.
              </span>
              <InfoTip label="About members' values">Members without a value are asked for one when an agent working for them needs it. Each person adds theirs under My secrets.</InfoTip>
            </span>
            <Show when={found().inactiveCount > 0}>
              <span class="cs-muted">
                {found().inactiveCount} {found().inactiveCount === 1 ? "value is" : "values are"} turned off.
              </span>
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  );
}

// ---------------------------------------------------------------------------------------------
// Replace value (or change a reference), and rename

export type SecretEdit = { mode: "rotate"; secret: CompanySecret } | { mode: "edit"; secret: CompanySecret };

/*
 * Replace value stores a new version; a reference can instead be pointed elsewhere (or at a pinned
 * version), or take a new value written through to its provider when that takes writes (AWS).
 * Rename or describe changes the name (a slash files it in a folder) and the description.
 */
export function SecretEditDialog(props: { edit: SecretEdit | null; descriptors: SecretProviderDescriptor[] | undefined; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [value, setValue] = createSignal("");
  const [reference, setReference] = createSignal("");
  const [version, setVersion] = createSignal("");
  const [kind, setKind] = createSignal<"value" | "reference">("value");
  const [busy, setBusy] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const secret = () => props.edit?.secret ?? null;
  const rotating = () => props.edit?.mode === "rotate";
  const kinds = () => (secret() ? rotateKinds(secret()!, props.descriptors) : (["value"] as const));
  createEffect(
    on(
      () => props.edit,
      (edit) => {
        setName(edit?.secret.name ?? "");
        setDescription(edit?.secret.description ?? "");
        setValue("");
        setReference(edit?.secret.externalRef ?? "");
        setVersion("");
        setKind(edit ? rotateKinds(edit.secret, props.descriptors)[0]! : "value");
        setProblem(null);
      },
    ),
  );
  const linking = () => rotating() && kind() === "reference";

  const save = async () => {
    const edit = props.edit;
    if (!edit) return;
    setProblem(null);
    if (!rotating() && (!name().trim() || name().trim().endsWith("/"))) return setProblem("Enter a name.");
    if (rotating() && !linking() && !value()) return setProblem("Paste the new value.");
    if (linking() && !reference().trim()) return setProblem("Enter the reference.");
    setBusy(true);
    try {
      if (edit.mode === "rotate") {
        const updated = await secretsApi.rotate(edit.secret.id, linking() ? { externalRef: reference().trim(), providerVersionRef: version().trim() || null } : { value: value() });
        pushToast({ tone: "success", title: linking() ? `Pointed ${edit.secret.name} elsewhere` : `Replaced the value of ${edit.secret.name}`, body: `Now on version ${updated.latestVersion}` });
      } else {
        await secretsApi.update(edit.secret.id, { name: normalizeFolderPath(name()), description: description().trim() || null });
        pushToast({ tone: "success", title: "Saved the secret" });
      }
      await props.onSaved();
      setValue("");
      props.onClose();
    } catch (caught) {
      setProblem(failure(caught, "Couldn't save the secret."));
    } finally {
      setBusy(false);
    }
  };

  const describe = () => {
    const current = secret();
    if (!current || !rotating()) return undefined;
    if (current.managedMode !== "external_reference") return "Agents get the new value from their next run. The old one is kept as an earlier version.";
    return kind() === "value"
      ? `Written to ${current.externalRef} in ${providerName(current.provider)}. Everything that reads that secret gets it, inside and outside Paperclip.`
      : "Points Paperclip at a different secret in your vault. Nothing is written to the vault.";
  };

  return (
    <Dialog
      open={!!props.edit}
      onOpenChange={(open) => !open && props.onClose()}
      title={rotating() ? (kind() === "reference" ? `Change reference · ${secret()?.name ?? ""}` : `Replace value · ${secret()?.name ?? ""}`) : `Edit ${secret()?.name ?? ""}`}
      description={describe()}
      width={520}
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
            {busy() ? "Saving…" : rotating() ? (linking() ? "Save reference" : "Save new value") : "Save"}
          </Button>
        </>
      }
    >
      <div class="cs-dialog-body">
        <Show when={rotating() && kinds().length > 1}>
          <Segmented
            label="How to update it"
            options={[
              { value: "value", label: "Replace value" },
              { value: "reference", label: "Change reference" },
            ]}
            value={kind()}
            onChange={setKind}
          />
        </Show>
        <Show when={!rotating()}>
          <Field label={<span class="info-line">Name<InfoTip label="About the name">A slash files it in a folder: github/DEPLOY_TOKEN. The key agents and the API use stays the same.</InfoTip></span>} for="sec-edit-name">
            <TextInput id="sec-edit-name" class="mono" autocomplete="off" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
          </Field>
          <Field label="Description" for="sec-edit-description">
            <TextInput id="sec-edit-description" value={description()} placeholder="What it's for" onInput={(event) => setDescription(event.currentTarget.value)} />
          </Field>
        </Show>
        <Show when={linking()}>
          <Field label="New ARN or path" for="sec-edit-ref">
            <TextInput id="sec-edit-ref" class="mono" autocomplete="off" placeholder={referencePlaceholder(secret()?.provider)} value={reference()} onInput={(event) => setReference(event.currentTarget.value)} />
          </Field>
          <Field label={<span class="info-line">Version (optional)<InfoTip label="About the version">Pin one version of the secret. Empty follows the latest.</InfoTip></span>} for="sec-edit-version">
            <TextInput id="sec-edit-version" class="mono" autocomplete="off" value={version()} onInput={(event) => setVersion(event.currentTarget.value)} />
          </Field>
        </Show>
        <Show when={rotating() && !linking()}>
          <Field label="New value" for="sec-edit-value">
            <TextInput id="sec-edit-value" type="password" autocomplete="new-password" placeholder="Paste the new value" value={value()} onInput={(event) => setValue(event.currentTarget.value)} />
          </Field>
        </Show>
      </div>
    </Dialog>
  );
}
