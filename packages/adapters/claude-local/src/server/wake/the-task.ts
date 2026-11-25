import type { PaperclipRunTask } from "@paperclipai/adapter-utils/server-utils";
import { inline, lines, quoteClaudeWakeText, t, type Ctx, type WakeBlock, type WakePartMeta } from "./context.js";
import { HEADINGS, TASK_LINE, THE_TASK } from "./templates.js";
import { statusWords } from "./words.js";

/**
 * "The task": the task in one line. With the task's facts (step 5 phase 2, fork/step-5-brief.md
 * "The task"), a fresh session also gets the parents, the description and the plan, quoted; a
 * resumed one gets the description or the plan only when it changed since the session's last
 * run, or both again after Claude compacted the session. A case's context and live-call guidance
 * follow on every run.
 */

export const THE_TASK_PART_META: WakePartMeta = {
  "wake.task": { label: "The task", source: "wake payload: issue, checkedOutByHarness, executionWorkspace" },
  "wake.task.parents": { label: "Parents", source: "task facts: ancestors" },
  "wake.task.description": { label: "Description", source: "task facts: description" },
  "wake.task.plan": { label: "Plan", source: "task facts: plan document" },
  "wake.task.case": { label: "Workflow case", source: "task facts: the case's execution context (experimental)" },
  "wake.task.live_voice": { label: "Live call guidance", source: "task facts: live voice call" },
};

function renderTaskLine(ctx: Ctx): string | null {
  const { wake } = ctx;
  const issue = wake.issue;
  if (!issue) return null;
  const pieces = [ctx.task];
  if (issue.status) pieces.push(t(TASK_LINE.status, { status: statusWords(issue.status) }));
  if (issue.workMode && issue.workMode !== "standard") pieces.push(t(TASK_LINE.workMode, { workMode: issue.workMode.replace(/_/g, " ") }));
  if (wake.checkedOutByHarness) pieces.push(TASK_LINE.checkedOut);
  if (wake.executionWorkspace?.branchName) pieces.push(t(TASK_LINE.branch, { branch: inline(wake.executionWorkspace.branchName).replace(/`/g, "'") }));
  return lines(HEADINGS.task, pieces.join(" · "));
}

type Ancestor = PaperclipRunTask["ancestors"][number];

/** TES-40 "Theme work" (in progress) */
function ancestorText(ancestor: Ancestor): string {
  const title = ancestor.title ? `"${inline(ancestor.title).replace(/"/g, "'")}"` : null;
  const name = [ancestor.identifier ? inline(ancestor.identifier, 40) : null, title].filter(Boolean).join(" ") || THE_TASK.unnamed;
  return ancestor.status ? `${name} (${statusWords(ancestor.status)})` : name;
}

function renderParents(runTask: PaperclipRunTask): string | null {
  const [parent, ...above] = runTask.ancestors;
  if (!parent) return null;
  const chain = [ancestorText(parent), ...above.map((ancestor) => t(THE_TASK.under, { task: ancestorText(ancestor) }))];
  if (runTask.ancestorsOmitted > 0) {
    chain.push(runTask.ancestorsOmitted === 1 ? THE_TASK.ancestorsMoreOne : t(THE_TASK.ancestorsMore, { count: runTask.ancestorsOmitted }));
  }
  return t(THE_TASK.parents, { chain: chain.join(", ") });
}

function renderDescription(runTask: PaperclipRunTask, fresh: boolean): string | null {
  if (fresh) return runTask.description ? lines(THE_TASK.description, quoteClaudeWakeText(runTask.description)) : null;
  if (!runTask.descriptionChangedSinceLastRun) return null;
  return runTask.description
    ? lines(THE_TASK.descriptionChanged, quoteClaudeWakeText(runTask.description))
    : THE_TASK.descriptionRemoved;
}

function renderPlan(runTask: PaperclipRunTask, fresh: boolean): string | null {
  const plan = runTask.plan;
  if (!plan || (!fresh && !plan.changedSinceLastRun)) return null;
  return lines(
    t(fresh ? THE_TASK.plan : THE_TASK.planChanged, { revision: plan.revisionNumber }),
    quoteClaudeWakeText(plan.body),
    plan.truncatedFrom !== null && THE_TASK.planCut,
  );
}

export function renderTheTask(ctx: Ctx): WakeBlock[] {
  const task = renderTaskLine(ctx);
  if (!task) return [];
  const blocks: WakeBlock[] = [{ id: "wake.task", text: task }];
  const runTask = ctx.runTask;
  if (!runTask) return blocks;
  const resumed = ctx.options.resumedSession;
  // After a compaction the session may hold only a summary: the description and plan again.
  const fresh = !resumed || runTask.compactedSinceLastRun;
  const parents = resumed ? null : renderParents(runTask);
  if (parents) blocks.push({ id: "wake.task.parents", text: parents });
  const description = renderDescription(runTask, fresh);
  if (description) blocks.push({ id: "wake.task.description", text: description });
  const plan = renderPlan(runTask, fresh);
  if (plan) blocks.push({ id: "wake.task.plan", text: plan });
  for (const part of runTask.prefixParts) blocks.push({ id: part.id, text: part.text });
  return blocks;
}
