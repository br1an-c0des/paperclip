import type { IssuePriority, IssueReviewPolicy, IssueStatus, IssueWorkMode, Project } from "@paperclipai/shared";
import { templatePlaceholders } from "@/recurring/recurring-model";
import { isRepeating, repeatProblem, scheduleCron, type RepeatDraft } from "@/recurring/schedule";
import { buildAdapterOverrides } from "./run-overrides";

/*
 * The new-task dialog's model (board 7b): the draft, and the `POST /companies/:id/issues` payload
 * built from it. Every field maps to `createIssueBaseSchema` in packages/shared/src/validators/
 * issue.ts, and the rules follow ui/src/components/NewIssueDialog.tsx:
 *
 * - Reviewer and approver become one-person `review` and `approval` stages in `executionPolicy`
 *   (ui/src/lib/issue-execution-policy.ts). With neither, no policy is sent.
 * - Model and effort overrides use the table in run-overrides.ts, shared with the composer, with
 *   each adapter's effort key; nothing is sent at "Agent default" (decisions 7 and 13).
 * - The workspace choice is sent only when the project has execution workspaces on and the instance
 *   has `enableIsolatedWorkspaces` (decision 12: follows the setting). Reusing another task's
 *   worktree sends that workspace's id, its mode and its project workspace.
 * - Review policy "Anyone approves" is the server's default, sent as nothing.
 * - Tasks have no due date (decision 6).
 *
 * With Repeat on (boards N4–N7) the draft becomes a recurring task: `POST /companies/:id/routines`
 * with the fields a routine copies to each occurrence (title, description, agent, project,
 * priority, goal, parent), then one `POST /routines/:id/triggers` per trigger, as the old Routines
 * page and its trigger setup do. A webhook starts with `setupPending`, so test events only check the
 * connection until it's turned on.
 */

export type Principal = { kind: "agent" | "user"; id: string };

export type WorkspaceMode = "shared_workspace" | "isolated_workspace" | "reuse_existing";

/** The mode a reused workspace is recorded with, after `issueExecutionWorkspaceModeForExistingWorkspace`. */
export function modeForExisting(mode: string | null | undefined) {
  if (mode === "isolated_workspace" || mode === "operator_branch" || mode === "shared_workspace") return mode;
  if (mode === "adapter_managed" || mode === "cloud_sandbox") return "agent_default";
  return "shared_workspace";
}

/** Another task's workspace, picked to reuse (`reuse_existing`). */
export type ReusedWorkspace = { id: string; name: string; mode: string; projectWorkspaceId: string | null };

export type NewTaskDraft = {
  projectId: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  labelIds: string[];
  parentId: string | null;
  goalId: string | null;
  blockedByIssueIds: string[];
  billingCode: string;
  private: boolean;
  title: string;
  description: string;
  assignee: Principal | null;
  /** null: the agent's own setting. */
  model: string | null;
  effort: string | null;
  reviewer: Principal | null;
  approver: Principal | null;
  watchdogAgentId: string | null;
  workMode: Extract<IssueWorkMode, "standard" | "ask" | "planning">;
  workspace: WorkspaceMode;
  /** The workspace to reuse, when `workspace` is "reuse_existing". */
  reuseWorkspace: ReusedWorkspace | null;
  reviewPolicy: IssueReviewPolicy;
  /** "More fields" and assignment roles the user added, in the order they were added. */
  extras: ExtraField[];
  /** Display names for picked tasks and goals ("TRA-41"), so a restored draft can show them. */
  names: Record<string, string>;
  /** Repeat (board N4): null, or how the recurring task repeats. */
  repeat: RepeatDraft | null;
};

export type ExtraField = "parent" | "goal" | "blocked" | "billing" | "private" | "approver" | "watchdog";

export function emptyDraft(overrides: Partial<NewTaskDraft> = {}): NewTaskDraft {
  return {
    projectId: null,
    status: "todo",
    priority: "medium",
    labelIds: [],
    parentId: null,
    goalId: null,
    blockedByIssueIds: [],
    billingCode: "",
    private: false,
    title: "",
    description: "",
    assignee: null,
    model: null,
    effort: null,
    reviewer: null,
    approver: null,
    watchdogAgentId: null,
    workMode: "standard",
    workspace: "shared_workspace",
    reuseWorkspace: null,
    reviewPolicy: "anyone",
    extras: [],
    names: {},
    repeat: null,
    ...overrides,
  };
}

/** True when the draft holds something worth keeping. */
export function draftHasContent(draft: NewTaskDraft) {
  return draft.title.trim().length > 0 || draft.description.trim().length > 0;
}

