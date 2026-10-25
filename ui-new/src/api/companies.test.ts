import { describe, expect, it } from "vitest";
import { statsFor } from "./companies";

describe("statsFor", () => {
  it("counts a company missing from stats as empty", () => {
    expect(statsFor({}, "c1")).toEqual({ agentCount: 0, issueCount: 0 });
  });

  it("returns the counts it has", () => {
    expect(statsFor({ c1: { agentCount: 2, issueCount: 5 } }, "c1")).toEqual({ agentCount: 2, issueCount: 5 });
  });

  it("is undefined until stats load", () => {
    expect(statsFor(undefined, "c1")).toBeUndefined();
  });
});
