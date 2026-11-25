import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  agents,
  approvals,
  authUsers,
  documents,
  heartbeatRuns,
  issueApprovals,
  issueComments,
  issueDocuments,
  issues,
  issueThreadInteractions,
  type Db,
} from "@paperclipai/db";
import { ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY, type SourceTrustMetadata } from "@paperclipai/shared";
import { isConversation } from "./agent-conversations.js";
import { boundRunIssueIdSql } from "./run-task-binding.js";
import { createRunSecretRedactionRegistry } from "./run-secret-redaction.js";
import { isLowTrustQuarantined, LOW_TRUST_QUARANTINED_BODY } from "./source-trust.js";
import { resolveCoreTrustPreset } from "./trust-preset-resolver.js";

/**
 * A task's request history: its questions, confirmations, connection requests and linked
 * approvals, its last run's summary and its documents. The wake payload carries it as `history`
 * on the assignee's own non-chat task (fork/step-5-handoff.md), and `GET /issues/:id/request-history`
 * returns the requests to `paperclip_read_task`. Reads only; records nothing.
 *
 * Same exclusions and trust handling as the fresh-session handoff (native-session-handoff.ts):
 * requests carrying a tool action, secret proposal or connection authorization are left out;
 * output from a run with a non-standard trust preset is quarantined; low-trust viewers get only
 * their own agent's requests and no approvals.
 */

export type PaperclipWakeLastRun = {
  runId: string;
  agentId: string;
  /** false: the previous assignee's run on a handed-over task. */
  ownRun: boolean;
  /** heartbeat_runs.status */
  status: string;
  finishedAt: string;
  /** Cut to 2,000 characters. */
  body: string;
  bodyTruncated: boolean;
};

export type PaperclipWakeRequestKind =
  | "ask_user_questions"
  | "request_confirmation"
  | "request_checkbox_confirmation"
  | "connection_intent"
  | "approval";

export type PaperclipWakeRequest = {
  id: string;
  kind: PaperclipWakeRequestKind;
  /** The interaction's or approval's status. */
  status: string;
  /** Interaction title (else the payload's title, or a confirmation's prompt); approval: its summary line. */
  title: string | null;
  /** A confirmation aimed at the plan document (a plan review). */
  aboutPlan: boolean;
  questions?: Array<{ id: string; prompt: string; options: Array<{ id: string; label: string }> }>;
  answers?: Array<{ questionId: string; optionIds: string[]; otherText: string | null }>;
  /** Confirmations: accepted / rejected; connection requests: the result's outcome; approvals: the decision. */
  outcome?: string | null;
  /** Confirmation or connection reason, or approval decision note. */
  note?: string | null;
  /** result.summaryMarkdown ?? summary, when nothing above applies. */
  summary?: string | null;
  askedBy: { type: "user" | "agent"; id: string } | null;
  decidedBy: { type: "user" | "agent"; id: string } | null;
  askedAt: string;
  /** null when open. */
  decidedAt: string | null;
};

export type PaperclipWakeTaskDocument = { key: string; title: string | null; inBrief: boolean };

export type PaperclipWakeHistory = {
  lastRun: PaperclipWakeLastRun | null;
  /** Most recent first, at most 8. */
  answered: PaperclipWakeRequest[];
  /** Answered requests beyond the 8. */
  answeredOmitted: number;
  /** Oldest first. */
  open: PaperclipWakeRequest[];
  /** Without the continuation summary document. */
  documents: PaperclipWakeTaskDocument[];
};

export const HISTORY_ANSWERED_LIMIT = 8;
const HISTORY_REQUEST_READ_LIMIT = 200;
const RUN_SUMMARY_MAX_CHARS = 2_000;
const REQUEST_TEXT_MAX_CHARS = 1_000;
const MAX_QUESTIONS = 20;
const MAX_OPTIONS = 30;
const MAX_DOCUMENTS = 30;
export const REQUEST_HISTORY_ROUTE_LIMIT = 50;

