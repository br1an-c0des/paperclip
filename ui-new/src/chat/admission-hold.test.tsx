import type { AgentDetail } from "@paperclipai/shared";
import { Route, Router } from "@solidjs/router";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import type { JSX } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Named holds outside the chat's reply card (decision 50, U120): the chat's Activity column and a
 * task's live run line read a queued run's detail for its hold, against mocked requests.
 */

afterEach(cleanup);

const details = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/api/runs", () => ({ runsApi: details }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES", name: "Test" }) }));
vi.mock("@/lib/commands", () => ({ useCommands: () => ({ openRunModal: vi.fn(), openTaskModal: vi.fn() }) }));
vi.mock("@/lib/company-data", () => ({ useAgentsQuery: () => ({ data: [] }), useLiveRunsQuery: () => ({ data: [] }) }));
vi.mock("@/api/chat", () => ({ chatApi: { upNext: async () => [], activity: async () => [] } }));
vi.mock("@/api/issues", () => ({
  issuePath: () => "/TES/issues/x",
  issuesApi: { getCore: async () => ({ id: "t1", identifier: "TES-1", title: "Fix the build", projectId: null }) },
}));
vi.mock("@/ui/Toast", () => ({ pushToast: vi.fn() }));

const { useQueuedHold } = await import("./admission-hold");
const { ChatActivity } = await import("./ChatActivity");
const { LiveRunWho } = await import("@/tasks/TaskActivity");
const { queryKeys } = await import("@/api/queryKeys");

const maintenance = { phase: "queued", label: "Waiting for maintenance", cause: "task_drain" };
const ordinary = { phase: "queued", label: "Queued", cause: null };

function mount(view: () => JSX.Element, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    client,
    ...render(() => (
      <QueryClientProvider client={client}>
        <Router>
          <Route path="*" component={view} />
        </Router>
      </QueryClientProvider>
    )),
  };
}

beforeEach(() => details.get.mockReset());

describe("useQueuedHold", () => {
  function Probe(props: { run: { id: string; status: string } }) {
    const hold = useQueuedHold(() => props.run);
    return <span data-testid="hold">{hold() ?? "none"}</span>;
  }

  it("reads a queued run's detail once and names its hold", async () => {
    details.get.mockResolvedValue({ id: "r1", status: "queued", execution: maintenance });
    mount(() => <Probe run={{ id: "r1", status: "queued" }} />);
    await waitFor(() => expect(screen.getByTestId("hold").textContent).toBe("Waiting for maintenance"));
    expect(details.get).toHaveBeenCalledTimes(1);
    expect(details.get.mock.calls[0]![0]).toBe("r1");
  });

  it("shares the run detail the reply card and run modal already read", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    client.setQueryData(queryKeys.runs.detail("r1"), { id: "r1", status: "queued", execution: maintenance });
    mount(() => <Probe run={{ id: "r1", status: "queued" }} />, client);
    expect(screen.getByTestId("hold").textContent).toBe("Waiting for maintenance");
    expect(details.get).not.toHaveBeenCalled();
  });

  it("reads nothing for a run that has started", async () => {
    mount(() => <Probe run={{ id: "r1", status: "running" }} />);
    await Promise.resolve();
    expect(screen.getByTestId("hold").textContent).toBe("none");
    expect(details.get).not.toHaveBeenCalled();
  });
});

