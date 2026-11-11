import { describe, expect, it } from "vitest";
import { admissionHold, holdRefreshInterval, liveRunHold, QUEUED_HOLD_REFRESH_MS, readsHold } from "./admission";

const queued = (label: string, cause: string | null, phase: "queued" | "waiting_for_provider" = "queued") => ({ phase, label, cause });

describe("a reply being admitted (U120, #20559)", () => {
  it("reads as ordinary work while the server admits it without a named hold", () => {
    expect(admissionHold({ status: "queued" })).toBeNull();
    expect(admissionHold({ status: "queued", execution: null })).toBeNull();
    expect(admissionHold({ status: "queued", execution: queued("Queued", null) })).toBeNull();
    expect(admissionHold(undefined)).toBeNull();
  });

  it.each([
    ["task_drain", "Waiting for maintenance"],
    ["agent_setup_pending", "Waiting for agent setup"],
    ["agent_setup_failed", "Agent setup needs attention"],
    ["server_restarting", "Waiting for server restart"],
    ["previous_run_settling", "Waiting for previous run to stop"],
  ])("keeps the server's %s hold in its words", (cause, label) => {
    expect(admissionHold({ status: "queued", execution: queued(label, cause) })).toBe(label);
  });

  it("names a wait for the AI provider, and nothing once the run has ended", () => {
    expect(admissionHold({ status: "running", execution: queued("Waiting for the AI provider", null, "waiting_for_provider") })).toBe("Waiting for the AI provider");
    expect(admissionHold({ status: "running", execution: queued("Waiting for maintenance", "task_drain") })).toBeNull();
    expect(admissionHold({ status: "succeeded", execution: queued("Waiting for maintenance", "task_drain") })).toBeNull();
  });
});

describe("a queued run's hold outside the reply card (decision 50)", () => {
  const held = { status: "queued", execution: queued("Waiting for maintenance", "task_drain") };

  it("reads the run detail only while the live row is queued", () => {
    expect(readsHold({ status: "queued" })).toBe(true);
    expect(readsHold({ status: "running" })).toBe(false);
    expect(readsHold(undefined)).toBe(false);
  });

  it("names the hold from the detail, and nothing before it's read or once the row has started", () => {
    expect(liveRunHold({ status: "queued" }, held)).toBe("Waiting for maintenance");
    expect(liveRunHold({ status: "queued" }, undefined)).toBeNull();
    expect(liveRunHold({ status: "queued" }, { status: "queued", execution: queued("Queued", null) })).toBeNull();
    expect(liveRunHold({ status: "running" }, held)).toBeNull();
    // The detail is ahead of the list: the run has started, so there's no hold to name.
    expect(liveRunHold({ status: "queued" }, { status: "running", execution: queued("Waiting for maintenance", "task_drain") })).toBeNull();
  });

  it("falls back to a modest refresh only while the detail says queued", () => {
    expect(holdRefreshInterval(undefined)).toBe(QUEUED_HOLD_REFRESH_MS);
    expect(holdRefreshInterval({ status: "queued" })).toBe(QUEUED_HOLD_REFRESH_MS);
    expect(holdRefreshInterval({ status: "running" })).toBe(false);
    expect(QUEUED_HOLD_REFRESH_MS).toBeGreaterThanOrEqual(5_000);
  });
});