const INTERACTION_KINDS = ["ask_user_questions", "request_confirmation", "request_checkbox_confirmation", "connection_intent"] as const;
const CONFIRMATION_KINDS = new Set(["request_confirmation", "request_checkbox_confirmation"]);
const HISTORY_INTERACTION_STATUSES = ["pending", "answered", "accepted", "rejected"];
const HISTORY_APPROVAL_STATUSES = ["pending", "approved", "rejected", "revision_requested"];

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function clip(value: string | null): string | null {
  return value !== null && value.length > REQUEST_TEXT_MAX_CHARS ? value.slice(0, REQUEST_TEXT_MAX_CHARS) : value;
}

function firstLine(value: string | null): string | null {
  return value?.trim().split(/\r?\n/, 1)[0]?.trim() || null;
}

function person(agentId: string | null, userId: string | null): { type: "user" | "agent"; id: string } | null {
  if (userId) return { type: "user", id: userId };
  if (agentId) return { type: "agent", id: agentId };
  return null;
}

/** Output written by a run whose dispatch policy wasn't standard trust stays quarantined. */
function lowerTrustRun(companyId: string, executionPolicy: unknown): boolean {
  if (executionPolicy === null || executionPolicy === undefined) return false;
  return resolveCoreTrustPreset({ companyId, run: { companyId, executionPolicy } }).kind !== "standard";
}

function isOpen(request: PaperclipWakeRequest) {
  return request.status === "pending";
}

type InteractionRow = {
  id: string; kind: string; status: string; title: string | null; summary: string | null;
  payload: unknown; result: unknown;
  createdByAgentId: string | null; createdByUserId: string | null;
  resolvedByAgentId: string | null; resolvedByUserId: string | null;
  createdAt: Date; resolvedAt: Date | null; sourceRunPolicy: unknown;
};

function interactionRequest(row: InteractionRow, input: { companyId: string; lowTrust: boolean }): PaperclipWakeRequest {
  const payload = object(row.payload);
  const result = object(row.result);
  const confirmation = CONFIRMATION_KINDS.has(row.kind);
  const target = object(payload.target);
  const quarantined = !input.lowTrust && lowerTrustRun(input.companyId, row.sourceRunPolicy);
  const open = row.status === "pending";

  let questions: PaperclipWakeRequest["questions"];
  let answers: PaperclipWakeRequest["answers"];
  if (row.kind === "ask_user_questions" && !quarantined) {
    questions = (Array.isArray(payload.questions) ? payload.questions : []).slice(0, MAX_QUESTIONS).flatMap((value) => {
      const question = object(value);
      const id = text(question.id);
      if (!id) return [];
      return [{
        id,
        prompt: clip(text(question.prompt)) ?? "",
        options: (Array.isArray(question.options) ? question.options : []).slice(0, MAX_OPTIONS).flatMap((option) => {
          const row = object(option);
          const optionId = text(row.id);
          return optionId ? [{ id: optionId, label: clip(text(row.label)) ?? optionId }] : [];
        }),
      }];
    });
    if (row.status === "answered" && Array.isArray(result.answers)) {
      answers = result.answers.slice(0, MAX_QUESTIONS).flatMap((value) => {
        const answer = object(value);
        const questionId = text(answer.questionId);
        if (!questionId) return [];
        return [{
          questionId,
          optionIds: (Array.isArray(answer.optionIds) ? answer.optionIds : []).filter((id): id is string => typeof id === "string"),
          otherText: clip(text(answer.otherText)),
        }];
      });
    }
  }

  let outcome: string | null = null;
  if (confirmation) {
    outcome = row.status === "accepted" || row.status === "rejected" ? row.status : open ? null : text(result.outcome);
  } else if (row.kind === "connection_intent") {
    outcome = open ? null : text(result.outcome);
  }
  // A person's reason is never quarantined; the agent wrote the rest.
  const note = confirmation || row.kind === "connection_intent" ? clip(text(result.reason)) : null;
  const title = quarantined
    ? LOW_TRUST_QUARANTINED_BODY
    : clip(firstLine(text(row.title) ?? text(payload.title)
      ?? (confirmation ? text(payload.prompt) : row.kind === "connection_intent" ? text(payload.serviceName) : null)));
  const summary = quarantined || questions?.length || outcome !== null
    ? null
    : clip(text(result.summaryMarkdown) ?? text(row.summary));

  return {
    id: row.id,
    kind: row.kind as PaperclipWakeRequestKind,
    status: row.status,
    title,
    aboutPlan: confirmation && target.type === "issue_document" && target.key === "plan",
    ...(questions !== undefined ? { questions } : {}),
    ...(answers !== undefined ? { answers } : {}),
    outcome,
    note,
    summary,
    askedBy: person(row.createdByAgentId, row.createdByUserId),
    decidedBy: open ? null : person(row.resolvedByAgentId, row.resolvedByUserId),
    askedAt: row.createdAt.toISOString(),
    decidedAt: open || !row.resolvedAt ? null : row.resolvedAt.toISOString(),
  };
}

