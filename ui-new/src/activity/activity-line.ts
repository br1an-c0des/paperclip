import type { ActivityEvent, Agent } from "@paperclipai/shared";
import type { AuditEntitySnippet } from "@/api/activity";

/*
 * Company activity in words: one line per activity-log entry, "who did what to which thing", with
 * a link to the thing when it has a page. The Org dashboard's Recent activity, the agent chat's
 * Activity column and the Activity page's log all draw from this one formatter (a task's own
 * thread has its own, `src/tasks/activity-format.ts`, which says what changed field by field).
 *
 * - Reads and housekeeping (marking read, inbox moves, file listings, trace lookups) are left out
 *   at company level; the log can ask for them with `keepQuiet`.
 * - A task that's one of your chats (a hidden task, decision 8) is named and linked as the chat.
 * - Links are relative to the company: `/issues/TES-4`, `/agents/quant`, `/projects/…`.
 */

/** Events the company-level feeds leave out: reads and inbox housekeeping are noise there. */
const QUIET = new Set([
  "issue.read_marked",
  "issue.read_unmarked",
  "issue.inbox_archived",
  "issue.inbox_unarchived",
  "issue.feedback_vote_saved",
  "issue.checked_out",
  "issue.released",
  "issue.conversation_opened",
  "announcement.dismissed",
  "resource_membership.starred",
  "resource_membership.unstarred",
  "issue.status_decision_recorded",
]);

// Bookkeeping too: workspace leases and cost reports (the Costs tab sums those).
const QUIET_PREFIXES = ["provider_trace.", "issue.file_resource_", "inbox.", "environment.lease_", "cost."];

/** Whether the company-level feeds leave this action out. */
export function isQuietAction(action: string) {
  return QUIET.has(action) || QUIET_PREFIXES.some((prefix) => action.startsWith(prefix));
}

const VERBS: Record<string, string> = {
  "issue.created": "created",
  "issue.updated": "updated",
  "issue.comment_added": "commented on",
  "issue.commented": "commented on",
  "issue.comment_deleted": "deleted a comment on",
  "issue.comment_cancelled": "cancelled a queued comment on",
  "issue.deleted": "deleted",
  "issue.attachment_added": "attached a file to",
  "issue.attachment_removed": "removed a file from",
  "issue.document_created": "created a document for",
  "issue.document_updated": "updated a document on",
  "issue.document_deleted": "deleted a document from",
  "issue.interaction_created": "asked a question on",
  "issue.interaction_answered": "answered a question on",
  "issue.thread_interaction_created": "asked for a decision on",
  "issue.thread_interaction_accepted": "accepted the request on",
  "issue.thread_interaction_rejected": "declined the request on",
  "issue.thread_interaction_answered": "answered the request on",
  "issue.thread_interaction_dismissed": "set aside the request on",
  "issue.thread_interaction_cancelled": "cancelled the request on",
  "issue.status_decision_recorded": "recorded a status decision on",
  "issue.recovery_action_opened": "opened a recovery action on",
  "issue.recovery_action_resolved": "resolved the recovery action on",
  "issue.recovery_action_escalated": "escalated the recovery action on",
  "issue.disposition_repair_scheduled": "scheduled a repair for",
  "issue.disposition_repair_escalated": "escalated a repair for",
  "issue.read_marked": "read",
  "issue.file_resource_list": "listed the files of",
  "issue.file_resource_read": "read a file on",
  "issue.conversation_opened": "opened",
  "agent.created": "hired",
  "agent.hire_created": "asked to hire",
  "agent.updated": "updated",
  "agent.paused": "paused",
  "agent.resumed": "resumed",
  "agent.terminated": "retired",
  "agent.approved": "approved the hire of",
  "agent.budget_updated": "set the budget for",
  "agent.config_rolled_back": "rolled back the settings of",
  "agent.key_created": "created an API key for",
  "agent.runtime_session_reset": "reset the session of",
  "agent.identity.created": "set up the identity of",
  "approval.created": "asked for approval on",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
  "approval.revision_requested": "asked for changes to",
  "project.created": "created the project",
  "project.updated": "updated the project",
  "project.deleted": "deleted the project",
  "project.workspace_created": "added a workspace to",
  "project.workspace_updated": "changed a workspace of",
  "project.workspace_deleted": "removed a workspace from",
  "project.access_member_added": "gave someone access to",
  "project.access_member_removed": "removed someone's access to",
  "resource_membership.joined": "joined",
  "resource_membership.left": "left",
  "goal.created": "created the goal",
  "goal.updated": "updated the goal",
  "goal.deleted": "deleted the goal",
  "routine.created": "created the recurring task",
  "routine.updated": "updated the recurring task",
  "routine.revision_created": "saved a revision of",
  "routine.trigger_created": "added a trigger to",
  "routine.run_triggered": "ran the recurring task",
  "company.created": "created the organization",
  "company.updated": "updated the organization",
  "company.skill_created": "created the skill",
  "company.skill_deleted": "deleted the skill",
  "company.skills_imported": "imported skills",
  "budget.policy_upserted": "set a budget for",
  "cost.reported": "reported a cost",
  "heartbeat.invoked": "started a run for",
  "heartbeat.cancelled": "stopped a run of",
  "environment.lease_acquired": "took a work environment",
  "environment.lease_released": "released a work environment",
  "audit.exported": "exported the activity log",
  "folder.created": "created the folder",
  "folder.deleted": "deleted the folder",
  "folder.item_moved": "moved",
  "ai_connection.connected": "connected",
  "instance.settings.experimental_updated": "changed the instance's experimental settings",
  "primary_agent.initialized": "chose a primary agent",
};

