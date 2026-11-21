import { and, asc, eq } from "drizzle-orm";
import {
  environments,
  instanceSettings,
  projects,
  toolConnections,
  type Db,
  type agents,
} from "@paperclipai/db";
import {
  aiRuntimeConnectionBindingSchema,
  envBindingSchema,
  type ClaudeRunPreview,
  type ClaudeRunPreviewBlocker,
  type ClaudeRunPreviewCheckout,
  type ClaudeRunPreviewManifest,
} from "@paperclipai/shared";
import type { AdapterRuntimeMcpServer } from "@paperclipai/adapter-utils";
import { readPaperclipSkillSyncPreference, type PaperclipSkillEntry } from "@paperclipai/adapter-utils/server-utils";
import { resolveClaudeExecutionEngine } from "@paperclipai/adapter-claude-local/server";
import { findActiveServerAdapter } from "../adapters/index.js";
import { localAgentJwtAvailable } from "../agent-auth-jwt.js";
import { notFound } from "../errors.js";
import { resolveDefaultAgentWorkspaceDir } from "../home-paths.js";
import { assertManagedAiProjectAuth, describeManagedAiRuntime, stripAiAuthBindings } from "./ai-connection-runtime.js";
import { companySkillService, RUNTIME_SKILL_PENDING_MATERIALIZATION_DETAIL } from "./company-skills.js";
import { applyConnectorSkills, resolveConnectorAssignments } from "./connector-runtime.js";
import { ASSIGNED_MCP_SERVER_NAME } from "./mcp-tool-names.js";
import { skillVersionSelectionMap } from "./runtime-skill-selections.js";
import { secretService } from "./secrets.js";
import { resolveCoreTrustPreset } from "./trust-preset-resolver.js";
import { readProjectRepoSwitches, readRunAgentAccess } from "./heartbeat/claude-run-context.js";
import { orderRunMcpServers, paperclipRunMcpServers } from "./heartbeat/paperclip-run-mcp.js";
import {
  ConfigurationIncompleteFailure,
  configuredPaperclipApiBaseUrl,
  createAdapterRuntimeMcpAccess,
  findRuntimeMcpAssignmentGateway,
  plannedRuntimeToolsMcpEndpoint,
  resolveExecutionRunAdapterConfig,
  resolveRuntimeMcpAssignment,
} from "./heartbeat/run-preparation.js";
import { resolveRunGitHub } from "./heartbeat/sealed-run-github.js";
import { previewProjectCheckout, stripWorkspaceRuntimeFromExecutionRunConfig } from "./heartbeat/workspaces.js";

/**
 * What an agent's runs get, before any run (fork/step-4b-parts-2-3.md, part 2): the next sealed
 * `claude_local` CLI launch's manifest, for a fresh run on a task in a chosen project or in none.
 *
 * It resolves what `executeRun` resolves for a run, through the same functions where they're
 * read-only and through read-only paths of the ones that aren't, then hands the result to the
 * adapter's `previewRun`, which plans the launch with the same code as a real one and stops
 * before acting. Nothing is started, written or minted: no files under the instance folder, no
 * run token, MCP bearer or gateway, no database writes, and no secret or credential decrypted
 * (their values are placeholders; only the names of variables reach the manifest).
 */

type AgentRow = Pick<
  typeof agents.$inferSelect,
  "id" | "companyId" | "name" | "title" | "adapterType" | "adapterConfig" | "runtimeConfig" | "permissions" | "defaultEnvironmentId"
>;

/** Stands in for a secret's value, which a preview never reads. */
export const PREVIEW_SECRET_VALUE = "<secret: read at launch>";
/** Stands in for a bearer token a preview never mints. */
const PREVIEW_BEARER_TOKEN = "<token: minted at launch>";
/** The assigned-tools gateway's id when no run has made it yet. */
const PREVIEW_GATEWAY_ID = "(made at the first run)";

type ExecutionRunConfigInput = Parameters<typeof resolveExecutionRunAdapterConfig>[0];

/**
 * A secrets resolver that names each secret instead of reading it: every bound variable gets a
 * placeholder value. Missing bindings are still found (the real, read-only checks), so a run that
 * would stop at a missing secret shows a blocker.
 */
