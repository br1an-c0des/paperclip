import {
  agentConfigurationDocumentSchema,
  agentConfigurationInputSchema,
  agentConfigurationSpec,
  canonicalAgentConfiguration,
  type AgentConfigurationDocument,
  type AgentConfigurationInput,
  type AgentConfigurationWarning,
  type AgentInstructionsFileDetail,
  type ToolPolicy,
  type ToolProfileWithDetails,
} from "@paperclipai/shared";
import type { ConfigurationClient } from "@/api/agent-configuration";
import { agentConfigurationPatch } from "./configuration-yaml";

/*
 * The agent YAML editor's model (agents/settings/AdvancedSection.tsx), ported from the old UI's
 * Advanced tab (ui/src/lib/agent-configuration/: load, resolve, steps, tools, channels, save).
 *
 * - **Load** reads every resource the document covers and builds the full `paperclip/v1` document.
 * - **Resolve** fills an edited (possibly sparse) document in from the saved one: omitted sections
 *   stay as saved, `null` instruction files are deletions, profiles named by key are looked up.
 * - **Plan** turns the difference into labelled steps, each one request (or a few) to the resource's
 *   own API, checking the whole plan before anything is written: references must exist, removals
 *   can't be combined with edits, a revision restore is a save of its own, and so on.
 * - **Save** reloads first and refuses if the agent's `configurationRevision` or an edited section
 *   changed meanwhile (stale writes), re-plans against the fresh state (so an untouched section
 *   isn't rolled back), then runs the steps in order. A failing step stops the save and says which
 *   steps already went through (`ConfigurationSaveInterrupted`); nothing is retried.
 */

export type ConfigurationStep = { label: string; apply: () => Promise<unknown> };
type AddStep = (label: string, apply: ConfigurationStep["apply"]) => void;
export type ConfigurationReceipt = { label: string; id: string; token?: string };

/** A save that stopped part-way: which steps went through, which one failed and why. */
export class ConfigurationSaveInterrupted extends Error {
  readonly completed: string[];
  readonly step: string;
  readonly reason: string;
  constructor(label: string, completed: string[], cause: unknown) {
    const reason = cause instanceof Error ? cause.message : "Request failed";
    super(
      `${completed.length ? `Saved: ${completed.join(", ")}. ` : ""}Could not complete ${label}: ${reason}. Some changes may have been saved. Reload saved before saving again.`,
    );
    this.name = "ConfigurationSaveInterrupted";
    this.completed = completed;
    this.step = label;
    this.reason = reason;
  }
}

/** What the editor's footer says about the text: nothing to save, unsaved, or why it can't be saved. */
export function editorState(
  source: string,
  saved: string,
  plan: { steps: string[]; error: string | null },
): { kind: "clean" } | { kind: "invalid"; message: string } | { kind: "no-op" } | { kind: "changes"; steps: string[] } {
  if (source === saved) return { kind: "clean" };
  if (plan.error) return { kind: "invalid", message: plan.error };
  return plan.steps.length ? { kind: "changes", steps: plan.steps } : { kind: "no-op" };
}

/** Adapter settings that belong to the instructions and skills sections instead. */
export const OWNED_ADAPTER_KEYS = ["paperclipSkillSync", "instructionsBundleMode", "instructionsRootPath", "instructionsEntryFile", "instructionsFilePath"] as const;
export const equal = (a: unknown, b: unknown) => canonicalAgentConfiguration(a) === canonicalAgentConfiguration(b);
const jsonValue = <T>(value: T): T => JSON.parse(JSON.stringify(value));

async function mapBounded<T, R>(items: T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, 4) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await read(items[index]!);
      }
    }),
  );
  return results;
}

function unique(values: string[], field: string) {
  if (new Set(values).size !== values.length) throw new Error(`${field} contains duplicate entries.`);
}

function requireItem<T>(items: readonly T[], matches: (item: T) => boolean, label: string): T {
  const item = items.find(matches);
  if (!item) throw new Error(`${label} is not in this agent’s saved configuration. Reload before editing it.`);
  return item;
}

function requireExplicitFields(before: object, after: object, path: string) {
  for (const [key, value] of Object.entries(before)) {
    if (value !== undefined && !Object.hasOwn(after, key)) {
      throw new Error(`Keep ${path}.${key} explicit; use null, false, an empty string, or an empty list to clear it where supported.`);
    }
  }
}

export function profileConfiguration(profile: ToolProfileWithDetails) {
  return {
    profileKey: profile.profileKey,
    name: profile.name,
    description: profile.description,
    status: profile.status,
    defaultAction: profile.defaultAction,
    metadata: profile.metadata,
    entries: profile.entries.map(({ selectorType, effect, applicationId, connectionId, catalogEntryId, toolName, riskLevel, conditions }) => ({
      selectorType,
      effect,
      applicationId,
      connectionId,
      catalogEntryId,
      toolName,
      riskLevel,
      conditions,
    })),
  };
}

