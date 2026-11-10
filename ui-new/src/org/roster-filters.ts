import type { Agent, AiConnectionList } from "@paperclipai/shared";
import { harnessLabel, runtimeIdentity } from "@/agents/agent-model";
import { agentConnection, agentDefaultModel } from "./bulk-model";

/*
 * Manage agents' attribute filters (U103), after upstream's roster filters (#20317,
 * ui/src/lib/agent-roster-filters.ts): model (or "Harness default"), status, harness and AI
 * connection, each one value or All. They sit beside the state tabs (`?filter=`) and search, and
 * live in the address too (`?model=`, `?status=`, `?harness=`, `?connection=`), so a filtered
 * roster can be linked and survives a reload.
 *
 * The connection kinds are derived as the old UI derives them: a setup draft that hasn't picked
 * its harness is "Not configured"; process and HTTP agents are "Managed externally"; an agent with
 * no binding runs on "Local credentials"; then the responsible user's default, a pool (by name),
 * or an assigned connection (by name). One deliberate difference: a process or HTTP agent's model
 * is "Managed externally", as the roster's own column says, where upstream counts it as the
 * harness default. Retired agents and hires waiting for approval have no
 * values, so any attribute filter hides them, as upstream's index leaves them out.
 */

export const ROSTER_FIELDS = ["model", "status", "harness", "connection"] as const;
export type RosterField = (typeof ROSTER_FIELDS)[number];
export type RosterFilters = Record<RosterField, string>;
export type RosterOption = { value: string; label: string };
export type RosterValues = Record<RosterField, RosterOption>;

export const EMPTY_ROSTER_FILTERS: RosterFilters = { model: "", status: "", harness: "", connection: "" };

export const ROSTER_FIELD_LABELS: Record<RosterField, string> = { model: "Model", status: "Status", harness: "Harness", connection: "Connection" };
export const ROSTER_ALL_LABELS: Record<RosterField, string> = {
  model: "All models",
  status: "All statuses",
  harness: "All harnesses",
  connection: "All connections",
};

/**
 * The harness a setup draft has chosen but not saved yet: the old UI's `pendingAgentSetupChoice`,
 * whose one case is Google Antigravity on the Paperclip Runner.
 */
export function pendingSetupHarness(agent: Pick<Agent, "pauseReason" | "metadata">): string | undefined {
  if (agent.pauseReason !== "setup" || !agent.metadata || typeof agent.metadata !== "object") return undefined;
  const metadata = agent.metadata as Record<string, unknown>;
  const choice = metadata.setupAdapterChoice as Record<string, unknown> | undefined;
  if (metadata.setupAdapterPending !== true || !choice || typeof choice !== "object") return undefined;
  return choice.adapterType === "paperclip_runner" && choice.runnerProvider === "antigravity" && choice.runner === "auto" ? "antigravity_runtime" : undefined;
}

const STATUS_LABELS: Record<string, string> = { active: "Active", idle: "Idle", running: "Running", paused: "Paused", error: "Error" };

type RosterAgent = Pick<Agent, "id" | "status" | "adapterType" | "adapterConfig" | "runtimeConfig" | "pauseReason" | "metadata">;

/** Connection and pool names from the company's connection list, to name the agents' bindings. */
function connectionNames(list: AiConnectionList | undefined) {
  return {
    connections: new Map((list?.connections ?? []).map((connection) => [`${connection.id}\u0000${connection.grantId}`, connection.name])),
    pools: new Map((list?.pools ?? []).map((pool) => [pool.id, pool.name])),
  };
}

