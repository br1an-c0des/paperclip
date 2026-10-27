import type { BudgetPolicySummary, Goal, Project, ProjectWorkspace } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  addableMembers,
  archivePatch,
  budgetDirty,
  budgetDraft,
  budgetRequests,
  checkoutDirty,
  checkoutDraft,
  checkoutPolicy,
  currentPolicy,
  emptyGoalDraft,
  envDirty,
  envFromRows,
  envProblem,
  envRows,
  gitAuthorizedAs,
  goalDraft,
  goalEdit,
  isOwnerMember,
  isStarred,
  legacyRepositories,
  linkableGoals,
  linkGoalPatch,
  localFolderRequest,
  membershipState,
  nameEdit,
  newEnvRow,
  newGoalPayload,
  newWorkspacePayload,
  parseDollars,
  projectDescriptionEdit,
  projectGoals,
  projectPolicies,
  savedRepositories,
  settingsSection,
  SETTINGS_SECTIONS,
  targetDateEdit,
  targetDateValue,
  unlinkGoalPatch,
  visibilityChange,
  workspaceDraft,
  workspacePatch,
  workspaceProblem,
} from "./settings-model";

const workspace = (over: Partial<ProjectWorkspace> = {}): ProjectWorkspace => ({
  id: "ws-1",
  companyId: "co",
  projectId: "p1",
  name: "trading-workbench",
  sourceType: "local_path",
  cwd: "/code/tw",
  repoUrl: null,
  repoRef: null,
  defaultRef: null,
  visibility: "default",
  setupCommand: null,
  cleanupCommand: null,
  remoteProvider: null,
  remoteWorkspaceRef: null,
  sharedWorkspaceKey: null,
  metadata: null,
  runtimeConfig: null,
  isPrimary: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

const project = (over: Partial<Project> = {}): Project =>
  ({
    id: "p1",
    companyId: "co",
    urlKey: "tw",
    goalId: null,
    goalIds: [],
    goals: [],
    name: "Trading workbench",
    description: null,
    visibility: "open",
    status: "in_progress",
    leadAgentId: null,
    targetDate: null,
    color: null,
    icon: null,
    env: null,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: {
      workspaceId: null,
      repoUrl: null,
      repoRef: null,
      defaultRef: null,
      repoName: null,
      localFolder: null,
      managedFolder: "/managed",
      effectiveLocalFolder: "/managed",
      origin: "managed_checkout",
    },
    workspaces: [],
    primaryWorkspace: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  }) as Project;

const goal = (over: Partial<Goal> = {}): Goal => ({
  id: "g1",
  companyId: "co",
  title: "Ship paper trading",
  description: null,
  level: "task",
  status: "active",
  parentId: null,
  ownerAgentId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

const policy = (over: Partial<BudgetPolicySummary> = {}): BudgetPolicySummary => ({
  policyId: "pol-1",
  companyId: "co",
  scopeType: "project",
  scopeId: "p1",
  scopeName: "Trading workbench",
  metric: "billed_cents",
  windowKind: "calendar_month_utc",
  amount: 30000,
  observedAmount: 14218,
  unpricedEventCount: 0,
  pendingRunCount: 0,
  remainingAmount: 15782,
  utilizationPercent: 47,
  warnPercent: 80,
  hardStopEnabled: true,
  unpricedUsagePolicy: "block",
  notifyEnabled: true,
  isActive: true,
  status: "ok",
  paused: false,
  pauseReason: null,
  windowStart: new Date(0),
  windowEnd: new Date(0),
  ...over,
});

describe("settingsSection", () => {
  it("maps each section's path, with Details at the bare URL", () => {
    expect(settingsSection("")).toBe("details");
    expect(settingsSection("/")).toBe("details");
    expect(settingsSection("general")).toBe("details");
    for (const section of SETTINGS_SECTIONS) expect(settingsSection(section.path)).toBe(section.key);
    expect(settingsSection("budget/")).toBe("budget");
  });

  it("knows nothing else", () => {
    expect(settingsSection("lists")).toBeNull();
  });
});

describe("details edits", () => {
  it("tidies the name and ignores an empty or unchanged one", () => {
    expect(nameEdit("Ops", "  New   name ")).toEqual({ name: "New name" });
    expect(nameEdit("Ops", "   ")).toBeNull();
    expect(nameEdit("Ops", "Ops ")).toBeNull();
  });

  it("clears an emptied description", () => {
    expect(projectDescriptionEdit("Old", "")).toEqual({ description: null });
    expect(projectDescriptionEdit("Old", "Old \n")).toBeNull();
    expect(projectDescriptionEdit(null, "New")).toEqual({ description: "New" });
  });

  it("saves a target date as YYYY-MM-DD, and clears it", () => {
    expect(targetDateValue("2026-12-15T00:00:00.000Z")).toBe("2026-12-15");
    expect(targetDateEdit(null, "2026-12-15")).toEqual({ targetDate: "2026-12-15" });
    expect(targetDateEdit("2026-12-15", "2026-12-15")).toBeNull();
    expect(targetDateEdit("2026-12-15", "")).toEqual({ targetDate: null });
    expect(targetDateEdit(null, "soon")).toBe("invalid");
  });
});

describe("access", () => {
  it("asks before opening a private project, not before making one private", () => {
    expect(visibilityChange("private", "open")).toBe("confirm");
    expect(visibilityChange("open", "private")).toBe("save");
    expect(visibilityChange(undefined, "open")).toBe("none");
  });

  it("treats the privacy owner as the owner member", () => {
    const owned = project({ privacyOwnerUserId: "u1" });
    expect(isOwnerMember(owned, { subjectType: "user", subjectId: "u1" })).toBe(true);
    expect(isOwnerMember(owned, { subjectType: "agent", subjectId: "u1" })).toBe(false);
  });

  it("offers only people and agents who aren't members", () => {
    const candidates = [
      { kind: "user" as const, id: "u1", name: "Brian" },
      { kind: "agent" as const, id: "a1", name: "Quant" },
      { kind: "agent" as const, id: "a2", name: "Engineer" },
    ];
    expect(addableMembers([{ subjectType: "agent", subjectId: "a1" }], candidates).map((c) => c.id)).toEqual(["u1", "a2"]);
  });

  it("reads your membership and star", () => {
    const memberships = { projectMemberships: { p1: "left" as const }, agentMemberships: {}, starredProjectIds: ["p2"], starredDocumentIds: [], documentStarredAt: {}, updatedAt: null };
    expect(membershipState(memberships, "p1")).toBe("left");
    expect(membershipState(memberships, "p2")).toBe("joined");
    expect(membershipState(undefined, "p1")).toBe("joined");
    expect(isStarred(memberships, "p2")).toBe(true);
    expect(isStarred(memberships, "p1")).toBe(false);
  });
});

describe("goals", () => {
  const linked = project({ goalIds: ["g1", "g2"], goals: [{ id: "g1", title: "One" }, { id: "g2", title: "Two" }] });

  it("joins the project's goals with the company's, and splits off archived ones", () => {
    const view = projectGoals(linked, [goal({ id: "g1" }), goal({ id: "g2", status: "cancelled" }), goal({ id: "g3" })]);
    expect(view.open.map((g) => g.id)).toEqual(["g1"]);
    expect(view.archived.map((g) => g.id)).toEqual(["g2"]);
  });

  it("falls back to the project's own titles before the goal list loads", () => {
    expect(projectGoals(linked, undefined).open.map((g) => [g.title, g.loaded])).toEqual([
      ["One", false],
      ["Two", false],
    ]);
  });

  it("reads older projects that only have goalId", () => {
    expect(linkGoalPatch(project({ goalId: "g9" }), "g1")).toEqual({ goalIds: ["g9", "g1"] });
  });

  it("links and unlinks by goalIds", () => {
    expect(linkGoalPatch(linked, "g3")).toEqual({ goalIds: ["g1", "g2", "g3"] });
    expect(linkGoalPatch(linked, "g1")).toBeNull();
    expect(unlinkGoalPatch(linked, "g1")).toEqual({ goalIds: ["g2"] });
    expect(unlinkGoalPatch(linked, "g9")).toBeNull();
  });

  it("offers company goals that aren't linked or archived", () => {
    const goals = [goal({ id: "g1" }), goal({ id: "g3", title: "B" }), goal({ id: "g4", title: "A" }), goal({ id: "g5", status: "cancelled" })];
    expect(linkableGoals(linked, goals).map((g) => g.id)).toEqual(["g4", "g3"]);
  });

  it("creates a goal from the draft, leaving empty fields out", () => {
    expect(newGoalPayload({ ...emptyGoalDraft(), title: "  Ship   it " })).toEqual({ title: "Ship it", status: "planned", level: "task" });
    expect(newGoalPayload({ ...emptyGoalDraft(), title: "Ship", description: "Why", ownerAgentId: "a1" })).toMatchObject({ description: "Why", ownerAgentId: "a1" });
  });

  it("sends only what changed in a goal", () => {
    const current = projectGoals(project({ goalIds: ["g1"] }), [goal({ description: "Old" })]).open[0]!;
    expect(goalEdit(current, goalDraft(current))).toBeNull();
    expect(goalEdit(current, { ...goalDraft(current), title: "New", description: "", status: "achieved" })).toEqual({ title: "New", description: null, status: "achieved" });
  });
});

describe("code", () => {
  const github = workspace({ id: "ws-gh", name: "org/repo", repoUrl: "https://github.com/org/repo", metadata: { githubRepositoryId: "42" } });
  const byUrl = workspace({ id: "ws-url", repoUrl: "https://github.com/org/old", isPrimary: false });

  it("tells GitHub repositories from ones added by URL", () => {
    const p = project({ workspaces: [github, byUrl] });
    expect(savedRepositories(p).map((repo) => repo.id)).toEqual(["42"]);
    expect(legacyRepositories(p).map((ws) => ws.id)).toEqual(["ws-url"]);
  });

  it("sets the local folder on the primary workspace, or creates one", () => {
    expect(localFolderRequest(project(), "/code/tw")).toEqual({ kind: "create", data: { cwd: "/code/tw", sourceType: "local_path", isPrimary: true } });
    const withPrimary = project({ primaryWorkspace: workspace(), codebase: { ...project().codebase, localFolder: "/code/tw" } });
    expect(localFolderRequest(withPrimary, "/code/other")).toMatchObject({ kind: "update", workspaceId: "ws-1" });
    expect(localFolderRequest(withPrimary, "/code/tw")).toEqual({ kind: "none" });
  });

  it("removes the primary workspace when the folder is cleared and there's no repository", () => {
    const withPrimary = project({ primaryWorkspace: workspace(), codebase: { ...project().codebase, localFolder: "/code/tw" } });
    expect(localFolderRequest(withPrimary, "")).toEqual({ kind: "remove", workspaceId: "ws-1" });
    const withRepo = project({ primaryWorkspace: github, codebase: { ...project().codebase, localFolder: "/code/tw", repoUrl: "https://github.com/org/repo" } });
    expect(localFolderRequest(withRepo, "")).toEqual({ kind: "update", workspaceId: "ws-gh", data: { cwd: null, sourceType: "git_repo", isPrimary: true } });
  });

  it("wants a full path for the folder", () => {
    expect(localFolderRequest(project(), "code/tw")).toMatchObject({ kind: "problem" });
    expect(localFolderRequest(project(), "C:\\code")).toMatchObject({ kind: "create" });
  });

  it("checks and builds a new workspace", () => {
    expect(workspaceProblem(workspaceDraft())).toMatch(/folder/);
    expect(workspaceProblem({ ...workspaceDraft(), repoUrl: "not a url" })).toMatch(/URL/);
    expect(workspaceProblem({ ...workspaceDraft(), cwd: "/srv/app" })).toBeNull();
    expect(newWorkspacePayload({ ...workspaceDraft(), repoUrl: "https://github.com/org/repo", repoRef: "main" })).toEqual({
      sourceType: "git_repo",
      repoUrl: "https://github.com/org/repo",
      repoRef: "main",
    });
  });

  it("sends only a workspace's changed fields, clearing emptied ones", () => {
    const ws = workspace({ setupCommand: "pnpm i" });
    expect(workspacePatch(ws, workspaceDraft(ws))).toBeNull();
    expect(workspacePatch(ws, { ...workspaceDraft(ws), setupCommand: "", name: "" })).toEqual({ setupCommand: null });
    expect(workspacePatch(ws, { ...workspaceDraft(ws), repoUrl: "https://github.com/org/repo" })).toEqual({ repoUrl: "https://github.com/org/repo", sourceType: "git_repo" });
  });
});

describe("task checkouts", () => {
  it("reads the effective policy, defaulting to shared checkouts", () => {
    expect(checkoutDraft(project())).toMatchObject({ enabled: false, isolatedByDefault: false, concurrency: "auto", storage: "inherit" });
  });

  it("keeps fields the page doesn't show, and only writes what was picked", () => {
    const p = project({ executionWorkspacePolicy: { enabled: false, branchPolicy: { keep: true } } });
    const draft = { ...checkoutDraft(p), enabled: true };
    expect(checkoutDirty(p, draft)).toBe(true);
    expect(checkoutPolicy(p, draft)).toEqual({ enabled: true, branchPolicy: { keep: true } });
  });

  it("writes the worktree strategy as git_worktree, clearing emptied fields", () => {
    const p = project({ executionWorkspacePolicy: { enabled: true, workspaceStrategy: { type: "git_worktree", baseRef: "origin/main", branchTemplate: "x" } } });
    const policy = checkoutPolicy(p, { ...checkoutDraft(p), branchTemplate: "", teardownCommand: "git worktree prune", isolatedByDefault: true, concurrency: "serialize" });
    expect(policy.defaultMode).toBe("isolated_workspace");
    expect(policy.sharedWorkspaceConcurrency).toBe("serialize");
    expect(policy.workspaceStrategy).toMatchObject({ type: "git_worktree", baseRef: "origin/main", branchTemplate: null, teardownCommand: "git worktree prune" });
  });

  it("sets workspace storage: inherited, core, or a provider", () => {
    const p = project({ executionWorkspacePolicy: { enabled: true, storageProviderPluginId: "plug" } });
    expect(checkoutDraft(p).storage).toBe("plug");
    expect(checkoutPolicy(p, { ...checkoutDraft(p), storage: "core" }).storageProviderPluginId).toBeNull();
    expect("storageProviderPluginId" in checkoutPolicy(p, { ...checkoutDraft(p), storage: "inherit" })).toBe(false);
  });
});

describe("environment variables", () => {
  const env = {
    DATA_DIR: "/data",
    BACKTEST_THREADS: { type: "plain" as const, value: "8" },
    API_KEY: { type: "secret_ref" as const, secretId: "s1", version: 3 as const },
    GH_TOKEN: { type: "user_secret_ref" as const, key: "gh", required: false },
  };

  it("round-trips a saved config unchanged, keeping secret versions", () => {
    const rows = envRows(env);
    expect(rows.map((row) => row.kind)).toEqual(["text", "text", "secret", "user_secret"]);
    expect(envFromRows(rows)).toEqual(env);
    expect(envDirty(env, rows)).toBe(false);
  });

  it("points a changed secret at its latest version", () => {
    const rows = envRows(env).map((row) => (row.name === "API_KEY" ? { ...row, secretId: "s2" } : row));
    expect(envFromRows(rows)?.API_KEY).toEqual({ type: "secret_ref", secretId: "s2", version: "latest" });
    expect(envDirty(env, rows)).toBe(true);
  });

  it("ignores blank rows and saves no variables as an empty object, which the server accepts", () => {
    expect(envFromRows([newEnvRow()])).toEqual({});
    expect(envDirty({}, [])).toBe(false);
    expect(envProblem([newEnvRow()])).toBeNull();
    expect(envDirty(null, [newEnvRow()])).toBe(false);
  });

  it("checks names, duplicates and missing secrets", () => {
    const row = (over: Partial<ReturnType<typeof newEnvRow>>) => ({ ...newEnvRow(), ...over });
    expect(envProblem([row({ value: "x" })])).toMatch(/name/);
    expect(envProblem([row({ name: "1BAD", value: "x" })])).toMatch(/valid name/);
    expect(envProblem([row({ name: "A", value: "1" }), row({ name: "A", value: "2" })])).toMatch(/twice/);
    expect(envProblem([row({ name: "KEY", kind: "secret" })])).toMatch(/secret/);
    expect(envProblem([row({ name: "KEY", kind: "user_secret" })])).toMatch(/personal secret/);
  });
});

describe("budget", () => {
  it("finds the project's spend policies and the one in force", () => {
    const overview = { companyId: "co", policies: [policy(), policy({ scopeId: "p2" }), policy({ scopeType: "agent" })], activeIncidents: [], pausedAgentCount: 0, pausedProjectCount: 0, pendingApprovalCount: 0 };
    expect(projectPolicies(overview, "p1")).toHaveLength(1);
    expect(currentPolicy([policy({ amount: 0, isActive: false }), policy({ windowKind: "lifetime", amount: 500 })])?.windowKind).toBe("lifetime");
    expect(currentPolicy([policy({ amount: 0 })])).toBeNull();
  });

  it("drafts a new budget as monthly, warning at 80% and pausing runs", () => {
    expect(budgetDraft(null)).toEqual({ amount: "", windowKind: "calendar_month_utc", warnPercent: 80, hardStop: true });
    expect(budgetDraft(policy()).amount).toBe("300.00");
  });

  it("parses dollars", () => {
    expect(parseDollars("")).toBe(0);
    expect(parseDollars("$1,200.5")).toBe(120050);
    expect(parseDollars("300")).toBe(30000);
    expect(parseDollars("-5")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("1.234")).toBeNull();
  });

  it("is dirty only when something that would be saved changed", () => {
    expect(budgetDirty(policy(), budgetDraft(policy()))).toBe(false);
    expect(budgetDirty(policy(), { ...budgetDraft(policy()), amount: "300" })).toBe(false);
    expect(budgetDirty(null, { ...budgetDraft(null), windowKind: "lifetime" })).toBe(false);
    expect(budgetDirty(policy(), { ...budgetDraft(policy()), warnPercent: 90 })).toBe(true);
  });

  it("sets a limit, and turns the other window off when switching", () => {
    expect(budgetRequests("p1", [], { ...budgetDraft(null), amount: "300" })).toEqual([
      { scopeType: "project", scopeId: "p1", metric: "billed_cents", windowKind: "calendar_month_utc", amount: 30000, warnPercent: 80, hardStopEnabled: true },
    ]);
    const lifetime = policy({ windowKind: "lifetime", amount: 90000 });
    const requests = budgetRequests("p1", [lifetime], { ...budgetDraft(lifetime), windowKind: "calendar_month_utc", amount: "300" });
    expect(requests.map((request) => [request.windowKind, request.amount])).toEqual([
      ["calendar_month_utc", 30000],
      ["lifetime", 0],
    ]);
  });

  it("turns the budget off with a zero amount, and sends nothing when there's none", () => {
    expect(budgetRequests("p1", [policy()], { ...budgetDraft(policy()), amount: "" })).toEqual([
      { scopeType: "project", scopeId: "p1", metric: "billed_cents", windowKind: "calendar_month_utc", amount: 0 },
    ]);
    expect(budgetRequests("p1", [], budgetDraft(null))).toEqual([]);
    expect(budgetRequests("p1", [], { ...budgetDraft(null), amount: "x" })).toEqual([]);
  });
});

describe("git authorization and archive", () => {
  it("names the authorized account, or says it isn't yours", () => {
    expect(gitAuthorizedAs({ grantId: null, authorizedByUserId: null, options: [] })).toBeNull();
    expect(gitAuthorizedAs({ grantId: "g", authorizedByUserId: "u", options: [{ grantId: "g", login: "brian", connectionName: "GitHub" }] })).toBe("brian · GitHub");
    expect(gitAuthorizedAs({ grantId: "g", authorizedByUserId: "u", options: [] })).toMatch(/isn't yours/);
  });

  it("archives with a timestamp and restores with null", () => {
    expect(archivePatch(true, new Date("2026-10-27T12:00:00Z"))).toEqual({ archivedAt: "2026-10-27T12:00:00.000Z" });
    expect(archivePatch(false)).toEqual({ archivedAt: null });
  });
});
