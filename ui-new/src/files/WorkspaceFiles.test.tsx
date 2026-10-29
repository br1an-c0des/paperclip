import type { WorkspaceFileListItem, WorkspaceFileListResponse } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileResourcesApi } from "@/api/file-resources";
import { WorkspaceFiles } from "./WorkspaceFiles";

vi.mock("@/api/file-resources", async (original) => ({
  ...(await original<typeof import("@/api/file-resources")>()),
  fileResourcesApi: { list: vi.fn(), content: vi.fn(), resolve: vi.fn(), downloadUrl: () => "/download" },
}));

// One project workspace to browse instead of the task's own.
vi.mock("@/lib/company-data", () => ({
  useProjectsQuery: () => ({
    data: [{ id: "p1", name: "Site", archivedAt: null, workspaces: [{ id: "pw1", name: "Main", cwd: "/repo/site", repoUrl: null }] }],
  }),
}));

// CodeMirror needs real layout; the plain-text stand-in is enough here.
vi.mock("@/documents/cm-viewer", () => ({
  createCodeView: () => {
    throw new Error("no CodeMirror in jsdom");
  },
}));

const api = vi.mocked(fileResourcesApi);

const item = (relativePath: string, kind: "file" | "directory" = "file") =>
  ({ kind, relativePath, title: relativePath.split("/").pop(), byteSize: kind === "file" ? 2048 : null, previewKind: kind === "file" ? "text" : "unsupported" }) as WorkspaceFileListItem;

const listing = (items: WorkspaceFileListItem[], extra: Partial<WorkspaceFileListResponse> = {}) =>
  ({
    kind: "workspace_file_list",
    state: "available",
    workspace: { provider: "git_worktree", workspaceLabel: "tra-41-h4", workspaceKind: "execution_workspace", workspaceId: "w1" },
    query: { workspace: "auto", mode: "changed", q: null, limit: 100, offset: 0 },
    items,
    scannedCount: items.length,
    truncated: false,
    ...extra,
  }) as WorkspaceFileListResponse;

function show(open: Parameters<typeof WorkspaceFiles>[0]["open"] = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      <WorkspaceFiles taskId="i1" open={open} backLabel="Back" onBack={() => {}} />
    </QueryClientProvider>
  ));
}

describe("WorkspaceFiles", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it("lists changed files by folder and previews one", async () => {
    api.list.mockResolvedValue(listing([item("src/app.ts"), item("README.md")]));
    api.content.mockResolvedValue({
      resource: { kind: "file", provider: "git_worktree", title: "app.ts", displayPath: "src/app.ts", workspaceLabel: "tra-41-h4", workspaceKind: "execution_workspace", workspaceId: "w1", contentType: "text/plain", byteSize: 2048, previewKind: "text", capabilities: { preview: true, download: true, listChildren: false } },
      content: { encoding: "utf8", data: "export const answer = 42;" },
    });
    show();
    expect(await screen.findByText("tra-41-h4")).toBeTruthy();
    expect(screen.getByText("src/")).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith("i1", expect.objectContaining({ mode: "changed" }), expect.anything());
    fireEvent.click(screen.getByRole("button", { name: /app\.ts/ }));
    expect(await screen.findByText("export const answer = 42;")).toBeTruthy();
    expect(api.content).toHaveBeenCalledWith("i1", expect.objectContaining({ path: "src/app.ts" }), expect.anything());
    expect(screen.getByText(/TypeScript/)).toBeTruthy();
  });

  it("browses all files folder by folder", async () => {
    api.list.mockImplementation(async (_id, query) =>
      query?.path === "src" ? listing([item("src/main.py")]) : listing([item("src", "directory"), item("notes.txt")]),
    );
    show();
    fireEvent.click(await screen.findByRole("button", { name: "All files" }));
    const folder = await screen.findByRole("button", { name: "src" });
    expect(folder.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(folder);
    expect(await screen.findByRole("button", { name: /main\.py/ })).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith("i1", expect.objectContaining({ mode: "all", path: "src" }), expect.anything());
  });

  it("explains a task with no workspace", async () => {
    api.list.mockResolvedValue(listing([], { state: "unavailable", unavailableReason: "no_workspace", workspace: null }));
    show();
    expect(await screen.findByText("No workspace yet")).toBeTruthy();
  });

  it("opens a file it was pointed at, revealing its folders", async () => {
    api.list.mockImplementation(async (_id, query) =>
      query?.path === "src" ? listing([item("src/app.ts")]) : listing([item("src", "directory")]),
    );
    api.content.mockResolvedValue({
      resource: { kind: "file", provider: "git_worktree", title: "app.ts", displayPath: "src/app.ts", workspaceLabel: "w", workspaceKind: "execution_workspace", workspaceId: "w1", contentType: "text/plain", byteSize: 10, previewKind: "text", capabilities: { preview: true, download: true, listChildren: false } },
      content: { encoding: "utf8", data: "line one" },
    });
    show({ path: "src/app.ts", line: 1, workspace: "execution" });
    expect(await screen.findByText("line one")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: /app\.ts/ }).getAttribute("aria-current")).toBe("true"));
  });

  it("browses a project workspace's recent files instead", async () => {
    api.list.mockResolvedValue(listing([item("index.html")]));
    show();
    const picker = await screen.findByRole("button", { name: /^Workspace: / });
    fireEvent.pointerDown(picker, { button: 0, pointerType: "mouse" });
    fireEvent.click(picker);
    const option = await screen.findByRole("menuitem", { name: /Main/ });
    fireEvent.pointerDown(option, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(option, { button: 0, pointerType: "mouse" });
    fireEvent.click(option);
    fireEvent.click(screen.getByText("Recent"));
    await waitFor(() =>
      expect(api.list).toHaveBeenCalledWith("i1", expect.objectContaining({ workspace: "project", projectId: "p1", workspaceId: "pw1", mode: "recent" }), expect.anything()),
    );
  });
});
