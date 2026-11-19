import { agents, issues, type Db } from "@paperclipai/db";
import { extractAgentMentionIds, isUuidLike, type AgentInteractionPermissionKey } from "@paperclipai/shared";
import { and, eq, inArray, or } from "drizzle-orm";
import { forbidden, notFound } from "../errors.js";
import { currentPluginInteractionOrigin } from "./plugin-interaction-context.js";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type AgentInteractionOperation = "assign" | "comment" | "edit" | "configure" | "mention";

export interface AgentInteractionInput {
  companyId: string;
  actorAgentId?: string | null;
  actorCompanyId?: string;
  operation: AgentInteractionOperation;
  issueId?: string | null;
  targetAgentId?: string | null;
  assigneeUserId?: string | null;
  parentIssueId?: string | null;
  texts?: readonly string[];
  lock?: boolean | "update";
  lockAgentIds?: readonly string[];
  delivery?: boolean;
}

export interface AgentInteractionDenial {
  code: "agent_interaction_denied";
  operation: AgentInteractionOperation;
  permission: AgentInteractionPermissionKey;
  direction: "incoming" | "outgoing";
  policyAgentId: string;
  actorAgentId: string;
  targetAgentId: string | null;
  issueId: string | null;
}

export async function agentInteractionDenial(
  db: Db | DbTransaction,
  input: AgentInteractionInput,
): Promise<AgentInteractionDenial | null> {
  const origin = currentPluginInteractionOrigin();
  const actorCompanyId = input.actorCompanyId ?? input.companyId;
  if (origin && origin.companyId !== actorCompanyId) throw notFound("Company resource not found");
  const actorAgentId = origin?.agentId ?? input.actorAgentId;
  if (!actorAgentId) return null;

  const issueIds = [...new Set([input.issueId, input.parentIssueId].filter((id): id is string => Boolean(id)))].sort();
  const taskQuery = issueIds.length ? db.select({
    id: issues.id, assigneeAgentId: issues.assigneeAgentId, conversationAgentId: issues.conversationAgentId,
  }).from(issues).where(and(eq(issues.companyId, input.companyId), inArray(issues.id, issueIds))).orderBy(issues.id) : null;
  const tasks = taskQuery ? await (input.lock ? taskQuery.for("update") : taskQuery) : [];
  if (tasks.length !== issueIds.length) throw notFound("Task not found");
  const issue = tasks.find(task => task.id === input.issueId);
  const parent = tasks.find(task => task.id === input.parentIssueId);
  const owner = (task: typeof issue) => task?.conversationAgentId ?? task?.assigneeAgentId ?? null;
  const mentions = [...new Set((input.texts ?? []).flatMap(extractAgentMentionIds).filter(isUuidLike))];
  const agentIds = [...new Set([
    actorAgentId, input.targetAgentId, owner(issue), owner(parent), ...mentions, ...(input.lockAgentIds ?? []).filter(isUuidLike),
  ].filter((id): id is string => Boolean(id)))].sort();
  const agentQuery = db.select({ id: agents.id, companyId: agents.companyId, permissions: agents.permissions }).from(agents)
    .where(or(and(eq(agents.companyId, input.companyId), inArray(agents.id, agentIds)),
      and(eq(agents.companyId, actorCompanyId), eq(agents.id, actorAgentId)))).orderBy(agents.id);
  const rows = await (input.lock ? agentQuery.for(input.lock === "update" ? "no key update" : "share") : agentQuery);
  const byId = new Map(rows.map(row => [row.id, row.permissions]));
  if (!rows.some(row => row.id === actorAgentId && row.companyId === actorCompanyId)
    || (input.targetAgentId && !rows.some(row => row.id === input.targetAgentId && row.companyId === input.companyId))) {
    throw notFound("Agent not found");
  }

  function denied(
    permission: AgentInteractionPermissionKey,
    policyAgentId: string,
    direction: AgentInteractionDenial["direction"],
    targetAgentId: string | null,
    operation = input.operation,
    issueId = input.issueId ?? null,
  ): AgentInteractionDenial | null {
    const permissions = byId.get(policyAgentId);
    const interactions = permissions && typeof permissions === "object"
      ? (permissions as Record<string, unknown>).interactions : null;
    if (!interactions || typeof interactions !== "object" ||
        (interactions as Record<string, unknown>)[permission] !== false) return null;
    return { code: "agent_interaction_denied", operation, permission, direction,
      policyAgentId, actorAgentId: actorAgentId!, targetAgentId, issueId };
  }

  // Consent: whether the target agent accepts this from other agents (its receiver-side switch).
  function receiver(
    targetAgentId: string | null,
    incoming: AgentInteractionPermissionKey,
    operation = input.operation,
    issueId = input.issueId ?? null,
  ) {
    if (!targetAgentId || targetAgentId === actorAgentId) return null;
    return denied(incoming, targetAgentId, "incoming", targetAgentId, operation, issueId);
  }

  function peer(
    targetAgentId: string | null,
    outgoing: AgentInteractionPermissionKey,
    incoming: AgentInteractionPermissionKey,
    operation = input.operation,
    issueId = input.issueId ?? null,
  ) {
    if (targetAgentId === actorAgentId) return null;
    return denied(outgoing, actorAgentId!, "outgoing", targetAgentId, operation, issueId)
      ?? receiver(targetAgentId, incoming, operation, issueId);
  }

  // Assigning, editing another's task and configuring another agent are access actions since step 4a
  // (tasks:assign, tasks:update_any, agents:configure in authorization.ts and the agent route
  // policy); the actor-side switches that covered them are retired. Only the receiver's consent is
  // checked here.
  let result: AgentInteractionDenial | null = null;
  switch (input.operation) {
    case "assign":
      if (!input.delivery) {
        if (issue) result = receiver(owner(issue), "canReceiveTaskEditsFromAgents", "edit");
        if (!result && parent) result = receiver(owner(parent), "canReceiveTaskEditsFromAgents", "edit", parent.id);
      }
      if (!result && input.targetAgentId) result = receiver(input.targetAgentId, "canReceiveAssignmentsFromAgents");
      break;
    case "comment":
      result = peer(input.delivery && input.targetAgentId ? input.targetAgentId : owner(issue),
        "canCommentOnOtherTasks", "canReceiveCommentsFromAgents");
      break;
    case "edit":
      result = receiver(owner(issue), "canReceiveTaskEditsFromAgents");
      if (!result && parent) result = receiver(owner(parent), "canReceiveTaskEditsFromAgents", "edit", parent.id);
      break;
    case "configure":
      if (input.targetAgentId) result = receiver(input.targetAgentId, "canReceiveConfigurationChangesFromAgents");
      break;
    case "mention":
      if (input.targetAgentId) result = peer(input.targetAgentId, "canMentionAgents", "canReceiveMentionsFromAgents");
      break;
  }
  if (result) return result;
  for (const target of mentions) {
    if (!byId.has(target)) continue;
    result = peer(target, "canMentionAgents", "canReceiveMentionsFromAgents", "mention");
    if (result) return result;
  }
  return null;
}

export async function assertAgentInteraction(db: Db | DbTransaction, input: AgentInteractionInput): Promise<void> {
  const denial = await agentInteractionDenial(db, input);
  if (denial) throw forbidden(`Agent interaction is disabled by ${denial.permission}. A human permission manager can change this setting.`, denial);
}
