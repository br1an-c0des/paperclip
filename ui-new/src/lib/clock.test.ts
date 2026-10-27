import { createComputed, createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clockState, useNow } from "./clock";

/** Mounts a reader of the clock, counting how often it re-runs. */
function reader(active?: () => boolean) {
  return createRoot((dispose) => {
    const now = useNow(active);
    const seen: number[] = [];
    createComputed(() => seen.push(now()));
    return { now, seen, dispose };
  });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  });
  afterEach(() => {
    setVisibility("visible");
    vi.useRealTimers();
  });

  it("shares one interval between readers, and stops it when the last one goes", () => {
    const a = reader();
    const b = reader();
    expect(clockState()).toEqual({ subscribers: 2, ticking: true });
    expect(vi.getTimerCount()).toBe(1);

    const start = a.now();
    vi.advanceTimersByTime(3_000);
    expect(a.now() - start).toBe(3_000);
    expect(b.now()).toBe(a.now());
    expect(a.seen).toHaveLength(4);

    a.dispose();
    expect(clockState()).toEqual({ subscribers: 1, ticking: true });
    b.dispose();
    expect(clockState()).toEqual({ subscribers: 0, ticking: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts from the current time, not the last tick before it stopped", () => {
    reader().dispose();
    vi.advanceTimersByTime(60_000);
    const later = reader();
    expect(later.now()).toBe(Date.now());
    later.dispose();
  });

  it("ticks for a reader only while it's active", () => {
    const [running, setRunning] = createSignal(false);
    const r = reader(running);
    expect(clockState().subscribers).toBe(0);
    vi.advanceTimersByTime(3_000);
    expect(r.seen).toHaveLength(1);

    setRunning(true);
    expect(clockState()).toEqual({ subscribers: 1, ticking: true });
    vi.advanceTimersByTime(2_000);
    expect(r.seen).toHaveLength(4); // the switch, then two ticks

    setRunning(false);
    expect(clockState()).toEqual({ subscribers: 0, ticking: false });
    r.dispose();
  });

  it("pauses while the tab is hidden and catches up when it's back", () => {
    const r = reader();
    setVisibility("hidden");
    expect(clockState()).toEqual({ subscribers: 1, ticking: false });
    const before = r.seen.length;
    vi.advanceTimersByTime(10_000);
    expect(r.seen).toHaveLength(before);

    setVisibility("visible");
    expect(clockState().ticking).toBe(true);
    expect(r.now()).toBe(Date.now());
    r.dispose();
  });
});
