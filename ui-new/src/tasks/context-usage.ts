import type { IssueContextCompaction, IssueContextUsage } from "@paperclipai/shared";

/*
 * The task's Context row (TaskContext.tsx), worked out from `GET /issues/:id/context-usage`: how full
 * the assignee session's context window is, the breakdown behind it, and what Compact now can do.
 * Ported from ui/src/components/ContextUsageMeter.tsx and issue-properties/context-usage-row.tsx
 * (upstream #19273, #19378).
 */

/** Refresh cadence while a run on the task is reporting usage. */
export const ACTIVE_REFRESH_MS = 8_000;

/** Compact token count for context-window labels: 950, 1.2k, 258k, 1M. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return value >= 10_000 ? `${Math.round(value / 1_000)}k` : `${trimDecimal(value / 1_000)}k`;
  return String(Math.round(value));
}

function trimDecimal(value: number) {
  return value.toFixed(1).replace(/\.0$/, "");
}

export type ContextLevel = "normal" | "near" | "full";

/** Amber within reach of the harness's own compaction (about 80%), red when nearly full. */
export function contextLevel(usage: Pick<IssueContextUsage, "usedTokens" | "windowTokens">): ContextLevel {
  const fraction = usage.usedTokens / usage.windowTokens;
  if (fraction >= 0.95) return "full";
  return fraction >= 0.8 ? "near" : "normal";
}

/** Whole percent used, capped at 100. */
export function contextPercent(usage: Pick<IssueContextUsage, "usedTokens" | "windowTokens">) {
  if (!(usage.windowTokens > 0)) return 0;
  return Math.min(100, Math.round((usage.usedTokens / usage.windowTokens) * 100));
}

/** "10% of 258k", the row's value. */
export function contextLabel(usage: Pick<IssueContextUsage, "usedTokens" | "windowTokens">) {
  return `${contextPercent(usage)}% of ${formatTokens(usage.windowTokens)}`;
}

/** The breakdown's lines, leaving out what the provider didn't report. */
export function contextRows(usage: IssueContextUsage): { label: string; value: string; muted?: boolean }[] {
  const rows: { label: string; value: string; muted?: boolean }[] = [];
  const totals = usage.totals;
  if (totals) {
    rows.push({
      label: "Input",
      value: totals.cachedInputTokens ? `${formatTokens(totals.inputTokens)} · ${formatTokens(totals.cachedInputTokens)} cached` : formatTokens(totals.inputTokens),
    });
    rows.push({ label: "Output", value: formatTokens(totals.outputTokens) });
  }
  if (usage.costUsd != null) rows.push({ label: "Cost", value: `$${usage.costUsd.toFixed(2)}` });
  if (usage.compactions) rows.push({ label: "Compactions", value: String(usage.compactions), muted: true });
  return rows;
}

/**
 * What Compact now shows, as upstream words it: available, "Compacting…" while a request is out or
 * the server has one pending, or unavailable with the server's reason. Null when the server gave no
 * compaction state (an older server), so the card shows no action.
 */
export type CompactState =
  | { status: "available"; note: string }
  | { status: "pending"; note: string }
  | { status: "unavailable"; note: string };

export function compactState(compaction: IssueContextCompaction | undefined, requesting: boolean): CompactState | null {
  if (!compaction) return null;
  if (requesting || compaction.status === "pending") {
    return { status: "pending", note: "The agent is summarizing its conversation. This usually takes under a minute." };
  }
  if (compaction.status === "unavailable") return { status: "unavailable", note: compaction.reason ?? "Compaction is unavailable right now." };
  return { status: "available", note: "Summarizes the conversation so far so the agent has room to keep working." };
}

/** The warning under the bar once the window is close to full. */
export function levelNote(level: ContextLevel) {
  return level === "normal" ? null : "Close to full. The agent will compact its context soon.";
}
