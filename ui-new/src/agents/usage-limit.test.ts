import { describe, expect, it } from "vitest";
import { queryKeys } from "@/api/queryKeys";
import { keysForEvent } from "@/lib/live-events";
import { creditsLine, limitClock, usageLimit, usageRows } from "./usage-limit";

const now = new Date(2026, 10, 5, 12, 0).getTime();
const at = (hours: number, minutes = 0) => new Date(2026, 10, 5, hours, minutes).toISOString();

function state(snapshot: Record<string, unknown>) {
  return {
    providerRateLimits: {
      schema: "paperclip.provider.rate_limits.v1",
      provider: "openai",
      credits: null,
      limitReached: null,
      observedAt: at(11, 30),
      windows: [
        { id: "primary", label: "5-hour window", shortLabel: "5h", windowMinutes: 300, usedPercent: 78, resetsAt: at(15, 40), status: "allowed" },
        { id: "weekly", label: "Weekly", shortLabel: "7d", windowMinutes: 10080, usedPercent: 40, resetsAt: new Date(2026, 10, 9, 9, 0).toISOString(), status: "allowed" },
      ],
      ...snapshot,
    },
  };
}

describe("usageLimit", () => {
  it("shows the fullest current window and when it resets", () => {
    const limit = usageLimit(state({}), now)!;
    expect(limit.label).toBe("5h 78% · resets 15:40");
    expect(limit.provider).toBe("Codex");
    expect(limit.summary.tone).toBe("normal");
    expect(usageRows(limit, now)).toEqual([
      { id: "primary", label: "5-hour window", percent: 78, tone: "normal", resets: "15:40" },
      { id: "weekly", label: "Weekly", percent: 40, tone: "normal", resets: "Mon 09:00" },
    ]);
  });

  it("says Limited until the reset while the provider refuses work", () => {
    const limit = usageLimit(state({ limitReached: { windowId: "primary", reason: "rate_limit_reached", resetsAt: at(15, 40) } }), now)!;
    expect(limit.label).toBe("Limited until 15:40");
    expect(limit.summary.tone).toBe("reached");
    expect(usageRows(limit, now)[0]).toMatchObject({ id: "primary", tone: "reached" });
  });

  it("says using credits when a used-up window falls back to them", () => {
    const windows = [{ id: "weekly", label: "Weekly", shortLabel: "7d", windowMinutes: 10080, usedPercent: 100, resetsAt: at(18), status: "rejected" }];
    const limit = usageLimit(state({ windows, credits: { hasCredits: true, unlimited: false, balance: "12.50" } }), now)!;
    expect(limit.label).toBe("7d 100% · using credits");
    expect(limit.summary.tone).toBe("warn");
    expect(creditsLine(limit.snapshot)).toBe("12.50 credits");
  });

  it("shows nothing once every window has rolled over, or with no snapshot", () => {
    const windows = [{ id: "primary", label: "5-hour window", shortLabel: "5h", windowMinutes: 300, usedPercent: 90, resetsAt: at(11), status: "allowed" }];
    expect(usageLimit(state({ windows }), now)).toBeNull();
    expect(usageLimit({}, now)).toBeNull();
    expect(usageLimit(null, now)).toBeNull();
  });

  it("writes later days with their weekday or date", () => {
    expect(limitClock(new Date(2026, 10, 7, 8, 5).toISOString(), now)).toBe("Sat 08:05");
    expect(limitClock(new Date(2026, 10, 20, 8, 5).toISOString(), now)).toBe("Nov 20 08:05");
  });

  it("is refreshed by the runtime-state live event, under the key the task reads", () => {
    const keys = keysForEvent("c1", { type: "agent.runtime_state.updated", companyId: "c1", payload: { agentId: "a1" } } as never);
    expect(keys).toContainEqual(queryKeys.agents.part("a1", "runtime-state"));
  });
});
