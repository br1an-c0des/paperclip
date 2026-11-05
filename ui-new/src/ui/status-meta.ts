import type { IssueBlockerAttention, IssueDisplayStatus, IssuePriority, IssueStatus } from "@paperclipai/shared";

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
 *
 * In queue (since the 2026-11-05 sync, upstream #19329) is a look, not a status: a blocked task
 * whose blockers are all being worked on (`blockerAttention.state` "covered": an active sub-task or
 * dependency) has nothing for anyone to do but wait. It keeps the Blocked label and group, and draws
 * an Ion capsule cut into a stack of three, queued behind the work that's going, in the run tone.
 * Its full label says what it waits on ("Blocked · waiting on active sub-task TES-5"). `statusLook`
 * is the one mapping every task view draws from, after the old UI's lib/task-status-presentation.ts.
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

/** What a task view needs to draw a task's status: what it shows, and its blockers' state. */
export type StatusSource = { status: string; displayStatus?: IssueDisplayStatus | null; blockerAttention?: IssueBlockerAttention | null };

/** How a task's status draws in every view: the capsule or chip, and the words for it. */
export type StatusLook = {
  /** What the task shows (`shownStatus`): the group it's in and its status label. */
  status: IssueDisplayStatus;
  /** Blocked only on work that's going: the "in queue" capsule, in the run tone. */
  queued: boolean;
  /** The short label: "Blocked", "Monitoring". */
  label: string;
  /** All of it, for tooltips and screen readers: "Blocked · waiting on active sub-task TES-5". */
  title: string;
  tone: StatusTone;
};

/** A blocked task covered by active work: an active sub-task or dependency, and nothing stuck. */
export function isQueued(task: StatusSource) {
  return task.status === "blocked" && task.blockerAttention?.state === "covered";
}

/**
 * What a blocked task waits on, worded as the old UI's task-status-presentation.ts
 * (`blockedAttentionLabel`) does. Plain "Blocked" when the server says nothing more.
 */
export function blockedTitle(attention: IssueBlockerAttention | null | undefined) {
  if (!attention || attention.state === "none") return "Blocked";
  const sample = attention.sampleBlockerIdentifier;
  if (attention.reason === "active_child") {
    const count = attention.coveredBlockerCount;
    if (count === 1) return sample ? `Blocked · waiting on active sub-task ${sample}` : "Blocked · waiting on 1 active sub-task";
    if (count > 1) return `Blocked · waiting on ${count} active sub-tasks`;
  }
  if (attention.reason === "active_dependency") {
    const count = attention.coveredBlockerCount;
    if (count === 1) return sample ? `Blocked · covered by active dependency ${sample}` : "Blocked · covered by 1 active dependency";
    if (count > 1) return `Blocked · covered by ${count} active dependencies`;
  }
  if (attention.reason === "stalled_review") {
    const count = attention.stalledBlockerCount;
    const leaf = attention.sampleStalledBlockerIdentifier ?? sample;
    if (count === 1) return leaf ? `Blocked · review stalled on ${leaf}` : "Blocked · review stalled with no clear next step";
    if (count > 1) return `Blocked · ${count} reviews stalled with no clear next step`;
  }
  if (attention.reason === "attention_required") {
    // The server can send a count of 0 (blockers it doesn't name); that reads as plain Blocked.
    const count = attention.attentionBlockerCount || attention.unresolvedBlockerCount;
    if (count > 0) {
      const needs = `${count} ${count === 1 ? "blocker needs" : "blockers need"} attention`;
      const covered = attention.coveredBlockerCount;
      return covered > 0 ? `Blocked · ${needs}; ${covered} covered by active work` : `Blocked · ${needs}`;
    }
  }
  return "Blocked";
}

/** The one status mapping every task view draws from. */
export function statusLook(task: StatusSource): StatusLook {
  const status = shownStatus(task);
  const meta = STATUS_META[status];
  const queued = isQueued(task);
  return {
    status,
    queued,
    label: meta.label,
    title: task.status === "blocked" ? blockedTitle(task.blockerAttention) : meta.label,
    tone: queued ? "run" : meta.tone,
  };
}

/**
 * What the full label adds to the short one, for a note beside the status: "Waiting on active
 * sub-task TES-5". Null when it adds nothing.
 */
export function statusNote(look: Pick<StatusLook, "label" | "title">) {
  if (look.title === look.label) return null;
  const rest = look.title.startsWith(`${look.label} · `) ? look.title.slice(look.label.length + 3) : look.title;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
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
