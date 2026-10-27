import type { Gradient } from "@/ui/status-meta";

/*
 * The run modal's header (board 16): how a run's status, timing, usage and trigger read. Pure
 * functions over the run as the API returns it, so they can be tested without rendering.
 */

/** Statuses that can still change: the run modal follows these live. */
export const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "scheduled_retry"]);

export function isActiveRun(status: string) {
  return ACTIVE_RUN_STATUSES.has(status);
}

export type RunTone = "run" | "green" | "red" | "amber" | "neutral";

export type RunStatusMeta = { label: string; tone: RunTone; gradient: Gradient; live: boolean };

const STATUS_META: Record<string, RunStatusMeta> = {
  queued: { label: "Queued", tone: "neutral", gradient: "ash", live: false },
  scheduled_retry: { label: "Retry scheduled", tone: "amber", gradient: "ember", live: false },
  running: { label: "Running", tone: "run", gradient: "ion", live: true },
  succeeded: { label: "Succeeded", tone: "green", gradient: "lagoon", live: false },
  failed: { label: "Failed", tone: "red", gradient: "flare", live: false },
  timed_out: { label: "Timed out", tone: "red", gradient: "flare", live: false },
  interrupted: { label: "Interrupted", tone: "amber", gradient: "ember", live: false },
  cancelled: { label: "Stopped", tone: "neutral", gradient: "ash", live: false },
};

export function runStatusMeta(status: string): RunStatusMeta {
  return STATUS_META[status] ?? { label: words(status), tone: "neutral", gradient: "ash", live: false };
}

export function words(value: string) {
  return capitalize(value.replace(/[_-]+/g, " ").trim());
}

