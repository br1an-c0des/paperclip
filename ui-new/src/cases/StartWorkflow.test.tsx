import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Start workflow (board C2) with its requests mocked: the real hand-off wakes the agent, so this
 * checks the request it would send instead.
 */

afterEach(cleanup);

const handoff = vi.fn(async (..._args: unknown[]) => ({ taskIdentifier: "TES-30" }));
const WORKFLOW = "```mermaid\nstateDiagram-v2\n[*] --> Research\nResearch --> Build\nBuild --> [*]\n```";

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES", name: "Test" }) }));
vi.mock("@/lib/company-data", () => ({
  useAgentsQuery: () => ({ data: [{ id: "a1", name: "Researcher", status: "paused" }, { id: "a9", name: "Gone", status: "terminated" }] }),
}));
vi.mock("@/ui/Toast", () => ({ pushToast: vi.fn() }));
vi.mock("@/api/cases", () => ({
  casesApi: {
    workflows: async () => [{ id: "w1", name: "Pipeline" }],
    workflow: async () => ({ id: "w1", name: "Pipeline", prompt: WORKFLOW }),
    handoff: (...args: unknown[]) => handoff(...args),
  },
}));

const { StartWorkflowDialog } = await import("./StartWorkflow");

const kase = { id: "c2", identifier: "TES-C2", title: "Draft", caseType: "Strategy", status: "draft", workIssueId: null, handoffVersion: 0 } as never;

describe("StartWorkflowDialog", () => {
  it("says what's missing, then hands the case off with the template's first phase", async () => {
    const onOpenChange = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(() => (
      <QueryClientProvider client={client}>
        <StartWorkflowDialog kase={kase} open onOpenChange={onOpenChange} />
      </QueryClientProvider>
    ));
    fireEvent.click(await screen.findByRole("button", { name: "Start workflow" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Pick a workflow template or write the workflow.");

    const template = screen.getByLabelText("Workflow template") as HTMLSelectElement;
    await screen.findByRole("option", { name: "Pipeline" });
    template.value = "w1";
    fireEvent.change(template);
    await waitFor(() => expect((screen.getByLabelText("First phase") as HTMLInputElement).value).toBe("Research"));
    expect(screen.queryByRole("option", { name: "Gone" })).toBeNull();

    const agent = screen.getByLabelText("Agent") as HTMLSelectElement;
    agent.value = "a1";
    fireEvent.change(agent);
    fireEvent.input(screen.getByLabelText("Instructions"), { target: { value: "Find setups." } });
    fireEvent.click(screen.getByRole("button", { name: "Start workflow" }));

    await waitFor(() => expect(handoff).toHaveBeenCalledTimes(1));
    const [companyId, input] = handoff.mock.calls[0] as [string, Record<string, unknown>];
    expect(companyId).toBe("co1");
    expect(input).toMatchObject({ case: { id: "c2" }, toAgentId: "a1", phase: "Research", instructions: "Find setups.", workflowId: "w1", expectedHandoffVersion: 0 });
    expect(typeof input.idempotencyKey).toBe("string");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
