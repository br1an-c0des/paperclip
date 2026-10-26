import { describe, expect, it } from "vitest";
import {
  costLabel,
  elapsedLabel,
  formatBytes,
  formatDuration,
  runDurationMs,
  runPosition,
  runStatusLabel,
  runStatusMeta,
  runUsage,
  shortId,
  supportsProviderTrace,
  tokenCount,
  triggerLabel,
} from "./run-model";

const run = (status: string, startedAt: string | null, finishedAt: string | null) => ({
  status,
  startedAt,
  finishedAt,
  createdAt: "2026-10-26T10:00:00Z",
});

describe("run status and timing", () => {
  it("names each status with a tone and gradient, and keeps unknown ones readable", () => {
    expect(runStatusMeta("running")).toMatchObject({ label: "Running", tone: "run", gradient: "ion", live: true });
    expect(runStatusMeta("succeeded")).toMatchObject({ label: "Succeeded", tone: "green" });
    expect(runStatusMeta("cancelled").label).toBe("Stopped");
    expect(runStatusMeta("waiting_on_input")).toMatchObject({ label: "Waiting on input", tone: "neutral" });
  });

  it("formats durations the way the boards do", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration((18 * 60 + 12) * 1000)).toBe("18m 12s");
    expect(formatDuration((24 * 60 + 6) * 1000)).toBe("24m 06s");
    expect(formatDuration((2 * 3600 + 5 * 60) * 1000)).toBe("2h 05m");
    expect(formatDuration(-5)).toBe("0s");
  });

  it("stamps transcript lines with the time since the run started", () => {
    expect(elapsedLabel(0)).toBe("0:00");
    expect(elapsedLabel(4_000)).toBe("0:04");
    expect(elapsedLabel((15 * 60 + 1) * 1000)).toBe("15:01");
    expect(elapsedLabel((3600 + 2 * 60 + 3) * 1000)).toBe("1:02:03");
  });

  it("measures a finished run to its end, a running one to now, and a queued one not at all", () => {
    const now = new Date("2026-10-26T10:18:12Z");
    expect(runDurationMs(run("succeeded", "2026-10-26T10:00:00Z", "2026-10-26T10:24:06Z"), now)).toBe(24 * 60_000 + 6_000);
    expect(runDurationMs(run("running", "2026-10-26T10:00:00Z", null), now)).toBe(18 * 60_000 + 12_000);
    expect(runDurationMs(run("queued", null, null), now)).toBeNull();
    expect(runStatusLabel(run("running", "2026-10-26T10:00:00Z", null), now)).toBe("Running · 18m 12s");
    expect(runStatusLabel(run("queued", null, null), now)).toBe("Queued");
  });
});

describe("usage and sizes", () => {
  it("reads tokens and cost from either naming style", () => {
    const usage = runUsage({
      usageJson: { input_tokens: 131204, output_tokens: 21408, cache_read_input_tokens: 1080512, total_cost_usd: 0.71, model: "claude-opus-5-5" },
      resultJson: null,
    });
    expect(usage).toMatchObject({ available: true, input: 131204, output: 21408, cached: 1080512, costUsd: 0.71, model: "claude-opus-5-5" });
  });

  it("counts a subscription run as free and an externally billed one as unreported", () => {
    expect(runUsage({ usageJson: { costUsd: 3, billingType: "subscription_included" }, resultJson: null })).toMatchObject({
      costUsd: 0,
      subscription: true,
    });
    expect(
      runUsage({ usageJson: null, resultJson: { providerAccounting: { externallyBilled: true, usage: null, cost: null } } }),
    ).toMatchObject({ available: false, costUsd: null });
  });

  it("shortens counts, sizes, costs and ids", () => {
    expect(tokenCount(312)).toBe("312");
    expect(tokenCount(9_800)).toBe("9.8k");
    expect(tokenCount(412_000)).toBe("412k");
    expect(tokenCount(1_210_000)).toBe("1.21M");
    expect(tokenCount(12_000_000)).toBe("12M");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(48 * 1024)).toBe("48 KB");
    expect(formatBytes(1.8 * 1024 * 1024)).toBe("1.8 MB");
    expect(costLabel(0.384)).toBe("$0.38");
    expect(costLabel(0.004)).toBe("<$0.01");
    expect(shortId("7f3a9b2e-1c21")).toBe("7f3a…c21");
  });
});

describe("why a run started and where it sits", () => {
  it("prefers the wake reason over the invocation source", () => {
    expect(triggerLabel({ invocationSource: "assignment", contextSnapshot: { wakeReason: "issue_commented" } })).toBe("Woken by a comment");
    expect(triggerLabel({ invocationSource: "timer", contextSnapshot: null })).toBe("On a schedule");
    expect(triggerLabel({ invocationSource: "on_demand", contextSnapshot: { wakeReason: "something_new" } })).toBe("Woken: something new");
  });

  it("numbers a run among its task's runs, oldest first", () => {
    const siblings = [
      { runId: "c", createdAt: "2026-10-26T12:00:00Z" },
      { runId: "a", createdAt: "2026-10-26T10:00:00Z" },
      { runId: "b", createdAt: "2026-10-26T11:00:00Z" },
    ];
    expect(runPosition("b", siblings)).toEqual({ title: "Run #2", position: "Run 2 of 3", previousId: "a", nextId: "c" });
    expect(runPosition("a", siblings)).toMatchObject({ previousId: null, nextId: "b" });
    expect(runPosition("1234567890", undefined)).toEqual({ title: "Run 12345678", position: null, previousId: null, nextId: null });
  });

  it("can't trace Muse runs", () => {
    expect(supportsProviderTrace("paperclip_runner", { provider: "muse" })).toBe(false);
    expect(supportsProviderTrace("paperclip_runner", { provider: "openai" })).toBe(true);
    expect(supportsProviderTrace("claude_local", {})).toBe(true);
  });
});
