import type { InstanceExperimentalSettings, IssueBlockerAttention, IssueDisplayStatus, IssueStatus, IssueSummary } from "@paperclipai/shared";

/*
 * The nav's personal rules, kept apart from the components so they can be tested: the order you
 * gave projects and companies (`GET|PUT /sidebar-preferences/me` and
 * `/companies/:id/sidebar-preferences/me`, as the old sidebar keeps it), which projects show (you can
 * leave a project to drop it from your nav), the tasks you opened lately, which task a page has
 * open, which of the nav's switchable entries show, and how the nav folds: full, the icon rail or
 * hidden, by `[`, Shift+`[`, the seam's tab, a drag, or a narrow window.
 */

/** Status (status cards) shows only while the instance has them on; hidden until the settings arrive. */
export function showStatusLink(experimental: Pick<InstanceExperimentalSettings, "enableStatusCards"> | undefined): boolean {
  return experimental?.enableStatusCards === true;
}

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

/**
 * Whether a page is one of this project's (`/:prefix/projects/:key/...`: its dashboard, tasks, board,
 * settings), addressed by its URL key or its id. Its nav row links to the task list but stays raised
 * on all of them.
 */
export function isProjectPage(pathname: string, prefix: string, project: { id: string; urlKey: string }): boolean {
  const base = `/${prefix.toLowerCase()}/projects/`;
  if (!pathname.toLowerCase().startsWith(base)) return false;
  const segment = pathname.slice(base.length).split("/", 1)[0]!;
  let key: string;
  try {
    key = decodeURIComponent(segment).toLowerCase();
  } catch {
    key = segment.toLowerCase();
  }
  return key !== "" && (key === project.urlKey.toLowerCase() || key === project.id.toLowerCase());
}

// ---------------------------------------------------------------------------------------------
// Recent tasks

export const RECENT_TASKS_LIMIT = 5;

/**
 * `displayStatus` is what the summaries say it shows (Monitoring), when they say, and
 * `blockerAttention` the blockers' state on a blocked one (since the 2026-11-05 sync, #19329), so a
 * recent task draws the same capsule as everywhere else.
 */
export type RecentTask = {
  id: string;
  identifier: string | null;
  title: string;
  status: IssueStatus;
  displayStatus?: IssueDisplayStatus | null;
  blockerAttention?: IssueBlockerAttention;
  at: number;
};

/** Puts a task you opened at the top, once, keeping the five newest. */
export function recordRecent(list: readonly RecentTask[], task: Omit<RecentTask, "at">, at: number): RecentTask[] {
  return [{ ...task, at }, ...list.filter((entry) => entry.id !== task.id)].slice(0, RECENT_TASKS_LIMIT);
}

/**
 * The list with what the server says now (`GET /companies/:id/issues/summaries`): fresh titles and
 * statuses, and tasks it no longer returns (deleted, or out of your reach) dropped. Before an answer
 * the list stays as it is.
 */
