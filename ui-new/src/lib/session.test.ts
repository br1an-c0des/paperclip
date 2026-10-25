import { describe, expect, it } from "vitest";
import { safeNextPath } from "./session";

describe("safeNextPath", () => {
  it("keeps paths inside the app", () => {
    expect(safeNextPath("/GEA/issues/GEA-12?tab=runs")).toBe("/GEA/issues/GEA-12?tab=runs");
  });

  it("falls back to / for anything else", () => {
    for (const next of [null, undefined, "", "https://evil.example", "//evil.example", "/auth", "/auth?next=/x"]) {
      expect(safeNextPath(next)).toBe("/");
    }
  });
});
