import type { ToolMcpGatewayWithTokens } from "@paperclipai/shared";
import { A, useNavigate } from "@solidjs/router";
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { Plus, Search } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { queryKeys } from "@/api/queryKeys";
import { toolAccessApi } from "@/api/tool-access";
import { shortDate } from "@/agents/shared";
import { useCompany } from "@/lib/company";
import { useAgentsQuery, useProjectsQuery } from "@/lib/company-data";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { Field, TextArea, TextInput } from "@/ui/Field";
import { Switch as Toggle } from "@/ui/Switch";
import { pushToast } from "@/ui/Toast";
import { CardState, CopyBlock } from "../advanced/parts";
import { useGateways, useProfiles } from "../advanced/queries";
import { failureText, useApplications, useConnections } from "../shared";
import { allowedToolsLabel, endpointUrl, gatewayApps, isOn, lastUsed, scopeLabel, tokensLabel } from "./gateway-model";

/*
 * Apps → Gateways (`/apps/gateways`, the old UI's GatewaysList): every gateway with its address,
 * scope, apps, tokens and last use, and a switch that turns the whole gateway off. New gateway asks
 * for a name and the access profile that decides its tools.
 */

/** Refreshes the gateway list: gateway changes aren't logged as activity, so nothing else will. */
export function useRefreshGateways() {
  const company = useCompany();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: queryKeys.tools.gateways(company().id) });
}

