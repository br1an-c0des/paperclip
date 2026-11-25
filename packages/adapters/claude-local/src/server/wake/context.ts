import {
  normalizePaperclipRunTask,
  normalizePaperclipSharedWorkspaceNote,
  renderTemplate,
  type PaperclipPromptPartMeta,
  type PaperclipRunTask,
  type PaperclipSharedWorkspaceNote,
  type PaperclipWakePayload,
} from "@paperclipai/adapter-utils/server-utils";
import {
  selectClaudeWakeComments,
  type ClaudeWakeComment,
  type ClaudeWakeComments,
  type ClaudeWakeRenderOptions,
} from "./events.js";
import { ATTACHMENTS, COMMENTS, PEOPLE, TASK_LINE } from "./templates.js";

/**
 * The wake's shared render context (fork/step-5-brief.md "The renderer's modules"): the text
 * helpers, and the names, times and task reference every heading's module uses.
 */

/** A block of the wake: one display part, before its separator is added. */
export interface WakeBlock {
  id: string;
  text: string;
  label?: string;
  source?: string;
  /** What comes before it; a blank line by default. */
  separator?: string;
}

/** Part labels and sources by id, for blocks that don't carry their own. */
export type WakePartMeta = Readonly<Record<string, PaperclipPromptPartMeta>>;

// --- Text helpers ------------------------------------------------------------------

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Every line as a Markdown quote, so quoted text can't pass for a heading or a rule. */
export function quoteClaudeWakeText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(CONTROL_CHARACTERS, "").trim().split("\n");
  if (lines.length === 1 && !lines[0]) return "> (empty)";
  return lines.map((line) => (line.trimEnd() ? `> ${line.trimEnd()}` : ">")).join("\n");
}

/** A fenced block that the text inside can't close. */
export function fenced(text: string, info = "text"): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${info}\n${text}\n${fence}`;
}

export function jsonData(value: unknown, indent?: number): string {
  return fenced(JSON.stringify(value, (_key, entry) =>
    entry === null ? undefined : typeof entry === "string" ? entry.replace(CONTROL_CHARACTERS, "") : entry, indent,
  ).replace(/</g, "\\u003c").replace(/>/g, "\\u003e"), "json");
}

/** Inline text: one line, capped. */
export function inline(text: string, max = 200): string {
  const flat = text.replace(CONTROL_CHARACTERS, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

export function code(text: string): string {
  return `\`${inline(text).replace(/`/g, "'")}\``;
}

export function list(items: string[], max = 10): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

export function t(template: string, data: Record<string, unknown> = {}): string {
  return renderTemplate(template, data);
}

function validTimeZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

export function lines(...blocks: Array<string | null | undefined | false>): string {
  return blocks.filter((block): block is string => typeof block === "string" && block.length > 0).join("\n\n");
}

// --- The wake's context ------------------------------------------------------------

export interface Ctx {
  wake: PaperclipWakePayload;
  /** The payload as given, for the texts the normalizer doesn't carry. */
  raw: unknown;
  options: ClaudeWakeRenderOptions;
  comments: ClaudeWakeComments;
  names: Record<string, string>;
  timeZone: string | null;
  taskRef: string;
  task: string;
  /** The task's facts, when they're about the wake's task; null otherwise (as before them). */
  runTask: PaperclipRunTask | null;
  /** Read only with `runTask`: without it, the brief carries the note. */
  sharedWorkspaceNote: PaperclipSharedWorkspaceNote | null;
}

export function makeCtx(wake: PaperclipWakePayload, raw: unknown, options: ClaudeWakeRenderOptions): Ctx {
  const issue = wake.issue;
  const taskRef = issue?.identifier ?? (issue?.title ? `"${inline(issue.title)}"` : "the task");
  const task = issue?.identifier && issue.title
    ? t(TASK_LINE.titled, { identifier: issue.identifier, title: inline(issue.title) })
    : taskRef;
  const facts = normalizePaperclipRunTask(options.runTask);
  const runTask = facts && issue && (!issue.id || facts.issueId === issue.id) ? facts : null;
  return {
    wake,
    raw,
    options,
    comments: selectClaudeWakeComments(wake, options),
    names: wake.names ?? {},
    timeZone: validTimeZone(wake.timeZone),
    taskRef,
    task,
    runTask,
    sharedWorkspaceNote: runTask ? normalizePaperclipSharedWorkspaceNote(options.sharedWorkspaceNote) : null,
  };
}

