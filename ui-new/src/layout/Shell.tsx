import { ChevronsLeft, ChevronsRight, PanelLeftOpen } from "lucide-solid";
import { batch, createEffect, createSignal, on, onCleanup, onMount, Show, type JSX, type ParentProps } from "solid-js";
import { buttonClass } from "@/ui/Button";
import { ScrollCapsule } from "@/ui/ScrollCapsule";
import { isCompact, MEDIA } from "./breakpoints";
import { dockBeside } from "./panel-model";
import { ShellDockContext } from "./Panel";
import { NAV_RAIL_WIDTH, NAV_WIDTH_DEFAULT, NAV_WIDTH_MAX, NAV_WIDTH_MIN, navDragHint, navDrop, navKeyDrop, type NavDrop, type NavMode } from "./nav-model";
import "./Shell.css";

/*
 * The app shell: a grid with named areas, nav and main. Nothing in it has a fixed page width; the
 * nav column is the only fixed track (248px by default, 68px as the rail), and main is
 * `minmax(0, 1fr)`. Side panels dock beside the list they were opened from, inside main (<Dock> in
 * Panel.tsx).
 *
 * The nav slot holds the full nav (`nav`) or, folded, the icon rail (`rail`, NavRail.tsx), as
 * `navMode` says. App settings and Company settings put their own sidebar in the slot
 * (SettingsNav.tsx), with the same width, handle and hiding but no rail (`canRail` off): the
 * settings sidebar stays full width while the main nav is a rail.
 *
 * Folding to the rail, the labels fade first (90ms, `data-fold="out"` on the nav; Nav.css), then the
 * column narrows over 200ms with the rail in it (`data-fold="narrow"`); expanding runs it backwards,
 * width first (`"widen"`), then the labels (`"in"`). With reduced motion it switches at once, and so
 * does a change of what the slot holds (`navKey`: entering or leaving settings) and a drag that
 * snapped (the drag was the motion).
 *
 * `navHidden` (Shift+`[`, or Hide navigation in the You menu) drops the nav column; a button at the
 * top left of main brings it back, full or rail as it was.
 *
 * The nav's right edge is the seam: a handle (`role="separator"`) that resizes the full nav between
 * 200 and 420px. Drag it, or focus it and use the arrow keys (Shift for bigger steps), Home and End.
 * A double click goes back to 248px. Dragging under 200px snaps to the rail on release, and well past
 * that, under 40px, hides the nav; dragging the rail's edge past 140px opens the full nav at its
 * last width (nav-model.ts `navDrop`). While a drag would snap or hide, the nav dims to say so. Point
 * at the seam and a round tab appears on it, chevrons left on the full nav and right on the rail,
 * that folds and unfolds it (as `[` does).
 *
 * On a phone-sized viewport the grid drops to one column and the left nav gives way to the floating
 * dock (design/mobile.md, N1; PhoneDock.tsx), which floats over the foot of main; panels become
 * full-screen pages (Panel.tsx). Only the shell switches; components inside it don't change.
 *
 * `main` is a size container named `main`, so content responds to the space it's given with
 * `@container main (...)`, not to the viewport.
 *
 * A <Dock>'s panel (Panel.tsx) goes into the shell's dock column, after main. While one is there on
 * tablet and desktop, the shell splits (`shell--split`): it takes the window's height and no more,
 * so the page itself doesn't scroll; main scrolls on its own, header, toolbar and list together;
 * and the panel fills the column from main's top padding to the same gap at the bottom, scrolling
 * inside. With room for both (panel-model.ts `dockBeside`), the column sits beside main
 * (`shell--beside`); without, it lies over main's right edge. Main picks up the page's scroll
 * position as it splits, and hands it back when the panel closes on the same page. While split, main
 * and the panel's frames show the scroll capsule in place of their scrollbars (ui/ScrollCapsule.tsx):
 * main's runs down its right edge, or, while the panel lies over that edge, just left of the panel.
 */

/** The fold's two steps (Shell.css and Nav.css keep the same timings). */
const LABELS_MS = 90;
const COLUMN_MS = 200;

