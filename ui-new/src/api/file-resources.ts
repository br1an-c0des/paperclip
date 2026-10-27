import type {
  ResolvedWorkspaceResource,
  WorkspaceFileContent,
  WorkspaceFileListMode,
  WorkspaceFileListResponse,
  WorkspaceFileSelector,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * A task's workspace files (`/api/issues/:issueId/file-resources/*`), as ui/src/api/file-resources.ts
 * uses them. Board users only. The server picks the workspace (`workspace=auto`: the task's execution
 * workspace, then its project's) unless one is named.
 *
 * - `list` with mode `all` and no search returns one folder's direct children; with a search, or in
 *   `changed` (git status) or `recent` mode, a flat list of files. At most 100 per page.
 * - `content` returns the file as UTF-8 text or base64 (images, video, PDF), up to 512 KB of text and
 *   10 MB of media; `downloadUrl` streams the file itself.
 */

export type WorkspaceFileTarget = {
  workspace?: WorkspaceFileSelector;
  /** A project workspace, named by both ids. */
  projectId?: string | null;
  workspaceId?: string | null;
};

export type WorkspaceFileQuery = WorkspaceFileTarget & { path: string };

export type WorkspaceFileListQuery = WorkspaceFileTarget & {
  path?: string | null;
  mode?: WorkspaceFileListMode;
  q?: string | null;
  limit?: number;
  offset?: number;
};

export const WORKSPACE_FILE_PAGE_SIZE = 100;

export function fileResourceParams(query: WorkspaceFileQuery | WorkspaceFileListQuery) {
  const params = new URLSearchParams();
  if (query.projectId && query.workspaceId) {
    params.set("projectId", query.projectId);
    params.set("workspaceId", query.workspaceId);
  }
  if (query.path) params.set("path", query.path);
  if (query.workspace && query.workspace !== "auto") params.set("workspace", query.workspace);
  if ("mode" in query && query.mode && query.mode !== "all") params.set("mode", query.mode);
  if ("q" in query && query.q) params.set("q", query.q);
  if ("limit" in query && query.limit) params.set("limit", String(query.limit));
  if ("offset" in query && query.offset) params.set("offset", String(query.offset));
  return params;
}

const base = (issueId: string) => `/issues/${encodeURIComponent(issueId)}/file-resources`;

export const fileResourcesApi = {
  list: (issueId: string, query: WorkspaceFileListQuery = {}, signal?: AbortSignal) => {
    const qs = fileResourceParams(query).toString();
    return api.get<WorkspaceFileListResponse>(`${base(issueId)}/list${qs ? `?${qs}` : ""}`, { signal });
  },
  resolve: (issueId: string, query: WorkspaceFileQuery, signal?: AbortSignal) =>
    api.get<ResolvedWorkspaceResource>(`${base(issueId)}/resolve?${fileResourceParams(query)}`, { signal }),
  content: (issueId: string, query: WorkspaceFileQuery, signal?: AbortSignal) =>
    api.get<WorkspaceFileContent>(`${base(issueId)}/content?${fileResourceParams(query)}`, { signal }),
  /** The file itself, for a download link. */
  downloadUrl: (issueId: string, query: WorkspaceFileQuery) => {
    const params = fileResourceParams(query);
    params.set("download", "1");
    return `/api${base(issueId)}/content?${params}`;
  },
};
