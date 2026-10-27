import type { Issue, IssueStatus, IssueWorkMode } from "@paperclipai/shared";
import type { CommentPost } from "@/api/comments";
import { mergeRunOverrides, type RunSettings } from "../run-overrides";
import { escapeLabel } from "./mentions";

/*
 * The composer's model (board 3, tasks/discussion): its saved draft, and what one send does. The
 * rules follow ui/src/components/task-chat/TaskChatComposer.tsx and IssueDetail's handlers:
 *
 * - A changed work mode is saved on the task first (`PATCH { workMode }`).
 * - A plain message is a comment. Reassigning, or setting the run's model and effort, sends the
 *   comment inside `PATCH /issues/:id` instead, so the change and the message land together.
 *   Reassigning without new run settings clears the old assignee's overrides.
 * - Writing to an agent on a done, cancelled or blocked task reopens it (to Todo), unless you turn
 *   that off.
 * - Files that aren't inline images ride along as `[name](path)` lines, and every uploaded file
 *   still referenced is sent as an attachment id.
 * - While a run is going, a message waits in the queue. "Steer now" posts it and then steers it in;
 *   "Interrupt and send" stops the run and starts the next one with it.
 */

export type ComposerAttachment = {
  /** Local key while uploading; the attachment id once uploaded. */
  key: string;
  name: string;
  size: number;
  status: "uploading" | "attached" | "error";
  attachmentId?: string;
  contentPath?: string;
  /** Images go inline at the caret as `![name](path)`. */
  inline?: boolean;
  error?: string;
};

export type Assignee = { agentId: string | null; userId: string | null };

export type SendMode = "send" | "steer" | "interrupt";

export type ComposerState = {
  body: string;
  attachments: ComposerAttachment[];
  workMode: IssueWorkMode;
  /** null: unchanged. */
  assignee: Assignee | null;
  /** null: unchanged. */
  runSettings: RunSettings | null;
  reopen: boolean;
};

export type SendPlan =
  | { ok: false; problem: string }
  | {
      ok: true;
      /** Save this work mode on the task before sending. */
      workMode: IssueWorkMode | null;
      request: { via: "post"; data: CommentPost } | { via: "patch"; data: Record<string, unknown> };
      /** Steer the posted message into the running turn. */
      steer: boolean;
    };

export type TaskForSend = Pick<Issue, "status" | "workMode" | "assigneeAgentId" | "assigneeUserId" | "assigneeAdapterOverrides">;

/** Closed tasks that a message to an agent reopens, after `shouldImplicitlyReopenComment`. */
const REOPENS: ReadonlySet<IssueStatus> = new Set(["done", "cancelled", "blocked"]);

export function reopensByDefault(status: IssueStatus, assignee: Assignee) {
  return REOPENS.has(status) && !!assignee.agentId;
}

export function sameAssignee(a: Assignee, b: Assignee) {
  return (a.agentId ?? null) === (b.agentId ?? null) && (a.userId ?? null) === (b.userId ?? null);
}

/** The message as sent: the text, then a link line for each attached file that isn't inline. */
export function messageBody(body: string, attachments: readonly ComposerAttachment[]) {
  const links = attachments
    .filter((item) => item.status === "attached" && item.contentPath && !item.inline)
    .map((item) => `[${escapeLabel(item.name)}](${item.contentPath})`);
  return [body.trim(), links.join("\n")].filter(Boolean).join("\n\n");
}

/** Uploaded files the message still refers to: every file chip, and inline images still in the text. */
export function attachmentIds(body: string, attachments: readonly ComposerAttachment[]) {
  return [
    ...new Set(
      attachments
        .filter((item) => item.status === "attached" && item.attachmentId && (!item.inline || (item.contentPath && body.includes(item.contentPath))))
        .map((item) => item.attachmentId!),
    ),
  ];
}

