import { describe, expect, it } from "vitest";
import { applyRunEvent, liveStatusLine, mergeStatus, snapshotOfRun, type RunStatusSnapshot } from "./live-run-status";

const T = Date.parse("2026-11-10T12:00:00Z");
const iso = (ms: number) => new Date(T + ms).toISOString();

const status = (extra: Partial<RunStatusSnapshot> = {}): RunStatusSnapshot => ({ message: null, toolName: null, snippet: null, updatedAt: T, lastEventAt: T, ...extra });

describe("the live run's status line (U107, #20460)", () => {
  it("names the tool first, then the agent's latest words, then the status message", () => {
    expect(liveStatusLine(status({ toolName: "Bash", snippet: "Running the tests", message: "Working" }), T + 4_000)).toBe("Using Bash · 4s ago");
    expect(liveStatusLine(status({ snippet: "Running the tests", message: "Working" }), T + 4_000)).toBe("Running the tests · 4s ago");
    expect(liveStatusLine(status({ message: "Working" }), T)).toBe("Working · 0s ago");
  });

  it("shows a storage wait, and says so once the run has been quiet for 15 seconds", () => {
    const wait = status({ message: "Waiting for file storage before starting the run log (45s so far)" });
    expect(liveStatusLine(wait, T + 14_000)).toBe("Waiting for file storage before starting the run log (45s so far) · 14s ago");
    expect(liveStatusLine(wait, T + 75_000)).toBe("Waiting for file storage before starting the run log (45s so far) · no output for 1m 15s");
  });

  it("says only how long it's been when the run has no status, and nothing without either", () => {
    expect(liveStatusLine(status(), T + 3_000)).toBe("Last output 3s ago");
    expect(liveStatusLine(status(), T + 20_000)).toBe("No output for 20s");
    expect(liveStatusLine(status({ message: "Starting", lastEventAt: null }), T)).toBe("Starting");
    expect(liveStatusLine(status({ lastEventAt: null }), T)).toBeNull();
    expect(liveStatusLine(null, T)).toBeNull();
  });

  it("reads the status a run read carries, with its last output when the runtime has no event", () => {
    expect(
      snapshotOfRun({ currentStatusMessage: " Working ", currentToolName: "", lastAssistantSnippet: null, currentStatusUpdatedAt: iso(0), lastEventAt: iso(-5_000), lastOutputAt: iso(-1_000) }),
    ).toEqual({ message: "Working", toolName: null, snippet: null, updatedAt: T, lastEventAt: T - 1_000 });
    expect(snapshotOfRun({ lastOutputAt: "not a date" })).toEqual({ message: null, toolName: null, snippet: null, updatedAt: null, lastEventAt: null });
    expect(snapshotOfRun(null)).toBeNull();
  });
});

describe("live events", () => {
  const event = (type: string, payload: Record<string, unknown>, at = 0) => ({ type: type as never, payload: { runId: "r1", ...payload }, createdAt: iso(at) });

  it("a progress event replaces the status whole, so a finished tool call clears", () => {
    const using = applyRunEvent(null, event("heartbeat.run.progress", { message: "Working", currentToolName: "Bash", updatedAt: iso(1_000), lastEventAt: iso(1_000) }), "r1");
    expect(using).toEqual({ message: "Working", toolName: "Bash", snippet: null, updatedAt: T + 1_000, lastEventAt: T + 1_000 });
    const done = applyRunEvent(using, event("heartbeat.run.progress", { message: "Working", lastAssistantSnippet: "All green", updatedAt: iso(2_000) }), "r1");
    expect(done).toEqual({ message: "Working", toolName: null, snippet: "All green", updatedAt: T + 2_000, lastEventAt: T + 2_000 });
  });

  it("a log line, an activity signal or a run event moves the last sign of life", () => {
    const base = status({ message: "Working" });
    expect(applyRunEvent(base, event("heartbeat.run.log", { ts: iso(3_000) }), "r1")).toMatchObject({ message: "Working", lastEventAt: T + 3_000 });
    expect(applyRunEvent(base, event("heartbeat.run.activity", { lastOutputAt: iso(4_000) }), "r1")).toMatchObject({ lastEventAt: T + 4_000 });
    expect(applyRunEvent(base, event("heartbeat.run.event", { currentToolName: "Read" }, 5_000), "r1")).toMatchObject({ message: "Working", toolName: "Read", updatedAt: T, lastEventAt: T + 5_000 });
    // An older signal doesn't move it back.
    expect(applyRunEvent(base, event("heartbeat.run.log", { ts: iso(-9_000) }), "r1")?.lastEventAt).toBe(T);
  });

  it("ignores other runs and other events", () => {
    expect(applyRunEvent(null, event("heartbeat.run.progress", { runId: "r2", message: "Other" }), "r1")).toBeNull();
    expect(applyRunEvent(null, event("heartbeat.run.status", { status: "running" }), "r1")).toBeNull();
  });

  it("keeps the newer of the read's status and the live one, and the latest sign of life", () => {
    const read = status({ message: "Waiting for file storage before restoring the workspace (30s so far)", updatedAt: T + 10_000, lastEventAt: T + 10_000 });
    const older = status({ message: "Working", updatedAt: T, lastEventAt: T + 12_000 });
    expect(mergeStatus(read, older)).toEqual({ ...read, lastEventAt: T + 12_000 });
    const newer = status({ message: "File storage is back after 31s", updatedAt: T + 11_000, lastEventAt: T + 11_000 });
    expect(mergeStatus(read, newer)).toEqual(newer);
    // A log line alone carries no status: the read's stays.
    expect(mergeStatus(read, { message: null, toolName: null, snippet: null, updatedAt: null, lastEventAt: T + 20_000 })).toEqual({ ...read, lastEventAt: T + 20_000 });
    expect(mergeStatus(null, newer)).toBe(newer);
    expect(mergeStatus(read, null)).toBe(read);
  });
});
