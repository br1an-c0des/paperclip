import { X } from "lucide-solid";
import { onCleanup, onMount, Show, type JSX, type ParentProps } from "solid-js";
import { Portal } from "solid-js/web";
import { useLayerMount } from "@/ui/layer";
import { useShell } from "./Shell";
import "./Panel.css";

/*
 * Every side panel goes through this wrapper (build plan, decision H). It renders into the shell's
 * panel area, beside the list it was opened from (boards 2, 3 and 5), and becomes a full-screen
 * sheet on a phone-sized viewport (Shell.css). It isn't modal: the list behind it stays usable.
 * Escape closes it, and focus moves into it when it opens and back to where it was when it closes.
 *
 *   <Show when={openTaskId()}>
 *     <Panel label="Task TRA-41" onClose={() => setOpenTaskId(null)} header={…}>…</Panel>
 *   </Show>
 */

export function Panel(
  props: ParentProps<{
    /** Accessible name, such as "Task TRA-41". */
    label: string;
    onClose: () => void;
    /** Header content beside the close button. */
    header?: JSX.Element;
    /** Extra header actions, before the close button. */
    actions?: JSX.Element;
  }>,
) {
  const shell = useShell();
  const mount = useLayerMount();
  let aside: HTMLElement | undefined;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    props.onClose();
  };

  onMount(() => aside?.focus({ preventScroll: true }));
  onCleanup(() => {
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });

  // Inside the shell the panel goes to its panel area; elsewhere (the style guide) it floats at the
  // window's right edge.
  const host = () => shell?.panelHost() ?? mount() ?? document.body;

  return (
    <Show when={host()}>
      {(target) => (
        <Portal mount={target()}>
          <aside
            ref={aside}
            class="panel"
            classList={{ "panel--floating": !shell }}
            aria-label={props.label}
            tabindex="-1"
            onKeyDown={onKeyDown}
          >
            <header class="panel-head">
              <div class="panel-head-main">{props.header}</div>
              {props.actions}
              <button type="button" class="btn btn--icon btn--ghost" aria-label="Close" onClick={() => props.onClose()}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <div class="panel-body">{props.children}</div>
          </aside>
        </Portal>
      )}
    </Show>
  );
}
