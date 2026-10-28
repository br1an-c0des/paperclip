import type { ExecutionWorkspaceCloseGitReadiness, IssueRecoveryAction } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { branchStateLines, canManageRuntime, readableGit, readDivergence, reconcileOptions, reconcileWorkspaceId } from "./branch-reconcile";

const action = (validation: Record<string, unknown>, overrides: Partial<IssueRecoveryAction> = {}) =>
  ({
    id: "r1",
    kind: "workspace_validation",
    status: "active",
    evidence: { workspaceValidation: { reason: "git_worktree_branch_incoherence", ...validation } },
    ...overrides,
  }) as unknown as IssueRecoveryAction;

const diverged = action({
  expectedBranch: "pap/TES-9",
  actualBranch: "pap/TES-9-follow-up",
  cleanliness: "dirty",
  statusEntryCount: 3,
  dirtyPathSample: ["src/a.ts", ""],
  sourceIdentifier: "TES 9",
  persistedExecutionWorkspaceId: "ws-old",
  provenance: { expectedHeadSha: "abcdef1234567890", actualHeadSha: "1234567", ancestryVerdict: "ancestor", plainLanguageReason: "The live branch moved on." },
});

describe("readDivergence", () => {
  it("reads the branches, ancestry and cleanliness from the evidence", () => {
    expect(readDivergence(diverged)).toEqual({
      expectedBranch: "pap/TES-9",
      liveBranch: "pap/TES-9-follow-up",
      expectedHeadSha: "abcdef1234567890",
      liveHeadSha: "1234567",
      verdict: "ancestor",
      reason: "The live branch moved on.",
      cleanliness: "dirty",
      dirtyFileCount: 3,
      dirtyPathSample: ["src/a.ts"],
      heldBy: null,
      rescueBranchPrefix: "paperclip/rescue/TES-9/",
    });
  });

  it("ignores other recovery actions and resolved ones", () => {
    expect(readDivergence(null)).toBeNull();
    expect(readDivergence(action({ reason: "something_else" }))).toBeNull();
    expect(readDivergence(action({}, { kind: "missing_disposition" } as Partial<IssueRecoveryAction>))).toBeNull();
    expect(readDivergence(action({}, { status: "resolved" }))).toBeNull();
  });

  it("names the task holding the live branch", () => {
    const held = readDivergence(action({ contention: { claimedByIssueIdentifier: "TES-4", activeRun: { id: "run" } } }));
    expect(held?.heldBy).toEqual({ label: "TES-4", activeRun: true });
  });
});

describe("reconcile", () => {
  it("targets the workspace the evidence names, else the task's", () => {
    expect(reconcileWorkspaceId(diverged, "ws-now")).toBe("ws-old");
    expect(reconcileWorkspaceId(action({ executionWorkspaceId: "ws-x" }), "ws-now")).toBe("ws-x");
    expect(reconcileWorkspaceId(null, "ws-now")).toBe("ws-now");
  });

  it("offers forward only for an ancestor, repair only when dirty, override only to runtime managers", () => {
    const found = readDivergence(diverged)!;
    expect(reconcileOptions(found, false)).toEqual({ forward: true, repair: true, repairBlocked: null, override: false });
    const clean = readDivergence(action({ cleanliness: "clean", provenance: { ancestryVerdict: "diverged" } }))!;
    expect(reconcileOptions(clean, true)).toEqual({ forward: false, repair: false, repairBlocked: null, override: true });
    const held = readDivergence(action({ cleanliness: "dirty", contention: { claimedByIssueIdentifier: "TES-4" } }))!;
    expect(reconcileOptions(held, false).repairBlocked).toBe("Held by TES-4.");
  });

  it("lets admins, local boards and non-viewer members manage the runtime", () => {
    expect(canManageRuntime("co1", { source: "local_implicit" })).toBe(true);
    expect(canManageRuntime("co1", { isInstanceAdmin: true })).toBe(true);
    expect(canManageRuntime("co1", { companyIds: ["co1"] })).toBe(true);
    expect(canManageRuntime("co1", { memberships: [{ companyId: "co1", status: "active", membershipRole: "viewer" }] })).toBe(false);
    expect(canManageRuntime("co1", { memberships: [{ companyId: "co1", status: "active", membershipRole: "operator" }] })).toBe(true);
    expect(canManageRuntime("co1", undefined)).toBe(false);
  });
});

describe("branchStateLines", () => {
  const git = (overrides: Partial<ExecutionWorkspaceCloseGitReadiness> = {}): ExecutionWorkspaceCloseGitReadiness => ({
    repoRoot: "/repo",
    workspacePath: "/repo/wt",
    branchName: "pap/TES-9",
    baseRef: "main",
    hasDirtyTrackedFiles: false,
    hasUntrackedFiles: false,
    dirtyEntryCount: 0,
    untrackedEntryCount: 0,
    aheadCount: 2,
    behindCount: 1,
    isMergedIntoBase: false,
    createdByRuntime: true,
    ...overrides,
  });
  it("drops git state that couldn't be read", () => {
    expect(readableGit(git({ repoRoot: null, branchName: null }))).toBeNull();
    expect(readableGit(git())).not.toBeNull();
    expect(readableGit(null)).toBeNull();
  });

  it("says where the branch stands", () => {
    expect(branchStateLines(git())).toEqual(["2 ahead, 1 behind main", "No uncommitted changes"]);
    expect(branchStateLines(git({ aheadCount: 0, behindCount: 0, isMergedIntoBase: true, dirtyEntryCount: 1, untrackedEntryCount: 2 }))).toEqual([
      "Even with main",
      "Merged into its base",
      "1 uncommitted change, 2 untracked files",
    ]);
  });
});
