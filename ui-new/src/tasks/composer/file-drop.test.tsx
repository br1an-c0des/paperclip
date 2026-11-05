import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createFileDropTarget, FileDropOverlay } from "./file-drop";

afterEach(cleanup);

// jsdom lays nothing out; give every element a box so it counts as showing.
const rects = HTMLElement.prototype.getClientRects;
beforeAll(() => {
  HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
});
afterAll(() => {
  HTMLElement.prototype.getClientRects = rects;
});

function Target(props: { name: string; onFiles: (files: File[]) => void; enabled?: boolean }) {
  let root: HTMLDivElement | undefined;
  const dragging = createFileDropTarget({ element: () => root, enabled: () => props.enabled ?? true, onFiles: props.onFiles });
  return (
    <div ref={root} data-testid={props.name}>
      <FileDropOverlay show={dragging()} />
    </div>
  );
}

const file = new File(["x"], "shot.png", { type: "image/png" });

function drag(type: "dragenter" | "dragover" | "drop", target: EventTarget, types = ["Files"]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types, files: types.includes("Files") ? [file] : [], dropEffect: "none" } });
  target.dispatchEvent(event);
  return event;
}

describe("createFileDropTarget", () => {
  it("takes a file dropped anywhere, and shows the overlay while it's dragged", () => {
    const onFiles = vi.fn();
    render(() => <Target name="a" onFiles={onFiles} />);
    drag("dragenter", document.body);
    const over = drag("dragover", document.body);
    expect(over.defaultPrevented).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("Drop files to attach");
    const drop = drag("drop", document.body);
    expect(drop.defaultPrevented).toBe(true);
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves text drags alone", () => {
    const onFiles = vi.fn();
    render(() => <Target name="a" onFiles={onFiles} />);
    expect(drag("dragover", document.body, ["text/plain"]).defaultPrevented).toBe(false);
    expect(drag("drop", document.body, ["text/plain"]).defaultPrevented).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("gives the drop to the last composer, and to the one inside an open dialog", () => {
    const page = vi.fn();
    const modal = vi.fn();
    const [open, setOpen] = createSignal(false);
    render(() => (
      <>
        <Target name="page" onFiles={page} />
        <Show when={open()}>
          <div data-layer="dialog">
            <Target name="modal" onFiles={modal} />
          </div>
        </Show>
      </>
    ));
    drag("drop", document.body);
    expect(page).toHaveBeenCalledTimes(1);
    setOpen(true);
    drag("drop", document.body);
    expect(modal).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledTimes(1);
    setOpen(false);
    drag("drop", document.body);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it("lets a drop area of its own go first", () => {
    const onFiles = vi.fn();
    render(() => (
      <>
        <Target name="a" onFiles={onFiles} />
        <section data-testid="zone" onDrop={(event) => event.preventDefault()} />
        <div data-file-drop-target data-testid="marked" />
      </>
    ));
    drag("drop", screen.getByTestId("zone"));
    drag("drop", screen.getByTestId("marked"));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("claims the drop but takes nothing while it can't take files", () => {
    const onFiles = vi.fn();
    render(() => <Target name="a" onFiles={onFiles} enabled={false} />);
    expect(drag("drop", document.body).defaultPrevented).toBe(true);
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("ignores a composer hidden from view", () => {
    const onFiles = vi.fn();
    render(() => (
      <div aria-hidden="true">
        <Target name="a" onFiles={onFiles} />
      </div>
    ));
    expect(drag("drop", document.body).defaultPrevented).toBe(false);
    expect(onFiles).not.toHaveBeenCalled();
  });
});
