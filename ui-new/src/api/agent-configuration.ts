import type {
  AgentConfigRevision,
  AgentConfigurationDocument,
  AgentConfigurationResponse,
  AgentDesiredSkillEntry,
  AgentDetail,
  AgentInstructionsBundle,
  AgentInstructionsFileDetail,
  AgentKeyCreated,
  AgentSkillSnapshot,
  CompanySecret,
  SecretProposalView,
  ToolConnection,
  ToolConnectionInstall,
  ToolPolicy,
  ToolProfileWithDetails,
} from "@paperclipai/shared";
import { agentsApi, type AgentKey, type AgentPermissionUpdate, type InstructionsBundleUpdate } from "./agents";
import { chatEndpointsApi, type ChatEndpoint, type ChatEndpointResource, type ChatIdentityLink } from "./chat-endpoints";
import { api } from "./client";
import { secretsApi } from "./secrets";
import { toolAccessApi } from "./tool-access";
import { toolsApi, type InstallTarget } from "./tools";

/*
 * Every request the agent YAML editor (agents/settings/AdvancedSection.tsx) makes, gathered into one
 * client so the model (agents/configuration-model.ts) can be tested without a server. The document
 * covers several resources, and each is read and saved through its own API, as in the old UI's
 * Advanced tab (ui/src/lib/agent-configuration/): the agent itself (`GET /agents/:id/configuration`,
 * `PATCH /agents/:id` with `expectedConfigurationRevision`), instructions, skills, tool installs,
 * profiles and policies, channels, secrets and their proposals, API keys and config revisions.
 *
 * Most requests reuse the area modules. Written here: the configuration read, key creation with a
 * scope, tool policy writes and the secret writes that take the shared package's full inputs.
 */

type Spec = AgentConfigurationDocument["spec"];
type Tools = NonNullable<Spec["tools"]>;
type Secrets = NonNullable<Spec["secrets"]>;
type Channels = NonNullable<Spec["channels"]>;
type ChannelOperations = NonNullable<Spec["channelOperations"]>;
type ApiKeys = NonNullable<Spec["apiKeys"]>;

export type ConfigurationProfileInput = Tools["profiles"][number]["configuration"];
export type ConfigurationPolicyInput = Tools["policies"][number]["configuration"];
export type ConfigurationSecretInput = Secrets["create"][number]["secret"];
export type ConfigurationChannelSettings = Partial<Channels[number]["settings"]>;
export type ConfigurationChannelResource = Channels[number]["resources"][number];
export type ConfigurationChannelCreate = ChannelOperations["create"][number] & { assignedAgentId: string };
export type ConfigurationChannelSetup = ChannelOperations["setup"][number]["input"];
export type ConfigurationKeyScope = ApiKeys["create"][number]["scope"];

const enc = encodeURIComponent;
const agentPath = (id: string, companyId: string, rest = "") => `/agents/${enc(id)}${rest}?companyId=${enc(companyId)}`;