type FoldPhase = "out" | "narrow" | "widen" | "in";

const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MEDIA.reducedMotion).matches;

/**
 * What the nav slot shows (`shown`) and which width its column takes (`column`) while it folds
 * toward `target`, in steps: labels out, then the column; or the column, then labels in.
 */
function createNavFold(target: () => NavMode, key: () => string | undefined) {
  const [shown, setShown] = createSignal<NavMode>(target());
  const [column, setColumn] = createSignal<NavMode>(target());
  const [phase, setPhase] = createSignal<FoldPhase | null>(null);
  let timer: number | undefined;
  let instantNext = false;
  let lastSlot = key();
  const stop = () => window.clearTimeout(timer);
  onCleanup(stop);

  createEffect(
    on(
      [target, key] as const,
      ([mode, slot]) => {
        stop();
        const instant = instantNext || reducedMotion() || lastSlot !== slot;
        instantNext = false;
        lastSlot = slot;
        if (instant || (mode === shown() && mode === column())) {
          batch(() => {
            setShown(mode);
            setColumn(mode);
            setPhase(null);
          });
          return;
        }
        if (mode === "rail") {
          setPhase("out");
          timer = window.setTimeout(() => {
            batch(() => {
              setShown("rail");
              setColumn("rail");
              setPhase("narrow");
            });
            timer = window.setTimeout(() => setPhase(null), COLUMN_MS);
          }, LABELS_MS);
        } else {
          batch(() => {
            setColumn("full");
            setPhase("widen");
          });
          timer = window.setTimeout(() => {
            batch(() => {
              setShown("full");
              setPhase("in");
            });
            timer = window.setTimeout(() => setPhase(null), LABELS_MS);
          }, COLUMN_MS);
        }
      },
      { defer: true },
    ),
  );

  return {
    shown,
    column,
    phase,
    /** The next change switches at once (a drag that snapped). */
    skipNext: () => (instantNext = true),
  };
}

