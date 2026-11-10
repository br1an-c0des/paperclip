import { PanelLeftOpen } from "lucide-solid";
import { createSignal, onCleanup, Show, type JSX, type ParentProps } from "solid-js";
import { buttonClass } from "@/ui/Button";
import { isCompact } from "./breakpoints";
import { NAV_COLLAPSE_AT, NAV_WIDTH_DEFAULT, NAV_WIDTH_MAX, NAV_WIDTH_MIN } from "./nav-model";
import "./Shell.css";

/*
 * The app shell: a grid with named areas, nav and main. Nothing in it has a fixed page width; the
 * 248px nav column is the only fixed track, and main is `minmax(0, 1fr)`. Side panels dock beside
 * the list they were opened from, inside main (<Dock> in Panel.tsx).
 *
 * `navHidden` (`[`, or Hide navigation in the You menu) drops the nav column; a button at the top
 * left of main brings it back.
 *
 * The nav's right edge is a handle (`role="separator"`) that resizes it, between 200 and 420px:
 * drag it, or focus it and use the arrow keys (Shift for bigger steps), Home and End. A double click
 * goes back to 248px, and dragging well past the narrowest width folds the nav away, as `[` does.
 *
 * On a phone-sized viewport the grid drops to one column and the left nav gives way to the floating
 * dock (design/mobile.md, N1; PhoneDock.tsx), which floats over the foot of main; panels become
 * full-screen pages (Panel.tsx). Only the shell switches; components inside it don't change.
 *
 * `main` is a size container named `main`, so content responds to the space it's given with
 * `@container main (...)`, not to the viewport.
 */

export function Shell(
  props: ParentProps<{
    /** The left nav, on tablet and desktop. */
    nav: JSX.Element;
    /** The floating dock that replaces the nav on a phone. */
    dock?: JSX.Element;
    navHidden?: boolean;
    onShowNav?: () => void;
    /** The nav's width in pixels (248 by default). */
    navWidth?: number;
    /** A new width from the handle; `done` once the drag or key press is over, to save it. */
    onNavWidth?: (width: number, done: boolean) => void;
    /** Dragged past the narrowest width: hide the nav. */
    onHideNav?: () => void;
    /** A phone detail page shows no dock, so main needn't leave room for it. */
    noDock?: boolean;
  }>,
) {
  const bare = () => !isCompact() && props.navHidden;
  const [folding, setFolding] = createSignal(false);
  return (
    <div
      class="shell"
      classList={{ "shell--bare": bare(), "shell--nodock": props.noDock, "shell--folding": folding() }}
      style={props.navWidth ? { "--nav-w": `${props.navWidth}px` } : undefined}
    >
      <Show when={!isCompact() && !props.navHidden}>
        <nav class="shell-nav" id="shell-nav" aria-label="Main">
          {props.nav}
        </nav>
        <Show when={props.onNavWidth}>
          <NavResizer
            width={props.navWidth ?? NAV_WIDTH_DEFAULT}
            onResize={(width, done) => props.onNavWidth?.(width, done)}
            onFolding={setFolding}
            onHide={() => props.onHideNav?.()}
          />
        </Show>
      </Show>
      <main class="shell-main">
        <Show when={bare()}>
          <button
            type="button"
            class={`${buttonClass({ variant: "icon", ghost: true })} shell-show-nav`}
            aria-label="Show navigation"
            aria-keyshortcuts="["
            title="Show navigation ( [ )"
            onClick={() => props.onShowNav?.()}
          >
            <PanelLeftOpen size={16} aria-hidden="true" />
          </button>
        </Show>
        {props.children}
      </main>
      <Show when={isCompact()}>{props.dock}</Show>
    </div>
  );
}

/** The nav's right edge: drag it, or focus it and use the keys, to resize the nav. */
function NavResizer(props: { width: number; onResize: (width: number, done: boolean) => void; onFolding: (folding: boolean) => void; onHide: () => void }) {
  const [dragging, setDragging] = createSignal(false);
  let startX = 0;
  let startWidth = 0;
  let wanted = 0;
  let frame: number | undefined;

  const stopFrame = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
  const release = () => {
    stopFrame();
    setDragging(false);
    props.onFolding(false);
    document.documentElement.classList.remove("nav-resizing");
  };
  onCleanup(release);

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    startX = event.clientX;
    startWidth = props.width;
    wanted = startWidth;
    setDragging(true);
    document.documentElement.classList.add("nav-resizing");
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging()) return;
    wanted = startWidth + event.clientX - startX;
    props.onFolding(wanted < NAV_COLLAPSE_AT);
    // One layout per frame, however fast the pointer reports.
    frame ??= requestAnimationFrame(() => {
      frame = undefined;
      props.onResize(wanted, false);
    });
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (!dragging()) return;
    const cancelled = event.type === "pointercancel";
    release();
    if (cancelled) return props.onResize(startWidth, true);
    if (wanted < NAV_COLLAPSE_AT) {
      // Folded away: it comes back at the width it had before this drag.
      props.onResize(startWidth, true);
      props.onHide();
      return;
    }
    props.onResize(wanted, true);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 48 : 16;
    const next =
      event.key === "ArrowLeft" ? props.width - step
      : event.key === "ArrowRight" ? props.width + step
      : event.key === "Home" ? NAV_WIDTH_MIN
      : event.key === "End" ? NAV_WIDTH_MAX
      : null;
    if (next === null) return;
    event.preventDefault();
    props.onResize(next, true);
  };

  return (
    <div
      class="shell-nav-resize"
      classList={{ "shell-nav-resize--active": dragging() }}
      role="separator"
      aria-orientation="vertical"
      aria-controls="shell-nav"
      aria-label="Resize navigation"
      aria-valuenow={props.width}
      aria-valuemin={NAV_WIDTH_MIN}
      aria-valuemax={NAV_WIDTH_MAX}
      tabindex="0"
      title="Drag to resize, double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDblClick={() => props.onResize(NAV_WIDTH_DEFAULT, true)}
      onKeyDown={onKeyDown}
    />
  );
}
