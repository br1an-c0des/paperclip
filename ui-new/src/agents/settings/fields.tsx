import type { AdapterEnvironmentTestResult, Agent, AgentRole, Environment } from "@paperclipai/shared";
import { Check, Server } from "lucide-solid";
import { For, Show } from "solid-js";
import type { AdapterModel } from "@/api/agents";
import { AgentAvatar } from "@/ui/Avatar";
import { FieldButton } from "@/ui/Field";
import { Menu } from "@/ui/Menu";
import { AGENT_PALETTES, AGENT_ROLE_OPTIONS, modelLabel, paletteLabel, roleLabel } from "../agent-model";

/*
 * Fields the agent's settings and New agent (boards 26, N2, N3) share: the avatar palettes, role,
 * manager, model and environment pickers, the harness disc and a test's checks. Each takes its value
 * and reports a pick; saving is up to the page.
 */

/** The appearance an avatar palette stands for. */
export function paletteAppearance(paletteId: string) {
  return { schemaVersion: 1 as const, characterVersion: "cap-v1" as const, paletteId: paletteId as (typeof AGENT_PALETTES)[number] };
}

/** The ClipLab palettes as a radio group, each previewed on the agent's avatar. */
export function PaletteGrid(props: {
  /** The avatar's seed and name, for the previews. */
  agent: { id: string; name: string };
  value: string | null | undefined;
  onPick: (paletteId: string) => void;
  size?: 40 | 48;
  class?: string;
}) {
  return (
    <div class={`ag-palettes ${props.class ?? ""}`} role="radiogroup" aria-label="Avatar palette">
      <For each={AGENT_PALETTES}>
        {(palette) => (
          <button
            type="button"
            role="radio"
            class="ag-palette"
            aria-checked={props.value === palette}
            aria-label={paletteLabel(palette)}
            title={paletteLabel(palette)}
            onClick={() => props.value !== palette && props.onPick(palette)}
          >
            <AgentAvatar agent={{ id: props.agent.id, name: props.agent.name, appearance: paletteAppearance(palette) }} size={props.size ?? 40} ring={false} />
          </button>
        )}
      </For>
    </div>
  );
}

export function RoleMenu(props: { value: AgentRole | string; onChange: (role: AgentRole) => void; class?: string; id?: string }) {
  return (
    <Menu>
      <Menu.Trigger as={FieldButton} id={props.id} class={props.class ?? "ps-field-240"} aria-label={`Role: ${roleLabel(props.value)}`}>
        {roleLabel(props.value)}
      </Menu.Trigger>
      <Menu.Content label="Role" width={220}>
        <For each={AGENT_ROLE_OPTIONS}>
          {(option) => (
            <Menu.Item onSelect={() => option.value !== props.value && props.onChange(option.value)} hint={option.value === props.value ? <Check size={14} /> : undefined}>
              {option.label}
            </Menu.Item>
          )}
        </For>
      </Menu.Content>
    </Menu>
  );
}

/** Who the agent reports to: one of `candidates` (see `managerCandidates`), or nobody. */
export function ManagerMenu(props: {
  candidates: readonly Pick<Agent, "id" | "name" | "appearance" | "status">[];
  /** The manager's agent, when it's known; the value itself is its id. */
  manager: Pick<Agent, "id" | "name" | "appearance" | "status"> | undefined;
  value: string | null;
  onChange: (agentId: string | null) => void;
  class?: string;
}) {
  return (
    <Menu>
      <Menu.Trigger
        as={FieldButton}
        class={props.class ?? "ps-field-360"}
        aria-label={`Reports to ${props.manager?.name ?? "nobody"}`}
        icon={<Show when={props.manager}>{(found) => <AgentAvatar agent={found()} size={20} ring={false} />}</Show>}
      >
        {props.manager?.name ?? "Nobody: top of the org"}
      </Menu.Trigger>
      <Menu.Content label="Reports to" width={280}>
        <For each={props.candidates} fallback={<p class="nt-menu-note">No other agents to report to.</p>}>
          {(agent) => (
            <Menu.Item
              onSelect={() => agent.id !== props.value && props.onChange(agent.id)}
              icon={<AgentAvatar agent={agent} size={24} ring={false} />}
              hint={agent.id === props.value ? <Check size={14} /> : undefined}
            >
              {agent.name}
            </Menu.Item>
          )}
        </For>
        <Menu.Separator />
        <Menu.Item onSelect={() => props.value && props.onChange(null)} hint={props.value ? undefined : <Check size={14} />}>
          Nobody
        </Menu.Item>
      </Menu.Content>
    </Menu>
  );
}

