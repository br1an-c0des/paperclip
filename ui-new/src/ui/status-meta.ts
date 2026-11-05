import type { IssueDisplayStatus, IssuePriority, IssueStatus } from "@paperclipai/shared";

/*
 * The status system (design-system.md, "Status gradients" and "Status system"). Color means state:
 * each task status draws one of the named gradients. Cancelled has no gradient of its own on the
 * boards; it uses Ash, like backlog, and is told apart by its label.
 *
 * Monitoring (since the 2026-11-03 sync, upstream #18624) is a status tasks show but nobody sets:
 * the server reports it as a task's `displayStatus` while an agent's in-progress task waits for its
 * saved monitor's next check, with no run going. The stored `status` stays `in_progress`, and the
 * status picker still reads and sets that. It draws Ion like In progress, as an outline: in
 * progress, but waiting on a schedule, like the boards' dashed scheduled outlines.
 */

export type Gradient = "ion" | "orchid" | "ember" | "flare" | "ash" | "lagoon" | "tide";

/** The tone pills and chips use for a status (design-system.md, "Tones"); neutral has none. */
export type StatusTone = "run" | "violet" | "amber" | "red" | "green" | "neutral";

export const STATUS_META: Record<IssueDisplayStatus, { label: string; gradient: Gradient; tone: StatusTone; hollow?: true }> = {
  in_progress: { label: "In progress", gradient: "ion", tone: "run" },
  monitoring: { label: "Monitoring", gradient: "ion", tone: "run", hollow: true },
  in_review: { label: "In review", gradient: "orchid", tone: "violet" },
  todo: { label: "Todo", gradient: "ember", tone: "amber" },
  blocked: { label: "Blocked", gradient: "flare", tone: "red" },
  backlog: { label: "Backlog", gradient: "ash", tone: "neutral" },
  done: { label: "Done", gradient: "lagoon", tone: "green" },
  cancelled: { label: "Cancelled", gradient: "ash", tone: "neutral" },
};

/** The order groups appear in on the task list (board 1), Monitoring under In progress. */
export const STATUS_ORDER: IssueDisplayStatus[] = [
  "in_progress",
  "monitoring",
  "in_review",
  "todo",
  "blocked",
  "backlog",
  "done",
  "cancelled",
];

/** The status a task shows: the server's display status (Monitoring) when it sends one, else the stored one. */
export function shownStatus(task: { status: string; displayStatus?: IssueDisplayStatus | null }): IssueDisplayStatus {
  const shown = task.displayStatus ?? task.status;
  return (Object.hasOwn(STATUS_META, shown) ? shown : task.status) as IssueDisplayStatus;
}

/** Whether a status can be set, rather than only shown (Monitoring). */
export function isSettable(status: IssueDisplayStatus): status is IssueStatus {
  return status !== "monitoring";
}

export const PRIORITY_META: Record<IssuePriority, { label: string; bars: 1 | 2 | 3; critical?: true }> = {
  critical: { label: "Critical", bars: 3, critical: true },
  high: { label: "High", bars: 3 },
  medium: { label: "Medium", bars: 2 },
  low: { label: "Low", bars: 1 },
};

export function gradientVar(gradient: Gradient) {
  return `var(--g-${gradient})`;
}
