import type {
  CompactIssue,
  FolderListItem,
  IssueStatus,
  RoutineListItem,
  RoutineRevisionSnapshot,
  RoutineRunSummary,
  RoutineTrigger,
  RoutineVariable,
} from "@paperclipai/shared";
import { STATUS_META, type Gradient } from "@/ui/status-meta";
import { describeCron, formatFire, localTimeZone } from "./schedule";

/*
 * The Recurring view's model (boards R1–R4): routines grouped by folder (or project, or assignee),
 * each with when it runs, its next run and its last result; the tasks each one made, grouped under
 * it; how a run turned out; and what changed between two revisions.
 *
 * An occurrence is an ordinary task the routine made: `originKind: "routine_execution"` and
 * `originId` the routine's id (server/src/services/routines.ts).
 */

export type RecurringGroupBy = "folder" | "project" | "assignee" | "none";

export const RECURRING_GROUP_OPTIONS: { value: RecurringGroupBy; label: string }[] = [
  { value: "folder", label: "Folder" },
  { value: "project", label: "Project" },
  { value: "assignee", label: "Assignee" },
  { value: "none", label: "None" },
];

export type TriggerKind = "schedule" | "webhook" | "api";
export const TRIGGER_KINDS: TriggerKind[] = ["schedule", "webhook", "api"];

export function isOccurrence(task: Pick<CompactIssue, "originKind" | "originId">): boolean {
  return task.originKind === "routine_execution" && Boolean(task.originId);
}

/** Each routine's occurrences, newest first. */
export function occurrencesByRoutine<T extends Pick<CompactIssue, "originKind" | "originId" | "createdAt">>(tasks: readonly T[]): Map<string, T[]> {
  const byRoutine = new Map<string, T[]>();
  for (const task of tasks) {
    if (!isOccurrence(task)) continue;
    const list = byRoutine.get(task.originId!) ?? [];
    list.push(task);
    byRoutine.set(task.originId!, list);
  }
  for (const list of byRoutine.values()) list.sort((a, b) => time(b.createdAt) - time(a.createdAt));
  return byRoutine;
}

function time(value: Date | string | null | undefined) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export type RecurringGroup = { key: string; label: string; folderId: string | null; routines: RoutineListItem[] };

export type RecurringNames = {
  folders: readonly Pick<FolderListItem, "id" | "name" | "position">[];
  project: (id: string) => string | undefined;
  agent: (id: string) => string | undefined;
};

/**
 * Routines in groups, each group's routines by title. By folder, folders keep their order and
 * Unfiled comes last, as in the old Routines page; empty folders still show, so a new folder has
 * somewhere to move things to. Archived routines are left to the caller.
 */
export function groupRoutines(routines: readonly RoutineListItem[], groupBy: RecurringGroupBy, names: RecurringNames): RecurringGroup[] {
  const byTitle = (list: RoutineListItem[]) => list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  if (groupBy === "none") return [{ key: "all", label: "All recurring tasks", folderId: null, routines: byTitle([...routines]) }];

  const keyOf = (routine: RoutineListItem) => {
    if (groupBy === "folder") return routine.folderId ?? "";
    if (groupBy === "project") return routine.projectId ?? "";
    return routine.assigneeAgentId ?? "";
  };
  const buckets = new Map<string, RoutineListItem[]>();
  for (const routine of routines) {
    const key = keyOf(routine);
    buckets.set(key, [...(buckets.get(key) ?? []), routine]);
  }

  if (groupBy === "folder") {
    const folders = [...names.folders].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const known = new Set(folders.map((folder) => folder.id));
    const groups: RecurringGroup[] = folders.map((folder) => ({
      key: folder.id,
      label: folder.name,
      folderId: folder.id,
      routines: byTitle(buckets.get(folder.id) ?? []),
    }));
    // A folder the list doesn't know yet (just made elsewhere) still gets a group.
    for (const [key, list] of buckets) {
      if (key && !known.has(key)) groups.push({ key, label: "Folder", folderId: key, routines: byTitle(list) });
    }
    const unfiled = buckets.get("") ?? [];
    if (unfiled.length > 0 || groups.length === 0) groups.push({ key: "unfiled", label: "Unfiled", folderId: null, routines: byTitle(unfiled) });
    return groups;
  }

  const label = (key: string) =>
    groupBy === "project"
      ? key
        ? (names.project(key) ?? "Unknown project")
        : "No project"
      : key
        ? (names.agent(key) ?? "Unknown agent")
        : "Unassigned";
  return [...buckets.entries()]
    .map(([key, list]) => ({ key: key || "none", label: label(key), folderId: null, routines: byTitle(list) }))
    .sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : a.label.localeCompare(b.label)));
}

