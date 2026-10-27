import type { AttentionFeed, Project, ProjectRepositoryOptions, WorkspaceOverviewResponse } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Projects, as ui/src/api/projects.ts uses them. The list endpoint adds each project's `taskCount`
 * (every task in it, open or closed) and its active `budget`.
 *
 * Creating one takes the fields of `createProjectSchema` (packages/shared/src/validators/project.ts):
 * name, description, status, lead, visibility, target date, color, icon, and the code as GitHub
 * `repositoryIds` or a local folder `workspace`. The GitHub repositories to pick from come from the
 * company's connections (`/project-repositories`).
 *
 * The project dashboard (board 8) also reads the project's task checkouts with their dev servers
 * (`/workspace-overview?projectId=`) and the attention feed the Inbox is built on, which it filters
 * to the project's tasks.
 */

export const projectsApi = {
  list: (companyId: string) => api.get<Project[]>(`/companies/${encodeURIComponent(companyId)}/projects`),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Project>(`/companies/${encodeURIComponent(companyId)}/projects`, data),
  addAccessMember: (projectId: string, member: { subjectType: "user" | "agent"; subjectId: string }) =>
    api.post<unknown>(`/projects/${encodeURIComponent(projectId)}/access-members`, member),
  repositoryOptions: (companyId: string, signal?: AbortSignal) =>
    api.get<ProjectRepositoryOptions>(`/companies/${encodeURIComponent(companyId)}/project-repositories`, { signal }),
  workspaceOverview: (companyId: string, projectId: string, signal?: AbortSignal) =>
    api.get<WorkspaceOverviewResponse>(
      `/companies/${encodeURIComponent(companyId)}/workspace-overview?projectId=${encodeURIComponent(projectId)}`,
      { signal },
    ),
  /** The whole attention feed for the signed-in person (`all=true`), as the Inbox reads it. */
  attention: (companyId: string, signal?: AbortSignal) =>
    api.get<AttentionFeed>(`/companies/${encodeURIComponent(companyId)}/attention?all=true`, { signal }),
};

/** Projects that aren't archived, by name. */
export function openProjects(projects: readonly Project[] | undefined) {
  return (projects ?? [])
    .filter((project) => !project.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** A project by its URL key or id, as project routes and links name it. */
export function findProject(projects: readonly Project[] | undefined, key: string) {
  return projects?.find((project) => project.urlKey === key || project.id === key);
}
