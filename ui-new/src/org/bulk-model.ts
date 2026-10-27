import type {
  Agent,
  AgentRuntimeSettingsPatch,
  AiConnectionBinding,
  AiConnectionList,
  AiManagedConnectionSummary,
  AiProvider,
  AiProviderRouting,
  AiRuntimeConnectionBinding,
} from "@paperclipai/shared";
import type { AdapterModel } from "@/api/agents";

/*
 * The roster's bulk edit of AI connection and default model (board 20), ported from upstream's
 * ui/src/lib/bulk-agent-settings.ts and AgentBulkSettingsSheet.tsx. Agents are edited one harness at
 * a time; each gets a narrow `runtimeSettings` patch that carries what the preview showed
 * (`expected`), so the server rejects a change made against settings that have since moved.
 *
 * The shared package's helpers (`agentRuntimeSettingsHarness`, the binding schema) are runtime
 * code, so their few lines are ported here rather than imported (`import type` only).
 */

/** The harness behind an adapter: a Paperclip Runner agent is grouped with the harness it runs. */
export function runtimeHarness(adapterType: string, config: Record<string, unknown> = {}): string {
  if (adapterType !== "paperclip_runner") return adapterType === "cursor" ? "cursor_local" : adapterType;
  if (config.provider === undefined || config.provider === "codex") return "codex_local";
  if (config.provider === "opencode") return "opencode_local";
  if (config.provider === "acpx") {
    const agent = String(config.acpxAgent ?? "claude");
    if (agent === "copilot") return "copilot_runtime";
    return ({ codex: "codex_local", claude: "claude_local", grok: "grok_local", cursor: "cursor_local", pi: "pi_local" } as Record<string, string>)[agent] ?? `acpx:${agent}`;
  }
  return String(config.provider);
}

export const bulkHarness = (agent: Pick<Agent, "adapterType" | "adapterConfig">) => runtimeHarness(agent.adapterType, agent.adapterConfig ?? {});

export function agentDefaultModel(agent: Pick<Agent, "adapterConfig">): string | null {
  const model = agent.adapterConfig?.model;
  return typeof model === "string" ? model.trim() || null : null;
}

const PROVIDERS = new Set<AiProvider>(["anthropic", "openai", "openrouter", "xai", "github", "google"]);
const METHODS = new Set(["subscription", "api_key"]);

/** The agent's stored connection binding, when it's a well-formed one. */
export function agentConnection(agent: Pick<Agent, "runtimeConfig">): AiRuntimeConnectionBinding | undefined {
  const value = agent.runtimeConfig?.aiConnection;
  if (!value || typeof value !== "object") return undefined;
  const binding = value as Record<string, unknown>;
  const str = (key: string) => typeof binding[key] === "string" && (binding[key] as string).length > 0;
  if (binding.mode === "router") return str("connectionId") ? { mode: "router", connectionId: binding.connectionId as string } : undefined;
  if (!PROVIDERS.has(binding.provider as AiProvider) || !METHODS.has(binding.method as string)) return undefined;
  const base = { provider: binding.provider as AiProvider, method: binding.method as "subscription" | "api_key" };
  if (binding.mode === "responsible_user") return { ...base, mode: "responsible_user" };
  if ((binding.mode === "shared" || binding.mode === "delegated") && str("connectionId") && str("grantId"))
    return { ...base, mode: binding.mode, connectionId: binding.connectionId as string, grantId: binding.grantId as string };
  return undefined;
}

/** Same binding, whatever the key order. */
export function sameBinding(a: AiRuntimeConnectionBinding | undefined, b: AiRuntimeConnectionBinding | undefined) {
  const canonical = (value: AiRuntimeConnectionBinding | undefined) =>
    JSON.stringify(value && Object.fromEntries(Object.entries(value).sort(([x], [y]) => x.localeCompare(y))));
  return canonical(a) === canonical(b);
}

/** Harnesses whose connection and model Paperclip manages. */
const EDITABLE_HARNESSES = new Set([
  "codex_local", "claude_local", "gemini_local", "grok_local", "opencode_local", "hermes_local", "pi_local", "copilot_runtime", "cursor_local",
]);

/** Why an agent can't be bulk edited, or undefined when it can. */
export function bulkDisabledReason(agent: Pick<Agent, "status" | "adapterType" | "adapterConfig" | "runtimeConfig">): string | undefined {
  if (agent.status === "terminated" || agent.status === "pending_approval") return "Not available for bulk edits until it's hired";
  if (agentConnection(agent)?.mode === "router") return "Edit connection pool members on the agent's settings page";
  if (!EDITABLE_HARNESSES.has(bulkHarness(agent))) return "Its connection and model are managed outside Paperclip";
  return undefined;
}

