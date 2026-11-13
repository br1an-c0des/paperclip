import type { IssueRecoveryAction } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  canConfirmServerStop,
  containmentBody,
  containmentFormKey,
  controllerContainment,
  followUpLine,
  isContainmentHold,
  OWNER_GONE_RESOURCE,
  ownerGoneHeadline,
  ownerGoneResource,
  previousServerStop,
  recoveryCard,
  stopConfirmationBody,
  stopFormKey,
} from "./recovery-actions";

/*
 * Confirm an unrecorded owner stopped (since the 2026-11-09 sync, upstream #20067, #20084): the
 * `ownership_owner_unprovable` cause, its eight kinds of record, the body sent to
 * `confirm-owner-gone`, the form's key and who may confirm.
 */

const VERSION = "2026-11-09T10:15:00.000Z";

function unprovable(evidence: Record<string, unknown> = {}, patch: Partial<IssueRecoveryAction> = {}): IssueRecoveryAction {
  return {
    id: "ra1",
    companyId: "c1",
    sourceIssueId: "t1",
    recoveryIssueId: null,
    kind: "active_run_watchdog",
    status: "active",
    ownerType: "board",
    ownerAgentId: null,
    ownerUserId: null,
    previousOwnerAgentId: null,
    returnOwnerAgentId: null,
    cause: "ownership_owner_unprovable",
    fingerprint: "ownership-owner:environment_run_lease_active:rec-1",
    evidence: { kind: "environment_run_lease_active", recordId: "rec-1", runId: null, proof: "no_owner_stamp", recordUpdatedAt: VERSION, ...evidence },
    nextAction: "A resource from this task's earlier run was recorded before Paperclip stored which server held it…",
    wakePolicy: null,
    monitorPolicy: null,
    attemptCount: 1,
    maxAttempts: null,
    timeoutAt: null,
    lastAttemptAt: null,
    outcome: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  } as IssueRecoveryAction;
}

