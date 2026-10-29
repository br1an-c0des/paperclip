import type { ConnectionIntentInteraction, DecisionOption } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyJoinRequest } from "@/api/access";
import type { DecisionOutcome } from "@/api/decisions";
import type { TaskPeople } from "@/tasks/people";
import { requestFromDecision } from "./decision-model";
import { requestFromJoin } from "./join-model";
import { requestFromApproval, requestFromInteraction, requestFromReview, type Request } from "./request-model";

/*
 * The request kinds slice B answers on the card: connection requests, proposals, join requests,
 * stalled reviews, withdrawing your own question and budget stops. The APIs are mocked; the
 * Inbox's own checks ran against the test company.
 */

afterEach(cleanup);

const api = {
  setupOptions: vi.fn(),
  complete: vi.fn(async () => ({})),
  decline: vi.fn(async () => ({})),
  adopt: vi.fn(async () => ({})),
  setPhase: vi.fn(async () => ({})),
  decide: vi.fn(async (id: string) => ({ ...decision, id, targetSnapshots: {} })),
  dismiss: vi.fn(async (id: string) => ({ ...decision, id, targetSnapshots: {} })),
  approveJoin: vi.fn(async () => ({})),
  rejectJoin: vi.fn(async () => ({})),
  stalled: vi.fn(async () => ({})),
  cancel: vi.fn(async () => ({})),
};

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TRA" }) }));
vi.mock("@/api/connection-intents", () => ({
  connectionIntentsApi: {
    setupOptions: (...args: unknown[]) => api.setupOptions(...args),
    complete: (...args: unknown[]) => api.complete(...(args as [])),
    decline: (...args: unknown[]) => api.decline(...(args as [])),
    adopt: (...args: unknown[]) => api.adopt(...(args as [])),
    setPhase: (...args: unknown[]) => api.setPhase(...(args as [])),
  },
}));
vi.mock("@/api/decisions", () => ({
  decisionsApi: { decide: (id: string) => api.decide(id), dismiss: (id: string) => api.dismiss(id) },
}));
vi.mock("@/api/access", () => ({
  accessApi: { approveJoinRequest: (...args: unknown[]) => api.approveJoin(...(args as [])), rejectJoinRequest: (...args: unknown[]) => api.rejectJoin(...(args as [])) },
}));
vi.mock("@/api/inbox", () => ({ inboxApi: { decideStalledReview: (...args: unknown[]) => api.stalled(...(args as [])) } }));
vi.mock("@/api/interactions", () => ({ interactionsApi: { cancel: (...args: unknown[]) => api.cancel(...(args as [])) } }));
vi.mock("@/api/issues", () => ({
  issuesApi: { get: async (id: string) => ({ id, identifier: id === T1 ? "TRA-45" : "TRA-41", title: "A task", status: "blocked" }), update: vi.fn() },
}));

const { RequestCard } = await import("./RequestCard");

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

const people = { agent: () => undefined, personName: (id: string) => id, youId: () => "me" } as unknown as TaskPeople;
const ctx = { youId: "me", agentName: () => "Builder", personName: (id: string) => id, task: { id: "t1", identifier: "TRA-41", title: "T" } };

function mount(request: Request, taskId = "t1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      <RequestCard request={request} taskId={taskId} people={people} />
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear();
});

const intent = {
  id: "ci1",
  companyId: "co1",
  issueId: "t1",
  kind: "connection_intent",
  status: "pending",
  addresseeUserId: "me",
  createdByAgentId: "a1",
  effectiveResolverPolicy: "human_only",
  createdAt: "2026-10-28T10:00:00Z",
  updatedAt: "2026-10-28T10:00:00Z",
  payload: { version: 1, serviceSlug: "github", serviceName: "GitHub", requestingAgentId: "a1", requestingAgentName: "Builder", phase: "requested" },
} as unknown as ConnectionIntentInteraction;

