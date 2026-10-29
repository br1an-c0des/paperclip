import type { ExternalObjectSummary, IssueAccessGrant, IssueRecoveryAction } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { matchesExternalStatus, objectName } from "./external-objects";
import { canDismissRecovery, recoveryCard, resolveBody } from "./recovery-actions";
import { isMarkdownContent, markdownOutput, reviewDocumentKey, isReviewDocumentKey, reviewProblem } from "./review-documents";
import { activeGrants, canRevoke, grantedKeys, isSharedAgent, roleRows } from "./share-model";
import { anchorSection, nearBottom, parseTaskAnchor } from "./task-anchor";
import { originRoutineId, originTask, originText, requester, reviewPolicyBadge } from "./task-origin";

/* The task panel's small models from M7: origin, recovery cards, sharing, anchors, external objects, review documents. */

describe("where a task came from", () => {
  it("names the person behind an agent's task when there is one", () => {
    expect(requester({ createdByUserId: "u1", createdByAgentId: null, responsibleUserId: null })).toEqual({ kind: "user", id: "u1" });
    expect(requester({ createdByUserId: null, createdByAgentId: "a1", responsibleUserId: "u2" })).toEqual({ kind: "user", id: "u2", viaAgentId: "a1" });
    expect(requester({ createdByUserId: null, createdByAgentId: "a1", responsibleUserId: null })).toEqual({ kind: "agent", id: "a1" });
    expect(requester({ createdByUserId: null, createdByAgentId: null, responsibleUserId: null })).toBeNull();
  });

  it("links a recovery or watchdog task to the task it's about, and a routine run to its routine", () => {
    expect(originTask({ originKind: "stranded_issue_recovery", originId: "t9" })).toEqual({ label: "Recovery for", taskId: "t9" });
    expect(originTask({ originKind: "routine_execution", originId: "r1" })).toBeNull();
    expect(originRoutineId({ originKind: "routine_execution", originId: "r1" })).toBe("r1");
    expect(originText("plugin:acme")).toBe("Plugin acme");
    expect(originText("some_new_kind")).toBe("Some new kind");
    expect(originText("manual")).toBeNull();
  });

  it("badges the review policies that narrow who approves", () => {
    expect(reviewPolicyBadge("human_only")?.label).toBe("Human only");
    expect(reviewPolicyBadge("not_creator")?.label).toBe("Anyone else");
    expect(reviewPolicyBadge(null)).toBeNull();
  });
});

const action = (fields: Partial<IssueRecoveryAction>) =>
  ({
    id: "ra1",
    kind: "missing_disposition",
    status: "active",
    ownerType: "agent",
    cause: null,
    nextAction: null,
    attemptCount: 1,
    maxAttempts: null,
    ...fields,
  }) as unknown as IssueRecoveryAction;

describe("recovery cards", () => {
  it("asks a person only when the board owns it or it escalated", () => {
    expect(recoveryCard(action({}), { board: true })?.state).toBe("in_progress");
    expect(recoveryCard(action({ status: "escalated" }), { board: true })?.state).toBe("needed");
    expect(recoveryCard(action({ kind: "active_run_watchdog" }), { board: true })?.state).toBe("observing");
    expect(recoveryCard(action({ status: "resolved" }), { board: true })).toBeNull();
  });

  it("offers 'raised in error' to the board only, and no retry when the cause needs reconciling", () => {
    const board = recoveryCard(action({ ownerType: "board" }), { board: true })!.outcomes.map((each) => each.outcome);
    expect(board).toEqual(["todo", "done", "in_review", "false_positive_done", "false_positive_in_review"]);
    const agentView = recoveryCard(action({ ownerType: "board" }), { board: false })!.outcomes.map((each) => each.outcome);
    expect(agentView).toEqual(["todo", "done", "in_review"]);
    const uncertain = recoveryCard(action({ ownerType: "board", cause: "uncertain_provider_action" }), { board: true })!.outcomes;
    expect(uncertain.some((each) => each.outcome === "todo")).toBe(false);
  });

  it("says a person is needed when the board owns a wait Paperclip couldn't repair", () => {
    expect(recoveryCard(action({ ownerType: "board", kind: "deliberate_wait_without_target" }), { board: true })!.headline).toMatch(/needs a person/);
    expect(recoveryCard(action({ attemptCount: 2, maxAttempts: 3 }), { board: true })!.attempts).toBe("Attempt 2 of 3");
  });

  it("sends a false positive with the status it settles on", () => {
    expect(resolveBody("ra1", "false_positive_in_review")).toEqual({ actionId: "ra1", outcome: "false_positive", sourceIssueStatus: "in_review" });
    expect(resolveBody("ra1", "done")).toEqual({ actionId: "ra1", outcome: "restored", sourceIssueStatus: "done" });
  });

  it("lets members who aren't viewers settle it", () => {
    expect(canDismissRecovery("c1", null, true)).toBe(true);
    expect(canDismissRecovery("c1", null, false)).toBe(false);
    const access = (role: string) =>
      ({ source: "session", isInstanceAdmin: false, companyIds: ["c1"], memberships: [{ companyId: "c1", status: "active", membershipRole: role }] }) as never;
    expect(canDismissRecovery("c1", access("viewer"), false)).toBe(false);
    expect(canDismissRecovery("c1", access("member"), false)).toBe(true);
  });
});

