import type { ConnectionAudienceMember, ConnectionGrant, ConnectionGrantStatus, ToolConnectionCredentialPolicy } from "@paperclipai/shared";
import type { ConnectionState } from "../apps-model";

/*
 * Who a connection acts as (src/apps/identities/), in the old UI's words
 * (ui/src/pages/apps/connection-identity.ts): its type, each identity's status, an organization
 * identity's audience (no members means everyone in the organization), and the agents that may act
 * as a person (delegations). Grants, subjects and "empty audiences" never reach the page.
 */

export type ConnectionTypeLabel = "Personal" | "Dedicated agent" | "Organization";

export function connectionTypeLabel(policy: ToolConnectionCredentialPolicy): ConnectionTypeLabel {
  return policy === "per_user" ? "Personal" : policy === "per_agent" ? "Dedicated agent" : "Organization";
}

export function connectionTypeText(policy: ToolConnectionCredentialPolicy) {
  switch (policy) {
    case "per_user":
      return "Each person connects their own account. Agents act as the person whose work it is.";
    case "per_user_with_fallback":
      return "People may connect their own account; work for anyone else uses the organization's.";
    case "per_agent":
      return "One agent's own account, used for everyone's work with that agent.";
    default:
      return "One shared account for the organization.";
  }
}

/** A grant's status as a state tag: missing reads "Not connected", never connected. */
export function grantState(status: ConnectionGrantStatus | null): ConnectionState {
  switch (status) {
    case "active":
      return { kind: "connected", label: "Connected", tone: "green", message: null };
    case "needs_reauthorization":
      return { kind: "attention", label: "Needs attention", tone: "amber", message: "Sign in again to restore it." };
    case "expired":
      return { kind: "attention", label: "Expired", tone: "amber", message: "Sign in again to restore it." };
    case "revoked":
      return { kind: "paused", label: "Revoked", tone: null, message: null };
    default:
      return { kind: "draft", label: "Not connected", tone: null, message: null };
  }
}

/** The provider's name for the account, or a neutral phrase (never a secret's name). */
export function grantAccountLabel(grant: Pick<ConnectionGrant, "kind" | "providerTenant"> | null, subjectLabel?: string | null) {
  const tenant = grant?.providerTenant?.name?.trim();
  if (tenant) return tenant;
  if (grant?.kind === "user") return subjectLabel?.trim() || "Connected account";
  if (grant?.kind === "agent") return subjectLabel?.trim() || "Dedicated account";
  return "Shared credential";
}

export function audienceSummary(grant: Pick<ConnectionGrant, "members"> | null) {
  const count = grant?.members?.length ?? 0;
  return count === 0 ? "Everyone in the organization" : `${count} chosen ${count === 1 ? "person" : "people"}`;
}

export function audienceUserIds(grant: Pick<ConnectionGrant, "members"> | null): Set<string> {
  return new Set((grant?.members ?? []).filter((member) => member.subjectType === "user").map((member) => member.subjectId));
}

/** The organization identity the server reaches for: the default one first. */
export function organizationGrant(grants: readonly ConnectionGrant[]): ConnectionGrant | null {
  return grants.find((grant) => grant.kind === "organization" && grant.isDefault) ?? grants.find((grant) => grant.kind === "organization") ?? null;
}

export function personalGrantFor(grants: readonly ConnectionGrant[], userId: string | null): ConnectionGrant | null {
  if (!userId) return null;
  return grants.find((grant) => grant.kind === "user" && grant.subjectUserId === userId) ?? null;
}

export function otherPersonalGrants(grants: readonly ConnectionGrant[], userId: string | null): ConnectionGrant[] {
  return grants.filter((grant) => grant.kind === "user" && grant.subjectUserId !== userId);
}

export function agentGrants(grants: readonly ConnectionGrant[]): ConnectionGrant[] {
  return grants.filter((grant) => grant.kind === "agent");
}

export function memberLabel(members: readonly ConnectionAudienceMember[], userId: string | null | undefined) {
  if (!userId) return null;
  const match = members.find((member) => member.userId === userId);
  return match ? match.name?.trim() || match.email?.trim() || null : null;
}

/** Whether the policy uses people's own identities (so "Connect as me" and delegations apply). */
export function usesPersonalIdentities(policy: ToolConnectionCredentialPolicy) {
  return policy === "per_user" || policy === "per_user_with_fallback";
}

/** Whether there's an organization identity whose audience matters. */
export function usesOrganizationIdentity(policy: ToolConnectionCredentialPolicy) {
  return policy === "shared" || policy === "per_user_with_fallback";
}

/** The agents a person's identity is delegated to, and which others could be added. */
export function delegationAgents<A extends { id: string }>(grant: Pick<ConnectionGrant, "delegations"> | null, agents: readonly A[]) {
  const delegated = new Set((grant?.delegations ?? []).map((delegation) => delegation.agentId));
  return { delegated: agents.filter((agent) => delegated.has(agent.id)), available: agents.filter((agent) => !delegated.has(agent.id)) };
}

/** An audience change to save, or null when nothing changed: `[]` is everyone. */
export function audienceChange(grant: Pick<ConnectionGrant, "members">, scope: "all" | "selected", selected: ReadonlySet<string>): string[] | null {
  const current = audienceUserIds(grant);
  const next = scope === "all" ? new Set<string>() : new Set(selected);
  if (scope === "selected" && next.size === 0) return null;
  if (current.size === next.size && [...current].every((id) => next.has(id))) return null;
  return [...next].sort();
}
