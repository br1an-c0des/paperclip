import type { Issue } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const post = vi.fn(async (_id: string, data: { body: string }) => ({ id: "c-new", body: data.body }));

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TRA" }) }));
vi.mock("@/api/comments", () => ({ commentsApi: { post: (id: string, data: { body: string }) => post(id, data), updateWithComment: vi.fn() } }));
vi.mock("@/api/issues", () => ({ issuesApi: { search: vi.fn(async () => []), update: vi.fn(), uploadAttachment: vi.fn() } }));
vi.mock("@/api/queued-comments", () => ({ queuedCommentsApi: { get: vi.fn() } }));
vi.mock("@/api/agents", () => ({ agentsApi: { adapterModels: vi.fn(async () => []) } }));
let goalAvailability: "available" | "unsupported" = "unsupported";
const goalProjection = () => ({
  issueId: "t1",
  agentId: "a1",
  adapterType: "paperclip_runner",
  sessionId: null,
  capability: { availability: goalAvailability, actions: ["set", "pause", "resume", "clear"], autonomousUpdates: true, persistentAcrossResume: true, maxObjectiveChars: 4000, tokenBudgetControl: false, usageReporting: false, reason: goalAvailability === "available" ? null : "Unsupported here." },
  goal: null,
  workingNow: false,
  activeRunId: null,
  pendingAction: null,
  revision: 2,
  observedAt: null,
});
const actOnGoal = vi.fn(async (_taskId: string, request: { objective?: string }) => ({
  requestId: "r",
  status: "accepted",
  projection: { ...goalProjection(), revision: 3, goal: { objective: request.objective, status: "active", tokenBudget: null, tokensUsed: 0, elapsedSeconds: 0, iterations: 0, lastReason: null, createdAt: null, updatedAt: null, completedAt: null, workingNow: true } },
}));
vi.mock("@/api/runner-goal", () => ({ runnerGoalApi: { get: vi.fn(async () => goalProjection()), act: (taskId: string, request: { objective?: string }) => actOnGoal(taskId, request) } }));
vi.mock("../people", () => {
  const agent = { id: "a1", name: "Quant Researcher", adapterType: "http", adapterConfig: {}, status: "idle" };
  return {
    useTaskPeople: () => ({
      agent: (id: string | null | undefined) => (id === "a1" ? agent : undefined),
      assignableAgents: () => [agent],
      otherPeople: () => [{ id: "u2", name: "Sam K." }],
      personName: (id: string) => (id === "u2" ? "Sam K." : id),
      youId: () => "me",
      liveIssueIds: () => new Set(),
    }),
  };
});

const { Composer } = await import("./Composer");

const task = { id: "t1", identifier: "TRA-1", status: "in_progress", workMode: "standard", assigneeAgentId: "a1", assigneeUserId: null, assigneeAdapterOverrides: null } as unknown as Issue;

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      <Composer task={task} />
    </QueryClientProvider>
  ));
}

describe("Composer", () => {
  beforeEach(() => {
    post.mockClear();
    actOnGoal.mockClear();
    goalAvailability = "unsupported";
    localStorage.clear();
  });

  it("offers mentions as you type @ and inserts the picked one", async () => {
    mount();
    const box = screen.getByRole("combobox", { name: "Comment" }) as HTMLTextAreaElement;
    box.value = "Ask @qua";
    box.setSelectionRange(8, 8);
    fireEvent.input(box);
    const option = await screen.findByRole("option", { name: /Quant Researcher/ });
    fireEvent.click(option);
    await waitFor(() => expect(box.value).toBe("Ask [@Quant Researcher](agent://a1) "));
  });

  it("sends with Ctrl+Enter, then clears the box", async () => {
    mount();
    const box = screen.getByRole("combobox", { name: "Comment" }) as HTMLTextAreaElement;
    box.value = "Ship it";
    fireEvent.input(box);
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(post).toHaveBeenCalledWith("t1", expect.objectContaining({ body: "Ship it" })));
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("says what's missing instead of sending an empty message", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Write a message first.");
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps a draft per task", async () => {
    const first = mount();
    const box = screen.getByRole("combobox", { name: "Comment" }) as HTMLTextAreaElement;
    box.value = "Half written";
    fireEvent.input(box);
    first.unmount();
    mount();
    expect((screen.getByRole("combobox", { name: "Comment" }) as HTMLTextAreaElement).value).toBe("Half written");
  });

  it("offers no Goal pill when the agent's runner doesn't support goals", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /^Goal/ })).toBeNull();
  });

  it("sets a goal with the Goal pill instead of sending a message, and shows its card", async () => {
    goalAvailability = "available";
    mount();
    const pill = await screen.findByRole("button", { name: "Goal" });
    fireEvent.click(pill);
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    const box = screen.getByRole("combobox", { name: "Comment" }) as HTMLTextAreaElement;
    box.value = "Keep the tests green";
    fireEvent.input(box);
    fireEvent.click(screen.getByRole("button", { name: "Set goal" }));
    await waitFor(() => expect(actOnGoal).toHaveBeenCalledWith("t1", expect.objectContaining({ action: "create", objective: "Keep the tests green", agentId: "a1", expectedRevision: 2 })));
    expect(post).not.toHaveBeenCalled();
    const card = await screen.findByRole("region", { name: "Goal" });
    expect(card.textContent).toContain("Keep the tests green");
    expect(card.textContent).toContain("Pursuing");
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("reads /goal typed in the message", async () => {
    goalAvailability = "available";
    mount();
    await screen.findByRole("button", { name: "Goal" });
    const box = screen.getByRole("combobox", { name: "Comment" }) as HTMLTextAreaElement;
    box.value = "/goal Ship the release";
    fireEvent.input(box);
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(actOnGoal).toHaveBeenCalledWith("t1", expect.objectContaining({ action: "create", objective: "Ship the release" })));
  });
});
