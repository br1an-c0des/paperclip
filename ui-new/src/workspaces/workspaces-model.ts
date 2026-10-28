import type { ExecutionWorkspaceCloseReadiness, ExecutionWorkspaceStatus, WorkspaceOverviewItem } from "@paperclipai/shared";

/*
 * The Workspaces tab's model (`workspaces/overview`), after ui/src/pages/Workspaces.tsx and
 * ProjectWorkspacesContent.tsx: every workspace grouped by project, projects with running services
 * first, then the most recently used; within a project, workspaces whose cleanup failed come last
 * under their own heading.
 */

export type WorkspaceGroup = {
  projectId: string | null;
  projectName: string;
  projectUrlKey: string | null;
  items: WorkspaceOverviewItem[];
  /** Workspaces whose cleanup failed, shown apart so they get attention. */
  failed: WorkspaceOverviewItem[];
  runningServices: number;
  lastUpdatedAt: number;
};

const time = (value: Date | string) => new Date(value).getTime();

export function groupWorkspaces(items: readonly WorkspaceOverviewItem[]): WorkspaceGroup[] {
  const groups = new Map<string | null, WorkspaceGroup>();
  for (const item of items) {
    let group = groups.get(item.projectId);
    if (!group) {
      group = {
        projectId: item.projectId,
        projectName: item.projectName ?? "Task workspaces",
        projectUrlKey: item.projectUrlKey,
        items: [],
        failed: [],
        runningServices: 0,
        lastUpdatedAt: 0,
      };
      groups.set(item.projectId, group);
    }
    (item.executionWorkspaceStatus === "cleanup_failed" ? group.failed : group.items).push(item);
    group.runningServices += item.runningServiceCount;
    group.lastUpdatedAt = Math.max(group.lastUpdatedAt, time(item.lastUpdatedAt));
  }
  return [...groups.values()].sort(
    (a, b) => b.runningServices - a.runningServices || b.lastUpdatedAt - a.lastUpdatedAt || a.projectName.localeCompare(b.projectName),
  );
}

export const STATUS: Record<ExecutionWorkspaceStatus, { label: string; tone?: "green" | "amber" | "red" }> = {
  active: { label: "Active", tone: "green" },
  idle: { label: "Idle" },
  in_review: { label: "In review", tone: "amber" },
  archived: { label: "Closed" },
  cleanup_failed: { label: "Cleanup failed", tone: "red" },
};

export const MODES: Record<string, string> = {
  shared_workspace: "Shared workspace",
  isolated_workspace: "Isolated worktree",
  operator_branch: "Operator branch",
  adapter_managed: "Managed by the adapter",
  cloud_sandbox: "Cloud sandbox",
};

/** The last three folders of a path, which tell workspaces apart; the full path is in the title. */
export function shortPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length <= 3 ? path : `…/${parts.slice(-3).join("/")}`;
}

/** What the card offers: services when the workspace has a runtime, and closing unless it's closed. */
export function cardActions(item: Pick<WorkspaceOverviewItem, "hasRuntimeConfig" | "runningServiceCount" | "executionWorkspaceStatus">) {
  return {
    services: item.hasRuntimeConfig ? (item.runningServiceCount > 0 ? ("stop" as const) : ("start" as const)) : null,
    close: item.executionWorkspaceStatus === "archived" ? null : item.executionWorkspaceStatus === "cleanup_failed" ? ("Retry close" as const) : ("Close" as const),
  };
}

/** The close check in a sentence, as the old close dialog words it. */
export function readinessSummary(readiness: ExecutionWorkspaceCloseReadiness): { tone: "green" | "amber" | "red"; title: string; detail: string } {
  const tone = readiness.state === "blocked" ? "red" : readiness.state === "ready_with_warnings" ? "amber" : "green";
  const title = readiness.state === "blocked" ? "Can't close yet" : readiness.state === "ready_with_warnings" ? "Can close, with warnings" : "Ready to close";
  const git = readiness.git;
  const detail = readiness.isSharedWorkspace
    ? "This is a shared workspace session. Closing it removes the session but keeps the project's workspace."
    : git?.workspacePath && git.repoRoot && git.workspacePath !== git.repoRoot
      ? "This workspace has its own checkout and can be closed on its own."
      : readiness.isProjectPrimaryWorkspace
        ? "This workspace points at the project's main workspace folder."
        : "This workspace is disposable and can be closed.";
  return { tone, title, detail };
}
