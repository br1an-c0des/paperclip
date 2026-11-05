import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { hasPendingNativeStop } from "@/api/heartbeats";
import { canStopRun, isNativeStopPending, stopLabel, stopRequestId, stopRun, stopStorageKey } from "./run-stop";
import { runWait, USAGE_LIMIT_WAIT } from "./run-waits";

const api = vi.hoisted(() => ({ get: vi.fn(), cancel: vi.fn(), me: vi.fn() }));
vi.mock("@/api/heartbeats", async (original) => ({
  ...(await original<typeof import("@/api/heartbeats")>()),
  heartbeatsApi: { get: api.get, cancel: api.cancel },
}));
vi.mock("@/api/access", () => ({ accessApi: { currentBoardAccess: api.me } }));

const ID = "11111111-2222-4333-8444-555555555555";

describe("which runs offer Stop, and what it's called", () => {
  it("offers Stop on going runs and on a failed native run that still owns its retry", () => {
    expect(canStopRun({ status: "running" })).toBe(true);
    expect(canStopRun({ status: "queued" })).toBe(true);
    expect(canStopRun({ status: "failed" })).toBe(false);
    expect(canStopRun({ status: "failed", execution: { canStop: true } })).toBe(true);
    expect(canStopRun({ status: "succeeded", execution: { canStop: true } })).toBe(false);
  });

  it("says Cancel for a run that hasn't started, Stop otherwise", () => {
    expect(stopLabel("queued", false)).toBe("Cancel");
    expect(stopLabel("scheduled_retry", true)).toBe("Cancelling…");
    expect(stopLabel("running", false)).toBe("Stop");
    expect(stopLabel("failed", true)).toBe("Stopping…");
  });
});

describe("the correlated Stop's id", () => {
  it("sends the id the server recorded for this person, else the saved one, else a new one", () => {
    const mine = { cancellationRequestId: ID, requestedBy: { type: "board", userId: "u1" } };
    expect(stopRequestId({ startupCancellation: mine, saved: null, userId: "u1" })).toBe(ID);
    expect(() => stopRequestId({ startupCancellation: mine, saved: null, userId: "u2" })).toThrow(/someone else/);
    expect(stopRequestId({ startupCancellation: undefined, saved: ID, userId: "u1" })).toBe(ID);
    expect(stopRequestId({ startupCancellation: undefined, saved: "not-a-uuid", userId: "u1", make: () => "fresh" })).toBe("fresh");
  });

  it("accepts a cancelled answer, or one carrying this Stop's pending intent", () => {
    const run = (nativeCancellation: Record<string, unknown>) => ({ id: "r1", companyId: "c1", status: "failed", resultJson: { nativeCancellation } });
    const intent = {
      schema: "paperclip.native-cancellation.v1",
      runId: "r1",
      companyId: "c1",
      intentId: `native-cancellation:${ID}`,
      scope: "run",
      dispatchState: "pending",
      dispatched: false,
      intentAuditId: "audit-1",
    };
    expect(hasPendingNativeStop(run(intent), "r1", ID)).toBe(true);
    expect(hasPendingNativeStop(run({ ...intent, intentId: "native-cancellation:other" }), "r1", ID)).toBe(false);
    expect(hasPendingNativeStop(run({ ...intent, dispatchState: "acknowledged" }), "r1", ID)).toBe(false);
    expect(hasPendingNativeStop(null, "r1", ID)).toBe(false);
  });

  it("reads a 409 native_stop_pending as recorded", () => {
    expect(isNativeStopPending(new ApiError("Stop is recorded", 409, { error: "Stop is recorded", code: "native_stop_pending" }))).toBe(true);
    expect(isNativeStopPending(new ApiError("Conflict", 409, { error: "Conflict" }))).toBe(false);
    expect(isNativeStopPending(new Error("x"))).toBe(false);
  });
});

describe("stopRun", () => {
  beforeEach(() => {
    sessionStorage.clear();
    api.me.mockResolvedValue({ userId: "u1" });
  });
  afterEach(() => vi.resetAllMocks());

  it("stops a going run with an empty body, and settles a slow native start as pending", async () => {
    api.cancel.mockResolvedValueOnce({ id: "r1", companyId: "c1", status: "cancelled", resultJson: null });
    await expect(stopRun({ runId: "r1", status: "running" }, "c1")).resolves.toBe("stopped");
    expect(api.cancel).toHaveBeenLastCalledWith("r1");
    api.cancel.mockRejectedValueOnce(new ApiError("Stop is recorded", 409, { code: "native_stop_pending" }));
    await expect(stopRun({ runId: "r1", status: "running" }, "c1")).resolves.toBe("pending");
  });

  it("saves the failed retry's id before sending, and sends the same one after a lost answer", async () => {
    api.get.mockResolvedValue({ id: "r2", companyId: "c1", status: "failed", resultJson: {} });
    api.cancel.mockRejectedValueOnce(new ApiError("Bad gateway", 502, null));
    const run = { runId: "r2", status: "failed", execution: { canStop: true } };
    await expect(stopRun(run, "c1")).rejects.toThrow("Bad gateway");
    const first = api.cancel.mock.calls[0]![1].cancellationRequestId as string;
    expect(JSON.parse(sessionStorage.getItem(stopStorageKey("c1", "r2", "u1"))!)).toMatchObject({ requestId: first });

    api.cancel.mockResolvedValueOnce({ id: "r2", companyId: "c1", status: "cancelled", resultJson: null });
    await expect(stopRun(run, "c1")).resolves.toBe("stopped");
    expect(api.cancel.mock.calls[1]![1]).toEqual({ cancellationRequestId: first });
    expect(sessionStorage.getItem(stopStorageKey("c1", "r2", "u1"))).toBeNull();
  });

  it("refuses a run that changed company", async () => {
    api.get.mockResolvedValue({ id: "r2", companyId: "other", status: "failed", resultJson: {} });
    await expect(stopRun({ runId: "r2", status: "failed", execution: { canStop: true } }, "c1")).rejects.toThrow(/changed/);
    expect(api.cancel).not.toHaveBeenCalled();
  });
});

describe("runWait", () => {
  const base = { status: "cancelled", errorCode: null, resultJson: null, execution: null, scheduledRetryAt: null };

  it("names the usage limit wait, from the held run and from its scheduled retry (#19246)", () => {
    expect(runWait({ ...base, errorCode: "provider_limit_wait", resultJson: { providerLimitWait: { resetAt: "2026-11-05T15:40:00.000Z" } } })).toEqual({
      label: USAGE_LIMIT_WAIT,
      until: "2026-11-05T15:40:00.000Z",
    });
    const execution = { phase: "retry_scheduled", label: USAGE_LIMIT_WAIT, retryAt: "2026-11-05T15:41:00.000Z" } as never;
    expect(runWait({ ...base, status: "scheduled_retry", execution })).toEqual({ label: USAGE_LIMIT_WAIT, until: "2026-11-05T15:41:00.000Z" });
  });

  it("leaves other runs alone", () => {
    expect(runWait({ ...base, status: "failed" })).toBeNull();
    expect(runWait({ ...base, status: "running", execution: { phase: "working", label: "Working" } as never })).toBeNull();
  });
});