export function Shell(
  props: ParentProps<{
    /** The left nav, on tablet and desktop: the main nav, or in settings the settings sidebar. */
    nav: JSX.Element;
    /** The main nav folded to its icons (NavRail.tsx), shown while `navMode` is "rail". */
    rail?: JSX.Element;
    /** Full or the rail (full by default). */
    navMode?: NavMode;
    /** Whether the slot can fold to the rail now (not in settings): the seam's tab, and drags that snap. */
    canRail?: boolean;
    /** What the slot holds (the main nav, or a settings area); a change switches without the fold motion. */
    navKey?: string;
    /** Switch full or rail: the seam's tab, a drag that snapped, or a key on the handle. */
    onNavMode?: (mode: NavMode) => void;
    /** The nav landmark's name ("Main" by default). */
    navLabel?: string;
    /** The floating dock that replaces the nav on a phone. */
    dock?: JSX.Element;
    navHidden?: boolean;
    onShowNav?: () => void;
    /** The full nav's width in pixels (248 by default). */
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
  const [hint, setHint] = createSignal<"rail" | "full" | "hide" | null>(null);
  const fold = createNavFold(
    () => (props.canRail === false ? "full" : (props.navMode ?? "full")),
    () => props.navKey,
  );
  const columnWidth = () => (fold.column() === "rail" ? NAV_RAIL_WIDTH : (props.navWidth ?? NAV_WIDTH_DEFAULT));
  const toggle = () => props.onNavMode?.(fold.shown() === "rail" ? "full" : "rail");

  // The dock column (above): how many panels are docked in it, and whether it fits beside main.
  let shellEl: HTMLDivElement | undefined;
  let mainEl: HTMLElement | undefined;
  const [dockHost, setDockHost] = createSignal<HTMLElement>();
  const [holds, setHolds] = createSignal(0);
  const [shellWidth, setShellWidth] = createSignal(typeof window === "undefined" ? 0 : window.innerWidth);
  const split = () => !isCompact() && holds() > 0;
  const beside = () => dockBeside(shellWidth(), columnWidth(), Boolean(bare()));
  const dock = {
    host: () => (isCompact() ? undefined : dockHost()),
    hold: () => {
      setHolds((count) => count + 1);
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        setHolds((count) => count - 1);
      };
    },
  };

  onMount(() => {
    if (!shellEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setShellWidth(entry.contentRect.width));
    observer.observe(shellEl);
    onCleanup(() => observer.disconnect());
  });

  // The split class is set here, not in `classList`, so the scroll position can move across in the
  // same step: read before the layout changes, written after.
  let splitPath: string | undefined;
  // Main's scroll capsule comes and goes with the class, once main scrolls on its own.
  const [splitOn, setSplitOn] = createSignal(false);
  createEffect(
    on(
      split,
      (now) => {
        if (!shellEl || !mainEl) return;
        if (now) {
          const y = window.scrollY;
          shellEl.classList.add("shell--split");
          mainEl.scrollTop = y;
          splitPath = window.location.pathname;
          setSplitOn(true);
        } else {
          setSplitOn(false);
          const y = mainEl.scrollTop;
          shellEl.classList.remove("shell--split");
          // Only on the same page: a link elsewhere starts its page at the top.
          if (window.location.pathname === splitPath) window.scrollTo(0, y);
          splitPath = undefined;
        }
      },
      { defer: true },
    ),
  );

  const drop = (result: NavDrop, startWidth: number) => {
    switch (result.kind) {
      case "width":
        return props.onNavWidth?.(result.width, true);
      case "rail":
      case "full":
        // Snapped by a drag: the full nav comes back at the width it had before.
        if (fold.shown() === "full") props.onNavWidth?.(startWidth, true);
        fold.skipNext();
        return props.onNavMode?.(result.kind);
      case "hide":
        if (fold.shown() === "full") props.onNavWidth?.(startWidth, true);
        return props.onHideNav?.();
    }
  };

  return (
    <ShellDockContext.Provider value={dock}>
      <div
        ref={shellEl}
        class="shell"
        classList={{
          "shell--beside": beside(),
          "shell--bare": bare(),
          "shell--nodock": props.noDock,
          "shell--rail": fold.column() === "rail",
          "shell--sliding": fold.phase() === "narrow" || fold.phase() === "widen",
          [`shell--hint-${hint()}`]: hint() !== null,
        }}
        style={{ "--nav-w": `${columnWidth()}px` }}
      >
        <Show when={!isCompact() && !props.navHidden}>
          <nav class="shell-nav" id="shell-nav" aria-label={props.navLabel ?? "Main"} data-mode={fold.shown()} data-fold={fold.phase() ?? undefined}>
            <Show when={fold.shown() === "rail"} fallback={props.nav}>
              {props.rail}
            </Show>
          </nav>
          <Show when={props.onNavWidth}>
            <div class="shell-seam">
              <NavResizer
                mode={fold.shown()}
                width={props.navWidth ?? NAV_WIDTH_DEFAULT}
                canRail={props.canRail !== false && !!props.onNavMode}
                onResize={(width) => props.onNavWidth?.(width, false)}
                onHint={setHint}
                onDrop={drop}
                onReset={() => {
                  props.onNavWidth?.(NAV_WIDTH_DEFAULT, true);
                  if (fold.shown() === "rail") props.onNavMode?.("full");
                }}
              />
              <Show when={props.canRail !== false && props.onNavMode}>
                <button
                  type="button"
                  class="shell-seam-tab"
                  aria-label={fold.shown() === "rail" ? "Expand sidebar" : "Collapse sidebar"}
                  aria-keyshortcuts="["
                  aria-controls="shell-nav"
                  title={fold.shown() === "rail" ? "Expand sidebar ( [ )" : "Collapse sidebar ( [ )"}
                  onClick={toggle}
                >
                  <Show when={fold.shown() === "rail"} fallback={<ChevronsLeft size={14} stroke-width={2.2} aria-hidden="true" />}>
                    <ChevronsRight size={14} stroke-width={2.2} aria-hidden="true" />
                  </Show>
                </button>
              </Show>
            </div>
          </Show>
        </Show>
        <main ref={mainEl} class="shell-main">
          <Show when={bare()}>
            <button
              type="button"
              class={`${buttonClass({ variant: "icon", ghost: true })} shell-show-nav`}
              aria-label="Show navigation"
              aria-keyshortcuts="Shift+[ ["
              title="Show navigation ( Shift [ )"
              onClick={() => props.onShowNav?.()}
            >
              <PanelLeftOpen size={16} aria-hidden="true" />
            </button>
          </Show>
          {props.children}
        </main>
        <Show when={splitOn() && mainEl}>
          {(main) => (
            <ScrollCapsule
              scroller={main()}
              class="shell-main-capsule"
              // Lying over main, the panel covers its right edge: the capsule sits just left of it.
              right={() => (beside() ? undefined : (dockHost()?.getBoundingClientRect().left ?? Infinity) - 4)}
            />
          )}
        </Show>
        <Show when={!isCompact()}>
          <div ref={setDockHost} class="shell-dock" />
        </Show>
        <Show when={isCompact()}>{props.dock}</Show>
      </div>
    </ShellDockContext.Provider>
  );
}

