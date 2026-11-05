import { ApiError } from "@/api/client";

/*
 * The Studio's stale-write check (upstream #18334). Saves and deletes send the skill version the
 * edit started from as `expectedVersionId`; the server answers 409 when the skill has moved on
 * since (someone else saved, restored or deleted a file). The old Studio then keeps the edits and
 * offers to load the latest saved file; so does this one.
 */

export const CONFLICT_NOTICE =
  "This skill changed since you opened it. Your unsaved edits are still here. Copy them before loading the latest saved file to reconcile the changes.";

/** Whether a save or delete was refused because the skill changed since the edit started. */
export function isVersionConflict(error: unknown) {
  return error instanceof ApiError && error.status === 409;
}
