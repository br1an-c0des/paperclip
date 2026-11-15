import { Switch as KSwitch } from "@kobalte/core/switch";
import { Show, type JSX } from "solid-js";
import { aboutLabel, InfoTip } from "./InfoTip";
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
  /**
   * What the setting is for, behind an "i" button beside the label (InfoTip.tsx), named "About
   * <label>" or `infoLabel`. It sits outside the label, so a tap on it doesn't toggle the switch.
   */
  info?: JSX.Element;
  infoLabel?: string;
  /** Visible under the label: state, or why the switch is unavailable. */
  description?: JSX.Element;
  disabled?: boolean;
}) {
  const tip = () => <InfoTip label={props.infoLabel ?? aboutLabel(props.label)}>{props.info}</InfoTip>;
  return (
    <KSwitch class="switch-row" checked={props.checked} onChange={props.onChange} disabled={props.disabled}>
      <KSwitch.Input class="sr-only" />
      <KSwitch.Control class="switch">
        <KSwitch.Thumb class="switch-knob" />
      </KSwitch.Control>
      <span class="switch-text" classList={{ "sr-only": props.labelHidden }}>
        <Show when={props.info && !props.labelHidden} fallback={<KSwitch.Label class="switch-label">{props.label}</KSwitch.Label>}>
          <span class="info-line">
            <KSwitch.Label class="switch-label">{props.label}</KSwitch.Label>
            {tip()}
          </span>
        </Show>
        <Show when={props.description}>
          <KSwitch.Description class="switch-desc">{props.description}</KSwitch.Description>
        </Show>
      </span>
      {/* With the label hidden, the "i" stays visible on its own beside the switch. */}
      <Show when={props.info && props.labelHidden}>{tip()}</Show>
    </KSwitch>
  );
}
