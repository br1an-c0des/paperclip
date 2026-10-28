import type { AgentDetail, ToolConnection, ToolProfileWithDetails } from "@paperclipai/shared";
import { A } from "@solidjs/router";
import { createMutation, createQueries, createQuery } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { toolAccessApi } from "@/api/tool-access";
import { toolsApi } from "@/api/tools";
import { agentAppRows, agentGitHubConnections, agentPolicies, assignableProfiles, boundToAgent, gitHubIdentities, gitHubLogin, unavailableTools } from "@/apps/advanced/agent-tools-model";
import { CardState, StatePill } from "@/apps/advanced/parts";
import { isAppProfile } from "@/apps/advanced/profile-model";
import { CheckAccessDialog } from "@/apps/advanced/Profiles";
import { useCompanyCatalog, usePolicies, useProfiles } from "@/apps/advanced/queries";
import { installState, installTargets } from "@/apps/apps-model";
import { ToolActivity } from "@/apps/gateways/Activity";
import { failureText, useConnections, useRefreshTools } from "@/apps/shared";
import { useCompany } from "@/lib/company";
import { Button, buttonClass } from "@/ui/Button";
import { SettingsCard } from "@/ui/Field";
import { Switch as Toggle } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { SectionTitle } from "../shared";
import { ChannelsPanel } from "./ChannelsPanel";
import "@/apps/Apps.css";
import "@/connectors/Connectors.css";

/*
 * Tools and channels (board 30's outline, the old UI's AgentToolsTab): what the agent's runs get.
 *
 * - Its tools: every tool its access profiles allow (`GET tools/profiles/effective/agents/:id`), and
 *   the ones it could name but would be blocked from.
 * - Apps it carries: an installed app's tools are loaded into every run. Installing one here also
 *   lets the agent use it (`PUT /tool-connections/:id/installs`, which extends access to match);
 *   apps installed for every agent are changed from their own page.
 * - Access profiles: the ones that apply, and assigning or removing one for this agent.
 * - Policies: the enabled ones that apply to it, such as Ask first on an action. They're set per
 *   action on each app's page, so they're read here.
 * - GitHub identity: the agent's own GitHub account, or the responsible person's.
 * - Recent tool calls from the audit.
 *
 * - Its chat channels (ChannelsPanel).
 */

const ALLOWED_SHOWN = 40;
const BLOCKED_SHOWN = 30;

