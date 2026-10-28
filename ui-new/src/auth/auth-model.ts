import { checkOAuthEndpointUrl, oauthEndpointUrlRejectionMessage } from "@paperclipai/shared";
import type { InviteSummary } from "@/api/invites";
import type { HealthStatus } from "@/api/health";
import { ApiError } from "@/api/client";
import { authErrorCode } from "@/api/auth";

/*
 * Pure logic for the pages outside a company (sign-in, invites, claims, CLI and MCP approval, chat
 * identity, the Cloud sign-in handoff), after the old UI's pages and helpers (ui/src/pages/Auth.tsx,
 * InviteLanding.tsx, CliAuth.tsx, McpConnect.tsx, lib/invite-memory.ts, lib/cloudLinks.ts,
 * lib/oauthHandoff.ts).
 */

// ---------------------------------------------------------------------------------------------
// Where sign-in goes back to

/** Keeps a `?next=` inside this app and off the sign-in page itself (`tenantSignInReturnPath`). */
export function authReturnPath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\x00-\x20]/.test(path)) return "/";
  const url = new URL(path, "https://tenant.invalid");
  if (url.pathname.replace(/\/+$/, "") === "/auth") return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/auth?next=…` for a page that needs a signed-in person first. */
export function signInHref(returnTo: string) {
  return `/auth?next=${encodeURIComponent(returnTo)}`;
}

// The invite someone opened before signing in, so sign-in returns them to it. The key is the old
// UI's, so an invite opened in either UI is remembered by both.
const PENDING_INVITE_KEY = "paperclip:pending-invite-token";

export function rememberPendingInvite(token: string) {
  const value = token.trim();
  if (!value) return;
  try {
    localStorage.setItem(PENDING_INVITE_KEY, value);
  } catch {
    // Storage unavailable: the invite link still works when opened again.
  }
}

export function clearPendingInvite(expected?: string) {
  try {
    if (expected && localStorage.getItem(PENDING_INVITE_KEY) !== expected.trim()) return;
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function pendingInvitePath(): string | null {
  try {
    const token = localStorage.getItem(PENDING_INVITE_KEY)?.trim();
    return token ? `/invite/${token}` : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// The sign-in and sign-up form

export type AuthMode = "sign_in" | "sign_up";
export type AuthForm = { name: string; email: string; password: string };
export type AuthFeedback = { tone: "error" | "info"; message: string };

export const MIN_PASSWORD_LENGTH = 8;

/** What's missing before the form can be sent, or null. */
export function authFormProblem(mode: AuthMode, form: AuthForm): string | null {
  if (mode === "sign_up" && !form.name.trim()) return "Enter your name.";
  if (!form.email.trim()) return "Enter your email.";
  if (!form.password) return "Enter a password.";
  if (mode === "sign_up" && form.password.length < MIN_PASSWORD_LENGTH) return `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

/**
 * Turns a failed sign-in or sign-up into words, as the invite page's `mapInviteAuthFeedback`: an
 * existing account is a nudge to sign in instead (`switchTo`), not an error.
 */
export function authFeedback(error: unknown, mode: AuthMode, email: string): AuthFeedback & { switchTo?: AuthMode } {
  const code = authErrorCode(error);
  const status = error instanceof ApiError ? error.status : null;
  const who = email.trim() || "that email";
  if (code === "USER_ALREADY_EXISTS" || code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" || (mode === "sign_up" && status === 422)) {
    return { tone: "info", message: `An account already exists for ${who}. Sign in to continue.`, switchTo: "sign_in" };
  }
  if (code === "INVALID_EMAIL_OR_PASSWORD" || (mode === "sign_in" && status === 401)) {
    return { tone: "error", message: "That email and password don't match an account here. Check both, or create an account if you're new." };
  }
  const message = error instanceof Error && error.message.trim() ? error.message.trim() : "Couldn't sign you in.";
  return { tone: "error", message };
}

// ---------------------------------------------------------------------------------------------
// Paperclip Cloud

export type CloudHealth = {
  managed: true;
  managedBy: "paperclip-cloud";
  stackSlug: string | null;
  stackDisplayName?: string;
  cloudBaseUrl: string | null;
};

