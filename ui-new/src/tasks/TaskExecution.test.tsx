import { describe, expect, it } from "vitest";
import { dateTime, relativeTime } from "./TaskExecution";

describe("execution times", () => {
  const now = new Date(2026, 9, 26, 10, 0).getTime();

  it("says when, relative to now", () => {
    expect(relativeTime(new Date(now + 3 * 60_000), now)).toBe("in 3m");
    expect(relativeTime(new Date(now + 2 * 3_600_000), now)).toBe("in 2h");
    expect(relativeTime(new Date(now + 3 * 86_400_000), now)).toBe("in 3d");
    expect(relativeTime(new Date(now - 5 * 60_000), now)).toBe("5m ago");
    expect(relativeTime(new Date(now + 20_000), now)).toBe("now");
  });

  it("writes a date and time briefly", () => {
    expect(dateTime(new Date(2026, 9, 27, 9, 5))).toBe("Oct 27, 09:05");
  });
});
