import type { AttentionItem, AttentionSourceKind, CompactIssue } from "@paperclipai/shared";
import type { Request, RequestKind } from "@/requests/request-model";

/*
 * The Inbox's view model (board 14), from the attention feed (`GET /companies/:id/attention`):
 *
 * - Tabs. Needs you holds the requests (questions, proposals, approvals, sign-offs, plus join
 *   requests and recovery actions); Alerts holds what broke (failed runs, budget alerts, agent
 *   errors, stuck blockers), as the requests proposal keeps them apart. Snoozed and Cleared hold what
 *   you set aside, from your per-person dismissals. Updates is your tasks, from the task list.
 * - Triage shows at once: a cleared, snoozed or restored item moves tabs before the server answers
 *   (`Pending`), and the next feed puts it where the server says.
 * - Kinds. An item's request kind comes from its card once that has loaded, and from the feed until
 *   then, so the filter counts don't wait on every card.
 * - Keys, after the old Decisions page and Inbox: j/k move, Enter opens the task, y (or x) clears,
 *   s snoozes, a answers, r and Shift+U mark read and unread, u restores.
 * - The aging shelf (decision 39, D5): a request idle past its retention days (30 unless a queue
 *   says otherwise) leaves Needs you for a collapsed "Older than 30 days" group at its bottom, until
 *   you Keep it. The server flags `shelf` whether or not the item is kept, so a kept item counts as
 *   active here. Alerts don't age.
 * - Time: Needs you splits into New today and Earlier, by when each request arrived, most urgent
 *   first within each; Updates groups your tasks by their latest activity (M10). "New" marks what
 *   arrived since you last opened the Inbox (`seen.ts`).
 * - Search narrows the open tab to items whose words match every term typed.
 */

export type InboxTab = "needs" | "updates" | "alerts" | "snoozed" | "cleared";

export const INBOX_TABS: readonly { tab: InboxTab; label: string; path: string }[] = [
  { tab: "needs", label: "Needs you", path: "" },
  { tab: "updates", label: "Updates", path: "updates" },
  { tab: "alerts", label: "Alerts", path: "alerts" },
  { tab: "snoozed", label: "Snoozed", path: "snoozed" },
  { tab: "cleared", label: "Cleared", path: "cleared" },
];

/** The old Inbox's paths, so links into it land on the closest tab. */
const OLD_PATHS: Record<string, InboxTab> = { mine: "updates", recent: "updates", unread: "updates", all: "updates", new: "updates", blocked: "alerts", requests: "needs" };

/** The tab a path under `/inbox/` names: `updates`, `alerts`…, or an old Inbox path. */
export function tabFromPath(rest: string | undefined): InboxTab {
  const segment = (rest ?? "").split("/")[0] ?? "";
  return INBOX_TABS.find((entry) => entry.path === segment && segment !== "")?.tab ?? OLD_PATHS[segment] ?? "needs";
}

/** On the aging shelf: idle past its retention days, and not kept. */
export function onShelf(item: Pick<AttentionItem, "shelf" | "keep">) {
  return item.shelf && !item.keep;
}

const ALERT_SOURCES: ReadonlySet<AttentionSourceKind> = new Set(["failed_run", "budget_alert", "agent_error_alert", "blocker_attention"]);

export function isAlert(item: Pick<AttentionItem, "sourceKind">) {
  return ALERT_SOURCES.has(item.sourceKind);
}

/** A triage step taken here, shown at once while the server catches up. */
export type Pending = { action: "clear" } | { action: "snooze"; until: string } | { action: "restore" };

export type Placement = "active" | "snoozed" | "cleared";

/** An item as a step taken here leaves it, for the cached feed until the server's next feed lands. */
export function withStep(item: AttentionItem, step: Pending, now: Date = new Date()): AttentionItem {
  if (step.action === "restore") return { ...item, dismissal: null, snoozedUntil: null };
  const until = step.action === "snooze" ? step.until : null;
  return {
    ...item,
    dismissal: { kind: step.action === "snooze" ? "snooze" : "dismiss", dismissedAt: now.toISOString(), snoozedUntil: until, isActive: true },
    snoozedUntil: until,
  };
}

