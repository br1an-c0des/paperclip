import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Route, Router } from "@solidjs/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

let experimental: Record<string, boolean> = {};
let slotResponse: unknown = null;
const get = vi.fn(async (_selector: unknown) => slotResponse);
const generate = vi.fn(async (_selector: unknown) => ({ slot: { status: "generating" }, generatingIssue: { id: "i1", identifier: "TES-9", title: "Summarize", status: "todo" }, alreadyGenerating: false }));

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES", name: "Test" }) }));
vi.mock("@/lib/company-data", () => ({ useExperimentalSettingsQuery: () => ({ data: experimental }) }));
vi.mock("@/lib/live-events", () => ({ useLiveEvent: () => undefined }));
vi.mock("./summary-api", () => ({
  summaryApi: {
    get: (selector: unknown) => get(selector),
    revisions: async () => ({ slot: null, revisions: [] }),
    generate: (selector: unknown) => generate(selector),
    builtInAgents: async () => [{ definition: { key: "summarizer", displayName: "Summarizer" }, status: "ready", agentId: "a1", agent: null }],
  },
}));

const { SummaryCard } = await import("./AiSummary");

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      <Router>
        <Route
          path="*"
          component={() => (
            <SummaryCard scopeKind="workspaces_overview" title="Workspace summary" description="The Summarizer tracks workspace activity across projects." />
          )}
        />
      </Router>
    </QueryClientProvider>
  ));
}

describe("SummaryCard", () => {
  beforeEach(() => {
    get.mockClear();
    generate.mockClear();
  });

  it("shows nothing and asks for nothing while summaries are off", async () => {
    experimental = { enableSummaries: false };
    mount();
    await Promise.resolve();
    expect(screen.queryByRole("region", { name: "Workspace summary" })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("shows the workspaces overview summary", async () => {
    experimental = { enableSummaries: true, enableBuiltInAgents: true };
    slotResponse = {
      slot: { status: "idle" },
      document: { body: "Two workspaces have **dev servers** running.", latestRevisionId: "r1", latestRevisionNumber: 1, updatedAt: new Date().toISOString() },
      generatingIssue: null,
    };
    mount();
    const card = await screen.findByRole("region", { name: "Workspace summary" });
    await waitFor(() => expect(card.textContent).toContain("Two workspaces have dev servers running."));
    expect(get).toHaveBeenCalledWith({ companyId: "co1", scopeKind: "workspaces_overview", scopeId: null, slotKey: "header" });
    expect(card.textContent).toContain("revision 1");
  });

  it("offers the first summary when the Summarizer is ready, and starts it", async () => {
    experimental = { enableSummaries: true, enableBuiltInAgents: true };
    slotResponse = { slot: null, document: null, generatingIssue: null };
    mount();
    const button = await screen.findByRole("button", { name: "Generate a summary" });
    expect(screen.getByText("The Summarizer tracks workspace activity across projects.")).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ companyId: "co1", scopeKind: "workspaces_overview", scopeId: null, slotKey: "header" }));
  });
});
