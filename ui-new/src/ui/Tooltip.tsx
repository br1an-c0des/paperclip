import { Tooltip as KTooltip } from "@kobalte/core/tooltip";
import { Show, type JSX } from "solid-js";
import { useLayerMount } from "./layer";
import "./Tooltip.css";

/*
 * Tooltips hold detail on demand (design-system.md): a --sel card, 280px wide, shown on hover and on
 * keyboard focus, never interactive. Because touch screens have no hover, a tooltip may only repeat
 * or explain something; anything the user can act on needs a visible control or a menu instead
 * (build plan, decision H).
 *
 * The child is a function that renders the trigger and spreads the props it's given, so the
 * tooltip attaches to the real button or marker:
 *
 *   <Tooltip title="Busiest" content="59h of runs this week">
 *     {(p) => <span {...p} class="flag" tabindex="0" aria-label="Busiest" />}
 *   </Tooltip>
 */

export function Tooltip(props: {
  content: JSX.Element;
  /** Bold first line. */
  title?: JSX.Element;
  placement?: "top" | "bottom" | "left" | "right";
  children: (triggerProps: Record<string, unknown>) => JSX.Element;
}) {
  const mount = useLayerMount();
  return (
    <KTooltip openDelay={300} closeDelay={80} gutter={8} placement={props.placement ?? "top"}>
      <KTooltip.Trigger as={props.children} />
      <KTooltip.Portal mount={mount()}>
        <KTooltip.Content class="tip">
          <Show when={props.title}>
            <b>{props.title}</b>
          </Show>
          <span>{props.content}</span>
        </KTooltip.Content>
      </KTooltip.Portal>
    </KTooltip>
  );
}