/** Where an item sits: in its tab, snoozed, or cleared. A step taken here wins over the feed. */
export function placement(item: Pick<AttentionItem, "dismissal">, pending?: Pending): Placement {
  if (pending?.action === "clear") return "cleared";
  if (pending?.action === "snooze") return "snoozed";
  if (pending?.action === "restore") return "active";
  if (!item.dismissal?.isActive) return "active";
  return item.dismissal.kind === "snooze" ? "snoozed" : "cleared";
}

const SEVERITY: Record<AttentionItem["severity"], number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Most urgent first: the server's rank, then severity, then the latest activity. */
export function byUrgency(a: AttentionItem, b: AttentionItem) {
  return a.rank - b.rank || SEVERITY[a.severity] - SEVERITY[b.severity] || Date.parse(b.activityAt) - Date.parse(a.activityAt);
}

/** When a snoozed item comes back, from a step taken here or the feed. */
export function snoozedUntil(item: Pick<AttentionItem, "dismissal">, pending?: Pending): string | null {
  if (pending?.action === "snooze") return pending.until;
  return item.dismissal?.kind === "snooze" ? item.dismissal.snoozedUntil : null;
}

export type FeedGroups = { needs: AttentionItem[]; aging: AttentionItem[]; alerts: AttentionItem[]; snoozed: AttentionItem[]; cleared: AttentionItem[] };

/**
 * The feed sorted into tabs. Needs you and Alerts are most urgent first, with Needs you's aging
 * requests apart, most recently active first; Snoozed is by when each comes back; Cleared is most
 * recently cleared first.
 */
export function groupFeed(items: readonly AttentionItem[], pending: ReadonlyMap<string, Pending> = new Map()): FeedGroups {
  const groups: FeedGroups = { needs: [], aging: [], alerts: [], snoozed: [], cleared: [] };
  for (const item of items) {
    const where = placement(item, pending.get(item.id));
    if (where === "snoozed") groups.snoozed.push(item);
    else if (where === "cleared") groups.cleared.push(item);
    else if (isAlert(item)) groups.alerts.push(item);
    else if (onShelf(item)) groups.aging.push(item);
    else groups.needs.push(item);
  }
  groups.needs.sort(byUrgency);
  groups.aging.sort((a, b) => Date.parse(b.activityAt) - Date.parse(a.activityAt));
  groups.alerts.sort(byUrgency);
  const until = (item: AttentionItem) => Date.parse(snoozedUntil(item, pending.get(item.id)) ?? "") || Infinity;
  groups.snoozed.sort((a, b) => until(a) - until(b));
  const cleared = (item: AttentionItem) => (pending.get(item.id)?.action === "clear" ? Infinity : Date.parse(item.dismissal?.dismissedAt ?? "") || 0);
  groups.cleared.sort((a, b) => cleared(b) - cleared(a));
  return groups;
}

/** The request kind an item counts as from the feed alone, before its card loads. */
export function feedKind(item: Pick<AttentionItem, "sourceKind" | "subject">): RequestKind {
  switch (item.sourceKind) {
    case "approval":
      return "approval";
    case "review":
      return "signoff";
    case "issue_thread_interaction": {
      const kind = item.subject.metadata?.kind;
      return kind === "suggest_tasks" || kind === "connection_intent" ? "proposal" : "question";
    }
    // Join requests are approved or rejected, as an approval is.
    case "join_request":
      return "approval";
    // Decisions and recovery actions apply something when answered.
    default:
      return "proposal";
  }
}

/** The kind an item is filed under: its card's, once loaded, or the feed's. */
export function itemKind(item: Pick<AttentionItem, "sourceKind" | "subject">, request?: Pick<Request, "kind"> | null): RequestKind {
  return request?.kind ?? feedKind(item);
}

export type KindFilter = "all" | RequestKind;

