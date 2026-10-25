import type { IssuePriority, IssueStatus } from "@paperclipai/shared";

/*
 * The status system (design-system.md, "Status gradients" and "Status system"). Color means state:
 * each task status draws one of the named gradients. Cancelled has no gradient of its own on the
 * boards; it uses Ash, like backlog, and is told apart by its label.
 */

export type Gradient = "ion" | "orchid" | "ember" | "flare" | "ash" | "lagoon" | "tide";

export const STATUS_META: Record<IssueStatus, { label: string; gradient: Gradient }> = {
  in_progress: { label: "In progress", gradient: "ion" },
  in_review: { label: "In review", gradient: "orchid" },
  todo: { label: "Todo", gradient: "ember" },
  blocked: { label: "Blocked", gradient: "flare" },
  backlog: { label: "Backlog", gradient: "ash" },
  done: { label: "Done", gradient: "lagoon" },
  cancelled: { label: "Cancelled", gradient: "ash" },
};

/** The order groups appear in on the task list (board 1). */
export const STATUS_ORDER: IssueStatus[] = [
  "in_progress",
  "in_review",
  "todo",
  "blocked",
  "backlog",
  "done",
  "cancelled",
];

export const PRIORITY_META: Record<IssuePriority, { label: string; bars: 1 | 2 | 3; critical?: true }> = {
  critical: { label: "Critical", bars: 3, critical: true },
  high: { label: "High", bars: 3 },
  medium: { label: "Medium", bars: 2 },
  low: { label: "Low", bars: 1 },
};

export function gradientVar(gradient: Gradient) {
  return `var(--g-${gradient})`;
}
