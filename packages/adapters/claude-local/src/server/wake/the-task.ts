import { inline, lines, t, type Ctx, type WakeBlock, type WakePartMeta } from "./context.js";
import { HEADINGS, TASK_LINE } from "./templates.js";
import { statusWords } from "./words.js";

/** "The task": the task in one line. */

export const THE_TASK_PART_META: WakePartMeta = {
  "wake.task": { label: "The task", source: "wake payload: issue, checkedOutByHarness, executionWorkspace" },
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

export function renderTheTask(ctx: Ctx): WakeBlock[] {
  const task = renderTaskLine(ctx);
  return task ? [{ id: "wake.task", text: task }] : [];
}