export const KIND_FILTERS: readonly { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "question", label: "Questions" },
  { value: "proposal", label: "Proposals" },
  { value: "approval", label: "Approvals" },
  { value: "signoff", label: "Sign-offs" },
];

export function kindCounts<T>(items: readonly T[], kindOf: (item: T) => RequestKind): Record<KindFilter, number> {
  const counts: Record<KindFilter, number> = { all: items.length, question: 0, proposal: 0, approval: 0, signoff: 0 };
  for (const item of items) counts[kindOf(item)] += 1;
  return counts;
}

export function filterByKind<T>(items: readonly T[], kind: KindFilter, kindOf: (item: T) => RequestKind): T[] {
  return kind === "all" ? [...items] : items.filter((item) => kindOf(item) === kind);
}

export type InboxKey = "next" | "previous" | "open" | "clear" | "snooze" | "answer" | "read" | "unread" | "restore";

/** The triage action a key stands for, or null. Modifier keys and typing are checked by the caller. */
export function inboxKeyAction(key: string): InboxKey | null {
  switch (key) {
    case "j":
    case "ArrowDown":
      return "next";
    case "k":
    case "ArrowUp":
      return "previous";
    case "Enter":
    case "o":
      return "open";
    case "y":
    case "x":
      return "clear";
    case "s":
      return "snooze";
    case "a":
      return "answer";
    case "r":
      return "read";
    case "U":
      return "unread";
    case "u":
      return "restore";
    default:
      return null;
  }
}

/** The id the cursor moves to: one step along, stopping at the ends; the first or last from nowhere. */
export function stepSelection(ids: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const index = current ? ids.indexOf(current) : -1;
  if (index === -1) return step === 1 ? ids[0]! : ids[ids.length - 1]!;
  return ids[Math.min(Math.max(index + step, 0), ids.length - 1)]!;
}

