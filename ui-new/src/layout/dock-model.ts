/*
 * The phone dock's rules (design/mobile.md, N1), kept apart from the components so they can be
 * tested: which of the three places owns the current page, what tapping Tasks does, which tasks
 * scope the switcher marks as current, and when the dock slides away while scrolling.
 */

/** The dock's three places. Pages outside them (the dashboard, settings) leave none current. */
export type DockPlace = "inbox" | "tasks" | "agents";

/** What the Tasks switcher sheet shows: closed, the projects, the company list, or You. */
export type SheetView = "closed" | "projects" | "companies" | "you";

/** The tasks a page shows: every task in the company, or one project's. */
export type TasksScope = { kind: "all" } | { kind: "project"; key: string };

/** The path inside the company, without `/:companyPrefix`, query or trailing slash. */
function companyPath(pathname: string, prefix: string) {
  const lower = pathname.toLowerCase();
  const base = `/${prefix.toLowerCase()}`;
  if (lower !== base && !lower.startsWith(`${base}/`)) return null;
  const rest = pathname.slice(base.length).replace(/\/+$/, "");
  return rest === "" ? "/" : rest;
}

/**
 * A project's task list or board: `/projects/:key/issues` (with a task open in its panel too) or
 * `/projects/:key/board`. The project's own address is its dashboard, which, like Docs, isn't a task
 * list.
 */
const PROJECT_TASKS = /^\/projects\/([^/]+)\/(?:issues(?:\/|$)|board$)/;

/** The dock place that owns `pathname`, or null. */
export function dockPlace(pathname: string, prefix: string): DockPlace | null {
  const path = companyPath(pathname, prefix);
  if (!path) return null;
  if (path === "/inbox" || path.startsWith("/inbox/")) return "inbox";
  if (path === "/issues" || path.startsWith("/issues/")) return "tasks";
  if (PROJECT_TASKS.test(path)) return "tasks";
  if (path === "/agents" || path.startsWith("/agents/")) return "agents";
  return null;
}

/**
 * The organization's pages, which the nav's "Org dashboard" item owns (boards 19, 20, 33): the
 * dashboard, the agents roster (not an agent's own page), workload, and the org tabs' other pages.
 * Settings has its own nav button.
 */
const ORG_PAGES = /^\/(?:dashboard|org|agents|workload|skills|apps|activity)(?:\/|$)/;

export function isOrgPage(pathname: string, prefix: string): boolean {
  const path = companyPath(pathname, prefix);
  if (!path || !ORG_PAGES.test(path)) return false;
  // `/agents/:key` is that agent's page; only the roster itself (and its old tab addresses) is org.
  const agentPage = /^\/agents\/([^/]+)/.exec(path);
  return !agentPage || ["all", "active", "paused", "error", "builtin"].includes(agentPage[1]!.toLowerCase());
}

/** The tasks scope of a task list page, or null for anything else (a single task, other pages). */
export function tasksScope(pathname: string, prefix: string): TasksScope | null {
  const path = companyPath(pathname, prefix);
  if (path === "/issues") return { kind: "all" };
  const project = path ? PROJECT_TASKS.exec(path) : null;
  return project ? { kind: "project", key: decodeURIComponent(project[1]!) } : null;
}

/**
 * Tapping Tasks. From another place it goes to the task list you last had open; already in Tasks,
 * it opens the switcher sheet, or closes it if it's open (in any view).
 */
export function tapTasks(current: DockPlace | null, sheet: SheetView): { navigate: boolean; sheet: SheetView } {
  if (current !== "tasks") return { navigate: true, sheet: "closed" };
  return { navigate: false, sheet: sheet === "closed" ? "projects" : "closed" };
}

/** The company dropdown at the top of the sheet: it swaps the projects for the company list. */
export function toggleCompanies(sheet: SheetView): SheetView {
  return sheet === "companies" ? "projects" : "companies";
}

/** Scrolls smaller than this, in px, don't move the dock; near the top it always shows. */
export const DOCK_SCROLL_SLOP = 8;
export const DOCK_TOP_ZONE = 48;

/**
 * Whether the dock is hidden after scrolling from `previousY` to `y`: it hides while you scroll
 * down and comes back when you scroll up or reach the top (design/mobile.md, "Navigation").
 */
export function dockHiddenAfterScroll(previousY: number, y: number, hidden: boolean): boolean {
  if (y <= DOCK_TOP_ZONE) return false;
  const delta = y - previousY;
  if (delta > DOCK_SCROLL_SLOP) return true;
  if (delta < -DOCK_SCROLL_SLOP) return false;
  return hidden;
}

/** "3 agents · 34 tasks · 8 need you", leaving out what isn't known. */
export function companySummary(counts: { agents?: number; tasks?: number; projects?: number; needsYou?: number }) {
  const parts: string[] = [];
  const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
  if (counts.projects !== undefined) parts.push(count(counts.projects, "project", "projects"));
  if (counts.agents !== undefined) parts.push(count(counts.agents, "agent", "agents"));
  if (counts.tasks !== undefined) parts.push(count(counts.tasks, "task", "tasks"));
  if (counts.needsYou !== undefined) parts.push(counts.needsYou === 0 ? "all quiet" : `${counts.needsYou} ${counts.needsYou === 1 ? "needs" : "need"} you`);
  return parts.join(" · ");
}