/** One agent's model, status, harness and connection, or undefined when the filters never match it. */
export function rosterValues(agent: RosterAgent, names = connectionNames(undefined)): RosterValues | undefined {
  if (agent.status === "terminated" || agent.status === "pending_approval") return undefined;
  const pending = pendingSetupHarness(agent);
  const harness = pending ?? runtimeIdentity(agent).harness;
  const model = agentDefaultModel(agent);
  const binding = agentConnection(agent);
  let connection: RosterOption;
  if (pending) connection = { value: "unconfigured", label: "Not configured" };
  else if (agent.adapterType === "http" || agent.adapterType === "process") connection = { value: "external", label: "Managed externally" };
  else if (!binding) connection = { value: "local", label: "Local credentials" };
  else if (binding.mode === "responsible_user") connection = { value: "responsible_user", label: "Responsible user's default" };
  else if (binding.mode === "router") connection = { value: `pool:${binding.connectionId}`, label: names.pools.get(binding.connectionId) ?? "Connection pool" };
  else
    connection = {
      value: `connection:${binding.connectionId}`,
      label: names.connections.get(`${binding.connectionId}\u0000${binding.grantId}`) ?? "Assigned connection",
    };
  // A process or HTTP agent's model is the roster's "Managed externally" here too (org-model.ts
  // `harnessAndModel`); upstream files it under Harness default.
  return {
    model: pending
      ? { value: "unconfigured", label: "Not available yet" }
      : connection.value === "external"
        ? { value: "external", label: "Managed externally" }
        : model
          ? { value: `model:${model}`, label: model }
          : { value: "default", label: "Harness default" },
    status: { value: agent.status, label: STATUS_LABELS[agent.status] ?? agent.status.charAt(0).toUpperCase() + agent.status.slice(1) },
    harness: { value: harness, label: harnessLabel(harness) },
    connection,
  };
}

/** Every agent's values, and each field's choices sorted by name. */
export function buildRosterIndex(agents: readonly RosterAgent[], list?: AiConnectionList) {
  const names = connectionNames(list);
  const byAgentId = new Map<string, RosterValues>();
  const choices = Object.fromEntries(ROSTER_FIELDS.map((field) => [field, new Map<string, RosterOption>()])) as Record<RosterField, Map<string, RosterOption>>;
  for (const agent of agents) {
    const values = rosterValues(agent, names);
    if (!values) continue;
    byAgentId.set(agent.id, values);
    for (const field of ROSTER_FIELDS) if (!choices[field].has(values[field].value)) choices[field].set(values[field].value, { ...values[field] });
  }
  const options = Object.fromEntries(
    ROSTER_FIELDS.map((field) => [field, [...choices[field].values()].sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))]),
  ) as Record<RosterField, RosterOption[]>;
  // Two connections can share a name (or both be unnamed): number them so each stays its own choice.
  const totals = new Map<string, number>();
  for (const option of options.connection) totals.set(option.label, (totals.get(option.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const option of options.connection) {
    if ((totals.get(option.label) ?? 0) < 2) continue;
    const nth = (seen.get(option.label) ?? 0) + 1;
    seen.set(option.label, nth);
    option.label = `${option.label} (${nth})`;
  }
  return { byAgentId, options };
}

export type RosterIndex = ReturnType<typeof buildRosterIndex>;

/** Whether an agent's values pass the filters. With no filter set, every agent does. */
export function matchesRoster(values: RosterValues | undefined, filters: RosterFilters, except?: RosterField) {
  return ROSTER_FIELDS.every((field) => field === except || !filters[field] || values?.[field].value === filters[field]);
}

/** How many of the four filters are set. */
export function activeRosterCount(filters: RosterFilters) {
  return ROSTER_FIELDS.filter((field) => filters[field]).length;
}

/**
 * Each choice's agent count, among the agents the other three filters let through, so a count says
 * how many agents picking it would show.
 */
export function rosterCounts(values: readonly (RosterValues | undefined)[], filters: RosterFilters) {
  const counts = Object.fromEntries(ROSTER_FIELDS.map((field) => [field, new Map<string, number>()])) as Record<RosterField, Map<string, number>>;
  for (const entry of values) {
    if (!entry) continue;
    for (const field of ROSTER_FIELDS) {
      if (!matchesRoster(entry, filters, field)) continue;
      counts[field].set(entry[field].value, (counts[field].get(entry[field].value) ?? 0) + 1);
    }
  }
  return counts;
}

/** The filters in the address: each field's own parameter, or All. */
export function rosterFiltersFromSearch(search: Partial<Record<RosterField, string | string[] | undefined>>): RosterFilters {
  const read = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  return { model: read(search.model), status: read(search.status), harness: read(search.harness), connection: read(search.connection) };
}

/** The address parameters for the filters, with All as no parameter. */
export function rosterSearchPatch(filters: RosterFilters): Record<RosterField, string | undefined> {
  return Object.fromEntries(ROSTER_FIELDS.map((field) => [field, filters[field] || undefined])) as Record<RosterField, string | undefined>;
}

/** Picking a choice sets the field; picking the one already set goes back to All. */
export function toggleRosterFilter(filters: RosterFilters, field: RosterField, value: string): RosterFilters {
  return { ...filters, [field]: filters[field] === value ? "" : value };
}
