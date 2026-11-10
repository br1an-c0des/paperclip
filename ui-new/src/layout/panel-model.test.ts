import { describe, expect, it } from "vitest";
import { dockBeside } from "./panel-model";

describe("dockBeside", () => {
  it("puts the panel beside main when main keeps 1000px for the list and the panel", () => {
    // 1440 - 248 - 4 - 20 = 1168
    expect(dockBeside(1440, 248, false)).toBe(true);
    // 1272 - 248 - 24 = 1000, just enough
    expect(dockBeside(1272, 248, false)).toBe(true);
    expect(dockBeside(1271, 248, false)).toBe(false);
  });

  it("lays the panel over the list in a narrow window", () => {
    expect(dockBeside(1000, 248, false)).toBe(false);
    // The rail leaves more room: 1100 - 68 - 24 = 1008
    expect(dockBeside(1100, 68, false)).toBe(true);
  });

  it("leaves out the nav column while the nav is hidden", () => {
    // 1080 - 52 - 20 = 1008
    expect(dockBeside(1080, 248, true)).toBe(true);
    expect(dockBeside(1060, 248, true)).toBe(false);
  });
});
