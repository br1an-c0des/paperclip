import { DEFAULT_SORT, parseFilters, parseGroupBy, parseSort, type GroupBy, type TaskFilters, type TaskSort } from "./view-state";

/*
 * Saved views: a named grouping, set of filters, sort and search for a task list, to switch back to
 * in one pick. Each list (the company's, each project's) keeps its own, as it keeps its view state.
 *
 * They live in this browser's localStorage for now. Stage 3 moves them to a plugin so they follow
 * the account (build plan), so everything goes through a `SavedViewStore`: swapping the store is the
 * whole change. The functions below the store are pure, for the toolbar and for tests.
 */

export type SavedView = {
  id: string;
  name: string;
  groupBy: GroupBy;
  filters: TaskFilters;
  sort: TaskSort;
  search: string;
};

/** What a saved view holds, without its id and name. */
export type ViewSettings = Omit<SavedView, "id" | "name">;

export type SavedViewStore = {
  read: (scope: string) => SavedView[];
  write: (scope: string, views: readonly SavedView[]) => void;
};

export function savedViewsScope(companyId: string, projectId?: string) {
  return `${companyId}:${projectId ?? "all"}`;
}

function storageKey(scope: string) {
  return `ui-new:tasks:saved-views:${scope}`;
}

/** Saved views from stored JSON, dropping anything malformed. */
export function parseSavedViews(raw: string | null): SavedView[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): SavedView[] => {
      if (!item || typeof item !== "object") return [];
      const view = item as Record<string, unknown>;
      if (typeof view.id !== "string" || typeof view.name !== "string" || !view.name.trim()) return [];
      return [
        {
          id: view.id,
          name: view.name,
          groupBy: parseGroupBy(view.groupBy),
          filters: parseFilters(view.filters),
          sort: view.sort ? parseSort(view.sort) : DEFAULT_SORT,
          search: typeof view.search === "string" ? view.search : "",
        },
      ];
    });
  } catch {
    return [];
  }
}

export const localSavedViews: SavedViewStore = {
  read: (scope) => {
    try {
      return parseSavedViews(localStorage.getItem(storageKey(scope)));
    } catch {
      return [];
    }
  },
  write: (scope, views) => {
    try {
      localStorage.setItem(storageKey(scope), JSON.stringify(views));
    } catch {
      // The views last for this page only.
    }
  },
};

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `view-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Adds a view, after the others. A name already taken gets a number, so every view can be told apart. */
export function addView(views: readonly SavedView[], name: string, settings: ViewSettings, id = newId()): SavedView[] {
  return [...views, { id, name: uniqueName(views, name.trim() || "Untitled view"), ...copy(settings) }];
}

export function renameView(views: readonly SavedView[], id: string, name: string): SavedView[] {
  const trimmed = name.trim();
  if (!trimmed) return [...views];
  const others = views.filter((view) => view.id !== id);
  return views.map((view) => (view.id === id ? { ...view, name: uniqueName(others, trimmed) } : view));
}

/** Replaces a view's settings with the current ones, keeping its name. */
export function updateView(views: readonly SavedView[], id: string, settings: ViewSettings): SavedView[] {
  return views.map((view) => (view.id === id ? { ...view, ...copy(settings) } : view));
}

export function deleteView(views: readonly SavedView[], id: string): SavedView[] {
  return views.filter((view) => view.id !== id);
}

/** Whether the current settings are what the view saved. The order of ticked filters doesn't matter. */
export function sameSettings(view: ViewSettings, current: ViewSettings) {
  return (
    view.groupBy === current.groupBy &&
    view.sort.field === current.sort.field &&
    view.sort.dir === current.sort.dir &&
    view.search.trim() === current.search.trim() &&
    sameFilters(view.filters, current.filters)
  );
}

function sameFilters(a: TaskFilters, b: TaskFilters) {
  return (Object.keys(a) as (keyof TaskFilters)[]).every((key) => {
    const [x, y] = [a[key], b[key]];
    if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((value) => (y as string[]).includes(value));
    return x === y;
  });
}

function uniqueName(views: readonly SavedView[], name: string) {
  const taken = new Set(views.map((view) => view.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
}

function copy(settings: ViewSettings): ViewSettings {
  return {
    groupBy: settings.groupBy,
    filters: parseFilters(settings.filters),
    sort: { ...settings.sort },
    search: settings.search.trim(),
  };
}
