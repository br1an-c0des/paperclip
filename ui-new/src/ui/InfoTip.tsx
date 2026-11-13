import { Tooltip as KTooltip } from "@kobalte/core/tooltip";
import { Info } from "lucide-solid";
import { createSignal, createUniqueId, type JSX } from "solid-js";
import { useLayerMount } from "./layer";
import "./Tooltip.css";
import "./InfoTip.css";

/*
 * InfoTip: a small "i" button that holds a section's or field's help text, so the page body keeps
 * only what the person needs to act on. It looks like a tooltip (`.tip`, Tooltip.tsx) and opens on
 * hover and on keyboard focus. Because its text isn't shown anywhere else, it also opens on a tap or
 * click, and then stays open until a press outside, Escape or another tap (decision H: a hover-only
 * tooltip may only repeat information, and phones have no hover).
 *
 * The rule (app-wide; SettingsCard's and SettingsRow's `info` prop render one):
 * - In `info`: what a section or field is for, and general guidance on using it.
 * - Visible in the body, never in `info`: the current state, why a control is missing or disabled,
 *   save status, errors and empty states.
 * Keep the text to a sentence or two of plain text: no links or controls, since the tip can't be
 * clicked into.
 *
 * For screen readers the button is described by the text all the time (a hidden copy, through
 * `aria-describedby`), so it's read when the button gets focus, whether or not the tip is open.
 * The trigger is `type="button"` and swallows its click, so it never submits a form or activates
 * the control of a label it sits in.
 *
 *   <InfoTip label="About Repositories">Which GitHub repositories the project's code comes from.</InfoTip>
 */

export function InfoTip(props: {
  /** The button's accessible name, such as "About Repositories". */
  label: string;
  children: JSX.Element;
  placement?: "top" | "bottom" | "left" | "right";
  class?: string;
}) {
  const mount = useLayerMount();
  const descriptionId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  // Opened by a tap, click or Enter: stays open when the pointer leaves or the page scrolls.
  let pinned = false;
  let trigger: HTMLButtonElement | undefined;
  const unpin = () => {
    pinned = false;
  };

  return (
    <KTooltip
      open={open()}
      onOpenChange={(next) => {
        if (next || !pinned) setOpen(next);
      }}
      openDelay={300}
      closeDelay={80}
      gutter={8}
      placement={props.placement ?? "top"}
    >
      <KTooltip.Trigger
        ref={trigger}
        type="button"
        class={`infotip ${props.class ?? ""}`}
        aria-label={props.label}
        aria-describedby={descriptionId}
        onClick={(event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          pinned = !pinned;
          setOpen(pinned);
        }}
        onBlur={unpin}
      >
        <Info size={14} aria-hidden="true" />
      </KTooltip.Trigger>
      <span id={descriptionId} hidden>
        {props.children}
      </span>
      <KTooltip.Portal mount={mount()}>
        <KTooltip.Content
          class="tip"
          aria-hidden="true"
          onPointerDownOutside={(event: Event) => {
            // A press on the button itself is the button's own toggle, not a press outside.
            if (trigger?.contains(event.target as Node)) event.preventDefault();
            else unpin();
          }}
          onEscapeKeyDown={unpin}
        >
          <span>{props.children}</span>
        </KTooltip.Content>
      </KTooltip.Portal>
    </KTooltip>
  );
}
