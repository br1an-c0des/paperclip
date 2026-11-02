import type { AppDefinition, ConnectionAgentInstructions, ConnectionGrantKind, ConnectionMethodDef, ConnectToolApp } from "@paperclipai/shared";
import { createEffect, createSignal, For, Show, type JSX } from "solid-js";
import { activeAgents } from "@/api/agents";
import { useAgentsQuery } from "@/lib/company-data";
import { AgentAvatar } from "@/ui/Avatar";
import { Field } from "@/ui/Field";
import { Switch as Toggle } from "@/ui/Switch";
import { useConnections, useGallery } from "../shared";
import { InstructionsEditor, SheetsRobotFields } from "./AppExtras";
import {
  defaultInstructions,
  instructionsPayload,
  instructionsProblem,
  isSheetsRobotMethod,
  parseSheetLinks,
  savedInstructions,
  sheetsProblem,
  vercelIdentityKinds,
} from "./extras-model";
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
 * GalleryForm takes these): who the connection acts as, Google Workspace's services, the agent
 * instructions some apps come with, and Google Sheets' robot account. Each piece has its fields, a
 * problem that holds Connect back, and how it changes the request.
 */

export type GalleryExtras = {
  element: JSX.Element;
  problem: () => string | null;
  apply: (payload: ConnectToolApp) => ConnectToolApp;
};

export function setupExtras(
  app: AppDefinition,
  method: () => ConnectionMethodDef | null,
  options: { resume?: string | null; vercel?: boolean } = {},
): GalleryExtras {
  const gallery = useGallery();
  const connections = useConnections();
  const kinds = () => (options.vercel ? vercelIdentityKinds : identityKinds)(method(), gallery.data?.capabilities);
  const [identity, setIdentity] = createSignal<IdentityChoice>({ kind: "organization", agentId: null });
  // A method without the current choice falls back to its first identity.
  createEffect(() => {
    const allowed = kinds();
    if (allowed.length > 0 && !allowed.includes(identity().kind)) setIdentity({ kind: allowed[0]!, agentId: null });
  });
  const google = app.slug === "google-workspace";
  const [services, setServices] = createSignal<WorkspaceSelection>(DEFAULT_WORKSPACE_SELECTION);

  // Agent instructions: the app's default for a new connection, what a resumed one saved.
  const template = app.agentInstructions ?? null;
  const resumed = () => (options.resume ? connections.data?.connections.find((connection) => connection.id === options.resume) ?? null : null);
  const [instructionsDraft, setInstructionsDraft] = createSignal<ConnectionAgentInstructions | null>(null);
  const instructions = () => instructionsDraft() ?? (resumed() ? savedInstructions(resumed()!, template) : defaultInstructions(template));

  // Google Sheets through the robot account.
  const robot = () => isSheetsRobotMethod(app, method());
  const robotEmail = () => app.availability?.robotEmail ?? null;
  const [sheetLinks, setSheetLinks] = createSignal("");

  return {
    element: (
      <>
        <Show when={google}>
          <WorkspaceServices value={services()} onChange={setServices} />
        </Show>
        <Show when={robot()}>
          <SheetsRobotFields robotEmail={robotEmail()} links={sheetLinks()} onLinks={setSheetLinks} />
        </Show>
        <Show when={kinds().length > 1}>
          <IdentityPicker kinds={kinds()} value={identity()} onChange={setIdentity} />
        </Show>
        <Show when={instructions()}>
          {(value) => <InstructionsEditor provider={app.name} template={template} value={value()} onChange={setInstructionsDraft} />}
        </Show>
      </>
    ),
    problem: () =>
      (google ? workspaceProblem(services()) : null) ??
      (robot() ? sheetsProblem(sheetLinks(), robotEmail()) : null) ??
      identityProblem(identity()) ??
      instructionsProblem(instructions()),
    apply: (payload) => {
      let next = kinds().length > 0 ? withIdentity(payload, identity()) : payload;
      if (google) next = { ...next, workspaceServices: services() } as ConnectToolApp;
      if (robot()) next = { ...next, configValues: { allowedSpreadsheetIds: parseSheetLinks(sheetLinks()).ids } } as ConnectToolApp;
      const value = instructions();
      if (value) next = { ...next, agentInstructions: instructionsPayload(value) } as ConnectToolApp;
      return next;
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
