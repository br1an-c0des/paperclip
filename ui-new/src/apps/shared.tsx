import type { Agent, AppDefinition } from "@paperclipai/shared";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show, type JSX } from "solid-js";
import { activeAgents } from "@/api/agents";
import { queryKeys } from "@/api/queryKeys";
import { toolsApi } from "@/api/tools";
import { useCompany } from "@/lib/company";
import { useAgentsQuery } from "@/lib/company-data";
import { theme } from "@/lib/theme";
import { AgentAvatar, discGradient } from "@/ui/Avatar";
import { Switch as Toggle } from "@/ui/Switch";
import type { AccessDraft, ConnectionState } from "./apps-model";

/*
 * What the Apps pages share: their queries, the app logo, a connection's state, and the "which
 * agents can use it" picker that connecting and the Permissions tab both use.
 */

export function useGallery() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.tools.gallery(company().id),
    queryFn: ({ signal }) => toolsApi.gallery(company().id, signal),
    staleTime: 5 * 60_000,
  }));
}

export function useConnections() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.tools.connections(company().id),
    queryFn: ({ signal }) => toolsApi.connections(company().id, signal),
  }));
}

export function useApplications() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.tools.applications(company().id),
    queryFn: ({ signal }) => toolsApi.applications(company().id, signal),
  }));
}

/** Ask-first requests waiting on you. The live events refresh it; the poll catches the rest. */
export function usePendingRequests() {
  const company = useCompany();
  return createQuery(() => ({
    queryKey: queryKeys.tools.actionRequests(company().id, "pending"),
    queryFn: ({ signal }) => toolsApi.actionRequests(company().id, "pending", signal),
    refetchInterval: 20_000,
  }));
}

/** Refreshes everything Apps shows for the company. */
export function useRefreshTools() {
  const company = useCompany();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: queryKeys.tools.all(company().id) });
}

export function failureText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The app's logo from the gallery (`/brands/apps/…`, served beside the board), its dark version in
 * the dark theme, or a gradient tile with its initial when there's none or it doesn't load.
 */
export function AppLogo(props: { app?: AppDefinition | null; name: string; size?: number }) {
  const [failed, setFailed] = createSignal<string | null>(null);
  const size = () => props.size ?? 36;
  const src = () => {
    const branding = props.app?.branding;
    if (!branding) return null;
    return (theme() === "dark" ? branding.darkLogoUrl : undefined) ?? branding.logoUrl ?? null;
  };
  return (
    <Show
      when={src() && failed() !== src() ? src() : null}
      fallback={
        <span
          class="ap-logo ap-logo--initial"
          style={{ width: `${size()}px`, height: `${size()}px`, background: discGradient(props.app?.slug ?? props.name) }}
          aria-hidden="true"
        >
          {props.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      }
    >
      {(url) => (
        <span class="ap-logo" style={{ width: `${size()}px`, height: `${size()}px` }} aria-hidden="true">
          <img src={url()} alt="" width={size() - 10} height={size() - 10} onError={() => setFailed(url())} />
        </span>
      )}
    </Show>
  );
}

/** A connection's state as a quiet dot and label: green connected, amber when it needs you. */
export function StateTag(props: { state: ConnectionState }) {
  return (
    <span class="ap-state" classList={{ [`ap-state--${props.state.kind}`]: true }}>
      <i aria-hidden="true" />
      {props.state.label}
    </span>
  );
}

/**
 * "Every agent" or chosen agents. `locked` agents stay ticked (they carry the tools on every run, so
 * they must be allowed to use them).
 */
export function AgentAccessPicker(props: {
  value: AccessDraft;
  onChange: (next: AccessDraft) => void;
  disabled?: boolean;
  locked?: ReadonlySet<string>;
  /** Agents the viewer may change; others show but can't be toggled. */
  editable?: readonly string[];
  allLabel?: JSX.Element;
  allDescription?: JSX.Element;
}) {
  const agents = useAgentsQuery();
  const list = () => activeAgents(agents.data);
  const canEdit = (agent: Agent) => !props.editable || props.editable.includes(agent.id);
  const toggle = (agentId: string, on: boolean) => {
    const next = new Set(props.value.agentIds);
    if (on) next.add(agentId);
    else next.delete(agentId);
    props.onChange({ mode: "specific", agentIds: next });
  };
  return (
    <div class="cx-agents">
      <Toggle
        checked={props.value.mode === "all"}
        disabled={props.disabled}
        onChange={(on) => props.onChange({ mode: on ? "all" : "specific", agentIds: new Set(on ? [] : props.value.agentIds) })}
        label={props.allLabel ?? "Every agent"}
        description={props.allDescription ?? "Current and future agents can use it."}
      />
      <Show when={props.value.mode === "specific"}>
        <Show when={list().length > 0} fallback={<p class="cx-static">{agents.isPending ? "Loading agents…" : "No agents yet."}</p>}>
          <ul class="cx-options">
            <For each={list()}>
              {(agent) => {
                const locked = () => props.locked?.has(agent.id) ?? false;
                const checked = () => locked() || props.value.agentIds.has(agent.id);
                return (
                  <li>
                    <label class="cx-option" classList={{ "cx-option--on": checked() }}>
                      <input
                        type="checkbox"
                        checked={checked()}
                        disabled={props.disabled || locked() || !canEdit(agent)}
                        onChange={(event) => toggle(agent.id, event.currentTarget.checked)}
                      />
                      <AgentAvatar agent={agent} size={24} />
                      <span class="cx-option-name">{agent.name}</span>
                      <Show when={locked()}>
                        <span class="cx-option-note">Installed</span>
                      </Show>
                    </label>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </Show>
      <Show when={agents.isError}>
        <p class="cx-note cx-note--error" role="alert">
          Could not load agents.
        </p>
      </Show>
    </div>
  );
}
