import type { CompanySearchIssueSummary, StatusCard, StatusCardRefreshPolicy, StatusCardUpdate } from "@paperclipai/shared";
import type { StatusCardDryRun } from "@/api/status-cards";
import type { Gradient } from "@/ui/status-meta";

/*
 * Status cards' rules, kept apart from the components so they can be tested (after
 * ui/src/lib/status-card-state.ts and ui/src/pages/StatusCards/format.ts): the state a card shows,
 * the labels for its refresh policy, cost and tokens, the rough cost preview, the today and lifetime
 * rollups of its updates ledger, which updates are summary revisions, and the dry run's matches.
 */

/** What a card shows, from its stored `state` plus `archivedAt`, `generatingIssueId` and `pendingChangeCount`. */
export type CardLifecycle = "compiling" | "fresh" | "stale" | "updating" | "error" | "paused_budget" | "paused_hours" | "archived";

/** Archived, then setting up, error, paused, updating (a run is under way), stale (changes pending), fresh. */
export function cardLifecycle(card: Pick<StatusCard, "state" | "archivedAt" | "generatingIssueId" | "pendingChangeCount">): CardLifecycle {
  if (card.archivedAt) return "archived";
  if (card.state === "compiling") return "compiling";
  if (card.state === "error") return "error";
  if (card.state === "paused_budget") return "paused_budget";
  if (card.state === "paused_hours") return "paused_hours";
  if (card.generatingIssueId) return "updating";
  if (card.pendingChangeCount > 0) return "stale";
  return "fresh";
}

/** Each state's capsule (Capsule Stack's status gradients), label and one-line meaning. */
export const LIFECYCLE: Record<CardLifecycle, { label: string; gradient: Gradient; description: string }> = {
  compiling: { label: "Setting up", gradient: "ion", description: "Just created: the agent is building its query and first summary." },
  fresh: { label: "Fresh", gradient: "lagoon", description: "The summary covers every change it knows of." },
  stale: { label: "Stale", gradient: "ember", description: "Tasks changed since the last update." },
  updating: { label: "Updating", gradient: "ion", description: "An update is running now." },
  error: { label: "Error", gradient: "flare", description: "The last run failed; the last good summary stays." },
  paused_budget: { label: "Paused: token cap", gradient: "ash", description: "Today's token cap is used up; automatic updates wait for tomorrow (UTC)." },
  paused_hours: { label: "Paused: outside hours", gradient: "ash", description: "Outside active hours; changes wait for one update when the window opens." },
  archived: { label: "Archived", gradient: "ash", description: "No automatic updates and no watching. Restore to start again." },
};

/**
 * Whether the card's first setup is really under way. A card still setting up without a task to do
 * it stalled (its run died), and needs Run setup again.
 */
export function setupRunning(card: Pick<StatusCard, "state" | "generatingIssueId" | "archivedAt" | "pendingChangeCount">): boolean {
  return cardLifecycle(card) === "compiling" && Boolean(card.generatingIssueId);
}

/** Whether the card's capsule breathes: a run is really under way (an update, or a setup that hasn't stalled). */
export function cardIsLive(card: Pick<StatusCard, "state" | "generatingIssueId" | "archivedAt" | "pendingChangeCount">): boolean {
  const state = cardLifecycle(card);
  return state === "updating" || (state === "compiling" && Boolean(card.generatingIssueId));
}

/** A card that's setting up or updating changes without telling the live events, so the page polls. */
export function cardIsBusy(card: Pick<StatusCard, "state" | "generatingIssueId" | "archivedAt" | "pendingChangeCount">): boolean {
  const state = cardLifecycle(card);
  return state === "compiling" || state === "updating";
}

// ---------------------------------------------------------------------------------------------
// Labels

/** "1.1k tok", "940 tok"; null when there's no number. */
export function formatTokens(tokens: number | null | undefined): string | null {
  if (tokens === null || tokens === undefined) return null;
  if (tokens < 1000) return `${tokens} tok`;
  return `${(tokens / 1000).toFixed(1)}k tok`;
}

