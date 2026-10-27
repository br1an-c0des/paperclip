import type {
  Project,
  ProjectAccessMember,
  ProjectGitAuthorization,
  ProjectRepositoryOptions,
  ProjectWorkspace,
  WorkspaceOperation,
  WorkspaceOverviewResponse,
} from "@paperclipai/shared";
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
 * (`/workspace-overview?projectId=`).
 *
 * Project settings (boards 10 and 11) edit the project with `PATCH /projects/:id` (the fields of
 * `updateProjectSchema`, archiving included), its private-project members, GitHub repositories,
 * workspaces and their runtime services, and the project's background Git authorization: the
 * signed-in person's own GitHub Connector grant, which they explicitly authorize for the project
 * (`GET|PUT /projects/:id/git-authorization`, since the 2026-10-26 sync).
 */

const projectPath = (id: string, suffix = "") => `/projects/${encodeURIComponent(id)}${suffix}`;

export const projectsApi = {
  list: (companyId: string) => api.get<Project[]>(`/companies/${encodeURIComponent(companyId)}/projects`),
  /** One project by id, or by URL key with its company; archived projects too. */
  get: (key: string, companyId?: string, signal?: AbortSignal) =>
    api.get<Project>(`${projectPath(key)}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""}`, { signal }),
  update: (projectId: string, data: Record<string, unknown>) => api.patch<Project>(projectPath(projectId), data),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Project>(`/companies/${encodeURIComponent(companyId)}/projects`, data),
  addAccessMember: (projectId: string, member: { subjectType: "user" | "agent"; subjectId: string }) =>
    api.post<unknown>(`/projects/${encodeURIComponent(projectId)}/access-members`, member),
  listAccessMembers: (projectId: string, signal?: AbortSignal) =>
    api.get<ProjectAccessMember[]>(projectPath(projectId, "/access-members"), { signal }),
  removeAccessMember: (projectId: string, memberId: string) =>
    api.delete<ProjectAccessMember>(projectPath(projectId, `/access-members/${encodeURIComponent(memberId)}`)),
  /** Replaces the project's GitHub repositories; the first is the primary. */
  setRepositories: (projectId: string, repositoryIds: string[]) =>
    api.put<Project>(projectPath(projectId, "/repositories"), { repositoryIds }),
  createWorkspace: (projectId: string, data: Record<string, unknown>) =>
    api.post<ProjectWorkspace>(projectPath(projectId, "/workspaces"), data),
  updateWorkspace: (projectId: string, workspaceId: string, data: Record<string, unknown>) =>
    api.patch<ProjectWorkspace>(projectPath(projectId, `/workspaces/${encodeURIComponent(workspaceId)}`), data),
  removeWorkspace: (projectId: string, workspaceId: string) =>
    api.delete<ProjectWorkspace>(projectPath(projectId, `/workspaces/${encodeURIComponent(workspaceId)}`)),
  /** Start, stop or restart a workspace's runtime services; one service when its id is given. */
  controlRuntimeServices: (projectId: string, workspaceId: string, action: "start" | "stop" | "restart", runtimeServiceId?: string) =>
    api.post<{ workspace: ProjectWorkspace; operation: WorkspaceOperation }>(
      projectPath(projectId, `/workspaces/${encodeURIComponent(workspaceId)}/runtime-services/${action}`),
      { workspaceCommandId: null, runtimeServiceId: runtimeServiceId ?? null, serviceIndex: null },
    ),
  gitAuthorization: (projectId: string, signal?: AbortSignal) =>
    api.get<ProjectGitAuthorization>(projectPath(projectId, "/git-authorization"), { signal }),
  /** Authorizes the project with one of your grants, or revokes it with null. */
  setGitAuthorization: (projectId: string, grantId: string | null) =>
    api.put<ProjectGitAuthorization>(projectPath(projectId, "/git-authorization"), { grantId }),
  repositoryOptions: (companyId: string, signal?: AbortSignal) =>
    api.get<ProjectRepositoryOptions>(`/companies/${encodeURIComponent(companyId)}/project-repositories`, { signal }),
  workspaceOverview: (companyId: string, projectId: string, signal?: AbortSignal) =>
    api.get<WorkspaceOverviewResponse>(
      `/companies/${encodeURIComponent(companyId)}/workspace-overview?projectId=${encodeURIComponent(projectId)}`,
      { signal },
    ),
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
