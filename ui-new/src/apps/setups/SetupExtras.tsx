import type { AppDefinition, ConnectionGrantKind, ConnectionMethodDef, ConnectToolApp } from "@paperclipai/shared";
import { createEffect, createSignal, For, Show, type JSX } from "solid-js";
import { activeAgents } from "@/api/agents";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Field } from "@/ui/Field";
import { Switch as Toggle } from "@/ui/Switch";
import { useGallery } from "../shared";
import {
  DEFAULT_WORKSPACE_SELECTION,
  IDENTITY_LABELS,
  identityKinds,
  identityProblem,
  withIdentity,
  withService,
  workspaceProblem,
  WORKSPACE_SERVICES,
  type IdentityChoice,
  type WorkspaceSelection,
} from "./setups-model";
import "../chat/Chat.css";

/*
 * What a gallery app's connect form adds for the setups the gallery used to hide (Connect.tsx's
 * GalleryForm takes these): who the connection acts as, and Google Workspace's services. Each
 * piece has its fields, a problem that holds Connect back, and how it changes the request.
 */

export type GalleryExtras = {
  element: JSX.Element;
  problem: () => string | null;
  apply: (payload: ConnectToolApp) => ConnectToolApp;
};

export function setupExtras(app: AppDefinition, method: () => ConnectionMethodDef | null): GalleryExtras {
  const gallery = useGallery();
  const kinds = () => identityKinds(method(), gallery.data?.capabilities);
  const [identity, setIdentity] = createSignal<IdentityChoice>({ kind: "organization", agentId: null });
  // A method without the current choice falls back to its first identity.
  createEffect(() => {
    const allowed = kinds();
    if (allowed.length > 0 && !allowed.includes(identity().kind)) setIdentity({ kind: allowed[0]!, agentId: null });
  });
  const google = app.slug === "google-workspace";
  const [services, setServices] = createSignal<WorkspaceSelection>(DEFAULT_WORKSPACE_SELECTION);
  return {
    element: (
      <>
        <Show when={google}>
          <WorkspaceServices value={services()} onChange={setServices} />
        </Show>
        <Show when={kinds().length > 1}>
          <IdentityPicker kinds={kinds()} value={identity()} onChange={setIdentity} />
        </Show>
      </>
    ),
    problem: () => (google ? workspaceProblem(services()) : null) ?? identityProblem(identity()),
    apply: (payload) => {
      const withChoice = kinds().length > 0 ? withIdentity(payload, identity()) : payload;
      return google ? ({ ...withChoice, workspaceServices: services() } as ConnectToolApp) : withChoice;
    },
  };
}

/** "Whose account is it?": the organization's, just mine, or one agent's own. */
export function IdentityPicker(props: { kinds: ConnectionGrantKind[]; value: IdentityChoice; onChange: (next: IdentityChoice) => void; disabled?: boolean }) {
  const agents = useAgentsQuery();
  return (
    <Field label="Whose account is it?" help="This decides who the connection acts as. It can't be changed later; connect another account instead.">
      <ul class="cx-options" role="radiogroup" aria-label="Whose account is it?">
        <For each={props.kinds}>
          {(kind) => (
            <li>
              <label class="cx-option ap-method" classList={{ "cx-option--on": props.value.kind === kind }}>
                <input
                  type="radio"
                  name="ap-identity"
                  checked={props.value.kind === kind}
                  disabled={props.disabled}
                  onChange={() => props.onChange({ kind, agentId: kind === "agent" ? props.value.agentId : null })}
                />
                <span class="ap-method-text">
                  <span class="cx-option-name">{IDENTITY_LABELS[kind].title}</span>
                  <span class="cx-option-note">{IDENTITY_LABELS[kind].text}</span>
                </span>
              </label>
            </li>
          )}
        </For>
      </ul>
      <Show when={props.value.kind === "agent"}>
        <ul class="ch-pick" role="radiogroup" aria-label="The agent the account belongs to">
          <For each={activeAgents(agents.data)}>
            {(agent) => (
              <li>
                <label class="cx-option" classList={{ "cx-option--on": props.value.agentId === agent.id }}>
                  <input type="radio" name="ap-identity-agent" checked={props.value.agentId === agent.id} onChange={() => props.onChange({ kind: "agent", agentId: agent.id })} />
                  <AgentAvatar agent={agent} size={24} />
                  <span class="cx-option-name">{agent.name}</span>
                </label>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Field>
  );
}

/** Google Workspace's services, each on or off, read only or read and write. */
export function WorkspaceServices(props: { value: WorkspaceSelection; onChange: (next: WorkspaceSelection) => void }) {
  return (
    <Field label="Google services" help="Agents get only these. Google's consent screen asks for exactly this access.">
      <ul class="ch-list">
        <For each={WORKSPACE_SERVICES}>
          {(service) => (
            <li class="ch-row">
              <img src={service.logo} alt="" width={24} height={24} />
              <span class="ch-row-main">
                <Toggle
                  checked={Boolean(props.value[service.id])}
                  onChange={(on) => props.onChange(withService(props.value, service.id, on ? "write" : null))}
                  label={service.name}
                  description={service.description}
                />
              </span>
              <select
                class="input"
                aria-label={`${service.name} access`}
                disabled={!props.value[service.id]}
                value={props.value[service.id] ?? "write"}
                onChange={(event) => props.onChange(withService(props.value, service.id, event.currentTarget.value as "read" | "write"))}
              >
                <option value="read">Read only</option>
                <option value="write">Read and write</option>
              </select>
            </li>
          )}
        </For>
      </ul>
    </Field>
  );
}
