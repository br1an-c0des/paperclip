import { afterEach, describe, expect, it, vi } from "vitest";
import { browserTimeZone, claimTimeZoneSave, isIanaTimeZone, resetTimeZoneSyncForTests, timeZoneToSave } from "./time-zone";

describe("the person's time zone", () => {
  afterEach(() => {
    resetTimeZoneSyncForTests();
    vi.restoreAllMocks();
  });

  it("knows IANA zones", () => {
    expect(isIanaTimeZone("America/Chicago")).toBe(true);
    expect(isIanaTimeZone("UTC")).toBe(true);
    expect(isIanaTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isIanaTimeZone("")).toBe(false);
    expect(isIanaTimeZone(null)).toBe(false);
    expect(isIanaTimeZone(`Europe/${"x".repeat(64)}`)).toBe(false);
  });

  it("reads the browser's zone, and null when it isn't usable", () => {
    const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions");
    spy.mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...resolved.call(this), timeZone: "America/Chicago" };
    });
    expect(browserTimeZone()).toBe("America/Chicago");
    spy.mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...resolved.call(this), timeZone: "" };
    });
    expect(browserTimeZone()).toBeNull();
  });

  it("saves only a known zone that differs from the saved one", () => {
    expect(timeZoneToSave("America/Chicago", null)).toBe("America/Chicago");
    expect(timeZoneToSave("America/Chicago", undefined)).toBe("America/Chicago");
    expect(timeZoneToSave("America/Chicago", "Europe/Berlin")).toBe("America/Chicago");
    expect(timeZoneToSave("America/Chicago", "America/Chicago")).toBeNull();
    expect(timeZoneToSave(null, "Europe/Berlin")).toBeNull();
  });

  it("tries each account and zone once per load", () => {
    expect(claimTimeZoneSave("user-a", "America/Chicago")).toBe(true);
    expect(claimTimeZoneSave("user-a", "America/Chicago")).toBe(false);
    expect(claimTimeZoneSave("user-a", "Europe/Berlin")).toBe(true);
    expect(claimTimeZoneSave("user-b", "America/Chicago")).toBe(true);
  });
});