/** Matches a search against the title and the description. */
export function matchesSearch(routine: Pick<RoutineListItem, "title" | "description">, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return routine.title.toLowerCase().includes(query) || (routine.description ?? "").toLowerCase().includes(query);
}

type TriggerLike = Pick<RoutineTrigger, "kind" | "enabled" | "cronExpression" | "nextRunAt"> & { setupPending?: boolean };

/** The trigger kinds a routine has, in a fixed order. */
export function triggerKinds(triggers: readonly Pick<RoutineTrigger, "kind">[]): TriggerKind[] {
  const kinds = new Set(triggers.map((trigger) => trigger.kind));
  return TRIGGER_KINDS.filter((kind) => kinds.has(kind));
}

/** When it runs, in words: its schedule, or the other ways it starts. */
export function whenLabel(triggers: readonly TriggerLike[]): string {
  const schedules = triggers.filter((trigger) => trigger.kind === "schedule");
  const live = schedules.filter((trigger) => trigger.enabled);
  const shown = live[0] ?? schedules[0];
  if (shown) {
    const words = describeCron(shown.cronExpression);
    const more = (live.length > 0 ? live.length : schedules.length) - 1;
    return more > 0 ? `${words} +${more} more` : words;
  }
  if (triggers.some((trigger) => trigger.kind === "webhook")) return "When a webhook arrives";
  if (triggers.some((trigger) => trigger.kind === "api")) return "When the API calls it";
  return "Only when run by hand";
}

/** The next run: "Next Mon Oct 26, 09:00", "Paused", or how it starts when it has no schedule. */
export function nextLabel(routine: Pick<RoutineListItem, "status">, triggers: readonly TriggerLike[], timeZone = localTimeZone()): string {
  if (routine.status === "archived") return "Archived";
  if (routine.status !== "active") return "Paused";
  const next = triggers
    .filter((trigger) => trigger.kind === "schedule" && trigger.enabled && trigger.nextRunAt)
    .map((trigger) => new Date(trigger.nextRunAt!))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  if (next) return `Next ${formatFire(next, timeZone)}`;
  if (triggers.some((trigger) => trigger.kind === "webhook" && trigger.enabled && !trigger.setupPending)) return "On each webhook";
  if (triggers.some((trigger) => trigger.kind === "schedule" && trigger.enabled)) return "Waiting for its first run";
  return "No schedule";
}

export type RunSource = "schedule" | "webhook" | "api" | "manual";

export const RUN_SOURCE_LABEL: Record<RunSource, string> = {
  schedule: "Schedule",
  webhook: "Webhook",
  api: "API",
  manual: "Run now",
};

export type RunOutcome = {
  label: string;
  gradient: Gradient;
  /** Breathing, while the task it made is being worked on. */
  live: boolean;
  /** The task it made, or joined. */
  task: { id: string; identifier: string | null; title: string } | null;
  /** True when the run made (or joined) a task; the Runs filter's "Created a task". */
  madeTask: boolean;
  tone: "body" | "muted" | "red" | "run";
};

const SKIP_REASONS: Record<string, string> = {
  no_external_activity: "Skipped, nothing changed",
  issue_assigned: "Skipped, the last one is still open",
  worktree_execution_cutoff: "Skipped, its workspace stopped taking runs",
};