/** A person or agent: "Brian", "the agent Coder", "a person", "you". */
export function person(ctx: Ctx, type: string | null | undefined, id: string | null | undefined, start = false): string {
  const text = (() => {
    if (type === "agent") {
      if (id && id === ctx.options.agentId) return PEOPLE.you;
      const name = id ? ctx.names[`agent:${id}`] : undefined;
      return name ? t(PEOPLE.agentNamed, { name }) : PEOPLE.agent;
    }
    if (type === "user") {
      const name = id ? ctx.names[`user:${id}`] : undefined;
      if (name) return name;
      return PEOPLE.person;
    }
    if (type === "system") return PEOPLE.paperclip;
    return PEOPLE.someone;
  })();
  return start ? capitalize(text) : text;
}

/** Who caused the wake, at the start of a sentence; `fallback` when the wake doesn't say. */
export function actor(ctx: Ctx, fallback: string = PEOPLE.person): string {
  const ref = ctx.wake.actor;
  if (ref && (ref.type === "user" || ref.type === "agent")) return person(ctx, ref.type, ref.id, true);
  return capitalize(fallback);
}

/** "Nov 24, 10:20" in the wake's time zone, or "Nov 24, 10:20 UTC" without one. */
export function time(ctx: Ctx, iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const text = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    timeZone: ctx.timeZone ?? "UTC",
  }).format(date);
  return ctx.timeZone ? text : `${text} UTC`;
}

export function byline(ctx: Ctx, comment: ClaudeWakeComment): string {
  const when = time(ctx, comment.createdAt);
  const who = person(ctx, comment.authorType, comment.authorId);
  return `${who}${when ? `, ${when}` : ""}${comment.seen ? ` ${COMMENTS.seen}` : ""}`;
}

/** The comment quoted; with the task's facts, its attachments listed under it. */
export function quotedComment(ctx: Ctx, comment: ClaudeWakeComment): string {
  const quoted = [quoteClaudeWakeText(comment.body), ...(comment.bodyTruncated ? ["", COMMENTS.cutShort] : [])].join("\n");
  const attachments = comment.id ? renderAttachments(ctx, comment.id) : null;
  return attachments ? `${quoted}\n\n${attachments}` : quoted;
}

/** "From Brian, Nov 24, 10:20:" and the quote. */
export function commentItem(ctx: Ctx, comment: ClaudeWakeComment): string {
  return `${t(COMMENTS.item, { byline: byline(ctx, comment) })}\n\n${quotedComment(ctx, comment)}`;
}

/** "118 KB", "2.4 MB", "512 bytes". */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** A wake comment's attachments and import notices (the task's facts), or null. */
function renderAttachments(ctx: Ctx, commentId: string): string | null {
  const attachments = ctx.runTask?.wakeCommentAttachments.filter((attachment) => attachment.commentId === commentId) ?? [];
  const omissions = ctx.runTask?.attachmentOmissions.filter((omission) => omission.commentId === commentId) ?? [];
  if (attachments.length === 0 && omissions.length === 0) return null;
  const items = [
    ...attachments.map((attachment) => `- ${t(ATTACHMENTS.item, {
      filename: code(attachment.filename),
      details: [inline(attachment.contentType, 100), sizeWords(attachment.byteSize)].filter(Boolean).join(", "),
      id: inline(attachment.id, 100).replace(/`/g, "'"),
    })}`),
    ...omissions.map((omission) => `- ${t(ATTACHMENTS.omitted, { notice: inline(omission.notice, 400) })}`),
  ];
  return `${ATTACHMENTS.heading}\n${items.join("\n")}`;
}

/** Whether a comment the wake quotes has attachments listed under it. */
export function attachmentsShown(ctx: Ctx): boolean {
  const attachments = ctx.runTask?.wakeCommentAttachments ?? [];
  if (attachments.length === 0) return false;
  const { news, edited, history, earlier } = ctx.comments;
  const quoted = new Set([...news, ...edited, ...earlier, ...(ctx.options.resumedSession ? [] : history)].map((comment) => comment.id));
  return attachments.some((attachment) => quoted.has(attachment.commentId));
}
