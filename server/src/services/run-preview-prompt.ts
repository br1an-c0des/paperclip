import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  agentTaskSessions,
  cases,
  executionWorkspaces,
  issueComments,
  type Db,
} from "@paperclipai/db";
import {
  joinRunPromptSections,
  type RunPromptPart,
  type RunPromptPreview,
  type RunPromptPreviewKind,
  type RunPromptSection,
} from "@paperclipai/shared";
import { CLAUDE_RUN_PREVIEW_RUN_ID } from "@paperclipai/adapter-claude-local/server";
import { parseObject } from "../adapters/utils.js";
import { badRequest, notFound, unprocessable } from "../errors.js";
import { isConversation } from "./agent-conversations.js";
import { shouldAutoCheckoutIssueForWake } from "./heartbeat.js";
import { prepareHeartbeatTaskContext } from "./heartbeat/task-context.js";
import {
  createHeartbeatRunPreparation,
  enrichWakeContextSnapshot,
  PAPERCLIP_HARNESS_CHECKOUT_KEY,
  PAPERCLIP_WAKE_PAYLOAD_KEY,
} from "./heartbeat/run-preparation.js";
import { instanceSettingsService } from "./instance-settings.js";
import { issueService } from "./issues.js";
import { mcpAppViewsService, renderMcpAppRunContext } from "./mcp-app-views.js";
import { createNativeSessionHandoffLoader } from "./native-runtime/native-session-handoff.js";
import { buildClaudeRunPromptPlan } from "./run-prompt/build-claude-run-prompt.js";
import type { TrustPresetResolution } from "./trust-preset-resolver.js";

/**
 * The next run's prompt, drafted for the agent's run preview (step 5 Task 8,
 * fork/step-5-prompt-builder.md "The next-run preview"): the context the heartbeat would build for
 * one kind of wake on a chosen task, through the heartbeat's own `prepareHeartbeatTaskContext`
 * (which builds the wake payload with `buildPaperclipWakePayload`), then the same builder a run
 * uses. Its fresh set is the draft.
 *
 * It writes nothing. The heartbeat stages that act are left out and their effect on the prompt is
 * predicted instead; what only the launch knows is marked `pending`, with why:
 * - the checkout flag (the harness claims the task, which also moves it to in progress);
 * - the branch of the task's worktree, named when the run makes it;
 * - the instructions file's location, when the run reads a working copy of a managed bundle;
 * - connection instructions, when the agent has assigned connections or connectors;
 * - the MCP app context that widgets on the task reported, read again at launch;
 * - a workflow case's context, which needs the run's own authority to read.
 *
 * It decrypts the issue's registered secrets, on the server only, to redact task text as a run
 * does (`redactForIssue`, inside `prepareHeartbeatTaskContext` and the handoff loader).
 */

type IssueContext = NonNullable<Awaited<ReturnType<ReturnType<typeof createHeartbeatRunPreparation>["getIssueExecutionContext"]>>>;

/** The chosen wake: its kind, its task and the comment that wakes it. */
export interface PreviewPromptTarget {
  kind: RunPromptPreviewKind;
  issue: IssueContext | null;
  wakeCommentId: string | null;
}

/**
 * The run id the task-context reads see. They compare it with `heartbeat_runs.id` (a uuid), so it
 * must parse as one, and it matches no run: the preview has none. The builder's templates see
 * `CLAUDE_RUN_PREVIEW_RUN_ID` ("preview"), as the adapter's planned paths do.
 */
export const PREVIEW_CONTEXT_RUN_ID = "00000000-0000-0000-0000-000000000000";

export const PREVIEW_PROMPT_KINDS: readonly RunPromptPreviewKind[] = ["assignment", "comment", "chat_turn", "no_task"];

export function isRunPromptPreviewKind(value: unknown): value is RunPromptPreviewKind {
  return typeof value === "string" && (PREVIEW_PROMPT_KINDS as readonly string[]).includes(value);
}

