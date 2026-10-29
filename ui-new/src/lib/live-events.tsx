import type { LiveEvent, LiveEventType } from "@paperclipai/shared";
import type { QueryClient, QueryKey } from "@tanstack/solid-query";
import { useQueryClient } from "@tanstack/solid-query";
import { createContext, createEffect, createMemo, createSignal, onCleanup, useContext, type ParentProps } from "solid-js";
import { queryKeys } from "@/api/queryKeys";

/*
 * The live-events socket: one WebSocket per company (`/api/companies/:id/events/ws`), as in
 * ui/src/context/LiveUpdatesProvider.tsx.
 *
 * - Reconnects with backoff (1s, 2s, 4s, 8s, then every 15s), and polls active queries every 15s
 *   while the socket is down.
 * - Events aren't replayed, so every (re)open refreshes the active queries to close the gap.
 * - While the tab is hidden the socket is closed; coming back refreshes active queries.
 * - Each event invalidates the query keys it affects (`invalidateForEvent`), then goes to
 *   subscribers (`useLiveEvent`), so a subscriber sees fresh data.
 * - Task lists, tasks and the live runs are fetched once more after a burst of events settles
 *   (`createTrailingRefetch`): the refetch an event starts can come back with them as they were.
 *
 * The old UI also patches caches in place and raises toasts from events. Those come with the screens
 * that need them (toasts in M1, run state in M2); this module is where they plug in.
 */

const DISCONNECTED_POLL_INTERVAL_MS = 15_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

/**
 * How long a task list fetched just after a change can still show the old values. The server answers
 * repeated compact task-list requests from a 2-second cache that a write doesn't clear
 * (ISSUE_LIST_SERVER_CACHE_TTL_MS in server/src/routes/issues.ts); this is a little longer, so a
 * fetch made once it has passed sees the change.
 */
export const LIST_CACHE_HOLD_MS = 2_500;

export type LiveConnection = "connecting" | "open" | "reconnecting" | "paused";

type Subscriber = { types: ReadonlySet<LiveEventType> | null; handler: (event: LiveEvent) => void };

type LiveEventsContextValue = {
  connection: () => LiveConnection;
  subscribe: (subscriber: Subscriber) => () => void;
};

const LiveEventsContext = createContext<LiveEventsContextValue>();

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Actions on a task that can add, answer or end an item in the Inbox's attention feed. */
function changesAttention(action: string | null) {
  return action !== null && (action.startsWith("issue.thread_interaction_") || action.startsWith("issue.connection_intent_") || action === "issue.updated");
}

