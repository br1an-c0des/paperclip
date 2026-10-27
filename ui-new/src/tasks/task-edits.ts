import type { Agent, ExecutionWorkspace, Issue, IssueStatus, Project } from "@paperclipai/shared";
import { agentRunDefaults, effortKeyFor, effortOptions, supportsOverrides } from "./new-task";

/*
 * The changes the Details section sends (board 2), each as the `PATCH /issues/:id` body the old UI
 * sends for the same edit (ui/src/components/issue-properties/IssueProperties.tsx and
 * ui/src/pages/IssueDetail.tsx). They go through useTaskUpdates, like the list's inline edits. A
 * builder returns null when there's nothing to send.
 */

export type Patch = Record<string, unknown>;

/** A new title, trimmed. An empty title isn't saved: the field goes back to the old one. */
export function titleEdit(current: string, draft: string): Patch | null {
  const title = draft.replace(/\s+/g, " ").trim();
  return title && title !== current ? { title } : null;
}

/** A new description, without trailing whitespace; an empty one clears it. */
export function descriptionEdit(current: string | null | undefined, draft: string): Patch | null {
  const description = draft.replace(/\s+$/, "");
  if (description === (current ?? "").replace(/\s+$/, "")) return null;
  return { description: description.length > 0 ? description : null };
}

/** A billing code, trimmed; empty clears it. */
export function billingCodeEdit(current: string | null | undefined, draft: string): Patch | null {
  const code = draft.trim();
  const next = code.length > 0 ? code : null;
  return next === (current ?? null) ? null : { billingCode: next };
}

/** The status the step button on the status pill moves to (board 2: "Move to In review"). */
const NEXT_STATUS: Partial<Record<IssueStatus, IssueStatus>> = {
  backlog: "todo",
  todo: "in_progress",
  in_progress: "in_review",
  blocked: "in_progress",
  in_review: "done",
};

export function nextStatus(status: IssueStatus): IssueStatus | null {
  return NEXT_STATUS[status] ?? null;
}

/** "Mark done" shows while the task is still open. */
export function canMarkDone(status: IssueStatus) {
  return status !== "done" && status !== "cancelled";
}

type Blockable = Pick<Issue, "blockedBy"> & { blockedByIssueIds?: string[] };

export function blockerIds(task: Blockable): string[] {
  return task.blockedByIssueIds ?? (task.blockedBy ?? []).map((blocker) => blocker.id);
}

/** Adds or removes one blocker; the server replaces the whole list. */
export function blockersEdit(task: Blockable, id: string, on: boolean): Patch | null {
  const current = blockerIds(task);
  if (on === current.includes(id)) return null;
  return { blockedByIssueIds: on ? [...current, id] : current.filter((each) => each !== id) };
}

// --- Model and effort overrides (decisions 7 and 13) ------------------------------------------

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, each]) => each !== undefined && each !== null && each !== ""));
}

const EFFORT_KEYS = ["effort", "modelReasoningEffort", "reasoningEffort", "variant", "thinking"];

/** The model and effort a task sets for its agent, or nulls for the agent's own. */
export function runOverrides(task: Pick<Issue, "assigneeAdapterOverrides">) {
  const config = record(task.assigneeAdapterOverrides?.adapterConfig);
  const model = typeof config.model === "string" && config.model ? config.model : null;
  const effortValue = EFFORT_KEYS.map((key) => config[key]).find((value) => typeof value === "string" && value);
  return { model, effort: (effortValue as string | undefined) ?? null };
}

/**
 * The overrides after changing the model or the effort, keeping any other adapter options the task
 * has (Claude's Chrome switch, the project-workspace flag). Changing Codex's model drops an effort
 * the new model doesn't offer. Null clears them, so the agent runs on its own settings.
 */
export function runOverridesEdit(
  task: Pick<Issue, "assigneeAdapterOverrides">,
  agent: Pick<Agent, "adapterType" | "adapterConfig">,
  change: { model?: string | null; effort?: string | null },
): Patch | null {
  if (!supportsOverrides(agent.adapterType)) return null;
  const existing = task.assigneeAdapterOverrides ?? null;
  const config = record(existing?.adapterConfig);
  const before = runOverrides(task);
  if ("model" in change) {
    config.model = change.model ?? undefined;
    const model = change.model ?? agentRunDefaults(agent.adapterType, record(agent.adapterConfig)).model;
    if (before.effort && !effortOptions(agent.adapterType, model).some((option) => option.value === before.effort)) {
      for (const key of EFFORT_KEYS) delete config[key];
    }
  }
  if ("effort" in change) {
    for (const key of EFFORT_KEYS) delete config[key];
    const effortKey = effortKeyFor(agent.adapterType);
    if (change.effort && effortKey) config[effortKey] = change.effort;
  }
  const adapterConfig = compact(config);
  const next = compact({
    useProjectWorkspace: existing?.useProjectWorkspace,
    ...(Object.keys(adapterConfig).length > 0 ? { adapterConfig } : {}),
  });
  const value = Object.keys(next).length > 0 ? next : null;
  if (JSON.stringify(value) === JSON.stringify(existing)) return null;
  return { assigneeAdapterOverrides: value };
}