export interface ConfigurationClient {
  agents: {
    getConfiguration: (id: string, companyId: string) => Promise<AgentConfigurationResponse>;
    get: (id: string, companyId: string) => Promise<AgentDetail>;
    instructionsBundle: (id: string, companyId: string) => Promise<AgentInstructionsBundle>;
    instructionsFile: (id: string, path: string, companyId: string) => Promise<AgentInstructionsFileDetail>;
    skills: (id: string, companyId: string) => Promise<AgentSkillSnapshot>;
    listKeys: (id: string, companyId: string) => Promise<AgentKey[]>;
    listConfigRevisions: (id: string, companyId: string) => Promise<AgentConfigRevision[]>;
    update: (id: string, patch: Record<string, unknown>, companyId: string) => Promise<unknown>;
    updateInstructionsBundle: (id: string, data: InstructionsBundleUpdate, companyId: string) => Promise<unknown>;
    saveInstructionsFile: (
      id: string,
      data: { path: string; content: string; baseHash: string | null; baseRevisionId: string | null },
      companyId: string,
    ) => Promise<unknown>;
    deleteInstructionsFile: (id: string, path: string, companyId: string, baseHash?: string) => Promise<unknown>;
    syncSkills: (id: string, skills: Array<string | AgentDesiredSkillEntry>, mode: "replace", companyId: string) => Promise<unknown>;
    updatePermissions: (id: string, data: AgentPermissionUpdate, companyId: string) => Promise<unknown>;
    createKey: (id: string, name: string, companyId: string, scope?: ConfigurationKeyScope) => Promise<AgentKeyCreated>;
    revokeKey: (id: string, keyId: string, companyId: string) => Promise<unknown>;
    rollbackConfigRevision: (id: string, revisionId: string, companyId: string) => Promise<unknown>;
  };
  tools: {
    listConnections: (companyId: string) => Promise<{ connections: ToolConnection[] }>;
    listProfiles: (companyId: string) => Promise<{ profiles: ToolProfileWithDetails[] }>;
    listPolicies: (companyId: string) => Promise<{ policies: ToolPolicy[] }>;
    getConnectionInstalls: (connectionId: string) => Promise<{ installs: Pick<ToolConnectionInstall, "targetType" | "targetId">[] }>;
    putConnectionInstalls: (connectionId: string, installs: InstallTarget[]) => Promise<unknown>;
    createProfile: (companyId: string, input: ConfigurationProfileInput) => Promise<{ id: string }>;
    updateProfile: (profileId: string, input: ConfigurationProfileInput) => Promise<unknown>;
    bindProfile: (
      companyId: string,
      profileId: string,
      target: { targetType: "agent"; targetId: string; priority?: number; metadata?: Record<string, unknown> | null },
    ) => Promise<unknown>;
    unbindProfile: (companyId: string, profileId: string, target: { targetType: "agent"; targetId: string }) => Promise<unknown>;
    createPolicy: (companyId: string, input: ConfigurationPolicyInput) => Promise<unknown>;
    updatePolicy: (companyId: string, policyId: string, input: ConfigurationPolicyInput) => Promise<unknown>;
    deletePolicy: (companyId: string, policyId: string) => Promise<unknown>;
  };
  channels: {
    list: (companyId: string) => Promise<ChatEndpoint[]>;
    get: (id: string) => Promise<ChatEndpoint>;
    listResources: (id: string) => Promise<ChatEndpointResource[]>;
    listPrincipals: (id: string) => Promise<Pick<ChatIdentityLink, "principalId">[]>;
    update: (id: string, changes: ConfigurationChannelSettings) => Promise<unknown>;
    updateResources: (id: string, resources: ConfigurationChannelResource[]) => Promise<unknown>;
    create: (companyId: string, input: ConfigurationChannelCreate) => Promise<unknown>;
    setup: (id: string, input: ConfigurationChannelSetup) => Promise<unknown>;
    revokeLink: (endpointId: string, principalId: string) => Promise<unknown>;
  };
  secrets: {
    list: (companyId: string) => Promise<CompanySecret[]>;
    listProposals: (companyId: string) => Promise<SecretProposalView[]>;
    create: (companyId: string, input: ConfigurationSecretInput) => Promise<CompanySecret>;
    rotate: (id: string, input: Secrets["rotate"][number]["input"]) => Promise<unknown>;
    update: (id: string, input: Secrets["update"][number]["input"]) => Promise<unknown>;
    approveProposal: (companyId: string, id: string) => Promise<unknown>;
    rejectProposal: (companyId: string, id: string, data: { reason: string }) => Promise<unknown>;
  };
}

/* The area modules' types are narrower than the document's inputs in places (they cover what their
 * own screens send); the server validates the same shared schemas, so the casts below only widen. */
type Loose<T> = T extends (...args: infer A) => infer R ? (...args: { [K in keyof A]: any }) => R : never;
const loose = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as Loose<T>;

