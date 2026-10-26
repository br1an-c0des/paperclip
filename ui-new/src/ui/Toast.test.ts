import { afterEach, describe, expect, it } from "vitest";
import { clearToasts, dismissToast, pushToast, toasts, ttlFor } from "./Toast";

afterEach(() => clearToasts());

describe("toasts", () => {
  it("uses each tone's lifetime and clamps a given one", () => {
    expect(ttlFor("success")).toBe(3500);
    expect(ttlFor("error")).toBe(10000);
    expect(ttlFor("info", 100)).toBe(1500);
    expect(ttlFor("info", 60_000)).toBe(15000);
  });

  it("drops a repeat by key or by text within the window", () => {
    expect(pushToast({ title: "Saved", dedupeKey: "a" })).not.toBeNull();
    expect(pushToast({ title: "Other", dedupeKey: "a" })).toBeNull();
    expect(pushToast({ title: "Saved", dedupeKey: "b" })).toBeNull();
    expect(toasts()).toHaveLength(1);
  });

  it("keeps at most five, newest first", () => {
    for (let index = 0; index < 7; index += 1) pushToast({ title: `Toast ${index}` });
    expect(toasts()).toHaveLength(5);
    expect(toasts()[0]!.title).toBe("Toast 6");
    dismissToast(toasts()[0]!.id);
    expect(toasts()).toHaveLength(4);
  });
});
