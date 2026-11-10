import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { capsuleMetrics, createCapsuleDrag, MIN_THUMB, scrollTopForThumb, watchScroll } from "./scroll-capsule";

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

/** A scroller with a set box: jsdom lays nothing out, so heights are given. */
function scroller(box: { clientHeight: number; scrollHeight: number; scrollTop?: number }) {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientHeight", { configurable: true, get: () => box.clientHeight });
  Object.defineProperty(element, "scrollHeight", { configurable: true, get: () => box.scrollHeight });
  element.scrollTop = box.scrollTop ?? 0;
  document.body.append(element);
  return element;
}

function sized(element: HTMLElement, height: number, top = 0) {
  Object.defineProperty(element, "clientHeight", { configurable: true, get: () => height });
  element.getBoundingClientRect = () => ({ top, left: 0, right: 8, bottom: top + height, width: 8, height, x: 0, y: top, toJSON: () => ({}) });
  return element;
}

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.innerHTML = "";
});

describe("capsuleMetrics", () => {
  it("sizes the capsule to how much is in view and places it by the scroll position", () => {
    // A quarter in view on a 200px track: a 50px capsule, with 150px to travel.
    expect(capsuleMetrics({ scrollTop: 0, clientHeight: 100, scrollHeight: 400 }, 200)).toEqual({ moreAbove: false, moreBelow: true, thumb: 50, top: 0 });
    expect(capsuleMetrics({ scrollTop: 150, clientHeight: 100, scrollHeight: 400 }, 200)).toEqual({ moreAbove: true, moreBelow: true, thumb: 50, top: 75 });
    expect(capsuleMetrics({ scrollTop: 300, clientHeight: 100, scrollHeight: 400 }, 200)).toEqual({ moreAbove: true, moreBelow: false, thumb: 50, top: 150 });
  });

  it("never makes the capsule shorter than the minimum, nor lets it run off the track", () => {
    const long = capsuleMetrics({ scrollTop: 9900, clientHeight: 100, scrollHeight: 10000 }, 200);
    expect(long.thumb).toBe(MIN_THUMB);
    expect(long.top).toBe(200 - MIN_THUMB);
    // Overscrolled (a rubber-band bounce): still on the track.
    expect(capsuleMetrics({ scrollTop: 12000, clientHeight: 100, scrollHeight: 10000 }, 200).top).toBe(200 - MIN_THUMB);
  });

  it("fills the track when there's nothing to scroll", () => {
    expect(capsuleMetrics({ scrollTop: 0, clientHeight: 300, scrollHeight: 300 }, 200)).toEqual({ moreAbove: false, moreBelow: false, thumb: 200, top: 0 });
    expect(capsuleMetrics({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 }, -8).thumb).toBe(0);
  });
});

describe("scrollTopForThumb", () => {
  it("maps the capsule's top on the track back to a scroll position", () => {
    const box = { clientHeight: 100, scrollHeight: 400 };
    expect(scrollTopForThumb(0, box, 200)).toBe(0);
    expect(scrollTopForThumb(75, box, 200)).toBe(150);
    expect(scrollTopForThumb(150, box, 200)).toBe(300);
    // Past either end, it stops there.
    expect(scrollTopForThumb(-20, box, 200)).toBe(0);
    expect(scrollTopForThumb(999, box, 200)).toBe(300);
  });

  it("has nowhere to go when the capsule fills the track", () => {
    expect(scrollTopForThumb(10, { clientHeight: 300, scrollHeight: 300 }, 200)).toBeNull();
    expect(scrollTopForThumb(10, { clientHeight: 0, scrollHeight: 0 }, 200)).toBeNull();
  });
});

describe("watchScroll", () => {
  it("marks the marker with what's beyond each edge and the capsule's place, on a given track", async () => {
    const list = scroller({ clientHeight: 100, scrollHeight: 400 });
    const marker = document.createElement("div");
    let measured = 0;
    createRoot((dispose) => {
      disposers.push(dispose);
      watchScroll(list, () => marker, { track: () => 200, beforeMeasure: () => measured++ });
    });
    await frame();
    expect(measured).toBe(1);
    expect(marker.hasAttribute("data-more-above")).toBe(false);
    expect(marker.hasAttribute("data-more-below")).toBe(true);
    expect(marker.style.getPropertyValue("--thumb-size")).toBe("50.0px");

    list.scrollTop = 150;
    list.dispatchEvent(new Event("scroll"));
    expect(marker.hasAttribute("data-scrolling")).toBe(true);
    await frame();
    expect(marker.hasAttribute("data-more-above")).toBe(true);
    expect(marker.style.getPropertyValue("--thumb-top")).toBe("75.0px");
  });

  it("uses the scroller's height less 8px as the track by default, and stops on cleanup", async () => {
    const list = scroller({ clientHeight: 108, scrollHeight: 432 });
    let stop = () => {};
    createRoot((dispose) => {
      stop = dispose;
      watchScroll(list);
    });
    await frame();
    // A quarter of a 100px track.
    expect(list.style.getPropertyValue("--thumb-size")).toBe("25.0px");

    stop();
    list.scrollTop = 200;
    list.dispatchEvent(new Event("scroll"));
    await frame();
    expect(list.hasAttribute("data-scrolling")).toBe(false);
    expect(list.hasAttribute("data-more-above")).toBe(false);
  });
});

describe("createCapsuleDrag", () => {
  function setup() {
    const list = scroller({ clientHeight: 100, scrollHeight: 400 });
    const rail = sized(document.createElement("div"), 200, 10);
    const marker = document.createElement("div");
    marker.style.setProperty("--thumb-top", "0px");
    marker.style.setProperty("--thumb-size", "50px");
    let drag!: ReturnType<typeof createCapsuleDrag>;
    createRoot((dispose) => {
      disposers.push(dispose);
      drag = createCapsuleDrag({ scroller: () => list, rail: () => rail, marker: () => marker });
    });
    return { list, drag };
  }
  const pointer = (clientY: number, button = 0) => ({ clientY, button, pointerId: 1, preventDefault: () => {} }) as unknown as PointerEvent;

  it("drags the capsule from where it was grabbed", () => {
    const { list, drag } = setup();
    // Grab the capsule 20px down (the rail starts at 10), then move 75px.
    drag.handlers.onPointerDown(pointer(30));
    expect(drag.dragging()).toBe(true);
    expect(list.scrollTop).toBe(0);
    drag.handlers.onPointerMove(pointer(105));
    expect(list.scrollTop).toBe(150);
    drag.handlers.onPointerUp();
    expect(drag.dragging()).toBe(false);
    drag.handlers.onPointerMove(pointer(160));
    expect(list.scrollTop).toBe(150);
  });

  it("jumps to a click on the track, centring the capsule there", () => {
    const { list, drag } = setup();
    // 110px down the rail: the capsule's top goes to 85, a little past the middle.
    drag.handlers.onPointerDown(pointer(120));
    expect(list.scrollTop).toBe(170);
  });

  it("ignores buttons other than the main one", () => {
    const { list, drag } = setup();
    drag.handlers.onPointerDown(pointer(120, 2));
    expect(drag.dragging()).toBe(false);
    expect(list.scrollTop).toBe(0);
  });
});
