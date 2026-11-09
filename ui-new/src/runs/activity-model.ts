/*
 * How the runner's provider activity reads in a transcript (U42): the words for web searches, model
 * switches, waits, verification checks, hook and auto-review decisions, harness status notices,
 * MCP startup failures, the agent's native plan and a proposed plan. Each helper takes the event's
 * canonical payload, as the runner wrote it. The wording follows the old UI's task chat
 * (ui/src/components/task-chat/task-chat-activity-presentation.ts, governance-presentation.ts,
 * status-notice-presentation.ts, TaskChatTurnStatusIsland.tsx and native-run-events.ts, upstream
 * #19252, #19262, #19266, #19267, #19289 and #19291); the rows are ui-new's own.
 */

type Payload = Record<string, unknown>;

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);

/** A provider notice's `details` entry, by name. */
export function noticeDetail(payload: Payload, name: string) {
  const details = Array.isArray(payload.details) ? payload.details : [];
  for (const raw of details) {
    const detail = raw && typeof raw === "object" ? (raw as Payload) : null;
    if (detail?.name === name && typeof detail.value === "string") return detail.value;
  }
  return undefined;
}

/** "120ms", "1.2s", "14s", "2m 03s", for a tool's duration. */
export function toolDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 10_000) return `${(ms / 1_000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Whole seconds, "30s" or "2m 5s", for waits. */
export function waitDuration(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/** Host and path without scheme or query. */
export function compactUrl(href: string): string {
  try {
    const url = new URL(href);
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
    return `${url.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return href;
  }
}

function safeHref(value: unknown) {
  const href = str(value);
  return href && /^https?:\/\//i.test(href) ? href : undefined;
}

export type RowStatus = "running" | "done" | "error";
/** A row's colour: neutral, or a check that passed, or something that stopped or failed. */
export type RowTone = "neutral" | "passed" | "blocked" | "failed";
export type RowIcon = "web" | "page" | "model" | "wait" | "check" | "hook" | "review" | "subagent";

/** One dedicated activity row. `note` is a second line, for the reason something was stopped. */
export type ActivityRow = {
  icon: RowIcon;
  label: string;
  detail: string;
  tone: RowTone;
  status: RowStatus;
  note?: string;
  links?: { title: string; href: string; host: string }[];
  /** For a running wait: how long it was planned for, to count down from when it started. */
  plannedMs?: number;
};

const verb = (status: RowStatus, running: string, done: string, failed: string) => (status === "running" ? running : status === "error" ? failed : done);

/** A web search, page open or search in a page (`research.*`). */
export function researchRow(payload: Payload, status: RowStatus): ActivityRow {
  const action = str(payload.action)?.toLowerCase();
  const query = str(payload.query);
  const url = str(payload.url);
  const seen = new Set<string>();
  const links = (Array.isArray(payload.sources) ? payload.sources : []).flatMap((raw) => {
    const source = raw && typeof raw === "object" ? (raw as Payload) : {};
    const href = safeHref(source.url);
    if (!href) return [];
    const host = compactUrl(href).split("/")[0]!;
    if (seen.has(href)) return [];
    seen.add(href);
    return [{ title: str(source.title) ?? href, href, host }];
  });
  if (action === "open_page") {
    return { icon: "page", label: verb(status, "Opening a web page", "Opened a web page", "Couldn't open the web page"), detail: url ? compactUrl(url) : "", tone: status === "error" ? "failed" : "neutral", status };
  }
  if (action === "find_in_page") {
    const pattern = str(payload.pattern);
    const detail = [pattern ? `“${pattern}”` : undefined, url ? compactUrl(url) : undefined].filter(Boolean).join(" in ");
    return { icon: "web", label: verb(status, "Searching the page", "Searched the page", "Page search failed"), detail, tone: status === "error" ? "failed" : "neutral", status };
  }
  return {
    icon: "web",
    label: verb(status, "Searching the web", "Searched the web", "Web search failed"),
    detail: query ? `“${query}”` : "",
    tone: status === "error" ? "failed" : "neutral",
    status,
    links,
  };
}

