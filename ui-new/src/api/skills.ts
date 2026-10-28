import type {
  CompanySkill,
  CompanySkillCreateRequest,
  CompanySkillDetail,
  CompanySkillFileDeleteResult,
  CompanySkillFileDetail,
  CompanySkillListItem,
  CompanySkillVersion,
  SkillSource,
  SkillSourceCreateRequest,
  SkillSourceDisconnectRequest,
  SkillSourceDisconnectResult,
  SkillSourceDiscovery,
  SkillSourceDiscoveryRequest,
  SkillSourceRefreshResult,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * The company's skill library (src/skills/), as ui/src/api/companySkills.ts and skillSources.ts
 * call it. The library list, a skill's detail (with the agents that use it and its current
 * version), its versions and files, creating and editing authored skills, and the skill sources
 * (Git repositories the library imports from: scan, import, sync, remove).
 *
 * Saving a file makes a new version on the server when the file changed; "Save version" names the
 * current files as a version of their own. Turning a skill on for an agent is the agent page's
 * (`agentsApi.syncSkills`).
 *
 * Left out for now: the catalog (`/skills/catalog`, `install-catalog`), importing from a path or URL
 * (`/skills/import`), scanning projects (`scan-projects`, `browse-project`), forks, stars,
 * comments, folders, editing a skill's metadata, update checks and installs, a source's settings
 * and selection, and the Studio's test runs.
 */

const skills = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/skills`;
const skill = (companyId: string, skillId: string) => `${skills(companyId)}/${encodeURIComponent(skillId)}`;
const sources = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/skill-sources`;

export const skillsApi = {
  list: (companyId: string, signal?: AbortSignal) => api.get<CompanySkillListItem[]>(`${skills(companyId)}?sort=alphabetical`, { signal }),
  detail: (companyId: string, skillId: string, signal?: AbortSignal) => api.get<CompanySkillDetail>(skill(companyId, skillId), { signal }),
  versions: (companyId: string, skillId: string, signal?: AbortSignal) =>
    api.get<CompanySkillVersion[]>(`${skill(companyId, skillId)}/versions`, { signal }),
  /** Names the skill's current files as a version. */
  createVersion: (companyId: string, skillId: string, label: string | null) =>
    api.post<CompanySkillVersion>(`${skill(companyId, skillId)}/versions`, { label }),
  file: (companyId: string, skillId: string, path: string, signal?: AbortSignal) =>
    api.get<CompanySkillFileDetail>(`${skill(companyId, skillId)}/files?path=${encodeURIComponent(path)}`, { signal }),
  saveFile: (companyId: string, skillId: string, path: string, content: string, format: Pick<CompanySkillFileDetail, "encoding" | "executable"> = {}) =>
    api.patch<CompanySkillFileDetail>(`${skill(companyId, skillId)}/files`, { path, content, ...format }),
  deleteFile: (companyId: string, skillId: string, path: string) =>
    api.delete<CompanySkillFileDeleteResult>(`${skill(companyId, skillId)}/files`, { path, target: "file" }),
  create: (companyId: string, payload: CompanySkillCreateRequest) => api.post<CompanySkill>(skills(companyId), payload),
  remove: (companyId: string, skillId: string) => api.delete<CompanySkill>(skill(companyId, skillId)),

  sources: (companyId: string, signal?: AbortSignal) => api.get<SkillSource[]>(sources(companyId), { signal }),
  /** Reads a repository and lists the skills in it, without importing anything. */
  discover: (companyId: string, input: SkillSourceDiscoveryRequest) => api.post<SkillSourceDiscovery>(`${sources(companyId)}/discover`, input),
  /** Adds the repository as a source and imports the chosen skills from the scanned commit. */
  addSource: (companyId: string, input: SkillSourceCreateRequest) => api.post<SkillSourceRefreshResult>(sources(companyId), input),
  syncSource: (companyId: string, sourceId: string) => api.post<SkillSourceRefreshResult>(`${sources(companyId)}/${encodeURIComponent(sourceId)}/refresh`, {}),
  /** Removes a source; its skills are kept as copies or deleted. */
  removeSource: (companyId: string, sourceId: string, input: SkillSourceDisconnectRequest) =>
    api.delete<SkillSourceDisconnectResult>(`${sources(companyId)}/${encodeURIComponent(sourceId)}`, input),
};
