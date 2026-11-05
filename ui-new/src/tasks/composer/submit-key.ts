import type { InstanceExperimentalSettings } from "@paperclipai/shared";

/*
 * Which key sends a task reply or a new task (U48, after ui/src/hooks/useComposerSubmitKey.ts and
 * MarkdownEditor's isSubmitShortcut). Callers read the setting with useExperimentalSettingsQuery
 * and pass it to submitKeyFor.
 *
 * - Enter sends and Shift+Enter adds a line. Command/Ctrl+Enter sends too.
 * - With the instance's `enableLegacyComposerSubmit` preference on (Settings → Features), only
 *   Command/Ctrl+Enter sends and Enter adds a line, as before.
 * - Until the settings have loaded, plain Enter stays a new line, so a cold load never sends a
 *   half-written message.
 * - Never while an input method is composing (Enter confirms the candidate), and never with Shift
 *   or Alt held. An open mention list takes Enter first (Composer.tsx, MentionTextArea.tsx).
 * - On phones Enter sends too, as in the old UI; the soft keyboard's key reads "Send". With the
 *   preference on it adds a line, and the Send button sends.
 */

export type SubmitKey = "enter" | "mod-enter";

export function submitKeyFor(settings: Pick<InstanceExperimentalSettings, "enableLegacyComposerSubmit"> | undefined | null): SubmitKey {
  return !settings || settings.enableLegacyComposerSubmit === true ? "mod-enter" : "enter";
}

type KeyLike = Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "metaKey" | "ctrlKey" | "isComposing" | "keyCode">;

/** Whether an input method is composing: Enter then confirms the candidate, not the message. */
export function isComposing(event: Pick<KeyboardEvent, "isComposing" | "keyCode">) {
  return event.isComposing || event.keyCode === 229;
}

/** Whether this keydown sends, for the given submit key. */
export function isSubmitKey(event: KeyLike, key: SubmitKey) {
  return event.key === "Enter" && !isComposing(event) && !event.shiftKey && !event.altKey && (key === "enter" || event.metaKey || event.ctrlKey);
}

/** Whether this keydown picks the highlighted entry of an open mention list. */
export function isPickKey(event: KeyLike) {
  if (isComposing(event)) return false;
  if (event.key === "Tab") return true;
  return event.key === "Enter" && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
}

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** "Enter", or "⌘+Enter" / "Ctrl+Enter", for tooltips. */
export function submitHint(key: SubmitKey) {
  return key === "enter" ? "Enter" : `${MOD}+Enter`;
}

/** The key cap beside a button: "↵", or "⌘↵" / "Ctrl ↵". */
export function submitKeyCap(key: SubmitKey) {
  return key === "enter" ? "↵" : MOD === "⌘" ? "⌘↵" : "Ctrl ↵";
}

/** The soft keyboard's Enter label: "send" when Enter sends, a plain return otherwise. */
export function enterKeyHint(key: SubmitKey): "send" | "enter" {
  return key === "enter" ? "send" : "enter";
}