export function ToolsSection(props: { agent: AgentDetail }) {
  const company = useCompany();
  const refresh = useRefreshTools();
  const connections = useConnections();
  const profiles = useProfiles();
  const policies = usePolicies();
  const catalog = useCompanyCatalog();
  const [checking, setChecking] = createSignal(false);
  const [showAll, setShowAll] = createSignal(false);
  const [pick, setPick] = createSignal("");
  const appsHref = () => `/${company().issuePrefix}/apps`;
  const effective = createQuery(() => ({
    queryKey: queryKeys.tools.effective(company().id, props.agent.id),
    queryFn: ({ signal }) => toolAccessApi.effectiveForAgent(company().id, props.agent.id, signal),
    retry: false,
  }));
  const allowed = createMemo(() => [...(effective.data?.allowedTools ?? [])].sort((a, b) => a.toolName.localeCompare(b.toolName)));
  const blocked = createMemo(() => unavailableTools(catalog.catalog(), allowed()));
  const apps = createMemo(() => agentAppRows(connections.data?.connections ?? [], effective.data, props.agent.id));
  const connectionNames = createMemo(() => new Map((connections.data?.connections ?? []).map((connection) => [connection.id, connection.name])));
  const applying = () => effective.data?.profiles ?? [];
  const offered = createMemo(() => assignableProfiles(profiles.data?.profiles ?? [], applying()));
  const rules = createMemo(() => agentPolicies(policies.data?.policies ?? [], props.agent.id));

  const install = createMutation(() => ({
    mutationFn: (input: { connection: ToolConnection; on: boolean }) => {
      const state = installState(input.connection.installs);
      if (input.on) state.agentIds.add(props.agent.id);
      else state.agentIds.delete(props.agent.id);
      return toolsApi.putInstalls(input.connection.id, installTargets(company().id, state));
    },
    onSuccess: (_, input) =>
      pushToast({
        title: input.on ? `${input.connection.name} installed` : `${input.connection.name} removed`,
        body: input.on ? `${props.agent.name} gets its tools on every run.` : `Its tools are no longer loaded into ${props.agent.name}'s runs.`,
        tone: "success",
      }),
    onError: (error) => pushToast({ title: "Couldn't change that", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  const bind = createMutation(() => ({
    mutationFn: async (input: { profile: ToolProfileWithDetails; on: boolean }): Promise<unknown> => {
      const target = { targetType: "agent" as const, targetId: props.agent.id };
      return input.on ? toolAccessApi.bindProfile(company().id, input.profile.id, target) : toolAccessApi.unbindProfile(company().id, input.profile.id, target);
    },
    onSuccess: (_, input) => {
      setPick("");
      pushToast({ title: input.on ? `${input.profile.name} assigned` : `${input.profile.name} removed`, tone: "success" });
    },
    onError: (error) => pushToast({ title: "Couldn't change the profile", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));

  return (
    <>
      <SectionTitle title="Tools and channels">The apps, tools and chat channels {props.agent.name} can use.</SectionTitle>

      <SettingsCard
        title="What its runs get"
        description={
          effective.data
            ? `${allowed().length === 1 ? "1 tool" : `${allowed().length} tools`}, from ${applying().length === 1 ? "1 access profile" : `${applying().length} access profiles`}. Its instructions can narrow this, never widen it.`
            : undefined
        }
      >
        <Switch>
          <Match when={!effective.isSuccess}>
            <CardState loading={effective.isPending} error={effective.error} what="its tools" onRetry={() => void effective.refetch()} />
          </Match>
          <Match when={allowed().length === 0}>
            <p class="ps-list-note">It can't use any app tools. Install an app below, or assign an access profile.</p>
          </Match>
          <Match when={true}>
            <ul class="ap-rows">
              <For each={showAll() ? allowed() : allowed().slice(0, ALLOWED_SHOWN)}>
                {(tool) => (
                  <li class="ap-row">
                    <div class="ap-row-main">
                      <span class="ap-row-name mono">{tool.toolName}</span>
                      <span class="ap-row-meta">
                        {connectionNames().get(tool.connectionId) ?? "App"}
                        {tool.title ? ` · ${tool.title}` : ""}
                      </span>
                    </div>
                    <StatePill tone={tool.isDestructive ? "red" : tool.isWrite ? "amber" : null}>{tool.isDestructive ? "Destructive" : tool.isWrite ? "Makes changes" : "Read-only"}</StatePill>
                  </li>
                )}
              </For>
            </ul>
            <Show when={allowed().length > ALLOWED_SHOWN}>
              <div class="tl-more">
                <Button size="compact" variant="quiet" onClick={() => setShowAll((value) => !value)}>
                  {showAll() ? "Show fewer" : `Show all ${allowed().length}`}
                </Button>
              </div>
            </Show>
          </Match>
        </Switch>
        <Show when={effective.isSuccess && !catalog.loading() && blocked().length > 0}>
          <details class="ap-more ap-card-body">
            <summary>
              {blocked().length === 1 ? "1 tool" : `${blocked().length} tools`} it would be blocked from
            </summary>
            <div class="ap-more-body tl-chips">
              <For each={blocked().slice(0, BLOCKED_SHOWN)}>
                {(tool) => (
                  <span class="tl-chip mono" title={connectionNames().get(tool.connectionId)}>
                    {tool.toolName}
                  </span>
                )}
              </For>
              <Show when={blocked().length > BLOCKED_SHOWN}>
                <span class="tl-chip">+{blocked().length - BLOCKED_SHOWN} more</span>
              </Show>
            </div>
          </details>
        </Show>
      </SettingsCard>

      <SettingsCard
        title="Apps it carries"
        description="An installed app's tools are loaded into every run. Installing one also lets the agent use it; an app it may use but doesn't carry adds nothing to its runs."
        footer={
          <A class={buttonClass({ size: "compact" })} href={appsHref()}>
            Connect an app
          </A>
        }
      >
        <Switch>
          <Match when={!connections.isSuccess}>
            <CardState loading={connections.isPending} error={connections.error} what="apps" onRetry={() => void connections.refetch()} />
          </Match>
          <Match when={apps().length === 0}>
            <p class="ps-list-note">No apps are connected yet.</p>
          </Match>
          <Match when={true}>
            <ul class="ap-rows">
              <For each={apps()}>
                {(row) => (
                  <li class="ap-row">
                    <div class="ap-row-main">
                      <A class="ap-row-name" href={`${appsHref()}/${row.connection.id}/permissions`}>
                        {row.name}
                      </A>
                      <span class="ap-row-meta">
                        {row.installedForAll
                          ? "Installed for every agent, from its page"
                          : row.installed
                            ? "Loaded into every run"
                            : row.permitted
                              ? "It may use it, but its tools aren't loaded into runs"
                              : "Not available to it"}
                        {row.state.kind !== "connected" ? ` · ${row.state.label}` : ""}
                      </span>
                    </div>
                    <span class="tl-row-switch">
                      <Toggle
                        checked={row.installed}
                        disabled={row.installedForAll || install.isPending}
                        onChange={(on) => install.mutate({ connection: row.connection, on })}
                        label={`Install ${row.name} for ${props.agent.name}`}
                        labelHidden
                      />
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Match>
        </Switch>
      </SettingsCard>

      <SettingsCard
        title="Access profiles"
        description="Profiles decide which tools a run gets. With several, it can use anything any of them allows."
        footer={
          <>
            <Button size="compact" variant="quiet" onClick={() => setChecking(true)}>
              Check its access
            </Button>
            <span class="ap-actions-end">
              <Show
                when={offered().length > 0}
                fallback={
                  <A class={buttonClass({ size: "compact" })} href={`${appsHref()}/advanced/profiles/new`}>
                    New profile
                  </A>
                }
              >
                <select class="tl-select" aria-label="Profile to assign" value={pick()} onChange={(event) => setPick(event.currentTarget.value)}>
                  <option value="">Assign a profile…</option>
                  <For each={offered()}>{(profile) => <option value={profile.id}>{profile.name}</option>}</For>
                </select>
                <Button
                  size="compact"
                  variant="primary"
                  disabled={!pick() || bind.isPending}
                  onClick={() => {
                    const profile = offered().find((entry) => entry.id === pick());
                    if (profile) bind.mutate({ profile, on: true });
                  }}
                >
                  Assign
                </Button>
              </Show>
            </span>
          </>
        }
      >
        <Show when={effective.isSuccess} fallback={<CardState loading={effective.isPending} error={effective.error} what="its profiles" />}>
          <ul class="ap-rows">
            <For each={applying()} fallback={<li class="ps-list-note">No access profile applies to it, so it has no app tools beyond what its installed apps allow.</li>}>
              {(profile) => {
                const own = () => boundToAgent(profile, props.agent.id);
                // An app's own profile is who may use that app: its page manages it.
                const app = () => (isAppProfile(profile) ? profile.profileKey.slice("app:".length) : null);
                return (
                  <li class="ap-row">
                    <div class="ap-row-main">
                      <A class="ap-row-name" href={`${appsHref()}/advanced/profiles/${profile.id}`}>
                        {profile.name}
                      </A>
                      <span class="ap-row-meta">
                        {app()
                          ? "Its access to this app, set on the app's page"
                          : own()
                            ? "Assigned to it"
                            : profile.summary.isCompanyDefault
                              ? "The organization default"
                              : "Through a project or task"}
                      </span>
                    </div>
                    <Show
                      when={app()}
                      fallback={
                        <Show when={own()}>
                          <Button size="compact" variant="quiet" disabled={bind.isPending} onClick={() => bind.mutate({ profile, on: false })}>
                            Remove
                          </Button>
                        </Show>
                      }
                    >
                      {(id) => (
                        <A class="tl-rowlink" href={`${appsHref()}/${id()}/permissions`}>
                          Open the app
                        </A>
                      )}
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </SettingsCard>

      <SettingsCard title="Policies" description="Rules the gateway checks on every call it makes, in order. Set Ask first on an action from its app's page.">
        <Switch>
          <Match when={!policies.isSuccess}>
            <CardState loading={policies.isPending} error={policies.error} what="policies" onRetry={() => void policies.refetch()} />
          </Match>
          <Match when={rules().length === 0}>
            <p class="ps-list-note">No enabled policy applies to it.</p>
          </Match>
          <Match when={true}>
            <ul class="ap-rows">
              <For each={rules()}>
                {(row) => (
                  <li class="ap-row">
                    <div class="ap-row-main">
                      <span class="ap-row-name">
                        {row.order}. {row.policy.name}
                      </span>
                      <span class="ap-row-meta">
                        {row.policy.description ?? ""}
                        {row.connectionId && connectionNames().get(row.connectionId) ? `${row.policy.description ? " · " : ""}${connectionNames().get(row.connectionId)}` : ""}
                      </span>
                    </div>
                    <span class="tl-row-side">
                      <StatePill tone={row.effect === "Block" ? "red" : row.effect === "Ask first" ? "amber" : null}>{row.effect}</StatePill>
                      <Show when={row.connectionId && connectionNames().has(row.connectionId!)}>
                        <A class="tl-rowlink" href={`${appsHref()}/${row.connectionId}/permissions`}>
                          Open the app
                        </A>
                      </Show>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Match>
        </Switch>
      </SettingsCard>

      <GitHubIdentity agent={props.agent} connections={connections.data?.connections ?? []} loading={connections.isPending} />

      <section class="card settings-card" aria-labelledby="ag-tool-calls">
        <header class="chead">
          <h3 id="ag-tool-calls" class="disp">
            Recent tool calls
          </h3>
          <p>Calls it made in the last 7 days: allowed, asked about, or blocked.</p>
        </header>
        <ToolActivity filter={{ agent: props.agent.id, window: "7d" }} pageSize={10} empty={`${props.agent.name} hasn't called any app tools in the last 7 days.`} />
      </section>

      <ChannelsPanel agent={props.agent} />

      <CheckAccessDialog open={checking()} onOpenChange={setChecking} agentId={props.agent.id} />
    </>
  );
}

/** The GitHub account its runs use: its own, which wins, or the responsible person's. */
function GitHubIdentity(props: { agent: AgentDetail; connections: ToolConnection[]; loading: boolean }) {
  const company = useCompany();
  const github = createMemo(() => agentGitHubConnections(props.connections, props.agent.id));
  const grants = createQueries(() => ({
    queries: github().map((connection) => ({
      queryKey: queryKeys.tools.connectionPart(company().id, connection.id, "grants"),
      queryFn: ({ signal }: { signal: AbortSignal }) => toolsApi.grants(connection.id, signal),
      staleTime: 30_000,
    })),
  }));
  const found = createMemo(() =>
    gitHubIdentities(
      github().map((connection, index) => ({ connection, grants: grants[index]?.data?.grants ?? [], currentUserId: grants[index]?.data?.currentUserId })),
      props.agent.id,
    ),
  );
  const loading = () => props.loading || grants.some((query) => query.isPending);
  const failed = () => grants.some((query) => query.isError);
  const base = () => `/${company().issuePrefix}/apps`;
  return (
    <SettingsCard
      title="GitHub identity"
      footer={
        <Show when={!loading() && !failed()}>
          <Show
            when={found().dedicated}
            fallback={
              <>
                <Show
                  when={found().personal}
                  fallback={
                    <A class={buttonClass({ size: "compact" })} href={`${base()}/connect?source=github`}>
                      Connect my GitHub
                    </A>
                  }
                >
                  {(mine) => (
                    <A class={buttonClass({ size: "compact" })} href={`${base()}/${mine().connection.id}/permissions`}>
                      Manage my GitHub
                    </A>
                  )}
                </Show>
                <A class={buttonClass({ size: "compact", variant: "quiet" })} href={`${base()}/connect?source=github`}>
                  Use a dedicated account
                </A>
              </>
            }
          >
            {(own) => (
              <A class={buttonClass({ size: "compact" })} href={`${base()}/${own().connection.id}/permissions`}>
                Manage its GitHub identity
              </A>
            )}
          </Show>
        </Show>
      }
    >
      <p class="ps-list-note">
        <Switch>
          <Match when={loading()}>Checking its GitHub identity…</Match>
          <Match when={failed()}>Couldn't check its GitHub identity. Nothing was changed.</Match>
          <Match when={found().dedicated}>
            {(own) => (
              <>
                <b>{gitHubLogin(own()) ? `@${gitHubLogin(own())}` : "A dedicated GitHub account"}</b>, used only by {props.agent.name}. It comes before the responsible
                person's GitHub.
              </>
            )}
          </Match>
          <Match when={true}>
            At the start of a run Paperclip uses the GitHub account of the person responsible for the task.
            <Show when={found().personal}>{(mine) => <> Yours is connected{gitHubLogin(mine()) ? ` as @${gitHubLogin(mine())}` : ""}.</>}</Show>
          </Match>
        </Switch>
      </p>
    </SettingsCard>
  );
}