/**
 * Which wake to draft. No task: a timer wake (`no_task`). A task without a kind: its fresh
 * assignment. `comment` wakes on the task's latest comment; `chat_turn` needs one of the agent's
 * chats and wakes on its latest message from a person. 422 `not_a_chat` or `no_comment` otherwise.
 */
export async function resolvePreviewPromptTarget(
  db: Db,
  agent: { id: string; companyId: string },
  input: { issueId: string | null; kind: RunPromptPreviewKind | null },
): Promise<PreviewPromptTarget> {
  const kind = input.kind ?? (input.issueId ? "assignment" : "no_task");
  if (kind === "no_task") {
    if (input.issueId) throw badRequest("A run without a task takes no issueId");
    return { kind, issue: null, wakeCommentId: null };
  }
  if (!input.issueId) throw badRequest(`A ${kind} preview needs an issueId`);
  const issue = await createHeartbeatRunPreparation(db).getIssueExecutionContext(agent.companyId, input.issueId);
  if (!issue) throw notFound("Issue not found");
  const chat = isConversation(issue) && issue.conversationAgentId === agent.id;
  if (kind === "chat_turn" && !chat) {
    throw unprocessable("This task isn't one of the agent's chats", { code: "not_a_chat" });
  }
  if (kind === "assignment") return { kind, issue, wakeCommentId: null };
  const [latest] = await db
    .select({ id: issueComments.id })
    .from(issueComments)
    .where(and(
      eq(issueComments.companyId, agent.companyId),
      eq(issueComments.issueId, issue.id),
      isNull(issueComments.deletedAt),
      // A chat turn is woken by a person's message, not the agent's reply.
      kind === "chat_turn" ? isNotNull(issueComments.authorUserId) : undefined,
    ))
    .orderBy(desc(issueComments.createdAt), desc(issueComments.id))
    .limit(1);
  if (!latest) {
    throw unprocessable(kind === "chat_turn" ? "This chat has no messages yet" : "This task has no comments yet", {
      code: "no_comment",
    });
  }
  return { kind, issue, wakeCommentId: latest.id };
}

/** What a queued wake of this kind carries, before the heartbeat enriches it. */
function wakeRequest(target: PreviewPromptTarget) {
  const issueId = target.issue?.id ?? null;
  switch (target.kind) {
    case "no_task":
      // heartbeat/scheduling.ts: the interval timer.
      return {
        reason: "heartbeat_timer", source: "timer" as const, payload: null,
        contextSnapshot: { source: "scheduler", reason: "interval_elapsed" },
      };
    case "assignment":
      // issue-assignment-wakeup.ts: assigning the task to the agent.
      return {
        reason: "issue_assigned", source: "assignment" as const, payload: { issueId, mutation: "update" },
        contextSnapshot: { issueId, source: "issue.update" },
      };
    case "comment":
    case "chat_turn":
      // routes/issues.ts: a comment on the assignee's task (a chat message is one too).
      return {
        reason: "issue_commented", source: "automation" as const,
        payload: { issueId, commentId: target.wakeCommentId, mutation: "comment" },
        contextSnapshot: {
          issueId, taskId: issueId, commentId: target.wakeCommentId, wakeCommentId: target.wakeCommentId,
          source: "issue.comment", wakeReason: "issue_commented",
        },
      };
  }
}

export interface RunPreviewPromptInput {
  agent: { id: string; companyId: string; name: string; adapterType: string; adapterConfig: unknown };
  target: PreviewPromptTarget;
  /** The runtime config the adapter would get (the preview's, with secrets as placeholders). */
  config: Record<string, unknown>;
  /** The preview's adapter context: the workspace, access, AI connection and GitHub. Not changed. */
  context: Record<string, unknown>;
  /** The system prompt's sections, from the adapter's run plan. */
  systemPrompt: RunPromptSection[];
  /** Whether the run would get a run token (and so the Paperclip MCP note). */
  runTokenAvailable: boolean;
  trustPreset: Pick<TrustPresetResolution, "kind">;
  /** The task worktree's branch a run in the project would get: a placeholder until the run names it. */
  plannedBranchName: string | null;
  /** The agent's instructions are a managed bundle: the run reads a working copy, at a folder made for it. */
  instructionsWorkingCopy: boolean;
  /** The agent has assigned connections or connectors, whose instructions the run adds. */
  hasConnections: boolean;
}

