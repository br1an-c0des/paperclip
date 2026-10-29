import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Route, Router } from "@solidjs/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The task panel's Case section (board C1) against mocked requests: the phase track from the main
 * task's workflow document, the hand-off strip, and Cancel hand-off, which changes a real case.
 */

afterEach(cleanup);

const cancelHandoff = vi.fn(async (..._args: unknown[]) => ({}));
const WORKFLOW = "Strategy.\n\n```mermaid\nstateDiagram-v2\n[*] --> Research\nResearch --> Build\nBuild --> Backtest\nBacktest --> [*]\n```\n";
const pending = {
  id: "h2",
  caseId: "c1",
  issueId: "t1",
  phase: "Build",
  state: "pending_dispatch",
  destinationKind: "agent",
  toAgentId: "a2",
  toAgentName: "Builder",
  fromAgentId: "a1",
  fromAgentName: "Researcher",
  actorType: "agent",
  actorId: "a1",
  assignmentAppliedAt: "2026-10-29T10:00:00Z",
  createdAt: "2026-10-29T10:00:00Z",
  instructions: "Implement section 3.",
  lastError: null,
  workflowTransition: { from: { workflowId: "w1", name: "Pipeline", phase: "Research" }, to: { workflowId: "w1", name: "Pipeline", phase: "Build" }, documentRevisionId: null },
};
const first = { ...pending, id: "h1", phase: "Research", state: "delivered", toAgentId: "a1", toAgentName: "Researcher", fromAgentId: null, fromAgentName: null, actorType: "user", workflowTransition: null, instructions: "Find setups." };
const detail = {
  id: "c1",
  companyId: "co1",
  identifier: "TES-C1",
  caseType: "Strategy",
  title: "Liquidation sweep",
  summary: "Fade forced liquidations.",
  status: "in_progress",
  fields: { timeframe: "4h", paper: null },
  workIssueId: "t1",
  workflowId: "w1",
  workflow: { id: "w1", name: "Pipeline" },
  phase: "Build",
  handoffVersion: 2,
  workIssue: { id: "t1", identifier: "TES-19", title: "Main", status: "todo", statusVersion: 2, assigneeAgentId: "a2", assigneeAgentName: "Builder" },
  pendingHandoff: pending,
  parentCaseId: null,
  parent: null,
  labels: [],
  issueLinks: [
    { id: "l1", caseId: "c1", issueId: "t1", role: "work", createdAt: "", issue: { id: "t1", identifier: "TES-19", title: "Main", status: "todo" } },
    { id: "l2", caseId: "c1", issueId: "t2", role: "reference", createdAt: "", issue: { id: "t2", identifier: "TES-21", title: "Fee notes", status: "todo" } },
  ],
  taskDocuments: [{ id: "issue:t1:workflow", taskId: "t1", taskIdentifier: "TES-19", key: "workflow", scope: "primary", document: { id: "d1", title: "Workflow", latestRevisionNumber: 1, updatedAt: "" } }],
  attachments: [],
};

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES", name: "Test" }) }));
vi.mock("@/lib/company-data", () => ({ useExperimentalSettingsQuery: () => ({ data: { enableCases: true } }) }));
vi.mock("@/tasks/people", () => ({ useTaskPeople: () => ({ agent: () => undefined }) }));
vi.mock("@/ui/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/api/issues", () => ({
  issuePath: (prefix: string, issue: { identifier: string | null; id: string }) => `/${prefix}/issues/${issue.identifier ?? issue.id}`,
  issuesApi: { getDocument: async () => ({ key: "workflow", body: WORKFLOW, latestRevisionNumber: 1 }) },
}));
vi.mock("@/api/cases", () => ({
  caseAssetUrl: () => "",
  casesApi: {
    get: async () => detail,
    handoffs: async () => ({ items: [pending, first], nextCursor: null, canControl: true }),
    list: async () => [],
    workflow: async () => ({ id: "w1", name: "Pipeline", prompt: WORKFLOW }),
    cancelHandoff: (...args: unknown[]) => cancelHandoff(...args),
  },
}));

const { TaskCaseSection } = await import("./CaseSection");

function mount(taskId: string, role: "work" | "reference") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const links = [{ id: "l", role, createdAt: "", case: { id: "c1", identifier: "TES-C1", title: "Liquidation sweep", caseType: "Strategy", status: "in_progress" as const, workIssueId: "t1", phase: "Build", handoffVersion: 2 } }];
  return render(() => (
    <QueryClientProvider client={client}>
      <Router>
        <Route path="*" component={() => <TaskCaseSection taskId={taskId} links={links} onOpenTask={() => {}} />} />
      </Router>
    </QueryClientProvider>
  ));
}

describe("TaskCaseSection", () => {
  it("shows the main task's case with its phase track, fields, hand-offs and other tasks", async () => {
    mount("t1", "work");
    expect(await screen.findByText("This is the case's main task")).toBeTruthy();
    expect(await screen.findByRole("list", { name: "Phases" })).toBeTruthy();
    const build = await screen.findByRole("listitem", { name: /^Build, Builder, waiting to start/ });
    expect(build.getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("listitem", { name: /^Research, Researcher, done/ })).toBeTruthy();
    expect(screen.getByText("Phase 2 of 3")).toBeTruthy();
    expect(screen.getByText("timeframe")).toBeTruthy();
    expect(screen.getByText("Research → Build")).toBeTruthy();
    expect(screen.getByText("Started · Research")).toBeTruthy();
    expect(screen.getByText("Fee notes")).toBeTruthy();
  });

  it("cancels a queued hand-off", async () => {
    mount("t1", "work");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel hand-off" }));
    await waitFor(() => expect(cancelHandoff).toHaveBeenCalledWith("c1", "h2"));
  });

  it("names a linked task's role and the main task", async () => {
    mount("t2", "reference");
    expect(await screen.findByText(/Reference/)).toBeTruthy();
    expect((await screen.findAllByRole("link", { name: "TES-19" })).length).toBeGreaterThan(0);
  });
});
