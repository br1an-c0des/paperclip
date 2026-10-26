import { onCleanup } from "solid-js";

/*
 * Global keyboard shortcuts, after ui/src/hooks/useKeyboardShortcuts.ts and the cheatsheet in
 * ui/src/components/KeyboardShortcutsCheatsheet.tsx:
 *
 * - Cmd/Ctrl+K opens the command palette, from anywhere.
 * - `c` new task, `/` search, `?` the cheatsheet, `g` then `i` the Inbox, `g` then `d` the Org
 *   dashboard. These don't fire while typing in a field or while a dialog is open.
 *
 * The old UI's `[` (toggle sidebar) and `]` (toggle panel) wait for a collapsible nav and the task
 * panel (M2). The task list's own keys (j/k, Enter, x, ←/→) live in tasks/TaskList.tsx, and the
 * board's (j/k, h/l, Enter, x, Shift+←/→) in tasks/BoardView.tsx; both are listed here for the
 * cheatsheet. The Inbox's come with that screen.
 */

export type ShortcutAction = "palette" | "new-task" | "search" | "cheatsheet" | "go-inbox" | "go-dashboard";

export type ShortcutGroup = { title: string; items: { keys: string[]; label: string }[] };

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** What the cheatsheet lists. Later milestones add their screens' groups. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Anywhere",
    items: [
      { keys: [MOD, "K"], label: "Search and commands" },
      { keys: ["C"], label: "New task" },
      { keys: ["/"], label: "Search" },
      { keys: ["?"], label: "Keyboard shortcuts" },
    ],
  },
  {
    title: "Go to",
    items: [
      { keys: ["G", "I"], label: "Inbox" },
      { keys: ["G", "D"], label: "Org dashboard" },
    ],
  },
  {
    title: "Task list",
    items: [
      { keys: ["J"], label: "Next row" },
      { keys: ["K"], label: "Previous row" },
      { keys: ["Enter"], label: "Open the task" },
      { keys: ["X"], label: "Select the row" },
      { keys: ["Shift", "Click"], label: "Select a range" },
      { keys: ["←", "→"], label: "Fold or unfold the group" },
      { keys: ["Esc"], label: "Clear the selection" },
    ],
  },
  {
    title: "Task board",
    items: [
      { keys: ["J", "K"], label: "Next or previous card" },
      { keys: ["H", "L"], label: "Previous or next column" },
      { keys: ["Enter"], label: "Open the task" },
      { keys: ["X"], label: "Select the card" },
      { keys: ["Shift", "←", "→"], label: "Move the card to the next column" },
      { keys: ["Esc"], label: "Clear the selection" },
    ],
  },
  {
    title: "In dialogs",
    items: [
      { keys: [MOD, "Enter"], label: "Create or send" },
      { keys: ["Esc"], label: "Close" },
    ],
  },
];

/** Typing targets, where bare-key shortcuts must not fire. */
export function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
}

/** A dialog that owns the keyboard: the shared Dialog wrapper marks its content `data-layer`. */
export function hasOpenDialog(root: ParentNode = document) {
  return root.querySelector('[data-layer="dialog"]') !== null;
}

type KeyInput = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "target">;

/**
 * The action a keypress triggers, given whether `g` was just pressed. Returns "arm-g" for the first
 * key of a chord, or null.
 */
export function resolveShortcut(
  event: KeyInput,
  state: { goArmed: boolean; dialogOpen: boolean },
): ShortcutAction | "arm-g" | null {
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && !event.altKey && key === "k") return "palette";
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (state.dialogOpen || isTextInputTarget(event.target)) return null;
  if (state.goArmed) {
    if (key === "i") return "go-inbox";
    if (key === "d") return "go-dashboard";
    return null;
  }
  if (key === "g") return "arm-g";
  if (key === "c") return "new-task";
  if (event.key === "/") return "search";
  if (event.key === "?") return "cheatsheet";
  return null;
}

const CHORD_TIMEOUT_MS = 1200;

/** Listens for the global shortcuts until the calling component unmounts. */
export function useGlobalShortcuts(run: (action: ShortcutAction) => void) {
  let goArmed = false;
  let chordTimer: number | undefined;
  const disarm = () => {
    goArmed = false;
    window.clearTimeout(chordTimer);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) return disarm();
    const action = resolveShortcut(event, { goArmed, dialogOpen: hasOpenDialog() });
    disarm();
    if (!action) return;
    event.preventDefault();
    if (action === "arm-g") {
      goArmed = true;
      chordTimer = window.setTimeout(disarm, CHORD_TIMEOUT_MS);
      return;
    }
    run(action);
  };

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", disarm, true);
  onCleanup(() => {
    disarm();
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("pointerdown", disarm, true);
  });
}
