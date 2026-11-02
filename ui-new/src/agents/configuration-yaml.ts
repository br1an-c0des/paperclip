import {
  agentConfigurationInputSchema,
  agentConfigurationSpec,
  canonicalAgentConfiguration,
  type AgentConfigurationDocument,
  type AgentConfigurationInput,
  type AgentConfigurationSource,
} from "@paperclipai/shared";
import { isAlias, parseDocument, stringify, visit } from "yaml";

/*
 * The agent's `paperclip/v1` YAML document as text: reading it strictly (YAML 1.2, one document, no
 * anchors, aliases, tags or merge keys, JSON-compatible values only, then the shared package's
 * schema, which rejects unknown fields), writing it, and the compact form the editor shows. Ported
 * from the old UI (ui/src/lib/agent-configuration-yaml.ts and agent-configuration/compact.ts).
 *
 * The compact form leaves out what can be left out: empty fields, defaults, instruction file
 * contents, legacy prompt text and the empty operation lists. Omitted sections are kept as saved,
 * so a document with only `title` changes only the title.
 */

export function serializeAgentConfiguration(agent: AgentConfigurationSource): string {
  return serializeAgentConfigurationDocument({
    apiVersion: "paperclip/v1",
    kind: "Agent",
    spec: agentConfigurationSpec(agent),
  } as AgentConfigurationDocument);
}

export function serializeAgentConfigurationDocument(document: AgentConfigurationDocument | AgentConfigurationInput): string {
  return stringify(document, { lineWidth: 0, aliasDuplicateObjects: false });
}

const MAX_BYTES = 8 * 1024 * 1024;
const RESERVED_KEYS = ["__proto__", "constructor", "prototype", "<<"];

function assertJson(value: unknown, depth = 0): void {
  if (depth > 50) throw new Error("Configuration nesting must not exceed 50 levels.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((item) => assertJson(item, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (RESERVED_KEYS.includes(key)) throw new Error(`Unsupported configuration key: ${key}`);
      assertJson(item, depth + 1);
    }
    return;
  }
  throw new Error("Configuration must contain only JSON-compatible values (no NaN or infinity).");
}

