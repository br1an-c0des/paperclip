import type {
  AgentEnvConfig,
  BudgetOverview,
  BudgetPolicySummary,
  BudgetPolicyUpsertInput,
  BudgetWindowKind,
  EnvBinding,
  Goal,
  GoalLevel,
  GoalStatus,
  Project,
  ProjectAccessMember,
  ProjectExecutionWorkspacePolicy,
  ProjectGitAuthorization,
  ProjectStatus,
  ProjectWorkspace,
  ResourceMemberships,
  SharedWorkspaceConcurrency,
} from "@paperclipai/shared";
import type { Gradient } from "@/ui/status-meta";

/*
 * Project settings (boards 10 and 11): the sections and their URLs, and every edit as the request the
 * old UI sends for it (ui/src/pages/ProjectDetail.tsx, components/ProjectProperties.tsx,
 * ProjectAccessMembers.tsx, ProjectRepositories.tsx, ProjectGitAuthorization.tsx, BudgetPolicyCard.tsx,
 * the environment variables editor, and pages/GoalDetail.tsx for goals). Builders return null when
 * there's nothing to send.
 */

export type Patch = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// Sections

export type SettingsSection = "details" | "access" | "goals" | "code" | "git" | "environment" | "budget" | "archive";

/** The section rail, in order. Each section has its own URL under `/projects/:key/settings`. */
export const SETTINGS_SECTIONS: { key: SettingsSection; label: string; path: string }[] = [
  { key: "details", label: "Details", path: "" },
  { key: "access", label: "Members and access", path: "/access" },
  { key: "goals", label: "Goals", path: "/goals" },
  { key: "code", label: "Code and workspaces", path: "/code" },
  { key: "git", label: "Git authorization", path: "/git" },
  { key: "environment", label: "Environment", path: "/environment" },
  { key: "budget", label: "Budget", path: "/budget" },
  { key: "archive", label: "Archive", path: "/archive" },
];

/** The section a settings path names (what follows `settings/`), or null for one that doesn't exist. */
export function settingsSection(rest: string): SettingsSection | null {
  const key = rest.replace(/^\/+|\/+$/g, "");
  if (key === "" || key === "general" || key === "details") return "details";
  return SETTINGS_SECTIONS.find((section) => section.path === `/${key}`)?.key ?? null;
}

// ---------------------------------------------------------------------------------------------
// Details

export const PROJECT_STATUS_OPTIONS: { value: ProjectStatus; label: string; gradient: Gradient }[] = [
  { value: "backlog", label: "Backlog", gradient: "ash" },
  { value: "planned", label: "Planned", gradient: "ember" },
  { value: "in_progress", label: "In progress", gradient: "ion" },
  { value: "completed", label: "Completed", gradient: "lagoon" },
  { value: "cancelled", label: "Cancelled", gradient: "ash" },
];

/** A new name, with its spaces tidied. An empty name isn't saved: the field goes back. */
export function nameEdit(current: string, draft: string): Patch | null {
  const name = draft.replace(/\s+/g, " ").trim();
  return name && name !== current ? { name } : null;
}

/** A new description without trailing whitespace; an empty one clears it. */
export function projectDescriptionEdit(current: string | null | undefined, draft: string): Patch | null {
  const description = draft.replace(/\s+$/, "");
  if (description === (current ?? "").replace(/\s+$/, "")) return null;
  return { description: description.length > 0 ? description : null };
}

/** The saved target date as `YYYY-MM-DD`, for a date input. */
export function targetDateValue(value: string | null | undefined) {
  if (!value) return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1]! : "";
}

/** A new target date (`YYYY-MM-DD`), or empty to clear it. Anything else isn't a date. */
export function targetDateEdit(current: string | null | undefined, draft: string): Patch | null | "invalid" {
  const value = draft.trim();
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "invalid";
  if (value === targetDateValue(current)) return null;
  return { targetDate: value || null };
}

// ---------------------------------------------------------------------------------------------
// Members and access

/**
 * What switching visibility takes. Opening a private project to the company asks first, as the old
 * UI does: members who only had access through it lose access to its private tasks.
 */
