import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const control = vi.fn(async () => ({}));
const close = vi.fn(async () => ({}));
const openTaskModal = vi.fn();
const overview = vi.fn(async (_companyId: string, options: { status?: string[] }) => ({
  items: options.status?.includes("archived")
    ? []
    : [
        {
          key: "execution:w1",
          kind: "execution_workspace",
          workspaceId: "w1",
          workspaceName: "TES-7",
          projectId: "p1",
          projectUrlKey: "site",
          projectName: "Site",
          mode: "isolated_workspace",
          strategyType: "git_worktree",
          cwd: "/home/me/.paperclip/instances/default/ws/w1",
          branchName: "pap/TES-7",
          lastUpdatedAt: "2026-10-27T10:00:00Z",
          projectWorkspaceId: null,
          executionWorkspaceId: "w1",
          executionWorkspaceStatus: "active",
          serviceCount: 1,
          runningServiceCount: 1,
          primaryServiceUrl: "http://localhost:5173",
          primaryServiceUrlRunning: true,
          primaryService: null,
          hasRuntimeConfig: true,
          linkedIssueCount: 1,
          linkedIssues: [{ id: "t7", identifier: "TES-7", title: "Fix the header", status: "in_progress", priority: "medium", updatedAt: "2026-10-27T10:00:00Z" }],
        },
      ],
  total: 1,
  limit: 50,
  offset: 0,
  hasMore: false,
  nextOffset: null,
}));

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES", name: "Test" }) }));
vi.mock("@/lib/commands", () => ({ useCommands: () => ({ openTaskModal }) }));
vi.mock("@/lib/company-data", () => ({ useExperimentalSettingsQuery: () => ({ data: { enableManagedSandboxOnly: false } }) }));
vi.mock("@/org/OrgHeader", () => ({ OrgHeader: () => <div>Org header</div> }));
vi.mock("@/api/execution-workspaces", () => ({ executionWorkspacesApi: { controlRuntimeServices: (...args: unknown[]) => control(...(args as [])) } }));
vi.mock("@/api/workspaces", () => ({
  workspacesApi: {
    overview: (companyId: string, options: { status?: string[] }) => overview(companyId, options),
    closeReadiness: vi.fn(async () => ({
      workspaceId: "w1",
      state: "ready_with_warnings",
      blockingReasons: [],
      warnings: ["The branch has unpushed commits."],
      linkedIssues: [{ id: "t7", identifier: "TES-7", title: "Fix the header", status: "in_progress", isTerminal: false }],
      plannedActions: [{ kind: "git_worktree_remove", label: "Remove the worktree", description: "Deletes the checkout.", command: "git worktree remove" }],
      isDestructiveCloseAllowed: true,
      isSharedWorkspace: false,
      isProjectPrimaryWorkspace: false,
      git: null,
      runtimeServices: [],
    })),
    close: (...args: unknown[]) => close(...(args as [])),
  },
}));

const { WorkspacesPage } = await import("./WorkspacesPage");

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      <Router>
        <Route path="*" component={WorkspacesPage} />
      </Router>
    </QueryClientProvider>
  ));
}

describe("WorkspacesPage", () => {
  it("lists workspaces by project with their branch, services and tasks", async () => {
    mount();
    const card = await screen.findByRole("article", { name: "TES-7" });
    expect(screen.getByRole("link", { name: "Site" }).getAttribute("href")).toBe("/TES/projects/site");
    expect(card.textContent).toContain("pap/TES-7");
    expect(card.textContent).toContain("…/default/ws/w1");
    expect(card.textContent).toContain("1 of 1 service running");
    expect(within(card).getByRole("link", { name: /localhost:5173/ }).getAttribute("href")).toBe("http://localhost:5173");
    fireEvent.click(within(card).getByRole("button", { name: /TES-7/ }));
    expect(openTaskModal).toHaveBeenCalledWith({ id: "t7", identifier: "TES-7", title: "Fix the header", projectId: "p1" });
  });

  it("stops services and closes after the close check", async () => {
    mount();
    const card = await screen.findByRole("article", { name: "TES-7" });
    fireEvent.click(within(card).getByRole("button", { name: "Stop services" }));
    await waitFor(() => expect(control).toHaveBeenCalledWith("w1", "stop"));
    fireEvent.click(within(card).getByRole("button", { name: "Close" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Can close, with warnings")).toBeTruthy();
    expect(dialog.textContent).toContain("The branch has unpushed commits.");
    expect(dialog.textContent).toContain("Remove the worktree");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close workspace" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith("w1"));
  });

  it("lists closed workspaces on request", async () => {
    mount();
    await screen.findByRole("article", { name: "TES-7" });
    fireEvent.click(screen.getByRole("button", { name: "Closed" }));
    expect(await screen.findByText("No closed workspaces.")).toBeTruthy();
    expect(overview).toHaveBeenLastCalledWith("co1", expect.objectContaining({ status: ["archived"] }));
  });
});
