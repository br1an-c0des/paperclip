import type { Router } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { agents, approvals, companies, issues, mcpOauthGrants, type Db } from "@paperclipai/db";
import {
  agentAccessOverridesSchema,
  hasAgentAccess,
  permissionRequestPayloadSchema,
  type AgentAccessAction,
  type PermissionRequestPayload,
} from "@paperclipai/shared";
import { logger } from "../middleware/logger.js";
import { catalogDeps } from "../mcp/catalog-deps.js";
import type { McpCaller, PaperclipTool } from "../mcp/catalog/types.js";
import { createCatalogDispatch, McpToolError, type CatalogDispatchOptions } from "../mcp/dispatch.js";
import { HttpError } from "../errors.js";
import { logActivity } from "./activity-log.js";
import {
  loadAgentAccess,
  runWithReplayAccess,
  withAccessOverride,
  withStoredAccess,
  type TemporaryAccessResource,
} from "./agent-access.js";
import { writeApprovalChange } from "./approval-work-notifications.js";
import { issueApprovalService } from "./issue-approvals.js";
import { connectionAccess } from "./public-mcp/connection-access.js";

/** A permission request is good for 7 days (step 4a, section 7). */
export const PERMISSION_REQUEST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ApprovalRow = typeof approvals.$inferSelect;
export type PermissionRequestResult = NonNullable<PermissionRequestPayload["result"]>;

export interface CreatePermissionRequestInput {
  caller: McpCaller;
  tool: string;
  arguments: Record<string, unknown>;
  missingAction: AgentAccessAction;
  /** The task the call is about (UUID or identifier), if any; a run's own task otherwise. */
  taskId: string | null;
}

export interface CreatedPermissionRequest {
  approvalId: string;
  /** The request in the board, relative to the board's origin. */
  url: string;
  /** True when an identical pending request was found and reused. */
  reused: boolean;
}

async function resolveTask(db: Db, companyId: string, taskId: string | null) {
  if (!taskId) return null;
  const [task] = await db.select({ id: issues.id, identifier: issues.identifier }).from(issues)
    .where(and(eq(issues.companyId, companyId), UUID.test(taskId) ? eq(issues.id, taskId) : eq(issues.identifier, taskId.toUpperCase())));
  return task ?? null;
}

/** One plain sentence for the Inbox: "Delete task TES-12", "Manage labels". */
export function permissionRequestSummary(tool: string, taskIdentifier: string | null): string {
  const words = tool.replace(/^paperclip_/, "").split("_").filter(Boolean);
  const phrase = words.join(" ");
  const sentence = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  if (!taskIdentifier) return sentence;
  return words.at(-1) === "task" ? `${sentence} ${taskIdentifier}` : `${sentence} on ${taskIdentifier}`;
}

async function connectionName(db: Db, grantId: string | null): Promise<string | null> {
  if (!grantId) return null;
  const rows = await db.execute(sql`
    SELECT c.name FROM mcp_oauth_grants g JOIN mcp_oauth_clients c ON c.id = g.client_id WHERE g.id = ${grantId}
  `);
  const row = (Array.isArray(rows) ? rows[0] : undefined) as { name?: unknown } | undefined;
  return typeof row?.name === "string" ? row.name : null;
}

/**
 * Writes a `permission_request` approval for a call refused by the caller's level or an override
 * (step 4a, section 7), or reuses an identical pending one: same caller principal, tool, arguments
 * and task. Only `createPermissionRequest` makes these; the approvals route refuses them.
 */
