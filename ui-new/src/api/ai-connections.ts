import type {
  AiConnectionList,
  AiConnectionLoginIntent,
  AiConnectionUsage,
  CreateAiConnection,
  LocalAiLoginAttempt,
  LocalAiLoginStatus,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * AI connections (`/api/companies/:companyId/ai-connections`), as ui/src/api/ai-connections.ts uses
 * them: the list, the personal default, usage and active runs, the API-key save, and the local
 * subscription sign-in (start an attempt, check it, submit the browser code, cancel, save).
 */

export type AiConnectionResult = { connectionId: string; grantId: string };
export type AiConnectionActiveRun = { id: string; agentId: string; agentName: string; status: string };

const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/ai-connections`;

export const aiConnectionsApi = {
  list: (companyId: string, agentId?: string) =>
    api.get<AiConnectionList>(`${base(companyId)}${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`),
  setDefault: (companyId: string, grantId: string) => api.put<{ ok: true }>(`${base(companyId)}/default`, { grantId }),
  probeUsage: (companyId: string, connectionId: string, grantId?: string) =>
    api.get<AiConnectionUsage>(
      `${base(companyId)}/${encodeURIComponent(connectionId)}/usage${grantId ? `?grantId=${encodeURIComponent(grantId)}` : ""}`,
    ),
  activeRuns: (companyId: string, connectionId: string) =>
    api.get<AiConnectionActiveRun[]>(`${base(companyId)}/${encodeURIComponent(connectionId)}/active-runs`),
  /** Saves an API-key connection. The server checks the key with the provider first. */
  create: (companyId: string, input: CreateAiConnection) => api.post<AiConnectionResult>(base(companyId), input),

  startLocalLogin: (companyId: string, input: AiConnectionLoginIntent & { restart?: boolean }) =>
    api.post<LocalAiLoginAttempt>(`${base(companyId)}/local/attempts`, input),
  checkLocalLogin: (companyId: string, input: AiConnectionLoginIntent & { localSessionId?: string }) =>
    api.post<LocalAiLoginStatus>(`${base(companyId)}/local/check`, input),
  submitLocalLoginCode: (companyId: string, sessionId: string, browserCode: string) =>
    api.post<{ ok: true }>(`${base(companyId)}/local/attempts/${encodeURIComponent(sessionId)}/code`, { browserCode }),
  cancelLocalLogin: (companyId: string, sessionId: string) =>
    api.delete<{ ok: true }>(`${base(companyId)}/local/attempts/${encodeURIComponent(sessionId)}`),
  connectLocal: (companyId: string, input: AiConnectionLoginIntent & { localSessionId?: string }) =>
    api.post<AiConnectionResult>(`${base(companyId)}/local`, input),
};
