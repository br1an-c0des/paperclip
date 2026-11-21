import { isOpenRouterUrl, openRouterClaudeHeaders } from "@paperclipai/shared/openrouter-attribution";
import { applyObservabilityEnvironment } from "@paperclipai/adapter-utils/agent-observability";
import { createProviderStoppedBoundary } from "@paperclipai/adapter-utils/provider-stopped-boundary";
import { createUsageCheckpointLog } from "@paperclipai/adapter-utils/usage-checkpoint";
import { prepareSshConversationState } from "@paperclipai/adapter-utils/ssh-conversation-state";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import type { ClaudeFreshSessionReason, ClaudeMdLoad, ClaudeRepoSkillsLoad, ClaudeRunCredential } from "@paperclipai/shared";
import type { RunProcessResult } from "@paperclipai/adapter-utils/server-utils";
import {
  managedRemoteHomeEnvironment,
  adapterExecutionTargetIsRemote,
  adapterExecutionTargetRemoteCwd,
  overrideAdapterExecutionTargetRemoteCwd,
  adapterExecutionTargetSessionIdentity,
  adapterExecutionTargetSessionMatches,
  adapterExecutionTargetUsesManagedHome,
  adapterExecutionTargetUsesPaperclipBridge,
  describeAdapterExecutionTarget,
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetRuntimeCommandInstalled,
  prepareAdapterExecutionTargetRuntime,
  adapterExecutionTargetDuplexObservabilityRecorder,
  adapterExecutionTargetEnablesSandboxDuplexBridge,
  readAdapterExecutionTarget,
  resolveAdapterExecutionTargetTimeoutSec,
  resolveAdapterExecutionTargetCommandForLogs,
  runAdapterExecutionTargetProcess,
  runAdapterExecutionTargetShellCommand,
  startAdapterExecutionTargetPaperclipBridge,
} from "@paperclipai/adapter-utils/execution-target";
import {
  asString,
  asNumber,
  asBoolean,
  asStringArray,
  parseObject,
  parseJson,
  applyPaperclipWorkspaceEnv,
  buildPaperclipEnv,
  isPaperclipSkillSourceMissing,
  readPaperclipRuntimeSkillEntries,
  readPaperclipIssueWorkModeFromContext,
  joinPromptSections,
  buildInvocationEnvForLogs,
  ensureAbsoluteDirectory,
  ensurePathInEnv,
  isForbiddenConfigEnvKey,
  isPaperclipRuntimeEnvKey,
  refreshPaperclipWorkspaceEnvForExecution,
  renderTemplate,
  hydrateFreshSessionHandoff,
  hasPaperclipMcpServer,
  isPaperclipExternalChatTurn,
  renderPaperclipMcpNote,
  selectInitialCommunicationGuidance,
  selectPaperclipPromptSections,
  isPaperclipRecoveryWakePayload,
  rewriteWorkspaceCwdEnvVarsForExecution,
  shapePaperclipWorkspaceEnvForExecution,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE,
} from "@paperclipai/adapter-utils/server-utils";
import { buildSkillLibraryManifestMarkdown } from "@paperclipai/adapter-utils/skill-library-manifest";
import {
  parseLocalProcessFilesystemScope,
  parseLocalProcessSandboxExtraPaths,
  parseLocalProcessNetworkAllowlist,
  parseLocalProcessNetworkScope,
  type LocalProcessSandboxOptions,
} from "@paperclipai/adapter-utils/local-process-sandbox";
import {
  claudeModelUsageTotals,
  claudeModelReceipts,
  parseClaudeStreamJson, createClaudeStreamParser,
  describeClaudeFailure,
  detectClaudeLoginRequired,
  extractClaudeRetryNotBefore,
  isClaudeMaxTurnsResult,
  isClaudeProviderQuotaError,
  isClaudeRefusalResult,
  isClaudeTransientUpstreamError,
  isClaudeUnknownSessionError,
  isClaudePoisonedPreviousMessageIdError,
  isClaudeImageProcessingError,
  isClaudeModelNotFoundError,
} from "./parse.js";
import {
  materializeRemoteClaudeConfig,
  prepareClaudeConfigSeed,
  resolveManagedClaudeRuntimeStateDir,
  resolveRemoteClaudeToolShellPrefixPath,
  resolveSharedClaudeConfigDir,
  writePaperclipClaudeMcpConfig,
} from "./claude-config.js";
import {
  claudeCliVersionAtLeast,
  claudeCommandLooksLike,
  claudeCommandSupportsEffortFlag,
  minimumClaudeCliVersionForModel,
} from "./cli-capabilities.js";
import { prepareCompatibleClaudeCommand } from "./sandbox-cli-version.js";
import { resolveClaudeDesiredSkillNames } from "./skills.js";
import { isBedrockModelId } from "./models.js";
import { prepareClaudePromptBundle } from "./prompt-cache.js";
import { buildClaudeExecutionPermissionArgs, claudeSandboxPermissionEnv } from "./permissions.js";
import { resolveClaudeModel, SANDBOX_INSTALL_COMMAND } from "../index.js";
import {
  createClaudeAcpExecutor,
  resolveClaudeExecutionEngineForRun,
} from "./acp.js";
import {
  CLAUDE_CREDENTIAL_MISSING,
  PAPERCLIP_MCP_UNAVAILABLE,
  projectSealedHostEnvironment,
  resolveClaudeRunCredential,
} from "./sealed-env.js";
import {
  createSealedRunHome,
  prepareAgentClaudeConfigDir,
  resolveAgentClaudeConfigDir,
  resolveAgentClaudeSetAsideDir,
} from "./agent-config-dir.js";
import { findRepoRoot, resolveClaudeMdLoad } from "./claude-md.js";
import {
  prepareRepoSkillsPlugin,
  removeRunPluginsDir,
  resolveRepoSkills,
  resolveRunPluginsDir,
  type RepoSkill,
} from "./repo-skills.js";
import {
  buildClaudeRunManifest,
  summarizeClaudeRunManifest,
  type ClaudeRunSessionStart,
  type SealedClaudeLaunch,
} from "./run-manifest.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
const executeClaudeAcp = createClaudeAcpExecutor();

interface ClaudeExecutionInput {
  agentIdentity?: AdapterExecutionContext["agentIdentity"];
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  runtimeCommandSpec?: AdapterExecutionContext["runtimeCommandSpec"];
  executionTarget?: ReturnType<typeof readAdapterExecutionTarget>;
  authToken?: string;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}

interface ClaudeRuntimeConfig {
  command: string;
  resolvedCommand: string;
  cwd: string;
  workspaceId: string | null;
  workspaceRepoUrl: string | null;
  workspaceRepoRef: string | null;
  env: Record<string, string>;
  loggedEnv: Record<string, string>;
  timeoutSec: number;
  graceSec: number;
  extraArgs: string[];
}

export function claudeSessionCwdMatchesExecutionTarget(input: {
  runtimeSessionCwd: string;
  effectiveExecutionCwd: string;
  executionTargetIsRemote: boolean;
}): boolean {
  if (input.executionTargetIsRemote || input.runtimeSessionCwd.length === 0) return true;
  return path.resolve(input.runtimeSessionCwd) === path.resolve(input.effectiveExecutionCwd);
}

function buildLoginResult(input: {
  proc: RunProcessResult;
  loginUrl: string | null;
}) {
  return {
    exitCode: input.proc.exitCode,
    signal: input.proc.signal,
    timedOut: input.proc.timedOut,
    stdout: input.proc.stdout,
    stderr: input.proc.stderr,
    loginUrl: input.loginUrl,
  };
}

function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function isBedrockAuth(env: Record<string, string>): boolean {
  return (
    env.CLAUDE_CODE_USE_BEDROCK === "1" ||
    env.CLAUDE_CODE_USE_BEDROCK === "true" ||
    hasNonEmptyEnvValue(env, "ANTHROPIC_BEDROCK_BASE_URL")
  );
}

function resolveClaudeBillingType(env: Record<string, string>): "api" | "subscription" | "metered_api" {
  if (isBedrockAuth(env)) return "metered_api";
  return hasNonEmptyEnvValue(env, "ANTHROPIC_API_KEY") ? "api" : "subscription";
}

/**
 * What a sealed local run gets from Paperclip beyond the agent's own `env`
 * (fork/step-4b-sealed-runs.md, sections 2, 5 and 6).
 */
interface SealedClaudeRun {
  credential: ClaudeRunCredential;
  configDir: string;
  setAside: { dir: string; entries: string[] };
  overriddenEnv: string[];
  /**
   * Values the launch sets over the agent's `env`: Paperclip's `HOME` and `XDG_*` folders
   * (without a managed connection), `CLAUDE_CONFIG_DIR`, the `CLAUDE.md` switch's variable, and
   * `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, last. Re-applied after anything re-reads `config.env`.
   */
  envOverrides: Record<string, string>;
  claudeMd: { load: ClaudeMdLoad; addDir: string | null };
  repoSkills: { load: ClaudeRepoSkillsLoad; skills: RepoSkill[] };
  /** The per-run plugins folder holding `project`, when the repo's skills load. */
  runPluginsDir: string | null;
}

/** Keys the sealed launch replaces in the agent's `env` when it has no managed connection. */
const SEALED_HOME_ENV_KEYS = ["HOME", "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"] as const;

function sealedRunRefusal(errorCode: string, errorMessage: string): AdapterExecutionResult {
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorCode,
    errorMessage,
    resultJson: {
      executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
    },
  };
}

