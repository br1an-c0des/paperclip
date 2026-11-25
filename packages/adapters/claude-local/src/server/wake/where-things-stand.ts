import type { PaperclipWakePayload } from "@paperclipai/adapter-utils/server-utils";
import { wakeContinuation, type ClaudeWakeComment } from "./events.js";
import {
  capitalize,
  commentItem,
  inline,
  lines,
  list,
  person,
  quoteClaudeWakeText,
  t,
  time,
  type Ctx,
  type WakeBlock,
  type WakePartMeta,
} from "./context.js";
import { HEADINGS, HISTORY, PEOPLE, WHERE_THINGS_STAND } from "./templates.js";
import { requestDecisionWords, requestNounWords, runEndingWords } from "./words.js";

/**
 * "Where things stand": a fresh session's history of the task (the last run, its requests, its
 * documents, the comments), capped together.
 */

/**
 * About 12,000 characters of earlier comments on a fresh session (the spec's cap); with the
 * payload's history, of the whole "Where things stand" section.
 */
export const CLAUDE_WAKE_HISTORY_CAP = 12_000;

export const WHERE_THINGS_STAND_PART_META: WakePartMeta = {
  "wake.where_things_stand": { label: "Where things stand", source: "wake payload: history (older payloads: continuationSummary), executionContinuation.messages" },
  "wake.last_run": { label: "Last run's summary", source: "wake payload: history.lastRun" },
  "wake.requests": { label: "Answered requests", source: "wake payload: history.answered, history.answeredOmitted" },
  "wake.open_requests": { label: "Open requests", source: "wake payload: history.open" },
  "wake.documents": { label: "Task documents", source: "wake payload: history.documents" },
  "wake.history_comments": { label: "The task's comments", source: "wake payload: executionContinuation.messages" },
};

function renderHistory(ctx: Ctx, history: ClaudeWakeComment[], cap: number = CLAUDE_WAKE_HISTORY_CAP): string | null {
  if (history.length === 0) return null;
  const items = history.map((comment) => commentItem(ctx, comment));
  const total = items.reduce((sum, item) => sum + item.length + 2, 0);
  let kept: number[];
  if (total <= cap) {
    kept = items.map((_, index) => index);
  } else {
    // Keep the original request (the record's objective comment, else the oldest) and as many of
    // the most recent as fit.
    const objective = wakeContinuation(ctx.wake)?.objectiveSource;
    const originalIndex = Math.max(0, objective?.kind === "comment" ? history.findIndex((comment) => comment.id === objective.id) : 0);
    const chosen = new Set([originalIndex]);
    let used = items[originalIndex]!.length;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (chosen.has(index)) continue;
      if (chosen.size > 1 && used + items[index]!.length + 2 > cap) break;
      chosen.add(index);
      used += items[index]!.length + 2;
    }
    kept = [...chosen].sort((left, right) => left - right);
  }
  const blocks: string[] = [WHERE_THINGS_STAND.history];
  for (const [position, index] of kept.entries()) {
    const gap = position > 0 ? index - kept[position - 1]! - 1 : 0;
    if (gap > 0) blocks.push(gap === 1 ? WHERE_THINGS_STAND.historyCutOne : t(WHERE_THINGS_STAND.historyCut, { count: gap }));
    blocks.push(items[index]!);
  }
  return lines(...blocks);
}

/**
 * Fresh sessions only: a resumed session already holds the history, recovery wakes included.
 * With the payload's `history` (step 5 phase 2, the handoff), the section is the task's one
 * history: the last run's summary, its requests, its documents, then the comments, capped at
 * 12,000 characters together. Without it (older payloads), the continuation summary and the
 * comments, as before.
 */
export function renderWhereThingsStand(ctx: Ctx): WakeBlock[] {
  if (ctx.options.resumedSession) return [];
  const taskHistory = ctx.wake.history;
  if (taskHistory) return renderTaskHistory(ctx, taskHistory);
  const summary = ctx.wake.continuationSummary;
  const history = renderHistory(ctx, ctx.comments.history);
  if (!summary && !history) return [];
  return [{
    id: "wake.where_things_stand",
    text: lines(
      HEADINGS.whereThingsStand,
      summary && lines(WHERE_THINGS_STAND.summary, quoteClaudeWakeText(summary.body), summary.bodyTruncated && WHERE_THINGS_STAND.summaryCut),
      history,
    ),
  }];
}