/** A model switch (`model.route.changed`) or the provider verifying the model (`model.verification.updated`). */
export function modelRow(eventType: string, payload: Payload, status: RowStatus): ActivityRow {
  if (eventType !== "model.route.changed") {
    return { icon: "model", label: verb(status, "Verifying the model", "Verified the model", "Model verification failed"), detail: str(payload.summary) ?? "", tone: status === "error" ? "failed" : "neutral", status };
  }
  const from = str(payload.fromModel) ?? str(payload.requestedModel);
  const to = str(payload.effectiveModel);
  const reason = str(payload.reason);
  const route = to && to !== "unknown" ? (from && from !== "unknown" && from !== to ? `${from} → ${to}` : to) : "";
  return {
    icon: "model",
    label: status === "error" ? "Model switch failed" : "Switched models",
    detail: route && reason && reason !== "provider reroute" ? `${route} · ${reason}` : route,
    tone: "neutral",
    status: status === "running" ? "done" : status,
  };
}

/** An intentional wait (`wait.*`): planned while it runs, elapsed once it's over. */
export function waitRow(payload: Payload, status: RowStatus, interrupted: boolean): ActivityRow {
  const planned = waitDuration(num(payload.plannedDurationMs));
  const elapsed = waitDuration(num(payload.elapsedDurationMs));
  const label = interrupted
    ? elapsed
      ? `Stopped waiting after ${elapsed}`
      : "Wait stopped"
    : status === "running"
      ? planned
        ? `Waiting ${planned}`
        : "Waiting"
      : elapsed ?? planned
        ? `Waited ${elapsed ?? planned}`
        : "Finished waiting";
  const reason = str(payload.reason);
  return {
    icon: "wait",
    label,
    detail: reason === "rate_limit" ? "for a rate limit" : reason === "provider" ? "for the provider" : "",
    tone: "neutral",
    status,
    ...(status === "running" && num(payload.plannedDurationMs) !== undefined ? { plannedMs: num(payload.plannedDurationMs) } : {}),
  };
}

/** One of the runner's own verification checks (an `item.completed` of kind `verification`). */
export function checkRow(payload: Payload): ActivityRow {
  const outcome = str(payload.status);
  const reason = str(payload.reasonCode);
  const detail = str(payload.detail) ?? (reason ? reason.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase()) : undefined);
  return {
    icon: "check",
    label: outcome === "passed" ? "Check passed" : outcome === "failed" ? "Check failed" : "Check not run",
    detail: str(payload.commandOrCheck) ?? "",
    tone: outcome === "passed" ? "passed" : outcome === "failed" ? "failed" : "neutral",
    status: outcome === "failed" ? "error" : "done",
    ...(detail ? { note: detail } : {}),
  };
}

const joined = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ");

/** "preToolUse" (Codex) and "PreToolUse" (Claude) both read "PreToolUse". */
function hookEvent(value: string | undefined) {
  return !value || value === "unknown" ? undefined : value.charAt(0).toUpperCase() + value.slice(1);
}