function previewSecretResolver(db: Db): ExecutionRunConfigInput["secretsSvc"] {
  const real = secretService(db);
  const placeholderEnv = (envValue: unknown) => {
    const env: Record<string, string> = {};
    const secretKeys = new Set<string>();
    const record = envValue && typeof envValue === "object" && !Array.isArray(envValue)
      ? envValue as Record<string, unknown>
      : {};
    for (const [key, raw] of Object.entries(record)) {
      const parsed = envBindingSchema.safeParse(raw);
      if (!parsed.success) continue;
      const binding = parsed.data;
      if (typeof binding === "string") env[key] = binding;
      else if (binding.type === "plain") env[key] = binding.value;
      else {
        env[key] = PREVIEW_SECRET_VALUE;
        secretKeys.add(key);
      }
    }
    return { env, secretKeys };
  };
  return {
    collectMissingRuntimeBindings: real.collectMissingRuntimeBindings,
    collectMissingAdapterConfigRuntimeBindings: real.collectMissingAdapterConfigRuntimeBindings,
    resolveEnvBindings: (async (_companyId: string, envValue: unknown) => {
      const { env, secretKeys } = placeholderEnv(envValue);
      return { env, secretKeys, manifest: [] };
    }) as ExecutionRunConfigInput["secretsSvc"]["resolveEnvBindings"],
    resolveAdapterConfigForRuntime: (async (_companyId: string, adapterConfig: Record<string, unknown>) => {
      const config = { ...adapterConfig };
      const { env, secretKeys } = placeholderEnv(adapterConfig.env);
      if (Object.prototype.hasOwnProperty.call(adapterConfig, "env")) config.env = env;
      return { config, secretKeys, manifest: [] };
    }) as ExecutionRunConfigInput["secretsSvc"]["resolveAdapterConfigForRuntime"],
  };
}

