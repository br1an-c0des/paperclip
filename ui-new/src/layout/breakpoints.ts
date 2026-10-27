import { createSignal, onCleanup } from "solid-js";

/*
 * Every viewport breakpoint ui-new uses, in one place (build plan, decision H).
 *
 * CSS can't read custom properties inside @media, so the app doesn't write viewport widths in CSS
 * at all. `watchViewport()` puts the current size on <html> as `data-viewport`, and stylesheets
 * select on that instead:
 *
 *   :root[data-viewport="phone"] .shell { ... }
 *
 * Components inside the shell respond to their container (`@container`), not to these.
 *
 * The desktop boards are drawn at 1440px and the phone boards at 390px (design/mobile.md). "phone"
 * carries the structural switches: the floating dock in place of the left nav, panels as
 * full-screen pages, and dialogs and menus as sheets. "tablet" keeps the desktop layout for now.
 */

export type Viewport = "phone" | "tablet" | "desktop";

/** Minimum widths, in CSS pixels. A viewport is the largest entry it reaches. */
export const BREAKPOINTS = {
  tablet: 760,
  desktop: 1100,
} as const;

/** Media queries for the same breakpoints, for code that needs `matchMedia`. */
export const MEDIA = {
  tablet: `(min-width: ${BREAKPOINTS.tablet}px)`,
  desktop: `(min-width: ${BREAKPOINTS.desktop}px)`,
  /** Touch-first devices. Anything shown on hover needs another way in (build plan, decision H). */
  noHover: "(hover: none)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
} as const;

function currentViewport(): Viewport {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia(MEDIA.desktop).matches) return "desktop";
  if (window.matchMedia(MEDIA.tablet).matches) return "tablet";
  return "phone";
}

const [viewport, setViewport] = createSignal<Viewport>(currentViewport());

/** The current viewport, as a signal. */
export { viewport };

/** True when the layout should use full-screen sheets instead of anchored layers. */
export const isCompact = () => viewport() === "phone";

/**
 * Keeps `viewport()` and `<html data-viewport>` in step with the window. Call once, from the app
 * root.
 */
export function watchViewport() {
  const root = document.documentElement;
  const update = () => {
    const next = currentViewport();
    setViewport(next);
    root.dataset.viewport = next;
  };
  update();
  const queries = [MEDIA.tablet, MEDIA.desktop].map((query) => window.matchMedia(query));
  for (const query of queries) query.addEventListener("change", update);
  onCleanup(() => {
    for (const query of queries) query.removeEventListener("change", update);
  });
}