function policyConfiguration(policy: ToolPolicy) {
  const { name, description, policyType, priority, enabled, selectors, conditions, config } = policy;
  return { name, description, policyType, priority, enabled, selectors, conditions, config };
}

function policyAgentIds(policy: { selectors: Record<string, unknown> }): string[] {
  return [policy.selectors.agentId, policy.selectors.agentIds].flatMap((value) =>
    Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : typeof value === "string" ? [value] : [],
  );
}

// ---------------------------------------------------------------------------------------------
// Load

export async function loadAgentConfiguration(client: ConfigurationClient, id: string, companyId: string) {
  const core = await client.agents.getConfiguration(id, companyId);
  const [agent, bundle, skills, connections, profiles, policies, endpoints, keys, revisions, secrets, proposals] = await Promise.all([
    client.agents.get(id, companyId),
    client.agents.instructionsBundle(id, companyId),
    client.agents.skills(id, companyId),
    client.tools.listConnections(companyId),
    client.tools.listProfiles(companyId),
    client.tools.listPolicies(companyId),
    client.channels.list(companyId),
    client.agents.listKeys(id, companyId),
    client.agents.listConfigRevisions(id, companyId),
    client.secrets.list(companyId),
    client.secrets.listProposals(companyId),
  ]);
  const [files, channels] = await Promise.all([
    mapBounded(
      bundle.files.filter((file) => file.editable && !file.binary && !file.virtual),
      (file) => client.agents.instructionsFile(id, file.path, companyId),
    ),
    mapBounded(
      endpoints.filter((endpoint) => endpoint.assignedAgentId === id && endpoint.status !== "archived"),
      async (endpoint) => {
        const [detail, resources, principals] = await Promise.all([
          client.channels.get(endpoint.id),
          client.channels.listResources(endpoint.id),
          client.channels.listPrincipals(endpoint.id),
        ]);
        if (detail.assignedAgentId !== id || detail.companyId !== companyId) throw new Error("Channel ownership changed. Reload configuration.");
        return { detail, resources, principals };
      },
    ),
  ]);
  const adapterConfig = { ...core.adapterConfig };
  for (const key of OWNED_ADAPTER_KEYS) delete adapterConfig[key];
  const directPolicies = policies.policies.filter((policy) => {
    const ids = policyAgentIds(policy);
    return ids.length > 0 && ids.every((value) => value === id);
  });
  const directProfiles = profiles.profiles.flatMap((profile) => {
    const binding = profile.bindings.find((each) => each.targetType === "agent" && each.targetId === id);
    return binding
      ? [{ profileId: profile.id, updateSharedDefinition: false, priority: binding.priority, metadata: binding.metadata, configuration: profileConfiguration(profile) }]
      : [];
  });
  const document = jsonValue({
    apiVersion: "paperclip/v1",
    kind: "Agent",
    spec: {
      ...agentConfigurationSpec(core),
      adapterConfig,
      permissions: {
        canCreateAgents: Boolean(agent.permissions.canCreateAgents),
        canCreateSkills: agent.permissions.canCreateSkills !== false,
        canAssignTasks: Boolean(agent.access?.canAssignTasks),
        trustPreset: agent.permissions.trustPreset ?? "standard",
        ...(agent.permissions.authorizationPolicy ? { authorizationPolicy: agent.permissions.authorizationPolicy } : {}),
      },
      instructions: {
        mode: bundle.mode,
        rootPath: bundle.rootPath,
        entryFile: bundle.entryFile,
        files: Object.fromEntries(files.map((file) => [file.path, file.content])),
      },
      skills: (skills.desiredSkillEntries ?? skills.desiredSkills.map((key) => ({ key, versionId: null }))).map((skill) => ({
        ...skill,
        versionId: skill.versionId ?? null,
      })),
      tools: {
        connections: connections.connections.flatMap((connection) =>
          (connection.installs ?? []).some((install) => install.targetType === "agent" && install.targetId === id)
            ? [{ connectionId: connection.id, installed: true }]
            : [],
        ),
        profiles: directProfiles,
        policies: directPolicies.map((policy) => ({ id: policy.id, configuration: policyConfiguration(policy) })),
      },
      channels: channels.map(({ detail, resources }) => ({
        id: detail.id,
        provider: detail.provider,
        settings: {
          executionDefaults: detail.executionDefaults ?? null,
          ...(detail.provider === "slack" ? { communicationInstructions: detail.communicationInstructions ?? "" } : {}),
          allowUnlinkedPeople: detail.allowUnlinkedPeople,
          ...(detail.allowDirectMessages !== undefined ? { allowDirectMessages: detail.allowDirectMessages } : {}),
          ...(detail.provider === "slack" && detail.requireAtMention !== undefined ? { requireAtMention: detail.requireAtMention } : {}),
          ...(detail.allowGroupChats !== undefined ? { allowGroupChats: detail.allowGroupChats } : {}),
          ...(detail.setup?.slackApp ? { slackApp: detail.setup.slackApp } : {}),
          ...(detail.setup?.slackSetupMethod ? { slackSetupMethod: detail.setup.slackSetupMethod } : {}),
        },
        resources: resources.map((resource) => ({ id: resource.id, enabled: resource.enabled, executionDefaults: resource.executionDefaults ?? null })),
      })),
      apiKeys: { create: [], revoke: [] },
      revisions: { restore: null },
      secrets: { create: [], rotate: [], update: [], proposals: [] },
      channelOperations: { create: [], setup: [], revokeIdentityLinks: [] },
    },
  }) as AgentConfigurationDocument;
  return {
    agent,
    core,
    bundle,
    files: new Map<string, AgentInstructionsFileDetail>(files.map((file) => [file.path, file])),
    connections: connections.connections,
    profiles: profiles.profiles,
    policies: policies.policies,
    channels,
    keys,
    revisions,
    secrets,
    proposals,
    document,
  };
}

