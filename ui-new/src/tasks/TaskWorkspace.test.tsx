import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The Workspace section's services, jobs and operations, against mocked requests: starting a
 * configured service or running a job starts a process on the machine, so it's checked here
 * rather than on a real workspace.
 */

afterEach(cleanup);

const commands = vi.fn(async (..._args: unknown[]) => ({ workspace: {} }));
const services = vi.fn(async (..._args: unknown[]) => ({ workspace: {} }));
const operationLog = vi.fn(async () => ({
  operationId: "op-1",
  store: "local_file",
  logRef: "x",
  content: `${JSON.stringify({ ts: "2026-10-28T10:00:01Z", stream: "stdout", chunk: "Preparing worktree pap/TES-7" })}\n`,
}));

const workspace = {
  id: "w1",
  name: "TES-7",
  mode: "isolated_workspace",
  status: "active",
  cwd: "/work/TES-7",
  branchName: "pap/TES-7",
  baseRef: "main",
  repoUrl: null,
  projectId: "p1",
  projectWorkspaceId: "pw1",
  openedAt: "2026-10-28T09:00:00Z",
  lastUsedAt: "2026-10-28T10:00:00Z",
  closedAt: null,
  config: {
    workspaceRuntime: {
      services: [{ name: "web", command: "pnpm dev", port: 5173 }],
      jobs: [{ name: "Migrate", command: "pnpm migrate" }],
    },
  },
  runtimeServices: [],
};

vi.mock("@/api/issues", () => ({
  issuesApi: { get: async () => ({ id: "t1", projectId: "p1", projectWorkspaceId: "pw1", executionWorkspaceId: "w1", currentExecutionWorkspace: { id: "w1" }, project: { primaryWorkspace: { id: "pw0" } } }) },
}));
vi.mock("@/api/execution-workspaces", () => ({
  executionWorkspacesApi: {
    get: async () => workspace,
    operations: async () => [
      {
        id: "op-1",
        phase: "worktree_prepare",
        status: "succeeded",
        command: null,
        cwd: "/work/TES-7",
        exitCode: null,
        logRef: "x",
        stdoutExcerpt: null,
        stderrExcerpt: null,
        metadata: { branchName: "pap/TES-7", created: true },
        startedAt: "2026-10-28T09:00:00Z",
        finishedAt: "2026-10-28T09:00:04Z",
      },
    ],
    controlRuntimeCommands: (...args: unknown[]) => commands(...args),
    controlRuntimeServices: (...args: unknown[]) => services(...args),
  },
}));
vi.mock("@/api/heartbeats", () => ({ heartbeatsApi: { workspaceOperationLog: () => operationLog() } }));
vi.mock("@/api/instance-settings", () => ({ instanceSettingsApi: { general: async () => ({ censorUsernameInLogs: false }) } }));
vi.mock("./TaskBranch", () => ({ TaskBranch: () => null }));
vi.mock("@/plugins/WorkspacePlugins", () => ({ WorkspacePlugins: () => null }));
vi.mock("@/ui/Toast", () => ({ pushToast: vi.fn() }));

const { TaskWorkspace } = await import("./TaskWorkspace");

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      <TaskWorkspace taskId="t1" />
    </QueryClientProvider>
  ));
}

describe("TaskWorkspace", () => {
  it("starts a configured service that has never run, through the runtime commands", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Start" }));
    await waitFor(() => expect(commands).toHaveBeenCalledWith("w1", "start", { workspaceCommandId: "service:web", runtimeServiceId: null, serviceIndex: 0 }));
    expect(services).not.toHaveBeenCalled();
  });

  it("runs a configured job once", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await waitFor(() => expect(commands).toHaveBeenCalledWith("w1", "run", { workspaceCommandId: "job:migrate", runtimeServiceId: null, serviceIndex: null }));
  });

  it("lists the workspace's operations, with the stored log on request", async () => {
    mount();
    fireEvent.click(await screen.findByText("Worktree setup"));
    expect(await screen.findByText("Created the workspace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show the full log" }));
    expect(await screen.findByText("Preparing worktree pap/TES-7")).toBeTruthy();
  });
});
