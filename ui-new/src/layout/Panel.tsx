import { ChevronLeft, X } from "lucide-solid";
import { createContext, createEffect, createSignal, For, onCleanup, onMount, Show, useContext, type JSX, type ParentProps } from "solid-js";
import { Portal } from "solid-js/web";
import { useLayerMount } from "@/ui/layer";
import { ScrollCapsule } from "@/ui/ScrollCapsule";
import { isCompact } from "./breakpoints";
import "./Panel.css";

/*
 * Every side panel goes through this wrapper (build plan, decision H). Inside a <Dock> it renders
 * beside the list it was opened from (boards 2, 3 and 5): in the shell's dock column when the dock
 * is inside a <Shell>, where the panel fills the window's height and main scrolls on its own beside
 * it (Shell.tsx), or else in the dock's own column. On a
 * phone-sized viewport it becomes a full-screen page over everything, the dock included, with a
 * back control in place of the close button (build plan, "Desktop first, ready for mobile"). It isn't modal: the list beside it stays usable.
 * Escape closes it, and focus moves into it when it opens and back to where it was when it closes.
 * Docked in the shell's column, what scrolls inside it (the body, or `scrollers` in it) shows the
 * scroll capsule in place of a scrollbar (ui/ScrollCapsule.tsx), as main beside it does.
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
 * The shell's column for a docked panel (Shell.tsx): where docks inside the shell put their panel,
 * and `hold()`, which a panel calls while it's there, so the shell splits main and the panel into
 * two frames that scroll on their own. `hold()` returns its release.
 */
export const ShellDockContext = createContext<{ host: () => HTMLElement | undefined; hold: () => () => void }>();

/**
 * A list with room for a docked panel. While a <Panel> inside it is open, the panel takes a 620px
 * column and the list keeps the rest; when there's too little room for both, the panel lies over the
 * list's right edge instead. Inside a <Shell> that column is the shell's, beside all of main; outside
 * one (the style guide), it's the dock's own.
 */
export function Dock(props: ParentProps<{ class?: string }>) {
  const shell = useContext(ShellDockContext);
  const [own, setHost] = createSignal<HTMLElement>();
  const host = () => (shell ? shell.host() : own());
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
    /** A dense toolbar header (boards 2, 3 and 5) instead of a titled one. */
    toolbar?: boolean;
    /** The body has no padding of its own, for content that lays out its own columns. */
    flush?: boolean;
    /**
     * A selector for the elements inside the body that scroll on their own, for content that does
     * its own scrolling (a flush body). Docked in the shell's column, each gets the scroll capsule
     * in place of its scrollbar. Without it, the body itself does.
     */
    scrollers?: string;
  }>,
) {
  const dock = useContext(DockContext);
  const shell = useContext(ShellDockContext);
  const mount = useLayerMount();
  let aside: HTMLElement | undefined;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    props.onClose();
  };

  // Focus moves in once the panel is on the page, which in the shell's dock column can be a moment
  // after this component mounts (the column comes after main).
  let focused = false;
  const focusOnOpen = () => {
    if (focused || !aside) return;
    focused = true;
    aside.focus({ preventScroll: true });
  };
  onCleanup(() => {
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });

  // Inside a dock the panel goes to the dock's column. Elsewhere, and on a phone, it floats over
  // the page: the dock is a size container, so a fixed sheet inside it would cover only the dock.
  const docked = () => Boolean(dock) && !isCompact();
  const page = () => isCompact();
  const host = () => (docked() ? dock?.() : mount() ?? document.body);

  // Docked in the shell's column: the shell splits while the panel is there.
  const inShell = () => {
    const target = host();
    return Boolean(shell && target && target === shell.host());
  };
  createEffect(() => {
    if (shell && inShell()) onCleanup(shell.hold());
  });
  let body: HTMLDivElement | undefined;

  return (
    <Show when={host()}>
      {(target) => {
        onMount(focusOnOpen);
        return (
          <Portal mount={target()}>
            <aside
              ref={aside}
              class="panel"
              classList={{ "panel--floating": !docked() && !page(), "panel--page": page() }}
              aria-label={props.label}
              tabindex="-1"
              onKeyDown={onKeyDown}
            >
              <header class="panel-head" classList={{ "panel-head--toolbar": props.toolbar }}>
                <Show when={page()}>
                  <button
                    type="button"
                    class="btn btn--icon btn--ghost panel-back"
                    classList={{ "btn--compact": props.toolbar }}
                    aria-label="Back"
                    onClick={() => props.onClose()}
                  >
                    <ChevronLeft size={18} aria-hidden="true" />
                  </button>
                </Show>
                <div class="panel-head-main">{props.header}</div>
                {props.actions}
                <Show when={!page()}>
                  <button
                    type="button"
                    class="btn btn--icon btn--ghost"
                    classList={{ "btn--compact": props.toolbar }}
                    aria-label="Close"
                    onClick={() => props.onClose()}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </Show>
              </header>
              <div ref={body} class="panel-body" classList={{ "panel-body--flush": props.flush }}>
                {props.children}
              </div>
              <Show when={inShell()}>
                <PanelCapsules body={() => body} selector={props.scrollers} />
              </Show>
            </aside>
          </Portal>
        );
      }}
    </Show>
  );
}

/**
 * The scroll capsules of a panel docked in the shell's column (ui/ScrollCapsule.tsx): one for each
 * element matching `selector` inside the body, or for the body itself. Sections come and go as you
 * switch them, so the body is watched for elements matching and leaving.
 */
function PanelCapsules(props: { body: () => HTMLElement | undefined; selector?: string }) {
  const [scrollers, setScrollers] = createSignal<HTMLElement[]>([]);
  onMount(() => {
    const body = props.body();
    if (!body) return;
    let pending: number | undefined;
    const scan = () => {
      pending = undefined;
      const next = props.selector ? Array.from(body.querySelectorAll<HTMLElement>(props.selector)) : [body];
      setScrollers((current) => (current.length === next.length && current.every((element, index) => element === next[index]) ? current : next));
    };
    const watch = new MutationObserver(() => {
      pending ??= requestAnimationFrame(scan);
    });
    watch.observe(body, { childList: true, subtree: true });
    scan();
    onCleanup(() => {
      watch.disconnect();
      if (pending !== undefined) cancelAnimationFrame(pending);
    });
  });
  return <For each={scrollers()}>{(scroller) => <ScrollCapsule scroller={scroller} />}</For>;
}