export function refreshRecent(
  list: readonly RecentTask[],
  summaries: readonly (Pick<IssueSummary, "id" | "identifier" | "title" | "status" | "blockerAttention"> & { displayStatus?: IssueDisplayStatus | null })[] | undefined,
): RecentTask[] {
  if (!summaries) return [...list];
  const byId = new Map(summaries.map((summary) => [summary.id, summary] as const));
  return list.flatMap((entry) => {
    const summary = byId.get(entry.id);
    if (!summary) return [];
    const { blockerAttention: _before, ...rest } = entry;
    return [
      {
        ...rest,
        identifier: summary.identifier,
        title: summary.title,
        status: summary.status,
        displayStatus: summary.displayStatus ?? null,
        ...(summary.blockerAttention ? { blockerAttention: summary.blockerAttention } : {}),
      },
    ];
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

// ---------------------------------------------------------------------------------------------
// The nav's width (you drag its right edge; Shell.tsx)

export const NAV_WIDTH_DEFAULT = 248;
export const NAV_WIDTH_MIN = 200;
export const NAV_WIDTH_MAX = 420;
/**
 * Where there's no rail to fold to (the settings sidebars), dragging this far past the minimum
 * hides the nav, as Shift+`[` does.
 */
export const NAV_COLLAPSE_AT = NAV_WIDTH_MIN - 80;

/** A width the nav can take: whole pixels between the minimum and the maximum. */
export function clampNavWidth(width: number): number {
  if (!Number.isFinite(width)) return NAV_WIDTH_DEFAULT;
  return Math.round(Math.min(NAV_WIDTH_MAX, Math.max(NAV_WIDTH_MIN, width)));
}

/** A saved width, or the default when there's none or it isn't a number. */
export function parseNavWidth(raw: unknown): number {
  return typeof raw === "number" ? clampNavWidth(raw) : NAV_WIDTH_DEFAULT;
}

// ---------------------------------------------------------------------------------------------
// Full, rail or hidden (NavRail.tsx; nav-prefs.tsx keeps the state, Shell.tsx draws it)

/** The nav with labels, or folded to its icons. */
export type NavMode = "full" | "rail";

/**
 * What the nav remembers, and what it shows for now:
 *
 * - `mode`: full or rail, saved per browser.
 * - `hidden`: the nav hidden entirely (Shift+`[`), saved per browser; it comes back as it was.
 * - `override`: while the window is too narrow for the full nav it shows the rail by itself; `[`
 *   (or the seam) then switches it for as long as the window stays narrow, without touching
 *   `mode`. With room again, the saved `mode` is back.
 */
export type NavFold = { mode: NavMode; hidden: boolean; override: NavMode | null };

/** The rail's width: the nav's padding either side of a 40px column of icons (NavRail.css). */
export const NAV_RAIL_WIDTH = 68;
/** Narrower than this (and wider than a phone, where the dock takes over), the nav shows as the rail. */
export const NAV_AUTO_RAIL_BELOW = 1100;
/** A drag that leaves the nav narrower than this hides it, from the full nav or the rail. */
export const NAV_HIDE_BELOW = 40;
/** Dragging the rail's edge past this width opens the full nav. */
export const NAV_RAIL_OPEN_AT = 140;

/** Whether a window this wide shows the rail by itself (the phone breakpoint is the shell's). */
export function autoRail(windowWidth: number): boolean {
  return windowWidth < NAV_AUTO_RAIL_BELOW;
}

/** A saved mode, or full when there's none or it isn't one. */
export function parseNavMode(raw: unknown): NavMode {
  return raw === "rail" ? "rail" : "full";
}

/** Full or rail, as the nav shows now (whether it's hidden is `fold.hidden`). */
export function shownNavMode(fold: NavFold, narrow: boolean): NavMode {
  return narrow ? (fold.override ?? "rail") : fold.mode;
}

/** Shows the nav as `mode`: saved, or while the window is narrow, only until it's wide again. */
export function setNavFoldMode(fold: NavFold, narrow: boolean, mode: NavMode): NavFold {
  return narrow ? { ...fold, hidden: false, override: mode } : { mode, hidden: false, override: null };
}

/** `[`: full to rail and back. A hidden nav comes back instead, as you left it. */
export function toggleNavRail(fold: NavFold, narrow: boolean): NavFold {
  if (fold.hidden) return { ...fold, hidden: false };
  return setNavFoldMode(fold, narrow, shownNavMode(fold, narrow) === "rail" ? "full" : "rail");
}

/** Shift+`[`: hides the nav, or shows it again as it was. */
export function toggleNavHidden(fold: NavFold): NavFold {
  return { ...fold, hidden: !fold.hidden };
}

/** The window crossed the threshold: a switch made while it was narrow lasts only until then. */
export function navRoomChanged(fold: NavFold): NavFold {
  return fold.override === null ? fold : { ...fold, override: null };
}

/** What letting go of the nav's edge does: a new width, the rail, the full nav, hidden, or nothing. */
export type NavDrop = { kind: "width"; width: number } | { kind: "rail" } | { kind: "full" } | { kind: "hide" } | { kind: "none" };

/**
 * The end of a drag of the nav's edge, by the width it was dragged to. From the full nav: under the
 * narrowest width it snaps to the rail, and well past that, under 40px, it hides. From the rail:
 * past 140px it opens the full nav (at its last width), and under 40px it hides. Without a rail (the
 * settings sidebars) it hides past `NAV_COLLAPSE_AT`, as before the rail.
 */
export function navDrop(from: NavMode, width: number, canRail = true): NavDrop {
  if (!Number.isFinite(width)) return { kind: "none" };
  if (!canRail) return width < NAV_COLLAPSE_AT ? { kind: "hide" } : { kind: "width", width: clampNavWidth(width) };
  if (width < NAV_HIDE_BELOW) return { kind: "hide" };
  if (from === "rail") return width > NAV_RAIL_OPEN_AT ? { kind: "full" } : { kind: "none" };
  return width < NAV_WIDTH_MIN ? { kind: "rail" } : { kind: "width", width: clampNavWidth(width) };
}

/** What letting go now would do, while the edge is dragged, when it isn't a new width. */
export function navDragHint(from: NavMode, width: number, canRail = true): "rail" | "full" | "hide" | null {
  const drop = navDrop(from, width, canRail);
  return drop.kind === "rail" || drop.kind === "full" || drop.kind === "hide" ? drop.kind : null;
}

/**
 * A key on the focused edge (arrows, Shift for bigger steps, Home and End): a new width, or past
 * the narrowest width the rail; from the rail, → or End opens the full nav.
 */
export function navKeyDrop(from: NavMode, width: number, key: string, shift: boolean, canRail = true): NavDrop | null {
  const step = shift ? 48 : 16;
  if (from === "rail") return key === "ArrowRight" || key === "End" ? { kind: "full" } : null;
  if (key === "ArrowLeft") return canRail && width <= NAV_WIDTH_MIN ? { kind: "rail" } : { kind: "width", width: clampNavWidth(width - step) };
  if (key === "ArrowRight") return { kind: "width", width: clampNavWidth(width + step) };
  if (key === "Home") return { kind: "width", width: NAV_WIDTH_MIN };
  if (key === "End") return { kind: "width", width: NAV_WIDTH_MAX };
  return null;
}
