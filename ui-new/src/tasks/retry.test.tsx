import type { TaskInterruptionPresentation } from "@paperclipai/shared";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import {
  ALREADY_MOVED_ON_MESSAGE,
  interruptionReason,
  offersMoveForward,
  RetryMark,
  retryOffer,
  retryReceiptOutcome,
  retryRequest,
  STALE_RETRY_MESSAGE,
  type TaskRetry,
} from "./retry";

describe("Move it forward now (#21373, #21385)", () => {
  const waiting = (extra: Partial<TaskInterruptionPresentation> = {}): TaskInterruptionPresentation => ({
    intentId: null,
    responsibility: "system",
    state: "working",
    nextRetryAt: null,
    canRetry: true,
    retryAction: "move_forward",
    userAction: null,
    sourceRunIds: ["continuation"],
    observedRunId: "continuation",
    ...extra,
  });

  it("is offered only on a working task whose continuation the server lets you move forward", () => {
    expect(offersMoveForward(waiting())).toBe(true);
    expect(offersMoveForward(waiting({ canRetry: false }))).toBe(false);
    expect(offersMoveForward(waiting({ retryAction: undefined }))).toBe(false);
    expect(offersMoveForward(waiting({ state: "failed" }))).toBe(false);
    expect(offersMoveForward(null)).toBe(false);
  });

  it("sends the move-forward intent with the observed run, and nothing extra for an ordinary Retry", () => {
    expect(retryRequest({ interruption: waiting() }, "key-1")).toEqual({ idempotencyKey: "key-1", observedRunId: "continuation", retryAction: "move_forward" });
    expect(retryRequest({ interruption: waiting({ state: "failed", retryAction: undefined }) }, "key-2")).toEqual({
      idempotencyKey: "key-2",
      observedRunId: "continuation",
    });
    expect(retryRequest({ interruption: null }, "key-3")).toEqual({ idempotencyKey: "key-3", observedRunId: null });
  });

  it("says plainly when the task already moved on, so nothing new was started", () => {
    expect(retryReceiptOutcome({ accepted: false, stale: false, alreadyMovedOn: true })).toEqual({
      started: false,
      stale: true,
      reason: ALREADY_MOVED_ON_MESSAGE,
    });
    expect(ALREADY_MOVED_ON_MESSAGE).toContain("already moved on, so nothing new was started");
  });

  it("isn't a row's Retry: the list rows leave a working task alone", () => {
    expect(retryOffer({ interruption: waiting() })).toBeNull();
  });
});

describe("retryReceiptOutcome (#20283)", () => {
  const receipt = (extra: Partial<Parameters<typeof retryReceiptOutcome>[0]>) => ({ accepted: true, stale: false, ...extra });

  it("counts a Retry as started when nothing was scheduled, or the scheduled run was promoted", () => {
    expect(retryReceiptOutcome(receipt({}))).toEqual({ started: true });
    expect(retryReceiptOutcome(receipt({ scheduledRetry: { outcome: "promoted", message: "Retry promoted" } }))).toEqual({ started: true });
    expect(retryReceiptOutcome(receipt({ scheduledRetry: { outcome: "already_promoted", message: "Already promoted" } }))).toEqual({ started: true });
  });

  it("says why a Retry didn't start, in the server's words", () => {
    for (const outcome of ["gate_suppressed", "waiting", "no_scheduled_retry"] as const) {
      expect(retryReceiptOutcome(receipt({ scheduledRetry: { outcome, message: "The company budget is paused." } }))).toEqual({
        started: false,
        stale: false,
        reason: "The company budget is paused.",
      });
    }
  });

  it("calls a replaced attempt stale, in upstream's words", () => {
    expect(retryReceiptOutcome(receipt({ stale: true }))).toEqual({ started: false, stale: true, reason: STALE_RETRY_MESSAGE });
    expect(retryReceiptOutcome(receipt({ accepted: false }))).toEqual({ started: false, stale: true, reason: STALE_RETRY_MESSAGE });
  });
});

describe("interruptionReason", () => {
  it("names a failed setup command (#20478) after the folders' own failure", () => {
    const setupFailure = { message: 'The project\'s workspace provision command "pnpm i" failed with exit code 1' };
    expect(interruptionReason({ setupFailure })).toBe('Couldn\'t set up the task workspace: The project\'s workspace provision command "pnpm i" failed with exit code 1');
    expect(interruptionReason({ setupFailure, workspaceFailure: { message: "Disk full" } })).toBe("Couldn't prepare the task folders: Disk full");
  });
});

