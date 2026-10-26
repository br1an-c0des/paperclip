import type { TaskInterruptionPresentation } from "@paperclipai/shared";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { RetryMark, retryOffer, type TaskRetry } from "./retry";

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
    expect(retryOffer({ interruption: interruption({}) })).toEqual({ state: "failed", canRetry: true });
    expect(retryOffer({ interruption: interruption({ state: "retry_scheduled", canRetry: false }) })).toEqual({
      state: "retry_scheduled",
      canRetry: false,
    });
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
});
