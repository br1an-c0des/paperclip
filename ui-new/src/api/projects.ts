import type { Project } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Projects, as ui/src/api/projects.ts uses them. The list endpoint adds each project's `taskCount`
 * (every task in it, open or closed).
 */

export const projectsApi = {
  list: (companyId: string) => api.get<Project[]>(`/companies/${encodeURIComponent(companyId)}/projects`),
};

/** Projects that aren't archived, by name. */
export function openProjects(projects: readonly Project[] | undefined) {
  return (projects ?? [])
    .filter((project) => !project.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
