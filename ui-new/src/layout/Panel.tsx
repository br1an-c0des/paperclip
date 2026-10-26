import { X } from "lucide-solid";
import { createContext, createSignal, onCleanup, onMount, Show, useContext, type JSX, type ParentProps } from "solid-js";
import { Portal } from "solid-js/web";
import { useLayerMount } from "@/ui/layer";
import { isCompact } from "./breakpoints";
import "./Panel.css";

/*
 * Every side panel goes through this wrapper (build plan, decision H). Inside a <Dock> it renders
 * into the dock's own column, beside the list it was opened from (boards 2, 3 and 5), and becomes
 * a full-screen sheet on a phone-sized viewport. It isn't modal: the list beside it stays usable.
 * Escape closes it, and focus moves into it when it opens and back to where it was when it closes.
 *
 *   <Dock>
 *     <TaskList />
 *     <Show when={openTaskId()}>
 *       <Panel label="Task TRA-41" onClose={() => setOpenTaskId(null)} header={…}>…</Panel>
 *     </Show>
 *   </Dock>
 */

const DockContext = createContext<() => HTMLElement | undefined>();

/**
 * A list with room for a docked panel. While a <Panel> inside it is open, the panel takes a 620px
 * column and the list keeps the rest; when the dock is too narrow for both, the panel lies over the
 * list's right edge instead.
 */
export function Dock(props: ParentProps<{ class?: string }>) {
  const [host, setHost] = createSignal<HTMLElement>();
  return (
    <DockContext.Provider value={host}>
      <div class="dock">
        <div class="dock-grid">
          <div class={props.class ? `dock-main ${props.class}` : "dock-main"}>{props.children}</div>
          <div ref={setHost} class="dock-panel" />
        </div>
      </div>
    </DockContext.Provider>
  );
}

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
  const dock = useContext(DockContext);
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

  // Inside a dock the panel goes to the dock's column. Elsewhere, and on a phone, it floats over
  // the page: the dock is a size container, so a fixed sheet inside it would cover only the dock.
  const docked = () => Boolean(dock) && !isCompact();
  const host = () => (docked() ? dock?.() : mount() ?? document.body);

  return (
    <Show when={host()}>
      {(target) => (
        <Portal mount={target()}>
          <aside
            ref={aside}
            class="panel"
            classList={{ "panel--floating": !docked() }}
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
