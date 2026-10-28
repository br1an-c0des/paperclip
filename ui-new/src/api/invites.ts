import type { AgentAdapterType, JoinRequest } from "@paperclipai/shared";
import type { HumanCompanyRole } from "./access";
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

export const invitesApi = {
  get: (token: string) => api.get<InviteSummary>(`/invites/${encodeURIComponent(token)}`),
  accept: (token: string, input: AcceptInviteInput) =>
    api.post<AcceptInviteResult>(`/invites/${encodeURIComponent(token)}/accept`, input),
};
