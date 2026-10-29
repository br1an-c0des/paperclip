import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Route, Router } from "@solidjs/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Retry, Resume and the watchdog's answers in the Runs section, against mocked requests: each
 * wakes an agent or changes a real run, so none is pressed on the test instance.
 */

afterEach(cleanup);

const retry = vi.fn(async (..._args: unknown[]) => ({ id: "r-new", status: "queued" }));
const resume = vi.fn(async (..._args: unknown[]) => ({ id: "r-resumed", status: "queued" }));
const decide = vi.fn(async (..._args: unknown[]) => ({}));

const base = { agentId: "a1", adapterType: "claude_local", invocationSource: "assignment", usageJson: null, resultJson: null, finishedAt: "2026-10-28T10:05:00Z" };
const runs = [
  { ...base, runId: "r-failed", status: "failed", errorCode: "adapter_failed", error: "Exit 1", startedAt: "2026-10-28T10:00:00Z", createdAt: "2026-10-28T10:00:00Z" },
  { ...base, runId: "r-lost", status: "failed", errorCode: "process_lost", error: "Lost", startedAt: "2026-10-28T09:00:00Z", createdAt: "2026-10-28T09:00:00Z" },
  { ...base, runId: "r-live", status: "running", finishedAt: null, startedAt: "2026-10-28T11:00:00Z", createdAt: "2026-10-28T11:00:00Z" },
];

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES", name: "Test" }) }));
vi.mock("@/lib/commands", () => ({ useCommands: () => ({ openRunModal: vi.fn() }) }));
vi.mock("./people", () => ({ useTaskPeople: () => ({ agent: () => ({ id: "a1", name: "Bob" }) }) }));
vi.mock("@/ui/Avatar", () => ({ AgentAvatar: () => null }));
vi.mock("@/ui/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/api/issues", () => ({
  issuePath: (prefix: string, issue: { identifier: string | null; id: string }) => `/${prefix}/issues/${issue.identifier ?? issue.id}`,
  issuesApi: {
    runs: async () => runs,
    costSummary: async () => ({ costCents: 0, runCount: 3, runtimeMs: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, issueCount: 1 }),
  },
}));
vi.mock("@/api/runs", () => ({
  runsApi: {
    retry: (...args: unknown[]) => retry(...args),
    resume: (...args: unknown[]) => resume(...args),
    get: async () => ({
      id: "r-live",
      status: "running",
      outputSilence: {
        level: "critical",
        silenceAgeMs: 40 * 60_000,
        snoozedUntil: null,
        evaluationIssueId: "eval-1",
        evaluationIssueIdentifier: "TES-99",
      },
    }),
  },
}));
vi.mock("@/api/heartbeats", () => ({ heartbeatsApi: { cancel: vi.fn(), recordWatchdogDecision: (...args: unknown[]) => decide(...args) } }));

const { TaskRuns } = await import("./TaskRuns");

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      <Router>
        <Route path="*" component={() => <TaskRuns taskId="t1" />} />
      </Router>
    </QueryClientProvider>
  ));
}

describe("TaskRuns actions", () => {
  it("retries a failed run with the same request", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith({ id: "r-failed", agentId: "a1", companyId: "co1" }));
  });

  it("resumes a run whose process was lost", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
    await waitFor(() =>
      expect(resume).toHaveBeenCalledWith({ id: "r-lost", agentId: "a1", companyId: "co1" }, { resumeFromRunId: "r-lost", issueId: "t1" }),
    );
  });

  it("answers the watchdog on a running run that has gone quiet", async () => {
    mount();
    expect(await screen.findByText("No output for a long while")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep watching" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith({ runId: "r-live", decision: "continue", evaluationIssueId: "eval-1" }));
  });
});