/** The health `cloud` block on a Cloud-managed instance; ui-new's `HealthStatus` doesn't declare it. */
export function cloudOf(health: HealthStatus | undefined): CloudHealth | null {
  const cloud = (health as (HealthStatus & { cloud?: CloudHealth }) | undefined)?.cloud;
  return cloud?.managed ? cloud : null;
}

/** A Cloud app address, from the server-supplied base; never a non-web scheme (`cloudAppUrl`). */
export function cloudAppUrl(base: string | null | undefined, path: string): string | null {
  const trimmed = base?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(path, trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Where Cloud renews this instance's session or signs the person in (`cloudStackEntryUrl`). */
export function cloudSignInUrl(cloud: CloudHealth, returnTo: string): string | null {
  const slug = cloud.stackSlug?.trim();
  if (!slug) return null;
  const entry = cloudAppUrl(cloud.cloudBaseUrl, `/v1/stacks/${encodeURIComponent(slug)}/entry-redirect`);
  if (!entry) return null;
  const url = new URL(entry);
  url.searchParams.set("returnTo", authReturnPath(returnTo));
  return url.toString();
}

/** Cloud's own create-an-organization flow: in-app creation is refused on a managed instance. */
export function cloudCreateUrl(cloud: CloudHealth): string | null {
  return cloudAppUrl(cloud.cloudBaseUrl, "/stacks/new");
}

const CLOUD_ATTEMPT_KEY = "paperclip.cloud-sign-in-attempt";
const CLOUD_ATTEMPT_WINDOW_MS = 5 * 60_000;

/** One automatic trip to Cloud per tab every five minutes, so a failing handoff can't loop. */
export function claimCloudSignInAttempt(storage: Pick<Storage, "getItem" | "setItem"> = sessionStorage, now = Date.now()): boolean {
  try {
    const previous = Number(storage.getItem(CLOUD_ATTEMPT_KEY));
    if (previous > now - CLOUD_ATTEMPT_WINDOW_MS) return false;
    storage.setItem(CLOUD_ATTEMPT_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

export function clearCloudSignInAttempt() {
  try {
    sessionStorage.removeItem(CLOUD_ATTEMPT_KEY);
  } catch {
    // Nothing to clear.
  }
}

// The handoff an Apps sign-in saved before Cloud refreshed the login (`/oauth-handoff`). Same key as
// the old UI's lib/oauthHandoff.ts.
const HANDOFF_KEY = "paperclip.cloud-oauth-handoff.v1";
const HANDOFF_TTL_MS = 15 * 60_000;

function validSession(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function readPendingHandoff(storage: Pick<Storage, "getItem" | "removeItem"> = sessionStorage, now = Date.now()): string | null {
  try {
    const raw = storage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as { version?: unknown; session?: unknown; savedAt?: unknown };
    if (pending.version !== 1 || typeof pending.savedAt !== "number" || now - pending.savedAt > HANDOFF_TTL_MS || !validSession(pending.session)) {
      storage.removeItem(HANDOFF_KEY);
      return null;
    }
    return pending.session;
  } catch {
    try {
      storage.removeItem(HANDOFF_KEY);
    } catch {
      // Storage unavailable.
    }
    return null;
  }
}

export function clearPendingHandoff(storage: Pick<Storage, "removeItem"> = sessionStorage) {
  try {
    storage.removeItem(HANDOFF_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Vets a provider sign-in address before it becomes a top-level navigation (`resolveAuthorizationTarget`). */
export function authorizationTarget(value: string | null | undefined, origin = location.origin): { ok: true; url: string } | { ok: false; message: string } {
  const check = checkOAuthEndpointUrl(value ?? null, {
    allowInsecureLoopback: origin.startsWith("http:"),
    allowInsecureOrigins: [origin],
  });
  return check.ok ? { ok: true, url: check.url } : { ok: false, message: oauthEndpointUrlRejectionMessage("authorization", check.reason) };
}

/**
 * Trades the saved handoff for the provider's sign-in address (`POST /cloud/connections/handoff`, a
 * Cloud harness route outside `/api`), retrying once on a server error, as `prepareOAuthNavigation`.
 */
export async function resumeCloudHandoff(session: string, request: typeof fetch = fetch): Promise<string> {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await request("/cloud/connections/handoff", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        credentials: "include",
        body: JSON.stringify({ session }),
      });
      if (response.status < 500) break;
    } catch {
      response = undefined;
    }
  }
  if (!response) throw new Error("Paperclip Cloud couldn't prepare secure sign-in. Try again.");
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    if (body?.error === "RECENT_LOGIN_REQUIRED") throw new Error("Paperclip couldn't refresh this sign-in. Try again to continue.");
    if (response.status === 404 || body?.error === "SESSION_NOT_AVAILABLE") throw new Error("This sign-in expired. Start the connection again.");
    if (response.status === 401 || response.status === 403) throw new Error("Paperclip Cloud couldn't authorize this connection for your account.");
    throw new Error("Paperclip Cloud couldn't prepare secure sign-in. Try again.");
  }
  const target = authorizationTarget(typeof body?.authorizationUrl === "string" ? body.authorizationUrl : undefined);
  if (!target.ok) throw new Error("Paperclip Cloud returned an invalid provider sign-in address.");
  return target.url;
}

// ---------------------------------------------------------------------------------------------
// CLI auth

/** How long to wait after a 429 on the challenge: the server's `retryAfterSeconds`, else a minute. */
export function cliRetryDelay(error: unknown): number {
  const body = error instanceof ApiError && error.body && typeof error.body === "object" ? (error.body as { details?: unknown }) : null;
  const details = body?.details && typeof body.details === "object" ? (body.details as { retryAfterSeconds?: unknown }) : null;
  const ms = typeof details?.retryAfterSeconds === "number" ? details.retryAfterSeconds * 1000 : Number.NaN;
  return Number.isFinite(ms) && ms > 0 ? Math.max(1000, ms) : 60_000;
}

export function isRateLimited(error: unknown) {
  return error instanceof ApiError && error.status === 429;
}

// ---------------------------------------------------------------------------------------------
// MCP connect

export type McpProblem =
  /** The routes aren't there: no public URL configured. */
  | { kind: "unconfigured"; message: string }
  /** `enablePublicMcp` (or the Dot or Grok setting a pairing needs) is off. */
  | { kind: "disabled"; message: string }
  | { kind: "error"; message: string };

const MCP_OFF =
  "Assistant connections are turned off on this Paperclip. An instance admin can turn on the experimental setting for public MCP (enablePublicMcp), then start the connection again from your assistant.";
const MCP_UNCONFIGURED =
  "This Paperclip doesn't offer assistant connections. They need a public HTTPS address (PAPERCLIP_PUBLIC_URL; plain HTTP works only on localhost) and the experimental setting for public MCP (enablePublicMcp) turned on.";

/** Reads the OAuth-style errors the MCP routes answer with, telling "turned off" apart from the rest. */
export function mcpProblem(error: unknown): McpProblem {
  if (error instanceof ApiError) {
    const body = (error.body && typeof error.body === "object" ? error.body : {}) as { error?: unknown; error_description?: unknown };
    if (error.status === 404 && body.error === "API route not found") return { kind: "unconfigured", message: MCP_UNCONFIGURED };
    if (error.status === 503 && body.error === "temporarily_unavailable") return { kind: "disabled", message: MCP_OFF };
    if (typeof body.error_description === "string" && body.error_description) return { kind: "error", message: body.error_description };
  }
  return { kind: "error", message: error instanceof Error && error.message ? error.message : "Couldn't load the connection request." };
}

/** "Claude Code", or "your assistant" for a generic client name. */
export function assistantName(clientName: string | null | undefined) {
  const name = clientName?.trim();
  return name && !/^(assistant|mcp client)$/i.test(name) ? name : "your assistant";
}

/** "Sam's Claude connection": whose assistant it is (`assistantConnectionDisplayName`). */
export function connectionTitle(connection: { clientName: string; user?: { name: string } | null }) {
  const client = connection.clientName.trim();
  if (!connection.user) return `${client} connection`;
  const label = connection.user.name.trim();
  let first = (label.split(/\s+/)[0] ?? label) || "Board";
  if (first.includes("@")) first = first.split("@")[0] || "Board";
  const owner = first.toLowerCase().endsWith("s") ? `${first}’` : `${first}’s`;
  return `${owner} ${client} connection`;
}

/** What a connection may do, from its scopes. */
export function connectionAccess(scopes: readonly string[]) {
  if (scopes.includes("paperclip:agent")) return "Agent connection";
  const base = scopes.includes("paperclip:write") ? "Read and edit work" : "Read only";
  return scopes.includes("paperclip:configure") ? `${base}; configure agents, projects and skills` : base;
}

export const DOT_PAIRING_CODE = /^[A-Za-z0-9_-]{32}$/;

// ---------------------------------------------------------------------------------------------
// Invites

export type InviteView =
  | { kind: "checking" }
  | { kind: "member" }
  | { kind: "awaiting_approval" }
  | { kind: "unavailable"; reason: string }
  | { kind: "agent_form" }
  | { kind: "account" }
  | { kind: "accept"; auto: boolean };

/**
 * Which state the invite page is in, after InviteLanding's checks:
 *
 * - `checking` while a signed-in person's company list is still loading, so a pending list doesn't
 *   read as "not a member" and accept an invite they already hold;
 * - `member` when they already belong to the company;
 * - `awaiting_approval` or `unavailable` for a join request that's pending, rejected or used;
 * - `agent_form` for an invite only agents can take;
 * - `account` when an authenticated instance needs them to sign up or sign in first;
 * - `accept`, automatic for a signed-in person's invite (bootstrap invites are always a click).
 */
export function inviteView(input: {
  invite: InviteSummary;
  authenticated: boolean;
  signedIn: boolean;
  companyIds: readonly string[] | undefined;
}): InviteView {
  const { invite } = input;
  const status = invite.joinRequestStatus ?? null;
  const completable = invite.joinRequestType === "human" && (status === "pending_approval" || status === "approved");
  const agentOnly = invite.inviteType !== "bootstrap_ceo" && invite.allowedJoinTypes === "agent";
  if (input.signedIn && invite.companyId && !input.companyIds && !agentOnly) return { kind: "checking" };
  // An agent's invite is about the agent, so the person's own membership doesn't matter.
  const member = !agentOnly && !!invite.companyId && !!input.companyIds?.includes(invite.companyId);
  if (member) return { kind: "member" };
  if (status === "pending_approval" && !completable) return { kind: "awaiting_approval" };
  if (status && !completable) {
    return { kind: "unavailable", reason: status === "rejected" ? "This join request wasn't approved." : "This invite has already been used." };
  }
  if (agentOnly) return { kind: "agent_form" };
  if (input.authenticated && !input.signedIn) return { kind: "account" };
  return { kind: "accept", auto: input.signedIn && invite.inviteType !== "bootstrap_ceo" };
}

/** "Owner", "Operator"… for the role an invite grants. */
export function roleName(role: string | null | undefined) {
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : null;
}

export function isBootstrapAccepted(payload: unknown): payload is { bootstrapAccepted: true } {
  return !!payload && typeof payload === "object" && "bootstrapAccepted" in payload;
}

/** A string deep inside an accept result, such as the agent's onboarding text URL. */
export function nestedString(value: unknown, path: readonly string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current : null;
}

/** Harnesses an agent invite can name; the rest are listed as coming soon, as the old page does. */
export const INVITE_HARNESSES = new Set(["claude_local", "codex_local", "gemini_local", "kimi_local", "opencode_local", "pi_local", "cursor"]);

// ---------------------------------------------------------------------------------------------
// Chat identity

export const CHAT_PROVIDER_NAMES: Record<string, string> = {
  speko: "Speko",
  slack: "Slack",
  github: "GitHub",
  discord: "Discord",
  "microsoft-teams": "Microsoft Teams",
  telegram: "Telegram",
  agentmail: "AgentMail",
  "imessage-photon": "iMessage Photon",
};