/** The AI provider a harness signs in with, as the old UI's connection field picks it. */
export function providerForHarness(harness: string): AiProvider | undefined {
  return ({
    claude_local: "anthropic",
    codex_local: "openai",
    opencode_local: "openrouter",
    pi_local: "openrouter",
    grok_local: "xai",
    copilot_runtime: "github",
    gemini_local: "google",
    hermes_local: "openrouter",
  } as Record<string, AiProvider>)[harness];
}

/** Harness names as people know them. */
const HARNESS_LABELS: Record<string, string> = {
  claude_local: "Claude Code",
  codex_local: "Codex",
  gemini_local: "Gemini CLI",
  grok_local: "Grok",
  opencode_local: "OpenCode",
  pi_local: "Pi",
  hermes_local: "Hermes",
  hermes_gateway: "Hermes Gateway",
  cursor_local: "Cursor",
  cursor_cloud: "Cursor Cloud",
  copilot_runtime: "GitHub Copilot",
  kimi_local: "Kimi",
  openclaw_gateway: "OpenClaw",
  paperclip_runner: "Paperclip Runner",
  process: "Process",
  http: "HTTP",
};

export function harnessLabel(harness: string) {
  if (HARNESS_LABELS[harness]) return HARNESS_LABELS[harness]!;
  const words = harness.replace(/^acpx:/, "").replace(/_local$/, "").replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The connection a binding points to in the agent's connection list. */
export function resolveConnection(binding: AiRuntimeConnectionBinding | undefined, list: AiConnectionList | undefined) {
  if (!binding || !list || binding.mode === "router") return undefined;
  return list.connections.find((connection) =>
    binding.mode === "responsible_user"
      ? connection.provider === binding.provider && connection.isDefault && connection.ownership === "personal" && connection.ownerUserId === list.currentUserId
      : connection.id === binding.connectionId && connection.grantId === binding.grantId,
  );
}

export function connectionName(binding: AiRuntimeConnectionBinding | undefined, list?: AiConnectionList) {
  if (!binding) return "Local credentials";
  if (binding.mode === "router") return "Connection pool";
  if (binding.mode === "responsible_user") return "Responsible user's default";
  return list?.connections.find((connection) => connection.id === binding.connectionId && connection.grantId === binding.grantId)?.name ?? "Assigned connection";
}

/** Why a connection can't be picked, or null. */
export function connectionProblem(connection: Pick<AiManagedConnectionSummary, "status" | "unavailableReason"> | undefined) {
  if (!connection) return "Not connected";
  if (connection.unavailableReason) return connection.unavailableReason;
  return connection.status === "connected" ? null : connection.status === "needs_attention" ? "Needs attention" : connection.status === "expired" ? "Expired" : "Revoked";
}

export type ConnectionChoice = { id: string; name: string; description: string; disabled: boolean; binding: AiConnectionBinding };

/**
 * What the connection picker offers, as the old UI's picker does: the responsible user's own
 * connection, then each company-shared connection for the provider.
 */
export function connectionChoices(list: AiConnectionList | undefined, provider: AiProvider): ConnectionChoice[] {
  const connections = list?.connections ?? [];
  const forProvider = connections.filter((connection) => connection.provider === provider);
  const personal = forProvider.find((connection) => connection.ownership === "personal" && connection.ownerUserId === list?.currentUserId && connection.isDefault);
  const fallbackMethod = provider === "openrouter" || provider === "google" || provider === "github" ? "api_key" : "subscription";
  return [
    {
      id: "responsible_user",
      name: "Responsible user's connection",
      description: `For you: ${personal?.name ?? "not connected"}. Other people's tasks use their own connection.`,
      disabled: false,
      binding: { provider, method: personal?.method ?? fallbackMethod, mode: "responsible_user" },
    },
    ...forProvider
      .filter((connection) => connection.ownership === "shared")
      .map((connection) => {
        const problem = connectionProblem(connection);
        return {
          id: connection.id,
          name: connection.name,
          description: ["Company shared", connection.method === "api_key" ? "API key" : "Subscription", connection.accountLabel, problem].filter(Boolean).join(" · "),
          disabled: problem !== null,
          binding: { provider, method: connection.method, mode: "shared" as const, connectionId: connection.id, grantId: connection.grantId },
        };
      }),
  ];
}

/** Runs `fn` over the items, a few at a time; each item's failure is its own. */
export async function mapBulk<T, R>(items: readonly T[], fn: (item: T) => Promise<R>, concurrency = 4): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        try {
          results[index] = { status: "fulfilled", value: await fn(items[index]!) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}

/** Selected agents grouped by harness, in a stable order. */
export function harnessGroups<T extends Pick<Agent, "adapterType" | "adapterConfig">>(agents: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const agent of agents) {
    const harness = bulkHarness(agent);
    groups.set(harness, [...(groups.get(harness) ?? []), agent]);
  }
  return [...groups.entries()]
    .map(([harness, members]) => ({ harness, agents: members }))
    .sort((a, b) => harnessLabel(a.harness).localeCompare(harnessLabel(b.harness)));
}

/** What the person chose to change. `undefined` keeps the agent's current value. */
export type BulkChange = { binding?: AiConnectionBinding; model?: string };

/** Whether this change would alter the agent's settings. */
export function changesAgent(agent: Pick<Agent, "adapterConfig" | "runtimeConfig">, change: BulkChange) {
  return (
    (change.binding !== undefined && !sameBinding(change.binding, agentConnection(agent))) ||
    (change.model !== undefined && change.model !== agentDefaultModel(agent))
  );
}

/**
 * The `runtimeSettings` patch for one agent, or null when the change leaves it as it is. `expected`
 * is what the preview showed; a router binding can't be the expected value (those agents aren't
 * editable here), so it's sent as no connection.
 */
export function runtimePatch(agent: Pick<Agent, "adapterType" | "adapterConfig" | "runtimeConfig">, change: BulkChange): AgentRuntimeSettingsPatch | null {
  if (!changesAgent(agent, change)) return null;
  const current = agentConnection(agent);
  return {
    harness: bulkHarness(agent),
    ...(change.binding !== undefined ? { aiConnection: change.binding } : {}),
    ...(change.model !== undefined ? { model: change.model } : {}),
    expected: { model: agentDefaultModel(agent), aiConnection: current && current.mode !== "router" ? current : null },
  };
}

/** True when a re-read agent already has the change, so a retry needn't write again. */
export function alreadyApplied(agent: Pick<Agent, "adapterType" | "adapterConfig" | "runtimeConfig">, harness: string, change: BulkChange) {
  return bulkHarness(agent) === harness && !changesAgent(agent, change);
}

/** One agent's model catalog: the models its connection allows, and whether only those may be used. */
export type ModelCatalog = { agentId: string; models: AdapterModel[]; restricted: boolean };

/** How to ask for an agent's catalog: a fixed list from its connection's routing, or a request. */
export function catalogPlan(input: {
  harness: string;
  binding: AiRuntimeConnectionBinding | undefined;
  routing: AiProviderRouting | undefined;
  agent: Pick<Agent, "id" | "defaultEnvironmentId">;
}):
  | { kind: "fixed"; models: AdapterModel[]; restricted: true }
  | { kind: "request"; type: string; options: Record<string, unknown>; restricted: boolean; stripOpenRouter: boolean } {
  const { harness, binding, routing } = input;
  if (routing?.models.length) {
    const prefix = routing.kind === "openrouter" ? "openrouter" : "paperclip";
    const prefixed = harness === "opencode_local" || (harness === "pi_local" && routing.kind === "openrouter");
    return {
      kind: "fixed",
      restricted: true,
      models: routing.models.map((model) => ({
        id: prefixed && !model.id.startsWith(`${prefix}/`) ? `${prefix}/${model.id}` : model.id,
        label: model.label ?? model.id,
      })),
    };
  }
  const provider = binding && binding.mode !== "router" ? binding.provider : undefined;
  const openRouter = routing?.kind === "openrouter" || (!routing && provider === "openrouter");
  const copilot = harness === "copilot_runtime";
  if (openRouter) return { kind: "request", type: "opencode_local", options: { provider: "openrouter" }, restricted: true, stripOpenRouter: !["opencode_local", "pi_local"].includes(harness) };
  if (copilot)
    return {
      kind: "request",
      type: "paperclip_runner",
      options: { provider: "acpx", acpxAgent: "copilot", agentId: input.agent.id, aiConnection: binding, environmentId: input.agent.defaultEnvironmentId },
      restricted: true,
      stripOpenRouter: false,
    };
  return { kind: "request", type: harness, options: { environmentId: input.agent.defaultEnvironmentId }, restricted: false, stripOpenRouter: false };
}

/**
 * The models every selected agent can use: the union of their catalogs, kept only where each
 * restricted agent offers it. Free entry of a model ID is allowed only when no agent is restricted.
 */
export function commonModels(catalogs: readonly ModelCatalog[]) {
  const all = new Map<string, AdapterModel>();
  for (const catalog of catalogs) for (const model of catalog.models) if (!all.has(model.id)) all.set(model.id, model);
  const models = [...all.values()].filter((model) => catalogs.every((catalog) => !catalog.restricted || catalog.models.some((other) => other.id === model.id)));
  return { models, allowCustom: catalogs.every((catalog) => !catalog.restricted) };
}

/** Agents whose restricted catalog doesn't offer the model they'd end up with. */
export function modelProblems(
  agents: readonly Pick<Agent, "id" | "name" | "adapterConfig">[],
  catalogs: readonly ModelCatalog[],
  change: BulkChange,
) {
  return agents.flatMap((agent) => {
    const catalog = catalogs.find((entry) => entry.agentId === agent.id);
    if (!catalog?.restricted) return [];
    const next = change.model ?? agentDefaultModel(agent);
    return catalog.models.some((model) => model.id === next)
      ? []
      : [{ agentId: agent.id, name: agent.name, message: `${next ?? "The harness default"} isn't available on this connection. Choose another model.` }];
  });
}
