import type {
  Agent,
  AgentApiKeyScope,
  AgentConfigRevision,
  AgentDesiredSkillEntry,
  AgentDetail,
  AgentInstructionCandidate,
  AgentInstructionHistory,
  AgentInstructionsBundle,
  AgentInstructionsFileDetail,
  AgentInstructionSnapshot,
  AgentKeyCreated,
  AgentPermissions,
  AgentProjectAccess,
  AgentRunner,
  AgentRuntimeState,
  AgentSkillSnapshot,
  AgentTaskSession,
  AdapterEnvironmentTestResult,
  AgentRuntimeSettingsPatch,
  EnvironmentProbeResult,
  ResolveAgentInstructionCandidate,
  ResourceMembershipUpdateResult,
  ToolProfileEffectiveSummary,
  UpdateResourceMembership,
} from "@paperclipai/shared";
import { api } from "./client";

/*
 * Agents, as ui/src/api/agents.ts uses them. General requests (get, update, pause, resume,
 * terminate, keys…) are named plainly so every agent screen can share them: the nav and palette,
 * the new-task dialog's model overrides (decision 7), the agent page and its settings (M5), and
 * the org pages.
 *
 * Requests that take `companyId` add it as `?companyId=`, as the old UI's `agentPath` does: the
 * server uses it to resolve an agent's URL key.
 */

/** One entry in an adapter's model catalog. The type lives in the old UI, not the shared package. */
export type AdapterModel = { id: string; label: string };

/** An agent's API key as the list returns it (ui/src/api/agents.ts `AgentKey`); the token is shown only once, on creation. */
export type AgentKey = { id: string; name: string; scope: AgentApiKeyScope; createdAt: string; revokedAt: string | null };

/** `PATCH /agents/:id/permissions` (ui/src/api/agents.ts `AgentPermissionUpdate`). */
export type AgentPermissionUpdate = {
  canCreateAgents: boolean;
  canCreateSkills: boolean;
  canAssignTasks: boolean;
  trustPreset?: AgentPermissions["trustPreset"];
  authorizationPolicy?: AgentPermissions["authorizationPolicy"];
};

/**
 * One registered harness (`GET /adapters`, ui/src/api/adapters.ts `AdapterInfo`): only the fields
 * ui-new reads. `supportedRunners` and `defaultRunner` say whether the Paperclip Runner can run it
 * in the company's (or the given environment's) target.
 */
export type AdapterInfo = {
  type: string;
  label: string;
  source: "builtin" | "external";
  disabled: boolean;
  overriddenBuiltin?: boolean;
  supportedRunners?: AgentRunner[];
  defaultRunner?: AgentRunner;
  capabilities: {
    supportsInstructionsBundle: boolean;
    supportsSkills: boolean;
    supportsLocalAgentJwt: boolean;
    supportsAcp: boolean;
  };
};

/** `GET /companies/:id/primary-agent/me` (ui/src/api/primaryAgent.ts). */
export type PrimaryAgentPreference = { companyId: string; userId: string; primaryAgentId: string | null; initialized: boolean };

/** A page of `GET /companies/:id/audit/agent-actions` (ui/src/api/audit.ts): the fields ui-new reads. */
export type AgentActionsPage = {
  items: {
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    runId: string | null;
    createdAt: string;
    details: Record<string, unknown> | null;
  }[];
  nextCursor?: string | null;
};

export type AgentWakeRequest = {
  source?: "timer" | "assignment" | "on_demand" | "automation";
  triggerDetail?: "manual" | "ping" | "callback" | "system";
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  forceFreshSession?: boolean;
};

function withCompany(path: string, companyId?: string) {
  if (!companyId) return path;
  return `${path}${path.includes("?") ? "&" : "?"}companyId=${encodeURIComponent(companyId)}`;
}

function agentPath(id: string, companyId?: string, suffix = "") {
  return withCompany(`/agents/${encodeURIComponent(id)}${suffix}`, companyId);
}