/**
 * The gates of a sealed local run, before any Claude process: the `paperclip` MCP server and a
 * run token, then a Claude credential from Paperclip (section 7). Returns the refusal, or null.
 */
function checkSealedRunGates(input: {
  ctx: AdapterExecutionContext;
  env: Record<string, string>;
}): { refusal: AdapterExecutionResult; credential: null } | { refusal: null; credential: ClaudeRunCredential } {
  const { ctx, env } = input;
  if (!ctx.authToken) {
    return {
      refusal: sealedRunRefusal(
        PAPERCLIP_MCP_UNAVAILABLE,
        "This run has no Paperclip run token, so it can't reach the `paperclip` MCP server to finish or block its work. " +
          "Set PAPERCLIP_AGENT_JWT_SECRET (or BETTER_AUTH_SECRET) on the Paperclip server.",
      ),
      credential: null,
    };
  }
  if (!hasPaperclipMcpServer(ctx.runtimeMcp?.getServers() ?? [])) {
    return {
      refusal: sealedRunRefusal(
        PAPERCLIP_MCP_UNAVAILABLE,
        "This run has no `paperclip` MCP server, so it can't finish or block its work. " +
          "Set PAPERCLIP_API_URL on the Paperclip server to the address runs reach it at.",
      ),
      credential: null,
    };
  }
  const credential = resolveClaudeRunCredential({
    env,
    managedAiConnection: ctx.config.managedAiConnection,
    managedAiRouting: ctx.config.managedAiRouting,
    connectionName: asString(ctx.context.paperclipAiConnectionName, "") || null,
  });
  if (!credential) {
    return {
      refusal: sealedRunRefusal(
        CLAUDE_CREDENTIAL_MISSING,
        "This run has no Claude credential from Paperclip, and runs don't use the server's own Claude login. " +
          "Give the agent a managed AI connection, or add a secret to the agent's environment: " +
          "CLAUDE_CODE_OAUTH_TOKEN (a subscription token), ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN with ANTHROPIC_BASE_URL, " +
          "or CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_USE_VERTEX or CLAUDE_CODE_USE_FOUNDRY with that provider's settings.",
      ),
      credential: null,
    };
  }
  return { refusal: null, credential };
}

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Prepares a sealed local run after its gates: Paperclip's `HOME` (without a managed
 * connection), the agent's config folder with stray configuration set aside, and what the run
 * takes from its repo (fork/step-4b-plan.md, Task 8). Cleanups go into `runCleanups`, which
 * the caller runs after the run.
 */
async function prepareSealedClaudeRun(input: {
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  configEnv: Record<string, unknown>;
  workspaceContext: Record<string, unknown>;
  cwd: string;
  env: Record<string, string>;
  credential: ClaudeRunCredential;
  runCleanups: Array<() => Promise<void>>;
  onLog: AdapterExecutionContext["onLog"];
}): Promise<SealedClaudeRun> {
  const { runId, agent, config, configEnv, workspaceContext, cwd, env, credential, runCleanups, onLog } = input;
  const envOverrides: Record<string, string> = {};
  const managedConnection = Boolean(config.managedAiConnection);
  // A managed connection brings its own temporary HOME; anything else gets Paperclip's, so the
  // server user's home never reaches a run. A managed connection without one gets it too.
  if (!managedConnection || !asString(env.HOME, "").trim()) {
    const sealedHome = await createSealedRunHome(agent.id);
    runCleanups.push(() => sealedHome.cleanup());
    Object.assign(envOverrides, sealedHome.env);
  }

  const configDir = resolveAgentClaudeConfigDir(process.env, agent.companyId, agent.id);
  const setAsideDir = resolveAgentClaudeSetAsideDir(process.env, agent.companyId, agent.id, runId);
  const { setAside } = await prepareAgentClaudeConfigDir({ configDir, setAsideDir });
  if (setAside.length > 0) {
    await onLog(
      "stdout",
      `[paperclip] Set aside ${setAside.join(", ")} from the agent's Claude config folder into ${setAsideDir}: Paperclip didn't put them there, and they would have loaded as configuration.\n`,
    );
  }
  envOverrides.CLAUDE_CONFIG_DIR = configDir;

  const overriddenEnv = managedConnection
    ? []
    : SEALED_HOME_ENV_KEYS.filter((key) => {
        const configured = configEnv[key];
        return typeof configured === "string" && configured.trim().length > 0 && configured !== envOverrides[key];
      });

  // The repo's root CLAUDE.md and its skills, from the run's own checkout, when its project
  // allows them. The repo skills load as a per-run `project` plugin, removed after the run.
  const repoRoot = await findRepoRoot(cwd);
  const projectId = asString(workspaceContext.projectId, "").trim() || null;
  const claudeMd = await resolveClaudeMdLoad({
    projectId,
    agentsReadClaudeMd: readOptionalBoolean(workspaceContext.agentsReadClaudeMd),
    repoRoot,
  });
  const repoSkills = await resolveRepoSkills({
    projectId,
    agentsUseRepoSkills: readOptionalBoolean(workspaceContext.agentsUseRepoSkills),
    repoRoot,
  });
  let runPluginsDir: string | null = null;
  if (repoSkills.load.enabled && repoRoot) {
    const dir = resolveRunPluginsDir(process.env, agent.companyId, agent.id, runId);
    // Registered first, so a half-built folder is removed too.
    runCleanups.push(() => removeRunPluginsDir(dir));
    runPluginsDir = await prepareRepoSkillsPlugin({ runPluginsDir: dir, repoRoot, skills: repoSkills.skills });
  }
  if (claudeMd.addDir) envOverrides.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD = "1";
  // Last, so nothing overrides it.
  envOverrides.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";

  return {
    credential,
    configDir,
    setAside: { dir: setAsideDir, entries: setAside },
    overriddenEnv,
    envOverrides,
    claudeMd,
    repoSkills,
    runPluginsDir,
  };
}

/** The environment a sealed launch spawns with: the host allowlist, the run's `env`, then the sealed values. */
function buildSealedLaunchEnv(env: Record<string, string>, sealed: SealedClaudeRun): Record<string, string> {
  const launchEnv: Record<string, string> = { ...projectSealedHostEnvironment(process.env), ...env };
  for (const [key, value] of Object.entries(sealed.envOverrides)) {
    delete launchEnv[key];
    launchEnv[key] = value;
  }
  return launchEnv;
}

async function buildClaudeRuntimeConfig(input: ClaudeExecutionInput): Promise<ClaudeRuntimeConfig> {
  const { runId, agent, config, context, runtimeCommandSpec, executionTarget, authToken } = input;
  const onLog = input.onLog ?? (async () => {});

  const command = asString(config.command, "claude");
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceStrategy = asString(workspaceContext.strategy, "");
  const workspaceId = asString(workspaceContext.workspaceId, "") || null;
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "") || null;
  const workspaceRepoRef = asString(workspaceContext.repoRef, "") || null;
  const workspaceBranch = asString(workspaceContext.branchName, "") || null;
  const workspaceWorktreePath = asString(workspaceContext.worktreePath, "") || null;
  const agentHome = asString(workspaceContext.agentHome, "") || null;
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimeServiceIntents = Array.isArray(context.paperclipRuntimeServiceIntents)
    ? context.paperclipRuntimeServiceIntents.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimeServices = Array.isArray(context.paperclipRuntimeServices)
    ? context.paperclipRuntimeServices.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const runtimePrimaryUrl = asString(context.paperclipRuntimePrimaryUrl, "");
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  const executionTargetIsRemote = adapterExecutionTargetIsRemote(executionTarget);
  let effectiveExecutionCwd = adapterExecutionTargetRemoteCwd(executionTarget, cwd);
  const shapedWorkspaceEnv = shapePaperclipWorkspaceEnvForExecution({
    workspaceCwd: effectiveWorkspaceCwd,
    workspaceWorktreePath,
    workspaceHints,
    executionTargetIsRemote,
    executionCwd: effectiveExecutionCwd,
  });
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = { ...buildPaperclipEnv(agent, input.agentIdentity) };
  env.PAPERCLIP_RUN_ID = runId;

  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const issueWorkMode = readPaperclipIssueWorkModeFromContext(context);

  if (wakeTaskId) {
    env.PAPERCLIP_TASK_ID = wakeTaskId;
  }
  if (issueWorkMode) {
    env.PAPERCLIP_ISSUE_WORK_MODE = issueWorkMode;
  }
  if (wakeReason) {
    env.PAPERCLIP_WAKE_REASON = wakeReason;
  }
  if (wakeCommentId) {
    env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  }
  if (approvalId) {
    env.PAPERCLIP_APPROVAL_ID = approvalId;
  }
  if (approvalStatus) {
    env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  }
  if (linkedIssueIds.length > 0) {
    env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  }
  applyPaperclipWorkspaceEnv(env, {
    workspaceCwd: shapedWorkspaceEnv.workspaceCwd,
    workspaceSource,
    workspaceStrategy,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    workspaceBranch,
    workspaceWorktreePath: shapedWorkspaceEnv.workspaceWorktreePath,
    agentHome,
  });
  if (shapedWorkspaceEnv.workspaceHints.length > 0) {
    env.PAPERCLIP_WORKSPACES_JSON = JSON.stringify(shapedWorkspaceEnv.workspaceHints);
  }
  if (runtimeServiceIntents.length > 0) {
    env.PAPERCLIP_RUNTIME_SERVICE_INTENTS_JSON = JSON.stringify(runtimeServiceIntents);
  }
  if (runtimeServices.length > 0) {
    env.PAPERCLIP_RUNTIME_SERVICES_JSON = JSON.stringify(runtimeServices);
  }
  if (runtimePrimaryUrl) {
    env.PAPERCLIP_RUNTIME_PRIMARY_URL = runtimePrimaryUrl;
  }
  const shapedEnvConfig = rewriteWorkspaceCwdEnvVarsForExecution({
    env: envConfig,
    workspaceCwd: effectiveWorkspaceCwd,
    executionCwd: shapedWorkspaceEnv.workspaceCwd,
    executionTargetIsRemote,
  });
  for (const [key, value] of Object.entries(shapedEnvConfig)) {
    if (typeof value !== "string") continue;
    // Runtime PAPERCLIP_* always wins over config, and PAPERCLIP_API_KEY is
    // never accepted from config — the harness-minted run token is the only
    // source. Other PAPERCLIP_* keys Paperclip did not assign flow through.
    if (isForbiddenConfigEnvKey(key)) continue;
    if (isPaperclipRuntimeEnvKey(key) && key in env) continue;
    env[key] = value;
  }

  if (isOpenRouterUrl(env.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL)) {
    env.ANTHROPIC_CUSTOM_HEADERS = openRouterClaudeHeaders(env.ANTHROPIC_CUSTOM_HEADERS ?? process.env.ANTHROPIC_CUSTOM_HEADERS);
  }
  if (authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }

  const runtimeEnv = Object.fromEntries(
    Object.entries(ensurePathInEnv({ ...process.env, ...env })).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const timeoutSec = resolveAdapterExecutionTargetTimeoutSec(
    executionTarget,
    asNumber(config.timeoutSec, 0),
  );
  const graceSec = asNumber(config.graceSec, 20);
  await ensureAdapterExecutionTargetRuntimeCommandInstalled({
    runId,
    target: executionTarget,
    installCommand: runtimeCommandSpec?.installCommand,
    detectCommand: runtimeCommandSpec?.detectCommand,
    cwd,
    env: runtimeEnv,
    timeoutSec,
    graceSec,
    onLog,
  });
  await ensureAdapterExecutionTargetCommandResolvable(command, executionTarget, cwd, runtimeEnv, {
    installCommand: SANDBOX_INSTALL_COMMAND,
    timeoutSec,
  });
  const resolvedCommand = await resolveAdapterExecutionTargetCommandForLogs(command, executionTarget, cwd, runtimeEnv);
  const loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME", "CLAUDE_CONFIG_DIR"],
    resolvedCommand,
  });

  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();

  return {
    command,
    resolvedCommand,
    cwd,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    env,
    loggedEnv,
    timeoutSec,
    graceSec,
    extraArgs,
  };
}

