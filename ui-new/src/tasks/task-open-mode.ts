import { createSignal } from "solid-js";

/*
 * Where a task opens from a list (build plan, decision B): docked beside it (boards 2, 3 and 5), the
 * default, or as a modal over the page (boards 6 and 7). The choice is kept in local storage, for
 * this browser, and every list follows it at once. Pages without a list (Inbox, chat, dashboards)
 * always open the modal, and direct links open the full page.
 */

export type TaskOpenMode = "panel" | "modal";

export const TASK_OPEN_MODE_KEY = "paperclip.ui-new.task-open-mode";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readTaskOpenMode(store: Storage | null = storage()): TaskOpenMode {
  try {
    return store?.getItem(TASK_OPEN_MODE_KEY) === "modal" ? "modal" : "panel";
  } catch {
    return "panel";
  }
}

export function writeTaskOpenMode(mode: TaskOpenMode, store: Storage | null = storage()) {
  try {
    store?.setItem(TASK_OPEN_MODE_KEY, mode);
  } catch {
    // Storage unavailable: the choice lasts until the page reloads.
  }
}

/** How a task opens on a page: lists follow the setting; pages without a list use the modal. */
export function opensAs(mode: TaskOpenMode, pageHasList: boolean): TaskOpenMode {
  return pageHasList ? mode : "modal";
}

const [mode, setMode] = createSignal<TaskOpenMode>(readTaskOpenMode());

/** The setting, shared by every list and the toggle in the panel and modal headers. */
export const taskOpenMode = mode;

export function setTaskOpenMode(next: TaskOpenMode) {
  setMode(next);
  writeTaskOpenMode(next);
}
