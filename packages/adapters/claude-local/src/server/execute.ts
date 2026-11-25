import { applyObservabilityEnvironment } from "@paperclipai/adapter-utils/agent-observability";
import { createProviderStoppedBoundary } from "@paperclipai/adapter-utils/provider-stopped-boundary";
import { createUsageCheckpointLog } from "@paperclipai/adapter-utils/usage-checkpoint";
import { prepareSshConversationState } from "@paperclipai/adapter-utils/ssh-conversation-state";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import type { ClaudeFreshSessionReason, ClaudeRunCredential } from "@paperclipai/shared";
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
  parseObject,
  parseJson,
  buildInvocationEnvForLogs,
  ensureAbsoluteDirectory,
  ensurePathInEnv,
  refreshPaperclipWorkspaceEnvForExecution,
  hydrateFreshSessionHandoff,
} from "@paperclipai/adapter-utils/server-utils";
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
import { composeClaudeCliPrompt, resolveClaudePromptTemplate } from "./legacy-prompt.js";
import { buildClaudePromptRecord, PROMPT_SECTIONS_MISMATCH_NOTE, readRunPromptPlan } from "./prompt-record.js";
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
import { isBedrockModelId } from "./models.js";
import { prepareClaudePromptBundle } from "./prompt-cache.js";
import { buildClaudeExecutionPermissionArgs, claudeSandboxPermissionEnv } from "./permissions.js";
import { resolveClaudeModel, SANDBOX_INSTALL_COMMAND } from "../index.js";
import {
  createClaudeAcpExecutor,
  resolveClaudeExecutionEngineForRun,
} from "./acp.js";
import { CLAUDE_CREDENTIAL_MISSING } from "./sealed-env.js";
import { summarizeClaudeRunManifest, type ClaudeRunSessionStart, type SealedClaudeLaunch } from "./run-manifest.js";
import {
  actSealedClaudeRun,
  buildClaudeRunEnvironment,
  buildSealedLaunchEnv,
  buildSealedRunManifest,
  planClaudeRunSkillsAndInstructions,
  planSealedClaudeRun,
  sealedRunBlockers,
  type SealedClaudeRun,
} from "./run-plan.js";

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
 * run token, then a Claude credential from Paperclip (section 7). Returns the refusal (the first
 * blocker), or the credential.
 */
function checkSealedRunGates(input: {
  ctx: AdapterExecutionContext;
  env: Record<string, string>;
}): { refusal: AdapterExecutionResult; credential: null } | { refusal: null; credential: ClaudeRunCredential } {
  const { ctx, env } = input;
  const { blockers, credential } = sealedRunBlockers({
    authToken: ctx.authToken,
    runtimeMcpServers: ctx.runtimeMcp?.getServers() ?? [],
    env,
    config: ctx.config,
    context: ctx.context,
  });
  const first = blockers[0];
  if (first || !credential) {
    const blocker = first ?? { code: CLAUDE_CREDENTIAL_MISSING, message: "This run has no Claude credential from Paperclip." };
    return { refusal: sealedRunRefusal(blocker.code, blocker.message), credential: null };
  }
  return { refusal: null, credential };
}

