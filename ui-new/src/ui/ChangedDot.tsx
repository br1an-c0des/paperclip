import { Show } from "solid-js";
import { changedText, type Changed } from "./changed";
import { TapTip } from "./InfoTip";
import "./Tooltip.css";
import "./ChangedDot.css";

export { changedText, savedText, settingName, type Changed } from "./changed";

/*
 * ChangedDot: a small lit "LED" after a setting's label (and its "i"), on while the setting has an
 * edit the form's save bar counts and isn't saved yet. It goes out on save, Discard, or when the
 * value is put back.
 *
 * It's a button, like InfoTip, whose tip says what the setting was: "Changed from Every 5 minutes.
 * Not saved yet.", or "Changed. Not saved yet." for a secret (changed.ts builds the text). It opens
 * on hover, focus and tap. The button is named "Unsaved change: <setting>" and described by the
 * tip, so the state isn't color only.
 *
 * Most forms pass `changed` to SettingsRow or Field (ui/Field.tsx) or SwitchRow (agents/shared.tsx,
 * settings/app/shared.tsx), which put the dot in place:
 *
 *   <SettingsRow label="Model" changed={draft.model !== base.model && { from: modelLabel(base.model) }}>
 */

export function ChangedDot(props: {
  /** The setting's name, for the button's name ("Unsaved change: Model"). */
  label: string;
  changed: Changed;
}) {
  return (
    <Show when={changedText(props.changed)}>
      {(text) => (
        <TapTip label={`Unsaved change: ${props.label}`} class="changed-dot" trigger={<span class="changed-dot-led" aria-hidden="true" />}>
          {text()}
        </TapTip>
      )}
    </Show>
  );
}
