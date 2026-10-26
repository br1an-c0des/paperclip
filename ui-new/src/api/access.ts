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

/** The company's people (`GET /companies/:id/user-directory`), for assignee and reviewer menus. */
export type CompanyUserDirectoryEntry = {
  principalId: string;
  status: "active";
  user: { id: string; email: string | null; name: string | null; image: string | null } | null;
};

export const accessApi = {
  currentBoardAccess: () => api.get<CurrentBoardAccess>("/cli-auth/me"),
  userDirectory: (companyId: string) =>
    api.get<{ users: CompanyUserDirectoryEntry[] }>(`/companies/${companyId}/user-directory`),
};

/** A person's display name: name, then email, then a short id. */
export function personName(entry: CompanyUserDirectoryEntry) {
  return entry.user?.name?.trim() || entry.user?.email || `User ${entry.principalId.slice(0, 6)}`;
}