export type AgentConfigurationSnapshot = Awaited<ReturnType<typeof loadAgentConfiguration>>;

// ---------------------------------------------------------------------------------------------
// Resolve

/** The edited document filled in from the saved one, as a complete document. */
export function resolveAgentConfiguration(snapshot: AgentConfigurationSnapshot, input: AgentConfigurationInput): AgentConfigurationDocument {
  const document = agentConfigurationInputSchema.parse(input);
  if (document.observed !== undefined && !equal(document.observed, snapshot.document.observed)) {
    throw new Error("observed is read-only. Remove this block and edit spec to change configuration.");
  }
  const before = snapshot.document.spec;
  const spec = { ...before, ...document.spec } as AgentConfigurationDocument["spec"];
  // Legacy instruction text stays out of the document but is kept on adapter edits; other adapter
  // keys are replaced as written.
  if (document.spec.adapterConfig && !Object.hasOwn(document.spec.adapterConfig, "promptTemplate") && Object.hasOwn(before.adapterConfig, "promptTemplate")) {
    spec.adapterConfig = { ...document.spec.adapterConfig, promptTemplate: before.adapterConfig.promptTemplate };
  }
  for (const key of ["permissions", "instructions", "tools", "apiKeys", "secrets", "channelOperations", "revisions"] as const) {
    if (document.spec[key]) Object.assign(spec, { [key]: { ...before[key], ...document.spec[key] } });
  }
  if (document.spec.skills) {
    spec.skills = document.spec.skills.map((skill) =>
      typeof skill === "string" ? { key: skill, versionId: null } : { ...skill, versionId: skill.versionId ?? null },
    );
  }
  if (document.spec.instructions?.files) {
    const files: Record<string, string> = { ...before.instructions?.files };
    for (const [path, content] of Object.entries(document.spec.instructions.files)) {
      const existing = snapshot.bundle.files.find((file) => file.path === path);
      if (existing && (!existing.editable || existing.binary || existing.virtual)) throw new Error(`Instruction file ${path} cannot be edited as text.`);
      if (content === null) delete files[path];
      else files[path] = content;
    }
    spec.instructions = { ...spec.instructions!, files };
  }
  if (document.spec.tools?.connections) {
    spec.tools!.connections = document.spec.tools.connections.map((row) => ({ ...row, installed: row.installed ?? true }));
  }
  if (document.spec.tools?.profiles) {
    spec.tools!.profiles = document.spec.tools.profiles.map((row) => {
      const existing =
        row.profileId || row.profileKey
          ? requireItem(
              snapshot.profiles,
              (profile) => (!row.profileId || profile.id === row.profileId) && (!row.profileKey || profile.profileKey === row.profileKey),
              `Profile ${row.profileKey ?? row.profileId}`,
            )
          : null;
      const binding = before.tools?.profiles.find((profile) => profile.profileId === existing?.id);
      return {
        profileId: existing?.id ?? null,
        updateSharedDefinition: row.updateSharedDefinition ?? false,
        priority: row.priority ?? binding?.priority ?? 100,
        metadata: row.metadata === undefined ? (binding?.metadata ?? null) : row.metadata,
        configuration: (row.configuration ?? (existing ? profileConfiguration(existing) : undefined))!,
      };
    }) as NonNullable<AgentConfigurationDocument["spec"]["tools"]>["profiles"];
  }
  if (document.spec.channels) {
    spec.channels = document.spec.channels.map((row) => {
      const previous = requireItem(before.channels ?? [], (channel) => channel.id === row.id, `Channel ${row.id}`);
      return {
        ...previous,
        ...row,
        settings: { ...previous.settings, ...row.settings },
        resources:
          row.resources?.map((resource) => ({
            ...requireItem(previous.resources, (existing) => existing.id === resource.id, `Channel resource ${resource.id}`),
            ...resource,
          })) ?? previous.resources,
      };
    }) as AgentConfigurationDocument["spec"]["channels"];
  }
  return agentConfigurationDocumentSchema.parse({ ...document, spec, observed: snapshot.document.observed });
}