/** Query keys an `activity.logged` event affects, by the entity it's about and what was done. */
function activityKeys(companyId: string, entityType: string | null, entityId: string | null, action: string | null): QueryKey[] {
  // Listing or reading a task's workspace files is logged (`issue.file_resource_list`,
  // `…_content_read`) but changes nothing. Refreshing the task would refetch the open file viewer,
  // whose reads log again: a loop that ends on the server's rate limit.
  if (action?.startsWith("issue.file_resource_")) return [queryKeys.activity(companyId)];
  const keys: QueryKey[] = [queryKeys.activity(companyId), queryKeys.dashboard(companyId), queryKeys.sidebarBadges(companyId)];
  // Apps and tools (src/apps/): connections, their tools, profiles, policies and Ask-first requests
  // are logged on `tool_*` entities; one prefix covers every Apps query for the company.
  if (entityType?.startsWith("tool_")) keys.push(queryKeys.tools.all(companyId));
  // AI connections (Apps → AI connections), as the old UI's live updates refresh them.
  if (action?.startsWith("ai_connection.") || action?.startsWith("connection_grant.")) {
    keys.push(queryKeys.aiConnections.list(companyId), queryKeys.tools.all(companyId));
  }
  // A connection's identities (grants, their audiences and delegations) are logged on `connection_grant`.
  if (entityType === "connection_grant") keys.push(queryKeys.tools.all(companyId));
  // Chat endpoints (src/apps/chat/): the endpoint, its deliveries, publications and actions are
  // logged on `chat_*` entities. Provider callbacks don't always log, so open pages also poll.
  if (entityType?.startsWith("chat_")) keys.push(queryKeys.chatEndpoints.all(companyId));
  switch (entityType) {
    case "issue":
      keys.push(queryKeys.issues.list(companyId), queryKeys.companies.stats);
      if (entityId) keys.push(queryKeys.issues.detail(entityId));
      if (changesAttention(action)) keys.push(queryKeys.inbox.attention(companyId));
      break;
    case "decision":
      keys.push(queryKeys.inbox.attention(companyId), queryKeys.decisions.all);
      break;
    // A join request approved or rejected elsewhere (Settings → Members, another board).
    case "join_request":
      keys.push(queryKeys.inbox.attention(companyId), queryKeys.companySettings.joinRequests(companyId));
      break;
    case "agent":
      keys.push(queryKeys.agents.list(companyId), queryKeys.org(companyId), queryKeys.companies.stats);
      // The agent's detail key covers its parts, its skills among them (agents.part(id, "skills")).
      if (entityId) keys.push(queryKeys.agents.detail(entityId), queryKeys.heartbeats(companyId));
      // Turning an agent's skills on or off changes how many agents each skill has in the library.
      if (action === "agent.skills_synced") keys.push(queryKeys.skills.all(companyId));
      break;
    // The skill library (src/skills/): a skill, its files and versions, its sources. The prefix key
    // covers the list, each skill's detail, versions and files. Agents' own skill lists are
    // refreshed by `agent.skills_synced` above; a skill edit doesn't say which agents use it.
    case "company_skill":
    case "company_skill_version":
      keys.push(queryKeys.skills.all(companyId));
      break;
    case "company_skill_source":
      keys.push(queryKeys.skills.all(companyId), queryKeys.skills.sources(companyId));
      break;
    // Skill and routine folders (the library's folder list sits under the skills prefix).
    case "folder":
      keys.push(queryKeys.skills.all(companyId), queryKeys.routines.folders(companyId));
      break;
    case "project":
      keys.push(queryKeys.projects.all(companyId));
      if (entityId) keys.push(["projects", "detail", entityId]);
      break;
    case "goal":
      keys.push(["goals", companyId]);
      if (entityId) keys.push(["goals", "detail", entityId]);
      break;
    case "approval":
      keys.push(["approvals", companyId], queryKeys.inbox.attention(companyId));
      break;
    case "routine":
    case "routine_trigger":
    case "routine_run":
      keys.push(queryKeys.routines.all);
      // A run can make or join a task, which the Recurring view groups under its recurring task.
      if (entityType === "routine_run") keys.push(queryKeys.issues.list(companyId));
      break;
    case "cost_event":
      keys.push(["costs", companyId]);
      break;
    // An outside assistant connected to Paperclip's MCP endpoint, or revoked (Apps → Assistants).
    case "mcp_connection":
      keys.push(queryKeys.mcp.connections);
      break;
    // Closing a workspace, reconciling its branch or controlling its services (the Workspaces tab,
    // a project's Code block and a task's Workspace section).
    case "execution_workspace":
      keys.push(["workspace-overview", companyId]);
      if (entityId) keys.push(queryKeys.workspaces.closeReadiness(entityId));
      break;
    // Installing, turning on or off, upgrading, configuring or removing a plugin is logged on every
    // company (server/src/routes/plugins.ts); refresh the plugin list and what plugins add to the
    // UI. The `plugin.ui.updated` event below says the same, but it's instance-wide and never
    // reaches a company's socket.
    case "plugin":
      keys.push(["plugins"]);
      break;
    case "company":
      keys.push(queryKeys.companies.all);
      // Imports and scans (`company.skills_imported`, `company.skills_scanned`…) are logged on the company.
      if (action?.startsWith("company.skill")) keys.push(queryKeys.skills.all(companyId), queryKeys.skills.sources(companyId));
      break;
  }
  return keys;
}