export type ActivityTone = "run" | "green" | "amber" | "gray";

export type ActivityLine = {
  id: string;
  who: string;
  verb: string;
  target: string;
  /** Relative to the company. */
  href?: string;
  tone: ActivityTone;
  at: string;
  /** The action as logged, such as `issue.comment_added`. */
  action: string;
  /** Who acted: an agent's id when an agent did. */
  actorAgentId?: string;
  /** The task's title, when the log row carries it. */
  title?: string;
  /** The start of the comment, for comments. */
  excerpt?: string;
  /** The document's key, for document changes on a task. */
  document?: string;
  /** The run the entry came from, when the reader may see it. */
  runId?: string;
  /** The person an agent acted for, when that's someone other than the actor. */
  onBehalfOf?: string;
};

export type ActivityNames = {
  agent: (id: string) => Pick<Agent, "name" | "urlKey"> | undefined;
  person: (id: string) => string;
  youId: string | null;
  /** The agent, when a task is one of your chats (a hidden task, decision 8), which opens as the chat. */
  chatAgent?: (issueId: string) => string | undefined;
};

/**
 * What the formatter reads: an activity event (`GET /companies/:id/activity`) or a row of the
 * activity log (`GET /companies/:id/audit/agent-actions`), which also carries snippets.
 */
export type ActivityInput = Pick<ActivityEvent, "id" | "action" | "entityType" | "entityId" | "details"> & {
  actorType: ActivityEvent["actorType"] | null;
  actorId: string | null;
  agentId?: string | null;
  runId?: string | null;
  responsibleUserId?: string | null;
  createdAt: string | Date;
  entity?: Partial<AuditEntitySnippet>;
};

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function statusVerb(details: Record<string, unknown> | null) {
  const change = (details?.changes as Record<string, { to?: unknown }> | undefined)?.status;
  const to = str(change?.to);
  if (!to) return null;
  return to === "done" ? "finished" : to === "blocked" ? "marked blocked" : to === "in_review" ? "sent for review" : to === "cancelled" ? "cancelled" : to === "in_progress" ? "started" : `moved to ${to.replace(/_/g, " ")}`;
}

function personName(id: string, names: ActivityNames) {
  return id === names.youId ? "You" : names.person(id);
}

