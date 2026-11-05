import type { IssueRecoveryAction } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { RecoveryActionsInspection } from "@/api/issues";
import { askRefusal, boundAction, fileRecoveryView, isRetainedExport, readSavedRequest, requestStorageKey, saveRequest } from "./recover-files";
import { recoveryCard } from "./recovery-actions";
import { newRequestId } from "./request-id";

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
  fileRecoveryView({ current, inspected: true, inspectionFailed: false, pendingKey: null, acknowledged: false, checkedUnconfirmed: false, ...extra });

describe("Recover saved files", () => {
  it("applies to a native export hold on this task", () => {
    expect(isRetainedExport(action(), "t1", "c1")).toBe(true);
    expect(isRetainedExport(action({}, { cause: "native_workspace_sync_out_unrecoverable", ownerType: "system" }), "t1", "c1")).toBe(true);
    expect(isRetainedExport(action({}, { cause: "workspace_validation" }), "t1", "c1")).toBe(false);
    expect(isRetainedExport(action({}, { status: "resolved" }), "t1", "c1")).toBe(false);
    expect(isRetainedExport(action(), "t2", "c1")).toBe(false);
    expect(isRetainedExport(action({ runId: "" }), "t1", "c1")).toBe(false);
  });

  it("binds only a verified source for the same run", () => {
    const current = action();
    expect(boundAction(inspection(current), current, "run-1", "t1", "c1")).toBe(current);
    expect(boundAction(inspection(current, "blocked"), current, "run-1", "t1", "c1")).toBeNull();
    expect(boundAction(inspection(current), current, "run-2", "t1", "c1")).toBeNull();
    expect(boundAction(undefined, current, "run-1", "t1", "c1")).toBeNull();
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
});