async function buildClaudeRuntimeConfig(input: ClaudeExecutionInput): Promise<ClaudeRuntimeConfig> {
  const { runId, config, runtimeCommandSpec, executionTarget } = input;
  const onLog = input.onLog ?? (async () => {});
  const { command, cwd, workspaceId, workspaceRepoUrl, workspaceRepoRef, env, extraArgs } = buildClaudeRunEnvironment({
    agentIdentity: input.agentIdentity,
    runId,
    agent: input.agent,
    config,
    context: input.context,
    executionTarget,
    authToken: input.authToken,
  });
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

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

  const promptTemplate = resolveClaudePromptTemplate(config);
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
    const sealedPlan = await planSealedClaudeRun({
      runId,
      agent,
      config,
      configEnv,
      workspaceContext,
      cwd,
      env,
      credential: gates.credential,
    });
    sealed = await actSealedClaudeRun(sealedPlan, { agent, runCleanups, onLog });
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
  const {
    mountableSkillEntries,
    missingSkillEntries,
    instructionsReadError,
    instructionsPathDirective,
    combinedInstructionsContents,
    systemPromptSections,
  } = await planClaudeRunSkillsAndInstructions({ config, moduleDir: __moduleDir, agent, sealed: Boolean(sealed), context });
  if (instructionsReadError) {
    await onLog(
      "stderr",
      `[paperclip] Warning: could not read agent instructions file "${instructionsFilePath}": ${instructionsReadError}\n`,
    );
  }
  // Missing-source entries never reach the bundle (the planner leaves them out). Log each one
  // so the cause lands in the run output.
  for (const entry of missingSkillEntries) {
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
      // A sealed run passes the system prompt file on resumed sessions too (bug 90): Claude
      // ignores it until the session is compacted, then rebuilds the system prompt from it. The
      // session resumes only under the same bundle key, so it's the text the session started
      // with. Unsealed runs (the dormant remote paths) pass it on fresh sessions only; the caller
      // leaves `attemptInstructionsFilePath` unset there on a resume.
      if (attemptInstructionsFilePath) {
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
        manifest: buildSealedRunManifest({
          sealedRun: input.sealedRun,
          skills: mountableSkillEntries,
          runtimeMcpServers,
          context,
          instructionsFilePath,
          // The system prompt file went out with --append-system-prompt-file: every sealed run
          // (a resumed session uses it only after a compaction).
          instructionsSent: Boolean(input.attemptInstructionsFilePath),
          launchEnv,
          extraArgs,
          session,
        }),
      };
    };

    const runAttempt = async (resumeSessionId: string | null, freshReason: ClaudeFreshSessionReason) => {
      await hydrateFreshSessionHandoff(ctx, { resumedSession: Boolean(resumeSessionId) });
      const { prompt, promptMetrics } = composeClaudeCliPrompt({
        context,
        resumed: Boolean(resumeSessionId),
        instructionsPathDirective,
        promptTemplate,
        templateData,
        sealed: Boolean(sealed),
      });
      // Sealed runs send the system prompt file with every run (bug 90); unsealed ones on fresh
      // sessions only.
      const attemptInstructionsFilePath = sealed || !resumeSessionId ? effectiveInstructionsFilePath : undefined;
      // What this attempt sent, as the heartbeat's prompt sections when they join to exactly
      // the prompt above; it records, and never changes, the text.
      const runPromptPlan = readRunPromptPlan(context);
      const promptRecord = buildClaudePromptRecord({
        plan: runPromptPlan,
        resumed: Boolean(resumeSessionId),
        prompt,
        systemPrompt: attemptInstructionsFilePath ? systemPromptSections : [],
      });
      if (runPromptPlan && !promptRecord.matchedPlan) await onLog("stderr", PROMPT_SECTIONS_MISMATCH_NOTE);
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
      if (attemptInstructionsFilePath && sealed) {
        commandNotes.push(resumeSessionId
          ? `Passed the system prompt file with --append-system-prompt-file ${attemptInstructionsFilePath}; Claude uses it on this resumed session only after a compaction.`
          : `Passed the system prompt file with --append-system-prompt-file ${attemptInstructionsFilePath} (with the current instructions location in the run prompt).`);
      } else if (attemptInstructionsFilePath && !resumeSessionId) {
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
          // A sealed launch logs what it spawns with (redacted the same way), not the
          // pre-launch env, which still holds the blanked variables the launch drops.
          env: launch ? buildInvocationEnvForLogs(launch.env, { resolvedCommand }) : loggedEnv,
          prompt,
          promptMetrics,
          promptRecord,
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
          "Upgrade Claude Code or set engine to acp before retrying.";
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