/** Query keys an event affects. Exported for tests and for screens that add their own rules. */
export function keysForEvent(companyId: string, event: LiveEvent): QueryKey[] {
  const payload = event.payload ?? {};
  const issueId = readString(payload.issueId);
  const agentId = readString(payload.agentId);
  switch (event.type) {
    case "heartbeat.run.queued":
    case "heartbeat.run.status": {
      const keys: QueryKey[] = [
        queryKeys.liveRuns(companyId),
        queryKeys.heartbeats(companyId),
        queryKeys.agents.list(companyId),
        queryKeys.dashboard(companyId),
        queryKeys.sidebarBadges(companyId),
      ];
      if (agentId) keys.push(queryKeys.agents.detail(agentId));
      if (issueId) keys.push(queryKeys.issues.detail(issueId));
      const runId = readString(payload.runId);
      if (runId) keys.push(["heartbeat-run", runId]);
      return keys;
    }
    case "heartbeat.run.progress":
      return [queryKeys.heartbeats(companyId), ...(issueId ? [queryKeys.issues.detail(issueId)] : [])];
    case "agent.status":
      return [
        queryKeys.agents.list(companyId),
        queryKeys.dashboard(companyId),
        queryKeys.org(companyId),
        ...(agentId ? [queryKeys.agents.detail(agentId)] : []),
      ];
    case "agent.session.goal.changed":
      return agentId ? [queryKeys.agents.detail(agentId)] : [];
    case "activity.logged":
      return activityKeys(companyId, readString(payload.entityType), readString(payload.entityId), readString(payload.action));
    case "plugin.ui.updated":
    case "plugin.worker.crashed":
    case "plugin.worker.restarted":
      return [["plugins"]];
    // Run logs and events stream to subscribers only (the run modal and chat read them).
    case "heartbeat.run.log":
    case "heartbeat.run.event":
    case "external_object.updated":
      return [];
  }
}

function invalidateForEvent(client: QueryClient, companyId: string, event: LiveEvent, trailing: TrailingRefetch) {
  const keys = keysForEvent(companyId, event);
  for (const queryKey of keys) {
    void client.invalidateQueries({ queryKey }, { cancelRefetch: false });
  }
  trailing.add(keys);
}

export type TrailingRefetch = { add: (keys: readonly QueryKey[]) => void; cancel: () => void };

/**
 * How long after a run event the live runs are fetched once more. The server doesn't cache them,
 * but a run's status event can join a live-runs refetch still in flight from the event before it
 * (`cancelRefetch: false`) and come back with the run still running.
 */
export const LIVE_RUNS_HOLD_MS = 1_500;

/**
 * One more fetch of what an event burst touched, a moment after its last event.
 *
 * - Task lists and tasks, `delayMs` after the last event. The refetch an event starts can come back
 *   with the task as it was. An agent usually comments and then changes the status a moment later:
 *   the status event's refetch either joins the comment's refetch still in flight
 *   (`cancelRefetch: false`), or is answered from the server's list cache that the comment's
 *   refetch filled (see LIST_CACHE_HOLD_MS). Either way it carries the old status, and no later
 *   event comes to correct it.
 * - The live runs, `liveRunsDelayMs` after the last run event, for the same in-flight join: a run
 *   that finishes soon after it was queued or started would otherwise stay running.
 *
 * Each event pushes its group's fetch back, so a burst of events costs one fetch per group. Other
 * keys get none.
 */
export function createTrailingRefetch(client: QueryClient, delayMs = LIST_CACHE_HOLD_MS, liveRunsDelayMs = LIVE_RUNS_HOLD_MS): TrailingRefetch {
  const groups = [
    // A list keeps the prefix (it covers every filtered view); a task is refetched on its own,
    // since its comments, runs and other sections aren't behind the list cache.
    trailingGroup(client, delayMs, (key) => key[0] === "issues", (key) => key[1] === "detail"),
    trailingGroup(client, liveRunsDelayMs, (key) => key[0] === "live-runs", () => true),
  ];
  return {
    add: (eventKeys) => groups.forEach((group) => group.add(eventKeys)),
    cancel: () => groups.forEach((group) => group.cancel()),
  };
}

function trailingGroup(
  client: QueryClient,
  delayMs: number,
  takes: (key: QueryKey) => boolean,
  exact: (key: QueryKey) => boolean,
): TrailingRefetch {
  const keys = new Map<string, QueryKey>();
  let timer: number | undefined;
  const run = () => {
    timer = undefined;
    const due = [...keys.values()];
    keys.clear();
    for (const queryKey of due) void client.invalidateQueries({ queryKey, exact: exact(queryKey) });
  };
  return {
    add: (eventKeys) => {
      const taken = eventKeys.filter(takes);
      if (taken.length === 0) return;
      for (const key of taken) keys.set(JSON.stringify(key), key);
      window.clearTimeout(timer);
      timer = window.setTimeout(run, delayMs);
    },
    cancel: () => {
      window.clearTimeout(timer);
      timer = undefined;
      keys.clear();
    },
  };
}