export function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "1 step", "41 steps". */
export function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** "45s", "18m 12s", "2h 05m"; "0s" for nothing. */
export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Time since the run started, as the transcript's left column shows it: "0:04", "15:01", "1:02:03". */
export function elapsedLabel(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

type Timed = { status: string; startedAt: string | null; finishedAt: string | null; createdAt: string };

/** How long the run has taken, or has been going; null before it starts. */
export function runDurationMs(run: Timed, now: Date = new Date()) {
  if (!run.startedAt) return null;
  const end = run.finishedAt ? new Date(run.finishedAt) : isActiveRun(run.status) ? now : null;
  if (!end) return null;
  return Math.max(0, end.getTime() - new Date(run.startedAt).getTime());
}

/** "Running · 18m 12s", "Succeeded · 24m 06s", "Queued". */
export function runStatusLabel(run: Timed, now: Date = new Date()) {
  const meta = runStatusMeta(run.status);
  const took = runDurationMs(run, now);
  return took === null ? meta.label : `${meta.label} · ${formatDuration(took)}`;
}

/** "1.2M", "48.2k", "9.8k", "312". */
export function tokenCount(count: number) {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(2))}M`;
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  if (count >= 1_000) return `${Number((count / 1000).toFixed(1))}k`;
  return String(Math.round(count));
}

/** "312 B", "48 KB", "1.8 MB". */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

export function costLabel(usd: number) {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function firstNumber(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  }
  return null;
}

function readCostUsd(record: Record<string, unknown> | null | undefined) {
  if (!record) return null;
  for (const key of ["cacheAdjustedCostUsd", "costUsdExact", "costUsd", "cost_usd", "total_cost_usd"]) {
    const value = record[key];
    if (key === "costUsdExact" && typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

export type RunUsage = {
  /** False when the provider bills outside Paperclip and reported nothing (old UI: "usage unavailable"). */
  available: boolean;
  input: number;
  output: number;
  cached: number;
  costUsd: number | null;
  /** True when the cost is covered by a subscription. */
  subscription: boolean;
  model: string | null;
  provider: string | null;
};

/**
 * Tokens, cost and model from a run's `usageJson` and `resultJson`, following the old UI's rules
 * (ui/src/lib/utils.ts `visibleRunCostUsd`, ui/src/pages/AgentDetail.tsx `runMetrics`).
 */
export function runUsage(run: { usageJson: Record<string, unknown> | null; resultJson: Record<string, unknown> | null }): RunUsage {
  const usage = run.usageJson;
  const result = run.resultJson;
  const accounting = result?.providerAccounting as Record<string, unknown> | undefined;
  const available = !(accounting?.externallyBilled === true && accounting.usage === null && accounting.cost === null);
  const billing = usage?.billingType ?? result?.billingType;
  const subscription = billing === "subscription_included";
  const cost = subscription ? 0 : (readCostUsd(usage) ?? readCostUsd(result));
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    available,
    input: firstNumber(usage, "inputTokens", "input_tokens") ?? 0,
    output: firstNumber(usage, "outputTokens", "output_tokens") ?? 0,
    cached: firstNumber(usage, "cachedInputTokens", "cached_input_tokens", "cache_read_input_tokens") ?? 0,
    costUsd: available ? cost : null,
    subscription,
    model: text(usage?.model) === "unknown" ? null : text(usage?.model),
    provider: text(usage?.provider),
  };
}

const SOURCES: Record<string, string> = {
  timer: "On a schedule",
  assignment: "On assignment",
  on_demand: "Started by hand",
  automation: "By an automation",
};

const WAKE_REASONS: Record<string, string> = {
  issue_commented: "Woken by a comment",
  issue_assigned: "Woken by assignment",
  issue_children_completed: "Woken because its subtasks finished",
  child_issue_completed: "Woken because a subtask finished",
  issue_unblock_requested: "Woken to unblock the task",
  issue_monitor_due: "Woken by the task's monitor",
  issue_recovery_action_restored: "Woken to recover the task",
  retry_failed_run: "Retrying a failed run",
  rerun_with_provider_trace: "Rerun with a provider trace",
  resume_process_lost_run: "Resuming a lost run",
};

/** Why the run started: the wake reason when Paperclip recorded one, else how it was invoked. */
export function triggerLabel(run: { invocationSource: string; contextSnapshot: Record<string, unknown> | null }) {
  const reason = run.contextSnapshot?.wakeReason;
  if (typeof reason === "string" && reason) return WAKE_REASONS[reason] ?? `Woken: ${words(reason).toLowerCase()}`;
  return SOURCES[run.invocationSource] ?? words(run.invocationSource);
}

/** "7f3a…c21", the way the boards shorten session and run ids. */
export function shortId(id: string, head = 4, tail = 3) {
  return id.length <= head + tail + 1 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/**
 * Where a run sits among its task's runs, oldest first: "Run #7", "Run 7 of 7", and the runs either
 * side. Without a task (or before the list loads) the run goes by its short id.
 */
export function runPosition(runId: string, siblings: readonly { runId: string; createdAt: string }[] | undefined) {
  const ordered = [...(siblings ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const index = ordered.findIndex((run) => run.runId === runId);
  if (index < 0) return { title: `Run ${runId.slice(0, 8)}`, position: null, previousId: null, nextId: null };
  return {
    title: `Run #${index + 1}`,
    position: `Run ${index + 1} of ${ordered.length}`,
    previousId: ordered[index - 1]?.runId ?? null,
    nextId: ordered[index + 1]?.runId ?? null,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "10:31:48 am". */
