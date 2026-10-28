import type { CompanyInviteRecord, CompanyJoinRequest, CompanyMember, HumanCompanyRole } from "@/api/access";

/*
 * Members (board 22): people and roles, invite links, and requests to join, as the old
 * CompanyAccess page and Invites tab show them.
 */

export const ROLE_OPTIONS: readonly { value: HumanCompanyRole; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Everything, including billing and removing the organization" },
  { value: "admin", label: "Admin", description: "Settings, members and every agent" },
  { value: "operator", label: "Operator", description: "Tasks, projects and agents" },
  { value: "viewer", label: "Viewer", description: "Can look, but not change anything" },
];

export function roleLabel(role: HumanCompanyRole | null | undefined) {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "No role";
}

const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, operator: 2, viewer: 3 };

/** Who to list: everyone but removed members, by role and then name. */
export function visibleMembers(members: readonly CompanyMember[]) {
  return members
    .filter((member) => member.status !== "archived")
    .sort(
      (a, b) =>
        (ROLE_ORDER[a.membershipRole ?? ""] ?? 9) - (ROLE_ORDER[b.membershipRole ?? ""] ?? 9) ||
        memberName(a).localeCompare(memberName(b)),
    );
}

export function memberName(member: Pick<CompanyMember, "principalId" | "user">) {
  return member.user?.name?.trim() || member.user?.email || `User ${member.principalId.slice(0, 6)}`;
}

function day(value: string | Date, now: Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

/** "Joined Sep 12", plus the status when it isn't active. */
export function memberMeta(member: CompanyMember, now = new Date()) {
  const parts = [`Joined ${day(member.createdAt, now)}`];
  if (member.status === "suspended") parts.push("suspended");
  if (member.status === "pending") parts.push("hasn't accepted yet");
  return parts.join(" · ");
}

export const INVITE_STATE_LABEL: Record<CompanyInviteRecord["state"], string> = {
  active: "Not used yet",
  accepted: "Used",
  expired: "Expired",
  revoked: "Revoked",
};

/** "Invite link · Operator". */
export function inviteTitle(invite: CompanyInviteRecord) {
  if (invite.allowedJoinTypes === "agent") return "Agent invite";
  return `Invite link · ${roleLabel(invite.humanRole ?? "operator")}`;
}

/** "Created by you on Oct 20 · expires Oct 27 · not used yet". */
export function inviteMeta(invite: CompanyInviteRecord, currentUserId: string | null, now = new Date()) {
  const by = invite.invitedByUserId && invite.invitedByUserId === currentUserId ? "you" : (invite.invitedByUser?.name ?? invite.invitedByUser?.email ?? null);
  const parts = [`Created${by ? ` by ${by}` : ""} on ${day(invite.createdAt, now)}`];
  if (invite.state === "active") parts.push(`expires ${day(invite.expiresAt, now)}`);
  parts.push(INVITE_STATE_LABEL[invite.state].toLowerCase());
  return parts.join(" · ");
}

/** Active invites first, then the rest, newest first. */
export function sortInvites(invites: readonly CompanyInviteRecord[]) {
  return [...invites].sort(
    (a, b) => Number(b.state === "active") - Number(a.state === "active") || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** Who asked: the person, or the agent an agent invite brings in. */
export function requesterName(request: CompanyJoinRequest) {
  if (request.requestType === "agent") return request.agentName ?? "An agent";
  return request.requesterUser?.name ?? request.requesterUser?.email ?? request.requestEmailSnapshot ?? "Someone";
}

/** "Asked Oct 21 · from an Operator invite", or the agent's harness for an agent. */
export function requestMeta(request: CompanyJoinRequest, now = new Date()) {
  const parts = [`Asked ${day(request.createdAt, now)}`];
  if (request.requestType === "agent") parts.push(`agent${request.adapterType ? ` on ${request.adapterType}` : ""}`);
  else if (request.requesterUser?.email && request.requesterUser.name) parts.push(request.requesterUser.email);
  return parts.join(" · ");
}

/** The role an approval gives: the invite's, or Operator, the server's default for a human join. */
export function approveRole(request: CompanyJoinRequest): HumanCompanyRole | null {
  if (request.requestType === "agent") return null;
  return request.invite?.humanRole ?? "operator";
}
