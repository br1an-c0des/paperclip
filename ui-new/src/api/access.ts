import type { HumanCompanyMembershipRole, JoinRequest, PermissionKey } from "@paperclipai/shared";
import { api } from "./client";

/*
 * `GET /api/cli-auth/me`: which companies the signed-in board user can enter. The response type
 * lives in the old UI (ui/src/api/access.ts), not in @paperclipai/shared, so the fields ui-new reads
 * are declared here.
 */
export type CurrentBoardAccess = {
  user: { id: string; email: string | null; name: string | null; image: string | null } | null;
  userId: string;
  isInstanceAdmin: boolean;
  companyIds: string[];
  source: string;
};

type PersonRef = { id: string; email: string | null; name: string | null; image: string | null };

/** The company's people (`GET /companies/:id/user-directory`), for assignee and reviewer menus. */
export type CompanyUserDirectoryEntry = {
  principalId: string;
  status: "active";
  user: PersonRef | null;
};

/*
 * Members, invites and join requests, for company settings → Members (ui/src/api/access.ts,
 * pages/CompanyAccess.tsx, components/access/InvitesSection.tsx). These types also live in the old
 * UI only.
 */
export type HumanCompanyRole = HumanCompanyMembershipRole;
export type MemberStatus = "pending" | "active" | "suspended" | "archived";

export type CompanyMember = {
  id: string;
  companyId: string;
  principalType: "user";
  principalId: string;
  status: MemberStatus;
  membershipRole: HumanCompanyRole | null;
  createdAt: string;
  updatedAt: string;
  user: PersonRef | null;
  grants: { id: string; permissionKey: PermissionKey; scope: Record<string, unknown> | null }[];
  removal?: { canArchive: boolean; reason: string | null };
};

export type CompanyMembersResponse = {
  members: CompanyMember[];
  access: {
    currentUserRole: HumanCompanyRole | null;
    canManageMembers: boolean;
    canInviteUsers: boolean;
    canApproveJoinRequests: boolean;
  };
};

export type InviteState = "active" | "revoked" | "accepted" | "expired";

export type CompanyInviteRecord = {
  id: string;
  inviteType: "company_join" | "bootstrap_ceo";
  allowedJoinTypes: "human" | "agent" | "both";
  humanRole: HumanCompanyRole | null;
  expiresAt: string;
  invitedByUserId: string | null;
  revokedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  state: InviteState;
  invitedByUser: PersonRef | null;
};

/** A new invite. Its link is only ever returned here: the list doesn't carry tokens. */
export type CompanyInviteCreated = {
  id: string;
  token: string;
  inviteUrl: string;
  expiresAt: string;
  allowedJoinTypes: "human" | "agent" | "both";
  humanRole?: HumanCompanyRole | null;
};

export type CompanyJoinRequest = JoinRequest & {
  requesterUser: PersonRef | null;
  invite: { id: string; humanRole: HumanCompanyRole | null; inviteMessage: string | null } | null;
};

const company = (companyId: string) => `/companies/${encodeURIComponent(companyId)}`;

export const accessApi = {
  currentBoardAccess: () => api.get<CurrentBoardAccess>("/cli-auth/me"),
  userDirectory: (companyId: string) =>
    api.get<{ users: CompanyUserDirectoryEntry[] }>(`/companies/${companyId}/user-directory`),

  members: (companyId: string, signal?: AbortSignal) => api.get<CompanyMembersResponse>(`${company(companyId)}/members`, { signal }),
  updateMember: (companyId: string, memberId: string, input: { membershipRole?: HumanCompanyRole | null; status?: "pending" | "active" | "suspended" }) =>
    api.patch<CompanyMember>(`${company(companyId)}/members/${encodeURIComponent(memberId)}`, input),
  /** Removes a member; their open tasks are unassigned, or handed to the reassignment target. */
  archiveMember: (
    companyId: string,
    memberId: string,
    reassignment: { assigneeAgentId?: string | null; assigneeUserId?: string | null } | null,
  ) =>
    api.post<{ member: CompanyMember; reassignedIssueCount: number }>(
      `${company(companyId)}/members/${encodeURIComponent(memberId)}/archive`,
      { reassignment },
    ),

  invites: (companyId: string, options: { limit?: number; offset?: number } = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset) params.set("offset", String(options.offset));
    const query = params.toString();
    return api.get<{ invites: CompanyInviteRecord[]; nextOffset: number | null }>(
      `${company(companyId)}/invites${query ? `?${query}` : ""}`,
      { signal },
    );
  },
  /** A link for people to join with `humanRole`, as the old Invites tab makes it. */
  createInvite: (companyId: string, humanRole: HumanCompanyRole) =>
    api.post<CompanyInviteCreated>(`${company(companyId)}/invites`, { allowedJoinTypes: "human", humanRole, agentMessage: null }),
  revokeInvite: (inviteId: string) => api.post<unknown>(`/invites/${encodeURIComponent(inviteId)}/revoke`, {}),

  joinRequests: (companyId: string, signal?: AbortSignal) =>
    api.get<CompanyJoinRequest[]>(`${company(companyId)}/join-requests?status=pending_approval`, { signal }),
  approveJoinRequest: (companyId: string, requestId: string) =>
    api.post<JoinRequest>(`${company(companyId)}/join-requests/${encodeURIComponent(requestId)}/approve`, {}),
  rejectJoinRequest: (companyId: string, requestId: string) =>
    api.post<JoinRequest>(`${company(companyId)}/join-requests/${encodeURIComponent(requestId)}/reject`, {}),
};

/** A person's display name: name, then email, then a short id. */
export function personName(entry: { principalId: string; user: PersonRef | null }) {
  return entry.user?.name?.trim() || entry.user?.email || `User ${entry.principalId.slice(0, 6)}`;
}