const PENDING = {
  checkout: "The harness checks the task out when the run starts; predicted from the task's status and assignee.",
  status: "The status after the harness checks the task out; predicted.",
  branch: "The run names the branch when it makes the task's worktree.",
  instructions: "The run reads a working copy of the instructions, in a folder made for the run.",
  connections: "Instructions for the agent's assigned connections are added at launch.",
  mcpApp: "Read again at launch: widgets on the task may report newer context.",
  workflowCase: "The workflow case's context is read at launch, with the run's own access.",
} as const;

export async function buildRunPreviewPrompt(db: Db, input: RunPreviewPromptInput): Promise<RunPromptPreview> {
  const { agent, target } = input;
  const issue = target.issue;

  // The wake, as the heartbeat finds it on the queued run.
  const request = wakeRequest(target);
  const context: Record<string, unknown> = { ...input.context, ...request.contextSnapshot };
  enrichWakeContextSnapshot({
    contextSnapshot: context, reason: request.reason, source: request.source, triggerDetail: "system", payload: request.payload,
  });
  if (target.kind === "chat_turn" && issue) {
    // agent-conversations.ts prepareConversationTurn.
    context.conversationSessionGeneration = issue.conversationSessionGeneration;
    context.conversationMode = true;
  }
  if (issue) {
    if (issue.projectId) context.projectId = issue.projectId;
    else delete context.projectId;
  }

  // The checkout the harness makes before the task context: predicted, not made.
  let issueRef = issue;
  let checkoutPredicted = false;
  if (issue) {
    const readiness = await issueService(db).listDependencyReadiness(agent.companyId, [issue.id]);
    checkoutPredicted = shouldAutoCheckoutIssueForWake({
      contextSnapshot: context,
      issueStatus: issue.status,
      issueAssigneeAgentId: issue.assigneeAgentId,
      issueExecutionState: issue.executionState,
      isDependencyReady: readiness.get(issue.id)?.isDependencyReady ?? true,
      agentId: agent.id,
    });
    if (checkoutPredicted) {
      context[PAPERCLIP_HARNESS_CHECKOUT_KEY] = true;
      // Checking out moves the task to in progress; the heartbeat reads it again after.
      issueRef = { ...issue, status: "in_progress" };
    }
  }

  const experimental = await instanceSettingsService(db).getExperimentalReadOnly();
  // A workflow case's context is read with the admitted run's authority, which a preview has
  // none of: leave the case out (marked pending) rather than ask for it.
  const workflowCase = Boolean(issue && experimental.enableCases && await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.companyId, agent.companyId), eq(cases.workIssueId, issue.id)))
    .limit(1)
    .then((rows) => rows.length > 0));
  const taskSession = issue
    ? await db
      .select({ lastRunId: agentTaskSessions.lastRunId })
      .from(agentTaskSessions)
      .where(and(
        eq(agentTaskSessions.companyId, agent.companyId),
        eq(agentTaskSessions.agentId, agent.id),
        eq(agentTaskSessions.adapterType, agent.adapterType),
        eq(agentTaskSessions.taskKey, issue.id),
      ))
      .limit(1)
      .then((rows) => rows[0] ?? null)
    : null;

  // Reads only: no checkout, no run row, no writes (run-preview.test.ts checks the transaction id).
  const runPreparation = createHeartbeatRunPreparation(db);
  await prepareHeartbeatTaskContext(db, {
    run: { id: PREVIEW_CONTEXT_RUN_ID },
    agent: { id: agent.id, companyId: agent.companyId, adapterType: agent.adapterType },
    task: { issueRef, issueContext: issueRef, context, taskSession },
    policy: {
      trustPreset: input.trustPreset,
      experimentalInstanceSettings: workflowCase ? { ...experimental, enableCases: false } : experimental,
    },
    services: { issuesSvc: issueService(db), getPinnedSkillTestContext: runPreparation.getPinnedSkillTestContext },
  });

  // Later stages' patches to the wake (execution configuration, workspace realization).
  const mcpAppContext = issue
    ? renderMcpAppRunContext(await mcpAppViewsService(db).runContextForIssue(agent.companyId, issue.id))
    : null;
  let branchName: string | null = null;
  if (issue?.executionWorkspaceId) {
    branchName = await db
      .select({ branchName: executionWorkspaces.branchName })
      .from(executionWorkspaces)
      .where(and(eq(executionWorkspaces.companyId, agent.companyId), eq(executionWorkspaces.id, issue.executionWorkspaceId)))
      .limit(1)
      .then((rows) => rows[0]?.branchName ?? null);
  }
  branchName ??= input.plannedBranchName;
  const wake = parseObject(context[PAPERCLIP_WAKE_PAYLOAD_KEY]);
  context[PAPERCLIP_WAKE_PAYLOAD_KEY] = {
    ...wake,
    ...(branchName ? { executionWorkspace: { branchName } } : {}),
    // claude_local's CLI engine mounts connector skills as files: no text.
    connectorSkillInstructions: "",
    mcpAppContext,
    connectionInstructions: null,
  };

  const plan = await buildClaudeRunPromptPlan({
    agent: { id: agent.id, companyId: agent.companyId, name: agent.name, adapterType: agent.adapterType, adapterConfig: agent.adapterConfig },
    runId: CLAUDE_RUN_PREVIEW_RUN_ID,
    config: input.config,
    context,
    sealed: true,
    paperclipApiReachable: input.runTokenAvailable,
    loadFreshSessionHandoff: issue
      ? createNativeSessionHandoffLoader({
        db, companyId: agent.companyId, issueId: issue.id, agentId: agent.id, before: new Date(),
        throughCommentId: target.wakeCommentId,
      })
      : undefined,
  });

  const firstMessage = markPending(plan.fresh, {
    checkout: checkoutPredicted,
    status: checkoutPredicted && issue?.status !== "in_progress",
    branch: Boolean(branchName),
    instructions: input.instructionsWorkingCopy,
    connections: input.hasConnections,
    mcpApp: Boolean(mcpAppContext),
    workflowCase,
  });
  return {
    kind: target.kind,
    issueId: issue?.id ?? null,
    systemPrompt: input.systemPrompt,
    firstMessage,
    firstMessageChars: joinRunPromptSections(firstMessage).length,
  };
}

