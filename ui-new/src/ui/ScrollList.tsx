import type { ParentProps } from "solid-js";
import { createCapsuleDrag, watchScroll } from "./scroll-capsule";
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
 * and going; measuring is batched to one per frame. The logic is in scroll-capsule.ts, shared with
 * ScrollCapsule, which lays the same capsule over a scroller that's already there.
 */

export function ScrollList(props: ParentProps<{ class?: string }>) {
  let frame: HTMLDivElement | undefined;
  let body: HTMLDivElement | undefined;
  let rail: HTMLDivElement | undefined;
  const { dragging, handlers } = createCapsuleDrag({ scroller: () => body, rail: () => rail, marker: () => frame });

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
      <div ref={rail} class="scroll-list-rail" aria-hidden="true" {...handlers}>
        <div class="scroll-list-thumb" />
      </div>
    </div>
  );
}
