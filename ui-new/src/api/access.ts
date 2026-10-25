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

export const accessApi = {
  currentBoardAccess: () => api.get<CurrentBoardAccess>("/cli-auth/me"),
};
