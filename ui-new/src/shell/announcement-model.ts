import type { Announcement, AnnouncementAction } from "@paperclipai/shared";

/*
 * The rules behind announcements (ui/src/hooks/useAnnouncement.ts, lib/announcement-dismissals.ts):
 * which payloads are shown, where a route action goes, and the dismissals kept in this browser.
 *
 * Dismissals are stored per person in localStorage under the old UI's keys, so dismissing in one UI
 * dismisses in the other. "pending" means the server hasn't recorded it yet; it's retried later.
 */

const ID_RE = /^[a-z0-9][a-z0-9-]{0,95}$/;
/** ANNOUNCEMENT_APP_ROUTES in @paperclipai/shared: stable company-relative pages. */
const APP_ROUTES = new Set(["/dashboard", "/issues", "/projects", "/agents", "/skills", "/apps", "/routines", "/artifacts", "/company/settings"]);

const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

function validAction(action: unknown): action is AnnouncementAction {
  if (!action || typeof action !== "object") return false;
  const value = action as Record<string, unknown>;
  if (!text(value.label, 48)) return false;
  if (value.kind === "route") return typeof value.path === "string" && APP_ROUTES.has(value.path);
  if (value.kind !== "external" || typeof value.url !== "string") return false;
  try {
    const url = new URL(value.url);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * The announcement to show, or null. The server already checks the feed against the shared schema;
 * this keeps a malformed or expired payload from rendering.
 */
export function showableAnnouncement(payload: unknown, now = Date.now()): Announcement | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.id !== "string" || !ID_RE.test(value.id)) return null;
  if (!text(value.eyebrow, 48) || !text(value.title, 100) || !text(value.description, 400)) return null;
  if (!validAction(value.primaryAction)) return null;
  if (value.secondaryLink !== undefined && !validAction(value.secondaryLink)) return null;
  if (typeof value.expiresAt === "string" && Date.parse(value.expiresAt) <= now) return null;
  return payload as Announcement;
}

/** Where an action goes: route actions are pages in the current company. */
export function actionHref(action: AnnouncementAction, companyPrefix: string) {
  return action.kind === "external" ? action.url : `/${companyPrefix}${action.path}`;
}

// ---------------------------------------------------------------------------------------------
// Dismissals in this browser

export type DismissalStore = Pick<Storage, "getItem" | "setItem" | "key" | "length">;

const memory = new Map<string, boolean>();

export function dismissalPrefix(userId: string) {
  return `paperclip.announcement-dismissals.v1:${encodeURIComponent(userId)}:`;
}

function browserStorage(): DismissalStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** This person's dismissed ids, each with whether the server still has to hear about it. */
export function readDismissals(userId: string, storage: DismissalStore | null = browserStorage()): Map<string, boolean> {
  const prefix = dismissalPrefix(userId);
  try {
    for (let index = 0; storage && index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const value = storage.getItem(key);
      if (ID_RE.test(key.slice(prefix.length)) && (value === "pending" || value === "synced")) memory.set(key, value === "pending");
    }
  } catch {
    // Private browsing or full storage: this visit's dismissals still count.
  }
  const out = new Map<string, boolean>();
  for (const [key, pending] of memory) if (key.startsWith(prefix)) out.set(key.slice(prefix.length), pending);
  return out;
}

/** Records a dismissal; false when it couldn't be kept beyond this visit. */
export function saveDismissal(userId: string, id: string, pending: boolean, storage: DismissalStore | null = browserStorage()): boolean {
  const key = `${dismissalPrefix(userId)}${id}`;
  memory.set(key, pending);
  try {
    if (!storage) return false;
    storage.setItem(key, pending ? "pending" : "synced");
    return true;
  } catch {
    return false;
  }
}

/** For tests. */
export function _resetDismissalMemory() {
  memory.clear();
}
