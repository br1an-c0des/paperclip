import type { CompactIssue, TaskInterruptionPresentation } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { RotateCcw } from "lucide-solid";
import { createSignal, onCleanup, Show } from "solid-js";
import { ApiError } from "@/api/client";
import { issuesApi, type TaskRetryReceipt } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Capsule, TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import { providerFailureOf, providerFailureTitle } from "@/ui/provider-failure";
import { pendingResume, timeOfDay } from "./recovery";
import "./retry.css";

/*
 * Retry on interrupted tasks, on list rows and board cards. The server describes an interruption
 * as the task's `interruption` (TaskInterruptionPresentation). As in the old UI, rows mark the ones
 * the system is responsible for (ui/src/components/IssueRow.tsx), and Retry is offered where the
 * task's own notice offers it (ui/src/components/ExecutionBlockerNotice.tsx): an attempt that failed
 * or is waiting to try again, when the server says it can be retried. Interruptions waiting on you
 * (an approval, a reconnect, project access) are left to the task panel. What stopped it (a
 * provider's refusal, or folders that couldn't be prepared, since the 2026-11-03 sync) is the pill's
 * tooltip; the panel's notice has the whole of it.
 *
 * A retry is one `POST /issues/:id/retry` with an idempotency key, kept while the request might
 * still land so a resend doesn't start a second attempt (ui/src/hooks/useTaskRetry.ts). The answer
 * carries the task's new interruption, which goes straight into the cached lists; then they're
 * fetched again. Since the 2026-11-10 sync (#20283) the answer also says what became of a scheduled
 * retry (`scheduledRetry`): the toast says "Trying TES-4 again" only when work started, and
 * otherwise gives the server's reason, wherever this hook is used (the task's notices, list rows,
 * and each stalled dependency's Retry).
 *
 * Since the 2026-11-13 sync (#21373, #21385): while a recorded continuation has waited 15 minutes to
 * start, the task reads as working and offers Move it forward now (`retryAction: "move_forward"`).
 * The same request carries `retryAction`, so it moves that continuation to the front of the agent's
 * queue and never starts a second run; the answer says `alreadyMovedOn` when the task had already
 * moved on. Rows don't offer it (as the old UI's Inbox rows don't): it's on the task's notices.
 *
 * Since the 2026-11-14 sync (#21497): the server waits up to 5 s for admission before it answers. A
 * refusal another click can't change answers `accepted: false` with `refused: { reason, message }`,
 * and the toast says "TES-4 hasn't started" with that message instead of calling it replaced.
 */

export type RetryOffer = {
  state: "failed" | "retry_scheduled";
  canRetry: boolean;
  reason: string | null;
  /** When a pending native resume (`pendingResume`, recovery.ts) is due; null for anything else. */
  resumesAt: string | null;
};

/**
 * What stopped an interrupted task, in a line for a row's tooltip: the provider's refusal, or the
 * task's folders that couldn't be prepared (`workspaceFailure`, upstream #18770). Null for neither.
 */
export function interruptionReason(
  interruption:
    | {
        providerFailure?: unknown;
        workspaceFailure?: { message: string } | null;
        setupFailure?: { message: string } | null;
        retryWait?: { message: string } | null;
      }
    | null
    | undefined,
) {
  // An accepted Retry that still waits says why, over what stopped the attempt (#18845).
  if (interruption?.retryWait?.message) return interruption.retryWait.message;
  const failure = providerFailureOf(interruption?.providerFailure);
  if (failure) return providerFailureTitle(failure);
  const workspace = interruption?.workspaceFailure?.message;
  if (workspace) return `Couldn't prepare the task folders: ${workspace}`;
  // A setup command that exited non-zero (#20478): its message names the command.
  const setup = interruption?.setupFailure?.message;
  return setup ? `Couldn't set up the task workspace: ${setup}` : null;
}

/** What a row shows for the task's interruption, or null for none worth showing. */
export function retryOffer(task: Pick<CompactIssue, "interruption">): RetryOffer | null {
  const interruption = task.interruption;
  if (!interruption || interruption.responsibility !== "system") return null;
  if (interruption.state !== "failed" && interruption.state !== "retry_scheduled") return null;
  return {
    state: interruption.state,
    canRetry: interruption.canRetry,
    reason: interruptionReason(interruption),
    resumesAt: pendingResume(interruption) ? interruption.nextRetryAt : null,
  };
}

