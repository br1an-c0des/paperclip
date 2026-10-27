import type { IssueThreadInteraction } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskPeople } from "@/tasks/people";
import { requestFromInteraction } from "./request-model";

afterEach(cleanup);

const respond = vi.fn(async () => ({}));
const dismiss = vi.fn(async () => ({}));

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TRA" }) }));
vi.mock("@/api/interactions", () => ({ interactionsApi: { respond: (...args: unknown[]) => respond(...(args as [])), dismiss: (...args: unknown[]) => dismiss(...(args as [])) } }));

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
});
