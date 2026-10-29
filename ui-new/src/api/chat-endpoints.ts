import type {
  ChatActivityItem,
  ChatEndpointSetupState,
  ChatExecutionDefaults,
  ChatProvider,
  ChatPublicationBatchStatus,
  ChatPublicationState,
  ChatPublicationSummary,
  ExternalChannelBindingSummary,
  ExecutionWorkspaceSummary,
  GitHubAppRegistrationInput,
  GitHubAppWizardState,
  GitHubChatConfiguration,
  GitHubRepositoryPage,
  GitHubTaskReview,
  PhotonProjectInspection,
  SlackAppConfiguration,
  SlackInstallAuthorization,
  SlackManagedProvisionInput,
  SlackManagedResult,
  SlackManagerAuthorization,
  SlackRegistrationInput,
  SlackSearchStatus,
  SlackSetupOptions,
  SlackTestMessageInput,
  SlackTestMessageResult,
  SlackToolCapabilities,
  VoiceCallbackPreference,
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
  /** GitHub identities carry the account's stable ID and login. */
  githubUserId?: string | null;
  githubLogin?: string | null;
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
    slackRegistration?: {
      status: "creating" | "uncertain" | "failed" | "install" | "credentials_saved" | "configured" | "removed";
      appId?: string | null;
      managementUrl?: string | null;
      managerGrantId?: string | null;
      errorCode?: string | null;
    } | null;
    /** Why managed Slack setup stopped, as a code (`slackSetupMessage`). */
    slackManagerError?: string | null;
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

  /*
   * Slack's provisioned setups. Managed: Paperclip's own Slack manager app creates the agent's app
   * in a workspace you authorized (`managed/authorize`, then `managed/provision`). Automatic: an App
   * configuration access token you paste creates it (`registration`). Either then installs it with
   * your Slack account (`install`), and `resume` retries a saved installation.
   */
  authorizeSlackManager: (id: string) => api.post<SlackManagerAuthorization>(endpoint(id, "/slack/managed/authorize"), {}),
  provisionManagedSlack: (id: string, input: SlackManagedProvisionInput) => api.post<SlackManagedResult>(endpoint(id, "/slack/managed/provision"), input),
  createSlackApp: (id: string, input: SlackRegistrationInput) => api.post<ChatEndpoint>(endpoint(id, "/slack/registration"), input),
  installSlackApp: (id: string) => api.post<SlackInstallAuthorization>(endpoint(id, "/slack/install"), {}),
  resumeSlackInstallation: (id: string) => api.post<ChatEndpoint>(endpoint(id, "/slack/resume"), {}),
  /** A direct message from the bot to you (or a Slack account you pick) to check it works. */
  sendSlackTestMessage: (id: string, input: SlackTestMessageInput) => api.post<SlackTestMessageResult>(endpoint(id, "/slack/test-message"), input),
  /** The lines a Photon project offers; the secret is used for this check only. */
  inspectPhoton: (id: string, input: { projectId: string; projectSecret: string }) =>
    api.post<PhotonProjectInspection>(endpoint(id, "/photon/inspect"), input),

  /** Workspaces a new chat task may use, for task defaults. */
  taskWorkspaces: (companyId: string, signal?: AbortSignal) =>
    api.get<ExecutionWorkspaceSummary[]>(`/companies/${enc(companyId)}/execution-workspaces?summary=true&selectableForTask=true`, { signal }),
};

/*
 * Slack tools on a Slack endpoint (`/companies/:companyId/slack/endpoints/:id/*`, ui/src/api/slackTools.ts):
 * what the bot's tools can do, and personal search, which needs its own Slack OAuth client.
 */
const slackTools = (companyId: string, endpointId: string) => `/companies/${enc(companyId)}/slack/endpoints/${enc(endpointId)}`;

export const slackToolsApi = {
  capabilities: (companyId: string, endpointId: string, signal?: AbortSignal) =>
    api.get<SlackToolCapabilities>(`${slackTools(companyId, endpointId)}/capabilities`, { signal }),
  search: (companyId: string, endpointId: string, signal?: AbortSignal) =>
    api.get<SlackSearchStatus>(`${slackTools(companyId, endpointId)}/search`, { signal }),
  configureSearch: (companyId: string, endpointId: string, input: { clientId: string; clientSecret: string }) =>
    api.put<SlackSearchStatus>(`${slackTools(companyId, endpointId)}/search`, input),
  /** The Slack sign-in address that grants your own search. */
  connectSearch: (companyId: string, endpointId: string) => api.post<{ url: string }>(`${slackTools(companyId, endpointId)}/search/connect`, {}),
  disconnectSearch: (companyId: string, endpointId: string) => api.delete<SlackSearchStatus>(`${slackTools(companyId, endpointId)}/search`),
};