// Model and effort overrides come from the table New task shares with the composer (decision 13).
export { agentRunDefaults, buildAdapterOverrides, effortKeyFor, effortOptions, OVERRIDE_ADAPTERS, supportsOverrides } from "./run-overrides";
export type { EffortOption } from "./run-overrides";

/** A v4 UUID. `randomUUID` only exists in secure contexts, and the board may be served over plain HTTP. */
export function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function participant(principal: Principal) {
  return {
    id: newId(),
    type: principal.kind,
    agentId: principal.kind === "agent" ? principal.id : null,
    userId: principal.kind === "user" ? principal.id : null,
  };
}

export function buildExecutionPolicy(reviewer: Principal | null, approver: Principal | null) {
  const stages = [];
  if (reviewer) stages.push({ id: newId(), type: "review" as const, approvalsNeeded: 1 as const, participants: [participant(reviewer)] });
  if (approver) stages.push({ id: newId(), type: "approval" as const, approvalsNeeded: 1 as const, participants: [participant(approver)] });
  return stages.length > 0 ? { mode: "normal" as const, commentRequired: true, stages } : null;
}

/** Whether the workspace pill shows: the project has execution workspaces on, and so does the instance. */
export function workspaceChoiceAvailable(project: Pick<Project, "executionWorkspacePolicy"> | null | undefined, isolatedWorkspacesEnabled: boolean) {
  return isolatedWorkspacesEnabled && project?.executionWorkspacePolicy?.enabled === true;
}

/** The project's default workspace mode, after `defaultExecutionWorkspaceModeForProject`. */
export function defaultWorkspaceMode(project: Pick<Project, "executionWorkspacePolicy"> | null | undefined): WorkspaceMode {
  const mode = project?.executionWorkspacePolicy?.enabled ? project.executionWorkspacePolicy.defaultMode : null;
  return mode === "isolated_workspace" ? "isolated_workspace" : "shared_workspace";
}

function defaultProjectWorkspaceId(project: Pick<Project, "executionWorkspacePolicy" | "workspaces">) {
  return (
    project.executionWorkspacePolicy?.defaultProjectWorkspaceId ??
    project.workspaces.find((workspace) => workspace.isPrimary)?.id ??
    project.workspaces[0]?.id ??
    null
  );
}

export type PayloadContext = {
  /** The assignee agent's adapter, for overrides. */
  adapterType: string | null;
  project: Pick<Project, "id" | "executionWorkspacePolicy" | "workspaces"> | null;
  isolatedWorkspacesEnabled: boolean;
  /** Retries of the same submission reuse this, so the server makes one task. */
  idempotencyKey: string;
};

export function buildCreatePayload(draft: NewTaskDraft, context: PayloadContext): Record<string, unknown> {
  const has = (field: ExtraField) => draft.extras.includes(field);
  const payload: Record<string, unknown> = {
    status: draft.status,
    priority: draft.priority,
    workMode: draft.workMode,
    allowDuplicate: true,
    idempotencyKey: context.idempotencyKey,
  };
  const title = draft.title.trim();
  const description = draft.description.trim();
  if (title) payload.title = title;
  if (description) payload.description = description;
  if (draft.projectId) payload.projectId = draft.projectId;
  if (draft.labelIds.length > 0) payload.labelIds = draft.labelIds;
  if (has("parent") && draft.parentId) payload.parentId = draft.parentId;
  if (has("goal") && draft.goalId) payload.goalId = draft.goalId;
  if (has("blocked") && draft.blockedByIssueIds.length > 0) payload.blockedByIssueIds = draft.blockedByIssueIds;
  if (has("billing") && draft.billingCode.trim()) payload.billingCode = draft.billingCode.trim();
  if (has("private") && draft.private) payload.visibility = "private";

  if (draft.assignee?.kind === "agent") {
    payload.assigneeAgentId = draft.assignee.id;
    const overrides = buildAdapterOverrides(context.adapterType, draft.model, draft.effort);
    if (overrides) payload.assigneeAdapterOverrides = overrides;
  } else if (draft.assignee?.kind === "user") {
    payload.assigneeUserId = draft.assignee.id;
  }

  const policy = buildExecutionPolicy(draft.reviewer, has("approver") ? draft.approver : null);
  if (policy) payload.executionPolicy = policy;
  if (has("watchdog") && draft.watchdogAgentId) payload.watchdog = { agentId: draft.watchdogAgentId, instructions: null };
  if (draft.reviewPolicy !== "anyone") payload.reviewPolicy = draft.reviewPolicy;

  if (context.project && workspaceChoiceAvailable(context.project, context.isolatedWorkspacesEnabled)) {
    const reused = draft.workspace === "reuse_existing" ? draft.reuseWorkspace : null;
    if (reused) {
      // Another task's worktree, as the old dialog's "Reuse existing workspace" sends it.
      payload.executionWorkspacePreference = "reuse_existing";
      payload.executionWorkspaceId = reused.id;
      payload.executionWorkspaceSettings = { mode: modeForExisting(reused.mode) };
      const workspaceId = reused.projectWorkspaceId ?? defaultProjectWorkspaceId(context.project);
      if (workspaceId) payload.projectWorkspaceId = workspaceId;
    } else {
      const mode = draft.workspace === "reuse_existing" ? "shared_workspace" : draft.workspace;
      payload.executionWorkspacePreference = mode;
      payload.executionWorkspaceSettings = { mode };
      const workspaceId = defaultProjectWorkspaceId(context.project);
      if (workspaceId) payload.projectWorkspaceId = workspaceId;
    }
  }
  return payload;
}