// ---------------------------------------------------------------------------------------------
// Plan

type Plan = { client: ConfigurationClient; snapshot: AgentConfigurationSnapshot; document: AgentConfigurationDocument; add: AddStep };

function planInstructions({ client, snapshot, document, add }: Plan) {
  const next = document.spec.instructions;
  if (!next) return;
  const previous = snapshot.document.spec.instructions!;
  if (equal(previous, next)) return;
  const { id, companyId } = snapshot.agent;
  if (!snapshot.bundle.editable && !next.mode) throw new Error("Choose managed or external instructions mode before adding files.");
  if (next.mode === null && previous.mode !== null) throw new Error("Choose managed or external instructions mode.");
  if (next.mode === "external" && !next.rootPath?.startsWith("/")) throw new Error("External instructions require an absolute rootPath.");
  if (Object.hasOwn(previous.files, next.entryFile) && !Object.hasOwn(next.files, next.entryFile)) throw new Error("The instructions entry file cannot be removed.");
  for (const path of Object.keys(next.files)) {
    const existing = snapshot.bundle.files.find((file) => file.path === path);
    if (existing && (!existing.editable || existing.binary || existing.virtual)) throw new Error(`Instruction file ${path} cannot be edited as text.`);
  }
  const bundleChanged = previous.mode !== next.mode || previous.rootPath !== next.rootPath || previous.entryFile !== next.entryFile;
  if (bundleChanged) {
    if (!equal(previous.files, next.files)) throw new Error("Save the instructions location or entry file first, then edit the files loaded from that location.");
    if (next.mode === "managed" && previous.mode === "managed" && next.rootPath !== previous.rootPath) {
      throw new Error("The managed instructions root is assigned by Paperclip. Choose external mode to use another folder.");
    }
    add("Instructions location (load the destination files)", () =>
      client.agents.updateInstructionsBundle(id, { ...(next.mode ? { mode: next.mode } : {}), rootPath: next.rootPath, entryFile: next.entryFile }, companyId),
    );
    return;
  }
  for (const [path, content] of Object.entries(next.files)) {
    if (previous.files[path] === content) continue;
    add(`Instructions: ${path}`, () => {
      const file = snapshot.files.get(path);
      if (file?.content === content) return Promise.resolve();
      return client.agents.saveInstructionsFile(
        id,
        { path, content, baseHash: file?.contentHash ?? null, baseRevisionId: file?.revision?.id ?? null },
        companyId,
      );
    });
  }
  for (const path of Object.keys(previous.files)) {
    if (Object.hasOwn(next.files, path)) continue;
    add(`Remove instruction file: ${path}`, async () => {
      const file = snapshot.files.get(path);
      if (!file) return;
      return client.agents.deleteInstructionsFile(id, path, companyId, file.contentHash);
    });
  }
}

