import type {
  AppDefinition,
  ConnectionAgentInstructions,
  ConnectionGrantKind,
  ConnectionInstructionTemplate,
  ConnectionMethodDef,
  ToolConnection,
  ToolConnectionCreateCapabilities,
} from "@paperclipai/shared";
import { identityKinds } from "./setups-model";

/*
 * View model for the smaller per-app setups (src/apps/setups/AppExtras.tsx):
 *
 * - Agent instructions: some apps (the memory connectors so far) come with a short instruction that
 *   is added to the prompt of every agent assigned the connection. It's on by default, editable, and
 *   kept on the connection (`agentInstructions`). Copied from the shared package's
 *   connection-instructions helpers, which load zod at runtime.
 * - Honcho's workspace: kept in the connection's `config.methodConfig.workspaceId`.
 * - Google Sheets through the Paperclip robot account: share each sheet with the robot's email, then
 *   paste the links; agents can open only those sheets (`config.allowedSpreadsheetIds`). Copied from
 *   the old UI's `pages/apps/google-sheets.ts`.
 * - Whose account a Vercel Connect connection is: a connector made for an app principal (API key
 *   methods) can back only the organization's identity, as the server checks.
 */

// ---------------------------------------------------------------------------------------------
// Agent instructions

export const INSTRUCTIONS_MAX_LENGTH = 2000;

/** What a new connection starts with: the app's instruction, on. */
export function defaultInstructions(template: ConnectionInstructionTemplate | null | undefined): ConnectionAgentInstructions | null {
  return template ? { enabled: true, text: template.text, template: { id: template.id, version: template.version } } : null;
}

/**
 * What an existing connection has. One saved without instructions (cleared on purpose, or made
 * before the app had them) reads as the app's instruction, turned off.
 */
export function savedInstructions(
  connection: Pick<ToolConnection, "agentInstructions">,
  template: ConnectionInstructionTemplate | null | undefined,
): ConnectionAgentInstructions | null {
  if (connection.agentInstructions) return connection.agentInstructions;
  const fallback = defaultInstructions(template);
  return fallback ? { ...fallback, enabled: false } : null;
}

/** True when the text or the template it came from differs from the app's current instruction. */
export function instructionsChanged(value: ConnectionAgentInstructions, template: ConnectionInstructionTemplate | null | undefined) {
  if (!template) return false;
  return value.text !== template.text || value.template?.id !== template.id || value.template?.version !== template.version;
}

/**
 * Whether a connection's instructions can reach agents: the server leaves them out until every
 * required public field of its method is filled (the shared `connectionInstructionContext`, which
 * returns null then). An app this Paperclip doesn't list has no fields to fill.
 */
export function instructionsConfigured(app: Pick<AppDefinition, "methods"> | null | undefined, connection: Pick<ToolConnection, "config" | "transportConfig">) {
  const config = { ...connection.transportConfig, ...connection.config } as Record<string, unknown>;
  const method = app?.methods.find((entry) => entry.key === config.connectionMethodKey) ?? app?.methods[0];
  const values = config.methodConfig && typeof config.methodConfig === "object" && !Array.isArray(config.methodConfig) ? (config.methodConfig as Record<string, unknown>) : {};
  return [...(method?.tenantFields ?? []), ...(method?.extensionFields ?? [])].every((field) => {
    if (field.secret || field.type === "password" || !field.required) return true;
    const value = values[field.key] ?? field.defaultValue;
    return !(value === undefined || value === null || (typeof value === "string" && !value.trim()));
  });
}

/** The app's instruction again, keeping whether it's on. */
export function resetInstructions(value: ConnectionAgentInstructions, template: ConnectionInstructionTemplate): ConnectionAgentInstructions {
  return { ...defaultInstructions(template)!, enabled: value.enabled };
}

export function instructionsProblem(value: ConnectionAgentInstructions | null) {
  if (!value) return null;
  if (!value.text.trim()) return "Write the agent instructions, or reset them to the default.";
  if (value.text.length > INSTRUCTIONS_MAX_LENGTH) return `Agent instructions can be at most ${INSTRUCTIONS_MAX_LENGTH} characters.`;
  return null;
}

export function sameInstructions(a: ConnectionAgentInstructions | null | undefined, b: ConnectionAgentInstructions | null | undefined) {
  if (!a || !b) return !a && !b;
  return a.enabled === b.enabled && a.text === b.text && a.template?.id === b.template?.id && a.template?.version === b.template?.version;
}

/** The instructions as the server stores them (the text trimmed). */
export function instructionsPayload(value: ConnectionAgentInstructions): ConnectionAgentInstructions {
  return { ...value, text: value.text.trim() };
}

// ---------------------------------------------------------------------------------------------
// Honcho

