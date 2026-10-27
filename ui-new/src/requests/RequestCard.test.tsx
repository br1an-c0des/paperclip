import type { IssueThreadInteraction } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskPeople } from "@/tasks/people";
import { Menu } from "@/ui/Menu";
import { requestFromInteraction, requestFromReview, type ReviewTask } from "./request-model";

afterEach(cleanup);

const respond = vi.fn(async () => ({}));
const dismiss = vi.fn(async () => ({}));
const update = vi.fn(async () => ({}));

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TRA" }) }));
vi.mock("@/api/interactions", () => ({ interactionsApi: { respond: (...args: unknown[]) => respond(...(args as [])), dismiss: (...args: unknown[]) => dismiss(...(args as [])) } }));
vi.mock("@/api/issues", () => ({ issuesApi: { update: (...args: unknown[]) => update(...(args as [])) } }));

const { RequestCard } = await import("./RequestCard");

const people = {
  agent: () => undefined,
  personName: (id: string) => id,
  youId: () => "me",
} as unknown as TaskPeople;

const question = {
  id: "i1",
  issueId: "t1",
  kind: "ask_user_questions",
  status: "pending",
  createdByAgentId: "a1",
  effectiveResolverPolicy: "anyone",
  createdAt: "2026-10-26T11:00:00Z",
  updatedAt: "2026-10-26T11:00:00Z",
  payload: {
    version: 1,
    questions: [{ id: "q1", prompt: "How far back?", selectionMode: "single", required: true, options: [{ id: "o1", label: "From 2022" }, { id: "o2", label: "From 2024" }] }],
  },
} as unknown as IssueThreadInteraction;

const ctx = { youId: "me", agentName: () => "Quant Researcher", personName: (id: string) => id, task: { id: "t1", identifier: "TRA-41", title: "T" } };

function mount(interaction: IssueThreadInteraction) {
  const client = new QueryClient();
  return render(() => (
    <QueryClientProvider client={client}>
      <RequestCard request={requestFromInteraction(interaction, ctx)} taskId="t1" people={people} inThread />
    </QueryClientProvider>
  ));
}

describe("RequestCard", () => {
  it("answers a question with the picked option", async () => {
    mount(question);
    expect(screen.getByRole("heading", { name: "How far back?" })).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send answer" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "From 2024" }));
    fireEvent.click(send);
    await waitFor(() => expect(respond).toHaveBeenCalledWith("t1", "i1", { answers: [{ questionId: "q1", optionIds: ["o2"], otherText: null }] }));
  });

  it("shrinks a set-aside request to one line that opens again", () => {
    mount({ ...question, dismissedAt: "2026-10-26T11:30:00Z" } as IssueThreadInteraction);
    expect(screen.queryByRole("heading")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("heading", { name: "How far back?" })).toBeTruthy();
  });

  it("collapses a settled request to the ask and its outcome", () => {
    mount({ ...question, status: "answered", resolvedByUserId: "me", result: { version: 1, answers: [{ questionId: "q1", optionIds: ["o1"] }] } } as unknown as IssueThreadInteraction);
    expect(screen.getByText("You answered From 2022")).toBeTruthy();
    expect(screen.getByText("Sent to Quant Researcher")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
  });

  it("adds the page's triage to its menu, draws the context column and opens the subject in place", async () => {
    const client = new QueryClient();
    const onOpen = vi.fn();
    const onSettled = vi.fn();
    const snooze = vi.fn();
    render(() => (
      <QueryClientProvider client={client}>
        <RequestCard
          request={requestFromInteraction(question, ctx)}
          taskId="t1"
          people={people}
          triage={() => <Menu.Item onSelect={snooze}>Snooze</Menu.Item>}
          aside={<p>About TRA-41</p>}
          onOpenSubject={onOpen}
          onSettled={onSettled}
        />
      </QueryClientProvider>
    ));
    const subject = screen.getByRole("link", { name: "TRA-41 T" });
    expect(subject.getAttribute("href")).toBe("/TRA/issues/TRA-41");
    fireEvent.click(subject);
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByRole("complementary", { name: "Context" }).textContent).toBe("About TRA-41");

    // One "…" menu in the top row, with the card's own items and then the page's.
    const menus = screen.getAllByRole("button", { name: "Request actions" });
    expect(menus).toHaveLength(1);
    fireEvent.pointerDown(menus[0]!, { button: 0, pointerType: "mouse" });
    fireEvent.click(menus[0]!);
    expect(await screen.findByRole("menuitem", { name: /Set aside/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Snooze" })).toBeTruthy();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("radio", { name: "From 2022" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
  });

  it("signs off a review with the note the server asks for", async () => {
    const client = new QueryClient();
    const task = {
      id: "t1",
      identifier: "TRA-44",
      title: "Sweep",
      status: "in_review",
      updatedAt: "2026-10-26T11:00:00Z",
      executionPolicy: { stages: [{ id: "s1", type: "review", participants: [{ type: "user", userId: "me", agentId: null }] }] },
      executionState: {
        status: "pending",
        currentStageId: "s1",
        currentStageIndex: 0,
        currentStageType: "review",
        currentParticipant: { type: "user", userId: "me", agentId: null },
        returnAssignee: { type: "agent", agentId: "a1", userId: null },
        reviewRequest: null,
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
      },
    } as unknown as ReviewTask;
    render(() => (
      <QueryClientProvider client={client}>
        <RequestCard request={requestFromReview(task, ctx)} taskId="t1" people={people} />
      </QueryClientProvider>
    ));
    expect(screen.getByText("Review · you")).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.input(screen.getByRole("textbox", { name: "Sign-off note" }), { target: { value: "Checked the backtest" } });
    fireEvent.click(approve);
    await waitFor(() => expect(update).toHaveBeenCalledWith("t1", { status: "done", comment: "Checked the backtest" }));
    expect(screen.getByRole("link", { name: "Open the task" }).getAttribute("href")).toBe("/TRA/issues/TRA-44");
  });
});
