import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { activityLog, documentRevisions, heartbeatRuns, type Db } from "@paperclipai/db";
import { briefPlanState, type PaperclipTaskMarkdownInput } from "./task-markdown.js";

/**
 * The task's facts for a run (step 5 phase 2, `fork/step-5-brief.md` "Data"): what `claude_local`
 * writes "The task" and the brief's rules in "What to do now" from, in place of the task brief.
 * Built in `prepareHeartbeatTaskContext` beside the brief, from the same inputs, and redacted in
 * the same call. Set as `context.paperclipRunTask` on a non-chat task only, so its presence is
 * the test for leaving the brief out.
 */
export type PaperclipRunTask = {
  issueId: string;
  /** The task's parents, nearest first, up to 6. */
  ancestors: Array<{ identifier: string | null; title: string | null; status: string | null }>;
  ancestorsOmitted: number;
  /** Trimmed; null when empty. */
  description: string | null;
  /** Edited (per the task's activity record) since the session's last run started, by anyone but that run. */
  descriptionChangedSinceLastRun: boolean;
  plan: {
    revisionNumber: number;
    /** Cut at 12,000 characters. */
    body: string;
    /** The full length when cut. */
    truncatedFrom: number | null;
    /** This revision was saved since the session's last run started, by anyone but that run. */
    changedSinceLastRun: boolean;
  } | null;
  workMode: string | null;
  titleNeedsGeneration: boolean;
  /** From `briefPlanState`: the plan review was rejected, with the reviewer's requested changes. */
  rejectedPlan: { reason: string | null } | null;
  /** From `briefPlanState`: implement the accepted plan on this task. */
  acceptedPlan: { revisionNumber: number | null } | null;
  wakeCommentAttachments: Array<{ commentId: string; id: string; filename: string; contentType: string; byteSize: number }>;
  attachmentOmissions: Array<{ commentId: string; notice: string }>;
  /** A case's execution context and live-voice guidance, as the brief puts them before itself. */
  prefixParts: Array<{ id: "wake.task.case" | "wake.task.live_voice"; text: string }>;
  /**
   * Claude compacted the session since its last run. Always false for now: Paperclip records a
   * compaction (`context.compacted` run events, which the transcript's compaction divider reads)
   * only for Paperclip Runner runs; `claude_local` runs, CLI or ACP, record none.
   */
  compactedSinceLastRun: boolean;
};

/** The shared-workspace note's field, set by environment selection when another run holds it. */
export type PaperclipSharedWorkspaceNote = { heldByRunId: string; heldByIssue: string | null };

/** The plan as `getTaskPlanContext` reads it (the accepted revision, or the latest). */
export type RunTaskPlan = { revisionId: string; revisionNumber: number; body: string };

/** As the brief cuts the plan (`task-markdown.ts`). */
const MAX_INLINE_TASK_PLAN_CHARS = 12_000;
const MAX_ANCESTORS = 6;

