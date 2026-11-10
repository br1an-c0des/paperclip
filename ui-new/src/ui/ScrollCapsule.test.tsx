import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { ScrollCapsule } from "./ScrollCapsule";
import { ScrollList } from "./ScrollList";

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}

/** A scroller 300px tall showing a third of its content, at (100, 40) in the window. */
function makeScroller() {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientHeight", { configurable: true, get: () => 300 });
  Object.defineProperty(element, "scrollHeight", { configurable: true, get: () => 900 });
  element.getBoundingClientRect = () => rect(100, 40, 500, 300);
  document.body.append(element);
  return element;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ScrollCapsule", () => {
  it("lays its frame over the scroller and stands in for its scrollbar while attached", async () => {
    const scroller = makeScroller();
    const [on, setOn] = createSignal(true);
    const { container } = render(() => (
      <Show when={on()}>
        <ScrollCapsule scroller={scroller} class="extra" />
      </Show>
    ));
    const capsule = container.querySelector<HTMLElement>(".scroll-capsule")!;
    // Its frame starts at the window's origin here, so the scroller's box is its place.
    capsule.getBoundingClientRect = () => rect(parseFloat(capsule.style.left) || 0, parseFloat(capsule.style.top) || 0, 0, 0);
    expect(capsule.classList.contains("extra")).toBe(true);
    expect(capsule.getAttribute("aria-hidden")).toBe("true");
    expect(scroller.hasAttribute("data-scroll-capsule")).toBe(true);

    await frame();
    expect(capsule.style.left).toBe("100px");
    expect(capsule.style.top).toBe("40px");
    expect(capsule.style.width).toBe("500px");
    expect(capsule.style.height).toBe("300px");
    expect(capsule.hasAttribute("data-more-below")).toBe(true);
    expect(capsule.hasAttribute("data-more-above")).toBe(false);

    // Measuring again from where it now is lands in the same place.
    window.dispatchEvent(new Event("resize"));
    await frame();
    expect(capsule.style.left).toBe("100px");

    fireEvent.pointerEnter(scroller);
    expect(capsule.hasAttribute("data-hover")).toBe(true);
    fireEvent.pointerLeave(scroller);
    expect(capsule.hasAttribute("data-hover")).toBe(false);

    setOn(false);
    expect(scroller.hasAttribute("data-scroll-capsule")).toBe(false);
    fireEvent.pointerEnter(scroller);
    expect(capsule.hasAttribute("data-hover")).toBe(false);
  });

  it("stops short of what covers the scroller's right edge", async () => {
    const scroller = makeScroller();
    const { container } = render(() => <ScrollCapsule scroller={scroller} right={() => 420} />);
    const capsule = container.querySelector<HTMLElement>(".scroll-capsule")!;
    capsule.getBoundingClientRect = () => rect(parseFloat(capsule.style.left) || 0, parseFloat(capsule.style.top) || 0, 0, 0);
    await frame();
    expect(capsule.style.width).toBe("320px");
  });

  it("scrolls the scroller when its capsule is dragged", async () => {
    const scroller = makeScroller();
    const { container } = render(() => <ScrollCapsule scroller={scroller} />);
    const capsule = container.querySelector<HTMLElement>(".scroll-capsule")!;
    const rail = container.querySelector<HTMLElement>(".scroll-list-rail")!;
    capsule.getBoundingClientRect = () => rect(0, 0, 0, 0);
    Object.defineProperty(rail, "clientHeight", { configurable: true, get: () => 300 });
    rail.getBoundingClientRect = () => rect(592, 40, 8, 300);
    await frame();
    // A third of the 300px track.
    expect(capsule.style.getPropertyValue("--thumb-size")).toBe("100.0px");

    fireEvent.pointerDown(rail, { button: 0, clientY: 90, pointerId: 1 });
    expect(capsule.classList.contains("scroll-capsule--dragging")).toBe(true);
    fireEvent.pointerMove(rail, { clientY: 190, pointerId: 1 });
    expect(scroller.scrollTop).toBe(300);
    fireEvent.pointerUp(rail, { pointerId: 1 });
    expect(capsule.classList.contains("scroll-capsule--dragging")).toBe(false);
  });
});

describe("ScrollList", () => {
  it("still wraps its rows in a frame with a rail of its own", async () => {
    const { container } = render(() => (
      <ScrollList class="nav-list">
        <p>Row</p>
      </ScrollList>
    ));
    const list = container.querySelector(".scroll-list")!;
    expect(list.querySelector(":scope > .scroll-list-body.nav-list")?.textContent).toBe("Row");
    expect(list.querySelector(":scope > .scroll-list-rail[aria-hidden='true'] > .scroll-list-thumb")).toBeTruthy();
    await frame();
    expect((list as HTMLElement).style.getPropertyValue("--thumb-size")).not.toBe("");
  });
});
