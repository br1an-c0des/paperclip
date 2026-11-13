import { createSignal, onCleanup } from "solid-js";

/*
 * Drag to reorder a short list by a handle on each row (first used for starred agents in the nav,
 * since the 2026-11-13 sync, upstream #20830). Pointer events, so a mouse, a pen and a finger all
 * work: the handle has `touch-action: none`, so dragging it on a phone moves the row instead of
 * scrolling the list. The dragged row follows the pointer and the rows it passes slide out of its
 * way; nothing reorders until it's dropped, when `onReorder` gets the new order.
 *
 * From the keyboard, as upstream's dnd-kit list: Space (or Enter) on a handle lifts the row, the
 * up and down arrows move it, Space or Enter drops it there, and Escape puts it back.
 *
 * Each row carries `data-sort-row` (its id); a handle finds its siblings through its own row.
 */

/** Where a dragged row lands: the furthest slot whose resting middle the dragged row's middle has reached. */
export function dropIndex(mids: readonly number[], from: number, center: number): number {
  let to = from;
  for (let index = from + 1; index < mids.length; index += 1) if (center >= mids[index]) to = index;
  for (let index = from - 1; index >= 0; index -= 1) if (center <= mids[index]) to = index;
  return to;
}

/** How far each row sits from its resting place while a row is dragged from `from` to `to`. */
export function dragOffset(index: number, drag: { from: number; to: number; dy: number; step: number } | null): number {
  if (!drag) return 0;
  if (index === drag.from) return drag.dy;
  if (drag.to > drag.from && index > drag.from && index <= drag.to) return -drag.step;
  if (drag.to < drag.from && index < drag.from && index >= drag.to) return drag.step;
  return 0;
}

/** A copy of `items` with the one at `from` moved to `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

type Drag = { id: string; from: number; to: number; dy: number; step: number };

export function createSortable(options: { ids: () => readonly string[]; onReorder: (ids: string[]) => void }) {
  const [drag, setDrag] = createSignal<Drag | null>(null);
  const [lifted, setLifted] = createSignal<{ id: string; original: string[] } | null>(null);
  let stop: (() => void) | undefined;
  onCleanup(() => stop?.());

  const rowsNear = (element: Element) => {
    const list = element.closest("[data-sort-row]")?.parentElement;
    return list ? [...list.querySelectorAll<HTMLElement>(":scope > [data-sort-row]")] : [];
  };
  const focusHandle = (from: Element, id: string) => {
    const list = from.closest("[data-sort-row]")?.parentElement;
    requestAnimationFrame(() => list?.querySelector<HTMLElement>(`[data-sort-row="${CSS.escape(id)}"] [data-sort-handle]`)?.focus());
  };

  const pointerDown = (id: string, event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const ids = [...options.ids()];
    const from = ids.indexOf(id);
    const rows = rowsNear(event.currentTarget as Element);
    const rects = ids.map((rowId) => rows.find((row) => row.dataset.sortRow === rowId)?.getBoundingClientRect());
    if (from < 0 || rects.some((rect) => !rect)) return;
    event.preventDefault();
    stop?.();
    setLifted(null);
    const boxes = rects as DOMRect[];
    const mids = boxes.map((rect) => rect.top + rect.height / 2);
    // One slot: from this row's top to the next row's (its height and the gap), or its height alone.
    const step = boxes[from + 1] ? boxes[from + 1].top - boxes[from].top : boxes[from - 1] ? boxes[from].top - boxes[from - 1].top : boxes[from].height;
    const startY = event.clientY;
    setDrag({ id, from, to: from, dy: 0, step });
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      next.preventDefault();
      // The row stays within the list, so a scrolling list doesn't clip it at either end.
      const dy = Math.min(Math.max(next.clientY - startY, boxes[0].top - boxes[from].top), boxes[boxes.length - 1].top - boxes[from].top);
      setDrag((current) => (current ? { ...current, dy, to: dropIndex(mids, from, mids[from] + dy) } : current));
    };
    const end = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      const done = drag();
      stop?.();
      if (next.type === "pointerup" && done && done.to !== done.from) options.onReorder(moveItem(ids, done.from, done.to));
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stop = undefined;
      setDrag(null);
    };
  };

  const keyDown = (id: string, event: KeyboardEvent) => {
    const target = event.currentTarget as Element;
    const current = lifted();
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setLifted(current?.id === id ? null : { id, original: [...options.ids()] });
      return;
    }
    if (current?.id !== id) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setLifted(null);
      if (current.original.join() !== options.ids().join()) {
        options.onReorder(current.original);
        focusHandle(target, id);
      }
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const ids = [...options.ids()];
    const from = ids.indexOf(id);
    const to = from + (event.key === "ArrowUp" ? -1 : 1);
    if (from < 0 || to < 0 || to >= ids.length) return;
    options.onReorder(moveItem(ids, from, to));
    // The row moves in the list, which can take focus from its handle; give it back.
    focusHandle(target, id);
  };

  const focusOut = (id: string, event: FocusEvent) => {
    const list = (event.currentTarget as Element).closest("[data-sort-row]")?.parentElement;
    // A keyboard move hands focus back on the next frame; only a real leave drops the row.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (lifted()?.id !== id) return;
        const handle = list?.querySelector(`[data-sort-row="${CSS.escape(id)}"] [data-sort-handle]`);
        if (document.activeElement !== handle) setLifted(null);
      }),
    );
  };

  return {
    /** How far a row is moved from its place while dragging, in pixels. */
    offset: (id: string) => dragOffset(options.ids().indexOf(id), drag()),
    /** Whether this row is the one being dragged, by pointer or keyboard. */
    active: (id: string) => drag()?.id === id || lifted()?.id === id,
    /** Whether any row is being dragged by the pointer. */
    dragging: () => drag() !== null,
    lifted: (id: string) => lifted()?.id === id,
    pointerDown,
    keyDown,
    focusOut,
  };
}

export type Sortable = ReturnType<typeof createSortable>;