/** "Opus 5.5, high effort", from the overrides and the model list's labels. Null with no overrides. */
export function runSummary(task: Pick<Issue, "assigneeAdapterOverrides">, modelLabel: (id: string) => string = (id) => id) {
  const { model, effort } = runOverrides(task);
  const parts = [model ? modelLabel(model) : null, effort ? `${effort} effort` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

// --- Workspace (ui/src/lib/issue-workspace-selection.ts) ------------------------------------------

export type WorkspaceChoice = "default" | "isolated" | "reuse";

type WorkspaceSource = Pick<Issue, "executionWorkspaceId" | "executionWorkspacePreference" | "executionWorkspaceSettings" | "currentExecutionWorkspace">;

/** Which of the picker's three choices the task is on. */
export function workspaceChoice(task: WorkspaceSource): WorkspaceChoice {
  const persisted = task.currentExecutionWorkspace?.mode ?? task.executionWorkspaceSettings?.mode ?? task.executionWorkspacePreference;
  if (task.executionWorkspaceId && (persisted === "isolated_workspace" || persisted === "operator_branch")) return "reuse";
  if (task.executionWorkspacePreference == null && task.executionWorkspaceSettings == null) return "default";
  const selection = task.executionWorkspacePreference ?? task.executionWorkspaceSettings?.mode;
  return selection === "isolated_workspace" ? "isolated" : selection === "reuse_existing" ? "reuse" : "default";
}

/** The mode a reused workspace is recorded with, after `issueExecutionWorkspaceModeForExistingWorkspace`. */
function modeForExisting(mode: string | null | undefined) {
  if (mode === "isolated_workspace" || mode === "operator_branch" || mode === "shared_workspace") return mode;
  if (mode === "adapter_managed" || mode === "cloud_sandbox") return "agent_default";
  return "shared_workspace";
}

/** The fields that move a task to the project's default, a new isolated workspace, or one it reuses. */
export function workspaceEdit(choice: WorkspaceChoice, workspace?: Pick<ExecutionWorkspace, "id" | "mode">): Patch | null {
  if (choice === "default") return { executionWorkspacePreference: null, executionWorkspaceId: null, executionWorkspaceSettings: null };
  if (choice === "reuse" && !workspace) return null;
  return {
    executionWorkspacePreference: choice === "reuse" ? "reuse_existing" : "isolated_workspace",
    executionWorkspaceId: choice === "reuse" ? workspace!.id : null,
    executionWorkspaceSettings: {
      mode: choice === "reuse" ? modeForExisting(workspace!.mode) : "isolated_workspace",
      environmentId: null,
    },
  };
}

/** The workspace picker shows when the instance and the task's project both have workspaces on. */
export function workspacePickerAvailable(project: Pick<Project, "executionWorkspacePolicy"> | null | undefined, isolatedWorkspacesEnabled: boolean) {
  return isolatedWorkspacesEnabled && project?.executionWorkspacePolicy?.enabled === true;
}

// --- Header actions ------------------------------------------------------------------------------

/** The task as Markdown, as the old "Copy as markdown" makes it. */
export function taskMarkdown(task: Pick<Issue, "identifier" | "title" | "description">) {
  return `# ${task.identifier ? `${task.identifier}: ` : ""}${task.title}\n\n${task.description ?? ""}`.trimEnd();
}

/** The task's address, for Copy link. */
export function taskLink(origin: string, prefix: string, task: Pick<Issue, "id" | "identifier">) {
  return `${origin}/${prefix}/issues/${task.identifier ?? task.id}`;
}

/** What `GET /cli-auth/me` says about you, with the membership roles the old UI reads. */
export type BoardAccess = {
  source: string;
  isInstanceAdmin: boolean;
  companyIds: string[];
  memberships?: { companyId: string; status: string; membershipRole?: string | null }[];
};

/**
 * Who may make a task private or public, after `canManageIssuePrivacy` (ui/src/lib/issuePrivacy.ts):
 * on a local trusted instance everyone; otherwise instance admins, the task's responsible person,
 * creator or assignee, and company owners and admins. The server checks again.
 */
export function canManagePrivacy(
  task: Pick<Issue, "companyId" | "responsibleUserId" | "createdByUserId" | "assigneeUserId">,
  youId: string | null,
  access: BoardAccess | null | undefined,
  localTrusted: boolean,
) {
  if (localTrusted) return true;
  if (!access) return false;
  if (access.source === "local_implicit" || access.isInstanceAdmin) return true;
  if (youId && [task.responsibleUserId, task.createdByUserId, task.assigneeUserId].includes(youId)) return true;
  return (
    access.memberships?.some(
      (member) => member.companyId === task.companyId && member.status === "active" && ["owner", "admin"].includes(member.membershipRole ?? ""),
    ) ?? false
  );
}