/** The task's requests, newest first (by when they were asked). */
export async function readTaskRequests(db: Db, input: {
  companyId: string; issueId: string; viewerAgentId: string | null; lowTrust: boolean;
  statuses: "history" | "all"; limit: number;
}): Promise<PaperclipWakeRequest[]> {
  const { companyId, issueId } = input;
  const limit = Math.max(0, Math.floor(input.limit));
  if (limit === 0) return [];
  const history = input.statuses === "history";
  const [interactionRows, approvalRows] = await Promise.all([
    db.select({
      id: issueThreadInteractions.id, kind: issueThreadInteractions.kind, status: issueThreadInteractions.status,
      title: issueThreadInteractions.title, summary: issueThreadInteractions.summary,
      payload: issueThreadInteractions.payload, result: issueThreadInteractions.result,
      createdByAgentId: issueThreadInteractions.createdByAgentId, createdByUserId: issueThreadInteractions.createdByUserId,
      resolvedByAgentId: issueThreadInteractions.resolvedByAgentId, resolvedByUserId: issueThreadInteractions.resolvedByUserId,
      createdAt: issueThreadInteractions.createdAt, resolvedAt: issueThreadInteractions.resolvedAt,
      sourceRunPolicy: sql<unknown>`(select ${heartbeatRuns.contextSnapshot}->'executionPolicy' from ${heartbeatRuns}
        where ${heartbeatRuns.id} = ${issueThreadInteractions.sourceRunId} and ${heartbeatRuns.companyId} = ${companyId})`,
    }).from(issueThreadInteractions).where(and(
      eq(issueThreadInteractions.companyId, companyId),
      eq(issueThreadInteractions.issueId, issueId),
      inArray(issueThreadInteractions.kind, [...INTERACTION_KINDS]),
      // Never replay a tool action, credentials or a connection authorization as history.
      sql`not (${issueThreadInteractions.payload} ?| array['toolAction', 'secretProposal', 'connectionAuthorization'])`,
      history ? inArray(issueThreadInteractions.status, HISTORY_INTERACTION_STATUSES) : undefined,
      // A low-trust viewer sees only what its own agent asked, as the API gives it.
      input.lowTrust
        ? input.viewerAgentId ? eq(issueThreadInteractions.createdByAgentId, input.viewerAgentId) : sql`false`
        : undefined,
    )).orderBy(desc(issueThreadInteractions.createdAt), desc(issueThreadInteractions.id)).limit(limit),
    // GET /issues/:id/approvals refuses low-trust callers; so does this.
    input.lowTrust ? Promise.resolve([]) : db.select({
      id: approvals.id, status: approvals.status, payload: approvals.payload, decisionNote: approvals.decisionNote,
      requestedByAgentId: approvals.requestedByAgentId, requestedByUserId: approvals.requestedByUserId,
      decidedByUserId: approvals.decidedByUserId, decidedAt: approvals.decidedAt, createdAt: approvals.createdAt,
    }).from(issueApprovals)
      .innerJoin(approvals, and(eq(approvals.id, issueApprovals.approvalId), eq(approvals.companyId, companyId)))
      .where(and(
        eq(issueApprovals.companyId, companyId),
        eq(issueApprovals.issueId, issueId),
        history ? inArray(approvals.status, HISTORY_APPROVAL_STATUSES) : undefined,
      )).orderBy(desc(approvals.createdAt), desc(approvals.id)).limit(limit),
  ]);

  const requests: PaperclipWakeRequest[] = [
    ...interactionRows.map(row => interactionRequest(row, input)),
    ...approvalRows.map((row): PaperclipWakeRequest => {
      const payload = object(row.payload);
      const open = row.status === "pending";
      return {
        id: row.id,
        kind: "approval",
        status: row.status,
        // The wake's approval summary rule (readWakeApproval): title, summary or name, one line.
        title: clip(firstLine([payload.title, payload.summary, payload.name].map(text).find(value => value !== null) ?? null)),
        aboutPlan: false,
        outcome: open ? null : row.status,
        note: clip(text(row.decisionNote)),
        summary: null,
        askedBy: person(row.requestedByAgentId, row.requestedByUserId),
        decidedBy: open ? null : person(null, row.decidedByUserId),
        askedAt: row.createdAt.toISOString(),
        decidedAt: open || !row.decidedAt ? null : row.decidedAt.toISOString(),
      };
    }),
  ];
  return requests
    .sort((a, b) => b.askedAt.localeCompare(a.askedAt) || b.id.localeCompare(a.id))
    .slice(0, limit);
}