/** The pill's words: "Interrupted", "Resuming soon" for a pending native resume, or "Trying again soon". */
export function retryPillLabel(offer: RetryOffer) {
  if (offer.state === "failed") return "Interrupted";
  return offer.resumesAt ? "Resuming soon" : "Trying again soon";
}

/** The pill's tooltip: what stopped it, or when a pending resume is due. */
export function retryPillTitle(offer: RetryOffer) {
  if (offer.reason) return offer.reason;
  return offer.resumesAt ? `The last attempt stopped, and Paperclip resumes it by itself at ${timeOfDay(offer.resumesAt)}.` : undefined;
}

type Retryable = Pick<CompactIssue, "id" | "identifier" | "title" | "interruption">;

/** Upstream's words for a Retry on an attempt that was replaced meanwhile (#20283). */
export const STALE_RETRY_MESSAGE = "This attempt was already replaced, so Retry did not start new work. The task now shows its current state.";

/** Upstream's words for a Move it forward now that found the task already moved on (#21373). */
export const ALREADY_MOVED_ON_MESSAGE = "The task already moved on, so nothing new was started. It now shows its current state.";

/** The waiting continuation's line and button, in the old UI's words (ExecutionBlockerNotice, #21373). */
export const MOVE_FORWARD_TITLE = "Waiting for the agent to finish other work";
export const MOVE_FORWARD_TEXT = "Paperclip continues this task by itself.";
export const MOVE_FORWARD_LABEL = "Move it forward now";

/**
 * Whether the interruption offers Move it forward now (#21373, #21385): a continuation Paperclip
 * recorded that has waited 15 minutes to start. The task is working, not failed, and the click
 * joins that continuation instead of starting a second run.
 */
export function offersMoveForward(interruption: Pick<TaskInterruptionPresentation, "state" | "canRetry" | "retryAction"> | null | undefined) {
  return interruption?.state === "working" && interruption.retryAction === "move_forward" && interruption.canRetry;
}

/**
 * What a Retry receipt came to (#20283, the old UI's `taskRetryNotStartedReason`): it started work,
 * or it didn't and the reason says why. A receipt that wasn't accepted means the attempt was
 * replaced; an accepted one whose scheduled retry wasn't promoted (held by a gate, still waiting,
 * or none left to promote) carries the server's message.
 */
export function retryReceiptOutcome(
  receipt: Pick<TaskRetryReceipt, "accepted" | "stale" | "scheduledRetry" | "alreadyMovedOn" | "refused">,
): { started: true } | { started: false; stale: boolean; reason: string } {
  // Admission refused it for a reason another click can't change (#21497): the request stays saved
  // and starts by itself if the reason clears; the server's message says why.
  if (!receipt.accepted && receipt.refused?.message) return { started: false, stale: false, reason: receipt.refused.message };
  // A Move it forward now whose continuation already started or was given up (#21373).
  if (!receipt.accepted && receipt.alreadyMovedOn) return { started: false, stale: true, reason: ALREADY_MOVED_ON_MESSAGE };
  if (!receipt.accepted || receipt.stale) return { started: false, stale: true, reason: STALE_RETRY_MESSAGE };
  const scheduled = receipt.scheduledRetry;
  if (scheduled && scheduled.outcome !== "promoted" && scheduled.outcome !== "already_promoted") {
    return { started: false, stale: false, reason: scheduled.message || "Retry didn't start new work." };
  }
  return { started: true };
}

/**
 * What `POST /issues/:id/retry` sends for a task: the key, the run the viewer saw, and for a
 * waiting continuation `retryAction: "move_forward"` (#21373), as the old UI's useTaskRetry does.
 */
export function retryRequest(task: Pick<CompactIssue, "interruption">, idempotencyKey: string) {
  const interruption = task.interruption;
  return {
    idempotencyKey,
    observedRunId: interruption?.observedRunId ?? null,
    ...(interruption?.retryAction === "move_forward" ? { retryAction: "move_forward" as const } : {}),
  };
}

/** When the task is read again after an accepted Retry: once the admission has run, and after its grace. */
export const RETRY_FOLLOW_UPS_MS = [1_000, 10_000];

