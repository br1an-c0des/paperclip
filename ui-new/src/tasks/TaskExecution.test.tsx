import type { Issue } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

let liveRuns: { id: string; issueId: string; status: string }[] = [];
vi.mock("@/lib/company-data", () => ({ useLiveRunsQuery: () => ({ get data() { return liveRuns; } }) }));
vi.mock("@/api/task-actions", () => ({ taskActionsApi: { checkMonitorNow: vi.fn(), retryScheduledNow: vi.fn() } }));

const { dateTime, MonitorControl, relativeTime, ScheduledRetryControl, scheduledRetryLabel } = await import("./TaskExecution");

describe("execution times", () => {
  const now = new Date(2026, 9, 26, 10, 0).getTime();

  it("says when, relative to now", () => {
    expect(relativeTime(new Date(now + 3 * 60_000), now)).toBe("in 3m");
    expect(relativeTime(new Date(now + 2 * 3_600_000), now)).toBe("in 2h");
    expect(relativeTime(new Date(now + 3 * 86_400_000), now)).toBe("in 3d");
    expect(relativeTime(new Date(now - 5 * 60_000), now)).toBe("5m ago");
    expect(relativeTime(new Date(now + 20_000), now)).toBe("now");
  });

  it("writes a date and time briefly", () => {
    expect(dateTime(new Date(2026, 9, 27, 9, 5))).toBe("Oct 27, 09:05");
  });
});

function mount(view: () => unknown) {
  const client = new QueryClient();
  return render(() => <QueryClientProvider client={client}>{view() as never}</QueryClientProvider>);
}

describe("the monitor and scheduled retry rows (U79)", () => {
  const nextCheckAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const monitored = {
    id: "t1",
    executionPolicy: { monitor: { nextCheckAt, notes: "Check the deploy", serviceName: null } },
    executionState: { monitor: { nextCheckAt, status: "scheduled", attemptCount: 0 } },
  } as unknown as Issue;

  it("waits for the current run, keeping its time, with no Check now (#19519)", () => {
    liveRuns = [{ id: "r1", issueId: "t1", status: "running" }];
    mount(() => <MonitorControl task={monitored} onChange={() => undefined} />);
    const trigger = screen.getByRole("button", { name: /Monitor: Monitor waits for current run/ });
    expect(trigger.getAttribute("title")).toBe(`The check can start after the current run finishes saving its work. Scheduled for ${dateTime(nextCheckAt)}.`);
    fireEvent.click(trigger);
    expect(screen.getByText(/The check can start after the current run finishes saving its work\. Scheduled for/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
  });

  it("offers Check now again once the run clears", () => {
    liveRuns = [{ id: "r2", issueId: "other", status: "running" }];
    mount(() => <MonitorControl task={monitored} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Monitor: Next check in/ }));
    expect(screen.getByRole("button", { name: "Check now" })).toBeTruthy();
  });

  it("shows a busy-workspace wait as a quiet status, with nothing to press (#19507)", () => {
    const waiting = { id: "t1", scheduledRetry: { status: "scheduled_retry", scheduledRetryReason: "workspace_busy", scheduledRetryAt: nextCheckAt, scheduledRetryAttempt: 1 } } as unknown as Issue;
    mount(() => <ScheduledRetryControl task={waiting} />);
    expect(screen.getByText("Waiting for workspace")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry now" })).toBeNull();
    // Its row is labelled Workspace, as in the old UI; nothing is being retried.
    expect(scheduledRetryLabel(waiting)).toBe("Workspace");
  });

  it("keeps Retry now for other scheduled retries", () => {
    const retrying = { id: "t1", scheduledRetry: { status: "scheduled_retry", scheduledRetryReason: "transient_failure", scheduledRetryAt: nextCheckAt, scheduledRetryAttempt: 1 } } as unknown as Issue;
    mount(() => <ScheduledRetryControl task={retrying} />);
    expect(screen.getByRole("button", { name: "Retry now" })).toBeTruthy();
    expect(scheduledRetryLabel(retrying)).toBe("Scheduled retry");
  });
});