export type GitHubConfigurationRecord = { revision: number; configuration: GitHubChatConfiguration };
export type GitHubIdentity = { githubUserId: string; login: string; connectionId: string; avatarUrl: string | null };
export type GitHubPersonalConnection = { connectionId: string; name: string; login: string | null; status: string; enabled: boolean };

/*
 * GitHub review bots (`/chat-endpoints/:id/github/*`, ui/src/api/githubChat.ts). Guided setup:
 * `setup` reports (and advances) where the App registration stands; `registration` returns the
 * manifest to post to github.com; `identity*` links your GitHub account. Then the bot's
 * repositories and its review configuration (saved with the revision it was read at).
 */
export const githubChatApi = {
  connectApp: (id: string, credentials: { appId: string; privateKey: string; webhookSecret: string }) =>
    api.post<ChatEndpoint>(endpoint(id, "/github/app"), credentials),
  reviews: (id: string, signal?: AbortSignal) => api.get<GitHubTaskReview[]>(endpoint(id, "/github/reviews"), { signal }),

  advance: (id: string) => api.post<GitHubAppWizardState>(endpoint(id, "/github/setup"), {}),
  registration: (id: string, input: GitHubAppRegistrationInput) => api.post<GitHubAppWizardState>(endpoint(id, "/github/registration"), input),
  /** Starts again after a registration expired; you confirm no App was made on GitHub. */
  restartRegistration: (id: string, registrationId: string) =>
    api.post<GitHubAppWizardState>(endpoint(id, "/github/registration/restart"), { registrationId, appNotCreated: true }),
  saveDraft: (id: string, input: GitHubAppRegistrationInput) => api.put<{ saved: true }>(endpoint(id, "/github/draft"), input),
  startIdentity: (id: string) => api.post<{ authorizationUrl: string }>(endpoint(id, "/github/identity/start"), {}),
  confirmIdentity: (id: string, githubUserId: string) => api.post<GitHubAppWizardState>(endpoint(id, "/github/identity/confirm"), { githubUserId }),
  personalConnections: (id: string, signal?: AbortSignal) => api.get<GitHubPersonalConnection[]>(endpoint(id, "/github/personal-connections"), { signal }),
  /** Reads (and, with the confirmed user ID, links) the GitHub account behind one of your connections. */
  identity: (id: string, connectionId: string, confirmedGithubUserId?: string) =>
    api.post<GitHubIdentity>(endpoint(id, "/github/identity"), { connectionId, confirmedGithubUserId }),

  repositories: (id: string, options: { offset?: number; search?: string; limit?: number } = {}, signal?: AbortSignal) => {
    const query = new URLSearchParams({ limit: String(options.limit ?? 20), offset: String(options.offset ?? 0), search: options.search ?? "" });
    return api.get<GitHubRepositoryPage>(endpoint(id, `/github/repositories?${query}`), { signal });
  },
  toggleAllRepositories: (id: string, enabled: boolean) => api.put<{ success: true }>(endpoint(id, "/github/repositories/access"), { enabled }),
  refreshRepositories: (id: string) => api.post<ChatEndpointResource[]>(endpoint(id, "/github/repositories/refresh"), {}),
  configuration: (id: string, signal?: AbortSignal) => api.get<GitHubConfigurationRecord>(endpoint(id, "/github/configuration"), { signal }),
  saveConfiguration: (id: string, expectedRevision: number, configuration: GitHubChatConfiguration) =>
    api.put<GitHubConfigurationRecord>(endpoint(id, "/github/configuration"), { expectedRevision, configuration }),
  /** A GitHub login's stable user ID, for allowing an outside contributor. */
  lookup: (id: string, login: string) => api.post<{ githubUserId: string; login: string }>(endpoint(id, "/github/people/lookup"), { login }),
};

const voice = (companyId: string, kind: string, endpointId: string) => `/companies/${enc(companyId)}/${kind}/${enc(endpointId)}`;

/** Speko voice personas: call history, the phone line and incoming calls that wait for a code. */
export const voiceApi = {
  /** Your own "call my phone" number for this persona, or null. */
  callback: (companyId: string, endpointId: string, signal?: AbortSignal) =>
    api.get<VoiceCallbackPreference | null>(voice(companyId, "voice-callbacks", endpointId), { signal }),
  saveCallback: (companyId: string, endpointId: string, preference: VoiceCallbackPreference) =>
    api.put<VoiceCallbackPreference>(voice(companyId, "voice-callbacks", endpointId), preference),
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
