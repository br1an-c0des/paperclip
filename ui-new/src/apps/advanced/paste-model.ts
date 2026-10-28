import type { McpJsonImportDraft } from "@paperclipai/shared";

/*
 * Pasting an MCP config (`/apps/advanced/paste-config`, the old UI's PasteConfigTab): the snippet a
 * README says to copy is read by the server into drafts. A remote server with a web address can be
 * checked and turned on here; a command that runs in a workspace stays a draft until an admin maps it
 * to an approved template.
 */

export const SAMPLE_CONFIG = `{
  "mcpServers": {
    "github": {
      "command": "npx -y @modelcontextprotocol/server-github",
      "env": { "GITHUB_TOKEN": "ghp_..." }
    }
  }
}`;

/** "That doesn't look like valid JSON yet" before anything is sent; null when it parses or is empty. */
export function pasteProblem(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    JSON.parse(trimmed);
    return null;
  } catch {
    return "That doesn't look like valid JSON yet. Paste the whole snippet, including the outer braces.";
  }
}

/** `GITHUB_TOKEN` → "Github token". */
export function humanizeKey(raw: string) {
  const cleaned = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "Key";
}

/** "Connects over the web · needs 1 key". */
export function draftSummary(draft: McpJsonImportDraft) {
  const keys = draft.credentialFields.length || draft.credentialRefs.length;
  const where = draft.transport === "local_stdio" ? "Runs in your workspace" : "Connects over the web";
  return keys === 0 ? `${where} · no keys needed` : `${where} · needs ${keys} ${keys === 1 ? "key" : "keys"}`;
}

/** The address a remote draft connects to; null for commands and anything not http(s). */
export function draftUrl(draft: McpJsonImportDraft): string | null {
  if (draft.transport !== "mcp_remote") return null;
  const raw = draft.config?.url;
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Where a draft's key is kept in the form: drafts can share key names. */
export const credentialKey = (draft: Pick<McpJsonImportDraft, "name">, configPath: string) => `${draft.name}::${configPath}`;

/** The values you typed for one draft's keys, by config path. */
export function credentialValues(draft: McpJsonImportDraft, values: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const field of draft.credentialFields) {
    const value = values[credentialKey(draft, field.configPath)]?.trim();
    if (value) out[field.configPath] = value;
  }
  return out;
}

export function missingKeys(draft: McpJsonImportDraft, values: Record<string, string>) {
  return draft.credentialFields.filter((field) => field.required && !values[credentialKey(draft, field.configPath)]?.trim()).map((field) => field.configPath);
}
