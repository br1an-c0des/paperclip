import { afterEach, describe, expect, it } from "vitest";
import { keyboardState, watchKeyboard } from "./keyboard";

describe("the on-screen keyboard (U166, #19725)", () => {
  it("reads a visual viewport well short of the layout viewport as an open keyboard", () => {
    // An iPad in portrait: 1180px tall, the keyboard takes 400px, Safari panned 30px.
    expect(keyboardState({ layoutHeight: 1180, height: 780, offsetTop: 30, scale: 1 })).toEqual({ height: 780, top: 30, inset: 370 });
    expect(keyboardState({ layoutHeight: 1180, height: 780, offsetTop: 0, scale: 1 })).toEqual({ height: 780, top: 0, inset: 400 });
  });

  it("leaves browser chrome and a closed keyboard alone", () => {
    expect(keyboardState({ layoutHeight: 1180, height: 1180, offsetTop: 0, scale: 1 })).toBeNull();
    expect(keyboardState({ layoutHeight: 1180, height: 1100, offsetTop: 0, scale: 1 })).toBeNull();
  });

  it("releases keyboard sizing during a pinch zoom", () => {
    expect(keyboardState({ layoutHeight: 1180, height: 590, offsetTop: 200, scale: 2 })).toBeNull();
    expect(keyboardState({ layoutHeight: 1180, height: 780, offsetTop: 0, scale: 1.005 })).not.toBeNull();
  });

  it("ignores a viewport with no size", () => {
    expect(keyboardState({ layoutHeight: 1180, height: 0, offsetTop: 0, scale: 1 })).toBeNull();
    expect(keyboardState({ layoutHeight: 0, height: 700, offsetTop: 0, scale: 1 })).toBeNull();
    expect(keyboardState({ layoutHeight: 1180, height: Number.NaN, offsetTop: 0, scale: 1 })).toBeNull();
  });
});

describe("watchKeyboard", () => {
  let stop: (() => void) | null = null;
  const original = Object.getOwnPropertyDescriptor(window, "visualViewport");

  afterEach(() => {
    stop?.();
    stop = null;
    if (original) Object.defineProperty(window, "visualViewport", original);
    else delete (window as { visualViewport?: unknown }).visualViewport;
  });

  function fakeViewport(layoutHeight: number) {
    const target = new EventTarget() as EventTarget & { height: number; offsetTop: number; scale: number };
    Object.assign(target, { height: layoutHeight, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: target });
    Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: layoutHeight });
    return target;
  }

  it("marks the page while the keyboard is open, and releases it on close and on zoom", () => {
    const viewport = fakeViewport(1180);
    stop = watchKeyboard();
    const root = document.documentElement;
    expect(root.dataset.keyboard).toBeUndefined();

    viewport.height = 780;
    viewport.dispatchEvent(new Event("resize"));
    expect(root.dataset.keyboard).toBe("open");
    expect(root.style.getPropertyValue("--vv-height")).toBe("780px");
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("400px");

    // Safari pans the visual viewport: the inset follows it.
    viewport.offsetTop = 40;
    viewport.dispatchEvent(new Event("scroll"));
    expect(root.style.getPropertyValue("--vv-top")).toBe("40px");
    expect(root.style.getPropertyValue("--keyboard-inset")).toBe("360px");

    // A pinch zoom while typing releases the sizing.
    viewport.scale = 1.8;
    viewport.dispatchEvent(new Event("resize"));
    expect(root.dataset.keyboard).toBeUndefined();
    expect(root.style.getPropertyValue("--vv-height")).toBe("");

    viewport.scale = 1;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event("resize"));
    expect(root.dataset.keyboard).toBe("open");

    viewport.height = 1180;
    viewport.dispatchEvent(new Event("resize"));
    expect(root.dataset.keyboard).toBeUndefined();
  });

  it("undoes Safari's pan of a page that fits the visible area", () => {
    const viewport = fakeViewport(1180);
    stop = watchKeyboard();
    const page = document.scrollingElement ?? document.documentElement;
    Object.defineProperty(page, "scrollHeight", { configurable: true, value: 700 });
    page.scrollTop = 120;
    viewport.height = 780;
    viewport.dispatchEvent(new Event("resize"));
    expect(page.scrollTop).toBe(0);
  });
});
