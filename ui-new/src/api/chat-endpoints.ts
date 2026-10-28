import type {
  ChatActivityItem,
  ChatEndpointSetupState,
  ChatExecutionDefaults,
  ChatProvider,
  ChatPublicationBatchStatus,
  ChatPublicationState,
  ChatPublicationSummary,
  ExternalChannelBindingSummary,
  GitHubTaskReview,
  SlackAppConfiguration,
  SlackSetupOptions,
  UpdateChatEndpointInput,
  VoiceCallHistoryEntry,
  VoiceInboundCall,
  VoicePhoneConfiguration,
  VoiceUnapprovedCallHistoryEntry,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * Chat endpoints (`/api/companies/:companyId/chat-endpoints`, `/api/chat-endpoints/*`): an agent
 * reachable from Slack, GitHub, Discord, Microsoft Teams, Telegram, a Speko voice persona or an
 * AgentMail inbox, as ui/src/api/chatEndpoints.ts, githubChat.ts, voiceHistory.ts and voicePhone.ts
 * use them. The server answers these only while the instance's `enableChatConnectors` is on
 * (GitHub review bots follow `enableGitHubReviewBots`; AgentMail inboxes are always on).
 *
 * The endpoint itself isn't a shared-package type; the shape below is the old UI's.
 */

export type ChatEndpointStatus = "draft" | "verifying" | "active" | "paused" | "attention" | "revoked" | "archived";
export type ChatEndpointSetupAction = "configure" | "verify" | "pause" | "resume" | "reconnect" | "remove";

export interface ChatEndpointResource {
  id: string;
  type: string;
  providerResourceId: string;
  label: string;
  availability: "available" | "unavailable" | "removed";
  enabled: boolean;
  detail?: string | null;
  participants?: string[];
  executionDefaults?: ChatExecutionDefaults | null;
}

export interface ChatIdentityLink {
  id: string;
  principalId: string;
  externalLabel: string;
  externalDetail?: string | null;
  paperclipUserId?: string | null;
  paperclipUserLabel?: string | null;
  paperclipUserImage?: string | null;
  lastConnectAt?: string | null;
  status: "linked" | "pending" | "revoked";
}

export interface ChatConversation {
  id: string;
  externalLabel: string;
  externalUrl?: string | null;
  issueId?: string | null;
  issueIdentifier?: string | null;
  issueTitle?: string | null;
  state: "active" | "waiting" | "completed" | "unavailable" | "endpoint_removed";
  updatedAt: string;
  lastPublicationStatus?: ChatPublicationState | null;
}

export interface ChatCallbackSurfaceState {
  status: "current" | "stale" | "unverified";
  observedAt?: string | null;
}

export interface ChatEndpoint {
  id: string;
  companyId: string;
  provider: ChatProvider;
  status: ChatEndpointStatus;
  assignedAgentId: string;
  assignedAgentName: string;
  connectionId?: string | null;
  providerAccountId?: string | null;
  providerAccountLabel?: string | null;
  botLabel?: string | null;
  botUsername?: string | null;
  botExternalId?: string | null;
  photonAllocation?: "dedicated" | "shared";
  allowDirectMessages?: boolean;
  requireAtMention?: boolean;
  allowGroupChats?: boolean;
  allowUnlinkedPeople: boolean;
  communicationInstructions?: string;
  executionDefaults?: ChatExecutionDefaults | null;
  healthMessage?: string | null;
  lastError?: string | null;
  lastActivityAt?: string | null;
  setup?: {
    step: string;
    github?: ChatEndpointSetupState["github"];
    testStartedAt?: string | null;
    providerUrl?: string | null;
    webhookUrl?: string | null;
    messagingEndpoint?: string | null;
    command?: string | null;
    slackApp?: SlackAppConfiguration;
    slackSetupMethod?: "managed" | "automatic" | "manual" | "existing";
    slackRegistration?: { status: string; appId?: string | null; managementUrl?: string | null } | null;
    slackOAuthCallbackUri?: string | null;
    webhookVerifiedAt?: string | null;
    webhookSecretConfigured?: boolean;
    callbackSurfaces?: { events: ChatCallbackSurfaceState; interactivity: ChatCallbackSurfaceState; slashCommands: ChatCallbackSurfaceState };
    callbacksNeedUpdate?: boolean;
  };
}

export type CreateChatEndpoint = {
  provider: ChatProvider;
  assignedAgentId: string;
  slackApp?: SlackAppConfiguration;
  slackSetupMethod?: "managed" | "automatic" | "manual" | "existing";
};

export type ChatResolution = "mark_delivered" | "retry_anyway" | "cancel";

type ListResponse<T> = T[] | { items?: T[]; endpoints?: T[]; resources?: T[]; principals?: T[]; conversations?: T[] };

/** The server answers lists bare or wrapped, by route; this takes either. */
export function listRows<T>(response: ListResponse<T> | null | undefined): T[] {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  return response.items ?? response.endpoints ?? response.resources ?? response.principals ?? response.conversations ?? [];
}

const enc = encodeURIComponent;
const endpoint = (id: string, rest = "") => `/chat-endpoints/${enc(id)}${rest}`;

export const chatEndpointsApi = {
  list: async (companyId: string, signal?: AbortSignal) =>
    listRows(await api.get<ListResponse<ChatEndpoint>>(`/companies/${enc(companyId)}/chat-endpoints`, { signal })),
  get: (id: string, signal?: AbortSignal) => api.get<ChatEndpoint>(endpoint(id), { signal }),
  create: (companyId: string, input: CreateChatEndpoint) => api.post<ChatEndpoint>(`/companies/${enc(companyId)}/chat-endpoints`, input),
  update: (id: string, input: UpdateChatEndpointInput) => api.patch<ChatEndpoint>(endpoint(id), input),
  /** Configure with credentials, verify, pause, resume, reconnect or remove. */
  setup: (id: string, input: { action: ChatEndpointSetupAction; credentials?: Record<string, string> }) =>
    api.post<ChatEndpoint>(endpoint(id, "/setup"), input),
  /** A one-time webhook secret (GitHub); shown once, then only "configured". */
  setupSecret: (id: string) => api.post<{ webhookSecret: string }>(endpoint(id, "/setup-secret"), {}),
  /** Finishes setup once a test message arrived. */
  test: (id: string) => api.post<ChatEndpoint>(endpoint(id, "/test"), {}),
  finishSlackSetup: (id: string) => api.post<ChatEndpoint>(endpoint(id, "/finish"), {}),
  testStatus: (id: string, signal?: AbortSignal) => api.get<{ messageReceivedAt: string | null }>(endpoint(id, "/test-status"), { signal }),
  slackSetupOptions: (companyId: string, signal?: AbortSignal) =>
    api.get<SlackSetupOptions>(`/companies/${enc(companyId)}/chat-slack/setup-options`, { signal }),

  resources: async (id: string, signal?: AbortSignal) => listRows(await api.get<ListResponse<ChatEndpointResource>>(endpoint(id, "/resources"), { signal })),
  updateResources: (id: string, resources: Array<{ id: string; enabled?: boolean; executionDefaults?: ChatExecutionDefaults | null }>) =>
    api.put<ChatEndpointResource[]>(endpoint(id, "/resources"), { resources }),
  principals: async (id: string, signal?: AbortSignal) => listRows(await api.get<ListResponse<ChatIdentityLink>>(endpoint(id, "/principals"), { signal })),
  /** A personal confirmation link for one chat identity; the person signs in and confirms it. */
  linkIntent: (id: string, principalId: string) =>
    api.post<{ confirmationUrl: string }>(endpoint(id, `/principals/${enc(principalId)}/link-intent`), {}),
  revokeLink: (id: string, principalId: string) => api.delete<void>(endpoint(id, `/principals/${enc(principalId)}/link`)),
  conversations: async (id: string, signal?: AbortSignal) =>
    listRows(await api.get<ListResponse<ChatConversation>>(endpoint(id, "/conversations"), { signal })),
  activity: (id: string, cursor?: string | null, signal?: AbortSignal) =>
    api.get<{ items: ChatActivityItem[]; nextCursor: string | null }>(
      endpoint(id, `/activity?limit=25${cursor ? `&cursor=${enc(cursor)}` : ""}`),
      { signal },
    ),
  replayDelivery: (id: string, deliveryId: string) => api.post<void>(endpoint(id, `/deliveries/${enc(deliveryId)}/replay`), {}),
  replayPublication: (id: string, publicationId: string) => api.post<void>(endpoint(id, `/publications/${enc(publicationId)}/replay`), {}),
  resolvePublication: (id: string, publicationId: string, action: ChatResolution, fileTransfer?: { phase: string; version: number }) =>
    api.post<void>(endpoint(id, `/publications/${enc(publicationId)}/resolve`), { action, ...(fileTransfer ? { fileTransfer } : {}) }),
  resolveAction: (id: string, actionId: string, action: ChatResolution) => api.post<void>(endpoint(id, `/actions/${enc(actionId)}/resolve`), { action }),

  /** The chat conversation a task is bound to, or null. */
  issueBinding: (issueId: string, signal?: AbortSignal) =>
    api.get<ExternalChannelBindingSummary | null>(`/issues/${enc(issueId)}/chat-binding`, { signal }),
  /** Posts a board message to the bound conversation; the key makes a retry the same send. */
  publishBoardMessage: (id: string, conversationId: string, body: string, idempotencyKey: string) =>
    api.post<ChatPublicationSummary>(endpoint(id, `/conversations/${enc(conversationId)}/publications`), { body, idempotencyKey }),
  publicationStatus: (id: string, conversationId: string, publicationId: string, signal?: AbortSignal) =>
    api.get<ChatPublicationBatchStatus>(endpoint(id, `/conversations/${enc(conversationId)}/publications/${enc(publicationId)}/status`), { signal }),
};

/** GitHub review bots (`/chat-endpoints/:id/github/*`), the parts ui-new uses. */
export const githubChatApi = {
  connectApp: (id: string, credentials: { appId: string; privateKey: string; webhookSecret: string }) =>
    api.post<ChatEndpoint>(endpoint(id, "/github/app"), credentials),
  reviews: (id: string, signal?: AbortSignal) => api.get<GitHubTaskReview[]>(endpoint(id, "/github/reviews"), { signal }),
};

const voice = (companyId: string, kind: string, endpointId: string) => `/companies/${enc(companyId)}/${kind}/${enc(endpointId)}`;

/** Speko voice personas: call history, the phone line and incoming calls that wait for a code. */
export const voiceApi = {
  history: (companyId: string, endpointId: string, signal?: AbortSignal) =>
    api.get<VoiceCallHistoryEntry[]>(voice(companyId, "voice-history", endpointId), { signal }),
  phone: (companyId: string, endpointId: string, signal?: AbortSignal) =>
    api.get<VoicePhoneConfiguration>(voice(companyId, "voice-phone", endpointId), { signal }),
  savePhone: (companyId: string, endpointId: string, input: { numberId: string; enabled: boolean; guestIntake?: boolean }) =>
    api.put<VoicePhoneConfiguration>(voice(companyId, "voice-phone", endpointId), input),
  incoming: (companyId: string, endpointId: string, signal?: AbortSignal) =>
    api.get<VoiceInboundCall[]>(`${voice(companyId, "voice-phone", endpointId)}/incoming`, { signal }),
  unapproved: (companyId: string, endpointId: string, signal?: AbortSignal) =>
    api.get<VoiceUnapprovedCallHistoryEntry[]>(`${voice(companyId, "voice-phone", endpointId)}/history`, { signal }),
  decide: (companyId: string, endpointId: string, callId: string, input: { approve: boolean; approvalCode: string; issueId?: string }) =>
    api.post<VoiceInboundCall>(`${voice(companyId, "voice-phone", endpointId)}/incoming/${enc(callId)}`, input),
};
