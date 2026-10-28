import type { ExecutionWorkspaceCloseReadiness, WorkspaceOverviewItem } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { cardActions, groupWorkspaces, readinessSummary, shortPath } from "./workspaces-model";

const item = (overrides: Partial<WorkspaceOverviewItem>): WorkspaceOverviewItem => ({
  key: `execution:${overrides.workspaceId ?? "w"}`,
  kind: "execution_workspace",
  workspaceId: "w",
  workspaceName: "TES-1",
  projectId: null,
  projectUrlKey: null,
  projectName: null,
  mode: "isolated_workspace",
  strategyType: "git_worktree",
  cwd: null,
  branchName: null,
  lastUpdatedAt: new Date("2026-10-01T00:00:00Z"),
  projectWorkspaceId: null,
  executionWorkspaceId: overrides.workspaceId ?? "w",
  executionWorkspaceStatus: "active",
  serviceCount: 0,
  runningServiceCount: 0,
  primaryServiceUrl: null,
  primaryServiceUrlRunning: false,
  primaryService: null,
  hasRuntimeConfig: false,
  linkedIssueCount: 0,
  linkedIssues: [],
  ...overrides,
});

describe("groupWorkspaces", () => {
  it("groups by project, running services first, then the latest used", () => {
    const groups = groupWorkspaces([
      item({ workspaceId: "a", projectId: "p1", projectName: "Alpha", lastUpdatedAt: new Date("2026-10-05T00:00:00Z") }),
      item({ workspaceId: "b", projectId: "p2", projectName: "Beta", runningServiceCount: 1, serviceCount: 1 }),
      item({ workspaceId: "c", lastUpdatedAt: new Date("2026-10-09T00:00:00Z") }),
      item({ workspaceId: "d", projectId: "p1", projectName: "Alpha", executionWorkspaceStatus: "cleanup_failed" }),
    ]);
    expect(groups.map((group) => group.projectName)).toEqual(["Beta", "Task workspaces", "Alpha"]);
    const alpha = groups[2]!;
    expect(alpha.items.map((entry) => entry.workspaceId)).toEqual(["a"]);
    expect(alpha.failed.map((entry) => entry.workspaceId)).toEqual(["d"]);
  });
});

describe("cards", () => {
  it("offers starting or stopping services, and closing or retrying", () => {
    expect(cardActions({ hasRuntimeConfig: true, runningServiceCount: 0, executionWorkspaceStatus: "active" })).toEqual({ services: "start", close: "Close" });
    expect(cardActions({ hasRuntimeConfig: true, runningServiceCount: 2, executionWorkspaceStatus: "idle" })).toEqual({ services: "stop", close: "Close" });
    expect(cardActions({ hasRuntimeConfig: false, runningServiceCount: 0, executionWorkspaceStatus: "cleanup_failed" })).toEqual({ services: null, close: "Retry close" });
    expect(cardActions({ hasRuntimeConfig: false, runningServiceCount: 0, executionWorkspaceStatus: "archived" })).toEqual({ services: null, close: null });
  });

  it("shortens long paths to their last three folders", () => {
    expect(shortPath("/home/me/.paperclip/instances/default/ws/abc")).toBe("…/default/ws/abc");
    expect(shortPath("/tmp/ws")).toBe("/tmp/ws");
  });

  it("sums up the close check", () => {
    const readiness = { state: "blocked", isSharedWorkspace: true, isProjectPrimaryWorkspace: false, git: null } as unknown as ExecutionWorkspaceCloseReadiness;
    expect(readinessSummary(readiness)).toMatchObject({ tone: "red", title: "Can't close yet", detail: expect.stringContaining("shared workspace") });
  });
});