export function visibilityChange(current: Project["visibility"], next: "open" | "private"): "none" | "confirm" | "save" {
  const now = current ?? "open";
  if (now === next) return "none";
  return next === "open" ? "confirm" : "save";
}

/** The person who owns a private project: they always have access and can't be removed. */
export function isOwnerMember(project: Pick<Project, "personalOwnerUserId" | "privacyOwnerUserId">, member: Pick<ProjectAccessMember, "subjectType" | "subjectId">) {
  return member.subjectType === "user" && [project.personalOwnerUserId, project.privacyOwnerUserId].includes(member.subjectId);
}

export type Candidate = { kind: "user" | "agent"; id: string; name: string };

/** The people and agents who aren't members yet, people first. */
export function addableMembers(members: readonly Pick<ProjectAccessMember, "subjectType" | "subjectId">[], candidates: readonly Candidate[]) {
  const taken = new Set(members.map((member) => `${member.subjectType}:${member.subjectId}`));
  return candidates.filter((candidate) => !taken.has(`${candidate.kind}:${candidate.id}`));
}

/** Joined unless you've left: membership only decides whether the project shows in your sidebar. */
export function membershipState(memberships: ResourceMemberships | undefined, projectId: string): "joined" | "left" {
  return memberships?.projectMemberships[projectId] === "left" ? "left" : "joined";
}

export function isStarred(memberships: ResourceMemberships | undefined, projectId: string) {
  return memberships?.starredProjectIds?.includes(projectId) ?? false;
}

// ---------------------------------------------------------------------------------------------
// Goals

export const GOAL_STATUS_OPTIONS: { value: GoalStatus; label: string; gradient: Gradient }[] = [
  { value: "planned", label: "Planned", gradient: "ember" },
  { value: "active", label: "Active", gradient: "ion" },
  { value: "achieved", label: "Achieved", gradient: "lagoon" },
  { value: "cancelled", label: "Archived", gradient: "ash" },
];

export const GOAL_LEVEL_OPTIONS: { value: GoalLevel; label: string }[] = [
  { value: "company", label: "Company" },
  { value: "team", label: "Team" },
  { value: "agent", label: "Agent" },
  { value: "task", label: "Task" },
];

/** The ids of the project's goals, in its order; older projects may only have `goalId`. */
export function projectGoalIds(project: Pick<Project, "goalIds" | "goals" | "goalId">): string[] {
  if (project.goalIds?.length) return [...project.goalIds];
  if (project.goals?.length) return project.goals.map((goal) => goal.id);
  return project.goalId ? [project.goalId] : [];
}

export type ProjectGoal = Pick<Goal, "id" | "title" | "description" | "status" | "level" | "ownerAgentId" | "parentId"> & { loaded: boolean };

/**
 * The project's goals with what the company's goal list says about each, split into the ones in
 * play and the archived ones. A goal is archived by cancelling it, as the old UI retires goals:
 * deleting one only removes its row (decision 14).
 */
export function projectGoals(project: Pick<Project, "goalIds" | "goals" | "goalId">, goals: readonly Goal[] | undefined) {
  const byId = new Map((goals ?? []).map((goal) => [goal.id, goal] as const));
  const titles = new Map((project.goals ?? []).map((goal) => [goal.id, goal.title] as const));
  const list: ProjectGoal[] = projectGoalIds(project).map((id) => {
    const goal = byId.get(id);
    if (goal) return { ...goal, loaded: true };
    return { id, title: titles.get(id) ?? "Goal", description: null, status: "planned", level: "task", ownerAgentId: null, parentId: null, loaded: false };
  });
  return { open: list.filter((goal) => goal.status !== "cancelled"), archived: list.filter((goal) => goal.status === "cancelled") };
}

/** Company goals that could be linked to the project: not linked yet, and not archived. */
export function linkableGoals(project: Pick<Project, "goalIds" | "goals" | "goalId">, goals: readonly Goal[] | undefined) {
  const linked = new Set(projectGoalIds(project));
  return (goals ?? []).filter((goal) => !linked.has(goal.id) && goal.status !== "cancelled").sort((a, b) => a.title.localeCompare(b.title));
}

