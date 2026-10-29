import type {
  ConnectionGrantsResponse,
  ToolCatalogEntry,
  ToolConnectionAccessSummary,
  ToolConnectionTestAgent,
  ToolConnectionTestCallStatusPhase,
  ToolConnectionTestDecision,
} from "@paperclipai/shared";

/*
 * View model for testing an action as an agent (src/apps/TestCall.tsx, the old UI's
 * ActionTestDialog) and for the app panels on a connection's Settings (Railway, Browser Use).
 */

export const DECISION_LABELS: Record<ToolConnectionTestDecision, string> = {
  allowed: "Allowed",
  ask_first: "Ask first",
  off: "Off",
};

/** Highest in the org first, then by name, as the old picker orders them. */
export function sortTestAgents(agents: readonly ToolConnectionTestAgent[]) {
  return [...agents].sort((a, b) => a.orgDepth - b.orgDepth || a.name.localeCompare(b.name));
}

/** How the action behaves for the agent; an action the summary doesn't list is off. */
export function decisionFor(access: ToolConnectionAccessSummary | undefined, entry: Pick<ToolCatalogEntry, "toolName">): ToolConnectionTestDecision {
  const tool = access?.tools.find((candidate) => candidate.toolName === entry.toolName || candidate.gatewayToolName === entry.toolName);
  return tool?.decision ?? "off";
}

const TERMINAL: ReadonlySet<ToolConnectionTestCallStatusPhase> = new Set(["done", "denied", "cancelled", "expired"]);

export function isTerminal(phase: ToolConnectionTestCallStatusPhase | undefined) {
  return phase ? TERMINAL.has(phase) : false;
}

export const PHASE_LABELS: Record<ToolConnectionTestCallStatusPhase, string> = {
  waiting: "Waiting for approval in Review",
  running: "Approved, running",
  done: "Done",
  denied: "Declined in Review",
  cancelled: "Cancelled",
  expired: "The approval window ran out",
};

/** An MCP result that says it failed (`isError`), as an error the dialog shows. */
export function resultError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Record<string, unknown>;
  const data = envelope.data && typeof envelope.data === "object" ? (envelope.data as Record<string, unknown>) : null;
  if (data?.isError !== true && envelope.isError !== true) return null;
  if (typeof envelope.content === "string" && envelope.content.trim()) return envelope.content;
  if (typeof envelope.error === "string" && envelope.error.trim()) return envelope.error;
  return "The app returned an error result.";
}

/** A result as readable text: MCP text content when there is some, else indented JSON. */
export function resultText(value: unknown): string {
  if (value === undefined || value === null) return "No result.";
  if (typeof value === "string") return value;
  const envelope = value as { content?: unknown };
  if (Array.isArray(envelope.content)) {
    const texts = envelope.content
      .map((part) => (part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? (part as { text?: unknown }).text : null))
      .filter((text): text is string => typeof text === "string");
    if (texts.length > 0) return texts.join("\n\n");
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Drops empty optional values so the call only sends what was filled in. */
export function cleanParameters(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)));
}

// ---------------------------------------------------------------------------------------------
// App panels

type Grant = ConnectionGrantsResponse["grants"][number];

/** The connection's own app, when it has a panel on Settings. */
export function appPanel(slug: string | null | undefined): "railway" | "browser-use-cloud" | null {
  return slug === "railway" || slug === "browser-use-cloud" ? slug : null;
}

/**
 * Railway container access is set per authorization, by its owner: your own grants, or shared
 * and agent ones. Only active ones can get a new key.
 */
export function railwayGrants(grants: ConnectionGrantsResponse | undefined) {
  const owned = (grants?.grants ?? []).filter((grant) => grant.kind !== "user" || grant.subjectUserId === grants?.currentUserId);
  return { owned, eligible: owned.filter((grant) => grant.status === "active") };
}

/** Browser Use settings belong to a credential you own or a shared one you manage. */
export function browserUseGrants(grants: ConnectionGrantsResponse | undefined): Grant[] {
  return (grants?.grants ?? []).filter(
    (grant) =>
      grant.status === "active" &&
      ((grant.kind === "organization" && grant.capabilities?.canEditAudience) ||
        grant.subjectUserId === grants?.currentUserId ||
        grant.createdByUserId === grants?.currentUserId),
  );
}

export function grantLabel(grant: Pick<Grant, "kind">, index?: number) {
  const base = grant.kind === "organization" ? "Shared account" : grant.kind === "user" ? "My account" : "Agent account";
  return index === undefined ? base : `${base} ${index + 1}`;
}

/** A cost cap in dollars: empty for none, otherwise a positive number. */
export function costCap(text: string): { ok: true; value: number | null } | { ok: false } {
  if (!text.trim()) return { ok: true, value: null };
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? { ok: true, value } : { ok: false };
}