describe("the chat's Activity column", () => {
  const agent = { id: "a1", name: "Bob", status: "idle" } as unknown as AgentDetail;
  const people = { personName: () => null, youId: () => null } as never;
  const live = (id: string, extra: object = {}) => ({ id, status: "queued", agentId: "a1", agentName: "Bob", startedAt: null, createdAt: "2026-11-11T10:00:00Z", ...extra });

  it("names a queued task run's hold instead of Starting", async () => {
    details.get.mockResolvedValue({ id: "w1", status: "queued", execution: maintenance });
    mount(() => <ChatActivity agent={agent} base="/TES/chat/bob" chatId={null} replyRuns={[]} otherRuns={[live("w1", { issueId: "t1" })]} people={people} />);
    await waitFor(() => expect(screen.getByText("Waiting for maintenance")).toBeTruthy());
    expect(screen.queryByText("Starting")).toBeNull();
  });

  it("keeps Starting through ordinary admission", async () => {
    details.get.mockResolvedValue({ id: "w1", status: "queued", execution: ordinary });
    mount(() => <ChatActivity agent={agent} base="/TES/chat/bob" chatId={null} replyRuns={[]} otherRuns={[live("w1", { createdAt: new Date().toISOString() })]} people={people} />);
    await waitFor(() => expect(details.get).toHaveBeenCalled());
    expect(screen.getByText("Starting")).toBeTruthy();
    expect(screen.getByText("Working now")).toBeTruthy();
  });

  it("says Waiting to start once ordinary admission has taken 30 seconds (U151, #21447)", async () => {
    mount(() => <ChatActivity agent={agent} base="/TES/chat/bob" chatId={null} replyRuns={[]} otherRuns={[live("w1", { execution: ordinary })]} people={people} />);
    expect(screen.getByText("Waiting to start")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.queryByText("Starting")).toBeNull();
    // The live row carries its execution, so the run detail isn't read.
    expect(details.get).not.toHaveBeenCalled();
  });

  it("shows the agent's line with Configure while its slots are full (U151, #21405)", async () => {
    const execution = {
      phase: "queued",
      label: "Waiting for Bob",
      cause: "agent_at_capacity",
      agentQueue: { agentId: "a1", agentName: "Bob", maxConcurrentRuns: 1, runningCount: 1, position: 2, queuedCount: 3 },
    };
    mount(() => <ChatActivity agent={agent} base="/TES/chat/bob" chatId={null} replyRuns={[]} otherRuns={[live("w1", { issueId: "t1", execution })]} people={people} />);
    expect(screen.getByText("Waiting for Bob")).toBeTruthy();
    expect(screen.getByText("1 slot max")).toBeTruthy();
    expect(screen.getByText("2 of 3 in line")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Configure Bob's runs at once" }).getAttribute("href")).toBe("/TES/agents/a1/settings/runtime");
    expect(details.get).not.toHaveBeenCalled();
  });

  it("names a queued reply's hold instead of From your message", async () => {
    details.get.mockResolvedValue({ id: "c1", status: "queued", execution: { phase: "queued", label: "Waiting for agent setup", cause: "agent_setup_pending" } });
    mount(() => <ChatActivity agent={agent} base="/TES/chat/bob" chatId={null} replyRuns={[live("c1")]} otherRuns={[]} people={people} />);
    await waitFor(() => expect(screen.getByText("Waiting for agent setup")).toBeTruthy());
    expect(screen.queryByText("From your message")).toBeNull();
  });
});

describe("a task's live run line", () => {
  it("names a queued run's hold", async () => {
    details.get.mockResolvedValue({ id: "r1", status: "queued", execution: { phase: "queued", label: "Waiting for server restart", cause: "server_restarting" } });
    mount(() => <LiveRunWho run={{ id: "r1", status: "queued", agentName: "Bob" }} />);
    await waitFor(() => expect(screen.getByText("Bob · Waiting for server restart")).toBeTruthy());
  });

  it("reads is working through ordinary admission and once the run has started", async () => {
    details.get.mockResolvedValue({ id: "r1", status: "queued", execution: ordinary });
    mount(() => <LiveRunWho run={{ id: "r1", status: "queued", agentName: "Bob" }} />);
    await waitFor(() => expect(details.get).toHaveBeenCalled());
    expect(screen.getByText("Bob is working")).toBeTruthy();
    cleanup();
    details.get.mockClear();
    mount(() => <LiveRunWho run={{ id: "r2", status: "running", agentName: "Bob" }} />);
    expect(screen.getByText("Bob is working")).toBeTruthy();
    expect(details.get).not.toHaveBeenCalled();
  });

  it("names a routine's hold from the live row itself (U151, #21447)", () => {
    const execution = { phase: "queued", label: "Waiting for TES-12 to finish", cause: "routine_execution_in_progress" } as never;
    mount(() => <LiveRunWho run={{ id: "r1", status: "queued", agentName: "Bob", startedAt: null, createdAt: new Date().toISOString(), execution }} />);
    expect(screen.getByText("Bob · Waiting for TES-12 to finish")).toBeTruthy();
    expect(details.get).not.toHaveBeenCalled();
  });

  it("turns Bob is working into Waiting to start when the 30 seconds pass", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-14T10:00:10Z"));
      mount(() => <LiveRunWho run={{ id: "r1", status: "queued", agentName: "Bob", startedAt: null, createdAt: "2026-11-14T10:00:00Z", execution: ordinary as never }} />);
      expect(screen.getByText("Bob is working")).toBeTruthy();
      vi.advanceTimersByTime(21_000);
      expect(screen.getByText("Bob · Waiting to start")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
