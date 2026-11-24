import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterRunPreview, AdapterRunPreviewContext } from "@paperclipai/adapter-utils";
import type { ClaudeRunCredential, ClaudeRunPreviewManifest } from "@paperclipai/shared";
import { adapterExecutionTargetIsRemote, readAdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";
import { asBoolean, parseObject } from "@paperclipai/adapter-utils/server-utils";
import { resolveClaudeExecutionEngine } from "./acp.js";
import { claudeSandboxPermissionEnv } from "./permissions.js";
import {
  buildClaudeRunEnvironment,
  buildSealedLaunchEnv,
  buildSealedRunManifest,
  planClaudeRunSkillsAndInstructions,
  planSealedClaudeRun,
  plannedSealedClaudeRun,
  sealedRunBlockers,
} from "./run-plan.js";

/**
 * The run preview of a `claude_local` agent (fork/step-4b-parts-2-3.md, part 2): the manifest of
 * its next sealed CLI launch, from the planning half of the launch only (`run-plan.ts`). It
 * starts nothing and writes nothing: no config folder, prompt bundle, plugin folder, MCP config
 * or temporary `HOME`.
 */

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Stands in for the run id in planned paths and `PAPERCLIP_RUN_ID` (whose name alone is shown). */
export const CLAUDE_RUN_PREVIEW_RUN_ID = "preview";
/** Stands in for the run token, which a preview never mints; only `PAPERCLIP_API_KEY`'s name is shown. */
const PREVIEW_RUN_TOKEN = "<run token: minted at launch>";
/** Passed through the plan when the run would have no credential; the manifest then reads null. */
const NO_CREDENTIAL: ClaudeRunCredential = { kind: "agent_env", method: "subscription", connectionId: null, connectionName: null };

export async function previewClaudeRun(ctx: AdapterRunPreviewContext): Promise<AdapterRunPreview> {
  const { agent, config, context } = ctx;
  if (resolveClaudeExecutionEngine(config).engine !== "cli") return { supported: false, reason: "not_cli_engine" };
  const executionTarget = readAdapterExecutionTarget({ executionTarget: ctx.executionTarget });
  // Sealing applies to local targets only; the dormant remote paths aren't sealed.
  if (adapterExecutionTargetIsRemote(executionTarget)) return { supported: false, reason: "remote_target" };

  const runId = CLAUDE_RUN_PREVIEW_RUN_ID;
  const authToken = ctx.runTokenAvailable ? PREVIEW_RUN_TOKEN : undefined;
  const { cwd, env, extraArgs } = buildClaudeRunEnvironment({ runId, agent, config, context, executionTarget, authToken });
  Object.assign(env, claudeSandboxPermissionEnv({
    dangerouslySkipPermissions: asBoolean(config.dangerouslySkipPermissions, true),
    targetIsSandbox: false,
  }));
  const runtimeMcpServers = ctx.runtimeMcp?.getServers() ?? [];
  const { blockers, credential } = sealedRunBlockers({ authToken, runtimeMcpServers, env, config, context });
  const plan = await planSealedClaudeRun({
    runId,
    agent,
    config,
    configEnv: parseObject(config.env),
    workspaceContext: parseObject(context.paperclipWorkspace),
    cwd,
    env,
    credential: credential ?? NO_CREDENTIAL,
    repoView: ctx.repoView,
  });
  const skills = await planClaudeRunSkillsAndInstructions({ config, moduleDir: __moduleDir });
  const sealedRun = plannedSealedClaudeRun(plan, agent.id);
  const manifest = buildSealedRunManifest({
    sealedRun,
    skills: skills.mountableSkillEntries,
    runtimeMcpServers,
    context,
    instructionsFilePath: skills.instructionsFilePath,
    // A fresh session gets the instructions file when the entry file was read.
    instructionsSent: Boolean(skills.instructionsPathDirective && skills.combinedInstructionsContents),
    launchEnv: buildSealedLaunchEnv(env, sealedRun),
    extraArgs,
    session: { mode: "fresh", reason: "no_saved_session" },
  });
  const { session: _session, setAside: _setAside, ...rest } = manifest;
  const previewManifest: ClaudeRunPreviewManifest = { ...rest, credential };
  return {
    supported: true,
    manifest: previewManifest,
    blockers,
    systemPrompt: [], // step 5 Task 8 fills this
    instructionsPathDirective: "", // step 5 Task 8 fills this
  };
}
