import type { InboxAgentPolicy, UpdateInboxAgentPolicy } from "@paperclipai/shared";
import { api } from "./client";

/*
 * "Let agents tidy my inbox" (ui/src/api/inbox-agent-policy.ts): whether the agents you manage may
 * archive tasks out of your inbox in one organization. `open` lets any of them, `allowlist` only the
 * ones named, `disabled` none. App settings → Account shows it for the organization you're in.
 */
export const inboxAgentPolicyApi = {
  mine: (companyId: string, signal?: AbortSignal) =>
    api.get<InboxAgentPolicy>(`/companies/${encodeURIComponent(companyId)}/users/me/inbox-agent-policy`, { signal }),
  updateMine: (companyId: string, input: UpdateInboxAgentPolicy) =>
    api.put<InboxAgentPolicy>(`/companies/${encodeURIComponent(companyId)}/users/me/inbox-agent-policy`, input),
};
