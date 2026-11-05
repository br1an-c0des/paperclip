import {
  readProviderRateLimits,
  summarizeProviderRateLimits,
  type ProviderRateLimitSnapshot,
  type ProviderRateLimitSummary,
  type ProviderRateLimitWindow,
} from "@paperclipai/shared";

/*
 * An agent's provider usage limit (since the 2026-11-05 sync, upstream #19270): the Codex and Claude
 * rate-limit windows its harness reported, kept per agent in `GET /agents/:id/runtime-state`
 * (`stateJson.providerRateLimits`). The `agent.runtime_state.updated` live event refreshes that
 * read (lib/live-events.tsx, `queryKeys.agents.part(id, "runtime-state")`).
 *
 * The rules for which window to show are the shared runtime exports (`readProviderRateLimits`,
 * `summarizeProviderRateLimits`): the fullest window whose reset is still ahead, "Limited" while the
 * provider refuses work, "using credits" when a used-up window falls back to account credits. The
 * words and tones follow the old UI's AgentRateLimitGauge.tsx. The task's properties show it under
 * the assignee; the agent's Runtime section shows it too.
 */

export type UsageTone = ProviderRateLimitSummary["tone"];

export type UsageLimit = {
  snapshot: ProviderRateLimitSnapshot;
  summary: ProviderRateLimitSummary;
  /** The one line: "5h 78% · resets 15:40", "Limited until 15:40", "7d 100% · using credits". */
  label: string;
  /** "Codex" or "Claude". */
  provider: string;
};

/** The agent's usage limit from its runtime state, or null when there's nothing current to show. */
export function usageLimit(stateJson: Record<string, unknown> | null | undefined, now: number): UsageLimit | null {
  const snapshot = readProviderRateLimits(stateJson);
  const summary = summarizeProviderRateLimits(snapshot, now);
  if (!snapshot || !summary) return null;
  return { snapshot, summary, label: usageLabel(summary, now), provider: snapshot.provider === "openai" ? "Codex" : "Claude" };
}

const pct = (window: ProviderRateLimitWindow | null) => Math.round(window?.usedPercent ?? 0);

export function usageLabel(summary: ProviderRateLimitSummary, now: number) {
  const window = summary.window;
  if (summary.limited) return `Limited${summary.limitedUntil ? ` until ${limitClock(summary.limitedUntil, now)}` : ""}`;
  if (summary.usingCredits) return `${window?.shortLabel ?? ""} ${pct(window)}% · using credits`.trim();
  return `${window?.shortLabel ?? ""} ${pct(window)}%${window?.resetsAt ? ` · resets ${limitClock(window.resetsAt, now)}` : ""}`.trim();
}

/** "15:40" today, "Thu 15:40" within the week, "Nov 12 15:40" after; 24-hour, as the old UI shows it. */
export function limitClock(iso: string, now: number) {
  const at = new Date(iso);
  const time = at.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (new Date(now).toDateString() === at.toDateString()) return time;
  if (Math.abs(at.getTime() - now) < 6 * 86_400_000) return `${at.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
  return `${at.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${time}`;
}

export type UsageRow = { id: string; label: string; percent: number; tone: UsageTone; resets: string | null };

/** Every current window, fullest first, for the popover. */
export function usageRows(limit: Pick<UsageLimit, "snapshot" | "summary">, now: number): UsageRow[] {
  const { snapshot, summary } = limit;
  const reachedId = summary.limited ? (snapshot.limitReached?.windowId ?? null) : null;
  return summary.current.map((window) => {
    const percent = window.usedPercent ?? 0;
    const tone: UsageTone =
      window.id === summary.window?.id && summary.usingCredits ? "warn" : window.id === reachedId || percent >= 100 ? "reached" : percent > 80 ? "warn" : "normal";
    return { id: window.id, label: window.label, percent: Math.round(percent), tone, resets: window.resetsAt ? limitClock(window.resetsAt, now) : null };
  });
}

/** The account's credits, when the provider said anything worth showing. */
export function creditsLine(snapshot: ProviderRateLimitSnapshot) {
  const credits = snapshot.credits;
  if (!credits) return null;
  if (credits.unlimited) return "Unlimited credits";
  if (credits.hasCredits === false) return "No credits left";
  return credits.balance !== null ? `${credits.balance} credits` : null;
}

/** The pill tone for a usage tone (design-system.md "Tones"): amber near the limit, red at it. */
export function usageToneName(tone: UsageTone): "amber" | "red" | null {
  return tone === "reached" ? "red" : tone === "warn" ? "amber" : null;
}
