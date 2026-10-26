import type { Agent, Issue, LiveEvent } from "@paperclipai/shared";
import { useLocation } from "@solidjs/router";
import { useQueryClient, type QueryClient } from "@tanstack/solid-query";
import { createEffect, on } from "solid-js";
import type { CompanyUserDirectoryEntry } from "@/api/access";
import { queryKeys } from "@/api/queryKeys";
import { pushToast, type ToastInput } from "@/ui/Toast";
import { useCompany } from "./company";
import { useLiveConnection, useLiveEvent } from "./live-events";
import { useSession } from "./session";

/*
 * Which live events raise a toast, after doc/TOASTS.md and the toast builders in
 * ui/src/context/LiveUpdatesProvider.tsx:
 *
 * - Task created, updated or commented on, and a run that failed, timed out or was cancelled: only
 *   when the server marks the event `toastEligible` for this viewer, never for the viewer's own
 *   activity, and not for the task that's open on screen.
 * - Someone asking to join the company.
 * - Nothing for runs that started or succeeded, or for agent errors without a task.
 *
 * Gating on top: quiet for 2s after the socket (re)opens, at most three toasts per kind in 10s, no
 * run outcome twice, and none for a run that finished more than five minutes before the event.
 * Hidden pages close the socket (live-events.tsx), so no backlog replays on return.
 *
 * Builders are pure: they read names and task references through a `ToastLookup`, which the
 * provider backs with the query cache.
 */

const ISSUE_TOAST_ACTIONS = new Set(["issue.created", "issue.updated", "issue.comment_added"]);
const RUN_TOAST_STATUSES = new Set(["failed", "timed_out", "cancelled"]);
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "timed_out", "cancelled"]);
const RECONNECT_QUIET_MS = 2000;
const COOLDOWN_WINDOW_MS = 10_000;
const COOLDOWN_MAX = 3;
const RUN_TOAST_MAX_AGE_MS = 5 * 60_000;
const MAX_OBSERVED_RUNS = 2000;

