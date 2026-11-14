import type { IssueThreadInteraction, PaperclipQuestionSetPayload } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskPeople } from "@/tasks/people";
import { requestFromInteraction } from "./request-model";

/*
 * An app's form question (MCP elicitation, U155, upstream #21466), as the server makes it: the
 * question set below is upstream's fixture (ui/src/fixtures/mcpElicitationFixtures.ts, the server
 * mapper's exact output), stored beside its legacy projection.
 */

afterEach(cleanup);

const respond = vi.fn(async () => ({}));
const skip = vi.fn(async () => ({}));

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
vi.mock("@/api/interactions", () => ({
  interactionsApi: { respond: (...args: unknown[]) => respond(...(args as [])), skip: (...args: unknown[]) => skip(...(args as [])), dismiss: vi.fn() },
}));
vi.mock("@/api/issues", () => ({ issuesApi: { update: vi.fn() } }));

const { RequestCard } = await import("./RequestCard");

beforeEach(() => {
  respond.mockClear();
  skip.mockClear();
});

const people = { agent: () => undefined, personName: (id: string) => id, youId: () => "me" } as unknown as TaskPeople;

const ticket: PaperclipQuestionSetPayload = {
  schema: "paperclip.question_set.v1",
  title: "Linear needs your input",
  description: "Linear needs a few details to file this ticket.",
  submitLabel: "Send to Linear",
  questions: [
    { id: "title", prompt: "Ticket title", required: true, answerMode: "text", initialText: "Login button does nothing", textValidation: { minLength: 3, maxLength: 80 } },
    {
      id: "priority",
      prompt: "Priority",
      required: true,
      answerMode: "single_select",
      options: [{ id: "choice_1", label: "Urgent" }, { id: "choice_2", label: "Normal", recommended: true }, { id: "choice_3", label: "Later" }],
    },
    {
      id: "labels",
      prompt: "Labels",
      required: false,
      helpText: "Choose at most 2.",
      answerMode: "multi_select",
      options: [{ id: "choice_1", label: "Bug", recommended: true }, { id: "choice_2", label: "Design" }, { id: "choice_3", label: "Speed" }],
    },
    { id: "page", prompt: "Page the on-call engineer?", required: false, answerMode: "single_select", options: [{ id: "choice_1", label: "Yes" }, { id: "choice_2", label: "No", recommended: true }] },
    { id: "estimate", prompt: "Estimate (points)", required: false, answerMode: "text", textValidation: { inputType: "integer", minimum: 1, maximum: 8 } },
  ],
};

/** The legacy questions the server stores beside the set (shared `questionSetToAskUserQuestionsPayload`). */
function legacy(set: PaperclipQuestionSetPayload) {
  return set.questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    ...(question.helpText ? { helpText: question.helpText } : {}),
    selectionMode: question.answerMode === "multi_select" ? "multi" : "single",
    required: question.required,
    allowOther: question.answerMode === "text",
    options: [
      ...(question.options ?? []).map(({ id, label }) => ({ id, label })),
      ...(question.answerMode === "text" ? [{ id: "paperclip_text_answer", label: "Type an answer", freeText: true }] : []),
    ],
  }));
}

function card(set: PaperclipQuestionSetPayload, extra: Record<string, unknown> = {}) {
  return {
    id: "i1",
    issueId: "t1",
    kind: "ask_user_questions",
    idempotencyKey: "mcp-elicit:round-1:0",
    title: set.title,
    summary: set.description,
    status: "pending",
    createdByAgentId: "a1",
    resolverPolicy: "human_only",
    effectiveResolverPolicy: "human_only",
    continuationPolicy: "wake_assignee",
    createdAt: "2026-11-13T15:02:00Z",
    updatedAt: "2026-11-13T15:02:00Z",
    payload: { version: 1, title: set.title, submitLabel: set.submitLabel, supersedeOnUserComment: false, questionSet: set, questions: legacy(set) },
    ...extra,
  } as unknown as IssueThreadInteraction;
}

const ctx = { youId: "me", agentName: () => "Codex", personName: (id: string) => id, task: { id: "t1", identifier: "TES-9", title: "File the bug" } };

function mount(interaction: IssueThreadInteraction) {
  return render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <RequestCard request={requestFromInteraction(interaction, ctx)} taskId="t1" people={people} inThread />
    </QueryClientProvider>
  ));
}

