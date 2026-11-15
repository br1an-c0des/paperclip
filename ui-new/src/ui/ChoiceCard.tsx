import { Show, type JSX } from "solid-js";
import { aboutLabel, InfoTip } from "./InfoTip";
import "./ChoiceCard.css";

/*
 * ChoiceCard: one option of a radio group, drawn as a bordered card (a sign-in option, a machine
 * sign-in method, a visibility or mode choice). Put the cards in a list with role="radiogroup" and
 * an aria-label, and give every card of the group the same `name`.
 *
 * `info` is what the option means, behind an "i" outside the <label> (InfoTip.tsx), so it isn't
 * read as part of the radio's name and a press on it can't pick the card. It's named "About
 * <title>", or `infoLabel` when the title isn't plain text.
 *
 *   <ul class="..." role="radiogroup" aria-label="How Paperclip proves who it is">
 *     <li><ChoiceCard name="method" title="Client secret" info="…" checked={…} onSelect={…} /></li>
 *   </ul>
 */

export function ChoiceCard(props: {
  name: string;
  title: JSX.Element;
  info?: JSX.Element;
  infoLabel?: string;
  /** The radio's value, for a group read from a form. */
  value?: string;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  class?: string;
}) {
  return (
    <div class={`choice-card${props.checked ? " choice-card--on" : ""}${props.class ? ` ${props.class}` : ""}`}>
      <label class="choice-card-label">
        <input type="radio" name={props.name} value={props.value} checked={props.checked} disabled={props.disabled} onChange={() => props.onSelect()} />
        <span class="choice-card-name">{props.title}</span>
      </label>
      <Show when={props.info}>
        <InfoTip label={props.infoLabel ?? aboutLabel(props.title, "About this option")}>{props.info}</InfoTip>
      </Show>
    </div>
  );
}
