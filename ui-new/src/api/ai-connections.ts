import type {
  AiConnectionList,
  AiConnectionLoginIntent,
  AiConnectionUsage,
  CreateAiConnection,
  DecisionConnectionChoice,
  DecisionModelSettings,
  DecisionResult,
  FastResponseSettings,
  FastResponseSettingsResponse,
  FastResponseTestResult,
  LocalAiLoginAttempt,
  LocalAiLoginStatus,
  PromptInjectionPreventionSettings,
  PromptInjectionPreventionSettingsResponse,
  PromptInjectionTestResult,
  UpdateDecisionModel,
  UpdateFastResponse,
  UpdatePromptInjectionPrevention,
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

/*
 * The models Paperclip itself runs on a shared AI connection, set in company settings →
 * Connections (board 23; ui/src/api/decision-models.ts, fast-responses.ts and
 * prompt-injection-prevention.ts). Each answers its settings with the connections it can use
 * (`choices`); a test runs a small sample and is charged to the connection.
 */

export type DecisionSettingsResponse = { canManage: boolean; settings: DecisionModelSettings | null; choices: DecisionConnectionChoice[] };
export type ModelSuggestion = { id: string; label?: string };

const companyPath = (companyId: string, rest: string) => `/companies/${encodeURIComponent(companyId)}/${rest}`;

export const paperclipModelsApi = {
  decisionModel: (companyId: string, signal?: AbortSignal) =>
    api.get<DecisionSettingsResponse>(companyPath(companyId, "decision-model"), { signal }),
  updateDecisionModel: (companyId: string, input: UpdateDecisionModel) =>
    api.put<DecisionModelSettings>(companyPath(companyId, "decision-model"), input),
  testDecisionModel: (companyId: string) => api.post<DecisionResult>(companyPath(companyId, "decision-model/test"), {}),

  fastResponse: (companyId: string, signal?: AbortSignal) =>
    api.get<FastResponseSettingsResponse>(companyPath(companyId, "fast-response"), { signal }),
  updateFastResponse: (companyId: string, input: UpdateFastResponse) =>
    api.put<FastResponseSettings>(companyPath(companyId, "fast-response"), input),
  fastResponseModels: (companyId: string, connectionId: string, signal?: AbortSignal) =>
    api.get<ModelSuggestion[]>(companyPath(companyId, `fast-response/models?connectionId=${encodeURIComponent(connectionId)}`), { signal }),
  testFastResponse: (companyId: string) => api.post<FastResponseTestResult>(companyPath(companyId, "fast-response/test"), {}),

  promptInjection: (companyId: string, signal?: AbortSignal) =>
    api.get<PromptInjectionPreventionSettingsResponse>(companyPath(companyId, "prompt-injection-prevention"), { signal }),
  updatePromptInjection: (companyId: string, input: UpdatePromptInjectionPrevention) =>
    api.put<PromptInjectionPreventionSettings>(companyPath(companyId, "prompt-injection-prevention"), input),
  promptInjectionModels: (companyId: string, connectionId: string, signal?: AbortSignal) =>
    api.get<ModelSuggestion[]>(
      companyPath(companyId, `prompt-injection-prevention/models?connectionId=${encodeURIComponent(connectionId)}`),
      { signal },
    ),
  testPromptInjection: (companyId: string) =>
    api.post<PromptInjectionTestResult>(companyPath(companyId, "prompt-injection-prevention/test"), {}),
};
