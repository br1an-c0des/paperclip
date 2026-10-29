import type { ActivityEvent, Environment, Project, Routine, RoutineVariable } from "@paperclipai/shared";
import { modeForExisting, type ReusedWorkspace, type WorkspaceMode } from "@/tasks/new-task";

/*
 * Pure logic for the parts of the recurring task's panel that follow the old routine page
 * (ui/src/pages/RoutineDetail.tsx and its components): a Choice input's options, how far a
 * plugin's recurring task has moved from the plugin's defaults, the activity feed, and the
 * workspace and environment Run now sends.
 */

// ---------------------------------------------------------------------------------------------
// Choice inputs (`type: "select"`)

/** The server's limits (`routineVariableSchema`): 1–50 options of 1–120 characters. */
export const MAX_OPTIONS = 50;
export const MAX_OPTION_LENGTH = 120;

/** Options as the server takes them: trimmed, no blanks or repeats, at most 50 of 120 characters. */
export function cleanOptions(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const option = entry.trim().slice(0, MAX_OPTION_LENGTH);
    if (!option || seen.has(option)) continue;
    seen.add(option);
    out.push(option);
    if (out.length === MAX_OPTIONS) break;
  }
  return out;
}

/** One option per line, as the options box takes them. */
export function parseOptionLines(text: string): string[] {
  return cleanOptions(text.split(/\r?\n/));
}

/**
 * The input as a Choice with these options. The default stays only if it's still one of them, since
 * the server refuses any other; none means the input can't be a Choice yet (null).
 */
export function withOptions(variable: RoutineVariable, options: readonly string[]): RoutineVariable | null {
  const cleaned = cleanOptions(options);
  if (cleaned.length === 0) return null;
  const keep = typeof variable.defaultValue === "string" && cleaned.includes(variable.defaultValue);
  return { ...variable, type: "select", options: cleaned, defaultValue: keep ? variable.defaultValue : null };
}

/** The input as another type: options go (only a Choice may have them), and so does the default. */
export function withType(variable: RoutineVariable, type: Exclude<RoutineVariable["type"], "select">): RoutineVariable {
  return { ...variable, type, options: [], defaultValue: null };
}

/** Replaces one input in the list the routine's `PATCH` takes. */
export function replaceVariable(variables: readonly RoutineVariable[], next: RoutineVariable): RoutineVariable[] {
  return variables.map((variable) => (variable.name === next.name ? next : variable));
}

// ---------------------------------------------------------------------------------------------
// Recurring tasks a plugin manages

/**
 * The plugin's defaults that the recurring task no longer matches, by label. The plugin keeps them
 * in `managedByPlugin.defaultsJson` (server/src/services/plugin-managed-routines.ts); the plugin's
 * own page can reset or repair it, so this only says what moved.
 */
type DriftField = "title" | "description" | "priority" | "concurrencyPolicy" | "catchUpPolicy" | "activityGatePolicy" | "activityGateScope";

const DRIFT_FIELDS: [DriftField, string][] = [
  ["title", "title"],
  ["description", "description"],
  ["priority", "priority"],
  ["concurrencyPolicy", "if the last one is still open"],
  ["catchUpPolicy", "missed runs"],
  ["activityGatePolicy", "only when something changed"],
  ["activityGateScope", "where changes count"],
];

export function pluginDefaultDrift(routine: Pick<Routine, DriftField>, defaults: Record<string, unknown> | null | undefined): string[] {
  if (!defaults) return [];
  const changed: string[] = [];
  for (const [field, label] of DRIFT_FIELDS) {
    if (!(field in defaults)) continue;
    const want = defaults[field];
    const have = routine[field];
    const normalize = (value: unknown) => (typeof value === "string" ? value.trim() : (value ?? null));
    if (want === null && field !== "description") continue;
    if (normalize(want) !== normalize(have)) changed.push(label);
  }
  return changed;
}

// ---------------------------------------------------------------------------------------------
// Activity

export type RoutineActivity = Pick<ActivityEvent, "id" | "action" | "actorType" | "actorId" | "agentId" | "details" | "createdAt" | "entityType">;

const ACTION_LABEL: Record<string, string> = {
  "routine.created": "Created",
  "routine.revision_created": "Saved a revision",
  "routine.updated": "Changed",
  "routine.revision_restored": "Restored an older revision",
  "routine.trigger_created": "Added a trigger",
  "routine.trigger_updated": "Changed a trigger",
  "routine.trigger_deleted": "Removed a trigger",
  "routine.trigger_removed": "Removed a trigger",
  "routine.trigger_restored": "Restored a trigger",
  "routine.trigger_setup_finished": "Finished the webhook setup",
  "routine.trigger_secret_rotated": "Replaced the webhook secret",
  "routine.webhook_test_received": "Connection test passed",
  "routine.webhook_test_rejected": "Connection test rejected",
  "routine.webhook_received": "Webhook received",
  "routine.webhook_rejected": "Webhook refused",
  "routine.run_triggered": "Run started",
  "routine.run_created": "Run created",
  "routine.run_skipped": "Run skipped",
  "routine.webhook_ignored": "Webhook ignored",
  "routine.dispatch": "Dispatched",
  "routine.document_annotation_thread_created": "Commented on the description",
  "routine.document_annotation_comment_added": "Replied on the description",
  "routine.document_annotation_thread_resolved": "Resolved a description comment",
  "routine.document_annotation_thread_reopened": "Reopened a description comment",
  "routine.document_annotation_remapped": "Moved a description comment",
};

