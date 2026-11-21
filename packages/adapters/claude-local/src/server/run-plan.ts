import { isOpenRouterUrl, openRouterClaudeHeaders } from "@paperclipai/shared/openrouter-attribution";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext, AdapterRuntimeMcpServer } from "@paperclipai/adapter-utils";
import type { ClaudeMdLoad, ClaudeRepoSkillsLoad, ClaudeRunCredential, ClaudeRunPreviewBlocker } from "@paperclipai/shared";
import {
  adapterExecutionTargetIsRemote,
  adapterExecutionTargetRemoteCwd,
  type readAdapterExecutionTarget,
} from "@paperclipai/adapter-utils/execution-target";
import {
  asString,
  asStringArray,
  parseObject,
  applyPaperclipWorkspaceEnv,
  buildPaperclipEnv,
  hasPaperclipMcpServer,
  isForbiddenConfigEnvKey,
  isPaperclipRuntimeEnvKey,
  isPaperclipSkillSourceMissing,
  readPaperclipIssueWorkModeFromContext,
  readPaperclipRuntimeSkillEntries,
  rewriteWorkspaceCwdEnvVarsForExecution,
  shapePaperclipWorkspaceEnvForExecution,
} from "@paperclipai/adapter-utils/server-utils";
import { buildSkillLibraryManifestMarkdown } from "@paperclipai/adapter-utils/skill-library-manifest";
import { resolveClaudeDesiredSkillNames } from "./skills.js";
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
import { buildClaudeRunManifest, type ClaudeRunSessionStart } from "./run-manifest.js";

/**
 * A sealed `claude_local` CLI launch in two halves (fork/step-4b-parts-2-3.md, part 2): planning,
 * which reads (the agent's settings, the repo's `CLAUDE.md` and skills, the instructions file)
 * and writes nothing, and acting, which makes the folders and files the plan names. A run does
 * both; the run preview (`preview.ts`) does only the planning, so the two can't disagree.
 */

type ExecutionTarget = ReturnType<typeof readAdapterExecutionTarget>;

// --- The run's environment ---------------------------------------------------

/** The run's environment before sealing, and the workspace values it was built from. Pure. */
export interface ClaudeRunEnvironment {
  command: string;
  /** The run's working folder (created by the run if missing, never by planning). */
  cwd: string;
  workspaceId: string | null;
  workspaceRepoUrl: string | null;
  workspaceRepoRef: string | null;
  env: Record<string, string>;
  extraArgs: string[];
}

/**
 * The run's environment: Paperclip's own variables, the workspace's, then the agent's `env`
 * (config values never replace a runtime `PAPERCLIP_*` key, and `PAPERCLIP_API_KEY` comes only
 * from the run token). Reads nothing and writes nothing.
 */
export function buildClaudeRunEnvironment(input: {
  agentIdentity?: AdapterExecutionContext["agentIdentity"];
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  context: Record<string, unknown>;
  executionTarget?: ExecutionTarget;
  authToken?: string;
}): ClaudeRunEnvironment {
  const { runId, agent, config, context, executionTarget, authToken } = input;
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
  const effectiveExecutionCwd = adapterExecutionTargetRemoteCwd(executionTarget, cwd);
  const shapedWorkspaceEnv = shapePaperclipWorkspaceEnvForExecution({
    workspaceCwd: effectiveWorkspaceCwd,
    workspaceWorktreePath,
    workspaceHints,
    executionTargetIsRemote,
    executionCwd: effectiveExecutionCwd,
  });

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

  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (issueWorkMode) env.PAPERCLIP_ISSUE_WORK_MODE = issueWorkMode;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
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

  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();

  return { command, cwd, workspaceId, workspaceRepoUrl, workspaceRepoRef, env, extraArgs };
}

// --- What a sealed run needs before it starts (section 7) --------------------

/**
 * Why a sealed run would be refused before any Claude process, in the order the run checks
 * them: no run token, no `paperclip` MCP server, no Claude credential from Paperclip. A run
 * refuses with the first; a preview lists them all.
 */