export async function buildRunTaskFacts(db: Db, input: {
  companyId: string;
  issueId: string;
  taskMarkdownInput: PaperclipTaskMarkdownInput;
  taskPlan: RunTaskPlan | null;
  /** The task session's last run (`taskSession.lastRunId`): "since the last run" is since it started. */
  previousRunId: string | null;
  prefix: { caseMarkdown: string; liveVoice: string };
}): Promise<PaperclipRunTask> {
  const { companyId, issueId, taskMarkdownInput: markdown, taskPlan } = input;
  const since = await previousRunStart(db, companyId, input.previousRunId);
  const planBody = taskPlan?.body.trim() ?? "";
  const [descriptionChanged, planChanged] = await Promise.all([
    since ? descriptionEditedSince(db, { companyId, issueId, since, previousRunId: input.previousRunId! }) : false,
    since && taskPlan && planBody ? revisionSavedSince(db, { companyId, revisionId: taskPlan.revisionId, since, previousRunId: input.previousRunId! }) : false,
  ]);
  const planState = briefPlanState(markdown);
  const allAncestors = markdown.ancestors ?? [];
  const description = markdown.issue?.description?.trim() || null;
  const acceptedRevisionId = markdown.acceptedPlan?.revisionId ?? null;
  return {
    issueId,
    ancestors: allAncestors.slice(0, MAX_ANCESTORS).map((ancestor) => ({
      identifier: ancestor.identifier ?? null,
      title: ancestor.title ?? null,
      status: ancestor.status ?? null,
    })),
    ancestorsOmitted: Math.max(0, allAncestors.length - MAX_ANCESTORS),
    description,
    descriptionChangedSinceLastRun: Boolean(description) && descriptionChanged,
    plan: taskPlan && planBody
      ? {
          revisionNumber: taskPlan.revisionNumber,
          body: planBody.slice(0, MAX_INLINE_TASK_PLAN_CHARS),
          truncatedFrom: planBody.length > MAX_INLINE_TASK_PLAN_CHARS ? planBody.length : null,
          changedSinceLastRun: planChanged,
        }
      : null,
    workMode: markdown.issue?.workMode ?? null,
    titleNeedsGeneration: markdown.issue?.titleNeedsGeneration === true,
    rejectedPlan: planState.rejectedPlan ? { reason: markdown.planReview?.reason?.trim() || null } : null,
    acceptedPlan: planState.acceptedPlanContinuation
      ? {
          revisionNumber: markdown.acceptedPlan?.revisionNumber
            ?? (acceptedRevisionId && taskPlan?.revisionId === acceptedRevisionId ? taskPlan.revisionNumber : null),
        }
      : null,
    wakeCommentAttachments: (markdown.wakeComments ?? []).flatMap((comment) =>
      (comment.attachments ?? []).map((attachment) => ({
        commentId: comment.id,
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        byteSize: attachment.byteSize,
      }))),
    // As the brief lists them: notices with a comment and some text.
    attachmentOmissions: (markdown.attachmentOmissions ?? [])
      .filter((omission) => omission.commentId.trim().length > 0 && omission.notice.trim().length > 0)
      .map((omission) => ({ commentId: omission.commentId, notice: omission.notice })),
    prefixParts: [
      ...(input.prefix.liveVoice.trim() ? [{ id: "wake.task.live_voice" as const, text: input.prefix.liveVoice.trim() }] : []),
      ...(input.prefix.caseMarkdown.trim() ? [{ id: "wake.task.case" as const, text: input.prefix.caseMarkdown.trim() }] : []),
    ],
    compactedSinceLastRun: false,
  };
}

/** When the session's last run started; null without one (nothing counts as changed). */
async function previousRunStart(db: Db, companyId: string, runId: string | null): Promise<Date | null> {
  if (!runId) return null;
  const row = await db
    .select({ startedAt: heartbeatRuns.startedAt, createdAt: heartbeatRuns.createdAt })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.companyId, companyId)))
    .then((rows) => rows[0] ?? null);
  return row ? row.startedAt ?? row.createdAt : null;
}

/**
 * A description edit since then, from the task's activity record: an `issue.updated` entry whose
 * change set names the description. The previous run's own edits don't count: the session made them.
 */
async function descriptionEditedSince(db: Db, input: { companyId: string; issueId: string; since: Date; previousRunId: string }) {
  const row = await db
    .select({ id: activityLog.id })
    .from(activityLog)
    .where(and(
      eq(activityLog.companyId, input.companyId),
      eq(activityLog.entityType, "issue"),
      eq(activityLog.entityId, input.issueId),
      eq(activityLog.action, "issue.updated"),
      gt(activityLog.createdAt, input.since),
      or(isNull(activityLog.runId), ne(activityLog.runId, input.previousRunId)),
      sql`(${activityLog.details} -> 'changes' -> 'description') is not null`,
    ))
    .limit(1);
  return row.length > 0;
}

/** The plan revision was saved since then, and not by the previous run itself. */
async function revisionSavedSince(db: Db, input: { companyId: string; revisionId: string; since: Date; previousRunId: string }) {
  const row = await db
    .select({ createdAt: documentRevisions.createdAt, createdByRunId: documentRevisions.createdByRunId })
    .from(documentRevisions)
    .where(and(eq(documentRevisions.id, input.revisionId), eq(documentRevisions.companyId, input.companyId)))
    .then((rows) => rows[0] ?? null);
  return Boolean(row && row.createdAt > input.since && row.createdByRunId !== input.previousRunId);
}
