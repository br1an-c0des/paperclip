import { describe, expect, it } from "vitest";
import {
  cronProblem,
  defaultRepeat,
  describeCron,
  formatFire,
  nextFires,
  nextRunsText,
  parseCron,
  repeatFromCron,
  repeatLabel,
  repeatProblem,
  scheduleCron,
  timeZoneLabel,
} from "./schedule";

const base = defaultRepeat("America/Chicago");

describe("scheduleCron", () => {
  it("turns each frequency into a 5-field cron", () => {
    expect(scheduleCron({ ...base, frequency: "daily", time: "09:00" })).toBe("0 9 * * *");
    expect(scheduleCron({ ...base, frequency: "weekdays", time: "08:30" })).toBe("30 8 * * 1-5");
    expect(scheduleCron({ ...base, frequency: "weekly", time: "09:00", days: [4, 1, 4] })).toBe("0 9 * * 1,4");
    expect(scheduleCron({ ...base, frequency: "monthly", time: "10:00", monthDay: 1 })).toBe("0 10 1 * *");
    expect(scheduleCron({ ...base, frequency: "custom", cron: "  */15   * * * * " })).toBe("*/15 * * * *");
  });

  it("makes nothing from a week with no days or a bad time", () => {
    expect(scheduleCron({ ...base, frequency: "weekly", days: [] })).toBe("");
    expect(scheduleCron({ ...base, frequency: "daily", time: "25:00" })).toBe("");
  });
});

describe("repeatProblem and cronProblem", () => {
  it("asks for days, a time and a valid cron", () => {
    expect(repeatProblem({ ...base, frequency: "weekly", days: [] })).toMatch(/at least one day/);
    expect(repeatProblem({ ...base, frequency: "daily", time: "" })).toMatch(/time/);
    expect(repeatProblem({ ...base, frequency: "custom", cron: "0 9 * *" })).toMatch(/5 fields/);
    expect(repeatProblem({ ...base, frequency: "custom", cron: "0 99 * * *" })).toMatch(/cron field/);
    expect(repeatProblem({ ...base, schedule: false, frequency: "custom", cron: "" })).toBeNull();
    expect(repeatProblem(base)).toBeNull();
    expect(cronProblem("")).toMatch(/Enter a cron/);
  });

  it("parses ranges, lists and steps", () => {
    const cron = parseCron("*/20 9-11 1,15 * 1-5");
    expect(cron?.minutes).toEqual([0, 20, 40]);
    expect(cron?.hours).toEqual([9, 10, 11]);
    expect(cron?.daysOfMonth).toEqual([1, 15]);
    expect(cron?.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(parseCron("5-1 * * * *")).toBeNull();
    expect(parseCron("a * * * *")).toBeNull();
  });
});

describe("describeCron", () => {
  it("says the boards' words for common schedules", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("Weekdays at 09:00");
    expect(describeCron("0 9 * * *")).toBe("Every day at 09:00");
    expect(describeCron("5 * * * *")).toBe("Every hour at :05");
    expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeCron("0 */6 * * *")).toBe("Every 6 hours at :00");
    expect(describeCron("0 8 * * 1")).toBe("Mondays at 08:00");
    expect(describeCron("0 9 * * 4,1")).toBe("Every Mon, Thu at 09:00");
    expect(describeCron("0 9 * * 0,6")).toBe("Weekends at 09:00");
    expect(describeCron("0 10 1 * *")).toBe("Monthly on the 1st at 10:00");
    expect(describeCron("0 10 22 * *")).toBe("Monthly on the 22nd at 10:00");
    expect(describeCron("0 10 11 * *")).toBe("Monthly on the 11th at 10:00");
  });

  it("falls back to the cron itself", () => {
    expect(describeCron("0 9 1 1 *")).toBe("Custom: 0 9 1 1 *");
    expect(describeCron("nonsense")).toBe("Custom: nonsense");
    expect(describeCron(null)).toBe("No schedule");
  });
});