export function clockTime(value: string | Date) {
  const date = new Date(value);
  const hours = date.getHours();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${hours % 12 || 12}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${hours < 12 ? "am" : "pm"}`;
}

/** "Today", "Yesterday", "Oct 12", "Oct 12, 2025". */
export function dayLabel(value: string | Date, now: Date = new Date()) {
  const date = new Date(value);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return "Today";
  if (date.getTime() >= startOfToday - 86_400_000) return "Yesterday";
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? day : `${day}, ${date.getFullYear()}`;
}

/** "2s ago", "4m ago", "1h ago". */
export function agoLabel(value: string | Date, now: Date = new Date()) {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/** Adapter types as people know them, for "Claude Code adds its own system prompt…". */
const HARNESS_NAMES: Record<string, string> = {
  claude_local: "Claude Code",
  codex_local: "Codex",
  paperclip_runner: "Paperclip Runner",
  cursor: "Cursor",
  cursor_cloud: "Cursor Cloud",
  gemini_local: "Gemini CLI",
  grok_local: "Grok",
  kimi_local: "Kimi",
  hermes_local: "Hermes",
  hermes_gateway: "Hermes Gateway",
  opencode_local: "OpenCode",
  pi_local: "Pi",
  openclaw_gateway: "OpenClaw",
  process: "the process adapter",
  http: "the HTTP adapter",
};

export function harnessName(adapterType: string | null | undefined) {
  if (!adapterType) return "the harness";
  return HARNESS_NAMES[adapterType] ?? words(adapterType);
}

/** The old UI's rule (ui/src/lib/utils.ts `supportsRawProviderTrace`): Muse runs can't be traced. */
export function supportsProviderTrace(adapterType: string | null | undefined, adapterConfig: Record<string, unknown> | null | undefined) {
  return adapterType !== "paperclip_runner" || adapterConfig?.provider !== "muse";
}

/*
 * Retry and Resume, as the old UI's run detail offers them (ui/src/pages/AgentDetail.tsx): Resume
 * for a run whose process was lost, Retry for a failed or timed-out run that recovery hasn't taken
 * over and that hasn't been followed up already. A run offers one or the other, Resume first.
 */

type Rerunnable = {
  id: string;
  status: string;
  errorCode: string | null;
  execution?: { phase: string; successorRunId: string | null } | null;
  contextSnapshot: Record<string, unknown> | null;
};

export function canResumeRun(run: Pick<Rerunnable, "status" | "errorCode">) {
  return run.status === "failed" && run.errorCode === "process_lost";
}

export function canRetryRun(run: Pick<Rerunnable, "status" | "errorCode" | "execution">) {
  return (
    (run.status === "failed" || run.status === "timed_out") &&
    run.execution?.phase !== "recovery_needed" &&
    !run.execution?.successorRunId &&
    !canResumeRun(run)
  );
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

/** The task a run worked on, from its context, to wake the agent on it again. */
export function runTaskPayload(run: Pick<Rerunnable, "contextSnapshot">) {
  const context = run.contextSnapshot ?? {};
  const payload: Record<string, string> = {};
  for (const key of ["issueId", "taskId", "taskKey"] as const) {
    const value = text(context[key]);
    if (value) payload[key] = value;
  }
  return payload;
}

/** What Resume sends: the lost run to pick up from, its task, and the comment that woke it. */
export function resumePayload(run: Pick<Rerunnable, "id" | "contextSnapshot">) {
  const context = run.contextSnapshot ?? {};
  const payload: Record<string, string> = { resumeFromRunId: run.id, ...runTaskPayload(run) };
  const commentId = text(context.wakeCommentId) ?? text(context.commentId);
  if (commentId) payload.commentId = commentId;
  return payload;
}

/** The ways a wakeup for Retry can answer (`POST /agents/:id/wakeup` with `failedRunId`). */
export type RetryAnswer =
  | { id: string; status: string }
  | { actionId: string; issueId: string; runId: string | null; status: string }
  | { status: "skipped"; message: string | null; reason?: string };

/**
 * What a Retry came to, as the old UI reads it (ui/src/api/agents.ts `retryFailedRun`): the new
 * run, a retry the task will start when it's ready (no run yet), or why it didn't start.
 */
export function retryOutcome(answer: RetryAnswer): { runId: string | null; issueId: string | null } | { error: string } {
  if ("id" in answer) {
    // Retries are idempotent: a repeated click can answer with a successor that already stopped.
    if (["failed", "timed_out", "cancelled", "interrupted"].includes(answer.status)) {
      return { error: "The previous retry has already stopped. Refresh the task and retry its latest failed run." };
    }
    return { runId: answer.id, issueId: null };
  }
  if ("actionId" in answer) {
    if (answer.status === "failed" || answer.status === "cancelled") {
      return { error: "This retry couldn't start. Open the task to review its access and recovery state." };
    }
    return { runId: answer.runId, issueId: answer.issueId };
  }
  return { error: answer.message ?? "Retry was skipped." };
}