/** Links a goal to the project, after the ones it has. */
export function linkGoalPatch(project: Pick<Project, "goalIds" | "goals" | "goalId">, goalId: string): Patch | null {
  const ids = projectGoalIds(project);
  return ids.includes(goalId) ? null : { goalIds: [...ids, goalId] };
}

/** Takes a goal off the project; the goal itself stays in the company. */
export function unlinkGoalPatch(project: Pick<Project, "goalIds" | "goals" | "goalId">, goalId: string): Patch | null {
  const ids = projectGoalIds(project);
  return ids.includes(goalId) ? { goalIds: ids.filter((id) => id !== goalId) } : null;
}

export type GoalDraft = { title: string; description: string; status: GoalStatus; level: GoalLevel; ownerAgentId: string | null };

/** A new goal starts Planned at task level, as the old new-goal dialog does. */
export function emptyGoalDraft(): GoalDraft {
  return { title: "", description: "", status: "planned", level: "task", ownerAgentId: null };
}

export function goalDraft(goal: ProjectGoal): GoalDraft {
  return { title: goal.title, description: goal.description ?? "", status: goal.status, level: goal.level, ownerAgentId: goal.ownerAgentId };
}

export function goalProblem(draft: GoalDraft): string | null {
  return draft.title.trim() ? null : "Give the goal a title.";
}

/** The create request for `POST /companies/:id/goals`. */
export function newGoalPayload(draft: GoalDraft): Patch {
  const payload: Patch = { title: draft.title.replace(/\s+/g, " ").trim(), status: draft.status, level: draft.level };
  const description = draft.description.trim();
  if (description) payload.description = description;
  if (draft.ownerAgentId) payload.ownerAgentId = draft.ownerAgentId;
  return payload;
}

/** What changed in a goal, as `PATCH /goals/:id` takes it. */
export function goalEdit(goal: ProjectGoal, draft: GoalDraft): Patch | null {
  const patch: Patch = {};
  const title = draft.title.replace(/\s+/g, " ").trim();
  if (title && title !== goal.title) patch.title = title;
  const description = draft.description.replace(/\s+$/, "");
  if (description !== (goal.description ?? "").replace(/\s+$/, "")) patch.description = description || null;
  if (draft.status !== goal.status) patch.status = draft.status;
  if (draft.level !== goal.level) patch.level = draft.level;
  if ((draft.ownerAgentId ?? null) !== (goal.ownerAgentId ?? null)) patch.ownerAgentId = draft.ownerAgentId;
  return Object.keys(patch).length > 0 ? patch : null;
}

// ---------------------------------------------------------------------------------------------
// Code: repositories, the local folder, workspaces

export type SavedRepository = { id: string; fullName: string; url: string; workspaceId: string; isPrimary: boolean };

/** The project's GitHub repositories: workspaces that carry a GitHub repository id. */
export function savedRepositories(project: Pick<Project, "workspaces">): SavedRepository[] {
  return (project.workspaces ?? []).flatMap((workspace) => {
    const id = workspace.metadata?.githubRepositoryId;
    return typeof id === "string" && workspace.repoUrl
      ? [{ id, fullName: workspace.name, url: workspace.repoUrl, workspaceId: workspace.id, isPrimary: workspace.isPrimary }]
      : [];
  });
}

/** Repositories added by URL before the GitHub connection existed; edited as workspaces. */
export function legacyRepositories(project: Pick<Project, "workspaces">): ProjectWorkspace[] {
  return (project.workspaces ?? []).filter((workspace) => workspace.repoUrl && typeof workspace.metadata?.githubRepositoryId !== "string");
}

