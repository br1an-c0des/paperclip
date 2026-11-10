import { createSignal, onCleanup, type ParentProps } from "solid-js";
import "./ScrollList.css";

/*
 * A list that scrolls on its own, without the browser's scrollbar. The left nav's sections use it,
 * each scrolling independently.
 *
 *   <ScrollList class="nav-list">…rows…</ScrollList>
 *
 * Two looks, by how you point (ScrollList.css):
 *
 * - **Mouse or trackpad: the scroll capsule.** A slim capsule in the ion gradient on the list's
 *   right edge shows how much of the list is in view and where. It appears while you point at the
 *   list or scroll it. Drag it to scroll, or click its track to jump there.
 * - **Touch: the ion edge glow.** No capsule to reach for; instead a hairline in the ion gradient
 *   glows at an edge with more beyond it, and the rows fade out just before it.
 *
 * The frame doesn't scroll, so it carries the capsule and the glows. It's marked `data-more-above`
 * and `data-more-below` while there's more that way and `data-scrolling` just after a scroll, with
 * the capsule's size and offset in `--thumb-size` and `--thumb-top`. Content that grows or shrinks
 * is caught by a ResizeObserver on the list and its rows, and a MutationObserver for rows coming
 * and going; measuring is batched to one per frame.
 */

const SCROLLING_MS = 900;
const MIN_THUMB = 24;

export function ScrollList(props: ParentProps<{ class?: string }>) {
  let frame: HTMLDivElement | undefined;
  let body: HTMLDivElement | undefined;
  let rail: HTMLDivElement | undefined;
  const [dragging, setDragging] = createSignal(false);
  let grabOffset = 0;

  /** Scrolls so the capsule's top sits at `y` within the rail. */
  const scrollToThumb = (y: number) => {
    if (!body || !rail) return;
    const track = rail.clientHeight;
    const thumb = Math.max(MIN_THUMB, (track * body.clientHeight) / body.scrollHeight);
    const room = track - thumb;
    if (room <= 0) return;
    body.scrollTop = (Math.min(room, Math.max(0, y)) / room) * (body.scrollHeight - body.clientHeight);
  };
  const thumbTop = () => (frame ? parseFloat(frame.style.getPropertyValue("--thumb-top")) || 0 : 0);
  const thumbSize = () => (frame ? parseFloat(frame.style.getPropertyValue("--thumb-size")) || 0 : 0);

  const onRailDown = (event: PointerEvent) => {
    if (event.button !== 0 || !rail) return;
    event.preventDefault();
    const y = event.clientY - rail.getBoundingClientRect().top;
    const onThumb = y >= thumbTop() && y <= thumbTop() + thumbSize();
    // On the capsule: keep hold of it where you grabbed it. On the track: centre it there.
    grabOffset = onThumb ? y - thumbTop() : thumbSize() / 2;
    if (!onThumb) scrollToThumb(y - grabOffset);
    rail.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onRailMove = (event: PointerEvent) => {
    if (!dragging() || !rail) return;
    scrollToThumb(event.clientY - rail.getBoundingClientRect().top - grabOffset);
  };
  const onRailUp = () => setDragging(false);

  return (
    <div ref={frame} class="scroll-list" classList={{ "scroll-list--dragging": dragging() }}>
      <div
        ref={(element) => {
          body = element;
          watchScroll(element, () => frame);
        }}
        class={props.class ? `scroll-list-body ${props.class}` : "scroll-list-body"}
      >
        {props.children}
      </div>
      {/* The capsule repeats what scrolling, the wheel and the keys already do, so it's hidden from assistive tech. */}
      <div ref={rail} class="scroll-list-rail" aria-hidden="true" onPointerDown={onRailDown} onPointerMove={onRailMove} onPointerUp={onRailUp} onPointerCancel={onRailUp}>
        <div class="scroll-list-thumb" />
      </div>
    </div>
  );
}

/**
 * Keeps `marker()` in step with how `scroller` is scrolled: `data-more-above`, `data-more-below`,
 * `data-scrolling`, and the capsule's `--thumb-size` and `--thumb-top` for a rail as tall as the
 * scroller less 4px at either end.
 */
export function watchScroll(scroller: HTMLElement, marker: () => HTMLElement | undefined = () => scroller) {
  let pending: number | undefined;
  let idle: number | undefined;

  const measure = () => {
    pending = undefined;
    const target = marker();
    if (!target) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    target.toggleAttribute("data-more-above", scroller.scrollTop > 1);
    target.toggleAttribute("data-more-below", max - scroller.scrollTop > 1);
    const track = Math.max(0, scroller.clientHeight - 8);
    const thumb = max > 1 ? Math.max(MIN_THUMB, (track * scroller.clientHeight) / scroller.scrollHeight) : track;
    const top = max > 1 ? ((track - thumb) * scroller.scrollTop) / max : 0;
    target.style.setProperty("--thumb-size", `${thumb.toFixed(1)}px`);
    target.style.setProperty("--thumb-top", `${top.toFixed(1)}px`);
  };
  const schedule = () => {
    pending ??= requestAnimationFrame(measure);
  };
  const onScroll = () => {
    schedule();
    const target = marker();
    if (!target) return;
    target.setAttribute("data-scrolling", "");
    window.clearTimeout(idle);
    idle = window.setTimeout(() => target.removeAttribute("data-scrolling"), SCROLLING_MS);
  };
  scroller.addEventListener("scroll", onScroll, { passive: true });

  // Without ResizeObserver (an old browser, the test DOM) this follows scrolling only.
  const sizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  const watchRows = () => {
    if (!sizes) return;
    sizes.disconnect();
    sizes.observe(scroller);
    for (const row of scroller.children) sizes.observe(row);
  };
  const rows = new MutationObserver(() => {
    watchRows();
    schedule();
  });
  rows.observe(scroller, { childList: true });
  watchRows();
  schedule();

  onCleanup(() => {
    scroller.removeEventListener("scroll", onScroll);
    sizes?.disconnect();
    rows.disconnect();
    if (pending !== undefined) cancelAnimationFrame(pending);
    window.clearTimeout(idle);
  });
}
