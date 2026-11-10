import { describe, expect, it } from "vitest";
import { setupCheckState } from "./AgentHeader";

const agent = (fields: Partial<Parameters<typeof setupCheckState>[0]>) =>
  ({ status: "paused", pauseReason: null, lifecycleState: "verifying", lifecycleError: null, ...fields }) as Parameters<typeof setupCheckState>[0];

describe("setupCheckState", () => {
  it("reads a parked setup check as finishing its setup, not paused (#20361)", () => {
    for (const lifecycleState of ["preparing", "verifying", "resuming"] as const) {
      expect(setupCheckState(agent({ lifecycleState }))).toEqual({ label: "Finishing setup", tone: "cyan", title: "Runs start once its setup check passes." });
    }
  });

  it("names a failed check's error", () => {
    expect(setupCheckState(agent({ lifecycleError: " Connect an account " }))).toEqual({
      label: "Setup check failed",
      tone: "red",
      title: "Connect an account Runs start once its setup check passes.",
    });
  });

  it("leaves real pauses and running agents alone", () => {
    expect(setupCheckState(agent({ pauseReason: "manual" }))).toBeNull();
    expect(setupCheckState(agent({ pauseReason: "budget" }))).toBeNull();
    expect(setupCheckState(agent({ lifecycleState: "paused" }))).toBeNull();
    expect(setupCheckState(agent({ status: "idle", lifecycleState: "verifying" }))).toBeNull();
  });
});