/**
 * The latest finished run on the task with a summary, whatever its status: this agent's own,
 * else the previous assignee's (`previousAssigneeAgentId`, or, when null, the most recent other
 * agent's). Reviewer and approver stages and watchdog runs don't count, nor recovery runs by
 * another agent.
 */
export async function readTaskLastRun(db: Db, input: {
  companyId: string; issueId: string; agentId: string; previousAssigneeAgentId: string | null;
}): Promise<PaperclipWakeLastRun | null> {
  const { companyId, issueId, agentId } = input;
  // The handoff's run summary source (native-session-handoff.ts).
  const summary = sql`btrim(coalesce(${heartbeatRuns.runnerProfileJson} #>> '{sessionCheckpoint,semanticResult,summary}',
    case when ${heartbeatRuns.runtimeMode} = 'legacy' then coalesce(${heartbeatRuns.resultJson}->>'summary', ${heartbeatRuns.resultJson}->>'result') end,
    ${heartbeatRuns.nextAction}, ''))`;
  const context = sql`${heartbeatRuns.contextSnapshot}`;
  const [row] = await db.select({
    id: heartbeatRuns.id, agentId: heartbeatRuns.agentId, status: heartbeatRuns.status, finishedAt: heartbeatRuns.finishedAt,
    body: sql<string>`left(${summary}, ${RUN_SUMMARY_MAX_CHARS + 1})`,
    executionPolicy: sql<unknown>`${context}->'executionPolicy'`,
  }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.companyId, companyId),
    sql`${boundRunIssueIdSql()} = ${issueId}`,
    isNotNull(heartbeatRuns.finishedAt),
    sql`${summary} <> ''`,
    input.previousAssigneeAgentId
      ? inArray(heartbeatRuns.agentId, [agentId, input.previousAssigneeAgentId])
      : undefined,
    // Review and approval stages are another agent's (or a person's) turn; an executor stage is the assignee's.
    sql`(jsonb_typeof(${context}->'executionStage') is distinct from 'object'
      or ${context}->'executionStage'->>'wakeRole' = 'executor')`,
    sql`(jsonb_typeof(${context}->'taskWatchdog') is distinct from 'object'
      and (${context}->'taskWatchdog') is distinct from 'true'::jsonb)`,
    or(eq(heartbeatRuns.agentId, agentId),
      sql`(nullif(${context}->>'recoveryActionId', '') is null and nullif(${context}->>'recoveryCause', '') is null)`),
  )).orderBy(sql`case when ${heartbeatRuns.agentId} = ${agentId} then 0 else 1 end`,
    desc(heartbeatRuns.finishedAt), desc(heartbeatRuns.id)).limit(1);
  if (!row?.finishedAt) return null;
  const quarantined = lowerTrustRun(companyId, row.executionPolicy);
  const truncated = !quarantined && row.body.length > RUN_SUMMARY_MAX_CHARS;
  return {
    runId: row.id,
    agentId: row.agentId,
    ownRun: row.agentId === agentId,
    status: row.status,
    finishedAt: row.finishedAt.toISOString(),
    body: quarantined ? LOW_TRUST_QUARANTINED_BODY : row.body.slice(0, RUN_SUMMARY_MAX_CHARS),
    bodyTruncated: truncated,
  };
}