describe("confirm an unrecorded owner stopped", () => {
  it("asks for the record and the version the board is shown, with no run needed", () => {
    expect(previousServerStop(unprovable(), "t1", "c1")).toEqual({
      kind: "owner-gone",
      recordId: "rec-1",
      recordVersion: VERSION,
      resource: OWNER_GONE_RESOURCE.environment_run_lease_active,
    });
    expect(previousServerStop(unprovable({ recordUpdatedAt: null }), "t1", "c1")).toMatchObject({ kind: "owner-gone", recordVersion: null });
  });

  it("asks nothing once confirmed, closed, elsewhere, or not the board's", () => {
    expect(previousServerStop(unprovable({ ownerGone: { actorId: "u1" } }), "t1", "c1")).toBeNull();
    expect(previousServerStop(unprovable({ recordId: undefined }), "t1", "c1")).toBeNull();
    expect(previousServerStop(unprovable({}, { status: "resolved" }), "t1", "c1")).toBeNull();
    expect(previousServerStop(unprovable({}, { ownerType: "agent" }), "t1", "c1")).toBeNull();
    expect(previousServerStop(unprovable(), "t2", "c1")).toBeNull();
    expect(previousServerStop(unprovable(), "t1", "c2")).toBeNull();
    expect(previousServerStop(unprovable({}, { status: "escalated" }), "t1", "c1")).not.toBeNull();
  });

  it("sends the record, how it was checked, and the version shown", () => {
    const stop = previousServerStop(unprovable(), "t1", "c1")!;
    expect(stopConfirmationBody(stop, "ra1", "too short")).toBeNull();
    expect(stopConfirmationBody(stop, "ra1", "  The old server container was replaced.  ")).toEqual({
      kind: "owner-gone",
      body: { actionId: "ra1", recordId: "rec-1", stopEvidence: "The old server container was replaced.", recordVersion: VERSION },
    });
    // A request that names no version sends none.
    const unversioned = previousServerStop(unprovable({ recordUpdatedAt: null }), "t1", "c1")!;
    expect(stopConfirmationBody(unversioned, "ra1", "The old server container was replaced.")!.body).not.toHaveProperty("recordVersion");
  });

  it("starts a fresh form when the record's version changes", () => {
    const first = stopFormKey("ra1", previousServerStop(unprovable(), "t1", "c1")!);
    const same = stopFormKey("ra1", previousServerStop(unprovable(), "t1", "c1")!);
    const refreshed = stopFormKey("ra1", previousServerStop(unprovable({ recordUpdatedAt: "2026-11-09T10:20:00.000Z" }), "t1", "c1")!);
    const otherRecord = stopFormKey("ra1", previousServerStop(unprovable({ recordId: "rec-2" }), "t1", "c1")!);
    expect(same).toBe(first);
    expect(refreshed).not.toBe(first);
    expect(otherRecord).not.toBe(first);
    expect(stopFormKey("ra1", { kind: "owner", runId: "run-1", ownerToken: "tok" })).toBe("ra1:run-1:tok");
    expect(stopFormKey("ra1", { kind: "controller", runId: "run-1" })).toBe("ra1:run-1:controller");
  });

  it("gives each kind of record its own words, and general ones for a kind it doesn't know", () => {
    expect(Object.keys(OWNER_GONE_RESOURCE)).toHaveLength(8);
    expect(ownerGoneResource("environment_run_lease_active")).toEqual({ what: "A sandbox lease from this task's earlier run", releasing: "Releasing the sandbox lease…" });
    expect(ownerGoneResource("legacy_controller_lease")).toEqual({ what: "This task's earlier run", releasing: "Recovering the run…" });
    expect(ownerGoneResource("environment_teardown_claim").releasing).toBe("Resuming the sandbox cleanup…");
    expect(ownerGoneResource("sandbox_creation_intent").releasing).toBe("Reconciling the sandbox…");
    expect(ownerGoneResource("workspace_runtime_control_operation").releasing).toBe("Releasing the workspace…");
    expect(ownerGoneResource("native_workspace_finalize_attempt").releasing).toBe("Releasing the workspace save…");
    expect(ownerGoneResource("native_finalizer_lease").releasing).toBe("Resuming the result handling…");
    expect(ownerGoneResource("native_cleanup_lease").releasing).toBe("Resuming the cleanup…");
    expect(ownerGoneResource("something_new")).toEqual({ what: "A resource from this task's earlier run", releasing: "Releasing the resource…" });
    expect(ownerGoneResource(undefined).what).toBe("A resource from this task's earlier run");
    // Inherited object keys aren't kinds.
    expect(ownerGoneResource("toString").what).toBe("A resource from this task's earlier run");
    expect(ownerGoneHeadline("native_cleanup_lease")).toBe(
      "The cleanup of this task's earlier run was recorded before Paperclip stored which server held it, so Paperclip can't verify that the server stopped. It stays reserved until then.",
    );
  });

  it("offers the card's generic ways out for none of it, and words it by kind", () => {
    const card = recoveryCard(unprovable({ kind: "sandbox_creation_intent" }), { board: true })!;
    expect(card.state).toBe("needed");
    expect(card.outcomes).toEqual([]);
    expect(card.kindLabel).toBe("Previous server not confirmed stopped");
    expect(card.headline).toBe(ownerGoneHeadline("sandbox_creation_intent"));
    // The server's next step repeats the headline and the form.
    expect(card.nextAction).toBeNull();
  });

  it("lets only owners and admins confirm (runtime:confirm_owner_stop)", () => {
    const member = (membershipRole: string) => ({ source: "session", isInstanceAdmin: false, companyIds: ["c1"], memberships: [{ companyId: "c1", status: "active", membershipRole }] });
    expect(canConfirmServerStop("c1", member("owner"), false)).toBe(true);
    expect(canConfirmServerStop("c1", member("admin"), false)).toBe(true);
    expect(canConfirmServerStop("c1", member("member"), false)).toBe(false);
    expect(canConfirmServerStop("c1", member("viewer"), false)).toBe(false);
  });
});

/*
 * Since the 2026-11-10 sync: a run that never recorded its process (#20310), and original-host
 * containment (#19813).
 */

describe("confirm a run that never recorded its process stopped (#20310)", () => {
  it("sends only the run and the evidence, once there's enough of it", () => {
    const stop = { kind: "run", runId: "run-9" } as const;
    expect(stopConfirmationBody(stop, "", "checked")).toBeNull();
    expect(stopConfirmationBody(stop, "", "  No codex process for this task is running on the host.  ")).toEqual({
      kind: "run",
      body: { runId: "run-9", stopEvidence: "No codex process for this task is running on the host." },
    });
  });

  it("keys its form by task and run", () => {
    expect(stopFormKey("t1", { kind: "run", runId: "run-9" })).toBe("t1:run-9:run");
    expect(stopFormKey("t1", { kind: "run", runId: "run-10" })).not.toBe(stopFormKey("t1", { kind: "run", runId: "run-9" }));
  });
});