export function sealedRunBlockers(input: {
  authToken: string | undefined;
  runtimeMcpServers: readonly AdapterRuntimeMcpServer[];
  env: Record<string, string>;
  config: Record<string, unknown>;
  context: Record<string, unknown>;
}): { blockers: ClaudeRunPreviewBlocker[]; credential: ClaudeRunCredential | null } {
  const blockers: ClaudeRunPreviewBlocker[] = [];
  if (!input.authToken) {
    blockers.push({
      code: PAPERCLIP_MCP_UNAVAILABLE,
      message:
        "This run has no Paperclip run token, so it can't reach the `paperclip` MCP server to finish or block its work. " +
        "Set PAPERCLIP_AGENT_JWT_SECRET (or BETTER_AUTH_SECRET) on the Paperclip server.",
    });
  } else if (!hasPaperclipMcpServer(input.runtimeMcpServers)) {
    blockers.push({
      code: PAPERCLIP_MCP_UNAVAILABLE,
      message:
        "This run has no `paperclip` MCP server, so it can't finish or block its work. " +
        "Set PAPERCLIP_API_URL on the Paperclip server to the address runs reach it at.",
    });
  }
  const credential = resolveClaudeRunCredential({
    env: input.env,
    managedAiConnection: input.config.managedAiConnection,
    managedAiRouting: input.config.managedAiRouting,
    connectionName: asString(input.context.paperclipAiConnectionName, "") || null,
  });
  if (!credential) {
    blockers.push({
      code: CLAUDE_CREDENTIAL_MISSING,
      message:
        "This run has no Claude credential from Paperclip, and runs don't use the server's own Claude login. " +
        "Give the agent a managed AI connection, or add a secret to the agent's environment: " +
        "CLAUDE_CODE_OAUTH_TOKEN (a subscription token), ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN with ANTHROPIC_BASE_URL, " +
        "or CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_USE_VERTEX or CLAUDE_CODE_USE_FOUNDRY with that provider's settings.",
    });
  }
  return { blockers, credential };
}

// --- The sealed run: plan, then act -----------------------------------------

/** Keys the sealed launch replaces in the agent's `env` when it has no managed connection. */
export const SEALED_HOME_ENV_KEYS = ["HOME", "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"] as const;

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** What a sealed run will get, decided before anything is made. */
export interface SealedClaudeRunPlan {
  credential: ClaudeRunCredential;
  configDir: string;
  setAsideDir: string;
  overriddenEnv: string[];
  /** The run gets Paperclip's temporary `HOME` (and `XDG_*` folders under it). */
  sealedHome: boolean;
  /**
   * Values the launch sets over the agent's `env`, after the sealed `HOME`'s: `CLAUDE_CONFIG_DIR`,
   * the `CLAUDE.md` switch's variable, and `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, last.
   */
  envOverrides: Record<string, string>;
  repoRoot: string | null;
  claudeMd: { load: ClaudeMdLoad; addDir: string | null };
  repoSkills: { load: ClaudeRepoSkillsLoad; skills: RepoSkill[] };
  /** The per-run plugins folder the repo's skills load from, when they load (not made yet). */
  runPluginsDir: string | null;
}

/**
 * Plans a sealed local run after its gates: Paperclip's `HOME` (without a managed connection,
 * or with one that brings none), the agent's config folder, and what the run takes from its
 * repo (fork/step-4b-plan.md, Task 8). Reads the repo's `CLAUDE.md` and `.claude/skills`; writes
 * nothing.
 */
export async function planSealedClaudeRun(input: {
  runId: string;
  agent: AdapterExecutionContext["agent"];
  config: Record<string, unknown>;
  configEnv: Record<string, unknown>;
  workspaceContext: Record<string, unknown>;
  cwd: string;
  env: Record<string, string>;
  credential: ClaudeRunCredential;
}): Promise<SealedClaudeRunPlan> {
  const { runId, agent, config, configEnv, workspaceContext, cwd, env, credential } = input;
  const managedConnection = Boolean(config.managedAiConnection);
  // A managed connection brings its own temporary HOME; anything else gets Paperclip's, so the
  // server user's home never reaches a run. A managed connection without one gets it too.
  const sealedHome = !managedConnection || !asString(env.HOME, "").trim();
  const configDir = resolveAgentClaudeConfigDir(process.env, agent.companyId, agent.id);
  const setAsideDir = resolveAgentClaudeSetAsideDir(process.env, agent.companyId, agent.id, runId);
  const envOverrides: Record<string, string> = { CLAUDE_CONFIG_DIR: configDir };

  // The sealed HOME is a fresh temporary folder, which a configured value never equals; the
  // config folder is the agent's own.
  const overriddenEnv = managedConnection
    ? []
    : SEALED_HOME_ENV_KEYS.filter((key) => {
        const configured = configEnv[key];
        if (typeof configured !== "string" || configured.trim().length === 0) return false;
        return key === "CLAUDE_CONFIG_DIR" ? configured !== configDir : true;
      });

  // The repo's root CLAUDE.md and its skills, from the run's own checkout, when its project
  // allows them.
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
  const runPluginsDir = repoSkills.load.enabled && repoRoot
    ? resolveRunPluginsDir(process.env, agent.companyId, agent.id, runId)
    : null;
  if (claudeMd.addDir) envOverrides.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD = "1";
  // Last, so nothing overrides it.
  envOverrides.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";

  return {
    credential,
    configDir,
    setAsideDir,
    overriddenEnv,
    sealedHome,
    envOverrides,
    repoRoot,
    claudeMd,
    repoSkills,
    runPluginsDir,
  };
}