describe("repeatFromCron", () => {
  it("opens a saved schedule on the right choice", () => {
    expect(repeatFromCron("30 8 * * 1-5", "UTC")).toMatchObject({ frequency: "weekdays", time: "08:30", timezone: "UTC" });
    expect(repeatFromCron("0 9 * * 1,4", "UTC")).toMatchObject({ frequency: "weekly", days: [1, 4] });
    expect(repeatFromCron("0 10 15 * *", "UTC")).toMatchObject({ frequency: "monthly", monthDay: 15 });
    expect(repeatFromCron("*/15 * * * *", "UTC")).toMatchObject({ frequency: "custom", cron: "*/15 * * * *" });
  });

  it("round-trips through scheduleCron", () => {
    for (const cron of ["0 9 * * *", "30 8 * * 1-5", "0 9 * * 1,4", "0 10 15 * *", "*/15 * * * *"]) {
      expect(scheduleCron(repeatFromCron(cron, "UTC"))).toBe(cron);
    }
  });
});

describe("nextFires", () => {
  // Sun Oct 25 2026, 10:15 UTC, as on board N4.
  const after = new Date(Date.UTC(2026, 9, 25, 10, 15));

  it("walks to the next weekdays in the time zone", () => {
    const fires = nextFires("0 9 * * 1-5", 3, { after, timeZone: "UTC" });
    expect(fires.map((fire) => fire.toISOString())).toEqual(["2026-10-26T09:00:00.000Z", "2026-10-27T09:00:00.000Z", "2026-10-28T09:00:00.000Z"]);
    expect(nextRunsText(fires, "UTC")).toBe("Mon Oct 26 at 09:00, then Tue Oct 27 and Wed Oct 28");
  });

  it("reads the hours in the schedule's own zone", () => {
    const [first] = nextFires("0 9 * * *", 1, { after, timeZone: "America/Chicago" });
    // 09:00 in Chicago on Oct 25 (CDT, UTC-5) is 14:00 UTC.
    expect(first?.toISOString()).toBe("2026-10-25T14:00:00.000Z");
    expect(formatFire(first!, "America/Chicago")).toBe("Sun Oct 25, 09:00");
  });

  it("finds sparse schedules and frequent ones", () => {
    expect(nextFires("0 10 1 * *", 2, { after, timeZone: "UTC" }).map((fire) => fire.toISOString())).toEqual([
      "2026-11-01T10:00:00.000Z",
      "2026-12-01T10:00:00.000Z",
    ]);
    expect(nextFires("*/15 * * * *", 2, { after, timeZone: "UTC" }).map((fire) => fire.toISOString())).toEqual([
      "2026-10-25T10:30:00.000Z",
      "2026-10-25T10:45:00.000Z",
    ]);
    expect(nextFires("bad", 3, { after })).toEqual([]);
  });

  it("names same-day fires by their time", () => {
    const fires = nextFires("0 9,17 * * *", 3, { after, timeZone: "UTC" });
    expect(nextRunsText(fires, "UTC")).toBe("Sun Oct 25 at 17:00, then Mon Oct 26 09:00 and 17:00");
    expect(nextRunsText([], "UTC")).toBe("No upcoming runs");
  });
});

describe("labels", () => {
  it("writes the Repeat pill", () => {
    expect(repeatLabel(base)).toBe("Weekdays at 09:00");
    expect(repeatLabel({ ...base, webhook: true })).toBe("Weekdays at 09:00 + webhook");
    expect(repeatLabel({ ...base, schedule: false, webhook: true, sender: "github" })).toBe("When a GitHub webhook arrives");
    expect(repeatLabel({ ...base, schedule: false })).toBe("Repeat");
  });

  it("names a time zone by its city", () => {
    expect(timeZoneLabel("America/Los_Angeles", new Date(Date.UTC(2026, 0, 10)))).toBe("Los Angeles (PST)");
    expect(timeZoneLabel("UTC")).toBe("UTC");
  });
});