export async function createPermissionRequest(db: Db, input: CreatePermissionRequestInput): Promise<CreatedPermissionRequest> {
  const { caller } = input;
  const runTaskId = !input.taskId && caller.runId ? (await catalogDeps(db).runTask(caller.runId)).taskId : null;
  const task = await resolveTask(db, caller.companyId, input.taskId ?? runTaskId);
  const [company] = await db.select({ issuePrefix: companies.issuePrefix }).from(companies).where(eq(companies.id, caller.companyId));
  const url = (id: string) => `/${company?.issuePrefix ?? ""}/approvals/${id}`;
  // A task id in the arguments is stored as the UUID, so the replay names the same task.
  const args = task && typeof input.arguments.taskId === "string" ? { ...input.arguments, taskId: task.id } : input.arguments;
  const principal = {
    agentId: caller.agentId,
    userId: caller.kind === "oauth_person" || caller.kind === "oauth_agent" ? caller.userId : null,
    grantId: caller.grantId,
  };

  const [existing] = await db.select({ id: approvals.id }).from(approvals).where(and(
    eq(approvals.companyId, caller.companyId),
    eq(approvals.type, "permission_request"),
    inArray(approvals.status, ["pending", "revision_requested"]),
    sql`${approvals.payload}->>'tool' = ${input.tool}`,
    sql`${approvals.payload}->'arguments' = ${JSON.stringify(args)}::jsonb`,
    sql`${approvals.payload}->>'taskId' IS NOT DISTINCT FROM ${task?.id ?? null}`,
    sql`${approvals.payload}->'caller'->>'agentId' IS NOT DISTINCT FROM ${principal.agentId}`,
    sql`${approvals.payload}->'caller'->>'userId' IS NOT DISTINCT FROM ${principal.userId}`,
    sql`${approvals.payload}->'caller'->>'grantId' IS NOT DISTINCT FROM ${principal.grantId}`,
    sql`(${approvals.payload}->>'expiresAt')::timestamptz > now()`,
  )).limit(1);
  if (existing) return { approvalId: existing.id, url: url(existing.id), reused: true };

  const payload: PermissionRequestPayload = {
    version: 1,
    caller: { kind: caller.kind, ...principal, runId: caller.runId },
    connectionName: await connectionName(db, caller.grantId),
    taskId: task?.id ?? null,
    tool: input.tool,
    arguments: args,
    missingAction: input.missingAction,
    summary: permissionRequestSummary(input.tool, task?.identifier ?? null),
    expiresAt: new Date(Date.now() + PERMISSION_REQUEST_LIFETIME_MS).toISOString(),
  };
  const approval = await writeApprovalChange(db, caller.companyId, tx => tx.insert(approvals).values({
    companyId: caller.companyId,
    type: "permission_request",
    payload: payload as unknown as Record<string, unknown>,
    requestedByAgentId: caller.agentId,
    requestedByUserId: caller.kind === "oauth_person" ? caller.userId : null,
    status: "pending",
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    updatedAt: new Date(),
  }).returning().then(rows => rows[0]!));
  if (task) {
    await issueApprovalService(db).linkManyForApproval(approval.id, [task.id], {
      agentId: caller.agentId,
      userId: caller.kind === "oauth_person" ? caller.userId : null,
    });
  }
  await logActivity(db, {
    companyId: caller.companyId,
    actorType: caller.agentId ? "agent" : "user",
    actorId: caller.agentId ?? caller.userId ?? "unknown",
    agentId: caller.agentId,
    runId: caller.runId,
    action: "approval.created",
    entityType: "approval",
    entityId: approval.id,
    details: { type: "permission_request", tool: input.tool, missingAction: input.missingAction, issueIds: task ? [task.id] : [] },
  });
  return { approvalId: approval.id, url: url(approval.id), reused: false };
}

export type PermissionRequestCreator = (input: CreatePermissionRequestInput) => Promise<CreatedPermissionRequest>;

export function permissionRequestCreator(db: Db): PermissionRequestCreator {
  return input => createPermissionRequest(db, input);
}

export function readPermissionRequestPayload(approval: Pick<ApprovalRow, "payload">): PermissionRequestPayload | null {
  const parsed = permissionRequestPayloadSchema.safeParse(approval.payload);
  return parsed.success ? parsed.data : null;
}