export async function runClaudeLogin(input: {
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  context?: Record<string, unknown>;
  authToken?: string;
  onLog?: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
}) {
  const onLog = input.onLog ?? (async () => {});
  const runtime = await buildClaudeRuntimeConfig({
    runId: input.runId,
    agent: input.agent,
    config: input.config,
    context: input.context ?? {},
    authToken: input.authToken,
  });

  const proc = await runAdapterExecutionTargetProcess(input.runId, null, runtime.command, ["login"], {
    cwd: runtime.cwd,
    env: runtime.env,
    timeoutSec: runtime.timeoutSec,
    graceSec: runtime.graceSec,
    onLog,
  });

  const loginMeta = detectClaudeLoginRequired({
    parsed: null,
    stdout: proc.stdout,
    stderr: proc.stderr,
  });

  return buildLoginResult({
    proc,
    loginUrl: loginMeta.loginUrl,
  });
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const providerStop = createProviderStoppedBoundary(ctx.onProviderStopped);
  const engineSelection = await resolveClaudeExecutionEngineForRun(ctx);
  if (engineSelection.unavailableReason) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorCode: "adapter_engine_unavailable",
      errorMessage: engineSelection.unavailableReason,
      resultJson: {
        executionRecovery: { kind: "bootstrap", providerWorkStarted: false },
      },
    };
  }
  if (engineSelection.engine === "acp") {
    return executeClaudeAcp(ctx);
  }

  // The outer cleanup of a CLI run: a sealed run's temporary HOME and its repo-skills plugin
  // folder go after the run, also when it failed or was cancelled.
  const runCleanups: Array<() => Promise<void>> = [];
  try {
    return await executeClaudeCli(ctx, providerStop, runCleanups);
  } finally {
    for (const cleanup of runCleanups.reverse()) {
      await cleanup().catch(() => undefined);
    }
  }
}

