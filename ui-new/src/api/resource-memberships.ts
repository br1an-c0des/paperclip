import type { ResourceMemberships, ResourceMembershipUpdateResult, UpdateResourceMembership } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Your own memberships (ui/src/api/resourceMemberships.ts): whether you've joined or left a project,
 * which decides if it shows in your sidebar, and which projects you've starred. Personal: nobody else
 * is affected.
 */
export const resourceMembershipsApi = {
  mine: (companyId: string, signal?: AbortSignal) =>
    api.get<ResourceMemberships>(`/companies/${encodeURIComponent(companyId)}/resource-memberships/me`, { signal }),
  updateProject: (companyId: string, projectId: string, data: UpdateResourceMembership) =>
    api.put<ResourceMembershipUpdateResult>(
      `/companies/${encodeURIComponent(companyId)}/resource-memberships/me/projects/${encodeURIComponent(projectId)}`,
      data,
    ),
};
