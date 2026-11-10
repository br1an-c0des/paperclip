import { onCleanup, onMount } from "solid-js";
import { createCapsuleDrag, watchScroll } from "./scroll-capsule";
import "./ScrollList.css";

/*
 * The scroll capsule (ScrollList.tsx), laid over a scroller that's already there and scrolls
 * itself, in place of its native scrollbar. Main and the docked panel's frames use it while the
 * shell is split (Shell.tsx, Panel.tsx).
 *
 *   <ScrollCapsule scroller={mainEl} />
 *
 * It renders a frame that follows the scroller's box, placed by measuring rather than by layout,
 * so it can sit anywhere whose positioned ancestor doesn't scroll: beside the scroller in a grid,
 * or at the root of a panel. It measures again when the scroller or its content changes size, on
 * a window resize and when you point at it; for a scroller that can move without changing size,
 * put the capsule in a positioned ancestor that moves with it (the docked panel, Shell.css). The frame lets pointers through; only its rail takes them, and only
 * while it's shown. The rail runs down the scroller's right edge, over its padding, as a native
 * scrollbar would. Same two looks as ScrollList (ScrollList.css): on mouse or trackpad, the capsule
 * appears while you point at the scroller or scroll it, and you can drag it or click its track; on
 * touch, the ion edge glow instead.
 *
 * The frame carries `data-more-above`, `data-more-below`, `data-scrolling` and `data-hover`, and the
 * scroller `data-scroll-capsule` while it's attached, which hides its native scrollbar. The
 * scroller is read once: give a new one a new ScrollCapsule (a keyed <For>, as Panel.tsx does).
 * `right`, when given, is how far right (in viewport px) the scroller shows, for one partly covered
 * by something beside it (main under a panel that lies over it, Shell.tsx).
 */

export function ScrollCapsule(props: { scroller: HTMLElement; class?: string; right?: () => number | undefined }) {
  let frame: HTMLDivElement | undefined;
  let rail: HTMLDivElement | undefined;
  const scroller = props.scroller;
  const { dragging, handlers } = createCapsuleDrag({ scroller: () => scroller, rail: () => rail, marker: () => frame });

  /** Moves the frame onto the scroller's box (its offset parent is wherever it ends up). */
  const place = () => {
    if (!frame) return;
    const box = scroller.getBoundingClientRect();
    const at = frame.getBoundingClientRect();
    const originLeft = at.left - (parseFloat(frame.style.left) || 0);
    const originTop = at.top - (parseFloat(frame.style.top) || 0);
    const right = Math.min(box.right, props.right?.() ?? Infinity);
    frame.style.left = `${(box.left - originLeft).toFixed(1)}px`;
    frame.style.top = `${(box.top - originTop).toFixed(1)}px`;
    frame.style.width = `${Math.max(0, right - box.left).toFixed(1)}px`;
    frame.style.height = `${box.height.toFixed(1)}px`;
  };

  onMount(() => {
    const { refresh } = watchScroll(scroller, () => frame, { track: () => rail?.clientHeight ?? 0, beforeMeasure: place });
    // Pointing at it measures again too, in case the scroller moved without changing size.
    const enter = () => {
      frame?.setAttribute("data-hover", "");
      refresh();
    };
    const leave = () => frame?.removeAttribute("data-hover");
    scroller.setAttribute("data-scroll-capsule", "");
    scroller.addEventListener("pointerenter", enter);
    scroller.addEventListener("pointerleave", leave);
    window.addEventListener("resize", refresh);
    onCleanup(() => {
      scroller.removeAttribute("data-scroll-capsule");
      scroller.removeEventListener("pointerenter", enter);
      scroller.removeEventListener("pointerleave", leave);
      window.removeEventListener("resize", refresh);
    });
  });

  return (
    <div
      ref={frame}
      class={props.class ? `scroll-capsule ${props.class}` : "scroll-capsule"}
      classList={{ "scroll-capsule--dragging": dragging() }}
      aria-hidden="true"
    >
      {/* As in ScrollList, the capsule repeats what scrolling, the wheel and the keys already do. */}
      <div ref={rail} class="scroll-list-rail" {...handlers}>
        <div class="scroll-list-thumb" />
      </div>
    </div>
  );
}