/** Why the draft can't be created yet, or null. The server needs a title or a description. */
export function draftProblem(draft: NewTaskDraft): string | null {
  if (!draftHasContent(draft)) return "Give the task a title or a description.";
  if (draft.extras.includes("watchdog") && !draft.watchdogAgentId) return "Pick a watchdog agent, or remove the role.";
  if (draft.workspace === "reuse_existing" && !draft.reuseWorkspace) return "Pick the workspace to reuse.";
  return null;
}

/** Whether the draft is a recurring task: Repeat is on, with a schedule or a webhook. */
export function draftRepeats(draft: Pick<NewTaskDraft, "repeat">): boolean {
  return isRepeating(draft.repeat);
}

/** Why a recurring draft can't be created yet, or null. A routine needs a title. */
export function recurringDraftProblem(draft: NewTaskDraft): string | null {
  if (!draft.title.trim()) return "Give the recurring task a title.";
  if (!draft.repeat) return null;
  const problem = repeatProblem(draft.repeat);
  if (problem) return problem;
  const missing = draft.repeat.schedule ? missingDefaults(draft) : [];
  return missing.length > 0 ? `A schedule needs a default for ${missing.join(", ")}.` : null;
}

/** The placeholders a scheduled draft has no default for. */
export function missingDefaults(draft: Pick<NewTaskDraft, "title" | "description" | "repeat">): string[] {
  const defaults = draft.repeat?.defaults ?? {};
  return templatePlaceholders(draft.title, draft.description).filter((name) => !defaults[name]?.trim());
}

/**
 * `POST /companies/:id/routines` for a recurring draft. Only an agent can be its assignee; without
 * one the server saves it paused, as the old UI's drafts.
 */
export function buildRoutinePayload(draft: NewTaskDraft): Record<string, unknown> {
  const has = (field: ExtraField) => draft.extras.includes(field);
  const description = draft.description.trim();
  const defaults = draft.repeat?.defaults ?? {};
  // Each placeholder becomes a required text input with its default, if it has one.
  const variables = templatePlaceholders(draft.title, description).map((name) => ({
    name,
    type: "text",
    defaultValue: defaults[name]?.trim() || null,
    required: true,
  }));
  return {
    title: draft.title.trim(),
    description: description || null,
    projectId: draft.projectId,
    assigneeAgentId: draft.assignee?.kind === "agent" ? draft.assignee.id : null,
    priority: draft.priority,
    goalId: has("goal") ? draft.goalId : null,
    parentIssueId: has("parent") ? draft.parentId : null,
    concurrencyPolicy: draft.repeat?.policy ?? "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    ...(variables.length > 0 ? { variables } : {}),
  };
}

/** The triggers to add once the routine exists: the schedule, then the webhook. */
export function buildTriggerPayloads(repeat: RepeatDraft): Record<string, unknown>[] {
  const triggers: Record<string, unknown>[] = [];
  if (repeat.schedule) triggers.push({ kind: "schedule", cronExpression: scheduleCron(repeat), timezone: repeat.timezone || "UTC" });
  if (repeat.webhook) {
    triggers.push({ kind: "webhook", signingMode: repeat.sender === "github" ? "github_hmac" : "app_webhook", setupPending: true });
  }
  return triggers;
}

const DRAFT_KEY =(companyId: string) => `paperclip.ui-new.new-task-draft.${companyId}`;

export function loadDraft(companyId: string): NewTaskDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(companyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NewTaskDraft>;
    return emptyDraft(parsed);
  } catch {
    return null;
  }
}

export function saveDraft(companyId: string, draft: NewTaskDraft) {
  try {
    if (draftHasContent(draft)) localStorage.setItem(DRAFT_KEY(companyId), JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY(companyId));
  } catch {
    // Storage unavailable: the draft lives only while the dialog is open.
  }
}

export function clearDraft(companyId: string) {
  try {
    localStorage.removeItem(DRAFT_KEY(companyId));
  } catch {
    // Nothing to clear.
  }
}
