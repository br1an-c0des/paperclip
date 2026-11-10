import { createSignal, onCleanup } from "solid-js";

/*
 * The scroll capsule's logic, shared by the two ways it's shown (ScrollList.css, ScrollCapsule.css):
 *
 * - ScrollList.tsx, a list that owns its scroller and wraps it in a frame (the left nav's lists).
 * - ScrollCapsule.tsx, an overlay laid over a scroller that's already there and scrolls itself
 *   (main and the docked panel while the shell is split, Shell.tsx and Panel.tsx).
 *
 * `capsuleMetrics` and `scrollTopForThumb` are the arithmetic; `watchScroll` keeps a marker element
 * in step with a scroller; `createCapsuleDrag` drives a rail you can drag the capsule along or click.
 */

/** How long `data-scrolling` stays on after the last scroll, in ms. */
export const SCROLLING_MS = 900;
/** The capsule never gets shorter than this, in px, so there's always something to grab. */
export const MIN_THUMB = 24;

export type ScrollBox = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

/**
 * Where the capsule sits on a rail `track` px tall: its size and offset, and whether there's more
 * above and below. A scroller with nothing to scroll gets a capsule as long as the track.
 */
export function capsuleMetrics(box: ScrollBox, track: number) {
  const max = box.scrollHeight - box.clientHeight;
  const length = Math.max(0, track);
  const scrolls = max > 1 && box.scrollHeight > 0;
  const thumb = scrolls ? Math.max(MIN_THUMB, (length * box.clientHeight) / box.scrollHeight) : length;
  const top = scrolls ? Math.max(0, Math.min(length - thumb, ((length - thumb) * box.scrollTop) / max)) : 0;
  return {
    moreAbove: box.scrollTop > 1,
    moreBelow: max - box.scrollTop > 1,
    thumb,
    top,
  };
}

/**
 * The scroll position that puts the capsule's top at `y` within a rail `track` px tall, or null
 * when the capsule fills the rail and there's nowhere to move it.
 */
export function scrollTopForThumb(y: number, box: Omit<ScrollBox, "scrollTop">, track: number): number | null {
  if (box.scrollHeight <= 0) return null;
  const thumb = Math.max(MIN_THUMB, (track * box.clientHeight) / box.scrollHeight);
  const room = track - thumb;
  if (room <= 0) return null;
  return (Math.min(room, Math.max(0, y)) / room) * (box.scrollHeight - box.clientHeight);
}

/**
 * Keeps `marker()` in step with how `scroller` is scrolled: `data-more-above`, `data-more-below`,
 * `data-scrolling` just after a scroll, and the capsule's `--thumb-size` and `--thumb-top`. The
 * rail is `track()` px tall, by default the scroller's height less 4px at either end (ScrollList).
 *
 * Content that grows or shrinks is caught by a ResizeObserver on the scroller and its children,
 * and a MutationObserver for children coming and going; measuring is batched to one per frame.
 * `beforeMeasure` runs first in that frame, for an overlay to follow the scroller's box. Returns
 * `refresh`, to measure again on the next frame. Stops when the owner is cleaned up.
 */
export function watchScroll(
  scroller: HTMLElement,
  marker: () => HTMLElement | undefined = () => scroller,
  options: { track?: () => number; beforeMeasure?: () => void } = {},
) {
  let pending: number | undefined;
  let idle: number | undefined;

  const measure = () => {
    pending = undefined;
    options.beforeMeasure?.();
    const target = marker();
    if (!target) return;
    const track = options.track ? options.track() : scroller.clientHeight - 8;
    const metrics = capsuleMetrics(scroller, track);
    target.toggleAttribute("data-more-above", metrics.moreAbove);
    target.toggleAttribute("data-more-below", metrics.moreBelow);
    target.style.setProperty("--thumb-size", `${metrics.thumb.toFixed(1)}px`);
    target.style.setProperty("--thumb-top", `${metrics.top.toFixed(1)}px`);
  };
  const refresh = () => {
    pending ??= requestAnimationFrame(measure);
  };
  const onScroll = () => {
    refresh();
    const target = marker();
    if (!target) return;
    target.setAttribute("data-scrolling", "");
    window.clearTimeout(idle);
    idle = window.setTimeout(() => target.removeAttribute("data-scrolling"), SCROLLING_MS);
  };
  scroller.addEventListener("scroll", onScroll, { passive: true });

  // Without ResizeObserver (an old browser, the test DOM) this follows scrolling only.
  const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
  const watchRows = () => {
    if (!sizes) return;
    sizes.disconnect();
    sizes.observe(scroller);
    for (const row of scroller.children) sizes.observe(row);
  };
  const rows = new MutationObserver(() => {
    watchRows();
    refresh();
  });
  rows.observe(scroller, { childList: true });
  watchRows();
  refresh();

  onCleanup(() => {
    scroller.removeEventListener("scroll", onScroll);
    sizes?.disconnect();
    rows.disconnect();
    if (pending !== undefined) cancelAnimationFrame(pending);
    window.clearTimeout(idle);
  });

  return { refresh };
}

/**
 * A rail you can drag the capsule along, or click to jump there: on the capsule, it keeps hold of
 * it where you grabbed it; on the track, it centres the capsule there. The capsule's size and
 * offset are read from `marker()`'s `--thumb-size` and `--thumb-top` (`watchScroll`).
 */
export function createCapsuleDrag(parts: {
  scroller: () => HTMLElement | undefined;
  rail: () => HTMLElement | undefined;
  marker: () => HTMLElement | undefined;
}) {
  const [dragging, setDragging] = createSignal(false);
  let grabOffset = 0;

  const read = (name: string) => {
    const marker = parts.marker();
    return marker ? parseFloat(marker.style.getPropertyValue(name)) || 0 : 0;
  };
  const scrollToThumb = (y: number) => {
    const scroller = parts.scroller();
    const rail = parts.rail();
    if (!scroller || !rail) return;
    const next = scrollTopForThumb(y, scroller, rail.clientHeight);
    if (next !== null) scroller.scrollTop = next;
  };

  const onPointerDown = (event: PointerEvent) => {
    const rail = parts.rail();
    if (event.button !== 0 || !rail) return;
    event.preventDefault();
    const y = event.clientY - rail.getBoundingClientRect().top;
    const top = read("--thumb-top");
    const size = read("--thumb-size");
    const onThumb = y >= top && y <= top + size;
    grabOffset = onThumb ? y - top : size / 2;
    if (!onThumb) scrollToThumb(y - grabOffset);
    rail.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent) => {
    const rail = parts.rail();
    if (!dragging() || !rail) return;
    scrollToThumb(event.clientY - rail.getBoundingClientRect().top - grabOffset);
  };
  const onPointerUp = () => setDragging(false);

  return { dragging, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}