/** The task's documents, plan first, then the most recently updated; without the continuation summary. */
export async function readTaskDocuments(db: Db, input: { companyId: string; issueId: string }): Promise<PaperclipWakeTaskDocument[]> {
  const rows = await db.select({ key: issueDocuments.key, title: documents.title, sourceTrust: documents.sourceTrust })
    .from(issueDocuments)
    .innerJoin(documents, and(eq(documents.id, issueDocuments.documentId), eq(documents.companyId, input.companyId)))
    .where(and(
      eq(issueDocuments.companyId, input.companyId),
      eq(issueDocuments.issueId, input.issueId),
      ne(issueDocuments.key, ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY),
    ))
    .orderBy(sql`case when ${issueDocuments.key} = 'plan' then 0 else 1 end`, desc(documents.updatedAt), issueDocuments.key)
    .limit(MAX_DOCUMENTS);
  return rows.map(row => ({
    key: row.key,
    // A quarantined document's title is low-trust text; its key still says it's there.
    title: isLowTrustQuarantined(row.sourceTrust as SourceTrustMetadata | null) ? null : clip(text(row.title)),
    // The brief carries the plan document on every non-chat task that has one (getTaskPlanContext).
    inBrief: row.key === "plan",
  }));
}

/**
 * The wake payload's `history`: only on the agent's own task, and never on a chat task (its
 * fresh sessions keep the handoff). Not redacted here; the payload's redaction covers it.
 */
export async function readTaskHistory(db: Db, input: {
  companyId: string; issueId: string; agentId: string; lowTrust: boolean;
}): Promise<PaperclipWakeHistory | null> {
  const [issue] = await db.select({
    assigneeAgentId: issues.assigneeAgentId,
    conversationAgentId: issues.conversationAgentId,
    conversationUserId: issues.conversationUserId,
  }).from(issues).where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId))).limit(1);
  if (!issue || issue.assigneeAgentId !== input.agentId || isConversation(issue)) return null;
  const [requests, lastRun, taskDocuments] = await Promise.all([
    readTaskRequests(db, { companyId: input.companyId, issueId: input.issueId, viewerAgentId: input.agentId,
      lowTrust: input.lowTrust, statuses: "history", limit: HISTORY_REQUEST_READ_LIMIT }),
    readTaskLastRun(db, { companyId: input.companyId, issueId: input.issueId, agentId: input.agentId, previousAssigneeAgentId: null }),
    readTaskDocuments(db, { companyId: input.companyId, issueId: input.issueId }),
  ]);
  const answered = requests.filter(request => !isOpen(request))
    .sort((a, b) => (b.decidedAt ?? b.askedAt).localeCompare(a.decidedAt ?? a.askedAt) || b.id.localeCompare(a.id));
  const open = requests.filter(isOpen)
    .sort((a, b) => a.askedAt.localeCompare(b.askedAt) || a.id.localeCompare(b.id));
  return {
    lastRun,
    answered: answered.slice(0, HISTORY_ANSWERED_LIMIT),
    answeredOmitted: Math.max(0, answered.length - HISTORY_ANSWERED_LIMIT),
    open,
    documents: taskDocuments,
  };
}

