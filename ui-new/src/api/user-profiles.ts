import type { UserProfileResponse } from "@paperclipai/shared";
import { api } from "./client";

/*
 * A person's profile in a company (ui/src/api/userProfiles.ts): headline numbers, three windows,
 * fourteen days, recent tasks and actions, and what agents spent on their tasks. The server matches
 * the slug against each member's name, email and id (src/profile/).
 */
export const userProfilesApi = {
  get: (companyId: string, slug: string, signal?: AbortSignal) =>
    api.get<UserProfileResponse>(`/companies/${companyId}/users/${encodeURIComponent(slug)}/profile`, { signal }),
};
