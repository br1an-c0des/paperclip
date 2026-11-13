import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal, For } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createSortable, dragOffset, dropIndex, moveItem } from "./sortable";

describe("drag to reorder (U144)", () => {
  // Rows 32px tall, 2px apart: middles at 16, 50, 84, 118.
  const mids = [16, 50, 84, 118];

  it("lands a dragged row in the slot whose middle it passed", () => {
    expect(dropIndex(mids, 0, 16)).toBe(0);
    expect(dropIndex(mids, 0, 49)).toBe(0);
    expect(dropIndex(mids, 0, 51)).toBe(1);
    expect(dropIndex(mids, 0, 200)).toBe(3);
    expect(dropIndex(mids, 3, 83)).toBe(2);
    expect(dropIndex(mids, 3, -40)).toBe(0);
    // Held at either end of the list, the row's middle sits exactly on the end slot's.
    expect(dropIndex(mids, 2, 16)).toBe(0);
    expect(dropIndex(mids, 0, 118)).toBe(3);
  });

  it("slides the rows it passes out of its way by one slot", () => {
    const drag = { from: 0, to: 2, dy: 70, step: 34 };
    expect([0, 1, 2, 3].map((index) => dragOffset(index, drag))).toEqual([70, -34, -34, 0]);
    const up = { from: 3, to: 1, dy: -70, step: 34 };
    expect([0, 1, 2, 3].map((index) => dragOffset(index, up))).toEqual([0, 34, 34, -70]);
    expect(dragOffset(1, null)).toBe(0);
  });

  it("moves one item", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 5)).toEqual(["a", "b", "c"]);
  });
});

function List(props: { onReorder: (ids: string[]) => void }) {
  const [ids, setIds] = createSignal(["a", "b", "c"]);
  const sortable = createSortable({
    ids,
    onReorder: (next) => {
      setIds(next);
      props.onReorder(next);
    },
  });
  return (
    <div>
      <For each={ids()}>
        {(id) => (
          <div data-sort-row={id}>
            <span>{id}</span>
            <button
              type="button"
              data-sort-handle
              aria-label={`Reorder ${id}`}
              aria-pressed={sortable.lifted(id)}
              onPointerDown={(event) => sortable.pointerDown(id, event)}
              onKeyDown={(event) => sortable.keyDown(id, event)}
            />
          </div>
        )}
      </For>
    </div>
  );
}

describe("createSortable from the keyboard", () => {
  it("lifts with Space, moves with the arrows and drops with Space", () => {
    const onReorder = vi.fn();
    const screen = render(() => <List onReorder={onReorder} />);
    const handle = screen.getByRole("button", { name: "Reorder a" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onReorder).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: " " });
    expect(handle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onReorder).toHaveBeenLastCalledWith(["b", "a", "c"]);
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder a" }), { key: "ArrowDown" });
    expect(onReorder).toHaveBeenLastCalledWith(["b", "c", "a"]);
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder a" }), { key: " " });
    expect(screen.getByRole("button", { name: "Reorder a" }).getAttribute("aria-pressed")).toBe("false");
    screen.unmount();
  });

  it("puts the row back on Escape", () => {
    const onReorder = vi.fn();
    const screen = render(() => <List onReorder={onReorder} />);
    const handle = () => screen.getByRole("button", { name: "Reorder b" });
    fireEvent.keyDown(handle(), { key: "Enter" });
    fireEvent.keyDown(handle(), { key: "ArrowUp" });
    expect(onReorder).toHaveBeenLastCalledWith(["b", "a", "c"]);
    fireEvent.keyDown(handle(), { key: "Escape" });
    expect(onReorder).toHaveBeenLastCalledWith(["a", "b", "c"]);
  });
});