export function planSend(
  state: ComposerState,
  context: {
    task: TaskForSend;
    mode: SendMode;
    clientRequestId: string;
    /** The adapter of an agent, for its effort key. */
    adapterTypeOf: (agentId: string) => string | null | undefined;
  },
): SendPlan {
  if (state.attachments.some((item) => item.status === "uploading")) return { ok: false, problem: "Wait for the files to finish uploading." };
  if (state.attachments.some((item) => item.status === "error")) return { ok: false, problem: "Remove the files that didn't upload, or try them again." };
  const body = messageBody(state.body, state.attachments);
  if (!body) return { ok: false, problem: "Write a message first." };

  const { task } = context;
  const current: Assignee = { agentId: task.assigneeAgentId, userId: task.assigneeUserId };
  const reassignment = state.assignee && !sameAssignee(state.assignee, current) ? state.assignee : null;
  const ids = attachmentIds(state.body, state.attachments);
  const workMode = state.workMode !== task.workMode ? state.workMode : null;
  const interrupt = context.mode === "interrupt" ? true : undefined;

  if (reassignment || state.runSettings) {
    const target = reassignment ?? current;
    const adapterType = target.agentId ? context.adapterTypeOf(target.agentId) : null;
    const data: Record<string, unknown> = { comment: body, commentClientRequestId: context.clientRequestId };
    if (ids.length) data.attachmentIds = ids;
    if (reassignment) {
      data.assigneeAgentId = reassignment.agentId;
      data.assigneeUserId = reassignment.userId;
    }
    data.assigneeAdapterOverrides = state.runSettings && target.agentId ? mergeRunOverrides(task.assigneeAdapterOverrides, adapterType, state.runSettings, !!reassignment) : null;
    if (state.reopen) data.status = "todo";
    if (interrupt) data.interrupt = true;
    return { ok: true, workMode, request: { via: "patch", data }, steer: false };
  }

  const data: CommentPost = { body, clientRequestId: context.clientRequestId };
  if (ids.length) data.attachmentIds = ids;
  if (state.reopen) data.reopen = true;
  if (interrupt) data.interrupt = true;
  return { ok: true, workMode, request: { via: "post", data }, steer: context.mode === "steer" };
}

// The saved draft, per task. It keeps the text and the files already uploaded, so switching tasks
// or reloading loses nothing.

type SavedDraft = { body: string; attachments: ComposerAttachment[] };

const DRAFT_KEY = (taskId: string) => `paperclip.ui-new.composer-draft.${taskId}`;

export function loadComposerDraft(taskId: string): SavedDraft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(taskId));
    if (!raw) return { body: "", attachments: [] };
    const parsed = JSON.parse(raw) as Partial<SavedDraft>;
    return {
      body: typeof parsed.body === "string" ? parsed.body : "",
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments.filter((item) => item?.status === "attached") : [],
    };
  } catch {
    return { body: "", attachments: [] };
  }
}

export function saveComposerDraft(taskId: string, draft: SavedDraft) {
  try {
    const attachments = draft.attachments.filter((item) => item.status === "attached");
    if (draft.body.trim() || attachments.length > 0) localStorage.setItem(DRAFT_KEY(taskId), JSON.stringify({ body: draft.body, attachments }));
    else localStorage.removeItem(DRAFT_KEY(taskId));
  } catch {
    // Storage unavailable: the draft lives only while the composer is open.
  }
}

export function clearComposerDraft(taskId: string) {
  try {
    localStorage.removeItem(DRAFT_KEY(taskId));
  } catch {
    // Nothing to clear.
  }
}

/** The work modes a message can carry, as New task names them. */
export const WORK_MODES: { value: IssueWorkMode; label: string; description: string }[] = [
  { value: "standard", label: "Do the work", description: "Make the change and report back" },
  { value: "ask", label: "Answer a question", description: "Reply with findings, change nothing" },
  { value: "planning", label: "Plan first", description: "Propose a plan for you to approve" },
];

export function placeholderFor(mode: IssueWorkMode, assigneeName: string | null) {
  const name = assigneeName ?? "the agent";
  if (mode === "planning") return `Plan with ${name}. Shapes the plan, no code changes`;
  if (mode === "ask") return `Ask ${name} a question. Read-only, nothing runs`;
  return "Comment, or @mention an agent, person or task";
}