/** "Run started", or a readable form of an action the list doesn't know. */
export function activityLabel(action: string): string {
  return ACTION_LABEL[action] ?? sentence(action.replace(/^routine[._]/, "").replace(/[._]/g, " "));
}

const SOURCE: Record<string, string> = { schedule: "Schedule", webhook: "Webhook", api: "API", manual: "Run now" };

/** A short line under the action, after the old `RoutineActivityRow`'s summary, in the redesign's words. */
export function activitySummary(event: Pick<RoutineActivity, "action" | "details">): string {
  const details = event.details ?? null;
  switch (event.action) {
    case "routine.webhook_test_received":
      return "No run or task was made";
    case "routine.webhook_test_rejected":
      return "Update the secret in the sending app and send it again";
    case "routine.webhook_received":
      return "Its signature checked out";
    case "routine.webhook_rejected":
      return "Check the secret in the sending app";
  }
  if (!details) return "";
  if (typeof details.changeSummary === "string" && details.changeSummary.trim()) return details.changeSummary.trim();
  if (event.action === "routine.run_triggered") {
    const source = SOURCE[String(details.source ?? "")] ?? "Run";
    const status = String(details.status ?? "");
    return `${source} · ${status === "issue_created" ? "made a task" : status ? status.replace(/_/g, " ") : "started"}`;
  }
  return Object.entries(details)
    .filter(([key, value]) => !/id$/i.test(key) && value !== null && value !== undefined && typeof value !== "object")
    .slice(0, 3)
    .map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase()}: ${String(value)}`)
    .join(" · ");
}

/** Several activity lists as one, without repeats, newest first. */
export function mergeActivity<T extends Pick<RoutineActivity, "id" | "createdAt">>(lists: readonly (readonly T[])[]): T[] {
  const byId = new Map<string, T>();
  for (const list of lists) for (const event of list) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ---------------------------------------------------------------------------------------------
// Run now: workspace and environment

/** Whether Run now can pick an environment: the instance has environments on and the run has a project. */
export function environmentChoiceAvailable(project: Pick<Project, "id"> | null | undefined, environmentsEnabled: boolean) {
  return environmentsEnabled && Boolean(project);
}

/** The environment the project's tasks run in, if it names one. */
export function projectEnvironment(project: Pick<Project, "executionWorkspacePolicy"> | null | undefined, environments: readonly Environment[] | undefined) {
  const id = project?.executionWorkspacePolicy?.environmentId ?? null;
  return id ? environments?.find((environment) => environment.id === id) : undefined;
}

export type RunWorkspaceDraft = {
  /** The project's default, a new worktree, or another task's worktree. */
  workspace: WorkspaceMode;
  reused: ReusedWorkspace | null;
  /** An environment other than the project's; null keeps the project's. */
  environmentId: string | null;
};

function defaultProjectWorkspaceId(project: Pick<Project, "executionWorkspacePolicy" | "workspaces">) {
  return (
    project.executionWorkspacePolicy?.defaultProjectWorkspaceId ??
    project.workspaces?.find((workspace) => workspace.isPrimary)?.id ??
    project.workspaces?.[0]?.id ??
    null
  );
}

/**
 * The fields `POST /routines/:id/run` takes for where the run works, as the old Run now dialog sends
 * them (`RoutineRunVariablesDialog`): only when the workspace choice shows (`workspaces`) or an
 * environment was picked. Empty when the run should simply follow the project.
 */
export function runWorkspacePayload(
  project: Pick<Project, "id" | "executionWorkspacePolicy" | "workspaces"> | null | undefined,
  draft: RunWorkspaceDraft,
  options: { workspaces: boolean },
): Record<string, unknown> {
  if (!project) return {};
  const payload: Record<string, unknown> = {};
  const environment = draft.environmentId ? { environmentId: draft.environmentId } : {};
  if (options.workspaces) {
    if (draft.workspace === "reuse_existing" && draft.reused) {
      payload.executionWorkspacePreference = "reuse_existing";
      payload.executionWorkspaceId = draft.reused.id;
      payload.executionWorkspaceSettings = { mode: modeForExisting(draft.reused.mode), ...environment };
      const workspaceId = draft.reused.projectWorkspaceId ?? defaultProjectWorkspaceId(project);
      if (workspaceId) payload.projectWorkspaceId = workspaceId;
      return payload;
    }
    const mode = draft.workspace === "reuse_existing" ? "shared_workspace" : draft.workspace;
    payload.executionWorkspacePreference = mode;
    payload.executionWorkspaceSettings = { mode, ...environment };
    const workspaceId = defaultProjectWorkspaceId(project);
    if (workspaceId) payload.projectWorkspaceId = workspaceId;
    return payload;
  }
  if (draft.environmentId) payload.executionWorkspaceSettings = { environmentId: draft.environmentId };
  return payload;
}

function sentence(text: string) {
  const trimmed = text.trim();
  return trimmed ? trimmed[0]!.toUpperCase() + trimmed.slice(1) : trimmed;
}
