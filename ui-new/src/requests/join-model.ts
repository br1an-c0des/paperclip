import type { CompanyJoinRequest } from "@/api/access";
import { harnessLabel } from "@/agents/agent-model";
import type { Request, RequestContext } from "./request-model";

/*
 * Join requests as requests: a person or an outside agent asking to join the company through an
 * invite (the outside-agent invite flow, decision 39 D2). Approving a person makes them a member with
 * the invite's role; approving an agent creates it, reporting to the CEO, and it can then claim its
 * API key. The card shows who's asking, what they say they can do, and for agents the adapter type
 * and the address Paperclip will reach them at. Credentials in the request (gateway tokens, API keys)
 * are never shown, only that there are some.
 */

export function adapterLabel(type: string | null | undefined) {
  return type ? harnessLabel(type) : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Where Paperclip will reach the agent: its gateway or webhook address. */
export function joinReach(payload: Record<string, unknown> | null | undefined): string | null {
  return text(payload?.url) ?? text(payload?.apiBaseUrl) ?? text(payload?.webhookUrl) ?? null;
}

/** Whether the request carries credentials for Paperclip to call the agent with. */
export function joinCarriesSecrets(payload: Record<string, unknown> | null | undefined) {
  if (!payload) return false;
  // A key may already be stored as a company secret, so it arrives as a reference, not text.
  const present = (value: unknown) => value !== null && value !== undefined && value !== "";
  const headers = payload.headers;
  return present(payload.apiKey) || present(payload.authToken) || present(payload.devicePrivateKeyPem) || (!!headers && typeof headers === "object" && Object.keys(headers).length > 0);
}

/** Who's asking: the agent's name, or the person's name and email. */
export function joinAsker(join: CompanyJoinRequest) {
  if (join.requestType === "agent") return join.agentName?.trim() || "An outside agent";
  return join.requesterUser?.name?.trim() || join.requesterUser?.email || join.requestEmailSnapshot || "Someone";
}

export function requestFromJoin(join: CompanyJoinRequest, ctx: RequestContext): Request {
  const agent = join.requestType === "agent";
  const name = joinAsker(join);
  const open = join.status === "pending_approval";
  const role = join.invite?.humanRole;
  const decidedAt = join.approvedAt ?? join.rejectedAt ?? join.updatedAt;
  const decider = join.approvedByUserId ?? join.rejectedByUserId;
  const by = decider ? (decider === ctx.youId ? "You" : ctx.personName(decider)) : "Someone";
  return {
    key: `join:${join.id}`,
    source: { type: "join", join },
    kind: "approval",
    shape: "join",
    outcome: "apply",
    audience: { kind: "people_only", label: "People who approve joins" },
    subject: { kind: "company", label: agent ? "New agent" : "New member" },
    formal: false,
    acts: false,
    asker: { agentId: null, userId: agent ? null : join.requestingUserId, name },
    askVerb: agent ? "asks to join as an agent" : "asks to join",
    title: agent ? `Let ${name} join as an agent?` : `Let ${name} join${role ? ` as ${/^[aeiou]/.test(role) ? "an" : "a"} ${role}` : ""}?`,
    body: join.invite?.inviteMessage?.trim() || null,
    next: agent
      ? `Approving creates ${name}, reporting to the CEO. It can then claim its API key and be assigned work.`
      : `Approving makes ${name} a member${role ? ` with the invite's ${role} role` : ""}.`,
    lifetime: "Open until answered",
    lifetimeSoon: false,
    state: open ? "open" : "settled",
    respond: open ? { allowed: true, reason: null } : { allowed: false, reason: null },
    verdict: open
      ? null
      : join.status === "approved"
        ? { text: `${by} approved`, tone: "ok", at: decidedAt ? new Date(decidedAt) : null }
        : { text: `${by} rejected`, tone: "muted", at: decidedAt ? new Date(decidedAt) : null },
    result: null,
    createdAt: new Date(join.createdAt),
  };
}
