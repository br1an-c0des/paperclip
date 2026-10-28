import { describe, expect, it } from "vitest";
import { atFoot, NEAR_FOOT_PX, shouldFollow } from "./scroll-model";

describe("atFoot", () => {
  it("is true at the very bottom and within the slack above it", () => {
    expect(atFoot({ scrollY: 2100, viewHeight: 900, contentHeight: 3000 })).toBe(true);
    expect(atFoot({ scrollY: 2100 - NEAR_FOOT_PX, viewHeight: 900, contentHeight: 3000 })).toBe(true);
  });

  it("is false further up", () => {
    expect(atFoot({ scrollY: 2100 - NEAR_FOOT_PX - 1, viewHeight: 900, contentHeight: 3000 })).toBe(false);
    expect(atFoot({ scrollY: 300, viewHeight: 900, contentHeight: 3000 })).toBe(false);
  });

  it("is true when the whole thread fits on screen", () => {
    expect(atFoot({ scrollY: 0, viewHeight: 900, contentHeight: 600 })).toBe(true);
  });
});

describe("shouldFollow", () => {
  it("always moves to the foot when the chat opens or you send", () => {
    expect(shouldFollow("opened", false)).toBe(true);
    expect(shouldFollow("sent", false)).toBe(true);
    expect(shouldFollow("sent", true)).toBe(true);
  });

  it("follows new content only while the reader is at the foot", () => {
    expect(shouldFollow("grew", true)).toBe(true);
    expect(shouldFollow("grew", false)).toBe(false);
  });
});