function planSecrets({ client, snapshot, document, add }: Plan, receipt: (value: ConfigurationReceipt) => void) {
  const next = document.spec.secrets;
  if (!next) return;
  const { id, companyId } = snapshot.agent;
  unique(next.rotate.map((row) => row.id), "secrets.rotate");
  unique(next.update.map((row) => row.id), "secrets.update");
  unique(next.proposals.map((row) => row.id), "secrets.proposals");
  unique(next.create.map((row) => row.secret.key ?? row.secret.name), "secrets.create");
  for (const operation of [...next.rotate, ...next.update]) requireItem(snapshot.secrets, (secret) => secret.id === operation.id, `Secret ${operation.id}`);
  unique(next.create.flatMap((operation) => operation.bind.env), "secrets.create.bind.env");
  unique(next.create.flatMap((operation) => operation.bind.api), "secrets.create.bind.api");
  const env = (config: Record<string, unknown>) =>
    config.env && typeof config.env === "object" && !Array.isArray(config.env) ? (config.env as Record<string, unknown>) : {};
  const savedConfig = snapshot.document.spec.adapterConfig;
  for (const operation of next.create) {
    for (const key of operation.bind.env) {
      if (!equal(env(document.spec.adapterConfig)[key], env(savedConfig)[key])) throw new Error(`Set env.${key} either in adapterConfig or secrets.create.bind, not both in one save.`);
    }
    for (const alias of operation.bind.api) {
      if (!equal(document.spec.adapterConfig[`access.${alias}`], savedConfig[`access.${alias}`])) {
        throw new Error(`Set access.${alias} either in adapterConfig or secrets.create.bind, not both in one save.`);
      }
    }
    const assertBindingsCurrent = (config: Record<string, unknown>) => {
      for (const key of operation.bind.env) if (!equal(env(config)[key], env(savedConfig)[key])) throw new Error(`env.${key} changed before secret binding. Reload saved before saving.`);
      for (const alias of operation.bind.api) {
        if (!equal(config[`access.${alias}`], savedConfig[`access.${alias}`])) throw new Error(`access.${alias} changed before secret binding. Reload saved before saving.`);
      }
    };
    add(`Create secret: ${operation.secret.name}`, async () => {
      if (operation.bind.env.length || operation.bind.api.length) assertBindingsCurrent((await client.agents.getConfiguration(id, companyId)).adapterConfig);
      const created = await client.secrets.create(companyId, operation.secret);
      receipt({ label: `Secret: ${created.name}`, id: created.id });
      if (!operation.bind.env.length && !operation.bind.api.length) return;
      const current = await client.agents.getConfiguration(id, companyId);
      assertBindingsCurrent(current.adapterConfig);
      const adapterConfig: Record<string, unknown> = { ...current.adapterConfig };
      const binding = { type: "secret_ref", secretId: created.id, version: "latest" };
      if (operation.bind.env.length) {
        adapterConfig.env = { ...((adapterConfig.env as Record<string, unknown>) ?? {}), ...Object.fromEntries(operation.bind.env.map((key) => [key, binding])) };
      }
      for (const alias of operation.bind.api) adapterConfig[`access.${alias}`] = binding;
      await client.agents.update(id, { adapterConfig, replaceAdapterConfig: true, expectedConfigurationRevision: current.configurationRevision }, companyId);
    });
  }
  for (const operation of next.rotate) add(`Rotate secret: ${operation.id}`, () => client.secrets.rotate(operation.id, operation.input));
  for (const operation of next.update) add(`Update secret: ${operation.id}`, () => client.secrets.update(operation.id, operation.input));
  for (const operation of next.proposals) {
    requireItem(
      snapshot.proposals,
      (proposal) => proposal.id === operation.id && (proposal.target?.id === id || proposal.proposedBy.id === id),
      `Secret proposal ${operation.id}`,
    );
    if (operation.decision === "reject" && !operation.reason?.trim()) throw new Error("A rejected secret proposal requires a reason.");
    add(`Secret proposal: ${operation.id}`, () =>
      operation.decision === "approve"
        ? client.secrets.approveProposal(companyId, operation.id)
        : client.secrets.rejectProposal(companyId, operation.id, { reason: operation.reason! }),
    );
  }
}