/** Marks what the launch fills in, on the parts that hold it or on the section. */
function markPending(sections: RunPromptSection[], flags: Record<keyof typeof PENDING, boolean>): RunPromptSection[] {
  const partPending: Record<string, string | null> = {
    "wake.checkout_line": flags.checkout ? PENDING.checkout : null,
    "wake.checkout_note": flags.checkout ? PENDING.checkout : null,
    "wake.issue_state": flags.status ? PENDING.status : null,
    "wake.workspace_branch": flags.branch ? PENDING.branch : null,
    "wake.mcp_app_context": flags.mcpApp ? PENDING.mcpApp : null,
  };
  const sectionPending: Partial<Record<RunPromptSection["id"], string | null>> = {
    instructions_directive: flags.instructions ? PENDING.instructions : null,
    wake: flags.connections ? PENDING.connections : null,
    task_brief: flags.workflowCase ? PENDING.workflowCase : null,
  };
  return sections.map((section) => {
    const pending = sectionPending[section.id] ?? null;
    const parts = section.parts?.map((part): RunPromptPart => {
      const why = partPending[part.id] ?? null;
      return why ? { ...part, pending: why } : part;
    });
    return { ...section, ...(parts ? { parts } : {}), ...(pending ? { pending } : {}) };
  });
}