/** The run summary's cap, and each request's (the spec's). */
export const CLAUDE_WAKE_RUN_SUMMARY_CAP = 2_000;
export const CLAUDE_WAKE_REQUEST_CAP = 1_000;
/** Room kept under the cap for the comments' heading and their "left out" line. */
const COMMENTS_SLACK = 200;

type TaskHistory = NonNullable<PaperclipWakePayload["history"]>;
type TaskRequest = TaskHistory["answered"][number];

function renderTaskHistory(ctx: Ctx, history: TaskHistory): WakeBlock[] {
  const blocks: WakeBlock[] = [];
  const lastRun = renderLastRun(ctx, history.lastRun);
  if (lastRun) blocks.push({ id: "wake.last_run", text: lastRun });
  if (history.answered.length > 0 || history.answeredOmitted > 0) {
    const more = history.answeredOmitted === 1
      ? HISTORY.answeredMoreOne
      : history.answeredOmitted > 1 ? t(HISTORY.answeredMore, { count: history.answeredOmitted }) : null;
    blocks.push({
      id: "wake.requests",
      text: lines(
        history.answered.length > 0 && lines(HISTORY.answered, history.answered.map((request) => renderAnsweredRequest(ctx, request)).join("\n")),
        more,
      ),
    });
  }
  if (history.open.length > 0) {
    blocks.push({ id: "wake.open_requests", text: history.open.map((request) => renderOpenRequest(ctx, request)).join("\n") });
  }
  const documents = renderDocuments(history.documents);
  if (documents) blocks.push({ id: "wake.documents", text: documents });
  // The comments fill what's left of the cap.
  const used = [HEADINGS.whereThingsStand, ...blocks.map((block) => block.text)].reduce((sum, text) => sum + text.length + 2, 0);
  const comments = renderHistory(ctx, ctx.comments.history, CLAUDE_WAKE_HISTORY_CAP - used - COMMENTS_SLACK);
  if (comments) blocks.push({ id: "wake.history_comments", text: comments });
  if (blocks.length === 0) return [];
  return [{ id: "wake.where_things_stand", text: HEADINGS.whereThingsStand }, ...blocks];
}

/** "you" -> "Your", "the agent Coder" -> "The agent Coder's", no one -> "". */
function whose(ctx: Ctx, ref: { type: string; id: string } | null, start: boolean): string {
  if (!ref) return "";
  const who = person(ctx, ref.type, ref.id);
  const text = who === PEOPLE.you ? "your" : `${who}'s`;
  return start ? capitalize(text) : text;
}

function renderLastRun(ctx: Ctx, run: TaskHistory["lastRun"]): string | null {
  if (!run) return null;
  const when = time(ctx, run.finishedAt);
  const ended = runEndingWords(run.status);
  const data = { taskRef: ctx.taskRef, time: when, ended };
  const sentence = run.ownRun
    ? t(when ? HISTORY.lastRunOwn : HISTORY.lastRunOwnNoTime, data)
    : t(when ? HISTORY.lastRunOther : HISTORY.lastRunOtherNoTime, { ...data, whose: whose(ctx, { type: "agent", id: run.agentId }, true) });
  const cut = run.bodyTruncated || run.body.length > CLAUDE_WAKE_RUN_SUMMARY_CAP;
  const body = run.body.length > CLAUDE_WAKE_RUN_SUMMARY_CAP ? `${run.body.slice(0, CLAUDE_WAKE_RUN_SUMMARY_CAP - 1)}…` : run.body;
  return lines(sentence, quoteClaudeWakeText(body), cut && HISTORY.lastRunCut);
}

/** "Where should the switch go? → Both places", one line per question. */
function answerLines(request: TaskRequest): string | null {
  const questions = request.questions ?? [];
  if (questions.length === 0) return null;
  return questions.map((question) => {
    const answer = request.answers?.find((entry) => entry.questionId === question.id);
    const free = new Set(question.options.filter((option) => /^paperclip_(custom|text)_answer/.test(option.id)).map((option) => option.id));
    const picked = (answer?.optionIds ?? [])
      // The free-text option's typed answer is `otherText`, never its id or "Other" (bug 94's id).
      .filter((id) => !free.has(id) && !/^paperclip_(custom|text)_answer/.test(id))
      .map((id) => {
        const label = question.options.find((option) => option.id === id)?.label;
        return label ? inline(label) : HISTORY.unlistedOption;
      });
    if (answer?.otherText) picked.push(inline(answer.otherText, 600));
    return `${inline(question.prompt, 300)} → ${picked.length > 0 ? picked.join(", ") : HISTORY.noAnswer}`;
  }).join("\n");
}