function governanceDuration(ms: number | undefined) {
  return ms === undefined ? undefined : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * A harness hook (`hook.*`). A hook that stopped the agent (blocked, stopped, failed) is tinted and
 * carries its message on a second line, since that explains what the agent did next.
 */
export function hookRow(payload: Payload, interrupted: boolean): ActivityRow {
  const event = hookEvent(str(payload.event));
  const subject = event ? `${event} hook` : "Hook";
  const tool = str(payload.toolName);
  const outcome = str(payload.outcome) ?? str(payload.status);
  const message = str(payload.message) ?? str(payload.summary);
  const source = str(payload.source);
  const took = governanceDuration(num(payload.durationMs));
  const row = (label: string, detail: string, tone: RowTone, status: RowStatus, note?: string): ActivityRow => ({ icon: "hook", label, detail, tone, status, ...(note ? { note } : {}) });
  if (interrupted) return row(`${subject} stopped without a result`, joined(tool, source), "neutral", "done");
  if (outcome === "running") return row(event ? `Running ${event} hook` : "Running a hook", joined(tool, source), "neutral", "running");
  if (outcome === "blocked") {
    const what = tool ?? (/^(pretooluse|permissionrequest)$/i.test(event ?? "") ? "a tool call" : /^userpromptsubmit$/i.test(event ?? "") ? "the prompt" : "the action");
    return row(`${subject} blocked ${what}`, joined(source, took), "blocked", "error", message);
  }
  if (outcome === "stopped") return row(`${subject} stopped the turn`, joined(source, took), "blocked", "error", message);
  if (outcome === "failed") return row(`${subject} failed`, joined(source, took), "failed", "error", message);
  if (outcome === "feedback") return row(`${subject} sent feedback`, joined(message, source), "neutral", "done");
  if (outcome === "context") return row(`${subject} added context`, joined(message, source), "neutral", "done");
  return row(`${subject} ran`, joined(tool, source, took), "neutral", "done");
}

/** An automatic approval review (`safety.review.*`). */
export function reviewRow(payload: Payload, interrupted: boolean): ActivityRow {
  const decision = str(payload.decision);
  const action = str(payload.action);
  const risk = str(payload.riskLevel) ? `${str(payload.riskLevel)} risk` : undefined;
  const rationale = str(payload.rationale) ?? str(payload.summary);
  const row = (label: string, detail: string, tone: RowTone, status: RowStatus, note?: string): ActivityRow => ({ icon: "review", label, detail, tone, status, ...(note ? { note } : {}) });
  if (interrupted) return row("Auto-review stopped without a decision", action ?? "", "neutral", "done");
  if (decision === "pending" || payload.status === "running") return row("Auto-reviewing", action ?? "", "neutral", "running");
  if (decision === "allowed") return row("Auto-review approved", joined(action, risk), "neutral", "done");
  if (decision === "denied") return row("Auto-review denied", joined(action, risk), "blocked", "error", rationale);
  if (decision === "timed_out") return row("Auto-review timed out", action ?? "", "blocked", "error", rationale ?? "The action did not run.");
  if (decision === "aborted") return row("Auto-review stopped", action ?? "", "neutral", "done");
  if (decision === "user_required") return row("Auto-review asked for approval", joined(action, risk), "neutral", "done", rationale);
  return row("Auto-review finished", action ?? "", "neutral", "done");
}

/** An approved auto-review folds onto the tool row it approved, as a badge. */
export function approvedReviewBadge(payload: Payload): { target: string; label: string } | null {
  const target = str(payload.targetExecutionId);
  if (!target || str(payload.decision) !== "allowed" || payload.status === "running") return null;
  const risk = str(payload.riskLevel);
  return { target, label: risk ? `Auto-approved · ${risk} risk` : "Auto-approved" };
}

/*
 * Harness status notices: lifecycle reports such as context compaction, retries and model fallback.
 * They read as chips between the activity, never as part of the answer. The runner sets the
 * category; nothing here classifies by the message's text.
 */

export const STATUS_NOTICE_CATEGORIES = ["context_compaction", "provider_retry", "model_fallback", "provider_informational", "local_command_output"] as const;
export type StatusNoticeCategory = (typeof STATUS_NOTICE_CATEGORIES)[number];
export type ChipTone = "neutral" | "progress" | "warning" | "danger";
export type StatusChip = { category: StatusNoticeCategory | "provider_error"; label: string; detail?: string; tone: ChipTone; active: boolean; fatal: boolean };

export function noticeCategory(payload: Payload): StatusNoticeCategory | null {
  const category = str(payload.category);
  return (STATUS_NOTICE_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as StatusNoticeCategory) : null;
}

/** A turn-scoped provider error that won't be retried. */
export function isFatalProviderError(payload: Payload) {
  return payload.category === "error" && payload.severity === "error" && payload.recoverable !== true && payload.scope === "turn";
}

export function isStatusNotice(payload: Payload) {
  return noticeCategory(payload) !== null || isFatalProviderError(payload);
}

export const MCP_STARTUP_FAILED = "mcp_server_startup_failed";

/** An MCP server the harness couldn't start: lifted into a warning at the top of the run. */
export function mcpStartupFailure(payload: Payload): { server: string; reason: string | null } | null {
  if (payload.category !== MCP_STARTUP_FAILED) return null;
  return { server: noticeDetail(payload, "server") ?? "An", reason: noticeDetail(payload, "reason") ?? null };
}

function retryLabel(payload: Payload) {
  switch (noticeDetail(payload, "Reason")) {
    case "serverOverloaded":
      return "Retrying after overload";
    case "responseStreamDisconnected":
    case "responseStreamConnectionFailed":
    case "transport_lost":
      return "Reconnecting";
    case "httpConnectionFailed":
      return "Retrying connection";
    case "rate_limit":
      return "Retrying after rate limit";
    default:
      return "Retrying";
  }
}

/**
 * A status notice as a chip. `resolved` is a retry the turn has moved past; `stopped` one, or a
 * compaction, that was still going when the run ended.
 */
export function statusChip(payload: Payload, options: { resolved?: boolean; stopped?: boolean } = {}): StatusChip | null {
  const summary = str(payload.summary);
  if (isFatalProviderError(payload)) {
    return { category: "provider_error", label: "Provider error", detail: summary ?? "The provider reported an error without a message.", tone: "danger", active: false, fatal: true };
  }
  const category = noticeCategory(payload);
  if (!category) return null;
  const phase = noticeDetail(payload, "Phase");
  const chip = (label: string, tone: ChipTone, active = false, detail?: string): StatusChip => ({ category, label, tone, active, fatal: false, ...(detail ? { detail } : {}) });
  switch (category) {
    case "context_compaction":
      if (phase === "failed") return chip("Context compaction failed", "warning", false, summary);
      if (phase === "running") return options.stopped ? chip("Compaction stopped", "neutral") : chip("Compacting context", "progress", true);
      return chip("Context compacted", "neutral");
    case "provider_retry": {
      if (options.resolved) return chip("Recovered after retry", "neutral", false, summary);
      if (options.stopped) return chip("Retry stopped", "neutral", false, summary);
      const attempt = noticeDetail(payload, "Attempt");
      const max = noticeDetail(payload, "Max attempts");
      const suffix = attempt ? (max ? ` (attempt ${attempt} of ${max})` : ` (attempt ${attempt})`) : "";
      return chip(`${retryLabel(payload)}${suffix}`, "warning", true, summary);
    }
    case "model_fallback": {
      const model = noticeDetail(payload, "Fallback model");
      return chip(model ? `Fell back to ${model}` : "Fell back to another model", "warning", false, noticeDetail(payload, "Reason") ?? summary);
    }
    case "provider_informational": {
      const severity = str(payload.severity);
      return chip(severity === "error" ? "Provider error" : severity === "warning" ? "Provider warning" : "Provider update", severity === "error" ? "danger" : severity === "warning" ? "warning" : "neutral", false, summary);
    }
    case "local_command_output":
      return chip("Command output", "neutral", false, summary);
  }
}

/*
 * The agent's native plan (`plan.updated`): a checklist the harness keeps for the turn, docked above
 * the chat's composer and shown in place in the run modal. A proposed plan (`plan.proposed`) is a
 * different thing: a document the task's Plan takes once it's complete.
 */

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed";
export type PlanStep = { id: string; label: string; status: PlanStepStatus };
export type Plan = { id: string; steps: PlanStep[]; explanation: string; complete: boolean };

export function planFromPayload(payload: Payload): Plan | null {
  const id = str(payload.planId);
  if (!id) return null;
  const steps = (Array.isArray(payload.steps) ? payload.steps : []).slice(0, 256).map((raw, index): PlanStep => {
    const step = raw && typeof raw === "object" ? (raw as Payload) : {};
    const status = str(step.status);
    return {
      id: str(step.stepId) ?? `${id}:${index}`,
      label: str(step.body) ?? "Plan step",
      status: status === "in_progress" || status === "completed" || status === "blocked" || status === "failed" ? status : "pending",
    };
  });
  return { id, steps, explanation: str(payload.explanation) ?? "", complete: steps.length > 0 && steps.every((step) => step.status === "completed") };
}

/** The step the plan is on: the one going, else the first stuck, else the next to do, else the last. */
export function currentStep(steps: readonly PlanStep[]) {
  const find = (test: (step: PlanStep) => boolean) => steps.findIndex(test);
  for (const index of [find((s) => s.status === "in_progress"), find((s) => s.status === "blocked" || s.status === "failed"), find((s) => s.status === "pending")]) {
    if (index >= 0) return index;
  }
  return Math.max(0, steps.length - 1);
}

export function planHeadline(plan: Plan) {
  if (plan.complete) return plan.steps.length === 1 ? "Step done" : `All ${plan.steps.length} steps done`;
  const step = plan.steps[currentStep(plan.steps)];
  if (!step) return "Plan";
  if (step.status === "blocked" || step.status === "failed") return `Blocked: ${step.label}`;
  if (step.status === "pending") return `Up next: ${step.label}`;
  return step.label;
}

/** Plans up to this long list every step; longer ones show a window around the current step. */
export const PLAN_FULL_LIST = 7;
const PLAN_WINDOW = 5;

export type PlanRow = { kind: "step"; step: PlanStep; current: boolean } | { kind: "earlier"; count: number } | { kind: "more"; count: number };

export function planRows(plan: Plan, showAll: boolean): PlanRow[] {
  const current = currentStep(plan.steps);
  const toRow = (step: PlanStep, index: number): PlanRow => ({ kind: "step", step, current: !plan.complete && index === current });
  if (showAll || plan.steps.length <= PLAN_FULL_LIST) return plan.steps.map(toRow);
  const start = Math.max(0, Math.min(current - 1, plan.steps.length - PLAN_WINDOW));
  const end = Math.min(plan.steps.length, start + PLAN_WINDOW);
  const rows: PlanRow[] = [];
  if (start > 0) rows.push({ kind: "earlier", count: start });
  for (let index = start; index < end; index += 1) rows.push(toRow(plan.steps[index]!, index));
  if (end < plan.steps.length) rows.push({ kind: "more", count: plan.steps.length - end });
  return rows;
}

/**
 * Codex plan mode wraps a streaming plan in `<proposed_plan>` tags; only that outer wrapper is
 * removed, so example tags inside the plan stay text.
 */
export function proposedPlanMarkdown(value: string): string {
  const trimmed = value.trim();
  const open = /^<proposed_plan>[ \t]*(?:\n|$)/i.exec(trimmed);
  if (!open) return trimmed;
  return trimmed.slice(open[0].length).replace(/(?:^|\n)[ \t]*<\/proposed_plan>[ \t]*$/i, "").trim();
}

/**
 * A message without its `<proposed_plan>` block, once that block has become a proposal. The tags
 * must sit on their own lines outside fenced code; a block cut off mid-way hides its remainder.
 */
export function withoutProposedPlanBlock(value: string): string {
  const lines = value.split("\n");
  let fence: string | null = null;
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    const marker = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
    if (marker) {
      fence = fence === null ? marker[0]! : trimmed.startsWith(fence) ? null : fence;
      continue;
    }
    if (fence !== null) continue;
    if (start < 0 && /^<proposed_plan>$/i.test(trimmed)) start = index;
    else if (start >= 0 && /^<\/proposed_plan>$/i.test(trimmed)) return [...lines.slice(0, start), ...lines.slice(index + 1)].join("\n").trim();
  }
  return start < 0 ? value : lines.slice(0, start).join("\n").trim();
}

/** A proposed plan's title: its first `# ` heading, else "Plan". */
export function proposalTitle(markdown: string) {
  const heading = markdown.split("\n").find((line) => /^#\s+/.test(line.trim()));
  return heading ? heading.trim().replace(/^#\s+/, "").trim() || "Plan" : "Plan";
}