describe("an app's form question (U155, #21466)", () => {
  it("names the app, says only people answer, and draws every field", () => {
    mount(card(ticket));
    expect(screen.getByRole("heading", { name: "Linear needs your input" })).toBeTruthy();
    expect(screen.getByText("Linear needs a few details to file this ticket.")).toBeTruthy();
    expect(screen.getByText("passes on a question from Linear")).toBeTruthy();
    expect(screen.getByText("People only")).toBeTruthy();
    expect(screen.getByText(/Your answer goes to Linear when Codex tries again/)).toBeTruthy();
    // Text starts with the app's default, as a draft.
    expect((screen.getByRole("textbox", { name: /Ticket title/ }) as HTMLInputElement).value).toBe("Login button does nothing");
    // Choices, yes/no and the app's defaults marked.
    expect(screen.getByRole("radiogroup", { name: /Priority/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Normal.*Recommended/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bug.*Recommended/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Yes" })).toBeTruthy();
    expect(screen.getByText("Choose at most 2.")).toBeTruthy();
    // A whole number in a range opens the number keyboard.
    expect(screen.getByRole("textbox", { name: /Estimate/ }).getAttribute("inputmode")).toBe("numeric");
    // The placeholder option of a written answer isn't drawn.
    expect(screen.queryByText("Type an answer")).toBeNull();
    expect(screen.getByRole("button", { name: "Send to Linear" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip" })).toBeTruthy();
  });

  it("checks the answers before sending and marks what needs attention", async () => {
    mount(card(ticket));
    fireEvent.input(screen.getByRole("textbox", { name: /Ticket title/ }), { target: { value: "ab" } });
    fireEvent.input(screen.getByRole("textbox", { name: /Estimate/ }), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Linear" }));
    expect(screen.getByRole("alert").textContent).toBe("3 answers need attention.");
    expect(screen.getByText("Enter at least 3 characters.")).toBeTruthy();
    expect(screen.getByText("This question needs an answer.")).toBeTruthy();
    expect(screen.getByText("Enter 8 or less.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: /Ticket title/ }).getAttribute("aria-invalid")).toBe("true");
    expect(respond).not.toHaveBeenCalled();
  });

  it("sends typed answers to the card in the stored contract", async () => {
    mount(card(ticket));
    fireEvent.input(screen.getByRole("textbox", { name: /Ticket title/ }), { target: { value: "Login button does nothing on Safari" } });
    fireEvent.click(screen.getByRole("radio", { name: "Urgent" }));
    fireEvent.click(screen.getByRole("button", { name: /Bug/ }));
    fireEvent.click(screen.getByRole("button", { name: "Speed" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: /on-call/ })).getByRole("radio", { name: /^No/ }));
    fireEvent.input(screen.getByRole("textbox", { name: /Estimate/ }), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to Linear" }));
    await waitFor(() =>
      expect(respond).toHaveBeenCalledWith("t1", "i1", {
        answers: [
          { questionId: "title", optionIds: [], otherText: "Login button does nothing on Safari" },
          { questionId: "priority", optionIds: ["choice_1"] },
          { questionId: "labels", optionIds: ["choice_1", "choice_3"] },
          { questionId: "page", optionIds: ["choice_2"] },
          { questionId: "estimate", optionIds: [], otherText: "3" },
        ],
      }),
    );
  });

  it("skips the question, which declines it", async () => {
    mount(card(ticket));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(skip).toHaveBeenCalledWith("t1", "i1"));
  });

  it("offers no Skip button on a question set that isn't from an app", () => {
    mount(card(ticket, { idempotencyKey: null, title: "A few details" }));
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send to Linear" })).toBeTruthy();
  });

  it("settles as answered, skipped or ended, naming the app", () => {
    const answered = mount(
      card(ticket, {
        status: "answered",
        resolvedByUserId: "me",
        resolvedAt: "2026-11-13T15:06:00Z",
        result: {
          version: 1,
          answers: [
            { questionId: "title", optionIds: ["paperclip_text_answer"], otherText: "Login button does nothing on Safari" },
            { questionId: "priority", optionIds: ["choice_1"] },
            { questionId: "labels", optionIds: ["choice_1", "choice_3"] },
          ],
        },
      }),
    );
    expect(screen.getByText("You answered Login button does nothing on Safari, Urgent, Bug, Speed")).toBeTruthy();
    expect(screen.getByText("Sent to Linear")).toBeTruthy();
    answered.unmount();

    const skipped = mount(card(ticket, { status: "cancelled", resolvedByUserId: "me", result: { version: 1, answers: [], outcome: "skipped" } }));
    expect(screen.getByText("You skipped it")).toBeTruthy();
    expect(screen.getByText("Linear is told you declined")).toBeTruthy();
    skipped.unmount();

    mount(card(ticket, { status: "cancelled", resolvedByAgentId: "a1", result: { version: 1, answers: [], outcome: "withdrawn", reason: "The app's question expired before it was answered." } }));
    expect(screen.getByText("Ended without an answer")).toBeTruthy();
    expect(screen.getByText("The app's question expired before it was answered.")).toBeTruthy();
  });
});
