import type { StatusCard, StatusCardUpdate } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { Route, Router } from "@solidjs/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const settings = { enableStatusCards: true, enableBuiltInAgents: false };
const builtIns = { summarizer: "not_provisioned" as string };
const policy = { mode: "manual" as const, triggers: { statusTransitions: true, membershipChanges: true, humanComments: true, assigneeChanges: true, anyUpdate: false } };
const card = (patch: Partial<StatusCard>): StatusCard =>
  ({
    id: "c1",
    companyId: "co1",
    createdByUserId: "u1",
    createdByAgentId: null,
    title: "Test Project at a glance",
    titlePinned: false,
    interestPrompt: "Test Project at a glance",
    queries: [{ q: "", limit: 50 }],
    queryVersion: 1,
    queryCompiledAt: "2026-10-29T09:00:00Z",
    queryCompiledByAgentId: "a1",
    agentId: "a1",
    refreshPolicy: policy,
    state: "active",
    pendingChangeCount: 0,
    lastChangeAt: null,
    fingerprint: null,
    fingerprintAt: null,
    mentionedIssueIds: [],
    documentId: "d1",
    lastUpdateRunKind: "full",
    lastGeneratedAt: "2026-10-29T09:30:00Z",
    lastModel: "claude-haiku-4-5",
    generatingIssueId: null,
    failureReason: null,
    nextEvalAt: null,
    archivedAt: null,
    archivedByUserId: null,
    archivedByAgentId: null,
    createdAt: "2026-10-28T09:00:00Z",
    updatedAt: "2026-10-29T09:30:00Z",
    summaryBody: "- **Done:** TES-3",
    todayTokens: 1200,
    todayCostCents: 1,
    ...patch,
  }) as StatusCard;

const ledgerRow = (patch: Partial<StatusCardUpdate>): StatusCardUpdate => ({
  id: "u1",
  cardId: "c1",
  kind: "full",
  trigger: "manual",
  generationIssueId: "g1",
  runId: "r1",
  changes: [],
  inputTokens: 900,
  outputTokens: 300,
  costCents: 1,
  model: "claude-haiku-4-5",
  queryVersion: 1,
  changeSummary: null,
  startedAt: "2026-10-29T09:29:00Z",
  finishedAt: "2026-10-29T09:30:00Z",
  status: "ok",
  error: null,
  ...patch,
});

const active = [card({}), card({ id: "c2", title: "Blocked this week", pendingChangeCount: 3 }), card({ id: "c3", title: null, state: "compiling", queries: [], summaryBody: null, generatingIssueId: null })];
const archived = [card({ id: "c4", title: "Q3 launch", archivedAt: "2026-10-26T09:00:00Z" })];
const updates = [
  ledgerRow({ id: "u2", kind: "incremental", changeSummary: "TES-9 blocked.", changes: [{ issueId: "i9", identifier: "TES-9", from: "in_progress", to: "blocked", changeKind: "status" }] }),
  ledgerRow({ id: "u1", startedAt: "2026-10-28T09:00:00Z", finishedAt: "2026-10-28T09:01:00Z", changeSummary: "First summary." }),
];

const api = {
  list: vi.fn(async (_companyId: string, isArchived: boolean) => (isArchived ? archived : active)),
  get: vi.fn(async (id: string) => [...active, ...archived].find((entry) => entry.id === id)),
  create: vi.fn(async (): Promise<StatusCard> => {
    const { ApiError } = await import("@/api/client");
    throw new ApiError("Summarizer built-in agent is not configured", 422, { error: "x", details: { code: "summarizer_not_configured" } });
  }),
  patch: vi.fn(async () => active[0]),
  remove: vi.fn(async () => undefined),
  updates: vi.fn(async () => updates),
  summaryRevisions: vi.fn(async () => [
    { id: "rv2", revisionNumber: 2, title: null, body: "Latest body", changeSummary: null, createdAt: "2026-10-29T09:30:00Z" },
    { id: "rv1", revisionNumber: 1, title: null, body: "The first body", changeSummary: null, createdAt: "2026-10-28T09:01:00Z" },
  ]),
  refresh: vi.fn(async () => ({ card: active[0], generatingIssue: null, alreadyGenerating: false, enqueued: true })),
  recompile: vi.fn(async () => ({ card: active[2], generatingIssue: null, alreadyGenerating: false })),
  dryRun: vi.fn(async () => ({
    cardId: "c1",
    queryVersion: 1,
    queries: [{ query: {}, result: { results: [{ issue: { id: "i9", identifier: "TES-9", title: "Get API keys", status: "blocked", priority: "medium", updatedAt: "2026-10-29T09:00:00Z" } }] } }],
    mentionedIssues: [{ id: "i30", identifier: "TES-30", title: "Release checklist", status: "todo", priority: "medium", updatedAt: "2026-10-29T09:00:00Z" }],
  })),
};
const openTaskModal = vi.fn();