export const agentsApi = {
  list: (companyId: string) => api.get<Agent[]>(`/companies/${companyId}/agents`),
  adapterModels: (
    companyId: string,
    adapterType: string,
    options?: { provider?: string; environmentId?: string | null; refresh?: boolean },
  ) => {
    const params = new URLSearchParams();
    if (options?.refresh) params.set("refresh", "1");
    if (options?.provider) params.set("provider", options.provider);
    if (options?.environmentId) params.set("environmentId", options.environmentId);
    return api.get<AdapterModel[]>(
      `/companies/${encodeURIComponent(companyId)}/adapters/${encodeURIComponent(adapterType)}/models${params.size ? `?${params}` : ""}`,
    );
  },
  /** Registered harnesses with the runners each supports for the company or one environment. */
  adapters: (companyId: string, environmentId?: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams({ companyId });
    if (environmentId) params.set("environmentId", environmentId);
    return api.get<AdapterInfo[]>(`/adapters?${params}`, { signal });
  },

  // The agent itself
  get: (id: string, companyId?: string, signal?: AbortSignal) => api.get<AgentDetail>(agentPath(id, companyId), { signal }),
  update: (id: string, patch: Record<string, unknown>, companyId?: string) => api.patch<Agent>(agentPath(id, companyId), patch),
  /** The narrow model and AI-connection change the roster's bulk edit uses; stale `expected` values are refused. */
  updateRuntimeSettings: (id: string, runtimeSettings: AgentRuntimeSettingsPatch, companyId?: string) =>
    api.patch<Agent>(agentPath(id, companyId), { runtimeSettings }),
  updatePermissions: (id: string, data: AgentPermissionUpdate, companyId?: string) =>
    api.patch<AgentDetail>(agentPath(id, companyId, "/permissions"), data),
  setAvatar: (companyId: string, agentId: string, imageBase64: string | null) =>
    api.put<{ agentId: string; avatarUrl: string }>(`/companies/${companyId}/agents/${agentId}/avatar`, { imageBase64 }),

  // Lifecycle
  pause: (id: string, companyId?: string) => api.post<Agent>(agentPath(id, companyId, "/pause"), {}),
  resume: (id: string, companyId?: string) => api.post<Agent>(agentPath(id, companyId, "/resume"), {}),
  terminate: (id: string, companyId?: string) => api.post<Agent>(agentPath(id, companyId, "/terminate"), {}),
  clearError: (id: string, companyId?: string) => api.post<Agent>(agentPath(id, companyId, "/clear-error"), {}),
  approve: (id: string, companyId?: string) => api.post<Agent>(agentPath(id, companyId, "/approve"), {}),
  retryLifecycle: (id: string, companyId?: string) => api.post<Agent>(agentPath(id, companyId, "/lifecycle/retry"), {}),
  /** Starts a run now, like the old UI's "Run now". */
  invoke: (id: string, companyId?: string) => api.post<{ id: string }>(agentPath(id, companyId, "/heartbeat/invoke"), {}),

  // Runtime and the Runner
  runtimeState: (id: string, companyId?: string, signal?: AbortSignal) =>
    api.get<AgentRuntimeState | null>(agentPath(id, companyId, "/runtime-state"), { signal }),
  taskSessions: (id: string, companyId?: string, signal?: AbortSignal) =>
    api.get<AgentTaskSession[]>(agentPath(id, companyId, "/task-sessions"), { signal }),
  /** Clears the provider session for one task, or every session when `taskKey` is null. */
  resetSession: (id: string, taskKey: string | null, companyId?: string) =>
    api.post<void>(agentPath(id, companyId, "/runtime-state/reset-session"), { taskKey }),
  /** Probes a sandbox environment so the Runner can be qualified on it (`POST /agents/:id/qualify-runner`). */
  qualifyRunner: (id: string, expectedEnvironmentId: string, companyId?: string) =>
    api.post<EnvironmentProbeResult>(agentPath(id, companyId, "/qualify-runner"), { expectedEnvironmentId }),
  testEnvironment: (
    companyId: string,
    adapterType: string,
    data: { adapterConfig: Record<string, unknown>; agentId?: string; environmentId?: string | null; aiConnection?: unknown },
  ) => api.post<AdapterEnvironmentTestResult>(`/companies/${companyId}/adapters/${adapterType}/test-environment`, data),

  // Instructions
  instructionsBundle: (id: string, companyId?: string, signal?: AbortSignal) =>
    api.get<AgentInstructionsBundle>(agentPath(id, companyId, "/instructions-bundle"), { signal }),
  instructionsFile: (id: string, path: string, companyId?: string, signal?: AbortSignal) =>
    api.get<AgentInstructionsFileDetail>(agentPath(id, companyId, `/instructions-bundle/file?path=${encodeURIComponent(path)}`), { signal }),
  saveInstructionsFile: (
    id: string,
    data: { path: string; content: string; baseRevisionId?: string | null; baseHash?: string | null },
    companyId?: string,
  ) => api.put<AgentInstructionsFileDetail>(agentPath(id, companyId, "/instructions-bundle/file"), data),
  deleteInstructionsFile: (id: string, path: string, companyId?: string, baseHash?: string) =>
    api.delete<AgentInstructionsBundle>(
      agentPath(id, companyId, `/instructions-bundle/file?path=${encodeURIComponent(path)}${baseHash ? `&baseHash=${encodeURIComponent(baseHash)}` : ""}`),
    ),
  instructionsFileDownloadUrl: (id: string, path: string, companyId?: string) =>
    `/api${agentPath(id, companyId, `/instructions-bundle/file?path=${encodeURIComponent(path)}&download=true`)}`,
  instructionCandidates: (id: string, companyId?: string, signal?: AbortSignal) =>
    api.get<AgentInstructionCandidate[]>(agentPath(id, companyId, "/instructions-bundle/candidates"), { signal }),
  resolveInstructionCandidate: (id: string, runId: string, data: ResolveAgentInstructionCandidate, companyId?: string) =>
    api.post<AgentInstructionsFileDetail>(agentPath(id, companyId, `/instructions-bundle/candidates/${encodeURIComponent(runId)}/resolve`), data),
  instructionHistory: (id: string, path: string, companyId?: string, cursor?: string, signal?: AbortSignal) =>
    api.get<AgentInstructionHistory>(
      agentPath(id, companyId, `/instructions-bundle/history?path=${encodeURIComponent(path)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
      { signal },
    ),
  instructionRevision: (id: string, path: string, revisionId: string, companyId?: string, signal?: AbortSignal) =>
    api.get<AgentInstructionSnapshot>(
      agentPath(id, companyId, `/instructions-bundle/revision/${encodeURIComponent(revisionId)}?path=${encodeURIComponent(path)}`),
      { signal },
    ),
  restoreInstructions: (id: string, data: { path: string; revisionId: string; baseRevisionId: string }, companyId?: string) =>
    api.post<AgentInstructionsFileDetail>(agentPath(id, companyId, "/instructions-bundle/restore"), data),

  // Skills
  skills: (id: string, companyId?: string, signal?: AbortSignal) => api.get<AgentSkillSnapshot>(agentPath(id, companyId, "/skills"), { signal }),
  /** Sets the agent's skills; entries with a `versionId` keep that version pinned. */
  syncSkills: (id: string, desiredSkills: Array<string | AgentDesiredSkillEntry>, mode: "add" | "remove" | "replace", companyId?: string) =>
    api.post<AgentSkillSnapshot>(agentPath(id, companyId, "/skills/sync"), { desiredSkills, mode }),

  /** The tools and connections an agent's runs get (`/tools/profiles/effective/agents/:agentId`). */
  effectiveTools: (companyId: string, agentId: string, signal?: AbortSignal) =>
    api.get<ToolProfileEffectiveSummary>(
      `/companies/${encodeURIComponent(companyId)}/tools/profiles/effective/agents/${encodeURIComponent(agentId)}`,
      { signal },
    ),

  // Permissions, keys and history
  projectAccess: (id: string, signal?: AbortSignal) => api.get<AgentProjectAccess>(`/agents/${encodeURIComponent(id)}/project-access`, { signal }),
  addProjectAccess: (id: string, projectIds: string[]) =>
    api.post<AgentProjectAccess>(`/agents/${encodeURIComponent(id)}/project-access`, { projectIds }),
  keys: (id: string, companyId?: string, signal?: AbortSignal) => api.get<AgentKey[]>(agentPath(id, companyId, "/keys"), { signal }),
  createKey: (id: string, name: string, companyId?: string) => api.post<AgentKeyCreated>(agentPath(id, companyId, "/keys"), { name }),
  revokeKey: (id: string, keyId: string, companyId?: string) =>
    api.delete<{ ok: true }>(agentPath(id, companyId, `/keys/${encodeURIComponent(keyId)}`)),
  configRevisions: (id: string, companyId?: string, signal?: AbortSignal) =>
    api.get<AgentConfigRevision[]>(agentPath(id, companyId, "/config-revisions"), { signal }),
  rollbackConfigRevision: (id: string, revisionId: string, companyId?: string) =>
    api.post<Agent>(agentPath(id, companyId, `/config-revisions/${encodeURIComponent(revisionId)}/rollback`), {}),
  /** What the agent did (`/audit/agent-actions?agentId=`), newest first, a page at a time. */
  actions: (companyId: string, agentId: string, cursor?: string | null, limit = 25, signal?: AbortSignal) => {
    const params = new URLSearchParams({ agentId, limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return api.get<AgentActionsPage>(`/companies/${encodeURIComponent(companyId)}/audit/agent-actions?${params}`, { signal });
  },
  actionsCsvUrl: (companyId: string, agentId: string) =>
    `/api/companies/${encodeURIComponent(companyId)}/audit/agent-actions.csv?agentId=${encodeURIComponent(agentId)}`,

  // Personal
  primaryAgent: (companyId: string, signal?: AbortSignal) =>
    api.get<PrimaryAgentPreference>(`/companies/${encodeURIComponent(companyId)}/primary-agent/me`, { signal }),
  setPrimaryAgent: (companyId: string, primaryAgentId: string) =>
    api.put<PrimaryAgentPreference>(`/companies/${encodeURIComponent(companyId)}/primary-agent/me`, { primaryAgentId }),
  /** Joins or leaves the agent for you: whether it shows in your sidebar. */
  updateMembership: (companyId: string, agentId: string, data: UpdateResourceMembership) =>
    api.put<ResourceMembershipUpdateResult>(
      `/companies/${encodeURIComponent(companyId)}/resource-memberships/me/agents/${encodeURIComponent(agentId)}`,
      data,
    ),
};

/** Agents the board works with: everything except terminated ones. */
export function activeAgents(agents: readonly Agent[] | undefined) {
  return (agents ?? []).filter((agent) => agent.status !== "terminated");
}

/** The agent an address names, by URL key or id, among the company's agents. */
export function findAgent<T extends Pick<Agent, "id" | "urlKey" | "status">>(agents: readonly T[] | undefined, key: string): T | undefined {
  const list = agents ?? [];
  return (
    list.find((agent) => agent.id === key) ??
    list.find((agent) => agent.urlKey === key && agent.status !== "terminated") ??
    list.find((agent) => agent.urlKey === key)
  );
}