/** Reads the editor's text into a validated document, or throws with what's wrong (one line per problem). */
export function parseAgentConfigurationYaml(source: string): AgentConfigurationInput {
  if (source.length > MAX_BYTES || new TextEncoder().encode(source).byteLength > MAX_BYTES) {
    throw new Error("Configuration must be smaller than 8 MiB.");
  }
  const document = parseDocument(source, { version: "1.2", schema: "core", uniqueKeys: true, stringKeys: true });
  const problem = document.errors[0] ?? document.warnings[0];
  if (problem) throw new Error(problem.message);
  if (document.directives?.yaml.version !== "1.2") throw new Error("Use YAML 1.2.");
  visit(document, (_key, node) => {
    if (isAlias(node)) throw new Error("YAML aliases are not supported. Write each value explicitly.");
    if (node && typeof node === "object" && "anchor" in node && node.anchor) throw new Error("YAML anchors are not supported.");
    if (node && typeof node === "object" && "tag" in node && node.tag) throw new Error("YAML tags are not supported.");
  });
  const value: unknown = document.toJS({ maxAliasCount: 0 });
  assertJson(value);
  const parsed = agentConfigurationInputSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`).join("\n"));
  }
  return parsed.data;
}

/** The `PATCH /agents/:id` body for the agent's own fields that changed: only those, compared by value. */
export function agentConfigurationPatch(document: AgentConfigurationInput, saved: AgentConfigurationSource) {
  const before = agentConfigurationSpec(saved);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(before) as Array<keyof typeof before>) {
    if (!Object.hasOwn(document.spec, key)) continue;
    const value = document.spec[key];
    if (canonicalAgentConfiguration(value) !== canonicalAgentConfiguration(before[key])) patch[key] = value;
  }
  if (Object.hasOwn(patch, "adapterConfig")) patch.replaceAdapterConfig = true;
  return patch;
}

const nonempty = (value: unknown) =>
  value !== null && value !== undefined && (typeof value !== "object" || Object.keys(value).length > 0);

/** The document the editor shows: the full one with every default, empty field and file body left out. */
export function compactAgentConfiguration(document: AgentConfigurationDocument): AgentConfigurationInput {
  const spec: AgentConfigurationInput["spec"] = { ...document.spec };
  if (spec.adapterConfig && Object.hasOwn(spec.adapterConfig, "promptTemplate")) {
    spec.adapterConfig = { ...spec.adapterConfig };
    delete spec.adapterConfig.promptTemplate;
  }
  for (const key of ["title", "icon", "reportsTo", "capabilities", "defaultEnvironmentId", "metadata", "adapterConfig", "runtimeConfig"] as const) {
    if (!nonempty(spec[key])) delete spec[key];
  }
  if (spec.budgetMonthlyCents === 0) delete spec.budgetMonthlyCents;
  if (spec.permissions) {
    const defaults: Record<string, unknown> = { canCreateAgents: false, canCreateSkills: true, canAssignTasks: false, trustPreset: "standard" };
    spec.permissions = Object.fromEntries(
      Object.entries(spec.permissions).filter(([key, value]) => value !== defaults[key] && nonempty(value)),
    );
    if (!Object.keys(spec.permissions).length) delete spec.permissions;
  }
  if (spec.instructions?.mode) {
    spec.instructions = {
      mode: spec.instructions.mode,
      ...(spec.instructions.mode === "external" ? { rootPath: spec.instructions.rootPath } : {}),
      entryFile: spec.instructions.entryFile,
    };
  } else if (document.spec.adapterConfig.promptTemplate && spec.instructions) {
    spec.instructions = { entryFile: spec.instructions.entryFile };
  } else delete spec.instructions;
  if (spec.skills?.length) spec.skills = spec.skills.map((skill) => (typeof skill === "string" || skill.versionId ? skill : skill.key));
  else delete spec.skills;
  const tools = document.spec.tools;
  if (tools) {
    spec.tools = {
      ...(tools.connections.some((row) => row.installed)
        ? { connections: tools.connections.filter((row) => row.installed).map((row) => ({ connectionId: row.connectionId })) }
        : {}),
      ...(tools.profiles.length
        ? {
            profiles: tools.profiles.map((row) => ({
              ...(row.configuration.profileKey ? { profileKey: row.configuration.profileKey } : { profileId: row.profileId }),
              ...(row.priority !== 100 ? { priority: row.priority } : {}),
              ...(nonempty(row.metadata) ? { metadata: row.metadata } : {}),
            })),
          }
        : {}),
      ...(tools.policies.length ? { policies: tools.policies } : {}),
    };
    if (!Object.keys(spec.tools).length) delete spec.tools;
  }
  if (spec.channels?.length) {
    spec.channels = spec.channels.map((row) => {
      const settings = Object.fromEntries(Object.entries(row.settings ?? {}).filter(([, value]) => nonempty(value) && value !== ""));
      const resources = row.resources
        ?.filter((resource) => resource.enabled)
        .map((resource) => ({ id: resource.id, enabled: true, ...(resource.executionDefaults ? { executionDefaults: resource.executionDefaults } : {}) }));
      return {
        id: row.id,
        provider: row.provider,
        ...(Object.keys(settings).length ? { settings } : {}),
        ...(resources?.length ? { resources } : {}),
      };
    });
  } else delete spec.channels;
  for (const key of ["apiKeys", "secrets", "channelOperations", "revisions"] as const) {
    if (!spec[key]) continue;
    const operations = Object.fromEntries(Object.entries(spec[key]).filter(([, value]) => nonempty(value)));
    if (Object.keys(operations).length) Object.assign(spec, { [key]: operations });
    else delete spec[key];
  }
  return { apiVersion: document.apiVersion, kind: document.kind, spec };
}
