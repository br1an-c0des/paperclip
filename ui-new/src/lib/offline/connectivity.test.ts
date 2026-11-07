import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnectivityStore } from "./connectivity";
import { classifySendFailure, describeError, UncertainWriteError } from "./errors";
import { readNote } from "./read-state";

const status = (code: number, error?: string) => Object.assign(new Error(error ?? `Request failed: ${code}`), { status: code, body: error ? { error } : null });

afterEach(() => {
  vi.useRealTimers();
});

describe("createConnectivityStore", () => {
  it("goes offline only when the health check fails too, and recovers when it passes", async () => {
    vi.useFakeTimers();
    let healthy = false;
    const store = createConnectivityStore({ probe: async () => healthy, target: null });
    const recovered = vi.fn();
    store.onRecovered(recovered);

    store.reportFailure(status(422));
    expect(store.status()).toBe("online");
    store.reportFailure(status(502));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.status()).toBe("offline");

    // One request getting through isn't proof; it brings the check forward.
    healthy = true;
    store.reportSuccess();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.status()).toBe("online");
    expect(recovered).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it("keeps checking with backoff while the server is down", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => false);
    const store = createConnectivityStore({ probe, target: null });
    store.reportFailure(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 5_000);
    expect(probe).toHaveBeenCalledTimes(4);
    store.reportOnline();
    expect(store.status()).toBe("online");
    store.dispose();
  });
});

describe("errors", () => {
  it("keeps a write that may have landed, and gives up on refusals", () => {
    expect(classifySendFailure(status(503))).toBe("pending");
    expect(classifySendFailure(status(500))).toBe("pending");
    expect(classifySendFailure(new UncertainWriteError())).toBe("pending");
    expect(classifySendFailure(status(409))).toBe("rejected");
    expect(classifySendFailure(status(422, "Title is required"))).toBe("rejected");
  });

  it("words errors for people, not codes", () => {
    expect(describeError(status(503, "WORKER_UNAVAILABLE"))).toMatch(/temporarily unavailable/);
    expect(describeError(status(403, "forbidden"))).toBe("You don't have permission to see this.");
    expect(describeError(status(422, "Title is required"))).toBe("Title is required");
    expect(describeError(status(500), "Couldn't save.")).toBe("Couldn't save.");
  });

  it("shows a read's error instead of loading, unless it has data", () => {
    const error = status(503);
    const words = { loading: "Loading…", failed: "Couldn't load the runs." };
    expect(readNote({ isPending: true, fetchStatus: "fetching", error: null, data: undefined }, "None", words)).toBe("Loading…");
    expect(readNote({ isPending: true, fetchStatus: "idle", error: null, data: undefined }, "None", words)).toBe("None");
    expect(readNote({ isPending: false, fetchStatus: "idle", error, data: undefined }, "None", words)).toBe(
      "Couldn't load the runs. Paperclip is temporarily unavailable. Please try again in a moment.",
    );
    expect(readNote({ isPending: false, fetchStatus: "idle", error, data: [] }, "None", words)).toBe("None");
  });
});
