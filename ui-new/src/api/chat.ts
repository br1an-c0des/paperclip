import type { ActivityEvent, CompactIssue, Issue } from "@paperclipai/shared";
import { api } from "./client";

/*
 * Agent chat (boards 12, 13), as ui/src/api/agentChats.ts and ui/src/pages/AgentChat.tsx use it.
 * Each person has one standing chat per agent, stored as a hidden task (decision 8):
 *
 * - `GET /companies/:id/chats/:agentRef` reads it without creating it (null before the first
 *   message); `POST` creates it on the first message or upload. `GET /companies/:id/chats` lists
 *   yours. All three answer 404 while the instance's `enableAgentChat` is off (decision 2).
 * - Messages are comments on that task, and need a client request id. `/new` as a message starts a
 *   fresh session; the history stays.
 *
 * Around the chat, from the ordinary task and activity APIs:
 *
 * - Tasks the agent handed off from the chat: tasks created by the chat's runs
 *   (`?createdFromIssueId=`).
 * - Its reports: tasks a recurring task (routine) made for it, which the chat shows as cards until a
 *   briefing can post into the chat itself (build plan 3.13).
 * - What it has queued up next, and its recent activity, for the column beside the chat.
 */

function compactList(params: Record<string, string>) {
  return new URLSearchParams({ view: "compact", sortField: "updated", sortDir: "desc", ...params }).toString();
}

export const chatApi = {
  list: (companyId: string, signal?: AbortSignal) => api.get<Issue[]>(`/companies/${companyId}/chats`, { signal }),
  get: (companyId: string, agentRef: string, signal?: AbortSignal) =>
    api.get<Issue | null>(`/companies/${companyId}/chats/${encodeURIComponent(agentRef)}`, { signal }),
  /** Creates the chat if it doesn't exist yet, and answers it either way. */
  open: (companyId: string, agentRef: string) => api.post<Issue>(`/companies/${companyId}/chats/${encodeURIComponent(agentRef)}`, {}),
  /** Tasks the chat's runs created: the hand-offs. */
  handoffs: (companyId: string, chatId: string, signal?: AbortSignal) =>
    api.get<CompactIssue[]>(`/companies/${companyId}/issues?${compactList({ createdFromIssueId: chatId, limit: "100" })}`, { signal }),
  /** Tasks recurring tasks made for the agent, newest first: its briefings and reports. */
  reports: (companyId: string, agentId: string, signal?: AbortSignal) =>
    api.get<CompactIssue[]>(
      `/companies/${companyId}/issues?${compactList({
        assigneeAgentId: agentId,
        originKind: "routine_execution",
        includeRoutineExecutions: "true",
        limit: "20",
      })}`,
      { signal },
    ),
  /** The agent's open work that isn't started yet, for "Up next". */
  upNext: (companyId: string, agentId: string, signal?: AbortSignal) =>
    api.get<CompactIssue[]>(`/companies/${companyId}/issues?${compactList({ assigneeAgentId: agentId, status: "todo", limit: "6" })}`, { signal }),
  /** What the agent did lately, newest first. */
  activity: (companyId: string, agentId: string, limit: number, signal?: AbortSignal) =>
    api.get<ActivityEvent[]>(`/companies/${companyId}/activity?${new URLSearchParams({ agentId, limit: String(limit) })}`, { signal }),
};
