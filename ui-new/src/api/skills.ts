import type {
  CatalogSkill,
  CatalogSkillFileDetail,
  CompanySkill,
  CompanySkillCreateRequest,
  CompanySkillDetail,
  CompanySkillFileDeleteResult,
  CompanySkillFileDetail,
  CompanySkillForkPrecheckResult,
  CompanySkillForkRequest,
  CompanySkillForkResult,
  CompanySkillImportResult,
  CompanySkillInstallCatalogRequest,
  CompanySkillInstallCatalogResult,
  CompanySkillListItem,
  CompanySkillProjectBrowseRequest,
  CompanySkillProjectBrowseResult,
  CompanySkillProjectScanRequest,
  CompanySkillProjectScanResult,
  CompanySkillStarResult,
  CompanySkillUpdateStatus,
  CompanySkillVersion,
  Folder,
  FolderListResult,
  ProjectRepositoryOptions,
  ProjectSkillRepository,
  SkillSource,
  SkillSourceBranches,
  SkillSourceCreateRequest,
  SkillSourceDisconnectRequest,
  SkillSourceDisconnectResult,
  SkillSourceDiscovery,
  SkillSourceDiscoveryRequest,
  SkillSourceFilePreview,
  SkillSourcePreviewRequest,
  SkillSourceRefreshResult,
  SkillSourceSelectionRequest,
  SkillSourceSettingsRequest,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * The company's skill library (src/skills/), as ui/src/api/companySkills.ts, skillSources.ts and
 * folders.ts call it. The library list, a skill's detail (with the agents that use it and its
 * current version), its versions and files, creating and editing authored skills, and the skill
 * sources (Git repositories the library imports from: scan, import, sync, remove).
 *
 * Saving a file makes a new version on the server when the file changed; "Save version" names the
 * current files as a version of their own. Turning a skill on for an agent is the agent page's
 * (`agentsApi.syncSkills`).
 *
 * Also: Paperclip's skill catalog (`/skills/catalog*`) and installing from it, importing from a path
 * or URL, scanning project workspaces for skills, stars, forks, update checks and installs, the
 * library's folders (kind "skill"), and a source's settings, branches, selection and file previews,
 * plus the project repositories a source can adopt.
 *
 * Left out: comments (unused in the old UI), editing a skill's metadata, and the Studio's test
 * runs, inputs and templates (decision 39, D6).
 */

