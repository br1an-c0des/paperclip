import { asString, parseObject } from "@paperclipai/adapter-utils/server-utils";
import type { ClaudeWakeEventKind } from "./events.js";
import { attachmentsShown, inline, lines, quoteClaudeWakeText, t, type Ctx, type WakeBlock, type WakePartMeta } from "./context.js";
import { COMMON_RULES, EVENTS, HEADINGS, INTERACTION_LANGUAGE, TASK_RULES } from "./templates.js";
import type { WhatHappened } from "./what-happened.js";

/**
 * "What to do now": the events' rules; with the task's facts, the brief's rules that apply
 * (fork/step-5-brief.md "What to do now") and the shared-workspace rule; then the rules every
 * wake keeps, and the texts that follow them (the interaction language, connection instructions,
 * MCP app context).
 */

export const TO_DO_PART_META: WakePartMeta = {
  "wake.to_do": { label: "What to do now", source: "claude_local wake: each event's rules" },
  "wake.to_do.task_rules": { label: "The task's rules", source: "task facts: work mode, plan review, title, attachments; wake payload: history" },
  "wake.to_do.shared_workspace": { label: "Shared workspace", source: "context: paperclipSharedWorkspaceNote" },
  "wake.common_rules": { label: "Rules every wake keeps", source: "claude_local wake: common rules" },
  "wake.interaction_language": { label: "Interaction language", source: "wake payload: simplifiedEnglishInteractions (experimental setting)" },
  "wake.connection_instructions": { label: "Connection instructions", source: "wake payload: connectionInstructions" },
  "wake.mcp_app_context": { label: "MCP app context", source: "wake payload: mcpAppContext" },
};

/** Events that wake someone other than the one doing the task's work, though they may be its assignee. */
const NOT_THE_WORKER: readonly ClaudeWakeEventKind[] = ["review_requested", "recovery", "watchdog"];

/**
 * The task rules (mode, plan, title, skill test) go to the agent doing the task: its assignee,
 * and not as a reviewer or approver (a review stage assigns the task to them) or a recovery.
 */
function doesTheWork(ctx: Ctx, events: readonly ClaudeWakeEventKind[]): boolean {
  const assignee = ctx.wake.issue?.assigneeAgentId;
  return Boolean(assignee) && assignee === ctx.options.agentId && !events.some((kind) => NOT_THE_WORKER.includes(kind));
}

/** A rule as a bullet, with an indented quote under it. */
function withQuote(rule: string, heading: string, quote: string): string {
  return `${rule} ${heading}\n${quoteClaudeWakeText(quote).split("\n").map((line) => `  ${line}`).join("\n")}`;
}

interface TaskRules {
  rules: string[];
  /** Event rules these replace. */
  replaces: string[];
}

function taskRules(ctx: Ctx, events: readonly ClaudeWakeEventKind[]): TaskRules {
  const runTask = ctx.runTask;
  const rules: string[] = [];
  const replaces: string[] = [];
  if (!runTask) return { rules, replaces };
  if (doesTheWork(ctx, events)) {
    if (runTask.titleNeedsGeneration) rules.push(TASK_RULES.title);
    const mode = runTask.workMode ?? ctx.wake.issue?.workMode ?? "standard";
    const rejected = mode !== "ask" && mode !== "skill_test" ? runTask.rejectedPlan : null;
    if (mode === "ask") {
      rules.push(TASK_RULES.ask);
    } else if (mode === "skill_test") {
      rules.push(TASK_RULES.skillTest);
    } else if (rejected) {
      const rule = mode === "planning" ? TASK_RULES.planningRejected : TASK_RULES.rejected;
      // The plan_rejected event quotes the reason in "What happened" already.
      rules.push(rejected.reason && !events.includes("plan_rejected") ? withQuote(rule, TASK_RULES.rejectedReason, rejected.reason) : rule);
      replaces.push(...EVENTS.plan_rejected.rules);
    } else if (runTask.acceptedPlan) {
      const revision = runTask.acceptedPlan.revisionNumber;
      rules.push(revision !== null ? t(TASK_RULES.accepted, { revision }) : TASK_RULES.acceptedNoRevision);
      replaces.push(...EVENTS.plan_accepted.rules);
    } else if (mode === "planning") {
      // "Update" once there's a plan or a comment to act on; "make" otherwise.
      rules.push(runTask.plan || ctx.comments.news.length > 0 ? TASK_RULES.planningUpdate : TASK_RULES.planningMake);
    }
  }
  if (attachmentsShown(ctx)) rules.push(TASK_RULES.attachments);
  const history = ctx.wake.history;
  if ((history && (history.answered.length > 0 || history.open.length > 0)) || events.includes("questions_answered")) {
    rules.push(TASK_RULES.questions);
  }
  return { rules, replaces };
}

function sharedWorkspaceRule(ctx: Ctx): string | null {
  const note = ctx.sharedWorkspaceNote;
  if (!note) return null;
  return note.heldByIssue ? t(TASK_RULES.sharedWorkspaceOnTask, { task: inline(note.heldByIssue, 100) }) : TASK_RULES.sharedWorkspace;
}

const bulleted = (rules: readonly string[]) => rules.map((rule) => `- ${rule}`).join("\n");

export function renderToDo(
  ctx: Ctx,
  happened: Pick<WhatHappened, "rules" | "ruleBlocks">,
  events: readonly ClaudeWakeEventKind[],
): WakeBlock[] {
  const blocks: WakeBlock[] = [];
  const task = taskRules(ctx, events);
  const eventRules = happened.rules.filter((rule) => !task.replaces.includes(rule));
  const bullets = bulleted(eventRules);
  blocks.push({ id: "wake.to_do", text: lines(HEADINGS.toDo, bullets, ...happened.ruleBlocks) });
  // One list with the event rules, unless a block of rules sits between them.
  let inList = Boolean(bullets) && happened.ruleBlocks.length === 0;
  const listBlock = (id: string, text: string) => {
    blocks.push({ id, text, separator: inList ? "\n" : "\n\n" });
    inList = true;
  };
  if (task.rules.length > 0) listBlock("wake.to_do.task_rules", bulleted(task.rules));
  const shared = sharedWorkspaceRule(ctx);
  if (shared) listBlock("wake.to_do.shared_workspace", bulleted([shared]));
  listBlock("wake.common_rules", bulleted(COMMON_RULES));
  if (ctx.wake.simplifiedEnglishInteractions) blocks.push({ id: "wake.interaction_language", text: INTERACTION_LANGUAGE });
  const raw = parseObject(ctx.raw);
  const connectionInstructions = asString(parseObject(raw.connectionInstructions).text, "").trim();
  if (connectionInstructions) blocks.push({ id: "wake.connection_instructions", text: connectionInstructions });
  const mcpAppContext = asString(raw.mcpAppContext, "").trim();
  if (mcpAppContext) blocks.push({ id: "wake.mcp_app_context", text: mcpAppContext });
  return blocks;
}