vi.mock("@/api/status-cards", () => ({ statusCardsApi: api }));
vi.mock("@/api/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/agents")>()),
  builtInAgentsApi: {
    list: async () => [
      { definition: { key: "summarizer", displayName: "Summarizer", shortPurpose: "Summaries", featureKeys: ["summarizer"] }, status: builtIns.summarizer, agentId: builtIns.summarizer === "not_provisioned" ? null : "s1", agent: null },
    ],
  },
  adaptersApi: {
    list: async () => [
      { type: "claude_local", capabilities: { supportsLocalAgentJwt: true } },
      { type: "process", capabilities: { supportsLocalAgentJwt: true } },
    ],
  },
}));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES", name: "Test" }) }));
vi.mock("@/lib/commands", () => ({ useCommands: () => ({ openTaskModal }) }));
vi.mock("@/lib/company-data", () => ({
  useExperimentalSettingsQuery: () => ({ data: settings }),
  useAgentsQuery: () => ({
    data: [
      { id: "a1", name: "M7 test summarizer", status: "idle", adapterType: "claude_local", budgetMonthlyCents: 0, spentMonthlyCents: 0, appearance: null },
      { id: "a2", name: "M7 test pipe", status: "idle", adapterType: "process", budgetMonthlyCents: 0, spentMonthlyCents: 0, appearance: null },
      { id: "s1", name: "Summarizer", status: "paused", adapterType: "claude_local", budgetMonthlyCents: 0, spentMonthlyCents: 0, appearance: null },
    ],
  }),
}));

const { StatusPage } = await import("./StatusPage");

