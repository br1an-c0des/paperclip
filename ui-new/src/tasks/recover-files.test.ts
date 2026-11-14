import type { IssueRecoveryAction } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { RecoveryActionsInspection } from "@/api/issues";
import {
  askRefusal,
  boundAction,
  fileRecoveryView,
  isRetainedExport,
  readSavedRequest,
  requestStorageKey,
  sandboxDiskFullRest,
  saveRequest,
  sourceVerified,
  unverifiedSourceText,
} from "./recover-files";
import { canConfirmServerStop, previousServerStop, recoveryCard, stopConfirmationBody } from "./recovery-actions";
import { randomId as newRequestId } from "@/lib/random-id";

function action(evidence: Record<string, unknown> = {}, patch: Partial<IssueRecoveryAction> = {}): IssueRecoveryAction {
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
    cause: "native_workspace_sync_out_retry_exhausted",
    fingerprint: "f",
    evidence: { runId: "run-1", workspaceRecovery: { schema: "paperclip.workspace-recovery.v1", runId: "run-1", status: "blocked", retryable: true }, ...evidence },
    nextAction: "Recover the files",
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

const inspection = (current: IssueRecoveryAction, status: "verified" | "blocked" = "verified"): RecoveryActionsInspection => ({
  active: current,
  actions: [current],
  sourceInspection: { schema: "paperclip.workspace-source-inspection.v1", actionId: current.id, runId: "run-1", observedAt: "", scope: "recorded_source_identity", status } as never,
});

const view = (current: IssueRecoveryAction | null, extra: Partial<Parameters<typeof fileRecoveryView>[0]> = {}) =>
  fileRecoveryView({ current, inspected: true, inspectionFailed: false, verified: true, pendingKey: null, acknowledged: false, checkedUnconfirmed: false, ...extra });

describe("Recover saved files", () => {
  it("applies to a native export hold on this task", () => {
    expect(isRetainedExport(action(), "t1", "c1")).toBe(true);
    expect(isRetainedExport(action({}, { cause: "native_workspace_sync_out_unrecoverable", ownerType: "system" }), "t1", "c1")).toBe(true);
    expect(isRetainedExport(action({}, { cause: "workspace_validation" }), "t1", "c1")).toBe(false);
    expect(isRetainedExport(action({}, { status: "resolved" }), "t1", "c1")).toBe(false);
    expect(isRetainedExport(action(), "t2", "c1")).toBe(false);
    expect(isRetainedExport(action({ runId: "" }), "t1", "c1")).toBe(false);
  });

  it("binds the action for the same run, and tells a verified source apart", () => {
    const current = action();
    expect(boundAction(inspection(current), current, "run-1", "t1", "c1")).toBe(current);
    expect(boundAction(inspection(current, "blocked"), current, "run-1", "t1", "c1")).toBe(current);
    expect(sourceVerified(inspection(current))).toBe(true);
    expect(sourceVerified(inspection(current, "blocked"))).toBe(false);
    expect(boundAction(inspection(current), current, "run-2", "t1", "c1")).toBeNull();
    expect(boundAction(undefined, current, "run-1", "t1", "c1")).toBeNull();
  });

  it("keeps Retry the way on when the source can't be verified, and says why (#19840)", () => {
    const blocked = { ...inspection(action(), "blocked").sourceInspection!, failureCode: "allocation_ownership_ambiguous" } as never;
    const text = unverifiedSourceText(blocked);
    expect(text).toBe("Paperclip can't confirm that this run alone used the sandbox that holds the saved files.");
    expect(unverifiedSourceText({ status: "not_inspected", reason: "source_limit" } as never)).toMatch(/too many sources/);
    expect(unverifiedSourceText({ status: "blocked", failureCode: "source_moved" } as never)).toBe("Paperclip can't verify the saved files' recorded source (source_moved).");
    const unverified = view(action(), { verified: false, unverifiedText: text });
    expect(unverified).toMatchObject({ offer: null, ownsRetry: false });
    expect(unverified.unverified).toMatch(/^Paperclip can't confirm .* Retry renews the recovery\.$/);
    // A verified source makes Recover saved files the way on; still inspecting counts as that.
    expect(view(action())).toMatchObject({ offer: "recover", ownsRetry: true, unverified: null });
    expect(view(action(), { inspected: false, verified: false })).toMatchObject({ ownsRetry: true });
    expect(view(null, { inspectionFailed: true, verified: false })).toMatchObject({ ownsRetry: false });
  });

  it("offers Recover saved files while the files wait, and nothing more once asked", () => {
    expect(view(action())).toMatchObject({ offer: "recover", check: false, alert: null, message: "The saved files need recovering before work can go on." });
    const queued = action({ workspaceRecovery: { schema: "paperclip.workspace-recovery.v1", runId: "run-1", status: "queued", retryable: true, requestIds: ["k1"] } });
    expect(view(queued, { pendingKey: "k1" })).toMatchObject({ offer: null, check: true, message: "Recovering saved files. Work stays paused until they're verified." });
  });

  it("asks for a check before resending an unconfirmed request, then resends the same key", () => {
    expect(view(action(), { pendingKey: "k1" })).toMatchObject({ offer: null, check: true });
    expect(view(action(), { pendingKey: "k1", checkedUnconfirmed: true })).toMatchObject({ offer: "recover" });
  });

  it("offers Try again only after a confirmed exhausted attempt (#19208)", () => {
    const exhausted = action({
      workspaceRecovery: { schema: "paperclip.workspace-recovery.v1", runId: "run-1", status: "blocked", retryable: true, requestIds: ["k1"] },
      systemRecovery: { state: "exhausted" },
    });
    expect(view(exhausted, { pendingKey: "k1" })).toMatchObject({ offer: "again", message: "File recovery hasn't finished. The saved files stay protected." });
    expect(askRefusal(exhausted, true, "k1")).toBeNull();
    expect(askRefusal(exhausted, true, "k2")).toMatch(/isn't confirmed/);
    expect(askRefusal(action({ workspaceRecovery: { status: "recovering" } }), false, null)).toMatch(/changed/);
  });

  it("says when the files were saved, and when the source changed", () => {
    const saved = action({
      workspaceRecovery: { schema: "paperclip.workspace-recovery.v1", runId: "run-1", status: "recovered", retryable: true },
      systemRecovery: { state: "complete", preservationOperationIds: ["op1"] },
    });
    expect(view(saved)).toMatchObject({ offer: null, message: "Saved files recovered. Task recovery is still being checked." });
    expect(view(null)).toMatchObject({ offer: null, check: true, alert: expect.stringMatching(/unavailable or have changed/) });
  });

  it("hands a save that rested on a full sandbox disk to Retry (U129, #20758, #20819)", () => {
    const failure = { code: "export_interrupted", retryClass: "user_action_required", cause: { label: "sandbox_disk_full", code: "ENOSPC", status: null } };
    const diskFull = action({ systemRecovery: { state: "exhausted", preservationOperationIds: [], failure } });
    expect(sandboxDiskFullRest(diskFull)).toBe(true);
    expect(sandboxDiskFullRest(action({ systemRecovery: { state: "exhausted", failure: { ...failure, retryClass: "transient" } } }))).toBe(false);
    expect(sandboxDiskFullRest(action({ systemRecovery: { state: "exhausted", failure: { ...failure, cause: { label: "other" } } } }))).toBe(false);
    expect(sandboxDiskFullRest(action({ systemRecovery: { state: "running", failure } }))).toBe(false);
    expect(sandboxDiskFullRest(null)).toBe(false);

    // Verified and retryable, which would offer Recover saved files: the disk-full rest offers Retry instead.
    expect(view(diskFull, { diskFull: true })).toEqual({
      message: "The sandbox disk was full when Paperclip saved the files. Free space, then use Retry to save them and finish the task.",
      offer: null,
      check: false,
      alert: null,
      unverified: null,
      ownsRetry: false,
    });
    // Before the inspection answers, too.
    expect(view(diskFull, { diskFull: true, inspected: false, verified: false })).toMatchObject({ offer: null, ownsRetry: false });
    // After a confirmed failed attempt: no Try file recovery again, no "needs service help".
    const tried = action({
      workspaceRecovery: { schema: "paperclip.workspace-recovery.v1", runId: "run-1", status: "blocked", retryable: true, requestIds: ["k1"] },
      systemRecovery: { state: "exhausted", failure },
    });
    expect(view(tried, { pendingKey: "k1", diskFull: true })).toMatchObject({ offer: null, alert: null, ownsRetry: false, message: expect.stringMatching(/^The sandbox disk was full/) });
    // A save running again (after Retry) says so.
    const saving = action({ workspaceRecovery: { schema: "paperclip.workspace-recovery.v1", runId: "run-1", status: "recovering", retryable: true }, systemRecovery: { state: "exhausted", failure } });
    expect(view(saving, { diskFull: true }).message).toBe("Recovering saved files. Work stays paused until they're verified.");
  });

  it("keeps one saved request per person, action and run", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    const key = requestStorageKey("c1", "t1", "ra1", "run-1", "u1");
    expect(readSavedRequest(storage, key, "ra1", "run-1")).toBeNull();
    expect(saveRequest(storage, key, { idempotencyKey: "k1", actionId: "ra1", runId: "run-1", createdAt: 5 })).toBe(true);
    expect(readSavedRequest(storage, key, "ra1", "run-1")).toEqual({ idempotencyKey: "k1", actionId: "ra1", runId: "run-1", createdAt: 5 });
    expect(readSavedRequest(storage, key, "ra1", "run-2")).toBeNull();
    expect(saveRequest(null, key, { idempotencyKey: "k1", actionId: "ra1", runId: "run-1", createdAt: 5 })).toBe(false);
    expect(newRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("recovery card causes", () => {
  it("names a remote restore failure with the run's step (#19207)", () => {
    const card = recoveryCard(
      action({ restoreFailure: "remote_workspace_restore_failed: sandbox_restore reason=occupied_root" }, { kind: "stranded_assigned_issue", cause: "remote_workspace_restore_failed" }),
      { board: true },
    )!;
    expect(card.kindLabel).toBe("Saved workspace couldn't be restored");
    expect(card.detail).toBe("remote_workspace_restore_failed: sandbox_restore reason=occupied_root");
    expect(card.nextAction).toBe("Recover the files");
  });

  it("says an export hold's files need recovering", () => {
    expect(recoveryCard(action(), { board: true })!.kindLabel).toBe("Saved files need recovering");
    expect(recoveryCard(action(), { board: true })!.detail).toBeNull();
  });

  it("offers no other choice while the previous server's stop needs confirming", () => {
    for (const cause of ["native_workspace_finalization_owner_unverified", "native_controller_host_unverified"]) {
      const card = recoveryCard(action({}, { cause, kind: "stranded_assigned_issue" }), { board: true })!;
      expect(card.kindLabel).toBe("Previous server not confirmed stopped");
      expect(card.outcomes).toEqual([]);
    }
  });

  it("names a pending provider tool call and doesn't offer Try again for it (#19733)", () => {
    const card = recoveryCard(action({}, { cause: "native_provider_side_effect_pending", kind: "stranded_assigned_issue" }), { board: true })!;
    expect(card.kindLabel).toBe("A tool call needs checking");
    expect(card.outcomes.map((option) => option.outcome)).not.toContain("todo");
    expect(card.outcomes.map((option) => option.outcome)).toContain("done");
  });
});

describe("Confirm the previous server stopped (#19717, #19742)", () => {
  const owner = { token: "11111111-1111-4111-8111-111111111111", host: "old" };

  it("asks for it on a board-owned unverified copy-back owner, until a stop is recorded or it resumes", () => {
    const pending = action({ owner }, { cause: "native_workspace_finalization_owner_unverified" });
    expect(previousServerStop(pending, "t1", "c1")).toEqual({ kind: "owner", runId: "run-1", ownerToken: owner.token });
    expect(previousServerStop(action({ owner, workspaceOwnerStop: { at: "x" } }, { cause: "native_workspace_finalization_owner_unverified" }), "t1", "c1")).toBeNull();
    expect(previousServerStop(action({ owner, workspaceOwnerRecovery: { state: "resuming" } }, { cause: "native_workspace_finalization_owner_unverified" }), "t1", "c1")).toBeNull();
    expect(previousServerStop(action({ owner }, { cause: "native_workspace_finalization_owner_unverified", ownerType: "agent" }), "t1", "c1")).toBeNull();
    expect(previousServerStop(action({}, { cause: "native_workspace_finalization_owner_unverified" }), "t1", "c1")).toBeNull();
    expect(previousServerStop(pending, "t2", "c1")).toBeNull();
    expect(previousServerStop(action({ owner }, { cause: "native_workspace_finalization_owner_unverified", status: "resolved" }), "t1", "c1")).toBeNull();
  });

  it("asks for it on retained saved-work recovery whose copy-back owner waits for an operator", () => {
    const hold = { state: "operator_required", owner };
    expect(previousServerStop(action({ workspaceOwnerRecovery: hold }), "t1", "c1")).toEqual({ kind: "owner", runId: "run-1", ownerToken: owner.token });
    expect(previousServerStop(action({ workspaceOwnerRecovery: hold }, { ownerType: "system" }), "t1", "c1")).not.toBeNull();
    expect(previousServerStop(action({ workspaceOwnerRecovery: { state: "resuming", owner } }), "t1", "c1")).toBeNull();
    expect(previousServerStop(action({ workspaceOwnerRecovery: hold, workspaceOwnerStop: {} }), "t1", "c1")).toBeNull();
    expect(previousServerStop(action(), "t1", "c1")).toBeNull();
  });

  it("asks for it on a controller recorded before its host, through its own request", () => {
    const controller = action({}, { cause: "native_controller_host_unverified" });
    expect(previousServerStop(controller, "t1", "c1")).toEqual({ kind: "controller", runId: "run-1" });
    expect(previousServerStop(action({ controllerStop: {} }, { cause: "native_controller_host_unverified" }), "t1", "c1")).toBeNull();
  });

  it("sends how it was checked, trimmed, only once it's long enough", () => {
    const stop = { kind: "owner", runId: "run-1", ownerToken: owner.token } as const;
    expect(stopConfirmationBody(stop, "ra1", "  too short  ")).toBeNull();
    expect(stopConfirmationBody(stop, "ra1", "  The old server process exited.  ")).toEqual({
      kind: "owner",
      body: { actionId: "ra1", runId: "run-1", ownerToken: owner.token, controllerAndCopybackStopped: true, stopEvidence: "The old server process exited." },
    });
    expect(stopConfirmationBody({ kind: "controller", runId: "run-1" }, "ra1", "The container was replaced for good.")).toEqual({
      kind: "controller",
      body: { actionId: "ra1", runId: "run-1", stopEvidence: "The container was replaced for good." },
    });
  });

  it("lets owners and admins confirm, as the server's runtime:confirm_owner_stop does", () => {
    const member = (membershipRole: string) => ({ source: "session", isInstanceAdmin: false, companyIds: ["c1"], memberships: [{ companyId: "c1", status: "active", membershipRole }] });
    expect(canConfirmServerStop("c1", null, true)).toBe(true);
    expect(canConfirmServerStop("c1", { source: "local_implicit", isInstanceAdmin: false, companyIds: [] }, false)).toBe(true);
    expect(canConfirmServerStop("c1", { source: "session", isInstanceAdmin: true, companyIds: [] }, false)).toBe(true);
    expect(canConfirmServerStop("c1", member("owner"), false)).toBe(true);
    expect(canConfirmServerStop("c1", member("admin"), false)).toBe(true);
    expect(canConfirmServerStop("c1", member("member"), false)).toBe(false);
    expect(canConfirmServerStop("c1", null, false)).toBe(false);
  });
});
