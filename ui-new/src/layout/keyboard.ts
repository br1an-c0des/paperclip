import "./keyboard.css";

/*
 * Composers above the on-screen keyboard (U166, upstream #19725): on a tablet or a phone the
 * keyboard covers the bottom of the page without resizing it. Safari and Chrome shrink only the
 * visual viewport, so `100dvh` boxes (the docked task panel, the task page's sections, the task
 * modal) keep their composer under the keyboard, and the chat's sticky composer sticks to an edge
 * the keyboard hides.
 *
 * `watchKeyboard()` follows `window.visualViewport`. While the keyboard is open it puts
 * `data-keyboard="open"` on <html>, with the visible area as `--vv-height` and `--vv-top` and the
 * height the keyboard covers below it as `--keyboard-inset`; keyboard.css sizes those boxes to the
 * visible area with them. A pinch zoom releases it all: a zoomed-in viewport is small because of
 * the zoom, not a keyboard, and the page goes back to its own sizes until the zoom ends.
 *
 * Safari can pan the page to the focused field before the resize arrives. Once the page fits the
 * visible area, the pan is undone, so the box starts at the top of what you see. On a page that
 * scrolls (the task page, under its header), the page scrolls just enough to show the composer
 * you're typing in when the keyboard opens, and its card, now the visible area's height, fits.
 */

/** The composers kept in view: the task thread's and the agent chat's. */
const COMPOSERS = ".ta-compose, .ch-foot";

/** A visual viewport this much shorter than the layout viewport means a keyboard, not browser chrome. */
export const KEYBOARD_MIN_PX = 120;

export type ViewportReading = {
  /** The layout viewport's height (`documentElement.clientHeight`). */
  layoutHeight: number;
  height: number;
  offsetTop: number;
  scale: number;
};

export type KeyboardState = { height: number; top: number; inset: number };

/** The visible area while the keyboard is open, or null when it's closed or the page is zoomed. */
export function keyboardState(reading: ViewportReading): KeyboardState | null {
  const { layoutHeight, height, offsetTop, scale } = reading;
  if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(layoutHeight) || layoutHeight <= 0) return null;
  if (Math.abs(scale - 1) > 0.01) return null;
  if (layoutHeight - height <= KEYBOARD_MIN_PX) return null;
  const top = Math.max(0, Number.isFinite(offsetTop) ? offsetTop : 0);
  return { height: Math.round(height), top: Math.round(top), inset: Math.max(0, Math.round(layoutHeight - top - height)) };
}

const VARS = ["--vv-height", "--vv-top", "--keyboard-inset"] as const;

let stop: (() => void) | null = null;

/** Starts following the keyboard, once for the app; answers a function that stops it. */
export function watchKeyboard(): () => void {
  if (stop) return stop;
  const viewport = typeof window === "undefined" ? null : window.visualViewport;
  if (!viewport) return () => {};
  const root = document.documentElement;
  const release = () => {
    if (root.dataset.keyboard === undefined) return;
    delete root.dataset.keyboard;
    for (const name of VARS) root.style.removeProperty(name);
  };
  const restorePosition = () => {
    if (root.dataset.keyboard !== "open") return;
    const page = document.scrollingElement ?? root;
    // Only a page that fits what you see: a longer one scrolls as usual.
    if (page.scrollTop !== 0 && page.scrollHeight <= viewport.height + 1) page.scrollTop = 0;
  };
  /** Scrolls the page so the composer holding the focus ends at the visible area's foot. */
  const keepComposerInView = () => {
    if (root.dataset.keyboard !== "open") return;
    const box = document.activeElement instanceof Element ? document.activeElement.closest(COMPOSERS) : null;
    if (!box) return;
    const below = box.getBoundingClientRect().bottom - (viewport.offsetTop + viewport.height);
    if (below > 1) (document.scrollingElement ?? root).scrollTop += Math.ceil(below);
  };
  const update = () => {
    const state = keyboardState({ layoutHeight: root.clientHeight, height: viewport.height, offsetTop: viewport.offsetTop, scale: viewport.scale });
    if (!state) return release();
    const opening = root.dataset.keyboard !== "open";
    root.dataset.keyboard = "open";
    root.style.setProperty("--vv-height", `${state.height}px`);
    root.style.setProperty("--vv-top", `${state.top}px`);
    root.style.setProperty("--keyboard-inset", `${state.inset}px`);
    restorePosition();
    // Only as it opens: once open, scrolling the page is yours.
    if (opening) keepComposerInView();
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  // Without capture: scrolls inside the thread or a field never reach this.
  document.addEventListener("scroll", restorePosition);
  document.addEventListener("focusin", keepComposerInView);
  stop = () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    document.removeEventListener("scroll", restorePosition);
    document.removeEventListener("focusin", keepComposerInView);
    release();
    stop = null;
  };
  return stop;
}