/**
 * What a sealed local run gets from Paperclip beyond the agent's own `env`
 * (fork/step-4b-sealed-runs.md, sections 2, 5 and 6), once its plan is carried out.
 */
export interface SealedClaudeRun {
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

/**
 * Carries out a sealed run's plan: makes the temporary `HOME`, makes the agent's config folder
 * and sets aside stray configuration in it, and writes the repo skills' `project` plugin.
 * Cleanups go into `runCleanups`, which the caller runs after the run.
 */
export async function actSealedClaudeRun(
  plan: SealedClaudeRunPlan,
  input: {
    agent: AdapterExecutionContext["agent"];
    runCleanups: Array<() => Promise<void>>;
    onLog: AdapterExecutionContext["onLog"];
  },
): Promise<SealedClaudeRun> {
  const envOverrides: Record<string, string> = {};
  if (plan.sealedHome) {
    const sealedHome = await createSealedRunHome(input.agent.id);
    input.runCleanups.push(() => sealedHome.cleanup());
    Object.assign(envOverrides, sealedHome.env);
  }
  const { setAside } = await prepareAgentClaudeConfigDir({ configDir: plan.configDir, setAsideDir: plan.setAsideDir });
  if (setAside.length > 0) {
    await input.onLog(
      "stdout",
      `[paperclip] Set aside ${setAside.join(", ")} from the agent's Claude config folder into ${plan.setAsideDir}: Paperclip didn't put them there, and they would have loaded as configuration.\n`,
    );
  }
  let runPluginsDir: string | null = null;
  if (plan.runPluginsDir && plan.repoRoot) {
    const dir = plan.runPluginsDir;
    // Registered first, so a half-built folder is removed too.
    input.runCleanups.push(() => removeRunPluginsDir(dir));
    runPluginsDir = await prepareRepoSkillsPlugin({ runPluginsDir: dir, repoRoot: plan.repoRoot, skills: plan.repoSkills.skills });
  }
  Object.assign(envOverrides, plan.envOverrides);
  return {
    credential: plan.credential,
    configDir: plan.configDir,
    setAside: { dir: plan.setAsideDir, entries: setAside },
    overriddenEnv: plan.overriddenEnv,
    envOverrides,
    claudeMd: plan.claudeMd,
    repoSkills: plan.repoSkills,
    runPluginsDir,
  };
}

/**
 * A plan as a preview sees it: nothing made, so nothing set aside, and the temporary `HOME` a
 * name under the system temp folder (only its variables' names reach the manifest).
 */
export function plannedSealedClaudeRun(plan: SealedClaudeRunPlan, agentId: string): SealedClaudeRun {
  const envOverrides: Record<string, string> = {};
  if (plan.sealedHome) {
    const safeAgentId = agentId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "agent";
    const home = path.join(os.tmpdir(), `paperclip-claude-home-${safeAgentId}-preview`);
    Object.assign(envOverrides, {
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, "config"),
      XDG_DATA_HOME: path.join(home, "data"),
      XDG_CACHE_HOME: path.join(home, "cache"),
    });
  }
  Object.assign(envOverrides, plan.envOverrides);
  return {
    credential: plan.credential,
    configDir: plan.configDir,
    setAside: { dir: plan.setAsideDir, entries: [] },
    overriddenEnv: plan.overriddenEnv,
    envOverrides,
    claudeMd: plan.claudeMd,
    repoSkills: plan.repoSkills,
    runPluginsDir: plan.runPluginsDir,
  };
}

/**
 * The environment a sealed launch spawns with: the host allowlist, the run's `env`, then the
 * sealed values. Empty values are dropped: a sealed run inherits nothing, so a variable set to
 * `""` to blank an inherited one (the managed connection's other providers' keys) guards nothing.
 */
