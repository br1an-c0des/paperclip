/*
 * Recent searches, shown before anything is typed (phone board M14's "recent" state), after
 * ui/src/lib/recent-searches.ts: the last few queries per company, newest first, in local storage
 * for this browser.
 */

const KEY = "paperclip.ui-new.recent-searches";
export const RECENT_LIMIT = 6;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadRecent(companyId: string, store: Storage | null = storage()): string[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(`${KEY}.${companyId}`) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Puts a query first (once, ignoring case and spacing) and returns the new list. */
export function pushRecent(companyId: string, query: string, store: Storage | null = storage()): string[] {
  const entry = query.trim().replace(/\s+/g, " ");
  const current = loadRecent(companyId, store);
  if (!entry) return current;
  const next = [entry, ...current.filter((existing) => existing.toLowerCase() !== entry.toLowerCase())].slice(0, RECENT_LIMIT);
  try {
    store?.setItem(`${KEY}.${companyId}`, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the list lasts until the page reloads.
  }
  return next;
}