function actorName(event: ActivityInput, names: ActivityNames) {
  if (event.actorType === "agent") return (event.actorId ? names.agent(event.actorId)?.name : undefined) ?? "An agent";
  if (event.actorType === "user" && event.actorId) return personName(event.actorId, names);
  if (event.actorType === "plugin") return "A plugin";
  return "Paperclip";
}

function toneOf(verb: string): ActivityTone {
  if (/paused|blocked|rejected|declined|terminated|retired/.test(verb)) return "gray";
  if (/hire|approval|asked/.test(verb)) return "amber";
  if (/finished|approved|accepted|sign|hired|resumed/.test(verb)) return "green";
  if (/started|run/.test(verb)) return "run";
  return "gray";
}

function targetOf(event: ActivityInput, names: ActivityNames): { target: string; href?: string; title?: string } {
  const details = event.details;
  const chatWith = event.entityType === "issue" ? names.chatAgent?.(event.entityId) : undefined;
  if (chatWith) {
    const agent = names.agent(chatWith);
    return { target: agent ? `your chat with ${agent.name}` : "your chat", href: `/agents/${agent?.urlKey ?? chatWith}` };
  }
  const issue = event.entity?.issue;
  if (event.entityType === "issue" || issue) {
    const identifier = str(details?.identifier) ?? str(issue?.identifier);
    const title = str(issue?.title) ?? str(details?.issueTitle);
    const ref = identifier ?? issue?.id ?? event.entityId;
    return { target: identifier ?? title ?? "a task", href: `/issues/${ref}`, title: identifier ? title : undefined };
  }
  const named = str(details?.title) ?? str(details?.name) ?? str(details?.identifier);
  switch (event.entityType) {
    case "agent": {
      const agent = names.agent(event.entityId);
      return { target: agent?.name ?? named ?? "an agent", href: agent ? `/agents/${agent.urlKey}` : undefined };
    }
    case "project":
      return { target: named ?? str(details?.projectName) ?? "a project", href: `/projects/${event.entityId}` };
    case "routine":
      return { target: named ?? "a recurring task", href: `/routines/${event.entityId}` };
    case "company_skill":
      return { target: named ?? str(details?.slug) ?? "a skill", href: `/skills/${event.entityId}` };
    case "case": {
      const found = event.entity?.case;
      return { target: found ? `${found.identifier} · ${found.title}` : (named ?? "a case") };
    }
    case "heartbeat_run": {
      const agentId = str(details?.agentId) ?? event.agentId ?? undefined;
      const agent = agentId ? names.agent(agentId) : undefined;
      return { target: agent?.name ?? named ?? "an agent" };
    }
    case "company":
      return { target: named && !/^company\./.test(event.action) ? named : "" };
    default:
      return { target: named ?? "" };
  }
}

/** One activity entry in words, or null for the ones company feeds leave out (unless `keepQuiet`). */
export function activityLine(event: ActivityInput, names: ActivityNames, options: { keepQuiet?: boolean } = {}): ActivityLine | null {
  if (!options.keepQuiet && isQuietAction(event.action)) return null;
  const { target, href, title } = targetOf(event, names);
  const verb = (event.action === "issue.updated" ? statusVerb(event.details) : null) ?? VERBS[event.action] ?? event.action.replace(/^[a-z_]+\./, "").replace(/[._]/g, " ");
  const line: ActivityLine = { id: event.id, who: actorName(event, names), verb, target, href, tone: toneOf(verb), at: String(event.createdAt), action: event.action };
  if (event.actorType === "agent" && event.actorId) line.actorAgentId = event.actorId;
  if (title) line.title = title;
  const excerpt = str(event.entity?.comment?.excerpt);
  if (excerpt) line.excerpt = excerpt;
  if (event.entity?.issue && event.entity.document) line.document = event.entity.document.key;
  const runId = event.runId ?? (event.entityType === "heartbeat_run" ? event.entityId : null);
  if (runId) line.runId = runId;
  // Who an agent acted for. Paperclip and people act for the board as a matter of course, which says nothing.
  if (event.actorType === "agent" && event.responsibleUserId) {
    line.onBehalfOf = personName(event.responsibleUserId, names);
  }
  return line;
}