function planTools({ client, snapshot, document, add }: Plan) {
  const next = document.spec.tools;
  if (!next) return;
  const before = snapshot.document.spec.tools!;
  const { id: agentId, companyId } = snapshot.agent;
  unique(next.connections.map((row) => row.connectionId), "tools.connections");
  unique(next.profiles.flatMap((row) => (row.profileId ? [row.profileId] : [])), "tools.profiles");
  unique(next.policies.flatMap((row) => (row.id ? [row.id] : [])), "tools.policies");
  for (const row of next.connections) requireItem(snapshot.connections, (connection) => connection.id === row.connectionId, `Connection ${row.connectionId}`);
  const connectionIds = new Set([...before.connections, ...next.connections].map((row) => row.connectionId));
  for (const connectionId of connectionIds) {
    const previous = before.connections.find((row) => row.connectionId === connectionId) ?? { connectionId, installed: false };
    const installed = next.connections.find((row) => row.connectionId === previous.connectionId)?.installed ?? false;
    if (installed === previous.installed) continue;
    const connection = snapshot.connections.find((row) => row.id === previous.connectionId)!;
    if (connection.installs?.some((row) => row.targetType === "company")) {
      throw new Error(`${connection.name} is installed organization-wide. Its inherited installation cannot be overridden for one agent.`);
    }
    add(`Tool installation: ${connection.name}`, async () => {
      const current = await client.tools.getConnectionInstalls(connection.id);
      if (
        current.installs.some((row) => row.targetType === "company") ||
        current.installs.some((row) => row.targetType === "agent" && row.targetId === agentId) !== previous.installed
      ) {
        throw new Error(`Installation for ${connection.name} changed. Reload before saving.`);
      }
      const installs = current.installs
        .filter((row) => !(row.targetType === "agent" && row.targetId === agentId))
        .map(({ targetType, targetId }) => ({ targetType, targetId }));
      if (installed) installs.push({ targetType: "agent", targetId: agentId });
      return client.tools.putConnectionInstalls(connection.id, installs);
    });
  }
  for (const row of next.profiles) {
    const existing = row.profileId ? requireItem(snapshot.profiles, (profile) => profile.id === row.profileId, `Profile ${row.profileId}`) : null;
    const previous = before.profiles.find((profile) => profile.profileId === row.profileId);
    if (previous && equal({ ...previous, updateSharedDefinition: false }, { ...row, updateSharedDefinition: false })) continue;
    if (existing) {
      requireExplicitFields(profileConfiguration(existing), row.configuration, `tools.profiles.${row.profileId}.configuration`);
      const shared = existing.bindings.some((binding) => binding.targetType !== "agent" || binding.targetId !== agentId);
      if (shared && !equal(profileConfiguration(existing), row.configuration) && !row.updateSharedDefinition) {
        throw new Error(
          `Profile ${existing.name} is shared with other targets. Set updateSharedDefinition: true to change its shared definition, or create a separate profile with profileId: null.`,
        );
      }
    }
    add(`Tool profile${row.updateSharedDefinition ? " (shared definition)" : ""}: ${row.configuration.name}`, async () => {
      let profileId = row.profileId;
      if (!profileId) profileId = (await client.tools.createProfile(companyId, row.configuration)).id;
      else if (existing && !equal(profileConfiguration(existing), row.configuration)) await client.tools.updateProfile(profileId, row.configuration);
      return client.tools.bindProfile(companyId, profileId, { targetType: "agent", targetId: agentId, priority: row.priority, metadata: row.metadata });
    });
  }
  for (const previous of before.profiles) {
    if (!next.profiles.some((row) => row.profileId === previous.profileId)) {
      add(`Unbind tool profile: ${previous.configuration.name}`, () =>
        client.tools.unbindProfile(companyId, previous.profileId!, { targetType: "agent", targetId: agentId }),
      );
    }
  }
  for (const row of next.policies) {
    const previous = row.id ? requireItem(before.policies, (policy) => policy.id === row.id, `Agent policy ${row.id}`) : null;
    if (previous) requireExplicitFields(previous.configuration, row.configuration, `tools.policies.${row.id}.configuration`);
    const agents = policyAgentIds(row.configuration as { selectors: Record<string, unknown> });
    if (agents.some((value) => value !== agentId)) throw new Error("tools.policies must be scoped only to this agent.");
    const selectors: Record<string, unknown> = { ...row.configuration.selectors, agentIds: [agentId] };
    delete selectors.agentId;
    const configuration = { ...row.configuration, selectors } as typeof row.configuration;
    if (previous && equal(previous.configuration, row.configuration)) continue;
    add(`Tool policy: ${configuration.name}`, () =>
      row.id ? client.tools.updatePolicy(companyId, row.id, configuration) : client.tools.createPolicy(companyId, configuration),
    );
  }
  for (const previous of before.policies) {
    if (!next.policies.some((row) => row.id === previous.id)) {
      add(`Remove tool policy: ${previous.configuration.name}`, () => client.tools.deletePolicy(companyId, previous.id!));
    }
  }
}

