import { Switch as KSwitch } from "@kobalte/core/switch";
import { Show, type JSX } from "solid-js";
import "./Switch.css";

/*
 * Switch (design-system.md): a 36×20 pill with a 14px knob; on is --primary, off is --pri-off.
 * Kobalte renders a real checkbox with role="switch", so it works with keyboard and screen readers.
 */

export function Switch(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: JSX.Element;
  /** Keep the label for screen readers only. */
  labelHidden?: boolean;
  description?: JSX.Element;
  disabled?: boolean;
}) {
  return (
    <KSwitch class="switch-row" checked={props.checked} onChange={props.onChange} disabled={props.disabled}>
      <KSwitch.Input class="sr-only" />
      <KSwitch.Control class="switch">
        <KSwitch.Thumb class="switch-knob" />
      </KSwitch.Control>
      <span class="switch-text" classList={{ "sr-only": props.labelHidden }}>
        <KSwitch.Label class="switch-label">{props.label}</KSwitch.Label>
        <Show when={props.description}>
          <KSwitch.Description class="switch-desc">{props.description}</KSwitch.Description>
        </Show>
      </span>
    </KSwitch>
  );
}