/**
 * The nav's right edge: drag it, or focus it and use the keys, to resize the full nav, snap it to
 * the rail or hide it, or open the rail out to the full nav (nav-model.ts `navDrop`, `navKeyDrop`).
 */
function NavResizer(props: {
  mode: NavMode;
  width: number;
  canRail: boolean;
  onResize: (width: number) => void;
  onHint: (hint: "rail" | "full" | "hide" | null) => void;
  onDrop: (result: NavDrop, startWidth: number) => void;
  onReset: () => void;
}) {
  const [dragging, setDragging] = createSignal(false);
  let startX = 0;
  let startWidth = 0;
  let from: NavMode = "full";
  let wanted = 0;
  let frame: number | undefined;

  const stopFrame = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
  const release = () => {
    stopFrame();
    setDragging(false);
    props.onHint(null);
    document.documentElement.classList.remove("nav-resizing");
  };
  onCleanup(release);

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    startX = event.clientX;
    from = props.mode;
    startWidth = props.width;
    wanted = from === "rail" ? NAV_RAIL_WIDTH : startWidth;
    setDragging(true);
    document.documentElement.classList.add("nav-resizing");
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging()) return;
    wanted = (from === "rail" ? NAV_RAIL_WIDTH : startWidth) + event.clientX - startX;
    props.onHint(navDragHint(from, wanted, props.canRail));
    // The full nav follows the pointer (down to its narrowest); the rail stays until you let go.
    // One layout per frame, however fast the pointer reports.
    if (from === "full") {
      frame ??= requestAnimationFrame(() => {
        frame = undefined;
        props.onResize(wanted);
      });
    }
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (!dragging()) return;
    const cancelled = event.type === "pointercancel";
    release();
    if (cancelled) {
      if (from === "full") props.onDrop({ kind: "width", width: startWidth }, startWidth);
      return;
    }
    props.onDrop(navDrop(from, wanted, props.canRail), startWidth);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const result = navKeyDrop(props.mode, props.width, event.key, event.shiftKey, props.canRail);
    if (!result) return;
    event.preventDefault();
    props.onDrop(result, props.width);
  };

  return (
    <div
      class="shell-nav-resize"
      classList={{ "shell-nav-resize--active": dragging() }}
      role="separator"
      aria-orientation="vertical"
      aria-controls="shell-nav"
      aria-label="Resize navigation"
      aria-valuenow={props.mode === "rail" ? NAV_RAIL_WIDTH : props.width}
      aria-valuemin={props.canRail ? NAV_RAIL_WIDTH : NAV_WIDTH_MIN}
      aria-valuemax={NAV_WIDTH_MAX}
      tabindex="0"
      title={props.mode === "rail" ? "Drag right to expand, double-click to reset" : "Drag to resize, double-click to reset"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDblClick={() => props.onReset()}
      onKeyDown={onKeyDown}
    />
  );
}
