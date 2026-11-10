import { describe, expect, it } from "vitest";
import { lifecycleStateText } from "./ProfileSection";

type Agent = Parameters<typeof lifecycleStateText>[0];
const agent = (fields: Partial<Agent>) => ({ status: "paused", pauseReason: null, lifecycleState: "verifying", lifecycleError: null, ...fields }) as Agent;

describe("lifecycleStateText", () => {
  it("reads a parked setup check as finishing its setup, as the header does (#20361)", () => {
    for (const lifecycleState of ["preparing", "verifying", "resuming"] as const) {
      expect(lifecycleStateText(agent({ lifecycleState }))).toBe("Finishing setup");
    }
    expect(lifecycleStateText(agent({ lifecycleError: "Connect an account" }))).toBe("Setup check failed");
  });

  it("keeps real pauses and other states as they were", () => {
    expect(lifecycleStateText(agent({ pauseReason: "manual" }))).toBe("Paused");
    expect(lifecycleStateText(agent({ pauseReason: "budget" }))).toBe("Paused: it reached its budget");
    expect(lifecycleStateText(agent({ lifecycleState: "paused" }))).toBe("Paused");
    expect(lifecycleStateText(agent({ status: "idle", lifecycleState: "ready" }))).toBe("Idle");
  });
});