export function useTaskRetry() {
  const client = useQueryClient();
  const company = useCompany();
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set());
  // One key per task and failed run, kept until the server has answered for it.
  const keys = new Map<string, string>();

  const setInterruption = (id: string, interruption: TaskInterruptionPresentation | null) => {
    const patch = (task: unknown) => (task && (task as { id?: string }).id === id ? { ...(task as object), interruption } : task);
    client.setQueriesData<unknown>({ queryKey: queryKeys.issues.list(company().id) }, (old: unknown) =>
      Array.isArray(old) ? old.map(patch) : old,
    );
    client.setQueryData<unknown>(queryKeys.issues.detail(id), (old: unknown) => patch(old));
  };
  const refresh = (id: string) => {
    void client.invalidateQueries({ queryKey: queryKeys.issues.list(company().id) });
    void client.invalidateQueries({ queryKey: queryKeys.issues.detail(id) });
  };
  const timers = new Set<number>();
  onCleanup(() => timers.forEach((timer) => window.clearTimeout(timer)));
  const followUp = (id: string) => {
    for (const delay of RETRY_FOLLOW_UPS_MS) {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        void client.invalidateQueries({ queryKey: queryKeys.issues.detail(id) });
      }, delay);
      timers.add(timer);
    }
  };
  const mark = (id: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const retry = async (task: Retryable) => {
    if (busy().has(task.id)) return;
    const observedRunId = task.interruption?.observedRunId ?? null;
    // Moving a waiting continuation forward says so, so the server joins it rather than retrying (#21373).
    const moveForward = task.interruption?.retryAction === "move_forward";
    const slot = `${task.id}:${observedRunId ?? ""}${moveForward ? ":move_forward" : ""}`;
    const idempotencyKey = keys.get(slot) ?? crypto.randomUUID();
    keys.set(slot, idempotencyKey);
    mark(task.id, true);
    const ref = task.identifier ?? task.title;
    try {
      const receipt = await issuesApi.retry(task.id, retryRequest(task, idempotencyKey));
      keys.delete(slot);
      setInterruption(task.id, receipt.presentation);
      // Say what actually happened (#20283): a Retry that didn't start work says why.
      const outcome = retryReceiptOutcome(receipt);
      if (outcome.started) pushToast({ tone: "success", title: moveForward ? `Moving ${ref} forward` : `Trying ${ref} again` });
      else if (outcome.stale) pushToast({ tone: "info", title: `${ref} has moved on`, body: outcome.reason });
      else pushToast({ tone: "info", title: `${ref} hasn't started`, body: outcome.reason });
      // The run is admitted after the receipt, so its wait (`retryWait`) shows up a moment later:
      // read the task again twice, as the old UI's useTaskRetry does, rather than poll.
      if (receipt.accepted && !receipt.stale) followUp(task.id);
    } catch (error) {
      // A refusal won't change on a resend; anything else might still land, so keep the key.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) keys.delete(slot);
      pushToast({ tone: "error", title: moveForward ? `Couldn't move ${ref} forward` : `Couldn't retry ${ref}`, body: error instanceof Error ? error.message : String(error) });
    } finally {
      mark(task.id, false);
      refresh(task.id);
    }
  };

  return { retry, busy: (id: string) => busy().has(id) };
}

export type TaskRetry = ReturnType<typeof useTaskRetry>;

/**
 * The interruption on a row or card: a red "Interrupted" or amber "Trying again soon" pill, and
 * Retry beside it when the server allows one. A pending native resume reads "Resuming soon", with
 * its time in the tooltip and no Retry, as the task's recovery notice does (#19503).
 */
export function RetryMark(props: { task: Retryable; retry: TaskRetry }) {
  const offer = () => retryOffer(props.task);
  return (
    <Show when={offer()}>
      {(found) => (
        <span class="retry-mark" title={retryPillTitle(found())}>
          <TonePill
            tone={found().state === "failed" ? "red" : "amber"}
            compact
            icon={<Capsule gradient={found().state === "failed" ? "flare" : "ember"} size="tiny" />}
          >
            {retryPillLabel(found())}
          </TonePill>
          <Show when={found().canRetry}>
            <button
              type="button"
              class="retry-button"
              disabled={props.retry.busy(props.task.id)}
              aria-label={`Retry ${props.task.identifier ?? props.task.title}`}
              onClick={(event) => {
                event.stopPropagation();
                void props.retry.retry(props.task);
              }}
            >
              <RotateCcw size={12} stroke-width={2.2} aria-hidden="true" />
              {props.retry.busy(props.task.id) ? "Retrying…" : "Retry"}
            </button>
          </Show>
        </span>
      )}
    </Show>
  );
}
