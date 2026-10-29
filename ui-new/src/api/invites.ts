import type { AgentAdapterType, JoinRequest } from "@paperclipai/shared";
import type { CompanyInviteCreated, HumanCompanyRole } from "./access";
import { api } from "./client";

/*
 * An invite link, from the invitee's side (`/invite/:token`), as ui/src/api/access.ts and
 * pages/InviteLanding.tsx use it. Reading an invite needs no session; accepting a person's invite
 * does on an authenticated instance. These types live in the old UI only.
 */

export type InviteSummary = {
  id: string;
  companyId: string | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
  inviteType: "company_join" | "bootstrap_ceo";
  allowedJoinTypes: "human" | "agent" | "both";
  humanRole?: HumanCompanyRole | null;
  expiresAt: string;
  inviteMessage?: string | null;
  invitedByUserName?: string | null;
  joinRequestStatus?: JoinRequest["status"] | null;
  joinRequestType?: JoinRequest["requestType"] | null;
};

export type AcceptInviteInput =
  | { requestType: "human" }
  | { requestType: "agent"; agentName: string; adapterType?: AgentAdapterType; capabilities?: string | null };

/** An agent's join request: the claim secret its API key is collected with, and its onboarding text. */
export type AgentJoinRequestAccepted = JoinRequest & {
  claimSecret?: string;
  claimApiKeyPath?: string;
  onboarding?: Record<string, unknown>;
};

export type AcceptInviteResult = AgentJoinRequestAccepted | { bootstrapAccepted: true; userId: string };

/*
 * Inviting an outside agent (New agent → Invite an outside agent; decision 39, D2), as the old UI's
 * ExternalAgentInviteDialog does it: an agent-only company invite, then its onboarding manifest for
 * the addresses the agent may reach Paperclip at. The created invite carries its onboarding text's
 * address; the manifest needs no session.
 */

export type AgentInviteCreated = CompanyInviteCreated & { onboardingTextPath?: string; onboardingTextUrl?: string };

export type InviteOnboardingManifest = {
  invite: InviteSummary;
  onboarding: {
    inviteMessage?: string | null;
    connectivity?: {
      guidance?: string;
      connectionCandidates?: string[];
      testResolutionEndpoint?: { method?: string; path?: string; url?: string };
    };
    textInstructions?: { url?: string };
  };
};

export const invitesApi = {
  get: (token: string) => api.get<InviteSummary>(`/invites/${encodeURIComponent(token)}`),
  accept: (token: string, input: AcceptInviteInput) =>
    api.post<AcceptInviteResult>(`/invites/${encodeURIComponent(token)}/accept`, input),
  /** An invite only agents can use (`allowedJoinTypes: "agent"`); its join request waits for approval. */
  createForAgent: (companyId: string) =>
    api.post<AgentInviteCreated>(`/companies/${encodeURIComponent(companyId)}/invites`, { allowedJoinTypes: "agent", humanRole: null, agentMessage: null }),
  onboarding: (token: string, signal?: AbortSignal) =>
    api.get<InviteOnboardingManifest>(`/invites/${encodeURIComponent(token)}/onboarding`, { signal }),
};