describe("connection requests", () => {
  it("reuses an existing connection, or declines", async () => {
    api.setupOptions.mockResolvedValue({ version: 1, interaction: intent, service: { methods: [] }, existingConnections: [{ id: "conn1", name: "My GitHub", status: "connected", enabled: true }], requestedAgentId: "a1" });
    mount(requestFromInteraction(intent, ctx));
    const use = await screen.findByRole("button", { name: "Use this connection" });
    // The one connection there is comes picked.
    await waitFor(() => expect((use as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("link", { name: /Set up a new one/ }).getAttribute("href")).toBe("/TRA/apps/connect?source=github");
    fireEvent.click(use);
    await waitFor(() => expect(api.complete).toHaveBeenCalledWith("ci1", "conn1"));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(api.decline).toHaveBeenCalledWith("ci1"));
  });

  it("marks the request authorizing when setup opens in Apps", async () => {
    api.setupOptions.mockResolvedValue({ version: 1, interaction: intent, service: { methods: [] }, existingConnections: [], requestedAgentId: "a1" });
    mount(requestFromInteraction(intent, ctx));
    const connect = await screen.findByRole("link", { name: /Connect GitHub/ });
    expect(connect.getAttribute("target")).toBe("_blank");
    connect.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(connect);
    await waitFor(() => expect(api.setPhase).toHaveBeenCalledWith("ci1", "authorizing"));
  });

  it("grants access to an existing connection's tools", async () => {
    const access = { ...intent, payload: { ...intent.payload, accessRequest: { connectionId: "conn9", connectionName: "Team GitHub", tools: [{ catalogEntryId: "e1", toolName: "github.create_issue", versionHash: "h", permission: "ask_first" }] } } } as ConnectionIntentInteraction;
    api.setupOptions.mockResolvedValue({ version: 1, interaction: access, service: { methods: [] }, existingConnections: [], requestedAgentId: "a1", canGrantAccess: true });
    mount(requestFromInteraction(access, ctx));
    expect(screen.getByText("github.create_issue")).toBeTruthy();
    expect(screen.getByText("Ask first")).toBeTruthy();
    const grant = screen.getByRole("button", { name: "Grant access" });
    await waitFor(() => expect((grant as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(grant);
    await waitFor(() => expect(api.complete).toHaveBeenCalledWith("ci1", "conn9"));
  });

  it("uses one of your AI connections for the agent when its sign-in needs adopting", async () => {
    const ai = { ...intent, payload: { ...intent.payload, purpose: "ai", serviceSlug: "anthropic", serviceName: "Anthropic" } } as ConnectionIntentInteraction;
    api.setupOptions.mockResolvedValue({ version: 1, interaction: ai, service: { methods: [] }, existingConnections: [{ id: "ai1", name: "My Claude", status: "connected", enabled: true }], requestedAgentId: "a1", aiConnectionRequiresAdoption: true });
    mount(requestFromInteraction(ai, ctx));
    const use = await screen.findByRole("button", { name: "Use it for the agent" });
    await waitFor(() => expect((use as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(use);
    await waitFor(() => expect(api.adopt).toHaveBeenCalledWith("co1", "a1", "ci1", "ai1"));
  });
});

const options: DecisionOption[] = [
  {
    id: "start",
    label: "Start now",
    effects: [
      { type: "resolve_blocker", targetIssueId: T1, staleness: "strict", removeBlockedByIssueIds: [T2] },
      { type: "update_issue_status", targetIssueId: T1, staleness: "lenient", status: "todo" },
    ],
  },
  { id: "cancel", label: "Cancel it all", effects: [{ type: "cancel_issue_tree", targetIssueId: T1, staleness: "strict", reasonComment: "Stop" }] },
];
const decision = {
  id: "d1",
  companyId: "co1",
  originAgentId: "a1",
  originIssueId: T1,
  title: "How should we unblock it?",
  body: "",
  options,
  inputs: [{ id: "why", label: "Why", required: true }],
  status: "open",
  executionStatus: null,
  chosenOptionId: null,
  expiresAt: "2026-11-02T10:00:00Z",
  targetSnapshots: { [T1]: { status: "blocked", assigneeAgentId: null, assigneeUserId: null, updatedAt: "2026-10-26T10:00:00Z" } },
  continuationPolicy: "none",
  metadata: {},
  createdAt: "2026-10-26T10:00:00Z",
  updatedAt: "2026-10-26T10:00:00Z",
  executions: [],
} as unknown as DecisionOutcome;

describe("proposals", () => {
  it("previews the picked option's changes, needs the required input, then applies it", async () => {
    mount(requestFromDecision(decision, { ...ctx, task: { id: T1, identifier: "TRA-45", title: "Start ML" } }));
    const apply = screen.getByRole("button", { name: "Pick an option" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Start now/ }));
    const table = screen.getByRole("table", { name: "What option 1 changes" });
    expect(table.textContent).toContain("TRA-45 status");
    expect(table.textContent).toContain("Blocked");
    expect(table.textContent).toContain("Todo");
    const applyOne = screen.getByRole("button", { name: "Apply option 1" });
    expect((applyOne as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(screen.getByRole("textbox", { name: "Why" }), { target: { value: "Data is ready" } });
    fireEvent.click(applyOne);
    await waitFor(() => expect(api.decide).toHaveBeenCalledWith("d1"));
  });

  it("holds back options whose strict changes hit a changed task, and declines", async () => {
    mount(requestFromDecision(decision, ctx, { [T2]: true }));
    expect(screen.getByRole("status").textContent).toMatch(/changed after this was proposed/);
    expect((screen.getByRole("radio", { name: /Start now/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(api.dismiss).toHaveBeenCalledWith("d1"));
  });

  it("asks for the task's identifier before cancelling a tree", async () => {
    mount(requestFromDecision({ ...decision, inputs: null }, ctx));
    fireEvent.click(screen.getByRole("radio", { name: /Cancel it all/ }));
    const cancel = screen.getByRole("button", { name: "Cancel the tree" });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    const confirm = screen.getByRole("textbox", { name: "Type the task's identifier to confirm" });
    await waitFor(() => expect(confirm.getAttribute("placeholder")).toBe("TRA-45"));
    fireEvent.input(confirm, { target: { value: "TRA-45" } });
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("join requests", () => {
  it("shows who's asking and where Paperclip reaches it, then approves or rejects", async () => {
    const join = {
      id: "j1",
      requestType: "agent",
      status: "pending_approval",
      requestIp: "10.0.0.2",
      agentName: "Outside helper",
      adapterType: "openclaw_gateway",
      capabilities: "Drafts summaries.",
      agentDefaultsPayload: { url: "wss://gw.example", headers: { "x-openclaw-token": "secret" } },
      requesterUser: null,
      invite: null,
      createdAt: "2026-10-28T10:00:00Z",
      updatedAt: "2026-10-28T10:00:00Z",
    } as unknown as CompanyJoinRequest;
    mount(requestFromJoin(join, ctx), "");
    expect(screen.getByText("OpenClaw Gateway")).toBeTruthy();
    expect(screen.getByText("wss://gw.example")).toBeTruthy();
    expect(screen.getByText("Drafts summaries.")).toBeTruthy();
    expect(screen.queryByText(/secret/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api.approveJoin).toHaveBeenCalledWith("co1", "j1"));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(api.rejectJoin).toHaveBeenCalledWith("co1", "j1"));
  });
});

describe("stalled reviews, your own questions and budget stops", () => {
  it("decides a stalled review: request changes needs a note", async () => {
    const task = { id: "t9", identifier: "TRA-9", title: "Copy", status: "in_review", executionPolicy: null, executionState: null, assigneeUserId: null, updatedAt: "2026-10-28T10:00:00Z" };
    mount(requestFromReview(task, ctx, { stalled: true }), "t9");
    const changes = screen.getByRole("button", { name: "Request changes" });
    expect((changes as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(screen.getByRole("textbox", { name: "Sign-off note" }), { target: { value: "Tighten it" } });
    fireEvent.click(changes);
    await waitFor(() => expect(api.stalled).toHaveBeenCalledWith("t9", "request_changes", "Tighten it"));
    const approve = screen.getByRole("button", { name: "Approve" });
    await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(approve);
    await waitFor(() => expect(api.stalled).toHaveBeenCalledWith("t9", "approve", undefined));
  });

  it("withdraws a question you asked from the card's menu", async () => {
    const question = {
      id: "q1",
      issueId: "t1",
      kind: "ask_user_questions",
      status: "pending",
      createdByUserId: "me",
      effectiveResolverPolicy: "not_creator",
      createdAt: "2026-10-28T10:00:00Z",
      updatedAt: "2026-10-28T10:00:00Z",
      payload: { version: 1, questions: [{ id: "a", prompt: "Which?", selectionMode: "single", options: [{ id: "x", label: "X" }] }] },
    } as unknown as ConnectionIntentInteraction;
    mount(requestFromInteraction(question, ctx));
    const menu = screen.getByRole("button", { name: "Request actions" });
    fireEvent.pointerDown(menu, { button: 0, pointerType: "mouse" });
    fireEvent.click(menu);
    const item = await screen.findByRole("menuitem", { name: /Withdraw the question/ });
    fireEvent.pointerDown(item, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(item, { button: 0, pointerType: "mouse" });
    fireEvent.click(item);
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith("t1", "q1"));
  });

  it("links a budget stop to the incident in company settings", () => {
    const approval = {
      id: "ap1",
      type: "budget_override_required",
      status: "pending",
      payload: { scopeName: "Frontend Engineer", budgetAmount: 8000, observedAmount: 8025 },
      requestedByAgentId: null,
      requestedByUserId: null,
      createdAt: "2026-10-28T10:00:00Z",
      updatedAt: "2026-10-28T10:00:00Z",
    } as unknown as Parameters<typeof requestFromApproval>[0];
    mount(requestFromApproval(approval, ctx));
    expect(screen.getByRole("link", { name: "Open the budget controls" }).getAttribute("href")).toBe("/TRA/company/settings/budgets#cs-incidents");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