/** The workspace a Honcho connection's agents use. Older connections keep it in transportConfig. */
export function honchoWorkspace(connection: Pick<ToolConnection, "config" | "transportConfig">): string {
  const value = methodConfig(connection).workspaceId;
  return typeof value === "string" ? value : "";
}

/** The connection's config with a new workspace, as the old UI saves it (`PATCH tool-connections/:id`). */
export function honchoConfig(connection: Pick<ToolConnection, "config" | "transportConfig">, workspaceId: string): Record<string, unknown> {
  const merged = mergedConfig(connection);
  return { ...merged, methodConfig: { ...methodConfig(connection), workspaceId: workspaceId.trim() } };
}

export function isHoncho(connection: Pick<ToolConnection, "config" | "transportConfig">) {
  return mergedConfig(connection).sourceTemplateKey === "honcho";
}

function mergedConfig(connection: Pick<ToolConnection, "config" | "transportConfig">): Record<string, unknown> {
  return { ...(connection.transportConfig ?? {}), ...(connection.config ?? {}) };
}

function methodConfig(connection: Pick<ToolConnection, "config" | "transportConfig">): Record<string, unknown> {
  const raw = mergedConfig(connection).methodConfig;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------------------------
// Google Sheets through the robot account

export const SHEETS_SLUG = "google-sheets";

/** The way to connect Google Sheets by sharing sheets with Paperclip's robot account. */
export function isSheetsRobotMethod(app: Pick<AppDefinition, "slug"> | null | undefined, method: Pick<ConnectionMethodDef, "key"> | string | null | undefined) {
  const key = typeof method === "string" ? method : method?.key;
  return app?.slug === SHEETS_SLUG && key === "local";
}

/** The sheet ids in pasted links (one per line, or separated by commas), and how many weren't links. */
export function parseSheetLinks(value: string): { ids: string[]; invalidCount: number } {
  const ids: string[] = [];
  let invalidCount = 0;
  for (const raw of value.split(/[\s,]+/g)) {
    const token = raw.trim().replace(/[),.;\]]+$/g, "");
    if (!token) continue;
    try {
      const match = new URL(token).pathname.match(/\/spreadsheets\/d\/([^/]+)/i);
      if (match?.[1]) {
        ids.push(decodeURIComponent(match[1]));
        continue;
      }
      invalidCount += 1;
    } catch {
      invalidCount += 1;
    }
  }
  return { ids: [...new Set(ids)], invalidCount };
}

export function sheetsProblem(links: string, robotEmail: string | null | undefined) {
  if (!robotEmail) return "Google Sheets' robot account isn't set up on this Paperclip.";
  const parsed = parseSheetLinks(links);
  if (parsed.invalidCount > 0) return "That doesn't look like a Google Sheets link.";
  if (parsed.ids.length === 0) return "Paste at least one Google Sheets link.";
  return null;
}

/** The sheets a robot-account connection may open. */
export function sheetIds(connection: Pick<ToolConnection, "config">): string[] {
  const raw = connection.config?.allowedSpreadsheetIds;
  return Array.isArray(raw) ? raw.map((value) => String(value).trim()).filter(Boolean) : [];
}

export function sheetUrl(id: string) {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;
}

/** The connection's config with a new list of sheets, which the robot's server also reads from its env. */
export function sheetsConfig(config: Record<string, unknown> | null | undefined, ids: string[]): Record<string, unknown> {
  const env = config && typeof config.env === "object" && config.env && !Array.isArray(config.env) ? (config.env as Record<string, unknown>) : {};
  return { ...(config ?? {}), allowedSpreadsheetIds: ids, env: { ...env, GOOGLE_SHEETS_ALLOWED_SPREADSHEET_IDS: ids.join(",") } };
}

/** A robot-account connection: its sheets list is what agents may open. */
export function isSheetsRobotConnection(connection: Pick<ToolConnection, "config">) {
  return connection.config?.sourceTemplateKey === SHEETS_SLUG && (connection.config?.connectionMethodKey === "local" || Array.isArray(connection.config?.allowedSpreadsheetIds));
}

// ---------------------------------------------------------------------------------------------
// Whose account, through Vercel Connect

/**
 * Who a connection made through Vercel Connect may act as. Vercel connectors for API-key methods act
 * as the app itself, which only the organization's identity can hold; OAuth methods act as a person
 * and offer the method's usual choices.
 */
export function vercelIdentityKinds(method: ConnectionMethodDef | null | undefined, capabilities: ToolConnectionCreateCapabilities | undefined): ConnectionGrantKind[] {
  const kinds = identityKinds(method, capabilities);
  return method?.auth === "oauth" ? kinds : kinds.filter((kind) => kind === "organization");
}