describe("original-host containment (#19813)", () => {
  const DIGEST = "a".repeat(64);
  const RUN = "00000000-0000-4000-8000-000000000041";
  const hold = (evidence: Record<string, unknown> = {}, patch: Partial<IssueRecoveryAction> = {}) =>
    unprovable(
      {},
      {
        cause: "native_restart_recovery_blocked",
        evidence: { runId: RUN, reason: "controller_process_space_unverified", controllerAuthority: { schema: "paperclip.native-controller-authority.v1", digest: DIGEST }, ...evidence },
        nextAction: "Verify the original execution stopped.",
        ...patch,
      },
    );
  const draft = { controllerStopped: true, providerStopped: true, actionOutcome: "mixed" as const, evidence: "Verified both stopped; reviewed every action." };

  it("offers no other way out of the hold, which the server refuses", () => {
    const card = recoveryCard(hold(), { board: true });
    expect(card?.outcomes).toEqual([]);
    expect(card?.kindLabel).toBe("Original execution not confirmed stopped");
    // The same cause for another reason keeps the card's usual choices (no Try again: it reconciles).
    const other = recoveryCard(hold({ reason: "some_other_hold" }), { board: true });
    expect(other?.outcomes.map((option) => option.outcome)).toEqual(["done", "in_review", "false_positive_done", "false_positive_in_review"]);
    expect(other?.kindLabel).toBe("Silent run");
  });

  it("is offered on the board's hold for this task with a well-formed digest", () => {
    expect(isContainmentHold(hold())).toBe(true);
    expect(controllerContainment(hold(), "t1", "c1")).toEqual({ runId: RUN, digest: DIGEST });
    expect(controllerContainment(hold(), "t2", "c1")).toBeNull();
    expect(controllerContainment(hold({ reason: "remote_controller_process_space_unverified" }), "t1", "c1")).toBeNull();
    expect(controllerContainment(hold({ controllerAuthority: { digest: "not-a-digest" } }), "t1", "c1")).toBeNull();
    expect(controllerContainment(hold({}, { ownerType: "agent" }), "t1", "c1")).toBeNull();
    expect(controllerContainment(hold({}, { status: "resolved" }), "t1", "c1")).toBeNull();
  });

  it("sends both stops, the reviewed outcome and the evidence, with the task's own status", () => {
    const containment = controllerContainment(hold(), "t1", "c1")!;
    expect(containmentBody(containment, "ra1", "in_progress", draft)).toEqual({
      actionId: "ra1",
      outcome: "restored",
      sourceIssueStatus: "in_progress",
      executionReconciliation: {
        runId: RUN,
        controllerStopped: true,
        providerStopped: true,
        controllerAuthorityDigest: DIGEST,
        actionOutcome: "mixed",
        outcomeEvidence: "Verified both stopped; reviewed every action.",
      },
    });
  });

  it("waits for both confirmations, an outcome and 20 characters of evidence", () => {
    const containment = controllerContainment(hold(), "t1", "c1")!;
    expect(containmentBody(containment, "ra1", "todo", { ...draft, controllerStopped: false })).toBeNull();
    expect(containmentBody(containment, "ra1", "todo", { ...draft, providerStopped: false })).toBeNull();
    expect(containmentBody(containment, "ra1", "todo", { ...draft, actionOutcome: "" })).toBeNull();
    expect(containmentBody(containment, "ra1", "todo", { ...draft, evidence: "   too short    " })).toBeNull();
  });

  it("starts a fresh form for a new authority snapshot", () => {
    expect(containmentFormKey("ra1", { runId: RUN, digest: DIGEST })).not.toBe(containmentFormKey("ra1", { runId: RUN, digest: "b".repeat(64) }));
  });
});

describe("what follows a recovery, in plainer words (#21348)", () => {
  it("says it from the wake policy, as the old card's Follow-up row does", () => {
    expect(followUpLine({ wakePolicy: { type: "bounded_recovery_owner" } })).toBe("An agent is choosing the next step");
    expect(followUpLine({ wakePolicy: { type: "board_escalation" } })).toBe("Waiting for you");
    expect(followUpLine({ wakePolicy: { type: "manual_repair_required" } })).toBe("Needs a fix before Retry");
    expect(followUpLine({ wakePolicy: { type: "wake_owner" } })).toBe("An agent will be asked to choose the next step");
    expect(followUpLine({ wakePolicy: { type: "monitor", intervalLabel: "every 5m" } })).toBe("Check scheduled · every 5m");
    expect(followUpLine({ wakePolicy: { type: "some_new_policy" } })).toBe("Some new policy");
    expect(followUpLine({ wakePolicy: null })).toBeNull();
    expect(followUpLine(null)).toBeNull();
  });

  it("puts it on the card", () => {
    const card = recoveryCard(unprovable({}, { wakePolicy: { type: "board_escalation" } }), { board: true });
    expect(card?.followUp).toBe("Waiting for you");
  });
});