/** Dollars from cents, keeping a sub-cent update visible: "$0.006", "$0.42". */
export function formatCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  const dollars = cents / 100;
  if (dollars === 0) return "$0.00";
  if (dollars < 0.1) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(2)}`;
}

/** A time label (`updatedLabel`'s "Just now", "5m ago", "Yesterday", "Oct 26") for the middle of a sentence. */
export function midSentence(label: string): string {
  return label === "Just now" || label === "Yesterday" ? label.toLowerCase() : label;
}

/** "0.4k in / 0.2k out": an update's token split. */
export function formatTokenSplit(input: number, output: number): string {
  const short = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);
  return `${short(input)} in / ${short(output)} out`;
}

/** One line for a card's refresh policy: "Manual", "Every 15 min if changed", "On change (60s)". */
export function policyLabel(policy: StatusCardRefreshPolicy): string {
  switch (policy.mode) {
    case "interval":
      return policy.intervalMinutes ? `Every ${policy.intervalMinutes} min if changed` : "On a schedule if changed";
    case "reactive":
      return `On change (${policy.debounceSeconds ?? 60}s)`;
    default:
      return "Manual";
  }
}

export function updateKindLabel(kind: StatusCardUpdate["kind"]): string {
  if (kind === "compile") return "Query build";
  if (kind === "full") return "Full rebuild";
  return "Incremental";
}

export function triggerLabel(trigger: StatusCardUpdate["trigger"]): string {
  if (trigger === "interval") return "schedule";
  if (trigger === "reactive") return "on change";
  return trigger;
}

/** What a change in an update's ledger was, for changes without a status move. */
export function changeKindLabel(changeKind: string): string {
  if (changeKind === "entered_query" || changeKind === "new") return "New match";
  if (changeKind === "left_query") return "Left the query";
  const words = changeKind.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------------------------------------------------------------------------------------------
// The updates ledger

export type Rollup = { updateCount: number; totalTokens: number; totalCostCents: number };

// Query builds cost tokens (they count toward the totals) but aren't summary updates.
function rollup(updates: readonly StatusCardUpdate[]): Rollup {
  return updates.reduce(
    (acc, update) => ({
      updateCount: acc.updateCount + (update.kind === "compile" ? 0 : 1),
      totalTokens: acc.totalTokens + update.inputTokens + update.outputTokens,
      totalCostCents: acc.totalCostCents + update.costCents,
    }),
    { updateCount: 0, totalTokens: 0, totalCostCents: 0 },
  );
}

/** The whole ledger, for an archived card's lifetime cost. */
export function rollupAll(updates: readonly StatusCardUpdate[]): Rollup {
  return rollup(updates);
}

/** Updates started since midnight UTC, the daily token cap's day. */
export function rollupToday(updates: readonly StatusCardUpdate[], now: Date = new Date()): Rollup {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return rollup(updates.filter((update) => new Date(update.startedAt).getTime() >= start.getTime()));
}

/**
 * The updates that wrote a summary, newest first. The server writes each one and its summary
 * revision together, so they pair with the document's revisions (also newest first) by position;
 * one still running has no revision yet.
 */
export function summaryUpdates(updates: readonly StatusCardUpdate[]): StatusCardUpdate[] {
  return updates.filter((update) => update.status === "ok" && update.finishedAt && (update.kind === "full" || update.kind === "incremental"));
}

// ---------------------------------------------------------------------------------------------
// The dry run

/**
 * The tasks the compiled queries match now, each once (the queries are a union), and the ones the
 * latest summary mentions that no query matched.
 */
export function dryRunMatches(dryRun: Pick<StatusCardDryRun, "queries" | "mentionedIssues"> | undefined): {
  matched: CompanySearchIssueSummary[];
  mentioned: CompanySearchIssueSummary[];
} {
  const seen = new Set<string>();
  const matched: CompanySearchIssueSummary[] = [];
  for (const { result } of dryRun?.queries ?? []) {
    for (const item of result.results) {
      if (!item.issue || seen.has(item.issue.id)) continue;
      seen.add(item.issue.id);
      matched.push(item.issue);
    }
  }
  return { matched, mentioned: (dryRun?.mentionedIssues ?? []).filter((issue) => !seen.has(issue.id)) };
}

// ---------------------------------------------------------------------------------------------
// Settings

export const INTERVAL_OPTIONS = [5, 15, 30, 60] as const;
export const DEBOUNCE_OPTIONS = [30, 60, 120, 300] as const;

/** What the server's policy evaluation uses when a card sets no daily cap (status-card-update-engine.ts). */
export const SERVER_DEFAULT_DAILY_CAP = 100_000;

export type TriggerKey = keyof StatusCardRefreshPolicy["triggers"];

export const TRIGGERS: { key: TriggerKey; label: string; noisy?: true }[] = [
  { key: "statusTransitions", label: "A task becomes blocked, in review, done or cancelled" },
  { key: "membershipChanges", label: "A task starts or stops matching the query" },
  { key: "humanComments", label: "A person comments" },
  { key: "assigneeChanges", label: "The assignee changes" },
  { key: "anyUpdate", label: "Any update at all (noisy: includes work in progress)", noisy: true },
];

/** The server's default policy (`defaultStatusCardRefreshPolicy`, a value ui-new can't import). */
export function defaultPolicy(): StatusCardRefreshPolicy {
  return {
    mode: "manual",
    triggers: { statusTransitions: true, membershipChanges: true, humanComments: true, assigneeChanges: true, anyUpdate: false },
  };
}

/** Switching mode fills the fields the new mode needs (the server requires them). */
export function withMode(policy: StatusCardRefreshPolicy, mode: StatusCardRefreshPolicy["mode"]): StatusCardRefreshPolicy {
  const next: StatusCardRefreshPolicy = { ...policy, mode };
  if (mode === "interval") next.intervalMinutes = policy.intervalMinutes ?? 15;
  if (mode === "reactive") {
    next.debounceSeconds = policy.debounceSeconds ?? 60;
    next.maxUpdatesPerHour = policy.maxUpdatesPerHour ?? 6;
  }
  return next;
}

// Rough sizes for the cost preview, from the old UI (format.ts): a full rebuild about 4.5k tokens and
// 3¢, an incremental update about 2k and 1¢. Real cost is in the ledger.
const FULL_TOKENS = 4_500;
const FULL_CENTS = 3;
const INCREMENTAL_TOKENS = 2_000;
const INCREMENTAL_CENTS = 1;

function windowMinutes(policy: StatusCardRefreshPolicy): number {
  const hours = policy.activeHours;
  if (!hours) return 24 * 60;
  const [startH = 0, startM = 0] = hours.start.split(":").map(Number);
  const [endH = 0, endM = 0] = hours.end.split(":").map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  const span = end > start ? end - start : 24 * 60 - (start - end);
  return span > 0 ? span : 24 * 60;
}

/** A per-day preview for a policy: the cost, a line on how it was reached, and a caveat. */
export function estimateCost(policy: StatusCardRefreshPolicy): { cost: string; detail: string; note: string } {
  if (policy.mode === "manual") {
    const cost = `${formatCents(FULL_CENTS)} · ${formatTokens(FULL_TOKENS)}`;
    return { cost: `${cost} per update`, detail: `About one rebuild per Update now ≈ ${cost}`, note: "A manual card only spends tokens when you ask for an update." };
  }
  const minutes = windowMinutes(policy);
  let perDay: number;
  let cadence: string;
  if (policy.mode === "interval") {
    const interval = policy.intervalMinutes ?? 15;
    perDay = Math.floor(minutes / interval);
    cadence = `every ${interval} min`;
  } else {
    const perHour = policy.maxUpdatesPerHour ?? 6;
    perDay = Math.round((minutes / 60) * perHour);
    cadence = `up to ${perHour} an hour`;
  }
  const cap = policy.dailyTokenCap ?? SERVER_DEFAULT_DAILY_CAP;
  const byCap = Math.floor(cap / INCREMENTAL_TOKENS);
  const updates = Math.max(0, Math.min(perDay, byCap));
  const cost = `${formatCents(updates * INCREMENTAL_CENTS)} · ${formatTokens(updates * INCREMENTAL_TOKENS)}`;
  return {
    cost: `up to ${cost} a day`,
    detail: `Up to ~${updates} updates a day (${cadence}${policy.activeHours ? " in active hours" : ""}) ≈ ${cost}`,
    note:
      byCap < perDay
        ? `Held by the ${formatTokens(cap)} daily cap: the card pauses when it's reached.`
        : "It only runs when something changed; otherwise the check is free.",
  };
}

/** The dry run needs a compiled query or tasks the summary mentions. */
export function hasWatchSet(card: Pick<StatusCard, "queries" | "mentionedIssueIds">): boolean {
  return card.queries.length > 0 || (card.mentionedIssueIds?.length ?? 0) > 0;
}

/** The 422 the server answers when no agent can run the card. */
export function isSummarizerMissing(error: unknown): boolean {
  const body = (error as { body?: unknown } | null)?.body;
  if (!body || typeof body !== "object") return false;
  const record = body as { code?: unknown; details?: { code?: unknown } };
  return record.code === "summarizer_not_configured" || record.details?.code === "summarizer_not_configured";
}