/** Where the cursor goes when its item leaves the tab: the next one, or the one before at the end. */
export function selectionAfterRemoval(ids: readonly string[], removed: string): string | null {
  const index = ids.indexOf(removed);
  if (index === -1) return null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

const HOUR_MS = 60 * 60 * 1000;

function tomorrowMorning(now: Date) {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next;
}

/** The old UI's snooze choices. `s` takes the first one that isn't "1 hour": tomorrow morning. */
export const SNOOZE_PRESETS: readonly { label: string; until: (now: Date) => Date }[] = [
  { label: "1 hour", until: (now) => new Date(now.getTime() + HOUR_MS) },
  { label: "4 hours", until: (now) => new Date(now.getTime() + 4 * HOUR_MS) },
  { label: "Tomorrow morning", until: tomorrowMorning },
  { label: "Next week", until: (now) => new Date(now.getTime() + 7 * 24 * HOUR_MS) },
];

export const DEFAULT_SNOOZE = SNOOZE_PRESETS[2]!;

/** "Back in 40m", "Back in 3h", "Back in 2d"; "Back soon" once it's due. */
export function snoozeLabel(until: string | null, now: Date = new Date()) {
  const ms = until ? Date.parse(until) - now.getTime() : NaN;
  if (!Number.isFinite(ms) || ms <= 0) return "Back soon";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `Back in ${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Back in ${hours}h`;
  return `Back in ${Math.round(hours / 24)}d`;
}

/** Updates: how many of your tasks have something you haven't seen. */
export function unreadCount(tasks: readonly Pick<CompactIssue, "isUnreadForMe">[] | undefined) {
  return (tasks ?? []).filter((task) => task.isUnreadForMe).length;
}

/** Cleared: the tasks you archived from the inbox, as the full list less the unarchived one. */
export function archivedTasks<T extends Pick<CompactIssue, "id">>(withArchived: readonly T[], unarchived: readonly T[]): T[] {
  const kept = new Set(unarchived.map((task) => task.id));
  return withArchived.filter((task) => !kept.has(task.id));
}

// ---------------------------------------------------------------------------------------------
// Time, search and the aging shelf's label

function startOfDay(at: Date) {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export type TimeGroup<T> = { key: string; label: string; items: T[] };

/** Needs you by when each request arrived: New today, then Earlier. Order within each is kept. */
export function arrivalGroups(items: readonly AttentionItem[], now: Date = new Date()): TimeGroup<AttentionItem>[] {
  const today = startOfDay(now);
  const fresh = items.filter((item) => Date.parse(item.createdAt) >= today);
  const earlier = items.filter((item) => !(Date.parse(item.createdAt) >= today));
  return [
    { key: "today", label: "New today", items: fresh },
    { key: "earlier", label: "Earlier", items: earlier },
  ].filter((group) => group.items.length > 0);
}

/** Updates by latest activity, as M10 groups them: last hour, earlier today, yesterday, this week, older. */
export function activityGroups<T>(items: readonly T[], at: (item: T) => Date | string | null | undefined, now: Date = new Date()): TimeGroup<T>[] {
  const today = startOfDay(now);
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  const yesterday = today - 24 * 60 * 60 * 1000;
  const weekAgo = today - 6 * 24 * 60 * 60 * 1000;
  const groups: TimeGroup<T>[] = [
    { key: "hour", label: "Last hour", items: [] },
    { key: "today", label: "Earlier today", items: [] },
    { key: "yesterday", label: "Yesterday", items: [] },
    { key: "week", label: "Earlier this week", items: [] },
    { key: "older", label: "Older", items: [] },
  ];
  for (const item of items) {
    const raw = at(item);
    const time = raw ? new Date(raw).getTime() : NaN;
    const index = !Number.isFinite(time) ? 4 : time >= hourAgo ? 0 : time >= today ? 1 : time >= yesterday ? 2 : time >= weekAgo ? 3 : 4;
    groups[index]!.items.push(item);
  }
  return groups.filter((group) => group.items.length > 0);
}

/** The search's terms: lower-case words. */
export function searchTerms(query: string) {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether every term is in the text. No terms match everything. */
export function matchesTerms(terms: readonly string[], parts: readonly (string | null | undefined)[]) {
  if (terms.length === 0) return true;
  const text = parts.filter(Boolean).join(" ").toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}

/** The words an item can be found by: its subject, task, why it's here, who raised it, its project. */
export function itemWords(item: AttentionItem): (string | null | undefined)[] {
  const detail = item.detail as { summaryExcerpt?: string | null; promptExcerpt?: string | null; firstQuestionText?: string | null; failureReasonExcerpt?: string | null } | null;
  return [
    item.subject.title,
    item.subject.identifier,
    item.relatedIssue?.title,
    item.relatedIssue?.identifier,
    item.whyNow,
    item.originAgentName,
    item.project?.name,
    detail?.summaryExcerpt,
    detail?.promptExcerpt,
    detail?.firstQuestionText,
    detail?.failureReasonExcerpt,
  ];
}

/** The aging group's heading: "Older than 30 days", or the shortest retention when queues set others. */
export function agingLabel(items: readonly Pick<AttentionItem, "retentionDays">[]) {
  const days = items.length ? Math.min(...items.map((item) => item.retentionDays || 30)) : 30;
  return `Older than ${days} day${days === 1 ? "" : "s"}`;
}

/** Arrived after you last looked, so the card carries "New". */
export function isFresh(item: Pick<AttentionItem, "createdAt">, seenAt: number | null) {
  return seenAt !== null && Date.parse(item.createdAt) > seenAt;
}

/** "at 9:40 am", "yesterday at 6:05 pm", "on Oct 26": when you last looked, for Updates (M10). */
export function lastLookedLabel(at: number, now: Date = new Date()) {
  const date = new Date(at);
  const hours = date.getHours();
  const time = `${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, "0")} ${hours < 12 ? "am" : "pm"}`;
  const today = startOfDay(now);
  if (at >= today) return `at ${time}`;
  if (at >= today - 24 * 60 * 60 * 1000) return `yesterday at ${time}`;
  return `on ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