/** A harness's models; an empty value is the harness's own default. */
export function ModelMenu(props: {
  models: readonly AdapterModel[] | undefined;
  loading: boolean;
  value: string;
  onChange: (model: string) => void;
  /** Offers "Harness default" as the first item. */
  allowDefault?: boolean;
  class?: string;
}) {
  const label = () => modelLabel(props.value, props.models) ?? "Harness default";
  return (
    <Menu>
      <Menu.Trigger as={FieldButton} class={props.class ?? "ps-field-320"} aria-label={`Model: ${label()}`}>
        {label()}
      </Menu.Trigger>
      <Menu.Content label="Model" width={320}>
        <Show when={props.allowDefault}>
          <Menu.Item onSelect={() => props.onChange("")} hint={props.value ? undefined : <Check size={14} />} description="Whatever the harness picks">
            Harness default
          </Menu.Item>
          <Menu.Separator />
        </Show>
        <Show when={props.loading}>
          <p class="nt-menu-note">Loading models…</p>
        </Show>
        <For each={props.models ?? []} fallback={<Show when={!props.loading}><p class="nt-menu-note">This harness lists no models.</p></Show>}>
          {(model) => (
            <Menu.Item onSelect={() => props.onChange(model.id)} hint={props.value === model.id ? <Check size={14} /> : undefined}>
              {model.label}
            </Menu.Item>
          )}
        </For>
      </Menu.Content>
    </Menu>
  );
}

/** The instance's default environment: the one marked `defaultForInstance`. */
export function instanceDefaultEnvironment(environments: readonly Environment[] | undefined) {
  return environments?.find((entry) => (entry.metadata as Record<string, unknown> | null)?.defaultForInstance === true);
}

/** Where the agent runs: the organization default (an empty value) or one active environment. */
export function EnvironmentMenu(props: {
  environments: readonly Environment[] | undefined;
  value: string;
  onChange: (environmentId: string) => void;
  disabled?: boolean;
  class?: string;
}) {
  const chosen = () => props.environments?.find((entry) => entry.id === props.value);
  const fallback = () => instanceDefaultEnvironment(props.environments);
  return (
    <Menu>
      <Menu.Trigger
        as={FieldButton}
        class={props.class ?? "ps-field-360"}
        icon={<Server size={14} aria-hidden="true" />}
        aria-label="Environment"
        disabled={props.disabled}
      >
        {props.value ? (chosen()?.name ?? "An environment you can't see") : `Organization default${fallback() ? ` · ${fallback()!.name}` : ""}`}
      </Menu.Trigger>
      <Menu.Content label="Environment" width={340}>
        <Menu.Item onSelect={() => props.onChange("")} hint={props.value ? undefined : <Check size={14} />} description="The instance's default environment">
          Organization default
        </Menu.Item>
        <Menu.Separator />
        <For each={(props.environments ?? []).filter((entry) => entry.status === "active")}>
          {(entry) => (
            <Menu.Item onSelect={() => props.onChange(entry.id)} description={entry.description ?? entry.driver} hint={props.value === entry.id ? <Check size={14} /> : undefined}>
              {entry.name}
            </Menu.Item>
          )}
        </For>
      </Menu.Content>
    </Menu>
  );
}

/** Two letters for a harness: "CC" for Claude Code, "CO" for Codex. */
export function harnessMark(harness: string) {
  const marks: Record<string, string> = {
    claude_local: "CC",
    codex_local: "CX",
    opencode_local: "OC",
    gemini_local: "GM",
    cursor: "CR",
    pi_local: "PI",
    kimi_local: "KM",
    hermes_local: "HM",
    grok_local: "GK",
  };
  return marks[harness] ?? harness.replace(/^acpx:/, "").slice(0, 2).toUpperCase();
}

export function HarnessDisc(props: { harness: string }) {
  return (
    <span class="ag-harness-disc" aria-hidden="true">
      {harnessMark(props.harness)}
    </span>
  );
}

/** A setup test's checks, one per line, with their hints. */
export function TestChecks(props: { result: AdapterEnvironmentTestResult | null | undefined }) {
  return (
    <Show when={props.result?.checks.length}>
      <ul class="ag-checks">
        <For each={props.result!.checks}>
          {(check) => (
            <li data-level={check.level}>
              <b>{check.message}</b>
              <Show when={check.hint ?? check.detail}>
                <span>{check.hint ?? check.detail}</span>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
