import { onCleanup } from "solid-js";

/*
 * When you last looked at the Inbox, for board 14's "New" pill and M10's "since you last looked":
 * a per-viewer convenience kept in this browser (localStorage), per company. Opening the Inbox reads
 * the last visit and records this one; it records again when you leave or hide the tab, so a visit
 * that lasts counts until its end. Never stored, the last day counts as new.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const key = (companyId: string) => `paperclip.ui-new.inbox-seen.${companyId}`;

export function readSeen(companyId: string): number | null {
  try {
    const raw = localStorage.getItem(key(companyId));
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeSeen(companyId: string, at: number = Date.now()) {
  try {
    localStorage.setItem(key(companyId), String(at));
  } catch {
    // Storage blocked (a private window, a preview): every visit counts the last day as new.
  }
}

/**
 * The previous visit's time, fixed for this visit, and whether there was one; records this visit as
 * it goes.
 */
export function useLastSeen(companyId: () => string, now: () => number = Date.now) {
  const id = companyId();
  const stored = readSeen(id);
  const before = stored ?? now() - DAY_MS;
  writeSeen(id, now());
  const record = () => writeSeen(id);
  const onVisibility = () => {
    if (document.visibilityState === "hidden") record();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", record);
  onCleanup(() => {
    record();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", record);
  });
  return { at: () => before, known: stored !== null };
}
