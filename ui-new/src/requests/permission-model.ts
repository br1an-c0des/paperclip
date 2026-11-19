import { permissionRequestPayloadSchema, type Approval, type PermissionRequestPayload } from "@paperclipai/shared";
import { ACTION_WORDS } from "@/agents/settings/access-model";
import type { Tone } from "./request-model";

/*
 * A permission request (step 4a, fork/step-4a-mcp-and-permissions.md section 7): a Paperclip tool
 * call the caller's access level or an override refused, held for the board as an approval of type
 * `permission_request`. Approving replays the call once (`POST /approvals/:id/approve`); "Approve
 * and always allow" sends `{ alwaysAllow: true }`, which also turns the missing action on for the
 * caller (the agent, or the outside connection for a person); Deny rejects it. Requests expire
 * after 7 days: past `expiresAt` the server records the approval as refused without running it, so
 * the card stops offering to approve. Once decided, `payload.result` says what the replay did.
 */

/** The request's payload, or null when it isn't a well-formed permission request. */
export function permissionRequestOf(approval: Pick<Approval, "type" | "payload">): PermissionRequestPayload | null {
  if (approval.type !== "permission_request") return null;
  const parsed = permissionRequestPayloadSchema.safeParse(approval.payload);
  return parsed.success ? parsed.data : null;
}

function words(name: string) {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : name;
}

/** A tool's name in plain words: `paperclip_delete_task` is "Delete task". */
export function toolWords(tool: string) {
  return words(tool.replace(/^paperclip_/, ""));
}

/** The action the caller lacked, in the Access card's words. */
export function missingActionWords(payload: Pick<PermissionRequestPayload, "missingAction">) {
  return ACTION_WORDS[payload.missingAction]?.label ?? payload.missingAction;
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((entry) => ["string", "number", "boolean"].includes(typeof entry))) return value.length ? value.join(", ") : "none";
  return JSON.stringify(value);
}

/** The call's arguments as label and value pairs: `{ issueId: "TES-12" }` is ["Issue id", "TES-12"]. */
export function argumentRows(args: Record<string, unknown>): [string, string][] {
  return Object.entries(args).map(([key, value]) => [words(key), valueText(value)]);
}

/** Whether the caller came in through an outside connection (an OAuth grant). */
export function viaConnection(payload: Pick<PermissionRequestPayload, "caller">) {
  return payload.caller.kind === "oauth_person" || payload.caller.kind === "oauth_agent";
}

/** Whether it's past its expiry, after which approving can't run it. */
export function permissionExpired(payload: Pick<PermissionRequestPayload, "expiresAt">, now: Date) {
  const at = new Date(payload.expiresAt);
  return !Number.isNaN(at.getTime()) && at.getTime() <= now.getTime();
}

/** What the approved replay did, once it's recorded. */
export function permissionResult(payload: Pick<PermissionRequestPayload, "result">): { text: string; tone: Tone } | null {
  const result = payload.result;
  if (!result) return null;
  const detail = result.detail.trim();
  switch (result.status) {
    case "done":
      return { text: detail ? `Ran: ${detail}` : "Ran once", tone: "ok" };
    case "refused":
      if (detail === "expired") return { text: "Not run: the request had expired", tone: "muted" };
      return { text: detail ? `Refused when it ran: ${detail}` : "Refused when it ran", tone: "bad" };
    case "failed":
      return { text: detail ? `Failed: ${detail}` : "Failed when it ran", tone: "bad" };
  }
}