const skills = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/skills`;
const skill = (companyId: string, skillId: string) => `${skills(companyId)}/${encodeURIComponent(skillId)}`;
const sources = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/skill-sources`;
const source = (companyId: string, sourceId: string) => `${sources(companyId)}/${encodeURIComponent(sourceId)}`;
const folders = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/folders`;

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

  star: (companyId: string, skillId: string) => api.post<CompanySkillStarResult>(`${skill(companyId, skillId)}/star`, {}),
  unstar: (companyId: string, skillId: string) => api.delete<CompanySkillStarResult>(`${skill(companyId, skillId)}/star`),
  /** Who uses the skill and the forks already made, before forking. */
  forkPrecheck: (companyId: string, skillId: string, signal?: AbortSignal) =>
    api.get<CompanySkillForkPrecheckResult>(`${skill(companyId, skillId)}/fork-precheck`, { signal }),
  /** An editable copy in this company; `reassignAgentIds` move those agents onto the copy. */
  fork: (companyId: string, skillId: string, payload: CompanySkillForkRequest) =>
    api.post<CompanySkillForkResult>(`${skill(companyId, skillId)}/fork`, payload),
  /** Whether the skill's origin has a newer version (imported and catalog skills). */
  updateStatus: (companyId: string, skillId: string, signal?: AbortSignal) =>
    api.get<CompanySkillUpdateStatus>(`${skill(companyId, skillId)}/update-status`, { signal }),
  installUpdate: (companyId: string, skillId: string) => api.post<CompanySkill>(`${skill(companyId, skillId)}/install-update`, {}),
  /** Imports from a local path, a GitHub address, a skills.sh link or a URL to a SKILL.md. */
  importFrom: (companyId: string, from: string) => api.post<CompanySkillImportResult>(`${skills(companyId)}/import`, { source: from }),
  /** Scans project workspaces for skill folders: `mode: "preview"` lists them, `"import"` imports the selection. */
  scanProjects: (companyId: string, payload: CompanySkillProjectScanRequest) =>
    api.post<CompanySkillProjectScanResult>(`${skills(companyId)}/scan-projects`, payload),
  /** One folder of a project workspace, to pick a skill folder the scan missed. */
  browseProject: (companyId: string, payload: CompanySkillProjectBrowseRequest, signal?: AbortSignal) =>
    api.post<CompanySkillProjectBrowseResult>(`${skills(companyId)}/browse-project`, payload, { signal }),

  /** Paperclip's catalog: bundled skills and optional ones, the same for every company. */
  catalog: (signal?: AbortSignal) => api.get<CatalogSkill[]>("/skills/catalog", { signal }),
  catalogFile: (catalogId: string, path: string, signal?: AbortSignal) =>
    api.get<CatalogSkillFileDetail>(`/skills/catalog/${encodeURIComponent(catalogId)}/files?path=${encodeURIComponent(path)}`, { signal }),
  installCatalog: (companyId: string, payload: CompanySkillInstallCatalogRequest) =>
    api.post<CompanySkillInstallCatalogResult>(`${skills(companyId)}/install-catalog`, payload),

  folders: (companyId: string, signal?: AbortSignal) => api.get<FolderListResult>(`${folders(companyId)}?kind=skill`, { signal }),
  createFolder: (companyId: string, name: string, parentId: string | null) =>
    api.post<Folder>(folders(companyId), { kind: "skill", name, parentId, color: null }),
  renameFolder: (companyId: string, folderId: string, name: string) => api.patch<Folder>(`${folders(companyId)}/${encodeURIComponent(folderId)}`, { name }),
  /** Removes a folder; the server moves its skills out of it. */
  deleteFolder: (companyId: string, folderId: string) => api.delete<{ deleted: Folder }>(`${folders(companyId)}/${encodeURIComponent(folderId)}`),
  /** Your own folder ("My skills"), made the first time it's asked for. */
  ensureMyFolder: (companyId: string) => api.post<Folder>(`${folders(companyId)}/ensure-my`, {}),
  /** Files a skill in a folder, or out of every folder with `null`. */
  moveToFolder: (companyId: string, skillId: string, folderId: string | null) =>
    api.post<unknown>(`${folders(companyId)}/items/move`, { kind: "skill", itemId: skillId, folderId }),

  sources: (companyId: string, signal?: AbortSignal) => api.get<SkillSource[]>(sources(companyId), { signal }),
  /** Reads a repository and lists the skills in it, without importing anything. */
  discover: (companyId: string, input: SkillSourceDiscoveryRequest) => api.post<SkillSourceDiscovery>(`${sources(companyId)}/discover`, input),
  /** Adds the repository as a source and imports the chosen skills from the scanned commit. */
  addSource: (companyId: string, input: SkillSourceCreateRequest) => api.post<SkillSourceRefreshResult>(sources(companyId), input),
  syncSource: (companyId: string, sourceId: string) => api.post<SkillSourceRefreshResult>(`${source(companyId, sourceId)}/refresh`, {}),
  /** Removes a source; its skills are kept as copies or deleted. */
  removeSource: (companyId: string, sourceId: string, input: SkillSourceDisconnectRequest) =>
    api.delete<SkillSourceDisconnectResult>(source(companyId, sourceId), input),
  /** Automatic updates, importing new skills, the connection and the branch it follows. */
  sourceSettings: (companyId: string, sourceId: string, input: SkillSourceSettingsRequest) =>
    api.patch<SkillSource>(`${source(companyId, sourceId)}/settings`, input),
  /** Which of the repository's skills are imported. */
  selectSource: (companyId: string, sourceId: string, input: SkillSourceSelectionRequest) =>
    api.patch<SkillSourceRefreshResult>(source(companyId, sourceId), input),
  branches: (companyId: string, sourceId: string, signal?: AbortSignal) => api.get<SkillSourceBranches>(`${source(companyId, sourceId)}/branches`, { signal }),
  /** One file of a scanned skill, before importing it. */
  preview: (companyId: string, input: SkillSourcePreviewRequest) => api.post<SkillSourceFilePreview>(`${sources(companyId)}/preview`, input),
  /** Repositories the company's GitHub connections can read, to pick from. */
  repositories: (companyId: string, signal?: AbortSignal) => api.get<ProjectRepositoryOptions>(`${sources(companyId)}/repositories`, { signal }),
  /** Projects' repositories, and whether each is already a source. */
  projectRepositories: (companyId: string, signal?: AbortSignal) =>
    api.get<ProjectSkillRepository[]>(`${sources(companyId)}/project-repositories`, { signal }),
  /** Makes a project workspace's repository a source, limited to that project. */
  adoptProject: (companyId: string, workspaceId: string) => api.post<{ bindingId: string }>(`${sources(companyId)}/adopt-project`, { workspaceId }),
};
