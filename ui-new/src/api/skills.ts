import type {
  CompanySkillAuditResult,
  CompanySkillRenameRequest,
  CompanySkillRenameResult,
  CompanySkillResetRequest,
  CompanySkillUpdateRequest,
  SkillSourceDiscoveryEvent,
  SkillSourceScanUpdate,
  CatalogSkill,
  CatalogSkillFileDetail,
  CompanySkill,
  CompanySkillCreateRequest,
  CompanySkillDetail,
  CompanySkillFileDeleteRequest,
  CompanySkillFileDeleteResult,
  CompanySkillFileDetail,
  CompanySkillFileUpdateRequest,
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
  SkillSourceUpdateDiff,
  CompanySkillVersion,
  CompanySkillVersionCreateRequest,
  CompanySkillVersionSummary,
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
import { api, ApiError, errorMessage, readApiJson } from "./client";

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
 * Also a skill's settings (`PATCH …/:id`: description, tagline, categories, author, homepage,
 * icon, colour, sharing), renaming one written here (`POST …/:id/rename`), the audit
 * (`POST …/:id/audit`) and resetting a catalog skill (`POST …/:id/reset`), a source's GitHub
 * connection (`PATCH …/:id/settings { connectionId }`, branches read through it), and a repository
 * scan's live progress (`POST …/discover` with `Accept: application/x-ndjson`).
 *
 * Left out: comments (unused in the old UI) and the Studio's test runs, inputs and templates
 * (decision 39, D6).
 */

