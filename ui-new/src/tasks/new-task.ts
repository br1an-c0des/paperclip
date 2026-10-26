import type { IssuePriority, IssueReviewPolicy, IssueStatus, IssueWorkMode, Project } from "@paperclipai/shared";

/*
 * The new-task dialog's model (board 7b): the draft, and the `POST /companies/:id/issues` payload
 * built from it. Every field maps to `createIssueBaseSchema` in packages/shared/src/validators/
 * issue.ts, and the rules follow ui/src/components/NewIssueDialog.tsx:
 *
 * - Reviewer and approver become one-person `review` and `approval` stages in `executionPolicy`
 *   (ui/src/lib/issue-execution-policy.ts). With neither, no policy is sent.
 * - Model and effort overrides apply only to claude_local, codex_local and opencode_local agents,
 *   with each adapter's effort key, and nothing is sent at "Agent default" (decision 7,
 *   ui/src/lib/issue-assignee-overrides.ts).
 * - The workspace choice is sent only when the project has execution workspaces on and the instance
 *   has `enableIsolatedWorkspaces` (decision 12: follows the setting).
 * - Review policy "Anyone approves" is the server's default, sent as nothing.
 * - Tasks have no due date (decision 6).
 */

export type Principal = { kind: "agent" | "user"; id: string };

export type WorkspaceMode = "shared_workspace" | "isolated_workspace";

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
  reviewPolicy: IssueReviewPolicy;
  /** "More fields" and assignment roles the user added, in the order they were added. */
  extras: ExtraField[];
  /** Display names for picked tasks and goals ("TRA-41"), so a restored draft can show them. */
  names: Record<string, string>;
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
    reviewPolicy: "anyone",
    extras: [],
    names: {},
    ...overrides,
  };
}

/** True when the draft holds something worth keeping. */
export function draftHasContent(draft: NewTaskDraft) {
  return draft.title.trim().length > 0 || draft.description.trim().length > 0;
}

/** Adapters whose runs a task can override (decision 7). */
export const OVERRIDE_ADAPTERS = new Set(["claude_local", "codex_local", "opencode_local"]);

export function supportsOverrides(adapterType: string | null | undefined) {
  return !!adapterType && OVERRIDE_ADAPTERS.has(adapterType);
}

export function effortKeyFor(adapterType: string) {
  if (adapterType === "codex_local") return "modelReasoningEffort";
  if (adapterType === "opencode_local") return "variant";
  return "effort";
}

export type EffortOption = { value: string; label: string };

const EFFORT_LABELS: Record<string, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
  ultra: "Ultra",
};

/*
 * Codex's efforts depend on the model (codexLocalReasoningEffortsForModel in
 * packages/adapters/codex-local/src/index.ts). That's runtime code in an adapter package, so it's
 * mirrored here; the upstream sync's typecheck won't catch a change, so check it when the adapter
 * changes.
 */
const CODEX_DEFAULT = ["minimal", "low", "medium", "high", "xhigh"];
const CODEX_MAX = ["low", "medium", "high", "xhigh", "max"];
const CODEX_ULTRA = [...CODEX_MAX, "ultra"];
const CODEX_BY_MODEL: Record<string, string[]> = {
  "gpt-6-astra": CODEX_ULTRA,
  "gpt-6.1-sol": CODEX_ULTRA,
  "gpt-6-sol": CODEX_ULTRA,
  "gpt-5.6-sol": CODEX_ULTRA,
  "gpt-5.6-terra": CODEX_ULTRA,
  "gpt-6-luna": CODEX_MAX,
  "gpt-5.6-luna": CODEX_MAX,
};

const EFFORTS_BY_ADAPTER: Record<string, string[]> = {
  claude_local: ["low", "medium", "high"],
  opencode_local: ["minimal", "low", "medium", "high", "xhigh", "max"],
};

/** The effort choices for an adapter and model, after `thinkingEffortOptionsFor` in the old UI. */
export function effortOptions(adapterType: string, model: string | null): EffortOption[] {
  const values =
    adapterType === "codex_local"
      ? (CODEX_BY_MODEL[(model ?? "").trim().toLowerCase()] ?? CODEX_DEFAULT)
      : (EFFORTS_BY_ADAPTER[adapterType] ?? EFFORTS_BY_ADAPTER.claude_local!);
  return values.map((value) => ({ value, label: EFFORT_LABELS[value] ?? value }));
}

/** The agent's own model and effort, as its adapter config states them. */
export function agentRunDefaults(adapterType: string, adapterConfig: Record<string, unknown>) {
  const read = (key: string) => (typeof adapterConfig[key] === "string" ? (adapterConfig[key] as string) : null);
  const effort =
    adapterType === "codex_local"
      ? (read("modelReasoningEffort") ?? read("reasoningEffort") ?? read("effort"))
      : adapterType === "opencode_local"
        ? read("variant")
        : read("effort");
  return { model: read("model"), effort };
}

export function buildAdapterOverrides(adapterType: string | null | undefined, model: string | null, effort: string | null) {
  if (!adapterType || !supportsOverrides(adapterType)) return null;
  const adapterConfig: Record<string, unknown> = {};
  if (model) adapterConfig.model = model;
  if (effort) adapterConfig[effortKeyFor(adapterType)] = effort;
  return Object.keys(adapterConfig).length > 0 ? { adapterConfig } : null;
}

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
    payload.executionWorkspacePreference = draft.workspace;
    payload.executionWorkspaceSettings = { mode: draft.workspace };
    const workspaceId = defaultProjectWorkspaceId(context.project);
    if (workspaceId) payload.projectWorkspaceId = workspaceId;
  }
  return payload;
}

/** Why the draft can't be created yet, or null. The server needs a title or a description. */
export function draftProblem(draft: NewTaskDraft): string | null {
  if (!draftHasContent(draft)) return "Give the task a title or a description.";
  if (draft.extras.includes("watchdog") && !draft.watchdogAgentId) return "Pick a watchdog agent, or remove the role.";
  return null;
}

const DRAFT_KEY = (companyId: string) => `paperclip.ui-new.new-task-draft.${companyId}`;

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
