import { notifyToolReviewChange } from "./tool-review-work-notifications.js";
import { writeApprovalChange } from "./approval-work-notifications.js";
import { approvalResolutionRecords, resolvableApprovalStatuses as resolvableStatuses } from "../lib/approval-records.js";
import { notifyHireApproved } from "./hire-hook.js";

import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { approvalComments, approvals } from "@paperclipai/db";
import { unprocessable } from "../errors.js";
import { redactCurrentUserText } from "../log-redaction.js";
import { createAgentLifecycle } from "./agent-lifecycle.js";

import { instanceSettingsService } from "./instance-settings.js";
import {
  addPermissionRequestOverride,
  permissionRequestExpired,
  readPermissionRequestPayload,
  type PermissionRequestReplayer,
  type PermissionRequestResult,
} from "./permission-requests.js";

/** How `approve` handles a `permission_request` (step 4a, section 7). */
export interface ApproveOptions {
  /** Add the missing action as an override before replaying ("approve and always allow"). */
  alwaysAllow?: boolean;
  /** Replays the request; without one an approval records the request as failed. */
  replayer?: PermissionRequestReplayer;
}

export function approvalRecords(db: Db) {
  const instanceSettings = instanceSettingsService(db);
  const { getExistingApproval, resolveApproval } = approvalResolutionRecords(db);

  function redactApprovalComment<T extends { body: string }>(comment: T, censorUsernameInLogs: boolean): T {
    return {
      ...comment,
      body: redactCurrentUserText(comment.body, { enabled: censorUsernameInLogs }),
    };
  }

  return {
    getExistingApproval, resolveApproval,
    list: (companyId: string, status?: string, readCondition?: SQL<boolean>) => {
      const conditions = [eq(approvals.companyId, companyId)];
      if (status) conditions.push(eq(approvals.status, status));
      if (readCondition) conditions.push(readCondition);
      return db.select().from(approvals).where(and(...conditions));
    },

    getById: (id: string) =>
      db
        .select()
        .from(approvals)
        .where(eq(approvals.id, id))
        .then((rows) => rows[0] ?? null),

    findOpenHireApprovalForAgent: async (companyId: string, agentId: string) => {
      const rows = await db
        .select()
        .from(approvals)
        .where(
          and(
            eq(approvals.companyId, companyId),
            eq(approvals.type, "hire_agent"),
            inArray(approvals.status, resolvableStatuses),
            sql`${approvals.payload} ->> 'agentId' = ${agentId}`,
          ),
        );
      return rows[0] ?? null;
    },

    create: (companyId: string, data: Omit<typeof approvals.$inferInsert, "companyId">) =>
      writeApprovalChange(db, companyId, tx => tx
        .insert(approvals)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0])),

    // Cancel an open (pending/revision_requested) approval without a board
    // decision — e.g. when its paired agent is terminated during duplicate
    // cleanup, or when a person withdraws it as out of date (PAP-749). It is
    // never an approval. Idempotent: a no-op (null) on already-resolved approvals.
    cancel: async (id: string, reason?: string | null, options: { cancelledByUserId?: string | null } = {}) => {
      const now = new Date();
      const [existing] = await db.select({ companyId: approvals.companyId }).from(approvals).where(eq(approvals.id, id));
      if (!existing) return null;
      const updated = await writeApprovalChange(db, existing.companyId, async tx => {
        await notifyToolReviewChange(tx, existing.companyId);
        return tx.update(approvals)
        .set({
          status: "cancelled",
          decisionNote: reason ?? null,
          ...(options.cancelledByUserId ? { decidedByUserId: options.cancelledByUserId } : {}),
          decidedAt: now,
          updatedAt: now,
        })
        .where(and(eq(approvals.id, id), inArray(approvals.status, resolvableStatuses)))
        .returning()
        .then((rows) => rows[0] ?? null);
      }, { approvalId: id });
      return updated;
    },

    requestRevision: async (id: string, decidedByUserId: string, decisionNote?: string | null) => {
      const existing = await getExistingApproval(id);
      if (existing.status !== "pending") {
        throw unprocessable("Only pending approvals can request revision");
      }

      const now = new Date();
      return writeApprovalChange(db, existing.companyId, tx => tx
        .update(approvals)
        .set({
          status: "revision_requested",
          decidedByUserId,
          decisionNote: decisionNote ?? null,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(approvals.id, id))
        .returning()
        .then((rows) => rows[0]), { approvalId: id });
    },

    resubmit: async (id: string, payload?: Record<string, unknown>) => {
      const existing = await getExistingApproval(id);
      if (existing.status !== "revision_requested") {
        throw unprocessable("Only revision requested approvals can be resubmitted");
      }

      const now = new Date();
      return writeApprovalChange(db, existing.companyId, tx => tx
        .update(approvals)
        .set({
          status: "pending",
          payload: payload ?? existing.payload,
          decisionNote: null,
          decidedByUserId: null,
          decidedAt: null,
          updatedAt: now,
        })
        .where(eq(approvals.id, id))
        .returning()
        .then((rows) => rows[0]), { approvalId: id });
    },

    listComments: async (approvalId: string) => {
      const existing = await getExistingApproval(approvalId);
      const { censorUsernameInLogs } = await instanceSettings.getGeneral();
      return db
        .select()
        .from(approvalComments)
        .where(
          and(
            eq(approvalComments.approvalId, approvalId),
            eq(approvalComments.companyId, existing.companyId),
          ),
        )
        .orderBy(asc(approvalComments.createdAt))
        .then((comments) => comments.map((comment) => redactApprovalComment(comment, censorUsernameInLogs)));
    },

    addComment: async (
      approvalId: string,
      body: string,
      actor: { agentId?: string; userId?: string },
    ) => {
      const existing = await getExistingApproval(approvalId);
      const currentUserRedactionOptions = {
        enabled: (await instanceSettings.getGeneral()).censorUsernameInLogs,
      };
      const redactedBody = redactCurrentUserText(body, currentUserRedactionOptions);
      return db
        .insert(approvalComments)
        .values({
          companyId: existing.companyId,
          approvalId,
          authorAgentId: actor.agentId ?? null,
          authorUserId: actor.userId ?? null,
          body: redactedBody,
        })
        .returning()
        .then((rows) => redactApprovalComment(rows[0], currentUserRedactionOptions.enabled));
    },
  };
}

