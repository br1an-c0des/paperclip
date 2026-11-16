/*
 * The text of an unsaved-change dot (ChangedDot.tsx), kept apart from the component so form models
 * can build it.
 */

/** A setting's unsaved state: false or undefined when it has none; `{ from }` names the saved value; `true` hides it (secrets). */
export type Changed = { from: string } | boolean | null | undefined;

/** The dot's tip: "Changed from <from>. Not saved yet.", "Changed. Not saved yet." or null when unchanged. */
export function changedText(changed: Changed): string | null {
  if (!changed) return null;
  if (changed === true) return "Changed. Not saved yet.";
  return `Changed from ${changed.from}. Not saved yet.`;
}

/** A saved value as the tip shows it: on one line, cut to `max` characters, and `empty` when blank. */
export function savedText(value: unknown, empty = "empty", max = 60): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return empty;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A label as the dot's button names it: the text, or "this setting" for a label that isn't text. */
export function settingName(label: unknown) {
  return typeof label === "string" ? label : "this setting";
}
