import type { CompactIssue, TaskInterruptionPresentation } from "@paperclipai/shared";
import { useQueryClient } from "@tanstack/solid-query";
import { RotateCcw } from "lucide-solid";
import { createSignal, Show } from "solid-js";
import { ApiError } from "@/api/client";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/api/queryKeys";
import { useCompany } from "@/lib/company";
import { Capsule, TonePill } from "@/ui/Status";
import { pushToast } from "@/ui/Toast";
import "./retry.css";

/*
 * Retry on interrupted tasks, on list rows and board cards. The server describes an interruption
 * as the task's `interruption` (TaskInterruptionPresentation). As in the old UI, rows mark the ones
 * the system is responsible for (ui/src/components/IssueRow.tsx), and Retry is offered where the
 * task's own notice offers it (ui/src/components/ExecutionBlockerNotice.tsx): an attempt that failed
 * or is waiting to try again, when the server says it can be retried. Interruptions waiting on you
 * (an approval, a reconnect, project access) are left to the task panel.
 *
 * A retry is one `POST /issues/:id/retry` with an idempotency key, kept while the request might
 * still land so a resend doesn't start a second attempt (ui/src/hooks/useTaskRetry.ts). The answer
 * carries the task's new interruption, which goes straight into the cached lists; then they're
 * fetched again.
 */

export type RetryOffer = { state: "failed" | "retry_scheduled"; canRetry: boolean };

/** What a row shows for the task's interruption, or null for none worth showing. */
export function retryOffer(task: Pick<CompactIssue, "interruption">): RetryOffer | null {
  const interruption = task.interruption;
  if (!interruption || interruption.responsibility !== "system") return null;
  if (interruption.state !== "failed" && interruption.state !== "retry_scheduled") return null;
  return { state: interruption.state, canRetry: interruption.canRetry };
}

type Retryable = Pick<CompactIssue, "id" | "identifier" | "title" | "interruption">;

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
    const slot = `${task.id}:${observedRunId ?? ""}`;
    const idempotencyKey = keys.get(slot) ?? crypto.randomUUID();
    keys.set(slot, idempotencyKey);
    mark(task.id, true);
    const ref = task.identifier ?? task.title;
    try {
      const receipt = await issuesApi.retry(task.id, { idempotencyKey, observedRunId });
      keys.delete(slot);
      setInterruption(task.id, receipt.presentation);
      if (receipt.stale) pushToast({ tone: "info", title: `${ref} has moved on`, body: "Its latest run changed since this was shown." });
      else pushToast({ tone: "success", title: `Trying ${ref} again` });
    } catch (error) {
      // A refusal won't change on a resend; anything else might still land, so keep the key.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) keys.delete(slot);
      pushToast({ tone: "error", title: `Couldn't retry ${ref}`, body: error instanceof Error ? error.message : String(error) });
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
 * Retry beside it when the server allows one.
 */
export function RetryMark(props: { task: Retryable; retry: TaskRetry }) {
  const offer = () => retryOffer(props.task);
  return (
    <Show when={offer()}>
      {(found) => (
        <span class="retry-mark">
          <TonePill
            tone={found().state === "failed" ? "red" : "amber"}
            compact
            icon={<Capsule gradient={found().state === "failed" ? "flare" : "ember"} size="tiny" />}
          >
            {found().state === "failed" ? "Interrupted" : "Trying again soon"}
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