export function approvalService(db: Db) {
  const { getExistingApproval, resolveApproval, ...records } = approvalRecords(db);
  async function reconcileApprovedBuiltInAgent(companyId: string, payload: Record<string, unknown>, database: Db) {
    const sourceBuiltInAgentKey = typeof payload.sourceBuiltInAgentKey === "string" ? payload.sourceBuiltInAgentKey : null;
    if (!sourceBuiltInAgentKey) return;
    const { builtInAgentService } = await import("./built-in-agents.js");
    await builtInAgentService(database).ensure(companyId, sourceBuiltInAgentKey);
  }

  async function decideHire(target: string | { approvalId: string }, status: "approved" | "rejected", userId: string, note?: string | null) {
    const lifecycle = createAgentLifecycle(db);
    const result = await (status === "approved" ? lifecycle.approveHire : lifecycle.rejectHire)(target, userId, note);
    if (result?.hireApprovedAgentId && result.approval) {
      await reconcileApprovedBuiltInAgent(result.approval.companyId, result.approval.payload, db);
      void notifyHireApproved(db, { companyId: result.approval.companyId, agentId: result.hireApprovedAgentId,
        source: "approval", sourceId: result.approval.id, approvedAt: result.approval.decidedAt ?? new Date() }).catch(() => {});
    }
    return result;
  }

  /**
   * Approving a permission request replays its call once (only when this decision applied, so a
   * repeated approve never replays twice) and records the outcome on the payload. Past
   * `expiresAt` it doesn't replay and records `refused: expired`.
   */
  async function approvePermissionRequest(
    approval: Awaited<ReturnType<typeof getExistingApproval>>,
    userId: string,
    note: string | null | undefined,
    options: ApproveOptions,
  ) {
    const payload = readPermissionRequestPayload(approval);
    const resolvable = ["pending", "revision_requested"].includes(approval.status);
    const expired = payload ? permissionRequestExpired(payload) : true;
    if (resolvable && payload && !expired && options.alwaysAllow) {
      await addPermissionRequestOverride(db, approval.companyId, payload, userId);
    }
    const resolution = await resolveApproval(approval.id, "approved", userId, note);
    if (!resolution.applied) return resolution;
    const at = () => new Date().toISOString();
    const outcome: PermissionRequestResult = !payload
      ? { status: "failed", detail: "The request's payload is unreadable.", at: at() }
      : expired
        ? { status: "refused", detail: "expired", at: at() }
        : options.replayer
          ? await options.replayer.replay(resolution.approval, payload)
          : { status: "failed", detail: "Paperclip can't replay requests here.", at: at() };
    const [updated] = await db.update(approvals)
      .set({ payload: { ...resolution.approval.payload, result: outcome }, updatedAt: new Date() })
      .where(eq(approvals.id, approval.id))
      .returning();
    return {
      approval: updated ?? resolution.approval,
      applied: true,
      ...(payload ? { permissionRequest: { payload, result: outcome } } : {}),
    };
  }

  async function decide(id: string, status: "approved" | "rejected", userId: string, note?: string | null, options: ApproveOptions = {}) {
    const approval = await getExistingApproval(id);
    if (options.alwaysAllow && approval.type !== "permission_request") {
      throw unprocessable("alwaysAllow applies only to permission requests");
    }
    if (approval.type === "hire_agent") {
      const result = await decideHire({ approvalId: id }, status, userId, note);
      return { approval: result!.approval!, applied: result!.applied };
    }
    if (approval.type === "permission_request" && status === "approved") {
      return approvePermissionRequest(approval, userId, note, options);
    }
    return resolveApproval(id, status, userId, note);
  }
  return { ...records,
    approveHire: (agentId: string, userId: string, note?: string | null) => decideHire(agentId, "approved", userId, note),
    rejectHire: (agentId: string, userId: string, note?: string | null) => decideHire(agentId, "rejected", userId, note),
    approve: (id: string, userId: string, note?: string | null, options?: ApproveOptions) => decide(id, "approved", userId, note, options),
    reject: (id: string, userId: string, note?: string | null) => decide(id, "rejected", userId, note),
  };
}