function planChannels({ client, snapshot, document, add }: Plan) {
  const { id: agentId, companyId } = snapshot.agent;
  const before = snapshot.document.spec.channels!;
  const next = document.spec.channels;
  if (next) {
    unique(next.map((row) => row.id), "channels");
    for (const row of next) {
      const previous = requireItem(before, (channel) => channel.id === row.id, `Channel ${row.id}`);
      if (row.provider !== previous.provider) throw new Error("A channel provider cannot be changed. Create a new channel instead.");
      unique(row.resources.map((resource) => resource.id), `channels.${row.id}.resources`);
      for (const resource of row.resources) {
        const existing = requireItem(previous.resources, (value) => value.id === resource.id, `Channel resource ${resource.id}`);
        requireExplicitFields(existing, resource, `channels.${row.id}.resources.${resource.id}`);
      }
      if (!equal(previous.settings, row.settings)) {
        requireExplicitFields(previous.settings, row.settings, `channels.${row.id}.settings`);
        const changes = Object.fromEntries(
          Object.entries(row.settings).filter(([key, value]) => !equal(value, previous.settings[key as keyof typeof previous.settings])),
        );
        add(`Channel settings: ${row.id}`, () => client.channels.update(row.id, changes));
      }
      const resources = previous.resources.map((resource) => row.resources.find((value) => value.id === resource.id) ?? { ...resource, enabled: false });
      if (!equal(previous.resources, resources)) add(`Channel resources: ${row.id}`, () => client.channels.updateResources(row.id, resources));
    }
    for (const previous of before) {
      if (!next.some((row) => row.id === previous.id)) add(`Remove channel: ${previous.id}`, () => client.channels.setup(previous.id, { action: "remove" }));
    }
  }
  const operations = document.spec.channelOperations;
  if (!operations) return;
  unique(operations.setup.map((row) => row.id), "channelOperations.setup");
  for (const input of operations.create) {
    add(`Create ${input.provider} channel`, () => client.channels.create(companyId, { ...input, assignedAgentId: agentId }));
  }
  for (const operation of operations.setup) {
    const previous = requireItem(before, (channel) => channel.id === operation.id, `Channel ${operation.id}`);
    if (operation.input.action === "remove" && next && !equal(next.find((row) => row.id === operation.id), previous)) {
      throw new Error(`Channel ${operation.id} cannot be edited and removed in the same save.`);
    }
    if (next && !next.some((row) => row.id === operation.id)) throw new Error(`Channel ${operation.id} is both removed and configured.`);
    add(`Channel ${operation.input.action}: ${operation.id}`, () => client.channels.setup(operation.id, operation.input));
  }
  unique(operations.revokeIdentityLinks.map((row) => `${row.endpointId}/${row.principalId}`), "channelOperations.revokeIdentityLinks");
  for (const operation of operations.revokeIdentityLinks) {
    if (
      (next && !next.some((row) => row.id === operation.endpointId)) ||
      operations.setup.some((row) => row.id === operation.endpointId && row.input.action === "remove")
    ) {
      throw new Error(`Channel ${operation.endpointId} cannot be removed and have its identities edited in the same save.`);
    }
    const channel = requireItem(snapshot.channels, (row) => row.detail.id === operation.endpointId, `Channel ${operation.endpointId}`);
    requireItem(channel.principals, (row) => row.principalId === operation.principalId, `Identity ${operation.principalId}`);
    add(`Revoke channel identity: ${operation.principalId}`, () => client.channels.revokeLink(operation.endpointId, operation.principalId));
  }
}

function planResolved(
  client: ConfigurationClient,
  snapshot: AgentConfigurationSnapshot,
  document: AgentConfigurationDocument,
  receipt: (value: ConfigurationReceipt) => void,
): ConfigurationStep[] {
  const steps: ConfigurationStep[] = [];
  const add: AddStep = (label, apply) => {
    steps.push({ label, apply });
  };
  const plan: Plan = { client, snapshot, document, add };
  const { id, companyId } = snapshot.agent;
  if (!equal(document.observed, snapshot.document.observed)) throw new Error("observed is read-only. Edit spec to change configuration.");
  for (const key of OWNED_ADAPTER_KEYS) {
    if (Object.hasOwn(document.spec.adapterConfig, key)) {
      throw new Error(`Use the ${key === "paperclipSkillSync" ? "skills" : "instructions"} section instead of adapterConfig.${key}.`);
    }
  }
  const adapterConfig = { ...document.spec.adapterConfig };
  for (const key of OWNED_ADAPTER_KEYS) if (Object.hasOwn(snapshot.core.adapterConfig, key)) adapterConfig[key] = snapshot.core.adapterConfig[key];
  const corePatch = agentConfigurationPatch({ ...document, spec: { ...document.spec, adapterConfig } }, snapshot.core);
  if (Object.keys(corePatch).length) {
    const fields = Object.keys(corePatch).filter((key) => key !== "replaceAdapterConfig");
    add(`Agent configuration: ${fields.join(", ")}`, () => client.agents.update(id, { ...corePatch, expectedConfigurationRevision: snapshot.core.configurationRevision }, companyId));
  }
  const permissions = document.spec.permissions;
  if (permissions && !permissions.canAssignTasks && (document.spec.role === "ceo" || permissions.canCreateAgents)) {
    throw new Error("CEO agents and agents that can create agents also have task assignment authority. Set canAssignTasks to true.");
  }
  planInstructions(plan);
  if (document.spec.skills && !equal(document.spec.skills, snapshot.document.spec.skills)) {
    unique(document.spec.skills.map((skill) => (typeof skill === "string" ? skill : skill.key)), "skills");
    add("Skills and version pins", () => client.agents.syncSkills(id, document.spec.skills!, "replace", companyId));
  }
  planTools(plan);
  planChannels(plan);
  planSecrets(plan, receipt);
  if (permissions && !equal(permissions, snapshot.document.spec.permissions)) {
    add("Permissions and trust", () =>
      client.agents.updatePermissions(id, { ...permissions, authorizationPolicy: permissions.authorizationPolicy ?? {} }, companyId),
    );
  }
  const keys = document.spec.apiKeys;
  if (keys) {
    unique(keys.revoke, "apiKeys.revoke");
    unique(keys.create.map((key) => key.name), "apiKeys.create");
    for (const keyId of keys.revoke) {
      const key = requireItem(snapshot.keys, (each) => each.id === keyId, `API key ${keyId}`);
      if (!key.revokedAt) add(`Revoke API key: ${key.name}`, () => client.agents.revokeKey(id, keyId, companyId));
    }
    for (const input of keys.create) {
      add(`Create API key: ${input.name}`, async () => {
        const key = await client.agents.createKey(id, input.name, companyId, input.scope);
        receipt({ label: `API key: ${key.name}`, id: key.id, token: key.token });
      });
    }
  }
  const restore = document.spec.revisions?.restore;
  if (restore) {
    requireItem(snapshot.revisions, (revision) => revision.id === restore, `Revision ${restore}`);
    if (steps.length) throw new Error("Restore a revision in its own save, then edit the restored configuration.");
    add("Restore configuration revision", () => client.agents.rollbackConfigRevision(id, restore, companyId));
  }
  return steps;
}