function humanize(reason: string) {
  const words = reason.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How a run turned out (board R3): the task it made and that task's status, or why there's none. */
export function runOutcome(run: Pick<RoutineRunSummary, "status" | "failureReason" | "linkedIssue">): RunOutcome {
  const issue = run.linkedIssue;
  const task = issue ? { id: issue.id, identifier: issue.identifier, title: issue.title } : null;
  switch (run.status) {
    case "issue_created":
    case "completed": {
      const status = (issue?.status ?? "todo") as IssueStatus;
      const meta = STATUS_META[status] ?? STATUS_META.todo;
      return { label: meta.label, gradient: meta.gradient, live: status === "in_progress", task, madeTask: Boolean(issue), tone: status === "in_progress" ? "run" : "body" };
    }
    case "coalesced":
      return {
        label: issue?.identifier ? `Added to ${issue.identifier}, which was still open` : "Added to the open one",
        gradient: "tide",
        live: false,
        task,
        madeTask: Boolean(issue),
        tone: "muted",
      };
    case "skipped": {
      const reason = run.failureReason ? (SKIP_REASONS[run.failureReason] ?? `Skipped: ${humanize(run.failureReason)}`) : "Skipped";
      return { label: reason, gradient: "ash", live: false, task: null, madeTask: false, tone: "muted" };
    }
    case "failed":
      return {
        label: run.failureReason ? `Failed: ${run.failureReason}` : "Failed",
        gradient: "flare",
        live: false,
        task,
        madeTask: false,
        tone: "red",
      };
    default:
      return { label: "Received", gradient: "ion", live: true, task, madeTask: false, tone: "run" };
  }
}

export type RunFilter = "all" | "task" | "none";

export function filterRuns<T extends Pick<RoutineRunSummary, "status" | "failureReason" | "linkedIssue">>(runs: readonly T[], filter: RunFilter): T[] {
  if (filter === "all") return [...runs];
  return runs.filter((run) => runOutcome(run).madeTask === (filter === "task"));
}

/** A description cut into text and `{{placeholder}}` chips (board R2). */
export function placeholderSegments(text: string): { text: string; placeholder: boolean }[] {
  const segments: { text: string; placeholder: boolean }[] = [];
  const matcher = /\{\{\s*[A-Za-z](?:\\_|[A-Za-z0-9_])*\s*\}\}/g;
  let last = 0;
  for (const match of text.matchAll(matcher)) {
    if (match.index! > last) segments.push({ text: text.slice(last, match.index), placeholder: false });
    segments.push({ text: match[0], placeholder: true });
    last = match.index! + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), placeholder: false });
  return segments;
}

export const BUILT_IN_INPUTS: Record<string, string> = {
  date: "The run's date, like 2026-10-26",
  timestamp: "The run's date and time, in UTC",
};

/**
 * The inputs a title and description ask for: each `{{placeholder}}` once, in order, without the
 * built-ins. The server keeps one input per placeholder (`syncRoutineVariablesWithTemplate`); a
 * markdown-escaped `\_` counts as `_`, as it does there.
 */
export function templatePlaceholders(title: string, description: string | null): string[] {
  const names: string[] = [];
  for (const match of `${title}\n${description ?? ""}`.matchAll(/\{\{\s*([A-Za-z](?:\\_|[A-Za-z0-9_])*)\s*\}\}/g)) {
    const name = match[1]!.replace(/\\_/g, "_");
    if (!names.includes(name) && !(name in BUILT_IN_INPUTS)) names.push(name);
  }
  return names;
}