function interruption(extra: Partial<TaskInterruptionPresentation>): TaskInterruptionPresentation {
  return {
    intentId: null,
    responsibility: "system",
    state: "failed",
    nextRetryAt: null,
    canRetry: true,
    userAction: null,
    sourceRunIds: ["run-1"],
    observedRunId: "run-1",
    ...extra,
  };
}

describe("retryOffer", () => {
  it("offers Retry on an attempt the system couldn't finish", () => {
    expect(retryOffer({ interruption: interruption({}) })).toEqual({ state: "failed", canRetry: true, reason: null, resumesAt: null });
    expect(retryOffer({ interruption: interruption({ state: "retry_scheduled", canRetry: false }) })).toEqual({
      state: "retry_scheduled",
      canRetry: false,
      reason: null,
      resumesAt: null,
    });
  });

  it("tells a pending native resume (#19503) by the recovery notice's rule", () => {
    const at = "2026-11-06T15:26:18.687Z";
    expect(retryOffer({ interruption: interruption({ state: "retry_scheduled", canRetry: false, nextRetryAt: at }) })?.resumesAt).toBe(at);
    // A Retry to press, or a saved-work step, is something else.
    expect(retryOffer({ interruption: interruption({ state: "retry_scheduled", canRetry: true, nextRetryAt: at }) })?.resumesAt).toBeNull();
    expect(retryOffer({ interruption: interruption({ state: "retry_scheduled", canRetry: false, nextRetryAt: at, recoveryStep: "saving_previous_files" }) })?.resumesAt).toBeNull();
  });

  it("says what stopped it: a provider's refusal or folders that couldn't be prepared", () => {
    const providerFailure = {
      schema: "paperclip.provider-failure.v1",
      provider: "anthropic",
      phase: "turn",
      category: "rate_limit",
      message: "Too many requests",
      retryability: "transient",
    } as const;
    expect(retryOffer({ interruption: interruption({ providerFailure }) })?.reason).toBe("Claude: Rate limit reached");
    expect(retryOffer({ interruption: interruption({ workspaceFailure: { message: "Disk full" } }) })?.reason).toBe(
      "Couldn't prepare the task folders: Disk full",
    );
  });

  it("leaves out tasks with no interruption, one waiting on you, or one already moving", () => {
    expect(retryOffer({})).toBeNull();
    expect(retryOffer({ interruption: null })).toBeNull();
    expect(retryOffer({ interruption: interruption({ responsibility: "user", userAction: "approval" }) })).toBeNull();
    expect(retryOffer({ interruption: interruption({ state: "working" }) })).toBeNull();
    expect(retryOffer({ interruption: interruption({ state: "resolved" }) })).toBeNull();
  });
});

describe("RetryMark", () => {
  const task = (extra: Partial<TaskInterruptionPresentation>) => ({
    id: "task-1",
    identifier: "TES-4",
    title: "Fix the footer",
    interruption: interruption(extra),
  });

  it("shows the interruption and retries without opening the row", () => {
    const retry: TaskRetry = { retry: vi.fn(async () => undefined), busy: () => false };
    const opened = vi.fn();
    render(() => (
      <div onClick={opened}>
        <RetryMark task={task({})} retry={retry} />
      </div>
    ));
    expect(screen.getByText("Interrupted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry TES-4" }));
    expect(retry.retry).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1" }));
    expect(opened).not.toHaveBeenCalled();
  });

  it("leaves Retry out when the server doesn't allow one", () => {
    const retry: TaskRetry = { retry: vi.fn(async () => undefined), busy: () => false };
    const { container } = render(() => <RetryMark task={task({ state: "retry_scheduled", canRetry: false })} retry={retry} />);
    expect(container.textContent).toBe("Trying again soon");
    expect(container.querySelector("button")).toBeNull();
  });

  it("reads a pending native resume as resuming, with its time and no Retry", () => {
    const retry: TaskRetry = { retry: vi.fn(async () => undefined), busy: () => false };
    const at = new Date(2026, 10, 6, 15, 26).toISOString();
    const { container } = render(() => <RetryMark task={task({ state: "retry_scheduled", canRetry: false, nextRetryAt: at })} retry={retry} />);
    expect(container.textContent).toBe("Resuming soon");
    expect(container.querySelector(".retry-mark")?.getAttribute("title")).toBe("The last attempt stopped, and Paperclip resumes it by itself at 15:26.");
    expect(container.querySelector("button")).toBeNull();
  });
});