/** The steps a save would run, in order, or throws with why the document can't be saved. */
export function planAgentConfiguration(
  client: ConfigurationClient,
  snapshot: AgentConfigurationSnapshot,
  input: AgentConfigurationInput,
  receipt: (value: ConfigurationReceipt) => void = () => {},
) {
  return planResolved(client, snapshot, resolveAgentConfiguration(snapshot, input), receipt);
}

// ---------------------------------------------------------------------------------------------
// Save

const SECTIONS = ["permissions", "instructions", "skills", "tools", "channels"] as const;

/**
 * Saves the document and returns the refreshed snapshot. Refuses before writing anything when the
 * agent or an edited section changed since `snapshot` was loaded. `onReceipt` gets each created key's
 * one-time token and each created secret's id as they happen; `onProgress` the step being run.
 */
export async function saveAgentConfiguration(
  client: ConfigurationClient,
  snapshot: AgentConfigurationSnapshot,
  input: AgentConfigurationInput,
  onReceipt: (receipt: ConfigurationReceipt) => void,
  onProgress: (label: string) => void,
) {
  const { id, companyId } = snapshot.agent;
  const document = resolveAgentConfiguration(snapshot, input);
  const initialPlan = planResolved(client, snapshot, document, onReceipt);
  if (!initialPlan.length) return snapshot;
  const current = await loadAgentConfiguration(client, id, companyId);
  if (current.core.configurationRevision !== snapshot.core.configurationRevision) {
    throw new Error("Agent configuration changed while you were editing. Reload saved before saving.");
  }
  for (const key of SECTIONS) {
    if (
      document.spec[key] !== undefined &&
      !equal(document.spec[key], snapshot.document.spec[key]) &&
      !equal(current.document.spec[key], snapshot.document.spec[key])
    ) {
      throw new Error(`${key} changed while you were editing. Reload saved before saving.`);
    }
  }
  const spec = { ...document.spec };
  for (const key of SECTIONS) {
    if (equal(document.spec[key], snapshot.document.spec[key])) Object.assign(spec, { [key]: current.document.spec[key] });
  }
  for (const operation of [...(document.spec.secrets?.rotate ?? []), ...(document.spec.secrets?.update ?? [])]) {
    const previous = snapshot.secrets.find((secret) => secret.id === operation.id);
    if (!equal(previous, current.secrets.find((secret) => secret.id === operation.id))) throw new Error(`Secret ${operation.id} changed. Reload saved before saving.`);
  }
  for (const profile of document.spec.tools?.profiles ?? []) {
    if (!profile.profileId) continue;
    const originalRow = snapshot.document.spec.tools?.profiles.find((value) => value.profileId === profile.profileId);
    if (originalRow && equal(originalRow, profile)) continue;
    const before = snapshot.profiles.find((value) => value.id === profile.profileId);
    const fresh = current.profiles.find((value) => value.id === profile.profileId);
    if (!equal(before, fresh)) throw new Error(`Tool profile ${profile.profileId} changed while you were editing. Reload saved before saving.`);
  }
  const steps = planResolved(client, current, { ...document, spec, observed: current.document.observed }, onReceipt);
  const completed: string[] = [];
  const warnings: AgentConfigurationWarning[] = [];
  for (const step of steps) {
    onProgress(step.label);
    try {
      const result = await step.apply();
      if (result && typeof result === "object" && "configurationWarnings" in result && Array.isArray(result.configurationWarnings)) {
        warnings.push(...(result.configurationWarnings as AgentConfigurationWarning[]));
      }
      completed.push(step.label);
    } catch (cause) {
      throw new ConfigurationSaveInterrupted(step.label, completed, cause);
    }
  }
  try {
    const refreshed = await loadAgentConfiguration(client, id, companyId);
    if (warnings.length) refreshed.agent = { ...refreshed.agent, configurationWarnings: warnings };
    return refreshed;
  } catch (cause) {
    throw new ConfigurationSaveInterrupted("refreshing the saved configuration", completed, cause);
  }
}