function socketUrl(companyId: string) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/companies/${encodeURIComponent(companyId)}/events/ws`;
}

export function LiveEventsProvider(props: ParentProps<{ companyId: string | null }>) {
  const client = useQueryClient();
  const [connection, setConnection] = createSignal<LiveConnection>("connecting");
  const [visible, setVisible] = createSignal(document.visibilityState !== "hidden");
  const subscribers = new Set<Subscriber>();

  const onVisibility = () => setVisible(document.visibilityState !== "hidden");
  document.addEventListener("visibilitychange", onVisibility);
  onCleanup(() => document.removeEventListener("visibilitychange", onVisibility));

  const refreshActive = () => void client.invalidateQueries({ type: "active" }, { cancelRefetch: false });

  let wasHidden = false;
  // A memo, so a refetched company object with the same id doesn't reopen the socket.
  const currentCompanyId = createMemo(() => props.companyId);

  createEffect(() => {
    const companyId = currentCompanyId();
    if (!visible()) {
      wasHidden = true;
      setConnection("paused");
      return;
    }
    if (!companyId) return;
    if (wasHidden) {
      wasHidden = false;
      refreshActive();
    }

    let closed = false;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let pollTimer: number | undefined;
    // Per company: switching company drops the burst in progress with the socket.
    const trailing = createTrailingRefetch(client);

    const startPolling = () => {
      if (pollTimer === undefined) pollTimer = window.setInterval(refreshActive, DISCONNECTED_POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const scheduleReconnect = () => {
      if (closed || reconnectTimer !== undefined) return;
      attempt += 1;
      setConnection("reconnecting");
      const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** Math.min(attempt - 1, 4));
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (closed) return;
      let next: WebSocket;
      try {
        next = new WebSocket(socketUrl(companyId));
      } catch {
        startPolling();
        scheduleReconnect();
        return;
      }
      socket = next;
      next.onopen = () => {
        if (closed || socket !== next) return;
        stopPolling();
        attempt = 0;
        setConnection("open");
        // Events aren't replayed: refresh whatever loaded before the socket opened.
        refreshActive();
      };
      next.onmessage = (message) => {
        if (closed || socket !== next || typeof message.data !== "string") return;
        let event: LiveEvent;
        try {
          event = JSON.parse(message.data) as LiveEvent;
        } catch {
          return;
        }
        if (event.companyId !== companyId) return;
        invalidateForEvent(client, companyId, event, trailing);
        for (const subscriber of subscribers) {
          if (!subscriber.types || subscriber.types.has(event.type)) subscriber.handler(event);
        }
      };
      // onclose follows onerror and drives the reconnect.
      next.onclose = () => {
        if (socket !== next) return;
        socket = null;
        if (closed) return;
        startPolling();
        scheduleReconnect();
      };
    };

    setConnection(attempt === 0 ? "connecting" : "reconnecting");
    connect();

    onCleanup(() => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      stopPolling();
      trailing.cancel();
      const active = socket;
      socket = null;
      if (active && active.readyState <= WebSocket.OPEN) active.close(1000, "provider_unmount");
    });
  });

  const value: LiveEventsContextValue = {
    connection,
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };

  return <LiveEventsContext.Provider value={value}>{props.children}</LiveEventsContext.Provider>;
}

/** The socket's state, for a "Live" or "Reconnecting" indicator. */
export function useLiveConnection() {
  const context = useContext(LiveEventsContext);
  return context?.connection ?? (() => "paused" as LiveConnection);
}

/**
 * Calls `handler` for each live event of the given types (all types when omitted), after the event's
 * query invalidations have been issued.
 */
export function useLiveEvent(types: LiveEventType[] | null, handler: (event: LiveEvent) => void) {
  const context = useContext(LiveEventsContext);
  if (!context) return;
  const unsubscribe = context.subscribe({ types: types ? new Set(types) : null, handler });
  onCleanup(unsubscribe);
}
