import type { Approval, IssueThreadInteraction } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskPeople } from "@/tasks/people";
import { Menu } from "@/ui/Menu";
import { requestFromApproval, requestFromInteraction, requestFromReview, type ReviewTask } from "./request-model";

afterEach(cleanup);

const respond = vi.fn(async () => ({}));
const dismiss = vi.fn(async () => ({}));
const update = vi.fn(async () => ({}));
const reject = vi.fn(async (..._args: unknown[]) => ({}));

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TRA" }) }));
vi.mock("@/api/interactions", () => ({
  interactionsApi: {
    respond: (...args: unknown[]) => respond(...(args as [])),
    dismiss: (...args: unknown[]) => dismiss(...(args as [])),
    reject: (...args: unknown[]) => reject(...args),
  },
}));
vi.mock("@/api/issues", () => ({ issuesApi: { update: (...args: unknown[]) => update(...(args as [])) } }));
const approvals = vi.hoisted(() => ({
  approve: vi.fn(async () => ({})),
  reject: vi.fn(async () => ({})),
  requestRevision: vi.fn(async () => ({})),
  comments: vi.fn(async () => []),
  addComment: vi.fn(async () => ({})),
  cancel: vi.fn(async () => ({})),
}));
vi.mock("@/api/approvals", () => ({ approvalsApi: approvals }));
const toast = vi.hoisted(() => vi.fn((..._args: unknown[]) => null));
vi.mock("@/ui/Toast", async (original) => ({ ...(await original<typeof import("@/ui/Toast")>()), pushToast: toast }));

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

  it("draws a confirmation's prompt as Markdown, with images as references (#18851)", () => {
    const confirm = {
      ...question,
      kind: "request_confirmation",
      payload: {
        version: 1,
        prompt: "Review the [two screenshots](/TRA/issues/TRA-42#document-preview).\n\nSelect **Accept** to keep this design.\n\n- Check `preview.png`\n- Keep the layout\n\n![Review image](https://provider.invalid/review.png)",
      },
    } as unknown as IssueThreadInteraction;
    const { container } = mount(confirm);
    const link = screen.getByRole("link", { name: "two screenshots" });
    expect(link.getAttribute("href")).toBe("/TRA/issues/TRA-42#document-preview");
    const prompt = link.closest(".rq-prompt")!;
    expect(prompt.querySelector("strong")?.textContent).toBe("Accept");
    expect(prompt.querySelector("code")?.textContent).toBe("preview.png");
    expect(prompt.querySelectorAll("li")).toHaveLength(2);
    expect(prompt.querySelector("img")).toBeNull();
    expect(prompt.textContent).toContain("Image: Review image (https://provider.invalid/review.png)");
    expect(prompt.textContent).not.toContain("**");
    // The prompt is the heading, so the plain title isn't drawn twice.
    expect(container.querySelector(".rq h3")).toBeNull();
  });

  it("labels a checkbox group by its rendered prompt, under the agent's own title", () => {
    const pick = {
      ...question,
      kind: "request_checkbox_confirmation",
      title: "Pick the files",
      payload: { version: 1, prompt: "Keep **which** files?", options: [{ id: "o1", label: "a.png" }] },
    } as unknown as IssueThreadInteraction;
    mount(pick);
    expect(screen.getByRole("heading", { name: "Pick the files" })).toBeTruthy();
    const group = screen.getByRole("group", { name: "Keep which files?" });
    expect(group.getAttribute("aria-label")).toBeNull();
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

  it("an approved call waiting on sign-in offers Reconnect <app>, to its permissions page (U99, #20340)", () => {
    mount({
      ...question,
      kind: "request_confirmation",
      status: "accepted",
      resolvedByUserId: "me",
      payload: { version: 1, prompt: "Send the weekly digest?", toolAction: { previewMarkdown: "", expiresAt: null, connectionId: "conn-1", appDisplayName: "Gmail" } },
      result: { version: 1, outcome: "accepted", toolAction: { status: "approved", errorCode: "approved_action_connection_required" } },
    } as unknown as IssueThreadInteraction);
    expect(screen.getByText("You approved · Sign-in needed")).toBeTruthy();
    expect(screen.getByText(/Your approval is saved\. Reconnect the app to continue\./)).toBeTruthy();
    expect(screen.queryByText("Running the call…")).toBeNull();
    expect(screen.getByRole("link", { name: "Reconnect Gmail" }).getAttribute("href")).toBe("/TRA/connections/conn-1/permissions");
  });

  it("links a plan review to the Plan revision it asks about, open or settled (U41)", () => {
    const review = {
      ...question,
      kind: "request_confirmation",
      payload: { version: 1, prompt: "Approve the plan?", acceptLabel: "Approve plan", rejectLabel: "Request changes", target: { type: "issue_document", key: "plan", revisionId: "rev-2", revisionNumber: 2 } },
    } as unknown as IssueThreadInteraction;
    const open = mount(review);
    expect(screen.getByRole("link", { name: "Plan v2" }).getAttribute("href")).toBe("#document-plan&revision=rev-2");
    expect(screen.getByRole("button", { name: "Approve plan" })).toBeTruthy();
    open.unmount();
    mount({ ...review, status: "rejected", resolvedByUserId: "me", result: { version: 1, outcome: "rejected", reason: "Split step 3" } } as unknown as IssueThreadInteraction);
    expect(screen.getByText("You requested changes to Plan v2: Split step 3")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Plan v2" })).toBeTruthy();
  });

  it("asks for a revision note on a plan's Request changes even when the request doesn't (U170, #21721)", async () => {
    const review = {
      ...question,
      kind: "request_confirmation",
      payload: {
        version: 1,
        prompt: "Please review the plan.",
        acceptLabel: "Confirm",
        rejectLabel: "Request changes",
        rejectRequiresReason: false,
        target: { type: "issue_document", issueId: "t1", key: "plan", revisionId: "rev-1", revisionNumber: 1 },
      },
    } as unknown as IssueThreadInteraction;
    mount(review);
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    expect(reject).not.toHaveBeenCalled();
    const note = screen.getByRole("textbox", { name: "What should change?" }) as HTMLInputElement;
    expect(note.placeholder).toBe("What should change? (optional)");
    // Optional: an empty note can still be sent.
    const send = screen.getByRole("button", { name: "Request changes" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.input(note, { target: { value: "Split step 2" } });
    fireEvent.click(send);
    await waitFor(() => expect(reject).toHaveBeenCalledWith("t1", "i1", "Split step 2"));
  });

  it("declines another confirmation at once unless it asks for a note", () => {
    const confirm = { ...question, kind: "request_confirmation", payload: { version: 1, prompt: "Ship it?", rejectLabel: "No" } } as unknown as IssueThreadInteraction;
    const first = mount(confirm);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    first.unmount();
    // A placeholder alone opens the note, as the old UI's card reads it.
    mount({ ...confirm, id: "i2", payload: { version: 1, prompt: "Ship it?", rejectLabel: "No", declineReasonPlaceholder: "What's missing?" } } as unknown as IssueThreadInteraction);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect((screen.getByRole("textbox", { name: "Reason" }) as HTMLInputElement).placeholder).toBe("What's missing?");
  });

  it("links a review request's own document, so the person can open what it asks them to review (U119, #20590)", () => {
    const review = {
      ...question,
      kind: "request_confirmation",
      title: "Review draft",
      payload: { version: 1, prompt: "Review the unpublished draft.", target: { type: "issue_document", key: "draft", revisionId: "draft-revision-1" } },
    } as unknown as IssueThreadInteraction;
    const open = mount(review);
    const link = screen.getByRole("link", { name: "draft" });
    expect(link.getAttribute("href")).toBe("#document-draft&revision=draft-revision-1");
    expect(link.getAttribute("title")).toBe("Open draft");
    open.unmount();
    // The agent's label and the revision, on another task's document: that task's page.
    mount({
      ...review,
      payload: { ...review.payload, target: { type: "issue_document", issueId: "other", key: "design", label: "Design notes", revisionId: "r3", revisionNumber: 3 } },
    } as unknown as IssueThreadInteraction);
    expect(screen.getByRole("link", { name: "Design notes v3" }).getAttribute("href")).toBe("/TRA/issues/other#document-design&revision=r3");
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

describe("RequestCard: a permission request", () => {
  const permission = (extra: Partial<Approval> = {}, payload: Record<string, unknown> = {}) =>
    ({
      id: "ap1",
      companyId: "co1",
      type: "permission_request",
      requestedByAgentId: "a1",
      requestedByUserId: null,
      status: "pending",
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      createdAt: "2026-11-18T12:00:00Z",
      updatedAt: "2026-11-18T12:00:00Z",
      payload: {
        version: 1,
        caller: { kind: "run", agentId: "a1", userId: null, runId: "r1", grantId: null },
        taskId: "t1",
        tool: "paperclip_delete_task",
        arguments: { issueId: "TRA-41" },
        missingAction: "tasks:delete",
        summary: "Delete task TRA-41",
        expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        ...payload,
      },
      ...extra,
    }) as unknown as Approval;

  function mountApproval(approval: Approval) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(() => (
      <QueryClientProvider client={client}>
        <RequestCard request={requestFromApproval(approval, ctx)} taskId="t1" people={people} />
      </QueryClientProvider>
    ));
  }

  it("says who, what and from which task, with the arguments folded", () => {
    mountApproval(permission());
    expect(screen.getByRole("heading", { name: "Delete task TRA-41" })).toBeTruthy();
    expect(screen.getByText("asks for permission")).toBeTruthy();
    expect(screen.getByText("Delete tasks")).toBeTruthy();
    expect(screen.getByText("paperclip_delete_task")).toBeTruthy();
    expect(screen.getByText("1 argument").closest("details")?.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Issue id")).toBeTruthy();
    expect(screen.getByRole("link", { name: /TRA-41/ }).getAttribute("href")).toBe("/TRA/issues/TRA-41");
    expect(screen.queryByRole("button", { name: "Request changes" })).toBeNull();
    expect(screen.queryByText("Through")).toBeNull();
  });

  it("names the outside connection a call came through", () => {
    mountApproval(permission({}, { caller: { kind: "oauth_agent", agentId: "a1", userId: null, runId: null, grantId: "g1" }, connectionName: "Claude Code" }));
    expect(screen.getByText("Through")).toBeTruthy();
    expect(screen.getByText("Claude Code")).toBeTruthy();
    expect(screen.getByText("Quant Researcher via Claude Code")).toBeTruthy();
  });

  it("approves, approves and always allows, or denies", async () => {
    mountApproval(permission());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approvals.approve).toHaveBeenLastCalledWith("ap1", undefined));
    fireEvent.click(screen.getByRole("button", { name: "Approve and always allow" }));
    await waitFor(() => expect(approvals.approve).toHaveBeenLastCalledWith("ap1", undefined, { alwaysAllow: true }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(approvals.reject).toHaveBeenCalledWith("ap1", undefined));
  });

  it("can't be approved once it has expired, only denied", () => {
    mountApproval(permission({}, { expiresAt: "2026-01-01T00:00:00Z" }));
    expect(screen.getByText("Expired: approving can't run it now.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Approve and always allow" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Deny" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says at once when an approved request was refused as it ran", async () => {
    const pending = permission();
    approvals.approve.mockResolvedValueOnce({
      ...pending,
      status: "approved",
      payload: { ...pending.payload, result: { status: "refused", detail: "Issue cannot be deleted", at: "2026-11-18T13:00:01Z" } },
    } as never);
    mountApproval(pending);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ tone: "error", title: "Approved, but it didn't run", body: "Refused when it ran: Issue cannot be deleted" }),
    );
  });

  it("shows what the replay did once decided", () => {
    mountApproval(permission({ status: "approved", decidedByUserId: "me", decidedAt: "2026-11-18T13:00:00Z" } as unknown as Partial<Approval>, { result: { status: "refused", detail: "The task is locked by another run", at: "2026-11-18T13:00:01Z" } }));
    expect(screen.getByText("Refused when it ran: The task is locked by another run")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
