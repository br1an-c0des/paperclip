import type { UserProfileDailyPoint } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { actionLabel, chartDays, completionRate, profilePath, profileSlug, slugify, totalTokens } from "./profile-model";

describe("slugs", () => {
  it("slugs as the server does", () => {
    expect(slugify("  Ada O'Brien ")).toBe("ada-obrien");
    expect(slugify("local-board")).toBe("local-board");
    expect(slugify("")).toBeNull();
    expect(slugify(undefined)).toBeNull();
  });

  it("turns me into your id", () => {
    expect(profileSlug("me", "local-board")).toBe("local-board");
    expect(profileSlug("ME", null)).toBe("me");
    expect(profileSlug("ada", "local-board")).toBe("ada");
  });

  it("links a profile by id first", () => {
    expect(profilePath("TES", { id: "local-board", name: "Board" })).toBe("/TES/u/local-board");
    expect(profilePath("TES", { name: "Ada Lovelace" })).toBe("/TES/u/ada-lovelace");
    expect(profilePath("TES", { email: "ada@example.com" })).toBe("/TES/u/ada");
    expect(profilePath("TES", null)).toBe("/TES/u/me");
  });
});

describe("numbers", () => {
  it("adds up tokens and rates completions", () => {
    expect(totalTokens({ inputTokens: 1, cachedInputTokens: 2, outputTokens: 3 })).toBe(6);
    expect(completionRate({ touchedIssues: 0, completedIssues: 0 })).toBe(0);
    expect(completionRate({ touchedIssues: 3, completedIssues: 2 })).toBe(67);
  });

  it("labels an action", () => {
    expect(actionLabel("issue.comment_added")).toBe("Issue comment added");
  });
});

describe("chartDays", () => {
  const point = (date: string, input: number, completedIssues = 0) =>
    ({ date, inputTokens: input, cachedInputTokens: 0, outputTokens: 0, completedIssues }) as unknown as UserProfileDailyPoint;

  it("scales to the busiest day, keeps quiet days visible and ticks three dates", () => {
    const days = chartDays([point("2026-10-01", 1000), point("2026-10-02", 0), point("2026-10-03", 10, 2), point("2026-10-04", 500), point("2026-10-05", 0)]);
    expect(days.map((day) => day.height)).toEqual([100, 0, 4, 50, 0]);
    expect(days[2]!.completed).toBe(2);
    expect(days.filter((day) => day.tick).map((day) => day.date)).toEqual(["2026-10-01", "2026-10-03", "2026-10-05"]);
  });

  it("has no bars on an idle fortnight", () => {
    expect(chartDays([point("2026-10-01", 0)]).map((day) => day.height)).toEqual([0]);
  });
});
