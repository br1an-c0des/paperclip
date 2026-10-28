import type { ConnectionGrant, ConnectionGrantsResponse, ToolConnection } from "@paperclipai/shared";
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { activeAgents } from "@/api/agents";
import { connectionGrantsApi } from "@/api/connection-extras";
import { queryKeys } from "@/api/queryKeys";
import { toolsApi } from "@/api/tools";
import { ConfirmDialog } from "@/documents/ConfirmDialog";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Segmented } from "@/ui/Segmented";
import { pushToast } from "@/ui/Toast";
import { Card } from "../chat/parts";
import { AggregatorAccounts } from "../setups/AggregatorAccounts";
import { aggregatorOf } from "../setups/setups-model";
import { failureText, StateTag } from "../shared";
import {
  agentGrants,
  audienceChange,
  audienceSummary,
  audienceUserIds,
  connectionTypeLabel,
  connectionTypeText,
  delegationAgents,
  grantAccountLabel,
  grantState,
  memberLabel,
  organizationGrant,
  otherPersonalGrants,
  personalGrantFor,
  usesOrganizationIdentity,
  usesPersonalIdentities,
} from "./identity-model";
import "../chat/Chat.css";

/*
 * Who a connection acts as, on its page (the old UI's IdentitiesSection, and the identity API it
 * left unused):
 *
 * - Its type: the organization's shared account, each person's own ("Just me"), or one agent's.
 * - Your own identity on a personal connection: its status, Connect as me (your own sign-in),
 *   revoking it, and the agents you let act as you (delegations).
 * - Other people's identities, when you may see them, and revoking them where allowed.
 * - The organization identity's audience: everyone, or chosen people.
 * - A dedicated agent's account.
 *
 * Every action comes from the server's capabilities: one you may not take isn't shown.
 */