function blockerFromError(error: unknown, fallbackCode: string): ClaudeRunPreviewBlocker {
  if (error instanceof ConfigurationIncompleteFailure) {
    const reason = (error.resultJson.configurationIncomplete as { reason?: unknown } | undefined)?.reason;
    return { code: typeof reason === "string" ? reason : "configuration_incomplete", message: error.message };
  }
  const code = (error as { details?: { code?: unknown } } | null)?.details?.code;
  return {
    code: typeof code === "string" ? code : fallbackCode,
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * A skill listed without materializing whose version cache isn't written yet is mounted by the
 * next run, which writes it; any other missing skill stays missing (the run leaves it out).
 */
function asRunWouldMount(entries: PaperclipSkillEntry[]): PaperclipSkillEntry[] {
  return entries.map((entry) =>
    entry.sourceStatus === "missing" && entry.missingDetail === RUNTIME_SKILL_PENDING_MATERIALIZATION_DETAIL
      ? { ...entry, sourceStatus: "available", missingDetail: null }
      : entry);
}

export function runPreviewService(db: Db) {
  const companySkills = companySkillService(db);

  /** The environment a run would use: the agent's default, else the instance's, else local. */
  async function environmentForRun(agent: AgentRow) {
    const [settings] = await db
      .select({ defaultEnvironmentId: instanceSettings.defaultEnvironmentId, experimental: instanceSettings.experimental })
      .from(instanceSettings)
      .where(eq(instanceSettings.singletonKey, "default"))
      .limit(1);
    const environmentId = agent.defaultEnvironmentId ?? settings?.defaultEnvironmentId ?? null;
    const [environment] = environmentId
      ? await db
        .select({ id: environments.id, driver: environments.driver, envVars: environments.envVars })
        .from(environments)
        .where(eq(environments.id, environmentId))
        .limit(1)
      : await db
        .select({ id: environments.id, driver: environments.driver, envVars: environments.envVars })
        .from(environments)
        .where(eq(environments.driver, "local"))
        .orderBy(asc(environments.createdAt))
        .limit(1);
    return {
      environment: environment ?? null,
      driver: environment?.driver ?? "local",
      betaSkills: (settings?.experimental as { enableBetaSkills?: unknown } | undefined)?.enableBetaSkills === true,
    };
  }

  /** The run's MCP servers, by name and URL, with placeholder tokens. */
  async function previewMcpServers(input: {
    agent: AgentRow;
    runTokenAvailable: boolean;
    responsibleUserId: string | null;
    runtimeToolDelivery: Parameters<typeof orderRunMcpServers>[0]["runtimeToolDelivery"];
  }): Promise<AdapterRuntimeMcpServer[]> {
    const apiBaseUrl = configuredPaperclipApiBaseUrl();
    const runtimeToolsEndpoint = plannedRuntimeToolsMcpEndpoint({ responsibleUserId: input.responsibleUserId });
    const assignment = await resolveRuntimeMcpAssignment({
      db,
      agent: input.agent,
      runId: null,
      runIdentity: { issueId: null, responsibleUserId: input.responsibleUserId, activeIdentityContextId: null },
    });
    const assigned: AdapterRuntimeMcpServer[] = [];
    if (assignment.assignmentDigest && apiBaseUrl) {
      const gateway = await findRuntimeMcpAssignmentGateway({ db, agent: input.agent, assignmentDigest: assignment.assignmentDigest });
      assigned.push({
        name: ASSIGNED_MCP_SERVER_NAME,
        url: `${apiBaseUrl}/mcp/gateways/${gateway?.gatewayPublicId ?? PREVIEW_GATEWAY_ID}`,
        token: PREVIEW_BEARER_TOKEN,
        connectionId: `assignment:${assignment.assignmentDigest}`,
      });
    }
    return orderRunMcpServers({
      paperclip: paperclipRunMcpServers({
        authToken: input.runTokenAvailable ? PREVIEW_BEARER_TOKEN : null,
        apiBaseUrl,
      }),
      runtimeTools: runtimeToolsEndpoint ? { mcpEndpoint: runtimeToolsEndpoint, bearerToken: PREVIEW_BEARER_TOKEN } : null,
      runtimeToolDelivery: input.runtimeToolDelivery,
      assigned,
    });
  }

  /** The company's library skills as the run would mount them, and connector skills. */
  async function previewSkillConfig(agent: AgentRow, config: Record<string, unknown>, betaSkills: boolean) {
    const preference = readPaperclipSkillSyncPreference(config);
    const entries = asRunWouldMount(await companySkills.listRuntimeSkillEntries(agent.companyId, {
      materializeMissing: false,
      // The library as it stands: reconciling it writes, and a run does that itself.
      skipInventoryRefresh: true,
      versionSelections: skillVersionSelectionMap(preference.desiredSkillEntries, { versionPinsEnabled: betaSkills }),
    }));
    const assignments = await resolveConnectorAssignments(db, { companyId: agent.companyId, agentId: agent.id });
    return applyConnectorSkills({ ...config, paperclipRuntimeSkills: entries }, entries, assignments, { materialize: false });
  }

  async function previewAgentRun(
    agent: AgentRow,
    input: {
      projectId: string | null;
      /** Whose task the run would be for: the user asking (a run's responsible user). */
      responsibleUserId: string | null;
    },
  ): Promise<ClaudeRunPreview> {
    if (agent.adapterType === "paperclip_runner") return { supported: false, reason: "runner" };
    if (agent.adapterType !== "claude_local") return { supported: false, reason: "not_claude_local" };
    const adapterConfig = (agent.adapterConfig ?? {}) as Record<string, unknown>;
    if (resolveClaudeExecutionEngine(adapterConfig).engine !== "cli") return { supported: false, reason: "not_cli_engine" };
    const adapter = findActiveServerAdapter(agent.adapterType);
    if (!adapter?.previewRun) return { supported: false, reason: "not_claude_local" };
    const { environment, driver, betaSkills } = await environmentForRun(agent);
    if (driver !== "local") return { supported: false, reason: "remote_target" };

    const blockers: ClaudeRunPreviewBlocker[] = [];
    const { responsibleUserId } = input;

    // The project, and where a run on its task would read the repo from.
    const project = input.projectId
      ? await db
        .select({ id: projects.id, name: projects.name, env: projects.env, executionWorkspacePolicy: projects.executionWorkspacePolicy })
        .from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.companyId, agent.companyId)))
        .then((rows) => rows[0] ?? null)
      : null;
    if (input.projectId && !project) throw notFound("Project not found");
    const checkout = project ? await previewProjectCheckout(db, { companyId: agent.companyId, projectId: project.id }) : null;
    const previewCheckout: ClaudeRunPreviewCheckout | null = !checkout
      ? null
      : checkout.kind === "local"
        ? { kind: "local", path: checkout.path }
        : checkout.kind === "not_cloned"
          ? { kind: "not_cloned", repoUrl: checkout.repoUrl }
          : { kind: "none" };

    // Trust, as dispatch resolves it before retaining it on the run.
    const trustPreset = resolveCoreTrustPreset({
      companyId: agent.companyId,
      agent: { companyId: agent.companyId, permissions: agent.permissions },
      project: project ? { companyId: agent.companyId, executionWorkspacePolicy: project.executionWorkspacePolicy } : null,
      run: { companyId: agent.companyId, executionPolicy: undefined },
    });
    if (trustPreset.kind === "denied") blockers.push({ code: "trust_preset_denied", message: trustPreset.detail });

    const github = await resolveRunGitHub(db, {
      agent, adapterConfig, environmentDriver: driver, trustKind: trustPreset.kind, responsibleUserId,
    });

    // The managed AI connection the agent runs under, if any.
    const parsedBinding = aiRuntimeConnectionBindingSchema.safeParse(agent.runtimeConfig?.aiConnection);
    const requestedBinding = agent.runtimeConfig?.aiConnection && parsedBinding.success ? parsedBinding.data : undefined;
    const aiBinding = requestedBinding?.mode === "router" ? undefined : requestedBinding;
    const managedAi = Boolean(requestedBinding);

    // The adapter config with secrets as placeholders, as resolveExecutionRunAdapterConfig gives it.
    const executionRunConfig = stripWorkspaceRuntimeFromExecutionRunConfig(adapterConfig);
    const configInput: ExecutionRunConfigInput = {
      managedAiCredentials: managedAi,
      managedGitHubCredentials: !github.githubAccess.useHostGitHub,
      companyId: agent.companyId,
      agentId: agent.id,
      adapterType: agent.adapterType,
      issueId: null,
      heartbeatRunId: null,
      environmentId: environment?.id ?? null,
      environmentEnv: managedAi ? stripAiAuthBindings(environment?.envVars) : environment?.envVars ?? null,
      environmentDriver: driver,
      projectId: project?.id ?? null,
      routineId: null,
      responsibleUserId,
      executionRunConfig: managedAi
        ? { ...executionRunConfig, env: stripAiAuthBindings(executionRunConfig.env) }
        : executionRunConfig,
      projectEnv: managedAi ? stripAiAuthBindings(project?.env) : project?.env ?? null,
      routineEnv: null,
      secretsSvc: previewSecretResolver(db),
      trustPreset,
    };
    let resolvedConfig: Record<string, unknown>;
    try {
      ({ resolvedConfig } = await resolveExecutionRunAdapterConfig(configInput));
    } catch (error) {
      blockers.push(blockerFromError(error, "configuration_incomplete"));
      // Show the rest as it would be once the configuration is complete.
      ({ config: resolvedConfig } = await configInput.secretsSvc.resolveAdapterConfigForRuntime(
        agent.companyId, configInput.executionRunConfig,
      ));
    }

    let connectionName: string | null = null;
    if (aiBinding) {
      try {
        const described = await describeManagedAiRuntime(db, {
          companyId: agent.companyId, agentId: agent.id, responsibleUserId, adapterType: agent.adapterType,
          binding: aiBinding, config: resolvedConfig,
        });
        // The run checks the project's auth settings again in its working folder.
        if (checkout?.kind === "local") {
          await assertManagedAiProjectAuth({ ...described.config, cwd: checkout.path }, aiBinding.provider);
        }
        Object.assign(resolvedConfig, described.config);
        connectionName = described.accountName;
      } catch (error) {
        blockers.push(blockerFromError(error, "ai_connection_unavailable"));
        resolvedConfig.managedAiConnection = {
          connectionId: "connectionId" in aiBinding ? aiBinding.connectionId : null,
          method: aiBinding.method,
        };
      }
    } else if (requestedBinding?.mode === "router") {
      // A connection pool: the run takes a member at launch (and pins it to the task).
      const [pool] = await db
        .select({ name: toolConnections.name })
        .from(toolConnections)
        .where(and(eq(toolConnections.id, requestedBinding.connectionId), eq(toolConnections.companyId, agent.companyId)))
        .limit(1);
      resolvedConfig.managedAiConnection = { connectionId: requestedBinding.connectionId };
      resolvedConfig.managedAiRouting = { pool: requestedBinding.connectionId };
      connectionName = pool?.name ?? null;
    }

    let runtimeConfig: Record<string, unknown> = await previewSkillConfig(agent, resolvedConfig, betaSkills);
    if (Object.keys(github.githubRunEnv).length > 0) {
      runtimeConfig = {
        ...runtimeConfig,
        env: { ...(runtimeConfig.env as Record<string, unknown> | undefined), ...github.githubRunEnv },
      };
    }

    // The workspace a run on a task here would get. Without a checkout the run falls back to a
    // folder of its own outside any project (as resolveAnchorWorkspaceForRun does).
    const agentHome = resolveDefaultAgentWorkspaceDir(agent.id);
    const workspaceProjectId = checkout?.kind === "local" || checkout?.kind === "not_cloned" ? project!.id : null;
    const switches = await readProjectRepoSwitches(db, agent.companyId, workspaceProjectId);
    const workspace = checkout && checkout.kind !== "none" ? checkout.workspace : null;
    const context: Record<string, unknown> = {
      paperclipWorkspace: {
        cwd: checkout?.kind === "local" ? checkout.path : agentHome,
        source: checkout?.kind === "local" ? "project_primary" : "agent_home",
        projectId: workspaceProjectId,
        workspaceId: workspace?.id ?? null,
        repoUrl: workspace?.repoUrl ?? null,
        repoRef: workspace?.repoRef ?? null,
        branchName: null,
        worktreePath: null,
        agentHome,
        agentsReadClaudeMd: switches?.agentsReadClaudeMd ?? null,
        agentsUseRepoSkills: switches?.agentsUseRepoSkills ?? null,
      },
      ...(project ? { projectId: project.id } : {}),
      paperclipAgentAccess: readRunAgentAccess(agent.permissions),
      paperclipAiConnectionName: connectionName,
      ...(github.manifest ? { paperclipGitHub: github.manifest } : {}),
    };

    const runTokenAvailable = Boolean(adapter.supportsLocalAgentJwt) && localAgentJwtAvailable();
    const servers = await previewMcpServers({
      agent, runTokenAvailable, responsibleUserId,
      runtimeToolDelivery: adapter.runtimeToolDelivery ?? "invocation_context",
    });
    const preview = await adapter.previewRun({
      agent: { id: agent.id, companyId: agent.companyId, name: agent.name, adapterType: agent.adapterType, adapterConfig: agent.adapterConfig },
      config: runtimeConfig,
      context,
      runtimeMcp: createAdapterRuntimeMcpAccess(servers),
      runTokenAvailable,
      executionTarget: null,
    });
    if (!preview.supported) return preview;

    // A repo that isn't cloned yet: the run clones it first and reads it then; the preview
    // doesn't clone, so it says so (a switch that's off still reads off).
    let manifest: ClaudeRunPreviewManifest = preview.manifest;
    if (checkout?.kind === "not_cloned") {
      manifest = {
        ...manifest,
        claudeMd: switches?.agentsReadClaudeMd === false ? manifest.claudeMd : { enabled: false, reason: "not_cloned" },
        repoSkills: switches?.agentsUseRepoSkills === false ? manifest.repoSkills : { enabled: false, reason: "not_cloned" },
      };
    }
    return {
      supported: true,
      project: project && previewCheckout ? { id: project.id, name: project.name, checkout: previewCheckout } : null,
      manifest,
      blockers: [...blockers, ...preview.blockers],
    };
  }

  return { previewAgentRun };
}
