import type { RunPromptPlan } from "@paperclipai/shared";
import { PAPERCLIP_RUN_PROMPT_PLAN_KEY, resolveClaudeExecutionEngine } from "@paperclipai/adapter-claude-local/server";
import { adapterExecutionTargetIsRemote, readAdapterExecutionTarget } from "@paperclipai/adapter-utils/execution-target";
import { copyTaskMarkdownParts } from "../heartbeat/task-context.js";
import { buildClaudeRunPromptPlan, type ClaudeRunPromptInput } from "./build-claude-run-prompt.js";

/**
 * Puts the run prompt builder's plan on the adapter context of a `claude_local` CLI run on a
 * local target (step 5, Task 7), just before the adapter runs. The adapter records it as the
 * run's prompt sections after checking it joins to exactly what it sends; it never sends it.
 *
 * - Other adapters, the ACP engine and remote targets get no plan.
 * - The plan and the brief's parts are non-enumerable on the adapter context, so neither
 *   reaches the run's saved context or the `adapter.invoke` event's context.
 * - A builder error is reported through `onWarning` and leaves the plan unset; the run goes on.
 */
export async function attachClaudeRunPromptPlan(input: {
  agent: ClaudeRunPromptInput["agent"] & { adapterType?: string | null };
  runId: string;
  /** The runtime config the adapter gets. */
  config: Record<string, unknown>;
  /** The heartbeat's context, which carries the task brief's parts. */
  context: Record<string, unknown>;
  /** The context the adapter gets: a copy of `context` with dispatch-time additions. */
  adapterContext: Record<string, unknown>;
  executionTarget: unknown;
  legacyRemoteExecution: unknown;
  /** The run token the adapter gets, if any: it puts PAPERCLIP_API_KEY in the run's env. */
  authToken: string | null | undefined;
  getFreshSessionHandoff: (() => Promise<string | null>) | undefined;
  onWarning: (message: string) => Promise<void>;
}): Promise<RunPromptPlan | null> {
  if (input.agent.adapterType !== "claude_local") return null;
  if (resolveClaudeExecutionEngine(input.config).engine !== "cli") return null;
  const target = readAdapterExecutionTarget({
    executionTarget: input.executionTarget,
    legacyRemoteExecution: input.legacyRemoteExecution,
  });
  if (adapterExecutionTargetIsRemote(target)) return null;
  delete input.adapterContext[PAPERCLIP_RUN_PROMPT_PLAN_KEY];
  try {
    copyTaskMarkdownParts(input.context, input.adapterContext);
    const plan = await buildClaudeRunPromptPlan({
      agent: input.agent,
      runId: input.runId,
      config: input.config,
      context: input.adapterContext,
      // A local target is always sealed (execute.ts).
      sealed: true,
      // PAPERCLIP_API_URL is always set; the key comes only from the run token.
      paperclipApiReachable: Boolean(input.authToken),
      loadFreshSessionHandoff: input.getFreshSessionHandoff,
    });
    Object.defineProperty(input.adapterContext, PAPERCLIP_RUN_PROMPT_PLAN_KEY, {
      value: plan, enumerable: false, writable: true, configurable: true,
    });
    return plan;
  } catch (err) {
    await input.onWarning(
      `could not prepare the run's prompt sections (${err instanceof Error ? err.message : String(err)}); the prompt will be recorded unsplit`,
    ).catch(() => undefined);
    return null;
  }
}