export function useGatewayToggle() {
  const company = useCompany();
  const refresh = useRefreshGateways();
  return createMutation(() => ({
    mutationFn: (gateway: ToolMcpGatewayWithTokens) =>
      toolAccessApi.updateGateway(company().id, gateway.id, { status: isOn(gateway) ? "disabled" : "active" }),
    onSuccess: (gateway) =>
      pushToast({
        title: isOn(gateway) ? "Gateway on" : "Gateway off",
        body: isOn(gateway) ? `${gateway.name} is exposing its tools again.` : `${gateway.name} is off: every client goes quiet.`,
        tone: "success",
      }),
    onError: (error) => pushToast({ title: "Couldn't update the gateway", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
}

export function GatewaysList() {
  const company = useCompany();
  const navigate = useNavigate();
  const gateways = useGateways();
  const profiles = useProfiles();
  const connections = useConnections();
  const applications = useApplications();
  const agents = useAgentsQuery();
  const projects = useProjectsQuery();
  const toggle = useGatewayToggle();
  const [query, setQuery] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const base = () => `/${company().issuePrefix}/apps/gateways`;

  const agentNames = createMemo(() => new Map((agents.data ?? []).map((agent) => [agent.id, agent.name])));
  const projectNames = createMemo(() => new Map((projects.data ?? []).map((project) => [project.id, project.name])));
  const profileById = createMemo(() => new Map((profiles.data?.profiles ?? []).map((profile) => [profile.id, profile])));
  const list = createMemo(() => (gateways.data?.gateways ?? []).filter((gateway) => gateway.status !== "archived"));
  const rows = createMemo(() => {
    const q = query().trim().toLowerCase();
    return list()
      .map((gateway) => {
        const profile = profileById().get(gateway.profileId);
        const apps = gatewayApps(profile, applications.data?.applications ?? [], connections.data?.connections ?? []);
        return {
          gateway,
          scope: scopeLabel(gateway, projectNames(), agentNames()),
          apps: `${apps.length} ${apps.length === 1 ? "app" : "apps"}${profile ? ` · ${allowedToolsLabel(profile)}` : ""}`,
          tokens: tokensLabel(gateway),
          used: lastUsed(gateway),
        };
      })
      .filter((row) => !q || [row.gateway.name, row.gateway.displaySlug, row.scope].join(" ").toLowerCase().includes(q));
  });

  return (
    <>
      <section class="card ap-card" aria-labelledby="gw-list">
        <header class="chead ap-chead">
          <div>
            <h3 id="gw-list" class="disp">
              Gateways
            </h3>
            <p>One MCP endpoint that exposes only the apps you assign, for a client like Cursor or Claude Desktop. Revoke its token and the whole gateway goes quiet.</p>
          </div>
          <Button size="compact" variant="primary" icon={<Plus size={14} aria-hidden="true" />} onClick={() => setCreating(true)}>
            New gateway
          </Button>
        </header>
        <Switch>
          <Match when={!gateways.isSuccess}>
            <CardState loading={gateways.isPending} error={gateways.error} what="gateways" onRetry={() => void gateways.refetch()} />
          </Match>
          <Match when={list().length === 0}>
            <p class="ap-empty">No gateways yet. Group connected apps into one endpoint you can hand to a client, then revoke it in one move.</p>
          </Match>
          <Match when={true}>
            <Show when={list().length > 5}>
              <div class="ap-filters">
                <label class="ap-search">
                  <Search size={15} aria-hidden="true" />
                  <TextInput type="search" placeholder="Find a gateway" aria-label="Find a gateway" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
                </label>
              </div>
            </Show>
            <ul class="ap-rows">
              <For each={rows()} fallback={<li class="ap-empty">No gateways match “{query().trim()}”.</li>}>
                {(row) => (
                  <li class="ap-row">
                    <div class="ap-row-main">
                      <A class="ap-row-name" href={`${base()}/${row.gateway.id}/overview`}>
                        {row.gateway.name}
                      </A>
                      <span class="ap-row-meta">
                        {row.scope} · {row.apps} · {row.tokens}
                        {row.used ? ` · last used ${shortDate(row.used)}` : ""}
                      </span>
                      <CopyBlock inline value={endpointUrl(row.gateway.endpointPath, location.origin)} label="gateway address" />
                    </div>
                    <span class="tl-row-switch">
                      <Toggle
                        checked={isOn(row.gateway)}
                        disabled={toggle.isPending}
                        onChange={() => toggle.mutate(row.gateway)}
                        label={`Turn ${row.gateway.name} ${isOn(row.gateway) ? "off" : "on"}`}
                        labelHidden
                      />
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Match>
        </Switch>
      </section>
      <GatewayDialog open={creating()} onOpenChange={setCreating} onSaved={(id) => navigate(`${base()}/${id}/overview`)} />
    </>
  );
}

/** New gateway, or editing one's name, description and access profile. */
export function GatewayDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; gateway?: ToolMcpGatewayWithTokens; onSaved?: (id: string) => void }) {
  const company = useCompany();
  const profiles = useProfiles();
  const refresh = useRefreshGateways();
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [profileId, setProfileId] = createSignal("");
  const options = createMemo(() => (profiles.data?.profiles ?? []).filter((profile) => profile.status !== "archived"));
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setName(props.gateway?.name ?? "");
        setDescription(props.gateway?.description ?? "");
        setProfileId(props.gateway?.profileId ?? "");
      },
    ),
  );
  // Pick the first profile once they've loaded, for a new gateway.
  createEffect(() => {
    if (props.open && !props.gateway && !profileId() && options()[0]) setProfileId(options()[0]!.id);
  });
  const save = createMutation(() => ({
    mutationFn: () => {
      const input = { name: name().trim(), description: description().trim() || null, profileId: profileId() };
      return props.gateway
        ? toolAccessApi.updateGateway(company().id, props.gateway.id, input)
        : toolAccessApi.createGateway(company().id, { ...input, defaultProfileMode: "gateway_only", contextScopeType: "company" });
    },
    onSuccess: (gateway) => {
      pushToast({ title: props.gateway ? "Gateway saved" : "Gateway created", body: gateway.name, tone: "success" });
      props.onOpenChange(false);
      props.onSaved?.(gateway.id);
    },
    onError: (error) => pushToast({ title: props.gateway ? "Couldn't save the gateway" : "Couldn't create the gateway", body: failureText(error, "Please try again."), tone: "error" }),
    onSettled: () => refresh(),
  }));
  const valid = () => Boolean(name().trim() && profileId());
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.gateway ? "Edit gateway" : "New gateway"}
      description={
        props.gateway
          ? "Change its name, or the access profile that decides which tools it exposes."
          : "One MCP endpoint that exposes only the tools in its access profile. Hand it to a client like Cursor or Claude Desktop."
      }
      width={520}
      footer={
        <>
          <Button variant="quiet" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : props.gateway ? "Save" : "Create gateway"}
          </Button>
        </>
      }
    >
      <form
        class="tl-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid()) save.mutate();
        }}
      >
        <Field label="Name" for="gw-name">
          <TextInput id="gw-name" maxLength={160} placeholder="CTO agents" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
        </Field>
        <Field
          label="Access profile"
          for="gw-profile"
          help={
            options().length === 0 && profiles.isSuccess ? (
              <>
                No access profiles yet. <A href={`/${company().issuePrefix}/apps/advanced/profiles/new`}>Create one</A> first.
              </>
            ) : (
              "Decides which tools this gateway allows. You can change it later."
            )
          }
        >
          <select id="gw-profile" class="tl-select" value={profileId()} onChange={(event) => setProfileId(event.currentTarget.value)} disabled={options().length === 0}>
            <option value="" disabled>
              {profiles.isPending ? "Loading profiles…" : "Choose a profile"}
            </option>
            <For each={options()}>
              {(profile) => (
                <option value={profile.id} selected={profile.id === profileId()}>
                  {profile.name} · {allowedToolsLabel(profile)}
                </option>
              )}
            </For>
          </select>
        </Field>
        <Field label="Description (optional)" for="gw-description">
          <TextArea id="gw-description" rows={2} placeholder="Who this endpoint is for, and when to rotate it." value={description()} onInput={(event) => setDescription(event.currentTarget.value)} />
        </Field>
        <Show when={!props.gateway}>
          <p class="cx-note">
            Need a profile with different tools? <A href={`/${company().issuePrefix}/apps/advanced/profiles`}>Access profiles</A> are under Advanced.
          </p>
        </Show>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