function mount(path = "/TES/status") {
  window.history.replaceState(null, "", path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      <Router>
        <Route path="/:companyPrefix/status/:cardId?" component={StatusPage} />
      </Router>
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  settings.enableStatusCards = true;
  settings.enableBuiltInAgents = false;
  builtIns.summarizer = "not_provisioned";
  vi.clearAllMocks();
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("StatusPage", () => {
  it("draws a tile per card with its state, and the archived cards on request", async () => {
    mount();
    const fresh = await screen.findByRole("article", { name: "Test Project at a glance" });
    expect(fresh.textContent).toContain("Fresh");
    expect(fresh.textContent).toContain("Manual");
    const stale = screen.getByRole("article", { name: "Blocked this week" });
    expect(stale.textContent).toContain("3 changes since the last update");
    const stalled = screen.getByRole("article", { name: "New card" });
    expect(stalled.textContent).toContain("Setup didn't finish.");
    fireEvent.click(within(stalled).getByRole("button", { name: "Run setup again" }));
    await waitFor(() => expect(api.recompile).toHaveBeenCalledWith("c3"));

    fireEvent.click(within(stale).getByRole("button", { name: "Update" }));
    await waitFor(() => expect(api.refresh).toHaveBeenCalledWith("c2", false));

    fireEvent.click(screen.getByRole("button", { name: /Archived/ }));
    expect(await screen.findByText("Q3 launch")).toBeTruthy();
    expect(await screen.findByText(/2\.4k tok · \$0\.020 in all/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith("c4", { archived: false }));
  });

  it("opens a card's panel with its summary, earlier summaries, history and dry run", async () => {
    mount("/TES/status/c1");
    const panel = await screen.findByRole("complementary", { name: "Status card: Test Project at a glance" });
    expect(await within(panel).findByText("Folded into the last update")).toBeTruthy();
    expect(panel.textContent).toContain("TES-9");
    expect(panel.textContent).toContain("Blocked");

    const picker = within(panel).getByRole("button", { name: "Earlier summaries" });
    fireEvent.pointerDown(picker, { button: 0, pointerType: "mouse" });
    fireEvent.click(picker);
    const earlier = await screen.findByRole("menuitem", { name: /Revision 1/ });
    fireEvent.pointerDown(earlier, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(earlier, { button: 0, pointerType: "mouse" });
    fireEvent.click(earlier);
    expect(await within(panel).findByText("The first body")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "History" }));
    expect(await within(panel).findByText("First summary.")).toBeTruthy();
    expect(panel.textContent).toContain("900 in / 300 out");

    fireEvent.click(within(panel).getByRole("button", { name: "Watched" }));
    expect(await within(panel).findByText("Get API keys")).toBeTruthy();
    expect(panel.textContent).toContain("Mentioned in the summary");
    fireEvent.click(within(panel).getByRole("button", { name: /Get API keys/ }));
    expect(openTaskModal).toHaveBeenCalledWith({ id: "i9", identifier: "TES-9", title: "Get API keys", projectId: null });

    fireEvent.click(within(panel).getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(api.refresh).toHaveBeenCalledWith("c1", false));
  });

  it("saves settings, sending a changed name and the policy", async () => {
    mount("/TES/status/c1?tab=settings");
    const name = await screen.findByLabelText("Name");
    fireEvent.input(name, { target: { value: "Glance" } });
    fireEvent.click(screen.getByLabelText(/On a schedule/));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith("c1", expect.objectContaining({ title: "Glance", titlePinned: true, agentId: "a1", refreshPolicy: expect.objectContaining({ mode: "interval", intervalMinutes: 15 }) })),
    );
    expect((api.patch.mock.calls[0] as unknown[])[1]).not.toHaveProperty("interestPrompt");
  });

  it("holds Create back while built-in agents are off, until an agent is chosen", async () => {
    mount();
    await screen.findByRole("article", { name: "Test Project at a glance" });
    fireEvent.click(screen.getAllByRole("button", { name: "New card" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.input(within(dialog).getByLabelText("What do you want to keep an eye on?"), { target: { value: "Everything blocked" } });
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Built-in agents are off");
    const create = within(dialog).getByRole("button", { name: "Create card" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    const picker = within(dialog).getByRole("button", { name: "Agent" });
    fireEvent.pointerDown(picker, { button: 0, pointerType: "mouse" });
    fireEvent.click(picker);
    const pipe = await screen.findByRole("menuitem", { name: /M7 test pipe/ });
    expect(pipe.getAttribute("aria-disabled")).toBe("true");
    expect(pipe.textContent).toContain("Can't write cards");
    const quill = screen.getByRole("menuitem", { name: /M7 test summarizer/ });
    fireEvent.pointerDown(quill, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(quill, { button: 0, pointerType: "mouse" });
    fireEvent.click(quill);
    await waitFor(() => expect(create.disabled).toBe(false));
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("says the Summarizer isn't set up and offers to set it up; a paused one is held back too", async () => {
    settings.enableBuiltInAgents = true;
    mount();
    await screen.findByRole("article", { name: "Test Project at a glance" });
    fireEvent.click(screen.getAllByRole("button", { name: "New card" })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect((await within(dialog).findByRole("alert")).textContent).toContain("Summarizer: not set up");
    expect(within(dialog).getByRole("button", { name: "Set up the Summarizer" })).toBeTruthy();
    cleanup();

    builtIns.summarizer = "paused";
    mount();
    await screen.findByRole("article", { name: "Test Project at a glance" });
    fireEvent.click(screen.getAllByRole("button", { name: "New card" })[0]!);
    const again = await screen.findByRole("dialog");
    expect((await within(again).findByRole("alert")).textContent).toContain("Summarizer: paused");
    expect(within(again).getByRole("link", { name: "Open the Summarizer" }).getAttribute("href")).toBe("/TES/agents/s1");
  });

  it("explains the server's refusal when the Summarizer turns out not to be ready", async () => {
    settings.enableBuiltInAgents = true;
    builtIns.summarizer = "ready";
    mount();
    await screen.findByRole("article", { name: "Test Project at a glance" });
    fireEvent.click(screen.getAllByRole("button", { name: "New card" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.input(within(dialog).getByLabelText("What do you want to keep an eye on?"), { target: { value: "Everything blocked" } });
    const create = within(dialog).getByRole("button", { name: "Create card" }) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(false));
    fireEvent.click(create);
    expect(await within(dialog).findByText(/no Summarizer set up/)).toBeTruthy();
    expect(api.create).toHaveBeenCalledWith("co1", expect.objectContaining({ interestPrompt: "Everything blocked", agentId: null }));
  });

  it("says a setup is waiting when its agent can't get to it", async () => {
    settings.enableBuiltInAgents = true;
    builtIns.summarizer = "paused";
    api.list.mockImplementation(async (_companyId: string, isArchived: boolean) =>
      isArchived ? [] : [card({ id: "c5", title: "Waiting card", agentId: null, state: "compiling", queries: [], summaryBody: null, generatingIssueId: "g5" })],
    );
    mount();
    const tile = await screen.findByRole("article", { name: "Waiting card" });
    await waitFor(() => expect(tile.textContent).toContain("Waiting. Summarizer: paused."));
    api.list.mockImplementation(async (_companyId: string, isArchived: boolean) => (isArchived ? archived : active));
  });

  it("says so when status cards are off, without asking for cards", async () => {
    settings.enableStatusCards = false;
    mount();
    expect(await screen.findByText(/Status cards are off/)).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });
});