const skills = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/skills`;
const skill = (companyId: string, skillId: string) => `${skills(companyId)}/${encodeURIComponent(skillId)}`;
const sources = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/skill-sources`;
const source = (companyId: string, sourceId: string) => `${sources(companyId)}/${encodeURIComponent(sourceId)}`;
const folders = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/folders`;

export const skillsApi = {
  list: (companyId: string, signal?: AbortSignal) => api.get<CompanySkillListItem[]>(`${skills(companyId)}?sort=alphabetical`, { signal }),
  detail: (companyId: string, skillId: string, signal?: AbortSignal) => api.get<CompanySkillDetail>(skill(companyId, skillId), { signal }),
  /** The versions with file names and kinds only; read one with `version` for its files' contents. */
  versions: (companyId: string, skillId: string, signal?: AbortSignal) =>
    api.get<CompanySkillVersionSummary[]>(`${skill(companyId, skillId)}/versions`, { signal }),
  version: (companyId: string, skillId: string, versionId: string, signal?: AbortSignal) =>
    api.get<CompanySkillVersion>(`${skill(companyId, skillId)}/versions/${encodeURIComponent(versionId)}`, { signal }),
  /**
   * Names the skill's current files as a version. For a managed skill, `sourceVersionId` restores
   * that version instead; `expectedVersionId` refuses the write (409) if the skill changed meanwhile.
   */
  createVersion: (companyId: string, skillId: string, label: string | null, options: Omit<CompanySkillVersionCreateRequest, "label"> = {}) =>
    api.post<CompanySkillVersion>(`${skill(companyId, skillId)}/versions`, { label, ...options }),
  file: (companyId: string, skillId: string, path: string, signal?: AbortSignal) =>
    api.get<CompanySkillFileDetail>(`${skill(companyId, skillId)}/files?path=${encodeURIComponent(path)}`, { signal }),
  /** `expectedVersionId` refuses the save (409) if the skill changed since that version. */
  saveFile: (companyId: string, skillId: string, path: string, content: string, format: Pick<CompanySkillFileUpdateRequest, "encoding" | "executable" | "expectedVersionId"> = {}) =>
    api.patch<CompanySkillFileDetail>(`${skill(companyId, skillId)}/files`, { path, content, ...format }),
  /** `expectedVersionId` refuses the delete (409) if the skill changed since that version. */
  deleteFile: (companyId: string, skillId: string, path: string, options: Pick<CompanySkillFileDeleteRequest, "expectedVersionId"> = {}) =>
    api.delete<CompanySkillFileDeleteResult>(`${skill(companyId, skillId)}/files`, { path, target: "file", ...options } satisfies CompanySkillFileDeleteRequest),
  create: (companyId: string, payload: CompanySkillCreateRequest) => api.post<CompanySkill>(skills(companyId), payload),
  /** Description, tagline, categories, author, homepage, icon, colour and sharing. */
  update: (companyId: string, skillId: string, payload: CompanySkillUpdateRequest) => api.patch<CompanySkill>(skill(companyId, skillId), payload),
  /** Renames a skill written here; agents using it move to the new key (`reassignments`). */
  rename: (companyId: string, skillId: string, payload: CompanySkillRenameRequest) => api.post<CompanySkillRenameResult>(`${skill(companyId, skillId)}/rename`, payload),
  /** Scans the installed files and records the verdict on the skill. */
  audit: (companyId: string, skillId: string) => api.post<CompanySkillAuditResult>(`${skill(companyId, skillId)}/audit`, {}),
  /** A catalog skill back to the catalog's files; `force` discards saved edits. */
  reset: (companyId: string, skillId: string, payload: CompanySkillResetRequest = {}) => api.post<CompanySkill>(`${skill(companyId, skillId)}/reset`, payload),
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
  /**
   * What a pending update changes, file by file: unified line diffs between the installed and the
   * latest tracked GitHub revisions (#20155). Unsupported (with a reason) for other origins.
   */
  updateDiff: (companyId: string, skillId: string, signal?: AbortSignal) =>
    api.get<SkillSourceUpdateDiff>(`${skill(companyId, skillId)}/update-diff`, { signal }),
  /** `force` installs an update held for local edits, discarding them. */
  installUpdate: (companyId: string, skillId: string, options: { force?: boolean } = {}) =>
    api.post<CompanySkill>(`${skill(companyId, skillId)}/install-update`, options.force ? { force: true } : {}),
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
  /**
   * The same scan, streamed: progress and each skill found as they come (NDJSON), then the result.
   * Rejects when the server doesn't stream (an older server, or a proxy that buffers it).
   */
  discoverStream: async (companyId: string, input: SkillSourceDiscoveryRequest, onUpdate: (update: SkillSourceScanUpdate) => void, signal?: AbortSignal) => {
    const res = await fetch(`/api${sources(companyId)}/discover`, {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(input),
      headers: { Accept: "application/x-ndjson", "Content-Type": "application/json" },
      signal,
    });
    if (!res.ok) {
      const body = await readApiJson<unknown>(res);
      throw new ApiError(errorMessage(body, res.status), res.status, body);
    }
    if (!res.body || !res.headers.get("Content-Type")?.includes("application/x-ndjson")) throw new StreamUnavailableError();
    const reader = res.body.getReader();
    try {
      return await readDiscoveryStream(reader, onUpdate, signal);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  },
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
  /** Branches as the given connection sees them (the source's own otherwise). */
  branches: (companyId: string, sourceId: string, signal?: AbortSignal, connectionId?: string | null) =>
    api.get<SkillSourceBranches>(`${source(companyId, sourceId)}/branches${connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : ""}`, { signal }),
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

/** The server answered a streamed scan without streaming it. */
export class StreamUnavailableError extends Error {
  constructor() {
    super("The live scan isn't available.");
    this.name = "StreamUnavailableError";
  }
}

/**
 * Reads a scan's NDJSON lines (ui/src/api/skillSources.ts `discoverStream`): progress and found
 * skills go to `onUpdate`; `complete` resolves the discovery; `error` rejects with its status. A
 * stream that ends before `complete` was cut off.
 */
export async function readDiscoveryStream(
  reader: { read: () => Promise<{ value?: Uint8Array; done: boolean }> },
  onUpdate: (update: SkillSourceScanUpdate) => void,
  signal?: AbortSignal,
): Promise<SkillSourceDiscovery> {
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    signal?.throwIfAborted();
    const { value, done } = await reader.read();
    signal?.throwIfAborted();
    buffer += decoder.decode(value, { stream: !done });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const event = JSON.parse(line) as SkillSourceDiscoveryEvent;
      if (event.type === "error") throw new ApiError(event.error, event.status, event);
      if (event.type === "complete") return event.discovery;
      if (event.type === "progress" || event.type === "candidate") onUpdate(event);
      else throw new Error("The scan sent something unexpected. Try again.");
    }
    if (done) throw new Error("The repository scan was cut off. Try again.");
  }
}
