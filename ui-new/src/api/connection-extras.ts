import type {
  AggregatorAppsResponse,
  ComposioAppSetupInput,
  ComposioAppSetupResult,
  ConnectionGrant,
  ConnectionGrantDelegation,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * More of a connection (`/api/tool-connections/:id/*`), beside api/tools.ts:
 *
 * - Identities: who a connection acts as (its grants). Revoke one, choose which people may use an
 *   organization identity (an empty list is everyone), let agents act as your personal identity
 *   (delegations), and start your own personal sign-in.
 * - Aggregators (Composio, Arcade): the accounts and apps behind a gateway connection, refreshing
 *   them, Arcade's account sync, and connecting one more app through Composio.
 */

const enc = encodeURIComponent;
const connection = (id: string, rest: string) => `/tool-connections/${enc(id)}${rest}`;

export const connectionGrantsApi = {
  revoke: (connectionId: string, grantId: string) => api.delete<ConnectionGrant>(connection(connectionId, `/grants/${enc(grantId)}`)),
  replaceMembers: (connectionId: string, grantId: string, memberUserIds: string[]) =>
    api.put<ConnectionGrant>(connection(connectionId, `/grants/${enc(grantId)}/members`), { memberUserIds }),
  delegate: (connectionId: string, grantId: string, agentId: string) =>
    api.post<ConnectionGrantDelegation>(connection(connectionId, `/grants/${enc(grantId)}/delegations`), { agentId }),
  revokeDelegation: (connectionId: string, grantId: string, delegationId: string) =>
    api.delete<ConnectionGrantDelegation>(connection(connectionId, `/grants/${enc(grantId)}/delegations/${enc(delegationId)}`)),
  /** Your own sign-in for a personal connection; the server refuses anyone but you as the subject. */
  startPersonal: (companyId: string, connectionId: string, input: { subjectUserId: string; returnTo?: string }) =>
    api.post<{ url: string; handoff?: unknown }>(`/companies/${enc(companyId)}/tools/connections/${enc(connectionId)}/start-authorization`, input),
};

export const aggregatorsApi = {
  apps: (connectionId: string, signal?: AbortSignal) => api.get<AggregatorAppsResponse>(connection(connectionId, "/aggregator/apps"), { signal }),
  sync: (connectionId: string, force = false) => api.post<AggregatorAppsResponse>(connection(connectionId, "/aggregator/apps/sync"), { force }),
  refresh: (connectionId: string, toolkits: string[] = []) =>
    api.post<AggregatorAppsResponse>(connection(connectionId, "/aggregator/apps/refresh"), { toolkits }),
  /** Arcade: a project key and user id, used only to list the accounts behind the gateway. */
  arcadeDiscovery: (connectionId: string, input: { apiKey: string; userId: string }) =>
    api.put<AggregatorAppsResponse>(connection(connectionId, "/aggregator/discovery"), input),
  /** Composio: start (or finish) connecting one app (a toolkit) through this account. */
  composioSetup: (connectionId: string, toolkit: string, input: ComposioAppSetupInput) =>
    api.post<ComposioAppSetupResult>(connection(connectionId, `/composio/apps/${enc(toolkit)}/setup`), input),
};
