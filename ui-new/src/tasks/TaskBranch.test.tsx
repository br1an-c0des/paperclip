import type { Issue } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const reconcileBranch = vi.fn(async (_id: string, _input: unknown) => ({}));
let access: Record<string, unknown> = { isInstanceAdmin: false, companyIds: [], memberships: [{ companyId: "co1", status: "active", membershipRole: "viewer" }] };

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
vi.mock("@/api/access", () => ({ accessApi: { currentBoardAccess: vi.fn(async () => access) } }));
vi.mock("@/api/workspaces", () => ({
  workspacesApi: {
    closeReadiness: vi.fn(async () => ({
      git: { repoRoot: "/r", workspacePath: "/r/w", branchName: "pap/TES-9-follow-up", baseRef: "main", headSha: "1234567890abc", hasDirtyTrackedFiles: true, hasUntrackedFiles: false, dirtyEntryCount: 2, untrackedEntryCount: 0, aheadCount: 3, behindCount: 0, isMergedIntoBase: false, createdByRuntime: true },
    })),
    reconcileBranch: (id: string, input: unknown) => reconcileBranch(id, input),
  },
}));

const { TaskBranch } = await import("./TaskBranch");

const task = (verdict: string, cleanliness = "clean") =>
  ({
    id: "t1",
    activeRecoveryAction: {
      kind: "workspace_validation",
      status: "active",
      evidence: {
        workspaceValidation: {
          reason: "git_worktree_branch_incoherence",
          expectedBranch: "pap/TES-9",
          actualBranch: "pap/TES-9-follow-up",
          cleanliness,
          statusEntryCount: 2,
          persistedExecutionWorkspaceId: "ws-old",
          provenance: { expectedHeadSha: "aaaaaaaaaaaa", actualHeadSha: "bbbbbbbbbbbb", ancestryVerdict: verdict },
        },
      },
    },
  }) as unknown as Issue;

function mount(issue: Issue) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      <TaskBranch task={issue} workspaceId="ws-now" />
    </QueryClientProvider>
  ));
}

describe("TaskBranch", () => {
  beforeEach(() => {
    reconcileBranch.mockClear();
    access = { isInstanceAdmin: false, companyIds: [], memberships: [{ companyId: "co1", status: "active", membershipRole: "viewer" }] };
  });

  it("shows the branch's state against its base", async () => {
    mount({ id: "t1", activeRecoveryAction: null } as unknown as Issue);
    expect(await screen.findByText("3 ahead, 0 behind main")).toBeTruthy();
    expect(screen.getByText("2 uncommitted changes")).toBeTruthy();
    expect(screen.queryByText("The branch is out of step")).toBeNull();
  });

  it("reconciles a forward-only divergence after confirming, on the workspace that diverged", async () => {
    mount(task("ancestor"));
    expect(await screen.findByText("The branch is out of step")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reconcile anyway" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Reconcile forward/ }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("pap/TES-9");
    expect(reconcileBranch).not.toHaveBeenCalled();
    const confirm = screen.getAllByRole("button", { name: "Reconcile forward" }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(reconcileBranch).toHaveBeenCalledWith("ws-old", { mode: "forward" }));
  });

  it("asks for a reason before the break-glass override", async () => {
    access = { source: "local_implicit" };
    mount(task("diverged", "dirty"));
    expect(await screen.findByRole("button", { name: /Repair: move changes aside/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reconcile forward/ })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Reconcile anyway" }));
    await screen.findByRole("dialog");
    const confirm = () => screen.getAllByRole("button", { name: "Reconcile anyway" }).at(-1)! as HTMLButtonElement;
    expect(confirm().disabled).toBe(true);
    fireEvent.input(screen.getByRole("textbox", { name: "Reason (required)" }), { target: { value: "Checked the follow-up commits" } });
    expect(confirm().disabled).toBe(false);
    fireEvent.click(confirm());
    await waitFor(() => expect(reconcileBranch).toHaveBeenCalledWith("ws-old", { mode: "override", reason: "Checked the follow-up commits" }));
  });
});
