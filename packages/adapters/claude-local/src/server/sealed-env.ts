import type { ClaudeCredentialMethod, ClaudeRunCredential } from "@paperclipai/shared";

/**
 * The sealed environment of a local `claude_local` CLI run (fork/step-4b-sealed-runs.md,
 * sections 6 and 7): what the run may take from the server's environment, and the one Claude
 * credential Paperclip gives it.
 */

/** A run that would start without a Claude credential from Paperclip. */
export const CLAUDE_CREDENTIAL_MISSING = "claude_credential_missing";
/** A run that would start without the `paperclip` MCP server or a run token. */
export const PAPERCLIP_MCP_UNAVAILABLE = "paperclip_mcp_unavailable";

/**
 * Host values a sealed run inherits: ACP's `ACPX_INHERITED_HOST_ENV_KEYS`
 * (`acpx-engine/execute.ts`) without `HOME`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH` and the
 * `XDG_*` folders, which Paperclip sets itself; plus `LC_*` by pattern. No credential and no
 * Claude setting is on it: those come from Paperclip only.
 */
export const SEALED_HOST_ENV_KEYS: ReadonlySet<string> = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "USER",
  "USERNAME",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
]);

const LOCALE_KEY = /^LC_[A-Z0-9_]{1,32}$/;

/** The server environment projected onto `SEALED_HOST_ENV_KEYS` (keys matched case-insensitively). */
export function projectSealedHostEnvironment(hostEnv: NodeJS.ProcessEnv): Record<string, string> {
  const projected: Record<string, string> = {};
  for (const [key, value] of Object.entries(hostEnv)) {
    if (typeof value !== "string") continue;
    const normalized = key.toUpperCase();
    if (SEALED_HOST_ENV_KEYS.has(normalized) || LOCALE_KEY.test(normalized)) projected[key] = value;
  }
  return projected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function enabledFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/**
 * The run's Claude credential, first match wins: a managed AI connection (`routed` when it
 * carries routing), else the agent's own env (non-empty values only), else `null`, which the
 * launch turns into `CLAUDE_CREDENTIAL_MISSING`. The server's own environment never counts.
 */
export function resolveClaudeRunCredential(input: {
  /** The run's env built from `config.env`, secrets resolved. */
  env: Record<string, string>;
  /** `config.managedAiConnection` */
  managedAiConnection: unknown;
  /** `config.managedAiRouting` */
  managedAiRouting: unknown;
  /** `context.paperclipAiConnectionName` */
  connectionName: string | null;
}): ClaudeRunCredential | null {
  if (input.managedAiConnection) {
    const connection = isRecord(input.managedAiConnection) ? input.managedAiConnection : {};
    const method: ClaudeCredentialMethod = input.managedAiRouting
      ? "routed"
      : connection.method === "api_key"
        ? "api_key"
        : "subscription";
    return {
      kind: "managed_connection",
      method,
      connectionId: typeof connection.connectionId === "string" && connection.connectionId ? connection.connectionId : null,
      connectionName: input.connectionName ?? null,
    };
  }

  const env = input.env;
  let method: ClaudeCredentialMethod | null = null;
  if (nonEmpty(env.CLAUDE_CODE_OAUTH_TOKEN)) method = "subscription";
  else if (nonEmpty(env.ANTHROPIC_API_KEY)) method = "api_key";
  else if (nonEmpty(env.ANTHROPIC_AUTH_TOKEN)) method = "auth_token";
  else if (enabledFlag(env.CLAUDE_CODE_USE_BEDROCK)) method = "bedrock";
  else if (enabledFlag(env.CLAUDE_CODE_USE_VERTEX)) method = "vertex";
  else if (enabledFlag(env.CLAUDE_CODE_USE_FOUNDRY)) method = "foundry";
  if (!method) return null;
  return { kind: "agent_env", method, connectionId: null, connectionName: null };
}