export function buildSealedLaunchEnv(env: Record<string, string>, sealed: SealedClaudeRun): Record<string, string> {
  const launchEnv: Record<string, string> = { ...projectSealedHostEnvironment(process.env), ...env };
  for (const [key, value] of Object.entries(sealed.envOverrides)) {
    delete launchEnv[key];
    launchEnv[key] = value;
  }
  for (const [key, value] of Object.entries(launchEnv)) {
    if (value === "") delete launchEnv[key];
  }
  return launchEnv;
}

// --- Skills and instructions --------------------------------------------------

type RuntimeSkillEntry = Awaited<ReturnType<typeof readPaperclipRuntimeSkillEntries>>[number];

/** The run's library skills and agent instructions, read but not yet bundled. */
export interface ClaudeRunSkillsAndInstructions {
  claudeSkillEntries: RuntimeSkillEntry[];
  desiredSkillNames: Set<string>;
  /** The agent's skills whose files are unavailable: left out, with a warning. */
  missingSkillEntries: RuntimeSkillEntry[];
  /** The skills mounted in the prompt bundle. */
  mountableSkillEntries: RuntimeSkillEntry[];
  instructionsFilePath: string;
  /** Why the instructions file couldn't be read, or null. */
  instructionsReadError: string | null;
  /** Set only when the instructions file was read. */
  instructionsPathDirective: string;
  /** The bundle's instructions file contents: the agent's instructions and the skill library list. */
  combinedInstructionsContents: string | null;
}

/** Reads the run's skills and the agent's instructions file; writes nothing. */
export async function planClaudeRunSkillsAndInstructions(input: {
  config: Record<string, unknown>;
  moduleDir: string;
}): Promise<ClaudeRunSkillsAndInstructions> {
  const { config } = input;
  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  const instructionsFileDir = instructionsFilePath ? `${path.dirname(instructionsFilePath)}/` : "";
  const claudeSkillEntries = await readPaperclipRuntimeSkillEntries(config, input.moduleDir);
  const desiredSkillNames = new Set(resolveClaudeDesiredSkillNames(config, claudeSkillEntries));
  // Keep per-run working-copy paths out of the content-addressed system prompt.
  // Resumed sessions retain that prompt, so refresh the location on every turn.
  let combinedInstructionsContents: string | null = null;
  let instructionsPathDirective = "";
  let instructionsReadError: string | null = null;
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
      instructionsReadError = err instanceof Error ? err.message : String(err);
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
  // broken skill.
  const desiredSkillEntries = claudeSkillEntries.filter((entry) => desiredSkillNames.has(entry.key));
  const mountableSkillEntries = desiredSkillEntries.filter((entry) => !isPaperclipSkillSourceMissing(entry));
  const missingSkillEntries = desiredSkillEntries.filter((entry) => isPaperclipSkillSourceMissing(entry));
  return {
    claudeSkillEntries,
    desiredSkillNames,
    missingSkillEntries,
    mountableSkillEntries,
    instructionsFilePath,
    instructionsReadError,
    instructionsPathDirective,
    combinedInstructionsContents,
  };
}

// --- The manifest ---------------------------------------------------------------

/**
 * The manifest of one attempt of a sealed run, from its sealed values, skills, MCP servers and
 * launch environment. `instructionsSent`: the agent's instructions went out with
 * `--append-system-prompt-file` (a fresh session, and the entry file was read).
 */
export function buildSealedRunManifest(input: {
  sealedRun: SealedClaudeRun;
  skills: SealedRunManifestSkills;
  runtimeMcpServers: ReadonlyArray<{ name: string; url: string }>;
  context: Record<string, unknown>;
  instructionsFilePath: string;
  instructionsSent: boolean;
  launchEnv: Record<string, string>;
  extraArgs: readonly string[];
  session: ClaudeRunSessionStart;
}) {
  return buildClaudeRunManifest({
    configDir: input.sealedRun.configDir,
    credential: input.sealedRun.credential,
    setAside: input.sealedRun.setAside,
    overriddenEnv: input.sealedRun.overriddenEnv,
    skills: input.skills,
    repoSkills: input.sealedRun.repoSkills,
    mcpServers: input.runtimeMcpServers,
    access: input.context.paperclipAgentAccess,
    github: input.context.paperclipGitHub,
    instructions: { entryFile: input.instructionsFilePath || null, sent: input.instructionsSent },
    claudeMd: input.sealedRun.claudeMd.load,
    env: input.launchEnv,
    extraArgs: input.extraArgs,
    session: input.session,
  });
}

type SealedRunManifestSkills = ReadonlyArray<{ key: string; runtimeName: string }>;
