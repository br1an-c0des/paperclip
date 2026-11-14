import type { CreateMachineSignIn, MachineSignInMethod, MachineSignInPublicKey, MachineSignInStatus, TestMachineSignIn, ToolConnection } from "@paperclipai/shared";
import { byoLinkProblem, defaultServerName } from "./apps-model";

/*
 * Machine sign-in (upstream #21473, #21566, doc/connections/MCP-CLIENT-CREDENTIALS.md): an
 * organization connection to a remote MCP server that signs in as a client the provider registered
 * for Paperclip (OAuth client credentials), so no person signs in. Paperclip proves who it is with
 * a key it holds (the person registers its public key with the provider) or a client secret.
 *
 * - `POST /companies/:id/tools/machine-sign-in` creates the draft: it finds and pins the sign-in
 *   service, and creates the key or stores the secret.
 * - `GET /tool-connections/:id/machine-sign-in` is its status: method, client ID, pinned service,
 *   scopes, public keys, whether a secret is saved, the last token. Never a secret or private key.
 * - `POST …/test` asks for a token and lists the server's tools with it; success turns it on.
 * - `POST …/rotate` replaces the secret (tested first) or stages a new key; `POST …/rotate/complete`
 *   tests the staged key and switches to it.
 *
 * Only shared (organization) connections can use it; the server refuses personal ones.
 */

export type MachineDraft = {
  method: MachineSignInMethod;
  /** The sign-in service's address or token URL. Blank: Paperclip asks the server. */
  signInService: string;
  clientId: string;
  /** Sent once, with the draft or a test; cleared from the form as soon as the server has it. */
  clientSecret: string;
  scopes: string;
};

export function newMachineDraft(): MachineDraft {
  return { method: "paperclip_key", signInService: "", clientId: "", clientSecret: "", scopes: "" };
}

export const MACHINE_METHODS: { value: MachineSignInMethod; title: string; description: string }[] = [
  {
    value: "paperclip_key",
    title: "Paperclip key (recommended)",
    description: "Paperclip creates a key and keeps its private half. You register the public key with the provider; nothing secret is copied.",
  },
  {
    value: "client_secret",
    title: "Client secret",
    description: "For providers that only issue a secret. Paperclip keeps it in the vault and never shows it again.",
  },
];

/** True for a connection set up with machine sign-in (`config.oauth.grantType`). */
export function usesMachineSignIn(connection: Pick<ToolConnection, "config"> | null | undefined): boolean {
  const oauth = connection?.config?.oauth;
  return Boolean(oauth && typeof oauth === "object" && (oauth as { grantType?: unknown }).grantType === "client_credentials");
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Why the draft can't be created yet, or null. */
export function machineCreateProblem(link: string, draft: MachineDraft): string | null {
  const linkProblem = byoLinkProblem(link);
  if (linkProblem) return linkProblem;
  // A key in the server address is refused by the server, which says so.
  const service = draft.signInService.trim();
  if (service && !isHttpUrl(service)) return "Enter the sign-in service's full address, starting with https://.";
  if (draft.method === "client_secret") {
    if (!draft.clientId.trim()) return "Add the client ID.";
    if (!draft.clientSecret) return "Add the client secret.";
  }
  return null;
}

/** `POST /companies/:id/tools/machine-sign-in`. Blank fields are left out, so the server decides. */
export function machineCreateInput(link: string, name: string, draft: MachineDraft, applicationId?: string | null): CreateMachineSignIn {
  const trimmedName = name.trim() || defaultServerName(link.trim()) || "";
  const scopes = draft.scopes.trim();
  return {
    link: link.trim(),
    ...(trimmedName ? { name: trimmedName.slice(0, 160) } : {}),
    ...(draft.signInService.trim() ? { authorizationServer: draft.signInService.trim() } : {}),
    method: draft.method,
    ...(draft.clientId.trim() ? { clientId: draft.clientId.trim() } : {}),
    ...(draft.method === "client_secret" && draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
    ...(scopes ? { scopes } : {}),
    ...(applicationId ? { applicationId } : {}),
  };
}

/**
 * `POST …/machine-sign-in/test`. Scopes are always sent, so clearing the field clears them; a
 * secret only when one was typed to replace the saved one.
 */
export function machineTestInput(status: Pick<MachineSignInStatus, "method">, clientId: string, scopes: string, replacementSecret = ""): TestMachineSignIn {
  return {
    ...(clientId.trim() ? { clientId: clientId.trim() } : {}),
    scopes: scopes.trim(),
    ...(status.method === "client_secret" && replacementSecret ? { clientSecret: replacementSecret } : {}),
  };
}

/** Why Test can't be pressed yet, or null. */
export function machineTestProblem(clientId: string): string | null {
  return clientId.trim() ? null : "Add the client ID the provider shows for the Paperclip client.";
}

export function machineMethodLabel(status: Pick<MachineSignInStatus, "method" | "publicKey">): string {
  if (status.method === "client_secret") return "Client secret";
  return status.publicKey ? `Paperclip key (${status.publicKey.algorithm})` : "Paperclip key";
}

/** The pinned sign-in service: its issuer when it has one, else the token URL itself. */
export function machineSignInService(status: Pick<MachineSignInStatus, "issuer" | "tokenUrl">): string {
  return status.issuer ?? status.tokenUrl;
}

/** Where a key rotation stands: none, or a new key waiting to be registered with the provider. */
export function rotationStage(status: Pick<MachineSignInStatus, "pendingPublicKey">): "idle" | "pending" {
  return status.pendingPublicKey ? "pending" : "idle";
}

/** A public key as the provider's console takes it: PEM, or the JWK as indented JSON. */
export function publicKeyText(key: MachineSignInPublicKey, format: "pem" | "jwk"): string {
  return format === "pem" ? key.pem.trim() : JSON.stringify(key.jwk, null, 2);
}

/** The scopes field's text from the saved list. */
export function scopesText(scopes: readonly string[]): string {
  return scopes.join(" ");
}