/** The built-in inputs the title or description uses, such as `{{date}}`. */
export function builtInsUsed(title: string, description: string | null): string[] {
  const text = `${title}\n${description ?? ""}`;
  return Object.keys(BUILT_IN_INPUTS).filter((name) => new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`).test(text));
}

export const VARIABLE_TYPE_LABEL: Record<RoutineVariable["type"], string> = {
  text: "Text",
  textarea: "Long text",
  number: "Number",
  boolean: "Yes or no",
  select: "Choice",
  date: "Date",
};

export const CONCURRENCY_LABEL: Record<string, string> = {
  coalesce_if_active: "Add it to the open one",
  skip_if_active: "Skip it",
  always_enqueue: "Create another anyway",
};

export const CATCH_UP_LABEL: Record<string, string> = {
  skip_missed: "Skip them",
  enqueue_missed_with_cap: "Run them, up to a limit",
};

type Names = { agent: (id: string) => string | undefined; project: (id: string) => string | undefined };

function triggerWords(trigger: RoutineRevisionSnapshot["triggers"][number]) {
  if (trigger.kind === "schedule") return `the schedule ${describeCron(trigger.cronExpression)}`;
  if (trigger.kind === "webhook") return trigger.signingMode === "github_hmac" ? "a GitHub webhook" : "a webhook";
  return "an API trigger";
}

/**
 * What changed from one revision to the next (board R4), in sentences: "Schedule: Weekdays at 09:00,
 * was Daily at 09:00", "Assigned to Quant Researcher, was the CEO", "Added a webhook trigger".
 * The first revision is "Created".
 */
export function revisionChanges(previous: RoutineRevisionSnapshot | null, next: RoutineRevisionSnapshot, names: Names): string[] {
  if (!previous) return ["Created"];
  const before = previous.routine;
  const after = next.routine;
  const changes: string[] = [];
  const agent = (id: string | null) => (id ? (names.agent(id) ?? "an agent") : "no one");
  const project = (id: string | null) => (id ? (names.project(id) ?? "a project") : "no project");

  if (before.title !== after.title) changes.push(`Renamed to “${after.title}”`);
  if ((before.description ?? "") !== (after.description ?? "")) changes.push("Rewrote the description");
  if (before.assigneeAgentId !== after.assigneeAgentId) changes.push(`Assigned to ${agent(after.assigneeAgentId)}, was ${agent(before.assigneeAgentId)}`);
  if (before.projectId !== after.projectId) changes.push(`Moved to ${project(after.projectId)}, was ${project(before.projectId)}`);
  if (before.priority !== after.priority) changes.push(`Priority: ${after.priority}, was ${before.priority}`);
  if (before.goalId !== after.goalId) changes.push(after.goalId ? "Changed the goal" : "Removed the goal");
  if (before.parentIssueId !== after.parentIssueId) changes.push(after.parentIssueId ? "Changed the parent task" : "Removed the parent task");
  if (before.status !== after.status) {
    changes.push(after.status === "active" ? "Turned on" : after.status === "paused" ? "Paused" : after.status === "archived" ? "Archived" : `Status: ${after.status}`);
  }
  if (before.concurrencyPolicy !== after.concurrencyPolicy) {
    changes.push(`If the last one is still open: ${CONCURRENCY_LABEL[after.concurrencyPolicy] ?? after.concurrencyPolicy}, was ${CONCURRENCY_LABEL[before.concurrencyPolicy] ?? before.concurrencyPolicy}`);
  }
  if (before.catchUpPolicy !== after.catchUpPolicy) {
    changes.push(`Missed runs: ${CATCH_UP_LABEL[after.catchUpPolicy] ?? after.catchUpPolicy}, was ${CATCH_UP_LABEL[before.catchUpPolicy] ?? before.catchUpPolicy}`);
  }
  if (before.activityGatePolicy !== after.activityGatePolicy || before.activityGateScope !== after.activityGateScope) {
    changes.push(
      after.activityGatePolicy === "require_external_activity"
        ? `Runs only when something changed ${after.activityGateScope === "project" ? "in the project" : "anywhere"}`
        : "Runs whether or not something changed",
    );
  }

  const beforeInputs = new Map(before.variables.map((variable) => [variable.name, variable]));
  const afterInputs = new Map(after.variables.map((variable) => [variable.name, variable]));
  for (const [name, variable] of afterInputs) {
    const old = beforeInputs.get(name);
    if (!old) changes.push(`Added the input ${name}${variable.defaultValue != null && variable.defaultValue !== "" ? `, default ${variable.defaultValue}` : ""}`);
    else if (JSON.stringify(old) !== JSON.stringify(variable)) changes.push(`Changed the input ${name}`);
  }
  for (const name of beforeInputs.keys()) if (!afterInputs.has(name)) changes.push(`Removed the input ${name}`);

  const beforeEnv = Object.keys(before.env ?? {});
  const afterEnv = Object.keys(after.env ?? {});
  for (const key of afterEnv) if (!beforeEnv.includes(key)) changes.push(`Added the secret ${key}`);
  for (const key of beforeEnv) if (!afterEnv.includes(key)) changes.push(`Removed the secret ${key}`);

  const beforeTriggers = new Map(previous.triggers.map((trigger) => [trigger.id, trigger]));
  const afterTriggers = new Map(next.triggers.map((trigger) => [trigger.id, trigger]));
  for (const [id, trigger] of afterTriggers) {
    const old = beforeTriggers.get(id);
    if (!old) {
      changes.push(`Added ${triggerWords(trigger)}`);
      continue;
    }
    if (trigger.kind === "schedule" && (old.cronExpression !== trigger.cronExpression || old.timezone !== trigger.timezone)) {
      changes.push(`Schedule: ${describeCron(trigger.cronExpression)}, was ${describeCron(old.cronExpression)}`);
    }
    if (old.enabled !== trigger.enabled) changes.push(`${trigger.enabled ? "Turned on" : "Turned off"} ${triggerWords(trigger)}`);
    if (old.setupPending && !trigger.setupPending) changes.push(`Finished setting up ${triggerWords(trigger)}`);
    if (old.signingMode !== trigger.signingMode && trigger.kind === "webhook") changes.push("Changed how the webhook is signed");
  }
  for (const [id, trigger] of beforeTriggers) if (!afterTriggers.has(id)) changes.push(`Removed ${triggerWords(trigger)}`);

  return changes;
}