type PersonRef = { type: unknown; id: unknown } | null | undefined;

/** The people a history names: everyone who asked or decided, and the last run's agent. */
export function historyPeople(history: PaperclipWakeHistory | null | undefined): PersonRef[] {
  if (!history) return [];
  return [
    ...[...history.answered, ...history.open].flatMap(request => [request.askedBy, request.decidedBy]),
    history.lastRun ? { type: "agent", id: history.lastRun.agentId } : null,
  ];
}

/** Display names keyed `user:<id>` / `agent:<id>` (the wake's `names` map); unknown ids are left out. */
export async function readHistoryNames(db: Db, companyId: string, people: PersonRef[]): Promise<Record<string, string>> {
  const agentIds = new Set<string>();
  const userIds = new Set<string>();
  for (const entry of people) {
    const id = text(entry?.id);
    if (!id) continue;
    if (entry?.type === "agent" && /^[0-9a-f-]{36}$/i.test(id)) agentIds.add(id);
    else if (entry?.type === "user") userIds.add(id);
  }
  const [agentRows, userRows] = await Promise.all([
    agentIds.size === 0 ? Promise.resolve([]) : db.select({ id: agents.id, name: agents.name }).from(agents)
      .where(and(eq(agents.companyId, companyId), inArray(agents.id, [...agentIds]))),
    userIds.size === 0 ? Promise.resolve([]) : db.select({ id: authUsers.id, name: authUsers.name }).from(authUsers)
      .where(inArray(authUsers.id, [...userIds])),
  ]);
  const names: Record<string, string> = {};
  for (const row of agentRows) if (text(row.name)) names[`agent:${row.id}`] = row.name;
  for (const row of userRows) if (text(row.name)) names[`user:${row.id}`] = row.name;
  return names;
}

/**
 * `GET /issues/:id/request-history`: every request on the task, all statuses (cancelled,
 * expired, failed and superseded included), newest first, at most 50, and names for their people
 * and the task's comment authors. Redacted for the task; records nothing (unlike
 * `GET /issues/:id/interactions`, which records the declined tool actions a run read).
 */
export async function readTaskRequestHistory(db: Db, input: {
  companyId: string; issueId: string; viewerAgentId: string | null; lowTrust: boolean;
}): Promise<{ requests: PaperclipWakeRequest[]; names: Record<string, string> }> {
  const [requests, authors] = await Promise.all([
    readTaskRequests(db, { ...input, statuses: "all", limit: REQUEST_HISTORY_ROUTE_LIMIT }),
    db.selectDistinct({ agentId: issueComments.authorAgentId, userId: issueComments.authorUserId }).from(issueComments)
      .where(and(eq(issueComments.companyId, input.companyId), eq(issueComments.issueId, input.issueId), isNull(issueComments.deletedAt))),
  ]);
  const names = await readHistoryNames(db, input.companyId, [
    ...requests.flatMap(request => [request.askedBy, request.decidedBy]),
    ...authors.flatMap(row => [row.agentId ? { type: "agent", id: row.agentId } : null, row.userId ? { type: "user", id: row.userId } : null]),
  ]);
  return createRunSecretRedactionRegistry(db).redactForIssue(input.companyId, input.issueId, { requests, names });
}