export function permissionRequestExpired(payload: PermissionRequestPayload, now = new Date()): boolean {
  const expiresAt = Date.parse(payload.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
}

/**
 * "Approve and always allow": the missing action becomes an override where it's missing, so the
 * caller isn't asked again. An agent caller gets it on the agent; a connection acting as the person
 * on the connection; a connection acting as an agent on whichever of the two lacks it.
 */
export async function addPermissionRequestOverride(
  db: Db,
  companyId: string,
  payload: PermissionRequestPayload,
  decidedByUserId: string,
): Promise<void> {
  const action = payload.missingAction;
  const { caller } = payload;
  let grant: typeof mcpOauthGrants.$inferSelect | undefined;
  if (caller.grantId) {
    [grant] = await db.select().from(mcpOauthGrants)
      .where(and(eq(mcpOauthGrants.id, caller.grantId), eq(mcpOauthGrants.companyId, companyId)));
  }
  const toAgent = caller.agentId && (caller.kind !== "oauth_agent"
    || !hasAgentAccess(await loadAgentAccess(db, caller.agentId), action));
  if (toAgent && caller.agentId) {
    const [agent] = await db.select({ permissions: agents.permissions }).from(agents)
      .where(and(eq(agents.id, caller.agentId), eq(agents.companyId, companyId)));
    if (agent) {
      const access = withAccessOverride(agent.permissions, action, true);
      await db.update(agents).set({ permissions: withStoredAccess(agent.permissions ?? {}, access), updatedAt: new Date() })
        .where(eq(agents.id, caller.agentId));
      await logActivity(db, {
        companyId, actorType: "user", actorId: decidedByUserId, action: "agent.access_override_added",
        entityType: "agent", entityId: caller.agentId, details: { action, source: "permission_request" },
      });
    }
  }
  const toGrant = grant && (caller.kind === "oauth_person"
    || (caller.kind === "oauth_agent" && !hasAgentAccess(connectionAccess(grant, null), action)));
  if (grant && toGrant) {
    const current = agentAccessOverridesSchema.safeParse(grant.accessOverrides ?? {});
    const overrides = { ...(current.success ? current.data : {}), [action]: true };
    await db.update(mcpOauthGrants).set({ accessOverrides: overrides }).where(eq(mcpOauthGrants.id, grant.id));
    await logActivity(db, {
      companyId, actorType: "user", actorId: decidedByUserId, action: "mcp_connection.updated",
      entityType: "mcp_connection", entityId: grant.id, details: { accessOverrides: overrides, source: "permission_request" },
    });
  }
}

export interface PermissionRequestReplayer {
  /** Replays the request once, as its caller without a run id, and says what happened. */
  replay(approval: ApprovalRow, payload: PermissionRequestPayload): Promise<PermissionRequestResult>;
  /** Posts a one-line comment on the task as the person who decided, which wakes its assignee. */
  report(taskId: string, body: string, decider: Express.Request["actor"]): Promise<void>;
}

export interface PermissionRequestReplayerDeps {
  db: Db;
  /** The main API router, re-entered in-process as the caller. */
  api: Router;
  catalog: readonly PaperclipTool[];
  dispatchOptions?: CatalogDispatchOptions;
  /** Rebuilds an OAuth caller from its grant; throws when the grant is revoked or gone. */
  resolveGrantCaller?: (grantId: string) => Promise<McpCaller>;
}

/**
 * What the replay's allow covers: the task, when the call names one (its `taskId` argument, stored
 * as the UUID), otherwise the company. A request from a run records the run's task for the report
 * comment, but a call that doesn't name it (`paperclip_manage_labels`) acts on company resources,
 * which an allow scoped to that task wouldn't cover.
 */
function replayResource(companyId: string, payload: PermissionRequestPayload): TemporaryAccessResource {
  return payload.taskId && payload.arguments.taskId === payload.taskId
    ? { type: "issue", id: payload.taskId }
    : { type: "company", id: companyId };
}

function result(status: PermissionRequestResult["status"], detail: string): PermissionRequestResult {
  return { status, detail: detail.length > 1000 ? detail.slice(0, 997) + "..." : detail, at: new Date().toISOString() };
}

/**
 * Builds the replayer that approvals use for `permission_request` (step 4a, section 7). It's made in
 * `app.ts`, which has the API router, and handed to the approval routes.
 */
export function createPermissionRequestReplayer(deps: PermissionRequestReplayerDeps): PermissionRequestReplayer {
  const { db } = deps;

  async function rebuildCaller(companyId: string, payload: PermissionRequestPayload): Promise<McpCaller> {
    const { caller } = payload;
    if (caller.kind === "oauth_person" || caller.kind === "oauth_agent") {
      if (!caller.grantId || !deps.resolveGrantCaller) {
        throw new McpToolError({ status: 403, code: "connection_unavailable", message: "The connection that asked is no longer available." });
      }
      const rebuilt = await deps.resolveGrantCaller(caller.grantId).catch(() => {
        throw new McpToolError({ status: 403, code: "connection_unavailable", message: "The connection that asked was revoked or is no longer available." });
      });
      if (rebuilt.companyId !== companyId) {
        throw new McpToolError({ status: 403, code: "connection_unavailable", message: "The connection now belongs to another company." });
      }
      return rebuilt;
    }
    if (!caller.agentId) throw new McpToolError({ status: 403, code: "caller_unavailable", message: "The request has no agent to act as." });
    const [agent] = await db.select({ id: agents.id, status: agents.status }).from(agents)
      .where(and(eq(agents.id, caller.agentId), eq(agents.companyId, companyId)));
    if (!agent || agent.status === "terminated") {
      throw new McpToolError({ status: 403, code: "caller_unavailable", message: "The agent that asked no longer exists." });
    }
    // A run's call is replayed as the agent without its run, like an agent key.
    const actor: Express.Request["actor"] = { type: "agent", source: "agent_key", agentId: agent.id, companyId };
    return {
      kind: "agent_key", actor, companyId, agentId: agent.id, userId: null, runId: null, grantId: null,
      access: await loadAgentAccess(db, agent.id),
    };
  }

  return {
    async replay(approval, payload) {
      const definition = deps.catalog.find(candidate => candidate.name === payload.tool);
      if (!definition) return result("failed", `${payload.tool} is no longer a Paperclip tool.`);
      const parsed = definition.input.safeParse(payload.arguments);
      if (!parsed.success) return result("failed", "The stored arguments are no longer valid for this tool.");
      try {
        const caller = await rebuildCaller(approval.companyId, payload);
        const principal = caller.kind === "oauth_person"
          ? { type: "user" as const, id: caller.userId! }
          : { type: "agent" as const, id: caller.agentId! };
        const dispatch = createCatalogDispatch(deps.api, caller, deps.dispatchOptions);
        // The missing action is allowed on the request's resource for this replay only, every write
        // of it (a tool may make several), and for nothing after it: no grant is stored.
        const output = await runWithReplayAccess({
          companyId: approval.companyId,
          principal,
          action: payload.missingAction,
          resource: replayResource(approval.companyId, payload),
        }, () => definition.run(caller, parsed.data, dispatch));
        return result("done", output === undefined || output === null ? "Done." : JSON.stringify(output));
      } catch (error) {
        if (error instanceof McpToolError || error instanceof HttpError) {
          return result(error.status < 500 ? "refused" : "failed", error.message);
        }
        logger.error({ err: error, approvalId: approval.id, tool: payload.tool }, "permission request replay failed");
        return result("failed", `${payload.tool} failed unexpectedly.`);
      }
    },

    async report(taskId, body, decider) {
      const caller = { actor: decider, runId: null } as unknown as McpCaller;
      await createCatalogDispatch(deps.api, caller, deps.dispatchOptions)("POST", `/issues/${encodeURIComponent(taskId)}/comments`, { body });
    },
  };
}

/** The one-line task comment that reports an approved request's outcome. */
export function permissionRequestOutcomeComment(payload: PermissionRequestPayload, outcome: PermissionRequestResult): string {
  const what = `Permission request approved: ${payload.summary}`;
  if (outcome.status === "done") return `${what}. Done.`;
  if (outcome.detail === "expired") return `${what}, but it had expired, so it wasn't carried out.`;
  const detail = outcome.detail.replace(/\s+/g, " ").trim();
  return outcome.status === "refused" ? `${what}, but Paperclip refused it: ${detail}` : `${what}, but it failed: ${detail}`;
}