export type ToastLookup = {
  /** The company's URL prefix, for links. */
  prefix: string;
  /** The signed-in user (or `local-board`), whose own activity stays quiet. */
  userId: string | null;
  agentName: (agentId: string) => string | null;
  agentRef: (agentId: string) => string;
  userName: (userId: string) => string | null;
  issue: (issueId: string) => Pick<Issue, "id" | "identifier" | "title"> | null;
  /** The task open on screen, as an id or identifier, so its own activity doesn't toast. */
  visibleIssueRef: () => string | null;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function shortId(value: string) {
  return value.slice(0, 8);
}

function actorLabel(lookup: ToastLookup, actorType: string | null, actorId: string | null, given: string | null) {
  if (given?.trim()) return given.trim();
  if (actorType === "agent" && actorId) return lookup.agentName(actorId) ?? `Agent ${shortId(actorId)}`;
  if (actorType === "system") return "System";
  if (actorType === "user" && actorId) {
    return lookup.userName(actorId) ?? (actorId === "board" || actorId === "local-board" ? "Board" : `User ${shortId(actorId)}`);
  }
  return actorType === "plugin" ? "Plugin" : "Someone";
}

function issueContext(lookup: ToastLookup, issueId: string, details: Record<string, unknown> | null) {
  const cached = lookup.issue(issueId);
  const ref = readString(details?.identifier) ?? readString(details?.issueIdentifier) ?? cached?.identifier ?? `Task ${shortId(issueId)}`;
  const title = readString(details?.title) ?? readString(details?.issueTitle) ?? cached?.title ?? null;
  const path = readString(details?.identifier) ?? cached?.identifier ?? issueId;
  return { ref, title, refs: [issueId, ref], href: `/${lookup.prefix}/issues/${path}` };
}

function describeUpdate(details: Record<string, unknown> | null) {
  if (!details) return null;
  const changes: string[] = [];
  if (typeof details.status === "string") changes.push(`status → ${details.status.replace(/_/g, " ")}`);
  if (typeof details.priority === "string") changes.push(`priority → ${details.priority}`);
  if (typeof details.assigneeAgentId === "string" || typeof details.assigneeUserId === "string") changes.push("reassigned");
  else if (details.assigneeAgentId === null || details.assigneeUserId === null) changes.push("unassigned");
  if (details.reopened === true) {
    const from = readString(details.reopenedFrom);
    changes.push(from ? `reopened from ${from.replace(/_/g, " ")}` : "reopened");
  }
  if (typeof details.title === "string") changes.push("title changed");
  if (typeof details.description === "string") changes.push("description changed");
  return changes.length > 0 ? changes.join(", ") : null;
}

/** A task created, updated or commented on. */
export function activityToast(lookup: ToastLookup, payload: Record<string, unknown>): ToastInput | null {
  const entityId = readString(payload.entityId);
  const action = readString(payload.action);
  if (readString(payload.entityType) !== "issue" || !entityId || !action || !ISSUE_TOAST_ACTIONS.has(action)) return null;

  const actorType = readString(payload.actorType);
  const actorId = readString(payload.actorId);
  if (actorType === "user" && actorId && actorId === lookup.userId) return null;

  const details = readRecord(payload.details);
  const issue = issueContext(lookup, entityId, details);
  const visible = lookup.visibleIssueRef();
  if (visible && issue.refs.includes(visible)) return null;

  const actor = actorLabel(lookup, actorType, actorId, readString(payload.actorName));
  const link = { label: `View ${issue.ref}`, href: issue.href };

  if (action === "issue.created") {
    return {
      title: `${actor} created ${issue.ref}`,
      body: issue.title ? truncate(issue.title, 96) : undefined,
      tone: "success",
      action: link,
      dedupeKey: `activity:${action}:${entityId}`,
    };
  }

  if (action === "issue.updated") {
    // A comment that also updates the task sends its own comment event; that one toasts.
    if (readString(details?.source) === "comment") return null;
    const change = describeUpdate(details);
    const body = change ? (issue.title ? `${truncate(issue.title, 64)} · ${change}` : change) : (issue.title ?? issue.ref);
    return {
      title: `${actor} updated ${issue.ref}`,
      body: truncate(body, 100),
      tone: "info",
      action: link,
      dedupeKey: `activity:${action}:${entityId}`,
    };
  }

  const reopened = details?.reopened === true;
  const reopenedFrom = readString(details?.reopenedFrom);
  const reopenedLabel = reopened ? (reopenedFrom ? `reopened from ${reopenedFrom.replace(/_/g, " ")}` : "reopened") : null;
  const snippet = readString(details?.bodySnippet)?.replace(/^#+\s*/m, "").replace(/\n/g, " ") ?? null;
  const title = reopened
    ? `${actor} reopened and commented on ${issue.ref}`
    : details?.updated === true
      ? `${actor} commented and updated ${issue.ref}`
      : `${actor} commented on ${issue.ref}`;
  const body = snippet
    ? reopenedLabel
      ? `${reopenedLabel} · ${snippet}`
      : snippet
    : reopenedLabel
      ? issue.title
        ? `${reopenedLabel} · ${issue.title}`
        : reopenedLabel
      : (issue.title ?? undefined);
  return {
    title,
    body: body ? truncate(body, 96) : undefined,
    tone: "info",
    action: link,
    dedupeKey: `activity:${action}:${entityId}:${readString(details?.commentId) ?? "na"}`,
  };
}

/** Someone, or an agent, asking to join the company. Not gated on eligibility. */
export function joinRequestToast(lookup: ToastLookup, payload: Record<string, unknown>): ToastInput | null {
  const action = readString(payload.action);
  const entityId = readString(payload.entityId);
  if (readString(payload.entityType) !== "join_request" || !entityId) return null;
  if (action !== "join.requested" && action !== "join.request_replayed") return null;
  const label = readString(readRecord(payload.details)?.requestType) === "agent" ? "An agent" : "Someone";
  return {
    title: `${label} wants to join`,
    body: "A join request is waiting for approval.",
    tone: "info",
    action: { label: "Open Inbox", href: `/${lookup.prefix}/inbox` },
    dedupeKey: `join-request:${entityId}`,
  };
}

/** A run that failed, timed out or was cancelled. */
export function runStatusToast(lookup: ToastLookup, payload: Record<string, unknown>): ToastInput | null {
  const runId = readString(payload.runId);
  const agentId = readString(payload.agentId);
  const status = readString(payload.status);
  if (!runId || !agentId || !status || !RUN_TOAST_STATUSES.has(status)) return null;

  const errorCode = readString(payload.errorCode);
  // An interrupt is the user's own doing, and workspace contention is ordinary scheduling.
  if (errorCode === "operator_interrupted" || errorCode === "workspace_busy") return null;
  const issueId = readString(payload.issueId);
  const visible = lookup.visibleIssueRef();
  if (visible && issueId && issueContext(lookup, issueId, null).refs.includes(visible)) return null;

  const name = lookup.agentName(agentId) ?? "Agent";
  const runHref = `/${lookup.prefix}/agents/${lookup.agentRef(agentId)}/runs/${runId}`;
  if (status === "failed" && errorCode === "low_trust_isolation_unavailable" && readString(payload.contextSource)?.startsWith("chat:")) {
    return {
      title: `${name} couldn't start this chat`,
      body: "This external chat identity isn't linked, and isolated guest workspaces are off. Link the identity in Apps or turn on isolated workspaces, then start a new task.",
      tone: "warn",
      ttlMs: 10_000,
      action: { label: "Open apps", href: `/${lookup.prefix}/apps` },
      dedupeKey: `run-status:${runId}:${status}`,
    };
  }
  const label = status === "failed" ? "failed" : status === "timed_out" ? "timed out" : "was cancelled";
  const error = readString(payload.error);
  const trigger = readString(payload.triggerDetail);
  return {
    title: `${name}'s run ${label}`,
    body: error ? truncate(error, 100) : trigger ? `Trigger: ${trigger}` : undefined,
    tone: status === "cancelled" ? "info" : "error",
    ttlMs: 7000,
    action: { label: "View run", href: runHref },
    dedupeKey: `run-status:${runId}:${status}`,
  };
}

export type ToastGate = {
  quietUntil: number;
  hits: Map<string, number[]>;
  observedRuns: Set<string>;
};

export function createToastGate(): ToastGate {
  return { quietUntil: 0, hits: new Map(), observedRuns: new Set() };
}

/** Called when the socket (re)opens: the catch-up refresh shouldn't toast. */
export function quietAfterReconnect(gate: ToastGate, now = Date.now()) {
  gate.quietUntil = now + RECONNECT_QUIET_MS;
}

/** True when this run outcome was already seen, or finished too long before it was delivered. */
export function isStaleRunOutcome(gate: ToastGate, event: LiveEvent) {
  const payload = event.payload ?? {};
  const runId = readString(payload.runId);
  const status = readString(payload.status);
  if (!runId || !status || !TERMINAL_RUN_STATUSES.has(status)) return false;
  const key = `${event.companyId}:${runId}:${status}`;
  const seen = gate.observedRuns.has(key);
  gate.observedRuns.delete(key);
  gate.observedRuns.add(key);
  if (gate.observedRuns.size > MAX_OBSERVED_RUNS) gate.observedRuns.delete(gate.observedRuns.values().next().value!);
  const finishedAt = Date.parse(readString(payload.finishedAt) ?? "");
  return seen || Date.parse(event.createdAt) - finishedAt > RUN_TOAST_MAX_AGE_MS;
}

/** Whether a toast of this kind may show now; records it when it may. */
export function admitToast(gate: ToastGate, kind: string, now = Date.now()) {
  if (now < gate.quietUntil) return false;
  const recent = (gate.hits.get(kind) ?? []).filter((at) => now - at < COOLDOWN_WINDOW_MS);
  if (recent.length >= COOLDOWN_MAX) {
    gate.hits.set(kind, recent);
    return false;
  }
  gate.hits.set(kind, [...recent, now]);
  return true;
}

/** The toast an event should raise, if any, with its cooldown kind. */
export function toastForEvent(
  gate: ToastGate,
  lookup: ToastLookup,
  event: LiveEvent,
): { kind: string; toast: ToastInput } | null {
  const payload = event.payload ?? {};
  if (event.type === "heartbeat.run.status") {
    // Check staleness first, so a suppressed outcome is still remembered.
    const stale = isStaleRunOutcome(gate, event);
    if (stale || event.toastEligible !== true) return null;
    const toast = runStatusToast(lookup, payload);
    return toast ? { kind: "run-status", toast } : null;
  }
  if (event.type === "activity.logged") {
    const toast = (event.toastEligible === true ? activityToast(lookup, payload) : null) ?? joinRequestToast(lookup, payload);
    return toast ? { kind: `activity:${readString(payload.action) ?? "unknown"}`, toast } : null;
  }
  return null;
}

/** A `ToastLookup` backed by the query cache. */
export function cacheLookup(
  client: QueryClient,
  companyId: string,
  prefix: string,
  userId: string | null,
  visibleIssueRef: () => string | null,
): ToastLookup {
  const agent = (agentId: string) =>
    client.getQueryData<Agent[]>(queryKeys.agents.list(companyId))?.find((candidate) => candidate.id === agentId);
  return {
    prefix,
    userId,
    agentName: (agentId) => agent(agentId)?.name ?? null,
    agentRef: (agentId) => agent(agentId)?.urlKey ?? agentId,
    userName: (id) => {
      const entry = client
        .getQueryData<{ users: CompanyUserDirectoryEntry[] }>(queryKeys.access.userDirectory(companyId))
        ?.users.find((candidate) => candidate.principalId === id);
      return entry?.user?.name?.trim() || entry?.user?.email?.trim() || null;
    },
    issue: (issueId) =>
      client.getQueryData<Issue>(queryKeys.issues.detail(issueId)) ??
      client.getQueryData<Issue[]>(queryKeys.issues.list(companyId))?.find((issue) => issue.id === issueId) ??
      null,
    visibleIssueRef,
  };
}

/** Raises toasts from the company's live events. Call once, inside <LiveEventsProvider>. */
export function useLiveToasts() {
  const client = useQueryClient();
  const company = useCompany();
  const session = useSession();
  const location = useLocation();
  const connection = useLiveConnection();
  const gate = createToastGate();

  createEffect(on(connection, (state) => state === "open" && quietAfterReconnect(gate)));

  const visibleIssueRef = () => /^\/[^/]+\/issues\/([^/?#]+)/.exec(location.pathname)?.[1] ?? null;
  const userId = () => session.userId() ?? (session.isAuthenticatedMode() ? null : "local-board");

  useLiveEvent(["activity.logged", "heartbeat.run.status"], (event) => {
    const lookup = cacheLookup(client, company().id, company().issuePrefix, userId(), visibleIssueRef);
    const result = toastForEvent(gate, lookup, event);
    if (result && admitToast(gate, result.kind)) pushToast(result.toast);
  });
}