function requestHead(ctx: Ctx, request: TaskRequest, start: boolean): { noun: string; title: string } {
  const questions = request.questions ?? [];
  const noun = requestNounWords(request.kind, { aboutPlan: request.aboutPlan, questionCount: Math.max(1, questions.length) });
  const titleText = request.title ?? (request.kind === "ask_user_questions" && questions.length === 1 ? questions[0]!.prompt : null);
  const owner = whose(ctx, request.askedBy, start);
  return { noun: owner ? noun : start ? capitalize(noun) : noun, title: titleText ? ` "${inline(titleText).replace(/"/g, "'")}"` : "" };
}

function renderAnsweredRequest(ctx: Ctx, request: TaskRequest): string {
  const { noun, title } = requestHead(ctx, request, true);
  const decision = requestDecisionWords(request.outcome ?? request.status, { aboutPlan: request.aboutPlan });
  const who = request.decidedBy ? person(ctx, request.decidedBy.type, request.decidedBy.id) : null;
  const when = time(ctx, request.decidedAt);
  // A question's title is its answers' line; the head names the question only when it has a title.
  const questionTitle = request.kind === "ask_user_questions" ? (request.title ? title : "") : title;
  const head = t(HISTORY.request, {
    whose: whose(ctx, request.askedBy, true),
    noun,
    title: questionTitle,
    decision,
    by: who ? t(HISTORY.by, { who }) : "",
    on: when ? t(HISTORY.on, { time: when }) : "",
  }).trim();
  const answers = answerLines(request);
  const note = request.note ?? null;
  const quoted = answers ?? note ?? (request.kind === "ask_user_questions" ? null : request.summary ?? null);
  const withWhat = !answers && note ? (request.kind === "approval" ? HISTORY.withNote : HISTORY.withReason) : "";
  const item = (text: string | null, cut: boolean) => {
    if (!text) return `- ${head}${withWhat}.`;
    const quote = quoteClaudeWakeText(text).split("\n").map((line) => `  ${line}`).join("\n");
    return `- ${head}${withWhat}:\n${quote}${cut ? `\n  ${HISTORY.requestCut}` : ""}`;
  };
  let rendered = item(quoted, false);
  if (rendered.length <= CLAUDE_WAKE_REQUEST_CAP || !quoted) return rendered;
  // Over the cap: cut the quoted text so the item, with its "cut short" line, fits.
  let text = quoted;
  for (let attempt = 0; attempt < 4 && rendered.length > CLAUDE_WAKE_REQUEST_CAP; attempt += 1) {
    const over = item(text, true).length - CLAUDE_WAKE_REQUEST_CAP;
    text = `${text.slice(0, Math.max(0, text.length - over - 2)).trimEnd()}…`;
    rendered = item(text, true);
  }
  return rendered;
}

function renderOpenRequest(ctx: Ctx, request: TaskRequest): string {
  const { noun, title } = requestHead(ctx, request, false);
  const owner = whose(ctx, request.askedBy, false);
  const text = `${owner ? `${owner} ` : ""}${noun}${title}`;
  const when = time(ctx, request.askedAt);
  return when ? t(HISTORY.open, { request: text, time: when }) : t(HISTORY.openNoTime, { request: text });
}

function sameName(key: string, title: string): boolean {
  const flat = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  return flat(key) === flat(title);
}

function renderDocuments(documents: TaskHistory["documents"]): string | null {
  if (documents.length === 0) return null;
  const names = documents.map((document) => {
    const name = document.title && !sameName(document.key, document.title)
      ? `${inline(document.key, 100)} ("${inline(document.title, 100).replace(/"/g, "'")}")`
      : inline(document.key, 100);
    return document.inBrief ? t(HISTORY.documentInBrief, { document: name }) : name;
  });
  const rest = documents.filter((document) => !document.inBrief);
  const workflow = rest.some((document) => document.key === "workflow");
  const others = rest.filter((document) => document.key !== "workflow");
  const read = others.length === 0
    ? null
    : documents.some((document) => document.inBrief) ? HISTORY.documentsReadRest : HISTORY.documentsRead;
  return lines([t(HISTORY.documents, { documents: list(names, 20) }), read].filter(Boolean).join(" "), workflow && HISTORY.workflow);
}