async function executeClaudeCli(
  ctx: AdapterExecutionContext,
  providerStop: ReturnType<typeof createProviderStoppedBoundary>,
  runCleanups: Array<() => Promise<void>>,
): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;
  const executionTarget = readAdapterExecutionTarget({
    executionTarget: ctx.executionTarget,
    legacyRemoteExecution: ctx.executionTransport?.remoteExecution,
  });
  const executionTargetIsRemote = adapterExecutionTargetIsRemote(executionTarget);
  const executionTargetIsSandbox = executionTarget?.kind === "remote" && executionTarget.transport === "sandbox";

  const promptTemplate = asString(
    config.promptTemplate,
    context.conversationMode === true
      ? DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE
      : DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  );
  const effort = asString(config.effort, "");
  const chrome = asBoolean(config.chrome, false);
  const maxTurns = asNumber(config.maxTurnsPerRun, 0);
  const dangerouslySkipPermissions = asBoolean(config.dangerouslySkipPermissions, true);
  const configEnv = parseObject(config.env);
  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceStrategy = asString(workspaceContext.strategy, "");
  const workspaceBranch = asString(workspaceContext.branchName, "") || null;
  const workspaceWorktreePath = asString(workspaceContext.worktreePath, "") || null;
  const agentHome = asString(workspaceContext.agentHome, "") || null;
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
        (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
      )
    : [];
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const hasExplicitClaudeConfigDir =
    typeof configEnv.CLAUDE_CONFIG_DIR === "string" && configEnv.CLAUDE_CONFIG_DIR.trim().length > 0;
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  const instructionsFileDir = instructionsFilePath ? `${path.dirname(instructionsFilePath)}/` : "";
  const runtimeConfig = await buildClaudeRuntimeConfig({
    agentIdentity: ctx.agentIdentity,
    runId,
    agent,
    config,
    context,
    runtimeCommandSpec: ctx.runtimeCommandSpec,
    executionTarget,
    authToken,
    onLog,
  });
  let {
    command,
    resolvedCommand,
    cwd,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    env,
    loggedEnv: initialLoggedEnv,
    timeoutSec,
    graceSec,
    extraArgs,
  } = runtimeConfig;
  Object.assign(env, claudeSandboxPermissionEnv({ dangerouslySkipPermissions, targetIsSandbox: executionTargetIsSandbox }));
  if (ctx.observability) applyObservabilityEnvironment(env, ctx.observability);
  // Sealing applies to local targets only; the dormant remote (SSH, sandbox) paths keep their
  // launch as it was.
  let sealed: SealedClaudeRun | null = null;
  if (!executionTargetIsRemote) {
    const gates = checkSealedRunGates({ ctx, env });
    if (gates.refusal) {
      await onLog("stderr", `[paperclip] ${gates.refusal.errorMessage}\n`);
      return gates.refusal;
    }
    sealed = await prepareSealedClaudeRun({
      runId,
      agent,
      config,
      configEnv,
      workspaceContext,
      cwd,
      env,
      credential: gates.credential,
      runCleanups,
      onLog,
    });
    Object.assign(env, sealed.envOverrides);
  }
  let loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv: initialLoggedEnv,
    includeRuntimeKeys: ["HOME", "CLAUDE_CONFIG_DIR"],
    resolvedCommand,
  });
  let effectiveExecutionCwd = adapterExecutionTargetRemoteCwd(executionTarget, cwd);
  const terminalResultCleanupGraceMs = Math.max(
    0,
    asNumber(config.terminalResultCleanupGraceMs, 5_000),
  );
  // What the run's process sees, for the model and billing: a sealed run's own environment, or
  // the server's with the run's on top on the dormant remote paths.
  const effectiveEnv = sealed
    ? buildSealedLaunchEnv(env, sealed)
    : Object.fromEntries(
        Object.entries({ ...process.env, ...env }).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
  const modelEnv = executionTargetIsRemote ? env : effectiveEnv;
  const model = resolveClaudeModel(config.model, modelEnv);
  const billingType = resolveClaudeBillingType(effectiveEnv);
  const claudeSkillEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkillNames = new Set(resolveClaudeDesiredSkillNames(config, claudeSkillEntries));
  // Keep per-run working-copy paths out of the content-addressed system prompt.
  // Resumed sessions retain that prompt, so refresh the location on every turn.
  let combinedInstructionsContents: string | null = null;
  let instructionsPathDirective = "";
  if (instructionsFilePath) {
    try {
      const instructionsContent = await fs.readFile(instructionsFilePath, "utf-8");
      instructionsPathDirective =
        `Agent instructions for this run were loaded from ${instructionsFilePath}. ` +
        `Resolve any relative file references from ${instructionsFileDir}. ` +
        `This base directory is authoritative for sibling instruction files such as ` +
        `./HEARTBEAT.md, ./SOUL.md, and ./TOOLS.md; do not resolve those from the parent agent directory. ` +
        `This location replaces any instruction file location from earlier turns.`;
      combinedInstructionsContents = instructionsContent +
        "\nUse the agent instruction file location supplied in the current run prompt to resolve relative file references.";
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await onLog(
        "stderr",
        `[paperclip] Warning: could not read agent instructions file "${instructionsFilePath}": ${reason}\n`,
      );
    }
  }
  // Tell the model what the company library actually holds. Without this, an
  // installed-but-not-enabled skill is indistinguishable from a nonexistent
  // one from inside the sandbox, and agents tell users freshly installed
  // skills "are not installed". Deterministic text appended to the
  // instructions, so it participates in the prompt-bundle cache key and only
  // busts the cache when the library really changes.
  const skillLibraryManifest = buildSkillLibraryManifestMarkdown({
    entries: claudeSkillEntries,
    desiredSkillKeys: desiredSkillNames,
  });
  if (skillLibraryManifest) {
    combinedInstructionsContents = combinedInstructionsContents
      ? `${combinedInstructionsContents}\n\n${skillLibraryManifest}`
      : skillLibraryManifest;
  }
  // Missing-source entries must never reach the bundle: their path does not
  // exist, so the bundle hasher would throw and fail the whole run over one
  // broken skill. Log each one instead so the cause lands in the run output.
  const desiredSkillEntries = claudeSkillEntries.filter((entry) => desiredSkillNames.has(entry.key));
  const mountableSkillEntries = desiredSkillEntries.filter((entry) => !isPaperclipSkillSourceMissing(entry));
  for (const entry of desiredSkillEntries) {
    if (!isPaperclipSkillSourceMissing(entry)) continue;
    await onLog(
      "stderr",
      `[paperclip] Warning: skill "${entry.key}" is enabled for this agent but its files are unavailable and it was not mounted${entry.missingDetail ? `: ${entry.missingDetail}` : "."}\n`,
    );
  }
  const promptBundle = await prepareClaudePromptBundle({
    companyId: agent.companyId,
    skills: mountableSkillEntries,
    instructionsContents: combinedInstructionsContents,
    onLog,
  });
  const runtimeMcpServers = ctx.runtimeMcp?.getServers() ?? [];
  const runtimeMcpIdentity = JSON.stringify(
    runtimeMcpServers.map(({ name, url, connectionId }) => ({ name, url, connectionId })),
  );
  const claudeRuntimeStateDir = resolveManagedClaudeRuntimeStateDir(
    process.env,
    agent.companyId,
    agent.id,
  );
  const localMcpConfigPath = await writePaperclipClaudeMcpConfig({
    stateDir: claudeRuntimeStateDir,
    runId,
    servers: runtimeMcpServers,
  });
  const localMcpConfigDir = path.dirname(localMcpConfigPath);
  const sharedClaudeConfigDir = config.managedAiConnection ? asString(configEnv.CLAUDE_CONFIG_DIR, "") : resolveSharedClaudeConfigDir(process.env);
  const networkScope = parseLocalProcessNetworkScope(config.networkScope);
  const filesystemScope = parseLocalProcessFilesystemScope(config.filesystemScope);
  // Confinement exists on local targets only, which are always sealed. Claude keeps its
  // `.claude.json` inside the agent's config folder (CLAUDE_CONFIG_DIR). The bundle's and the
  // `project` plugin's skills are symlinks to folders outside them, so their targets are
  // readable too.
  const localProcessSandbox: LocalProcessSandboxOptions | null =
    (filesystemScope || networkScope) && !executionTargetIsRemote && sealed
      ? {
          workspaceDir: effectiveExecutionCwd,
          filesystemScope,
          managedPaths: [
            { path: sealed.configDir, access: "rw" },
            ...(env.HOME ? [{ path: env.HOME, access: "rw" as const }] : []),
            { path: promptBundle.rootDir, access: "ro" },
            ...mountableSkillEntries
              .filter((entry) => path.isAbsolute(entry.source))
              .map((entry) => ({ path: entry.source, access: "ro" as const })),
            { path: localMcpConfigDir, access: "ro" },
            ...(sealed.runPluginsDir ? [{ path: sealed.runPluginsDir, access: "ro" as const }] : []),
            ...sealed.repoSkills.skills.map((skill) => ({ path: skill.dir, access: "ro" as const })),
            ...(sealed.claudeMd.load.enabled ? [{ path: sealed.claudeMd.load.path, access: "ro" as const }] : []),
          ],
          extraPaths: parseLocalProcessSandboxExtraPaths(config.filesystemExtraPaths),
          // runChildProcess sets HOME to this after merging the env: it must be the sealed HOME
          // (Paperclip's, or the managed connection's), never the server's or the config folder.
          homeDir: env.HOME || null,
          networkScope,
          networkAllowlist: parseLocalProcessNetworkAllowlist(config.networkAllowlist),
          networkTrustedUrls: [
            env.PAPERCLIP_API_URL,
            ...runtimeMcpServers.map((server) => server.url),
          ].filter((value): value is string => typeof value === "string" && value.length > 0),
          command: asString(config.filesystemSandboxCommand, "bwrap"),
        }
      : null;
  if (localProcessSandbox) {
    const scopes = [filesystemScope ? "workspace filesystem" : null, networkScope ? `${networkScope} network` : null]
      .filter(Boolean)
      .join(" and ");
    await onLog(
      "stdout",
      `[paperclip] Confining Claude with ${scopes} scope.\n`,
    );
  }
  const useManagedRemoteClaudeConfig =
    executionTargetIsRemote &&
    adapterExecutionTargetUsesManagedHome(executionTarget, Boolean(config.managedAiConnection)) &&
    (!hasExplicitClaudeConfigDir || Boolean(config.managedAiConnection));
  const claudeConfigSeedDir = useManagedRemoteClaudeConfig
    ? config.managedAiConnection ? sharedClaudeConfigDir : await prepareClaudeConfigSeed(process.env, onLog, agent.companyId)
    : null;
  const preparedExecutionTargetRuntime = executionTargetIsRemote
    ? await (async () => {
        await onLog(
          "stdout",
          `[paperclip] Syncing workspace and Claude runtime assets to ${describeAdapterExecutionTarget(executionTarget)}.\n`,
        );
        return await prepareAdapterExecutionTargetRuntime({
          privateRuntime: Boolean(config.managedAiConnection),
          runId,
          target: executionTarget,
          adapterKey: "claude",
          timeoutSec,
          workspaceLocalDir: cwd,
          syncWorkspace: executionTarget?.workspaceRealization?.mode !== "in_place",
          installCommand: SANDBOX_INSTALL_COMMAND,
          detectCommand: command,
          onProgress: (line) => onLog("stdout", line),
          onRuntimeProgress: ctx.onRuntimeProgress,
          assets: [
            {
              key: "skills",
              localDir: promptBundle.addDir,
              followSymlinks: true,
            },
            {
              key: "mcp-config",
              localDir: localMcpConfigDir,
              followSymlinks: true,
            },
            ...(claudeConfigSeedDir
              ? [{
                key: "config-seed",
                localDir: claudeConfigSeedDir,
                followSymlinks: true,
              }]
              : []),
          ],
        });
      })()
    : null;
  const restoreRemoteWorkspace = preparedExecutionTargetRuntime
    ? () => preparedExecutionTargetRuntime.restoreWorkspace((line) => onLog("stdout", line))
    : null;
  let paperclipBridge: Awaited<ReturnType<typeof startAdapterExecutionTargetPaperclipBridge>> = null;
  let sshSessionState: Awaited<ReturnType<typeof prepareSshConversationState>> | null = null;
  try {
    if (preparedExecutionTargetRuntime?.workspaceRemoteDir) {
      effectiveExecutionCwd = preparedExecutionTargetRuntime.workspaceRemoteDir;
    }
    const runtimeExecutionTarget = overrideAdapterExecutionTargetRemoteCwd(executionTarget, effectiveExecutionCwd);
    refreshPaperclipWorkspaceEnvForExecution({
      env,
      envConfig: configEnv,
      workspaceCwd: effectiveWorkspaceCwd,
      workspaceSource,
      workspaceStrategy,
      workspaceId,
      workspaceRepoUrl,
      workspaceRepoRef,
      workspaceBranch,
      workspaceWorktreePath,
      workspaceHints,
      agentHome,
      executionTargetIsRemote,
      executionCwd: effectiveExecutionCwd,
    });
    // The refresh re-reads config.env: the sealed values win again.
    if (sealed) Object.assign(env, sealed.envOverrides);
    const effectivePromptBundleAddDir = executionTargetIsRemote
      ? preparedExecutionTargetRuntime?.assetDirs.skills ??
        path.posix.join(effectiveExecutionCwd, ".paperclip-runtime", "claude", "skills")
      : promptBundle.addDir;
    const effectiveInstructionsFilePath = promptBundle.instructionsFilePath
      ? executionTargetIsRemote
        ? path.posix.join(effectivePromptBundleAddDir, path.basename(promptBundle.instructionsFilePath))
        : promptBundle.instructionsFilePath
      : undefined;
    const effectiveMcpConfigPath = executionTargetIsRemote
      ? path.posix.join(
          preparedExecutionTargetRuntime?.assetDirs["mcp-config"] ??
            path.posix.join(effectiveExecutionCwd, ".paperclip-runtime", "claude", "mcp-config"),
          path.basename(localMcpConfigPath),
        )
      : localMcpConfigPath;
    const remoteClaudeRuntimeRoot = executionTargetIsRemote
      ? preparedExecutionTargetRuntime?.runtimeRootDir ??
        path.posix.join(effectiveExecutionCwd, ".paperclip-runtime", "claude")
      : null;
    const remoteClaudeConfigSeedDir = claudeConfigSeedDir && remoteClaudeRuntimeRoot
      ? preparedExecutionTargetRuntime?.assetDirs["config-seed"] ??
        path.posix.join(remoteClaudeRuntimeRoot, "config-seed")
      : null;
    let remoteClaudeConfigDir = useManagedRemoteClaudeConfig && remoteClaudeRuntimeRoot
      ? path.posix.join(remoteClaudeRuntimeRoot, "config")
      : null;
    if (executionTarget?.kind === "remote" && executionTarget.transport === "ssh" && executionTarget.spec.useHostAuth === false
      && config.managedAiConnection && executionTarget.workspaceRealization?.mode === "in_place" && remoteClaudeConfigDir) {
      const account = parseObject(config.managedAiConnection);
      const identity = asString(account.sessionIdentity, asString(account.identity, ""));
      if (!identity) throw new Error("Managed SSH Claude execution requires an account identity");
      const saved = parseObject(runtime.sessionParams);
      sshSessionState = await prepareSshConversationState({
        adapterKey: "claude", preserve: ["projects"],
        remoteRoot: executionTarget.spec.remoteWorkspacePath, companyId: agent.companyId, agentId: agent.id,
        accountIdentity: identity, executionIdentity: adapterExecutionTargetSessionIdentity(runtimeExecutionTarget),
        runId, savedScope: saved.sshClaudeAccountScope, savedConversationId: saved.sshClaudeConversationId,
        run: async command => {
          const result = await runAdapterExecutionTargetShellCommand(runId, runtimeExecutionTarget, command, { cwd: effectiveExecutionCwd, env: {}, timeoutSec: 15 });
          if (result.exitCode !== 0 || result.timedOut) throw new Error("Cannot prepare or clean up SSH Claude conversation state");
        },
      });
      remoteClaudeConfigDir = sshSessionState.home;
    }
    if (executionTarget?.kind === "remote" && executionTarget.transport === "ssh" && executionTarget.spec.useHostAuth === false && config.managedAiConnection && remoteClaudeRuntimeRoot) Object.assign(env, managedRemoteHomeEnvironment(remoteClaudeRuntimeRoot));
    if (remoteClaudeConfigDir && remoteClaudeConfigSeedDir && remoteClaudeRuntimeRoot) {
      env.CLAUDE_CONFIG_DIR = remoteClaudeConfigDir;
      loggedEnv.CLAUDE_CONFIG_DIR = remoteClaudeConfigDir;
      const remoteToolShellPrefixPath = resolveRemoteClaudeToolShellPrefixPath(env, remoteClaudeRuntimeRoot);
      await onLog(
        "stdout",
        `[paperclip] Materializing Claude auth/config into ${remoteClaudeConfigDir}.\n`,
      );
      const { toolShellPrefixInstalled } = await materializeRemoteClaudeConfig({
        allowHostCredentials: !config.managedAiConnection,
        runId,
        target: executionTarget,
        remoteClaudeConfigDir,
        remoteClaudeConfigSeedDir,
        remoteToolShellPrefixPath,
        options: {
          cwd,
          env,
          timeoutSec: Math.max(timeoutSec, 15),
          graceSec,
          onLog,
        },
      });
      if (toolShellPrefixInstalled && remoteToolShellPrefixPath) {
        env.CLAUDE_CODE_SHELL_PREFIX = remoteToolShellPrefixPath;
        loggedEnv.CLAUDE_CODE_SHELL_PREFIX = remoteToolShellPrefixPath;
      }
    }
    if (executionTargetIsRemote && adapterExecutionTargetUsesPaperclipBridge(runtimeExecutionTarget)) {
      paperclipBridge = await startAdapterExecutionTargetPaperclipBridge({
        runId,
        target: runtimeExecutionTarget,
        enableSandboxDuplexBridge: adapterExecutionTargetEnablesSandboxDuplexBridge(runtimeExecutionTarget),
        duplexObservabilityRecorder: adapterExecutionTargetDuplexObservabilityRecorder(runtimeExecutionTarget),
        runtimeRootDir: preparedExecutionTargetRuntime?.runtimeRootDir,
        adapterKey: "claude",
        timeoutSec,
        hostApiToken: env.PAPERCLIP_API_KEY,
        onLog,
      });
      if (paperclipBridge) {
        Object.assign(env, paperclipBridge.env);
        const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
        loggedEnv = buildInvocationEnvForLogs(env, {
          runtimeEnv,
          includeRuntimeKeys: ["HOME", "CLAUDE_CONFIG_DIR"],
          resolvedCommand,
        });
        if (remoteClaudeConfigDir) {
          loggedEnv.CLAUDE_CONFIG_DIR = remoteClaudeConfigDir;
        }
      }
    }
    let effectiveEffort = effort;

    const runtimeSessionParams = parseObject(runtime.sessionParams);
    const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
    const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
    const runtimeRemoteExecution = parseObject(runtimeSessionParams.remoteExecution);
    const runtimePromptBundleKey = asString(runtimeSessionParams.promptBundleKey, "");
    const runtimeMcpServerIdentity = asString(runtimeSessionParams.mcpServerIdentity, "");
    const hasMatchingPromptBundle =
      runtimePromptBundleKey.length === 0 || runtimePromptBundleKey === promptBundle.bundleKey;
    const hasMatchingMcpServers =
      runtimeMcpServerIdentity.length === 0
        ? runtimeMcpServers.length === 0
        : runtimeMcpServerIdentity === runtimeMcpIdentity;
    const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runtimeSessionId);
    const hasMatchingSessionCwd = claudeSessionCwdMatchesExecutionTarget({
      runtimeSessionCwd,
      effectiveExecutionCwd,
      executionTargetIsRemote,
    });
    const hasMatchingExecutionTarget = adapterExecutionTargetSessionMatches(runtimeRemoteExecution, runtimeExecutionTarget);
    const canResumeSession =
      (!sshSessionState || sshSessionState.canResume) &&
      runtimeSessionId.length > 0 &&
      isValidUuid &&
      hasMatchingPromptBundle &&
      // Each CLI invocation loads --mcp-config, including --resume invocations.
      // Refreshing tools does not invalidate the saved conversation.
      hasMatchingSessionCwd &&
      hasMatchingExecutionTarget;
    const sessionId = canResumeSession ? runtimeSessionId : null;
    // Why a run starts fresh, for the manifest. The repo's skills don't count: a changed set
    // resumes, as a terminal session would after `git checkout`.
    const freshSessionReason: ClaudeFreshSessionReason = runtimeSessionId.length === 0
      ? "no_saved_session"
      : !isValidUuid
      ? "invalid_session_id"
      : !hasMatchingExecutionTarget
      ? "target_changed"
      : !hasMatchingSessionCwd
      ? "cwd_changed"
      : !hasMatchingPromptBundle
      ? "prompt_bundle_changed"
      : "session_unavailable";
    if (runtimeSessionId && !isValidUuid) {
      await onLog(
        "stdout",
        `[paperclip] Claude session "${runtimeSessionId}" is not a valid UUID and will not be passed to --resume.\n`,
      );
    }
    if (
      runtimeSessionId &&
      isValidUuid &&
      !hasMatchingExecutionTarget
    ) {
      await onLog(
        "stdout",
        `[paperclip] Claude session "${runtimeSessionId}" does not match the current execution target and will not be resumed in "${effectiveExecutionCwd}". Starting a fresh session.\n`,
      );
    } else if (
      runtimeSessionId &&
      isValidUuid &&
      runtimeSessionCwd.length > 0 &&
      !hasMatchingSessionCwd
    ) {
      await onLog(
        "stdout",
        `[paperclip] Claude session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${effectiveExecutionCwd}".\n`,
      );
    }
    if (runtimeSessionId && runtimePromptBundleKey.length > 0 && runtimePromptBundleKey !== promptBundle.bundleKey) {
      await onLog(
        "stdout",
        `[paperclip] Claude session "${runtimeSessionId}" was saved for prompt bundle "${runtimePromptBundleKey}" and will not be resumed with "${promptBundle.bundleKey}".\n`,
      );
    }
    if (runtimeSessionId && !hasMatchingMcpServers) {
      await onLog(
        "stdout",
        `[paperclip] Claude runtime MCP server set changed; loading current tools when resuming session "${runtimeSessionId}".\n`,
      );
    }
    const bootstrapPromptTemplate = asString(config.bootstrapPromptTemplate, "");
    const templateData = {
      agentId: agent.id,
      companyId: agent.companyId,
      runId,
      company: { id: agent.companyId },
      agent,
      run: { id: runId, source: "on_demand" },
      context,
    };
    const passesConfiguredModel = Boolean(
      model && (!isBedrockAuth(modelEnv) || isBedrockModelId(model)),
    );

    const buildClaudeArgs = (
      resumeSessionId: string | null,
      attemptInstructionsFilePath: string | undefined,
    ) => {
      const args = ["--print", "--output-format", "stream-json", "--verbose"];
      // A sealed run's user setting source is the agent's own config folder.
      if (sealed || config.managedAiConnection) args.push("--setting-sources", "user");
      if (resumeSessionId) args.push("--resume", resumeSessionId);
      args.push(...buildClaudeExecutionPermissionArgs({
        dangerouslySkipPermissions,
        targetIsRemote: executionTargetIsRemote,
        localProcessUid: process.getuid?.() ?? null,
      }));
      if (chrome) args.push("--chrome");
      // For Bedrock: only pass --model when the ID is a Bedrock-native identifier
      // (e.g. "us.anthropic.*" or ARN). Anthropic-style IDs like "claude-opus-4-6" are invalid
      // on Bedrock, so skip them and let the CLI use its own configured model.
      if (passesConfiguredModel) {
        args.push("--model", model);
      }
      if (effectiveEffort) args.push("--effort", effectiveEffort);
      if (maxTurns > 0) args.push("--max-turns", String(maxTurns));
      // On resumed sessions the instructions are already in the session cache;
      // re-injecting them via --append-system-prompt-file wastes 5-10K tokens
      // per heartbeat and the Claude CLI may reject the combination outright.
      if (attemptInstructionsFilePath && !resumeSessionId) {
        args.push("--append-system-prompt-file", attemptInstructionsFilePath);
      }
      if (sealed) {
        // Always the `paperclip` server (a run without it doesn't start), strictly. Skills load
        // as plugins: the bundle's `paperclip` and `company`, then the run's `project`. The bundle
        // isn't passed with --add-dir; only the repo root is, for its CLAUDE.md.
        args.push("--mcp-config", effectiveMcpConfigPath, "--strict-mcp-config");
        args.push("--plugin-dir", promptBundle.pluginDir);
        if (sealed.runPluginsDir) args.push("--plugin-dir", sealed.runPluginsDir);
        if (sealed.claudeMd.addDir) args.push("--add-dir", sealed.claudeMd.addDir);
      } else {
        if (runtimeMcpServers.length > 0) {
          args.push("--mcp-config", effectiveMcpConfigPath, "--strict-mcp-config");
        }
        args.push("--add-dir", effectivePromptBundleAddDir);
      }
      if (extraArgs.length > 0) args.push(...extraArgs);
      return args;
    };

    const parseFallbackErrorMessage = (proc: RunProcessResult) => {
      const stderrLine =
        proc.stderr
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean) ?? "";

      if ((proc.exitCode ?? 0) === 0) {
        return "Failed to parse claude JSON output";
      }

      return stderrLine
        ? `Claude exited with code ${proc.exitCode ?? -1}: ${stderrLine}`
        : `Claude exited with code ${proc.exitCode ?? -1}`;
    };

    /**
     * The sealed launch as data (design, "Keep the launch portable"): what the local starter
     * spawns, with the manifest that describes it. Nothing changes it before the spawn.
     */
    const buildSealedLaunch = (input: {
      sealedRun: SealedClaudeRun;
      args: string[];
      resumeSessionId: string | null;
      attemptInstructionsFilePath: string | undefined;
      freshReason: ClaudeFreshSessionReason;
    }): SealedClaudeLaunch => {
      const launchEnv = buildSealedLaunchEnv(env, input.sealedRun);
      const session: ClaudeRunSessionStart = input.resumeSessionId
        ? { mode: "resumed", sessionId: input.resumeSessionId }
        : { mode: "fresh", reason: input.freshReason };
      return {
        command,
        args: input.args,
        env: launchEnv,
        cwd,
        files: {
          configDir: input.sealedRun.configDir,
          pluginDir: promptBundle.pluginDir,
          runPluginsDir: input.sealedRun.runPluginsDir,
          mcpConfigPath: effectiveMcpConfigPath,
          claudeMdRoot: input.sealedRun.claudeMd.addDir,
        },
        manifest: buildClaudeRunManifest({
          configDir: input.sealedRun.configDir,
          credential: input.sealedRun.credential,
          setAside: input.sealedRun.setAside,
          overriddenEnv: input.sealedRun.overriddenEnv,
          skills: mountableSkillEntries,
          repoSkills: input.sealedRun.repoSkills,
          mcpServers: runtimeMcpServers,
          access: context.paperclipAgentAccess,
          github: context.paperclipGitHub,
          instructions: {
            entryFile: instructionsFilePath || null,
            // The agent's instructions went out with --append-system-prompt-file: a fresh
            // session, and the entry file was read (the directive is set only then).
            sent: Boolean(instructionsPathDirective && input.attemptInstructionsFilePath && !input.resumeSessionId),
          },
          claudeMd: input.sealedRun.claudeMd.load,
          env: launchEnv,
          extraArgs,
          session,
        }),
      };
    };

    const runAttempt = async (resumeSessionId: string | null, freshReason: ClaudeFreshSessionReason) => {
      await hydrateFreshSessionHandoff(ctx, { resumedSession: Boolean(resumeSessionId) });
      const renderedBootstrapPrompt =
        !resumeSessionId && bootstrapPromptTemplate.trim().length > 0
          ? renderTemplate(bootstrapPromptTemplate, templateData).trim()
          : "";
      const { taskContextNote, wakePrompt } = selectPaperclipPromptSections(context, {
        resumedSession: Boolean(resumeSessionId),
        includeCommunicationGuidance: false,
      });
      const shouldUseResumeDeltaPrompt = Boolean(resumeSessionId) && wakePrompt.length > 0;
      const renderedPrompt = shouldUseResumeDeltaPrompt || isPaperclipRecoveryWakePayload(context.paperclipWake)
        ? ""
        : renderTemplate(promptTemplate, templateData);
      const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
      // Fresh sealed sessions are pointed at the `paperclip_*` tools, as ACP's are; resumed
      // sessions and external chat turns aren't.
      const paperclipMcpNote = sealed && !resumeSessionId && !isPaperclipExternalChatTurn(context.paperclipWake)
        ? renderPaperclipMcpNote(env, true)
        : "";
      const prompt = joinPromptSections([
        instructionsPathDirective,
        renderedBootstrapPrompt,
        selectInitialCommunicationGuidance(context, { resumedSession: Boolean(resumeSessionId) }),
        wakePrompt,
        sessionHandoffNote,
        taskContextNote,
        paperclipMcpNote,
        renderedPrompt,
      ]);
      const promptMetrics = {
        promptChars: prompt.length,
        bootstrapPromptChars: renderedBootstrapPrompt.length,
        wakePromptChars: wakePrompt.length,
        sessionHandoffChars: sessionHandoffNote.length,
        taskContextChars: taskContextNote.length,
        heartbeatPromptChars: renderedPrompt.length,
      };
      const attemptInstructionsFilePath = resumeSessionId ? undefined : effectiveInstructionsFilePath;
      const args = buildClaudeArgs(resumeSessionId, attemptInstructionsFilePath);
      const launch = sealed
        ? buildSealedLaunch({ sealedRun: sealed, args, resumeSessionId, attemptInstructionsFilePath, freshReason })
        : null;
      const commandNotes: string[] = [];
      if (launch) commandNotes.push(summarizeClaudeRunManifest(launch.manifest));
      if (!resumeSessionId) {
        commandNotes.push(`Using stable Claude prompt bundle ${promptBundle.bundleKey}.`);
      }
      if (dangerouslySkipPermissions && executionTargetIsRemote) {
        commandNotes.push(
          "Using full Claude permission bypass for remote execution, including connected tools.",
        );
      }
      if (attemptInstructionsFilePath && !resumeSessionId) {
        commandNotes.push(
          `Injected agent instructions via --append-system-prompt-file ${instructionsFilePath} (with current file location in the run prompt)`,
        );
      }
      if (runtimeMcpServers.length > 0) {
        commandNotes.push(
          `Using ${runtimeMcpServers.length} Paperclip-managed MCP server(s) from strict config ${effectiveMcpConfigPath}.`,
        );
      }
      if (onMeta) {
        await onMeta({
          adapterType: "claude_local",
          command: resolvedCommand,
          cwd: effectiveExecutionCwd,
          commandArgs: args,
          commandNotes,
          env: loggedEnv,
          prompt,
          promptMetrics,
          context,
          ...(launch ? { runManifest: launch.manifest as unknown as Record<string, unknown> } : {}),
        });
      }

      const consumeAccounting = createClaudeStreamParser();
      const accountingLog = createUsageCheckpointLog(onLog, ctx.onUsage, stdout => {
        const parsed = consumeAccounting(stdout);
        return { usage: parsed.usage ?? undefined, usageBasis: "per_run", costUsd: parsed.costUsd,
          provider: "anthropic", biller: isBedrockAuth(effectiveEnv) ? "aws_bedrock" : "anthropic",
          billingType, model: Object.keys(parseObject(parsed.resultJson?.modelUsage)).length > 1 ? "mixed" : parsed.model || model,
            usageByModel: claudeModelReceipts(parsed.resultJson?.modelUsage), complete: parsed.resultJson !== null };
      });
      const proc = await runAdapterExecutionTargetProcess(runId, runtimeExecutionTarget, launch?.command ?? command, launch?.args ?? args, {
        onProcessStopped: providerStop.beginInvocation(),
        cwd: launch?.cwd ?? cwd,
        // A sealed run gets the host allowlist and what Paperclip gives it, never the server's
        // whole environment.
        env: launch?.env ?? env,
        ...(launch ? { inheritHostEnv: false } : {}),
        stdin: prompt,
        timeoutSec,
        graceSec,
        onSpawn,
        onRuntimeProgress: ctx.onRuntimeProgress,
        onLog: accountingLog,
        runLogTail: paperclipBridge?.runLogTail,
        settleRunDisposition: paperclipBridge?.settleRunDisposition,
        terminalResultCleanup: {
          graceMs: terminalResultCleanupGraceMs,
          hasTerminalResult: ({ stdout }) => parseClaudeStreamJson(stdout).resultJson !== null,
        },
        localProcessSandbox,
      });
      await accountingLog.flush();

      const parsedStream = parseClaudeStreamJson(proc.stdout);
      const parsed = parsedStream.resultJson ?? parseJson(proc.stdout);
      return { proc, parsedStream, parsed };
    };

    const toAdapterResult = (
      attempt: {
        proc: RunProcessResult;
        parsedStream: ReturnType<typeof parseClaudeStreamJson>;
        parsed: Record<string, unknown> | null;
      },
      opts: { fallbackSessionId: string | null; clearSessionOnMissingSession?: boolean },
    ): AdapterExecutionResult => {
      const { proc, parsedStream, parsed } = attempt;
      const loginMeta = detectClaudeLoginRequired({
        parsed,
        stdout: proc.stdout,
        stderr: proc.stderr,
      });
      const errorMeta =
        loginMeta.loginUrl != null
          ? {
              loginUrl: loginMeta.loginUrl,
            }
          : undefined;

      if (proc.timedOut) {
        return {
          exitCode: proc.exitCode,
          signal: proc.signal,
          timedOut: true,
          usageComplete: parsedStream.resultJson !== null,
          usage: parsedStream.usage ?? undefined,
          usageBasis: "per_run",
          provider: "anthropic",
          biller: isBedrockAuth(effectiveEnv) ? "aws_bedrock" : "anthropic",
          model: Object.keys(parseObject(parsedStream.resultJson?.modelUsage)).length > 1 ? "mixed" : parsedStream.model || model,
          usageByModel: claudeModelReceipts(parsedStream.resultJson?.modelUsage),
          billingType,
          costUsd: parsedStream.costUsd,
          errorMessage: `Timed out after ${timeoutSec}s`,
          errorCode: "timeout",
          errorMeta,
          clearSession: Boolean(opts.clearSessionOnMissingSession),
        };
      }

      if (!parsed) {
        const fallbackErrorMessage = parseFallbackErrorMessage(proc);
        const providerQuota =
          !loginMeta.requiresLogin &&
          (proc.exitCode ?? 0) !== 0 &&
          isClaudeProviderQuotaError({
            parsed: null,
            stdout: proc.stdout,
            stderr: proc.stderr,
            errorMessage: fallbackErrorMessage,
          });
        const transientUpstream =
          !loginMeta.requiresLogin &&
          !providerQuota &&
          (proc.exitCode ?? 0) !== 0 &&
          isClaudeTransientUpstreamError({
            parsed: null,
            stdout: proc.stdout,
            stderr: proc.stderr,
            errorMessage: fallbackErrorMessage,
          });
        const transientRetryNotBefore = providerQuota || transientUpstream
          ? extractClaudeRetryNotBefore({
              parsed: null,
              stdout: proc.stdout,
              stderr: proc.stderr,
              errorMessage: fallbackErrorMessage,
            })
          : null;
        const errorCode = proc.errorCode
          // Forward the transport-level error code from the run-disposition seam
          // first, even on the unparsed path. A lost duplex control channel
          // surfaces the typed `duplex_channel_lost` code before any provider
          // classification, so the CLI lane and the ACP lane report it alike.
          ? proc.errorCode
          : loginMeta.requiresLogin
          ? "claude_auth_required"
          : isClaudeModelNotFoundError({
            parsed: null,
            stdout: proc.stdout,
            stderr: proc.stderr,
            errorMessage: fallbackErrorMessage,
          })
          ? "model_not_found"
          : providerQuota
          ? "provider_quota"
          : transientUpstream
          ? "claude_transient_upstream"
          : null;
        const errorFamily = providerQuota ? "provider_quota" : transientUpstream ? "transient_upstream" : null;
        return {
          exitCode: proc.exitCode,
          signal: proc.signal,
          timedOut: false,
          usageComplete: parsedStream.resultJson !== null,
          usage: parsedStream.usage ?? undefined,
          usageBasis: "per_run",
          provider: "anthropic",
          biller: isBedrockAuth(effectiveEnv) ? "aws_bedrock" : "anthropic",
          model: Object.keys(parseObject(parsedStream.resultJson?.modelUsage)).length > 1 ? "mixed" : parsedStream.model || model,
          usageByModel: claudeModelReceipts(parsedStream.resultJson?.modelUsage),
          billingType,
          costUsd: parsedStream.costUsd,
          errorMessage: fallbackErrorMessage,
          errorCode,
          errorFamily,
          retryNotBefore: transientRetryNotBefore ? transientRetryNotBefore.toISOString() : null,
          errorMeta,
          resultJson: {
            stdout: proc.stdout,
            stderr: proc.stderr,
            ...(errorFamily ? { errorFamily } : {}),
            ...(transientRetryNotBefore
              ? { retryNotBefore: transientRetryNotBefore.toISOString() }
              : {}),
            ...(transientRetryNotBefore
              ? { transientRetryNotBefore: transientRetryNotBefore.toISOString() }
              : {}),
            ...(providerQuota && transientRetryNotBefore
              ? { providerQuotaRetryNotBefore: transientRetryNotBefore.toISOString() }
              : {}),
            ...(proc.terminalResultCleanup ? { unmanagedBackgroundTask: proc.terminalResultCleanup } : {}),
          },
          clearSession: Boolean(opts.clearSessionOnMissingSession),
        };
      }

      const fallbackModelUsageTotals = parsedStream.usage ? null : claudeModelUsageTotals(parsed.modelUsage);
      const usage =
        parsedStream.usage ??
        fallbackModelUsageTotals ??
        (() => {
          const usageObj = parseObject(parsed.usage);
          return {
            inputTokens: asNumber(usageObj.input_tokens, 0),
            cachedInputTokens: asNumber(usageObj.cache_read_input_tokens, 0),
            outputTokens: asNumber(usageObj.output_tokens, 0),
          };
        })();
      const usageBasis = parsedStream.usage
        ? parsedStream.usageBasis
        : fallbackModelUsageTotals
        ? ("per_run" as const)
        : null;

      const rawResolvedSessionId =
        parsedStream.sessionId ??
        (asString(parsed.session_id, opts.fallbackSessionId ?? "") || opts.fallbackSessionId);
      const clearSessionForMaxTurns = isClaudeMaxTurnsResult(parsed);
      const poisonedPreviousMessageId = isClaudePoisonedPreviousMessageIdError(parsed);
      // Fable 5 policy refusals exit cleanly (exitCode=0, is_error=false), so this
      // is intentionally independent of `failed` — otherwise a refusal looks like a
      // successful run to Paperclip and the heartbeat stalls silently. See RY-604.
      const claudeRefusal = isClaudeRefusalResult(parsed);
      const parsedIsError = asBoolean(parsed.is_error, false);
      const parsedSubtype = asString(parsed.subtype, "").trim().toLowerCase();
      const parsedSucceeded = parsedSubtype === "success" && !parsedIsError;
      const failed = !parsedSucceeded && ((proc.exitCode ?? 0) !== 0 || parsedIsError);
      // Validate-before-persist guard: never persist a sessionId whose transcript
      // is known-poisoned. The Claude CLI keeps an on-disk JSONL keyed by the
      // session id; if the last entry contains a non-`msg_`-prefixed
      // `previous_message_id`, every subsequent `--resume` hits a 400 from
      // /v1/messages and the issue is permanently unrecoverable until the
      // sessionId is dropped server-side. Drop here so resolveNextSessionState
      // calls clearTaskSessions on the next heartbeat. See RED-978 / RED-976.
      const shouldDropSessionForPoison = poisonedPreviousMessageId;
      const resolvedSessionId = shouldDropSessionForPoison ? null : rawResolvedSessionId;
      const resolvedSessionParams = resolvedSessionId
        ? ({
          sessionId: resolvedSessionId,
          ...(sshSessionState ? { sshClaudeConversationId: sshSessionState.conversationId, sshClaudeAccountScope: sshSessionState.scope } : {}),
          cwd,
          promptBundleKey: promptBundle.bundleKey,
          mcpServerIdentity: runtimeMcpIdentity,
          ...(executionTargetIsRemote
            ? {
                remoteExecution: adapterExecutionTargetSessionIdentity(runtimeExecutionTarget),
              }
            : {}),
          ...(workspaceId ? { workspaceId } : {}),
          ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
          ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
        } as Record<string, unknown>)
        : null;
      const errorMessage = failed
        ? describeClaudeFailure(parsed) ?? `Claude exited with code ${proc.exitCode ?? -1}`
        : null;
      const providerQuota =
        failed &&
        !loginMeta.requiresLogin &&
        !clearSessionForMaxTurns &&
        !poisonedPreviousMessageId &&
        isClaudeProviderQuotaError({
          parsed,
          stdout: proc.stdout,
          stderr: proc.stderr,
          errorMessage,
        });
      const transientUpstream =
        failed &&
        !loginMeta.requiresLogin &&
        !clearSessionForMaxTurns &&
        !poisonedPreviousMessageId &&
        !providerQuota &&
        isClaudeTransientUpstreamError({
          parsed,
          stdout: proc.stdout,
          stderr: proc.stderr,
          errorMessage,
        });
      const transientRetryNotBefore = providerQuota || transientUpstream
        ? extractClaudeRetryNotBefore({
            parsed,
            stdout: proc.stdout,
            stderr: proc.stderr,
            errorMessage,
          })
        : null;
      const resolvedErrorCode = proc.errorCode
        // Forward the transport-level error code from the run-disposition seam
        // first. A lost duplex control channel surfaces the typed
        // `duplex_channel_lost` code before any provider classification.
        ? proc.errorCode
        : loginMeta.requiresLogin
        ? "claude_auth_required"
        // Structured CLI signals outrank the model-not-found detector, which
        // scans the run's full stdout for a literal "model not found" phrase.
        // An agent's own tool output (grepping runtime source, tailing logs,
        // echoing an issue body) lands in that stdout, so a genuine
        // error_max_turns run that merely *mentions* the phrase would otherwise
        // be sealed as model_not_found. Same guard the providerQuota and
        // transientUpstream branches above already apply.
        : failed && !clearSessionForMaxTurns && !poisonedPreviousMessageId && isClaudeModelNotFoundError({
          parsed,
          stdout: proc.stdout,
          stderr: proc.stderr,
          errorMessage,
        })
        ? "model_not_found"
        : failed && clearSessionForMaxTurns
        ? "max_turns_exhausted"
        : failed && poisonedPreviousMessageId
        ? "claude_poisoned_previous_message_id"
        : providerQuota
        ? "provider_quota"
        : transientUpstream
        ? "claude_transient_upstream"
        : claudeRefusal
        ? "claude_refusal"
        : null;
      const errorFamily = providerQuota
        ? "provider_quota"
        : transientUpstream
        ? "transient_upstream"
        : claudeRefusal
        ? "model_refusal"
        : null;
      const mergedResultJson: Record<string, unknown> = {
        ...parsed,
        ...(sshSessionState && runtimeSessionId && !sshSessionState.canResume
          ? { sessionReset: { code: "claude_ssh_session_state_unavailable" } } : {}),
        ...(failed && clearSessionForMaxTurns ? { stopReason: "max_turns_exhausted" } : {}),
        ...(failed && poisonedPreviousMessageId ? { stopReason: "claude_poisoned_previous_message_id" } : {}),
        ...(claudeRefusal ? { stopReason: "refusal", errorFamily: "model_refusal" } : {}),
        ...(errorFamily ? { errorFamily } : {}),
        ...(transientRetryNotBefore ? { retryNotBefore: transientRetryNotBefore.toISOString() } : {}),
        ...(transientRetryNotBefore ? { transientRetryNotBefore: transientRetryNotBefore.toISOString() } : {}),
        ...(providerQuota && transientRetryNotBefore ? { providerQuotaRetryNotBefore: transientRetryNotBefore.toISOString() } : {}),
        ...(proc.terminalResultCleanup ? { unmanagedBackgroundTask: proc.terminalResultCleanup } : {}),
      };

      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: false,
        usageComplete: parsedStream.resultJson !== null || parsed.type === "result",
        errorMessage,
        errorCode: resolvedErrorCode,
        errorFamily,
        retryNotBefore: transientRetryNotBefore ? transientRetryNotBefore.toISOString() : null,
        errorMeta,
        usage,
        usageByModel: claudeModelReceipts(parsed.modelUsage),
        ...(usageBasis ? { usageBasis } : {}),
        sessionId: resolvedSessionId,
        sessionParams: resolvedSessionParams,
        sessionDisplayId: resolvedSessionId,
        provider: "anthropic",
        biller: isBedrockAuth(effectiveEnv) ? "aws_bedrock" : "anthropic",
        model: Object.keys(parseObject(parsed.modelUsage)).length > 1 ? "mixed" : parsedStream.model || asString(parsed.model, model),
        billingType,
        costUsd: parsedStream.costUsd,
        resultJson: mergedResultJson,
        summary: parsedStream.summary || asString(parsed.result, ""),
        clearSession:
          clearSessionForMaxTurns ||
          // Clear-on-error: a poisoned previous_message_id is a deterministic
          // state error. Force the server to drop persisted session state for
          // this issue so the next continuation starts from a clean slate.
          poisonedPreviousMessageId ||
          Boolean(opts.clearSessionOnMissingSession && !resolvedSessionId),
      };
    };

    const minimumCliVersion = passesConfiguredModel && claudeCommandLooksLike(command, "claude")
      ? minimumClaudeCliVersionForModel(model)
      : null;
    if (minimumCliVersion) {
      const prepared = await prepareCompatibleClaudeCommand({
        runId,
        command,
        target: runtimeExecutionTarget,
        cwd,
        env,
        timeoutSec,
        graceSec,
        minimumVersion: minimumCliVersion,
      });
      if (prepared.check) {
        await onLog("stderr", `[paperclip] ${prepared.check.message} ${prepared.check.detail ?? ""}\n`);
      }
      command = prepared.command;
      resolvedCommand = prepared.command === "claude" ? resolvedCommand : prepared.command;
      loggedEnv = buildInvocationEnvForLogs(env, {
        runtimeEnv: loggedEnv,
        includeRuntimeKeys: ["HOME", "CLAUDE_CONFIG_DIR"],
        resolvedCommand,
      });
      const detectedCliVersion = prepared.version;
      if (
        !detectedCliVersion ||
        !claudeCliVersionAtLeast(detectedCliVersion, minimumCliVersion)
      ) {
        const detected = detectedCliVersion
          ? `detected ${detectedCliVersion}`
          : "could not determine the installed version";
        const errorMessage =
          `${model} requires Claude Code ${minimumCliVersion} or newer on the CLI lane; ${detected}. ` +
          "Upgrade Claude Code or restore the default ACP lane before retrying.";
        await onLog("stderr", `[paperclip] ${errorMessage}\n`);
        return {
          exitCode: 1,
          signal: null,
          timedOut: false,
          errorMessage,
          errorCode: "claude_cli_version_incompatible",
          provider: "anthropic",
          biller: isBedrockAuth(effectiveEnv) ? "aws_bedrock" : "anthropic",
          model,
          billingType,
          resultJson: {
            stopReason: "claude_cli_version_incompatible",
            requiredClaudeCodeVersion: minimumCliVersion,
            detectedClaudeCodeVersion: detectedCliVersion,
          },
        };
      }
    }

    if (executionTargetIsSandbox && effort) {
      const supportsEffort = await claudeCommandSupportsEffortFlag({
        runId,
        command,
        target: runtimeExecutionTarget,
        cwd,
        env,
        timeoutSec,
        graceSec,
      });
      if (supportsEffort === false) {
        effectiveEffort = "";
        await onLog(
          "stderr",
          `[paperclip] Claude CLI in the environment does not advertise --effort; omitting configured effort "${effort}". Upgrade the environment CLI/image to restore reasoning-effort control.\n`,
        );
      }
    }

    const initial = await runAttempt(sessionId ?? null, freshSessionReason);
    const sessionErrorKind =
      sessionId &&
      !initial.proc.timedOut &&
      (initial.proc.exitCode ?? 0) !== 0 &&
      initial.parsed
        ? isClaudeUnknownSessionError(initial.parsed)
          ? "unknown"
          : isClaudePoisonedPreviousMessageIdError(initial.parsed)
          ? "poisoned"
          : isClaudeImageProcessingError(initial.parsed)
          ? "image"
          : null
        : null;

    if (sessionErrorKind !== null) {
      const reason =
        sessionErrorKind === "poisoned"
          ? "returned a poisoned message-id"
          : sessionErrorKind === "image"
          ? "contains an unprocessable image"
          : "is unavailable";
      await onLog(
        "stdout",
        `[paperclip] Claude resume session "${sessionId}" ${reason}; retrying with a fresh session.\n`,
      );
      if (sessionErrorKind === "poisoned" && !executionTargetIsRemote) {
        const claudeConfigDir = sealed?.configDir ?? resolveSharedClaudeConfigDir(effectiveEnv);
        // Mirrors Claude Code's project-dir encoding: non-alphanumeric chars become "-"; existing hyphens pass through.
        const encodedCwd = effectiveExecutionCwd.replace(/[^a-zA-Z0-9-]/g, "-");
        const poisonedJsonlPath = path.join(claudeConfigDir, "projects", encodedCwd, `${sessionId}.jsonl`);
        let unlinked = false;
        try {
          await fs.unlink(poisonedJsonlPath);
          unlinked = true;
        } catch {
          // best-effort; session is cleared server-side regardless
        }
        if (unlinked) {
          try {
            await onLog("stdout", `[paperclip] Removed poisoned session file: ${poisonedJsonlPath}\n`);
          } catch {
            // log stream may be closed; the unlink already succeeded
          }
        }
      }
      const retry = await runAttempt(null, "session_unavailable");
      return toAdapterResult(retry, { fallbackSessionId: null, clearSessionOnMissingSession: true });
    }

    return toAdapterResult(initial, { fallbackSessionId: !sshSessionState || sshSessionState.canResume ? runtimeSessionId || runtime.sessionId : null });
  } finally {
    try {
      await providerStop.collectBeforeRestore();
    } finally {
      try {
        if (paperclipBridge) {
          await paperclipBridge.stop();
        }
      } finally {
        try {
          await sshSessionState?.cleanup();
        } finally {
          if (restoreRemoteWorkspace) {
            await onLog(
              "stdout",
              `[paperclip] Restoring workspace changes from ${describeAdapterExecutionTarget(executionTarget)}.\n`,
            ).catch(() => undefined);
            await restoreRemoteWorkspace();
          }
        }
      }
    }
  }
}