const grant = (fields: Partial<IssueAccessGrant>) =>
  ({ id: "g1", subjectType: "agent", subjectId: "a1", source: "explicit", inherited: false, revokedAt: null, ...fields }) as unknown as IssueAccessGrant;

describe("sharing a private task", () => {
  it("can take back direct shares and assignments, not the owner's or inherited access", () => {
    expect(canRevoke(grant({}))).toBe(true);
    expect(canRevoke(grant({ source: "assignment" }))).toBe(true);
    expect(canRevoke(grant({ source: "owner" }))).toBe(false);
    expect(canRevoke(grant({ inherited: true }))).toBe(false);
  });

  it("counts only live, own grants as already shared", () => {
    const grants = [grant({}), grant({ id: "g2", subjectId: "a2", revokedAt: new Date("2026-10-01") }), grant({ id: "g3", subjectId: "a3", source: "project" })];
    expect(activeGrants(grants).map((each) => each.id)).toEqual(["g1", "g3"]);
    expect([...grantedKeys(grants)]).toEqual(["agent:a1"]);
  });

  it("lists the owner and assignee once each", () => {
    expect(roleRows({ responsibleUserId: "u1", assigneeAgentId: "a1", assigneeUserId: "u1" }).map((row) => `${row.key} ${row.role}`)).toEqual([
      "user:u1 Owner",
      "agent:a1 Assignee",
    ]);
  });

  it("treats an agent as shared unless it's made private", () => {
    expect(isSharedAgent({ permissions: {} } as never)).toBe(true);
    expect(isSharedAgent({ permissions: { authorizationPolicy: { agentVisibility: { mode: "private" } } } } as never)).toBe(false);
  });
});

describe("links into a task", () => {
  it("reads comment and document fragments", () => {
    expect(parseTaskAnchor("#comment-c1")).toEqual({ kind: "comment", id: "c1" });
    expect(parseTaskAnchor("#document-plan%20v2")).toEqual({ kind: "document", key: "plan v2" });
    expect(parseTaskAnchor("#comment-")).toBeNull();
    expect(parseTaskAnchor("#other")).toBeNull();
    expect(anchorSection({ kind: "comment", id: "c1" })).toBe("activity");
    expect(anchorSection({ kind: "document", key: "plan" })).toBe("files");
  });

  it("follows the thread only near its foot", () => {
    expect(nearBottom({ scrollTop: 900, scrollHeight: 1500, clientHeight: 500 })).toBe(true);
    expect(nearBottom({ scrollTop: 100, scrollHeight: 1500, clientHeight: 500 })).toBe(false);
  });
});

const summary = (fields: Partial<ExternalObjectSummary>) =>
  ({ total: 1, byStatusCategory: {}, byLiveness: {}, staleCount: 0, authRequiredCount: 0, unreachableCount: 0, objects: [], ...fields }) as unknown as ExternalObjectSummary;

describe("external objects", () => {
  it("matches the list filter as the old list does", () => {
    expect(matchesExternalStatus(summary({ byStatusCategory: { blocked: 1 } }), "failed")).toBe(true);
    expect(matchesExternalStatus(summary({ byLiveness: { auth_required: 1 } }), "auth_required")).toBe(true);
    expect(matchesExternalStatus(summary({ staleCount: 2 }), "stale")).toBe(true);
    expect(matchesExternalStatus(undefined, "none")).toBe(true);
    expect(matchesExternalStatus(summary({}), "none")).toBe(false);
    expect(matchesExternalStatus(summary({}), "running")).toBe(false);
  });

  it("names a GitHub pull request from its address", () => {
    const name = objectName({
      providerKey: "github",
      objectType: "pull_request",
      displayKey: null,
      sanitizedCanonicalUrl: "https://github.com/acme/app/pull/42",
    } as never);
    expect(name).toContain("42");
  });
});

describe("review documents for Markdown outputs", () => {
  const output = (metadata: Record<string, unknown>) =>
    ({ type: "artifact", provider: "paperclip", metadata: { attachmentId: "a1", contentPath: "/api/attachments/a1/content", byteSize: 80, ...metadata } }) as never;

  it("takes Markdown by type, or by name when the type is generic", () => {
    expect(isMarkdownContent({ contentType: "Text/Markdown; charset=utf-8" })).toBe(true);
    expect(isMarkdownContent({ contentType: "text/plain", originalFilename: "notes.MD" })).toBe(true);
    expect(isMarkdownContent({ contentType: "text/html", originalFilename: "notes.md" })).toBe(false);
    expect(markdownOutput(output({ contentType: "text/markdown" }))?.attachmentId).toBe("a1");
    expect(markdownOutput(output({ contentType: "image/png" }))).toBeNull();
    expect(markdownOutput({ type: "pull_request", provider: "github", metadata: null } as never)).toBeNull();
  });

  it("keys the review document by the output and says why one can't be made", () => {
    expect(reviewDocumentKey("wp1")).toBe("artifact-review-wp1");
    expect(isReviewDocumentKey("artifact-review-wp1")).toBe(true);
    expect(isReviewDocumentKey("artifact-review-")).toBe(false);
    const meta = markdownOutput(output({ contentType: "text/markdown" }))!;
    expect(reviewProblem(meta)).toBeNull();
    expect(reviewProblem({ ...meta, byteSize: 600 * 1024 })).toMatch(/Too large/);
    expect(reviewProblem(meta, 415)).toMatch(/can't be read/);
  });
});
