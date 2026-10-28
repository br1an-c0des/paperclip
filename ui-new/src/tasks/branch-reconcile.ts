import type { ExecutionWorkspaceCloseGitReadiness, GitWorktreeBranchAncestryVerdict, IssueRecoveryAction } from "@paperclipai/shared";

/*
 * A task's branch state and branch reconcile (`workspaces/files-git`), after the old UI's recovery
 * card (ui/src/components/IssueRecoveryActionCard.tsx) and ui/src/lib/recovery-reconcile.ts.
 *
 * When a run finds the workspace's checked-out branch isn't the one Paperclip recorded, the server
 * stops the run and opens a `workspace_validation` recovery action whose evidence describes the
 * divergence: both branches and HEADs, whether the recorded HEAD is an ancestor of the live one,
 * whether the worktree has uncommitted changes, and whether another task holds the live branch.
 * Three fixes, each confirmed first:
 *
 * - Reconcile forward: only when the recorded HEAD is an ancestor of the live one (the server checks
 *   again). The recorded branch becomes the live one.
 * - Repair (quarantine and restore): only when the worktree has uncommitted changes, and not while
 *   another task holds the live branch. The changes go to a rescue branch, the recorded branch is
 *   checked out again. Nothing is lost.
 * - Reconcile anyway (break-glass): adopts the live branch without the ancestry proof, with a reason
 *   for the audit log. Only for people who may manage the company's runtime.
 *
 * Each one resolves the recovery action and puts the task back to work, which wakes its agent.
 */

export type Divergence = {
  expectedBranch: string | null;
  liveBranch: string | null;
  expectedHeadSha: string | null;
  liveHeadSha: string | null;
  verdict: GitWorktreeBranchAncestryVerdict;
  reason: string | null;
  cleanliness: "clean" | "dirty" | "unknown" | null;
  dirtyFileCount: number | null;
  dirtyPathSample: string[];
  /** The task holding the live branch, when another one does. */
  heldBy: { label: string; activeRun: boolean } | null;
  /** The rescue branch's prefix; the server adds a timestamp. */
  rescueBranchPrefix: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** As the server's `sanitizeBranchName`, for the rescue branch preview. */
function branchPart(value: string) {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._/-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-/.]+|[-/.]+$/g, "")
      .slice(0, 120) || "issue"
  );
}

/** The divergence a recovery action describes, or null when it isn't a branch divergence. */
export function readDivergence(action: IssueRecoveryAction | null | undefined): Divergence | null {
  if (!action || action.kind !== "workspace_validation") return null;
  if (action.status === "resolved" || action.status === "cancelled") return null;
  const validation = record(action.evidence?.workspaceValidation);
  if (!validation || validation.reason !== "git_worktree_branch_incoherence") return null;
  const provenance = record(validation.provenance) ?? {};
  const verdict = provenance.ancestryVerdict;
  const cleanliness = validation.cleanliness;
  const count = validation.statusEntryCount;
  const contention = record(validation.contention);
  const claimant = contention ? (text(contention.claimedByIssueIdentifier) ?? (text(contention.claimedByIssueId) ? `task ${text(contention.claimedByIssueId)!.slice(0, 8)}` : "another task")) : null;
  return {
    expectedBranch: text(validation.expectedBranch),
    liveBranch: text(validation.actualBranch),
    expectedHeadSha: text(provenance.expectedHeadSha),
    liveHeadSha: text(provenance.actualHeadSha),
    verdict: verdict === "ancestor" || verdict === "diverged" ? verdict : "unknown",
    reason: text(provenance.plainLanguageReason),
    cleanliness: cleanliness === "clean" || cleanliness === "dirty" || cleanliness === "unknown" ? cleanliness : null,
    dirtyFileCount: typeof count === "number" && Number.isFinite(count) && count >= 0 ? Math.floor(count) : null,
    dirtyPathSample: Array.isArray(validation.dirtyPathSample) ? validation.dirtyPathSample.filter((entry): entry is string => typeof entry === "string" && !!entry.trim()) : [],
    heldBy: claimant ? { label: claimant, activeRun: record(contention!.activeRun) !== null } : null,
    rescueBranchPrefix: `paperclip/rescue/${branchPart(text(validation.sourceIdentifier) ?? "issue")}/`,
  };
}

/**
 * The workspace to reconcile: the one the recovery action's evidence names (the workspace that
 * diverged), else the task's own. The task's can move on while the action still describes the old one.
 */
export function reconcileWorkspaceId(action: IssueRecoveryAction | null | undefined, fallback: string | null) {
  const validation = record(action?.kind === "workspace_validation" ? action.evidence?.workspaceValidation : null);
  return text(validation?.persistedExecutionWorkspaceId) ?? text(validation?.executionWorkspaceId) ?? fallback;
}

export const VERDICT: Record<GitWorktreeBranchAncestryVerdict, { label: string; tone: "green" | "red" | undefined }> = {
  ancestor: { label: "Forward only", tone: "green" },
  diverged: { label: "Diverged", tone: "red" },
  unknown: { label: "Ancestry unknown", tone: undefined },
};

export function shortSha(sha: string | null) {
  return sha ? sha.slice(0, 10) : null;
}

/** Which fixes to offer for a divergence. */
export function reconcileOptions(divergence: Divergence, canManageRuntime: boolean) {
  return {
    forward: divergence.verdict === "ancestor",
    repair: divergence.cleanliness === "dirty",
    /** Why the repair can't run now, when another task holds the live branch. */
    repairBlocked: divergence.cleanliness === "dirty" && divergence.heldBy ? `Held by ${divergence.heldBy.label}${divergence.heldBy.activeRun ? " (running)" : ""}.` : null,
    override: canManageRuntime,
  };
}

/**
 * Whether you may manage the company's runtime, which the break-glass override needs. The server
 * checks again (`runtime:manage`); this only hides a button that would fail. After
 * `canBoardManageRuntime` in ui/src/lib/recovery-reconcile.ts.
 */
export function canManageRuntime(companyId: string, access: unknown) {
  const value = record(access);
  if (!value) return false;
  if (value.source === "local_implicit" || value.isInstanceAdmin === true) return true;
  const memberships = Array.isArray(value.memberships) ? value.memberships.map(record).filter(Boolean) : [];
  if (memberships.length === 0) return Array.isArray(value.companyIds) && value.companyIds.includes(companyId);
  const membership = memberships.find((entry) => entry!.companyId === companyId && entry!.status === "active");
  if (!membership) return false;
  return membership.membershipRole !== "viewer" && membership.membershipRole != null;
}

/** The repository's state in a few words: ahead and behind its base, and uncommitted files. */
export function branchStateLines(git: ExecutionWorkspaceCloseGitReadiness) {
  const lines: string[] = [];
  if (git.aheadCount != null || git.behindCount != null) {
    const ahead = git.aheadCount ?? 0;
    const behind = git.behindCount ?? 0;
    lines.push(ahead === 0 && behind === 0 ? `Even with ${git.baseRef ?? "its base"}` : `${ahead} ahead, ${behind} behind ${git.baseRef ?? "its base"}`);
  }
  if (git.isMergedIntoBase) lines.push("Merged into its base");
  const dirty = git.dirtyEntryCount;
  const untracked = git.untrackedEntryCount;
  if (dirty || untracked) {
    lines.push([dirty ? `${dirty} uncommitted change${dirty === 1 ? "" : "s"}` : null, untracked ? `${untracked} untracked file${untracked === 1 ? "" : "s"}` : null].filter(Boolean).join(", "));
  } else {
    lines.push("No uncommitted changes");
  }
  return lines;
}
