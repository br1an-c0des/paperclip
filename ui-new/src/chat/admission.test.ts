import { describe, expect, it } from "vitest";
import { admissionHold } from "./admission";

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
