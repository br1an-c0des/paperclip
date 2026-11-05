import type { ExecutionProjection } from "@paperclipai/shared";
import { accessApi } from "@/api/access";
import { ApiError } from "@/api/client";
import { heartbeatsApi } from "@/api/heartbeats";
import { newRequestId } from "./request-id";

/*
 * Stop in task run control (`tasks/run-control`), since the 2026-11-05 sync:
 *
 * - A failed native run can still own a retry it will start by itself. The server says so with
 *   `execution.canStop` (upstream #18899), and Stop is offered for it too. That Stop is correlated:
 *   a `cancellationRequestId` the UI makes and saves (sessionStorage, per company, run and person)
 *   before sending, so a lost answer or a reload sends the same one again, after the old UI's
 *   lib/native-run-stop.ts. The run is read first: an id the server already recorded for this
 *   person is the one to send; one recorded for someone else stops it. Nothing is resent by itself.
 * - A native run whose session is still starting answers 409 `native_stop_pending` (#19189): the
 *   Stop is recorded and the run settles as cancelled when the session opens. That's not a failure.
 * - Labels follow the old UI: Stop for a running run or a failed retry, Cancel for one that hasn't
 *   started (queued or waiting to retry).
 */

const ACTIVE = new Set(["queued", "running", "scheduled_retry"]);
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

type StoppableRun = { status: string; execution?: Pick<ExecutionProjection, "canStop"> | null };

/** Whether a run offers Stop: going, or failed with a retry the server says Stop can still cancel. */
export function canStopRun(run: StoppableRun) {
  return ACTIVE.has(run.status) || isFailedRetryStop(run);
}

/** A failed native run that still owns its retry. */
export function isFailedRetryStop(run: StoppableRun) {
  return run.status === "failed" && run.execution?.canStop === true;
}

/** "Stop" or "Cancel", and their -ing forms while the request is out. */
export function stopLabel(status: string, pending: boolean) {
  if (status === "queued" || status === "scheduled_retry") return pending ? "Cancelling…" : "Cancel";
  return pending ? "Stopping…" : "Stop";
}

/** The 409 a Stop gets while the native session is still starting: recorded, settling later. */
export function isNativeStopPending(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  const body = error.body as { code?: unknown; details?: { code?: unknown } } | null;
  return body?.code === "native_stop_pending" || body?.details?.code === "native_stop_pending";
}

export type StopResult = "stopped" | "pending";

type Stored = { requestId: string; runId: string; companyId: string; userId: string };

export function stopStorageKey(companyId: string, runId: string, userId: string) {
  return `ui-new:native-run-stop:${companyId}:${runId}:${userId}`;
}

function session(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

// When sessionStorage refuses, the id is kept for this page's life.
const memory = new Map<string, string>();

/**
 * The id to send for a correlated Stop: the one the server recorded for this person, else the one
 * saved before, else a new one. Throws when the server's recorded one is someone else's.
 */
export function stopRequestId(input: {
  startupCancellation: unknown;
  saved: string | null;
  userId: string;
  make?: () => string;
}): string {
  const startup = input.startupCancellation && typeof input.startupCancellation === "object" ? (input.startupCancellation as Record<string, unknown>) : {};
  const recorded = startup.cancellationRequestId;
  if (recorded !== undefined) {
    const by = (startup.requestedBy ?? {}) as Record<string, unknown>;
    if (by.type !== "board" || by.userId !== input.userId) throw new Error("This Stop was asked by someone else.");
    if (typeof recorded !== "string" || !UUID.test(recorded)) throw new Error("Stop wasn't accepted because the run changed.");
    return recorded;
  }
  if (input.saved && UUID.test(input.saved)) return input.saved;
  return (input.make ?? newRequestId)();
}

function readStored(key: string, check: Omit<Stored, "requestId">): string | null {
  try {
    const value = JSON.parse(session()?.getItem(key) ?? "null") as Partial<Stored> | null;
    if (value && value.runId === check.runId && value.companyId === check.companyId && value.userId === check.userId && typeof value.requestId === "string") {
      return value.requestId;
    }
  } catch {
    // Unreadable: fall back to memory.
  }
  return memory.get(key) ?? null;
}

function writeStored(key: string, stored: Stored) {
  memory.set(key, stored.requestId);
  try {
    session()?.setItem(key, JSON.stringify(stored));
  } catch {
    // Memory still holds it.
  }
}

function clearStored(key: string, requestId: string) {
  if (memory.get(key) === requestId) memory.delete(key);
  try {
    session()?.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

/** Stops a failed native retry with a saved, correlated id. */
async function stopFailedRetry(runId: string, companyId: string): Promise<StopResult> {
  const [run, access] = await Promise.all([heartbeatsApi.get(runId), accessApi.currentBoardAccess()]);
  if (run.id !== runId || run.companyId !== companyId) throw new Error("Stop wasn't accepted because the run changed.");
  const userId = access.userId;
  if (!userId) throw new Error("Stop wasn't accepted because your session changed.");
  const key = stopStorageKey(companyId, runId, userId);
  const scope = { runId, companyId, userId };
  const requestId = stopRequestId({ startupCancellation: run.resultJson?.startupCancellation, saved: readStored(key, scope), userId });
  writeStored(key, { ...scope, requestId });
  try {
    const stopped = await heartbeatsApi.cancel(runId, { cancellationRequestId: requestId });
    clearStored(key, requestId);
    return stopped?.status === "cancelled" ? "stopped" : "pending";
  } catch (error) {
    // A refusal is final; anything else may still have landed, so the id is kept for the next click.
    if (error instanceof ApiError && error.status >= 400 && error.status < 500 && !isNativeStopPending(error)) clearStored(key, requestId);
    if (isNativeStopPending(error)) return "pending";
    throw error;
  }
}

/**
 * Stops a run from task run control. "pending" means the Stop is recorded and the run settles as
 * cancelled by itself (a native session still starting, or a failed retry's intent not yet sent).
 */
export async function stopRun(run: { runId: string; status: string; execution?: Pick<ExecutionProjection, "canStop"> | null }, companyId: string): Promise<StopResult> {
  if (isFailedRetryStop(run)) return stopFailedRetry(run.runId, companyId);
  try {
    await heartbeatsApi.cancel(run.runId);
    return "stopped";
  } catch (error) {
    if (isNativeStopPending(error)) return "pending";
    throw error;
  }
}
