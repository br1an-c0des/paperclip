import { api } from "./client";

/*
 * Linking a chat identity (a Slack user, a GitHub login…) to a Paperclip account, from the link a chat
 * connector sends (`/chat-identity/confirm?token=`), as ui/src/api/chatEndpoints.ts uses it. The
 * server enforces the chat connectors' rollout setting.
 */

export type ChatProvider = "slack" | "github" | "discord" | "microsoft-teams" | "telegram" | "agentmail" | "imessage-photon" | "speko";

export type ChatIdentityLinkPreview = {
  selfService?: boolean;
  canConfirm?: boolean;
  endpointId: string;
  companyId: string;
  companyName: string;
  companyPrefix: string;
  provider: ChatProvider;
  providerAccountLabel?: string | null;
  botLabel?: string | null;
  externalLabel: string;
  externalDetail?: string | null;
  expiresAt: string;
};

export const chatIdentityApi = {
  preview: (token: string) => api.get<ChatIdentityLinkPreview>(`/chat-identity-links/preview?token=${encodeURIComponent(token)}`),
  confirm: (token: string) => api.post<{ ok: true; endpointId: string }>("/chat-identity-links/confirm", { token }),
  requestAccess: (token: string) => api.post<{ status: "member" | "pending_approval" }>("/chat-identity-links/request-access", { token }),
};
