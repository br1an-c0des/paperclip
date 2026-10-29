import type { IssueStatus, IssueSummary } from "@paperclipai/shared";

/*
 * The nav's personal rules, kept apart from the components so they can be tested: the order you
 * gave projects and companies (`GET|PUT /sidebar-preferences/me` and
 * `/companies/:id/sidebar-preferences/me`, as the old sidebar keeps it), which projects show (you can
 * leave a project to drop it from your nav), the tasks you opened lately, and which task a page has
 * open.
 */

/**
 * Items in your order: the ones you placed first, as placed, then the rest in their incoming order
 * (alphabetical, from the list). After ui/src/lib/project-order.ts `sortProjectsByStoredOrder`.
 */
export function inStoredOrder<T extends { id: string }>(items: readonly T[], orderedIds: readonly string[] | undefined): T[] {
  if (!orderedIds?.length) return [...items];
  const rank = new Map(orderedIds.map((id, index) => [id, index] as const));
  const placed = items.filter((item) => rank.has(item.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...placed, ...items.filter((item) => !rank.has(item.id))];
}

/** The ids after moving one up (-1) or down (+1); unchanged at either end. */
export function moveId(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** Projects you haven't left (leaving is personal: it only takes the project out of your nav). */
export function visibleProjects<T extends { id: string }>(projects: readonly T[], memberships: { projectMemberships?: Record<string, string> } | undefined): T[] {
  if (!memberships) return [...projects];
  return projects.filter((project) => memberships.projectMemberships?.[project.id] !== "left");
}

// ---------------------------------------------------------------------------------------------
// Recent tasks

export const RECENT_TASKS_LIMIT = 5;

export type RecentTask = { id: string; identifier: string | null; title: string; status: IssueStatus; at: number };

/** Puts a task you opened at the top, once, keeping the five newest. */
export function recordRecent(list: readonly RecentTask[], task: Omit<RecentTask, "at">, at: number): RecentTask[] {
  return [{ ...task, at }, ...list.filter((entry) => entry.id !== task.id)].slice(0, RECENT_TASKS_LIMIT);
}

/**
 * The list with what the server says now (`GET /companies/:id/issues/summaries`): fresh titles and
 * statuses, and tasks it no longer returns (deleted, or out of your reach) dropped. Before an answer
 * the list stays as it is.
 */
export function refreshRecent(list: readonly RecentTask[], summaries: readonly Pick<IssueSummary, "id" | "identifier" | "title" | "status">[] | undefined): RecentTask[] {
  if (!summaries) return [...list];
  const byId = new Map(summaries.map((summary) => [summary.id, summary] as const));
  return list.flatMap((entry) => {
    const summary = byId.get(entry.id);
    return summary ? [{ ...entry, identifier: summary.identifier, title: summary.title, status: summary.status }] : [];
  });
}

export function parseRecent(raw: string | null): RecentTask[] {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is RecentTask =>
          !!entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.title === "string" && typeof entry.status === "string" && typeof entry.at === "number",
      )
      .slice(0, RECENT_TASKS_LIMIT);
  } catch {
    return [];
  }
}

/** Words an old task address used where a task's identifier goes (`/issues/active`…). */
const LIST_WORDS = new Set(["active", "all", "backlog", "done", "recent"]);

/**
 * The task a page has open: the full task page (`/:prefix/issues/:ref`) or a list's panel
 * (`?task=`). Null on other pages.
 */
export function openTaskRef(pathname: string, search: string, prefix: string): string | null {
  const base = `/${prefix.toLowerCase()}/`;
  const lower = pathname.toLowerCase();
  if (lower.startsWith(base)) {
    const match = /^issues\/([^/]+)/.exec(pathname.slice(base.length));
    if (match && !LIST_WORDS.has(match[1]!.toLowerCase())) return decodeURIComponent(match[1]!);
  }
  const task = new URLSearchParams(search).get("task");
  return task || null;
}
