import type { WorkspaceOperationRow } from "@/api/heartbeats";

/*
 * Workspace operations: what Paperclip did to a workspace (`GET /execution-workspaces/:id/
 * workspace-operations`) or to a run's workspace (`GET /heartbeat-runs/:id/workspace-operations`):
 * worktree setup, provisioning, the services and jobs started in it, finalizing and cleanup. Each
 * has its command and folder, git details in its metadata, stdout and stderr excerpts, and a stored
 * log (`GET /workspace-operations/:id/log`). After the old run page's workspace section
 * (ui/src/pages/AgentDetail.tsx, `WorkspaceOperationsSection`).
 */

const PHASES: Record<string, string> = {
  worktree_prepare: "Worktree setup",
  workspace_config_freshness: "Config check",
  workspace_provision: "Provision",
  workspace_seed: "Seed",
  workspace_runtime_provision: "Runtime setup",
  workspace_repair: "Repair",
  workspace_teardown: "Teardown",
  worktree_cleanup: "Worktree cleanup",
  workspace_finalize: "Finalize",
};

export function phaseLabel(phase: string) {
  return PHASES[phase] ?? phase.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase());
}

export const OPERATION_TONE: Record<string, string> = {
  running: "run",
  succeeded: "green",
  failed: "red",
  skipped: "neutral",
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/** The git and cleanup details an operation's metadata carries, as labelled rows. */
export function operationDetails(operation: Pick<WorkspaceOperationRow, "metadata">): { label: string; value: string }[] {
  const metadata = operation.metadata ?? {};
  const rows: { label: string; value: string }[] = [];
  for (const [key, label] of [
    ["branchName", "Branch"],
    ["baseRef", "Base"],
    ["worktreePath", "Worktree"],
    ["repoRoot", "Repository"],
    ["cleanupAction", "Cleanup"],
  ] as const) {
    const value = text(metadata[key]);
    if (value) rows.push({ label, value });
  }
  return rows;
}

/** "Created by this run" or "Reused the workspace", when the metadata says. */
export function createdNote(operation: Pick<WorkspaceOperationRow, "metadata">) {
  const created = operation.metadata?.created;
  return typeof created === "boolean" ? (created ? "Created the workspace" : "Reused the workspace") : null;
}

/** Newest first. */
export function sortOperations<T extends Pick<WorkspaceOperationRow, "startedAt">>(operations: readonly T[]): T[] {
  return [...operations].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

/** Whether there's anything to open beyond the summary line. */
export function hasDetails(operation: WorkspaceOperationRow) {
  return !!(
    operation.command ||
    operation.cwd ||
    operation.stderrExcerpt?.trim() ||
    operation.stdoutExcerpt?.trim() ||
    operation.logRef ||
    operationDetails(operation).length > 0
  );
}