export function sameIds(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function isAbsolutePath(value: string) {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

export type FolderRequest =
  | { kind: "none" }
  | { kind: "problem"; message: string }
  | { kind: "create"; data: Patch }
  | { kind: "update"; workspaceId: string; data: Patch }
  | { kind: "remove"; workspaceId: string };

/**
 * Setting or clearing the project's local folder, as the old UI's codebase editor does: the folder
 * is the primary workspace's `cwd`. With no folder and no repository left, the primary workspace goes.
 */
export function localFolderRequest(project: Pick<Project, "codebase" | "primaryWorkspace">, draft: string): FolderRequest {
  const cwd = draft.trim() || null;
  if (cwd && !isAbsolutePath(cwd)) return { kind: "problem", message: "Enter the folder's full path, starting with /." };
  if (cwd === (project.codebase?.localFolder ?? null)) return { kind: "none" };
  const repoUrl = project.codebase?.repoUrl ?? null;
  const primary = project.primaryWorkspace;
  if (!cwd && !repoUrl) return primary ? { kind: "remove", workspaceId: primary.id } : { kind: "none" };
  const data: Patch = { cwd, sourceType: repoUrl ? "git_repo" : "local_path", isPrimary: true };
  return primary ? { kind: "update", workspaceId: primary.id, data } : { kind: "create", data };
}

export type WorkspaceDraft = {
  name: string;
  cwd: string;
  repoUrl: string;
  repoRef: string;
  defaultRef: string;
  setupCommand: string;
  cleanupCommand: string;
};

export function workspaceDraft(workspace?: ProjectWorkspace): WorkspaceDraft {
  return {
    name: workspace?.name ?? "",
    cwd: workspace?.cwd ?? "",
    repoUrl: workspace?.repoUrl ?? "",
    repoRef: workspace?.repoRef ?? "",
    defaultRef: workspace?.defaultRef ?? "",
    setupCommand: workspace?.setupCommand ?? "",
    cleanupCommand: workspace?.cleanupCommand ?? "",
  };
}

/** A workspace needs a folder or a repository (`createProjectWorkspaceSchema`). */
export function workspaceProblem(draft: WorkspaceDraft): string | null {
  const cwd = draft.cwd.trim();
  const repoUrl = draft.repoUrl.trim();
  if (!cwd && !repoUrl) return "Enter a folder on the server or a repository URL.";
  if (cwd && !isAbsolutePath(cwd)) return "Enter the folder's full path, starting with /.";
  if (repoUrl) {
    try {
      new URL(repoUrl);
    } catch {
      return "The repository URL isn't a URL.";
    }
  }
  return null;
}

/** The create request for a new workspace. Empty fields are left out. */
export function newWorkspacePayload(draft: WorkspaceDraft): Patch {
  const cwd = draft.cwd.trim();
  const repoUrl = draft.repoUrl.trim();
  const payload: Patch = { sourceType: repoUrl ? "git_repo" : "local_path" };
  const name = draft.name.trim();
  if (name) payload.name = name;
  for (const key of ["repoRef", "defaultRef", "setupCommand", "cleanupCommand"] as const) {
    const value = draft[key].trim();
    if (value) payload[key] = value;
  }
  if (cwd) payload.cwd = cwd;
  if (repoUrl) payload.repoUrl = repoUrl;
  return payload;
}

/** What changed in a workspace; emptied fields are cleared. */
export function workspacePatch(workspace: ProjectWorkspace, draft: WorkspaceDraft): Patch | null {
  const before = workspaceDraft(workspace);
  const patch: Patch = {};
  for (const key of Object.keys(before) as (keyof WorkspaceDraft)[]) {
    const value = draft[key].trim();
    if (value === before[key].trim()) continue;
    if (key === "name") {
      if (value) patch.name = value;
      continue;
    }
    patch[key] = value || null;
  }
  if ("repoUrl" in patch || "cwd" in patch) {
    patch.sourceType = (draft.repoUrl.trim() ? "git_repo" : "local_path") satisfies ProjectWorkspace["sourceType"];
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

// ---------------------------------------------------------------------------------------------
// Task checkouts (the execution workspace policy)

export const CONCURRENCY_OPTIONS: { value: SharedWorkspaceConcurrency; label: string; help: string }[] = [
  { value: "auto", label: "Auto", help: "Runs share the checkout on local and SSH runners, and take turns in cloud environments." },
  { value: "serialize", label: "Take turns", help: "Sandbox runs take turns in the shared checkout. Local and SSH folders still allow runs at once." },
  { value: "allow", label: "At once", help: "Runs never wait for the checkout, so edits can collide." },
];

export type CheckoutDraft = {
  enabled: boolean;
  isolatedByDefault: boolean;
  concurrency: SharedWorkspaceConcurrency;
  /** "" for none. */
  environmentId: string;
  baseRef: string;
  branchTemplate: string;
  worktreeParentDir: string;
  provisionCommand: string;
  runtimeProvisionCommand: string;
  teardownCommand: string;
  /** "inherit" keeps the installed default, "core" is core local storage, else a provider plugin id. */
  storage: string;
};

/** The policy in effect: a workspace provider's effective policy, else the stored one. */
export function effectivePolicy(project: Pick<Project, "executionWorkspacePolicy" | "workspaceProvider">) {
  return project.workspaceProvider?.effectivePolicy ?? project.executionWorkspacePolicy ?? null;
}

export function checkoutDraft(project: Pick<Project, "executionWorkspacePolicy" | "workspaceProvider">): CheckoutDraft {
  const policy = effectivePolicy(project);
  const stored = project.executionWorkspacePolicy;
  const strategy = policy?.workspaceStrategy ?? null;
  return {
    enabled: policy?.enabled === true,
    isolatedByDefault: policy?.defaultMode === "isolated_workspace",
    concurrency: policy?.sharedWorkspaceConcurrency ?? "auto",
    environmentId: policy?.environmentId ?? "",
    baseRef: strategy?.baseRef ?? "",
    branchTemplate: strategy?.branchTemplate ?? "",
    worktreeParentDir: strategy?.worktreeParentDir ?? "",
    provisionCommand: strategy?.provisionCommand ?? "",
    runtimeProvisionCommand: strategy?.runtimeProvisionCommand ?? "",
    teardownCommand: strategy?.teardownCommand ?? "",
    storage: stored?.storageProviderPluginId === null ? "core" : (stored?.storageProviderPluginId ?? "inherit"),
  };
}

export function checkoutDirty(project: Pick<Project, "executionWorkspacePolicy" | "workspaceProvider">, draft: CheckoutDraft) {
  return JSON.stringify(checkoutDraft(project)) !== JSON.stringify(draft);
}

/**
 * The project's new `executionWorkspacePolicy`: the stored policy with the draft laid over it, as the
 * old UI builds it, so fields this page doesn't show are kept. Concurrency is only written once it's
 * been picked; "Auto" is what no value means.
 */
export function checkoutPolicy(project: Pick<Project, "executionWorkspacePolicy" | "workspaceProvider">, draft: CheckoutDraft): ProjectExecutionWorkspacePolicy {
  const stored = project.executionWorkspacePolicy;
  const effective = effectivePolicy(project);
  const policy: ProjectExecutionWorkspacePolicy = { ...(stored ?? {}), enabled: draft.enabled };
  const wasIsolated = effective?.defaultMode === "isolated_workspace";
  if (draft.isolatedByDefault !== wasIsolated || stored?.defaultMode) {
    policy.defaultMode = draft.isolatedByDefault ? "isolated_workspace" : "shared_workspace";
  }
  if (draft.concurrency !== "auto" || stored?.sharedWorkspaceConcurrency) policy.sharedWorkspaceConcurrency = draft.concurrency;
  if (draft.environmentId || stored?.environmentId !== undefined) policy.environmentId = draft.environmentId || null;
  const before = checkoutDraft(project);
  const strategyKeys = ["baseRef", "branchTemplate", "worktreeParentDir", "provisionCommand", "runtimeProvisionCommand", "teardownCommand"] as const;
  if (stored?.workspaceStrategy || strategyKeys.some((key) => draft[key] !== before[key])) {
    const strategy = { ...(effective?.workspaceStrategy ?? {}), ...(stored?.workspaceStrategy ?? {}), type: "git_worktree" as const };
    for (const key of strategyKeys) strategy[key] = draft[key].trim() || null;
    policy.workspaceStrategy = strategy;
  }
  if (draft.storage === "inherit") delete policy.storageProviderPluginId;
  else policy.storageProviderPluginId = draft.storage === "core" ? null : draft.storage;
  return policy;
}

// ---------------------------------------------------------------------------------------------
// Environment variables

export type EnvRowKind = "text" | "secret" | "user_secret";

export type EnvRow = {
  id: string;
  name: string;
  kind: EnvRowKind;
  value: string;
  secretId: string;
  userKey: string;
  /** For a person's secret: whether runs need it to start. */
  required: boolean;
  /** The saved binding, kept as is when the row is unchanged (secret versions and projections). */
  original?: EnvBinding;
};

let rowCounter = 0;
export function newEnvRow(kind: EnvRowKind = "text"): EnvRow {
  rowCounter += 1;
  return { id: `env-${rowCounter}`, name: "", kind, value: "", secretId: "", userKey: "", required: true };
}

/** The editor's rows for a saved config. */
export function envRows(env: AgentEnvConfig | null | undefined): EnvRow[] {
  return Object.entries(env ?? {}).map(([name, binding]) => {
    const row: EnvRow = { ...newEnvRow(), name, original: binding };
    if (typeof binding === "string") return { ...row, value: binding };
    if (binding.type === "plain") return { ...row, value: binding.value ?? "" };
    if (binding.type === "secret_ref") return { ...row, kind: "secret", secretId: binding.secretId ?? "" };
    return { ...row, kind: "user_secret", userKey: binding.key ?? "", required: binding.required !== false };
  });
}

function rowBinding(row: EnvRow): EnvBinding | null {
  const original = row.original;
  if (row.kind === "text") {
    if (typeof original === "string" && original === row.value) return original;
    return { type: "plain", value: row.value };
  }
  if (row.kind === "secret") {
    if (!row.secretId) return null;
    if (original && typeof original === "object" && original.type === "secret_ref" && original.secretId === row.secretId) return original;
    return { type: "secret_ref", secretId: row.secretId, version: "latest" };
  }
  if (!row.userKey) return null;
  if (original && typeof original === "object" && original.type === "user_secret_ref" && original.key === row.userKey) {
    return { ...original, required: row.required };
  }
  return { type: "user_secret_ref", key: row.userKey, version: "latest", required: row.required };
}

/** Rows that are entirely empty are ignored, so an added row left blank doesn't block saving. */
function filled(row: EnvRow) {
  return row.name.trim() || row.value || row.secretId || row.userKey;
}

/** Why the rows can't be saved, or null. */
export function envProblem(rows: readonly EnvRow[]): string | null {
  const seen = new Set<string>();
  for (const row of rows.filter(filled)) {
    const name = row.name.trim();
    if (!name) return "Every variable needs a name.";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `${name} isn't a valid name: use letters, digits and underscores, not starting with a digit.`;
    if (seen.has(name)) return `${name} is set twice.`;
    seen.add(name);
    if (row.kind === "secret" && !row.secretId) return `Pick the secret for ${name}.`;
    if (row.kind === "user_secret" && !row.userKey) return `Pick the personal secret for ${name}.`;
  }
  return null;
}

/**
 * The `env` to save. No variables is an empty object, not null: `PATCH /projects/:id` answers
 * `env: null` with 422 "env must be an object", although `updateProjectSchema` allows it.
 */
export function envFromRows(rows: readonly EnvRow[]): AgentEnvConfig {
  const env: AgentEnvConfig = {};
  for (const row of rows.filter(filled)) {
    const binding = rowBinding(row);
    if (binding !== null) env[row.name.trim()] = binding;
  }
  return env;
}

export function envDirty(env: AgentEnvConfig | null | undefined, rows: readonly EnvRow[]) {
  return JSON.stringify(env ?? {}) !== JSON.stringify(envFromRows(rows));
}

// ---------------------------------------------------------------------------------------------
// Budget

export type BudgetDraft = {
  /** Dollars, as typed. Empty or zero means no budget. */
  amount: string;
  windowKind: BudgetWindowKind;
  warnPercent: number;
  /** Pause the project's agent runs at the limit, or only warn. */
  hardStop: boolean;
};

export const WARN_OPTIONS = [50, 60, 70, 75, 80, 90, 95];

/** The project's spend policies (billed cents), from the company's budget overview. */
export function projectPolicies(overview: BudgetOverview | undefined, projectId: string) {
  return (overview?.policies ?? []).filter((policy) => policy.scopeType === "project" && policy.scopeId === projectId && policy.metric === "billed_cents");
}

/** The policy in force: an active one with a limit, else the latest with a limit. */
export function currentPolicy(policies: readonly BudgetPolicySummary[]) {
  return policies.find((policy) => policy.isActive && policy.amount > 0) ?? policies.find((policy) => policy.amount > 0) ?? null;
}

/** A new budget is monthly (board 10), warns at 80% and pauses runs at the limit, as the server defaults. */
export function budgetDraft(policy: BudgetPolicySummary | null): BudgetDraft {
  return {
    amount: policy && policy.amount > 0 ? (policy.amount / 100).toFixed(2) : "",
    windowKind: policy?.windowKind ?? "calendar_month_utc",
    warnPercent: policy?.warnPercent ?? 80,
    hardStop: policy?.hardStopEnabled ?? true,
  };
}

/** Dollars to cents; empty is zero, and anything negative or not a number is null. */
export function parseDollars(value: string): number | null {
  const text = value.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!text) return 0;
  if (!/^\d+(\.\d{0,2})?$|^\.\d{1,2}$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isFinite(cents) && cents <= 2_147_483_647 ? cents : null;
}

export function budgetProblem(draft: BudgetDraft): string | null {
  return parseDollars(draft.amount) === null ? "Enter the limit in dollars, such as 300 or 300.00." : null;
}

export function budgetDirty(policy: BudgetPolicySummary | null, draft: BudgetDraft) {
  const before = budgetDraft(policy);
  return (
    parseDollars(before.amount) !== parseDollars(draft.amount) ||
    (parseDollars(draft.amount) !== 0 && (before.windowKind !== draft.windowKind || before.warnPercent !== draft.warnPercent || before.hardStop !== draft.hardStop))
  );
}

/**
 * The upserts that save the draft. A policy is one per window, so switching between monthly and
 * lifetime sets the new window's limit, then turns the old one off with a zero amount. A zero limit
 * turns the budget off.
 */
export function budgetRequests(projectId: string, policies: readonly BudgetPolicySummary[], draft: BudgetDraft): BudgetPolicyUpsertInput[] {
  const amount = parseDollars(draft.amount);
  if (amount === null) return [];
  const requests: BudgetPolicyUpsertInput[] = [];
  const scope = { scopeType: "project" as const, scopeId: projectId, metric: "billed_cents" as const };
  const existing = policies.find((policy) => policy.windowKind === draft.windowKind);
  if (amount > 0) {
    requests.push({ ...scope, windowKind: draft.windowKind, amount, warnPercent: draft.warnPercent, hardStopEnabled: draft.hardStop });
  } else if (existing && existing.amount > 0) {
    requests.push({ ...scope, windowKind: draft.windowKind, amount: 0 });
  }
  for (const policy of policies) {
    if (policy.windowKind !== draft.windowKind && policy.amount > 0) requests.push({ ...scope, windowKind: policy.windowKind, amount: 0 });
  }
  return requests;
}

/** "Monthly" or "Lifetime", for the spend line. */
export function windowLabel(windowKind: BudgetWindowKind) {
  return windowKind === "lifetime" ? "So far" : "This month";
}

// ---------------------------------------------------------------------------------------------
// Git authorization and archive

/** Who the project is authorized as: your account's login, or a note when the grant isn't one of yours. */
export function gitAuthorizedAs(data: ProjectGitAuthorization | undefined): string | null {
  if (!data?.grantId) return null;
  const option = data.options.find((entry) => entry.grantId === data.grantId);
  return option ? `${option.login} · ${option.connectionName}` : "an account that isn't yours, or isn't available any more";
}

export function archivePatch(archive: boolean, now: Date = new Date()): Patch {
  return { archivedAt: archive ? now.toISOString() : null };
}