export const configurationClient: ConfigurationClient = {
  agents: {
    getConfiguration: (id, companyId) => api.get<AgentConfigurationResponse>(agentPath(id, companyId, "/configuration")),
    get: (id, companyId) => agentsApi.get(id, companyId),
    instructionsBundle: (id, companyId) => agentsApi.instructionsBundle(id, companyId),
    instructionsFile: (id, path, companyId) => agentsApi.instructionsFile(id, path, companyId),
    skills: (id, companyId) => agentsApi.skills(id, companyId),
    listKeys: (id, companyId) => agentsApi.keys(id, companyId),
    listConfigRevisions: (id, companyId) => agentsApi.configRevisions(id, companyId),
    update: (id, patch, companyId) => agentsApi.update(id, patch, companyId),
    updateInstructionsBundle: (id, data, companyId) => agentsApi.updateInstructionsBundle(id, data, companyId),
    saveInstructionsFile: (id, data, companyId) => agentsApi.saveInstructionsFile(id, data, companyId),
    deleteInstructionsFile: (id, path, companyId, baseHash) => agentsApi.deleteInstructionsFile(id, path, companyId, baseHash),
    syncSkills: (id, skills, mode, companyId) => agentsApi.syncSkills(id, skills, mode, companyId),
    updatePermissions: (id, data, companyId) => agentsApi.updatePermissions(id, data, companyId),
    createKey: (id, name, companyId, scope) =>
      api.post<AgentKeyCreated>(agentPath(id, companyId, "/keys"), { name, ...(scope ? { scope } : {}) }),
    revokeKey: (id, keyId, companyId) => agentsApi.revokeKey(id, keyId, companyId),
    rollbackConfigRevision: (id, revisionId, companyId) => agentsApi.rollbackConfigRevision(id, revisionId, companyId),
  },
  tools: {
    listConnections: (companyId) => toolsApi.connections(companyId),
    listProfiles: (companyId) => toolsApi.profiles(companyId),
    listPolicies: (companyId) => toolsApi.policies(companyId),
    getConnectionInstalls: (connectionId) => toolsApi.installs(connectionId),
    putConnectionInstalls: (connectionId, installs) => toolsApi.putInstalls(connectionId, installs),
    createProfile: (companyId, input) => loose(toolAccessApi.createProfile)(companyId, input),
    updateProfile: (profileId, input) => loose(toolAccessApi.updateProfile)(profileId, input),
    bindProfile: (companyId, profileId, target) => loose(toolAccessApi.bindProfile)(companyId, profileId, target),
    unbindProfile: (companyId, profileId, target) => toolAccessApi.unbindProfile(companyId, profileId, target),
    createPolicy: (companyId, input) => api.post<ToolPolicy>(`/companies/${enc(companyId)}/tools/policies`, input),
    updatePolicy: (companyId, policyId, input) =>
      api.patch<ToolPolicy>(`/companies/${enc(companyId)}/tools/policies/${enc(policyId)}`, input),
    deletePolicy: (companyId, policyId) => api.delete<unknown>(`/companies/${enc(companyId)}/tools/policies/${enc(policyId)}`),
  },
  channels: {
    list: (companyId) => chatEndpointsApi.list(companyId),
    get: (id) => chatEndpointsApi.get(id),
    listResources: (id) => chatEndpointsApi.resources(id),
    listPrincipals: (id) => chatEndpointsApi.principals(id),
    update: (id, changes) => loose(chatEndpointsApi.update)(id, changes),
    updateResources: (id, resources) => chatEndpointsApi.updateResources(id, resources),
    create: (companyId, input) => loose(chatEndpointsApi.create)(companyId, input),
    setup: (id, input) => loose(chatEndpointsApi.setup)(id, input),
    revokeLink: (endpointId, principalId) => chatEndpointsApi.revokeLink(endpointId, principalId),
  },
  secrets: {
    list: (companyId) => secretsApi.list(companyId),
    listProposals: (companyId) => secretsApi.proposals(companyId),
    create: (companyId, input) => api.post<CompanySecret>(`/companies/${enc(companyId)}/secrets`, input),
    rotate: (id, input) => api.post<CompanySecret>(`/secrets/${enc(id)}/rotate`, input),
    update: (id, input) => api.patch<CompanySecret>(`/secrets/${enc(id)}`, input),
    approveProposal: (companyId, id) => secretsApi.approveProposal(companyId, id),
    rejectProposal: (companyId, id, data) => secretsApi.rejectProposal(companyId, id, data),
  },
};