export function ConnectionIdentities(props: { connection: ToolConnection }) {
  const company = useCompany();
  const client = useQueryClient();
  const agents = useAgentsQuery();
  const key = () => queryKeys.tools.connectionPart(company().id, props.connection.id, "grants");
  const grants = createQuery(() => ({
    queryKey: key(),
    queryFn: ({ signal }) => toolsApi.grants(props.connection.id, signal),
    retry: false,
  }));
  const refresh = () => client.invalidateQueries({ queryKey: key() });
  const policy = () => props.connection.credentialPolicy;
  const data = () => grants.data;
  const list = () => data()?.grants ?? [];
  const me = () => data()?.currentUserId ?? null;
  const mine = createMemo(() => personalGrantFor(list(), me()));
  const others = createMemo(() => otherPersonalGrants(list(), me()));
  const org = createMemo(() => organizationGrant(list()));
  const agentName = (id: string | null | undefined) => agents.data?.find((agent) => agent.id === id)?.name ?? "an agent";
  const [revoking, setRevoking] = createSignal<ConnectionGrant | null>(null);

  const revoke = createMutation(() => ({
    mutationFn: (grant: ConnectionGrant) => connectionGrantsApi.revoke(props.connection.id, grant.id),
    onSuccess: () => {
      void refresh();
      pushToast({ tone: "success", title: "Identity revoked" });
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't revoke it", body: failureText(error, "Try again.") }),
  }));
  const connectAsMe = createMutation(() => ({
    mutationFn: async () => {
      const userId = me();
      if (!userId) throw new Error("Sign in as a person to connect your own account.");
      const start = await connectionGrantsApi.startPersonal(company().id, props.connection.id, {
        subjectUserId: userId,
        returnTo: `/${company().issuePrefix}/apps/${props.connection.id}/permissions`,
      });
      if (start.handoff) throw new Error("This app signs in through Paperclip Cloud, which this board can't hand off to yet.");
      window.location.assign(start.url);
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't start your sign-in", body: failureText(error, "Try again.") }),
  }));

  return (
    <Card title="Whose account it is" description={`${connectionTypeLabel(policy())}. ${connectionTypeText(policy())}`}>
      <Switch>
        <Match when={grants.isPending}>
          <p class="cx-static">Loading…</p>
        </Match>
        <Match when={grants.isError}>
          <p class="cx-note cx-note--warn" role="alert">
            Couldn't load who this connection acts as. {failureText(grants.error, "")}
          </p>
        </Match>
        <Match when={data()}>
          {(response) => (
            <>
              <Show when={policy() === "per_agent"}>
                <For each={agentGrants(list())} fallback={<p class="cx-static">No dedicated account is connected yet.</p>}>
                  {(grant) => (
                    <IdentityRow
                      title={grant.providerTenant?.github ? `@${grant.providerTenant.github.login}` : grantAccountLabel(grant)}
                      detail={`Used only by ${agentName(grant.subjectAgentId)}`}
                      grant={grant}
                      onRevoke={grant.capabilities?.canRevoke ? () => setRevoking(grant) : undefined}
                    />
                  )}
                </For>
              </Show>

              <Show when={usesPersonalIdentities(policy())}>
                <Show
                  when={mine()}
                  fallback={
                    <div class="ch-identity">
                      <span class="ch-row-main">
                        <b>Your account</b>
                        <span class="ch-row-meta">
                          {policy() === "per_user" ? "Agents can't use this app for your work until you connect." : "Work for you uses the organization's account until you connect your own."}
                        </span>
                      </span>
                      <StateTag state={grantState(null)} />
                      <Show when={response().capabilities.canConnectAsCurrentUser}>
                        <Button size="compact" variant="primary" disabled={connectAsMe.isPending} onClick={() => connectAsMe.mutate()}>
                          {connectAsMe.isPending ? "Opening sign-in…" : "Connect as me"}
                        </Button>
                      </Show>
                    </div>
                  }
                >
                  {(grant) => (
                    <>
                      <IdentityRow
                        title={`You · ${grantAccountLabel(grant(), memberLabel(response().members, me()))}`}
                        detail="Just me: agents act as you when they use it for your work."
                        grant={grant()}
                        onReconnect={grant().status !== "active" && response().capabilities.canConnectAsCurrentUser ? () => connectAsMe.mutate() : undefined}
                        onRevoke={grant().capabilities?.canRevoke !== false ? () => setRevoking(grant()) : undefined}
                      />
                      <Delegations connectionId={props.connection.id} grant={grant()} onChanged={refresh} />
                    </>
                  )}
                </Show>
                <Show when={response().capabilities.canViewOtherPersonalIdentities && others().length > 0}>
                  <div class="ch-copy">
                    <span class="ch-copy-label">Other people's accounts</span>
                    <ul class="ch-list">
                      <For each={others()}>
                        {(grant) => (
                          <li>
                            <IdentityRow
                              title={memberLabel(response().members, grant.subjectUserId) ?? "A member"}
                              detail={grantAccountLabel(grant)}
                              grant={grant}
                              plain
                              onRevoke={grant.capabilities?.canRevoke ? () => setRevoking(grant) : undefined}
                            />
                          </li>
                        )}
                      </For>
                    </ul>
                  </div>
                </Show>
              </Show>

              <Show when={usesOrganizationIdentity(policy())}>
                <Show when={org()} fallback={<p class="cx-static">The organization's account isn't connected.</p>}>
                  {(grant) => (
                    <>
                      <IdentityRow
                        title={`The organization · ${grantAccountLabel(grant())}`}
                        detail={`Who can use it: ${audienceSummary(grant())}`}
                        grant={grant()}
                        onRevoke={grant().capabilities?.canRevoke ? () => setRevoking(grant()) : undefined}
                      />
                      <Show when={grant().capabilities?.canEditAudience}>
                        <Audience connectionId={props.connection.id} grant={grant()} members={response().members} onSaved={refresh} />
                      </Show>
                    </>
                  )}
                </Show>
              </Show>
            </>
          )}
        </Match>
      </Switch>
      <ConfirmDialog
        open={revoking() !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={revoking()?.kind === "user" ? (revoking()?.subjectUserId === me() ? "Revoke your account?" : "Revoke this person's account?") : "Revoke this account?"}
        body={
          revoking()?.kind === "user"
            ? revoking()?.subjectUserId === me()
              ? "Agents stop acting as you. Work that needs it can ask you to connect again."
              : "Agents stop acting as this person. Only they can connect again."
            : "Agents that use this account lose it now, including runs in progress."
        }
        confirmLabel="Revoke"
        danger
        onConfirm={() => revoke.mutateAsync(revoking()!)}
      />
    </Card>
  );
}

function IdentityRow(props: {
  title: string;
  detail: string;
  grant: ConnectionGrant;
  plain?: boolean;
  onReconnect?: () => void;
  onRevoke?: () => void;
}) {
  return (
    <div classList={{ "ch-identity": !props.plain, "ch-row": props.plain }}>
      <span class="ch-row-main">
        <b>{props.title}</b>
        <span class="ch-row-meta">{props.detail}</span>
      </span>
      <StateTag state={grantState(props.grant.status)} />
      <Show when={props.onReconnect}>
        <Button size="compact" onClick={() => props.onReconnect?.()}>
          Sign in again
        </Button>
      </Show>
      <Show when={props.onRevoke && props.grant.status !== "revoked"}>
        <Button size="compact" variant="quiet" onClick={() => props.onRevoke?.()}>
          Revoke
        </Button>
      </Show>
    </div>
  );
}

/** The agents allowed to act as your personal identity, and adding or removing one. */
function Delegations(props: { connectionId: string; grant: ConnectionGrant; onChanged: () => void }) {
  const agents = useAgentsQuery();
  const sets = createMemo(() => delegationAgents(props.grant, activeAgents(agents.data)));
  const [adding, setAdding] = createSignal("");
  const delegate = createMutation(() => ({
    mutationFn: (agentId: string) => connectionGrantsApi.delegate(props.connectionId, props.grant.id, agentId),
    onSuccess: () => {
      setAdding("");
      props.onChanged();
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't let that agent act as you", body: failureText(error, "Try again.") }),
  }));
  const undelegate = createMutation(() => ({
    mutationFn: (delegationId: string) => connectionGrantsApi.revokeDelegation(props.connectionId, props.grant.id, delegationId),
    onSuccess: () => props.onChanged(),
    onError: (error) => pushToast({ tone: "error", title: "Couldn't remove it", body: failureText(error, "Try again.") }),
  }));
  const delegationFor = (agentId: string) => props.grant.delegations?.find((delegation) => delegation.agentId === agentId) ?? null;
  return (
    <div class="ch-copy">
      <span class="ch-copy-label">Agents that may act as you</span>
      <span class="cx-note">Beyond your own tasks: these agents may use your account for any work they do.</span>
      <Show when={sets().delegated.length > 0} fallback={<span class="cx-static">None yet.</span>}>
        <ul class="ch-list" aria-label="Agents that may act as you">
          <For each={sets().delegated}>
            {(agent) => (
              <li class="ch-row">
                <AgentAvatar agent={agent} size={24} />
                <span class="ch-row-main">
                  <b>{agent.name}</b>
                </span>
                <Button size="compact" variant="quiet" disabled={undelegate.isPending} onClick={() => delegationFor(agent.id) && undelegate.mutate(delegationFor(agent.id)!.id)}>
                  Remove
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.grant.status === "active" && sets().available.length > 0}>
        <div class="ch-copy-row">
          <select class="input" aria-label="Agent to add" value={adding()} onChange={(event) => setAdding(event.currentTarget.value)}>
            <option value="">Choose an agent…</option>
            <For each={sets().available}>{(agent) => <option value={agent.id}>{agent.name}</option>}</For>
          </select>
          <Button size="compact" disabled={!adding() || delegate.isPending} onClick={() => delegate.mutate(adding())}>
            Add
          </Button>
        </div>
      </Show>
    </div>
  );
}

/** Who may use the organization's account: everyone, or chosen people. */
function Audience(props: { connectionId: string; grant: ConnectionGrant; members: ConnectionGrantsResponse["members"]; onSaved: () => void }) {
  const initial = () => audienceUserIds(props.grant);
  const [scope, setScope] = createSignal<"all" | "selected">(initial().size === 0 ? "all" : "selected");
  const [selected, setSelected] = createSignal<Set<string>>(initial());
  createEffect(
    on(
      () => props.grant.members,
      () => {
        setSelected(initial());
        setScope(initial().size === 0 ? "all" : "selected");
      },
      { defer: true },
    ),
  );
  const change = () => audienceChange(props.grant, scope(), selected());
  const save = createMutation(() => ({
    mutationFn: (memberUserIds: string[]) => connectionGrantsApi.replaceMembers(props.connectionId, props.grant.id, memberUserIds),
    onSuccess: (grant) => {
      props.onSaved();
      pushToast({
        tone: "success",
        title: (grant.members?.length ?? 0) === 0 ? "Everyone in the organization can use it" : `${grant.members?.length} chosen people can use it`,
      });
    },
    onError: (error) => pushToast({ tone: "error", title: "Couldn't save who can use it", body: failureText(error, "Try again.") }),
  }));
  const toggle = (userId: string, on: boolean) => {
    const next = new Set(selected());
    if (on) next.add(userId);
    else next.delete(userId);
    setSelected(next);
  };
  return (
    <div class="ch-copy">
      <span class="ch-copy-label">Whose work can use the organization's account</span>
      <Segmented
        label="Whose work can use it"
        options={[
          { value: "all", label: "Everyone" },
          { value: "selected", label: "Chosen people" },
        ]}
        value={scope()}
        onChange={setScope}
      />
      <Show when={scope() === "selected"}>
        <ul class="ch-pick" aria-label="People">
          <For each={props.members}>
            {(member) => (
              <li>
                <label class="cx-option" classList={{ "cx-option--on": selected().has(member.userId) }}>
                  <input type="checkbox" checked={selected().has(member.userId)} onChange={(event) => toggle(member.userId, event.currentTarget.checked)} />
                  <span class="cx-option-name">{member.name ?? member.email ?? "A member"}</span>
                  <Show when={member.name && member.email}>
                    <span class="cx-option-note">{member.email}</span>
                  </Show>
                </label>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <span class="cx-note">This is about whose work may use it; which agents have the connection is set below.</span>
      <div class="cx-actions">
        <span />
        <Button size="compact" disabled={!change() || save.isPending} onClick={() => change() && save.mutate(change()!)}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

/**
 * What a connection's Permissions tab adds above its access: who it acts as, and an aggregator's
 * apps and accounts (AppDetail mounts this). Nothing for an AI account, whose identity is in AI
 * connections.
 */
export function ConnectionExtras(props: { connection: ToolConnection; canConfigure: boolean }) {
  const aggregator = () => aggregatorOf(props.connection);
  return (
    <Show when={props.connection.connectionPurpose !== "ai"}>
      <ConnectionIdentities connection={props.connection} />
      <Show when={aggregator()}>{(id) => <AggregatorAccounts connection={props.connection} id={id()} canConfigure={props.canConfigure} />}</Show>
    </Show>
  );
}
