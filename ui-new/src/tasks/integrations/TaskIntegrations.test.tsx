import { createMemoryHistory, MemoryRouter, Route } from "@solidjs/router";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Let an open dialog's focus trap finish its first tick before the page is taken down.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  cleanup();
});

// The live view is another origin's page, whose document a real browser doesn't expose; jsdom
// gives it a bodiless one, which the dialog's focus trap can't search.
Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", { configurable: true, get: () => null });

const chat = vi.hoisted(() => ({ issueBinding: vi.fn(), publishBoardMessage: vi.fn(), publicationStatus: vi.fn() }));
const email = vi.hoisted(() => ({ thread: vi.fn(), resolve: vi.fn(), control: vi.fn() }));
const browsers = vi.hoisted(() => ({
  list: vi.fn(),
  viewer: vi.fn(),
  presence: vi.fn(),
  control: vi.fn(),
  resize: vi.fn(),
  releaseViewport: vi.fn(),
}));
const flags = vi.hoisted(() => ({ value: { enableChatConnectors: true } as Record<string, boolean> }));

vi.mock("@/api/chat-endpoints", () => ({ chatEndpointsApi: chat }));
vi.mock("./board-send", async (original) => ({ ...(await original<typeof import("./board-send")>()), publishBoardMessage: chat.publishBoardMessage }));
const issues = vi.hoisted(() => ({ listAttachments: vi.fn(), uploadAttachment: vi.fn() }));
vi.mock("@/api/issues", () => ({ issuesApi: issues }));
vi.mock("@/api/email", () => ({ emailApi: email }));
vi.mock("@/api/browser-use", () => ({ browserUseApi: browsers }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
vi.mock("@/lib/company-data", () => ({ useExperimentalSettingsQuery: () => ({ data: flags.value }) }));

const { TaskIntegrations } = await import("./TaskIntegrations");

function renderTask(taskId = "task-1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const history = createMemoryHistory();
  history.set({ value: "/TES/tasks/TES-1" });
  render(() => (
    <QueryClientProvider client={client}>
      <MemoryRouter history={history} root={() => <TaskIntegrations taskId={taskId} />}>
        <Route path="*" component={() => null} />
      </MemoryRouter>
    </QueryClientProvider>
  ));
}

const binding = {
  endpointId: "e1",
  provider: "slack",
  botLabel: "Ada",
  externalLabel: "#launch",
  externalUrl: "https://slack.test/archives/C1",
  conversationId: "conv-1",
  assignedAgentLocked: true,
};

const thread = {
  conversationId: "c1",
  issueId: "task-1",
  subject: "Invoice 42",
  endpoint: { id: "inbox-1", companyId: "co1", connectionId: "x", assignedAgentId: "a1", address: "ada@agentmail.to", status: "active", receiveMode: "websocket", lastError: null, lastSyncAt: null },
  messages: [
    {
      id: "m1",
      providerMessageId: "pm-1",
      direction: "inbound",
      from: "client@example.com",
      to: ["ada@agentmail.to"],
      subject: "Invoice 42",
      text: "Can you send the invoice?",
      fullText: "Can you send the invoice?",
      commentId: "k1",
      attachmentIds: [],
      timestamp: "2026-10-28T10:00:00Z",
      automatic: false,
    },
  ],
  publications: [
    { id: "p2", issueId: "task-1", conversationId: "c1", outcome: "uncertain", error: null, providerMessageId: null, request: { subject: "Re: Invoice 42", text: "Attached." } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  flags.value = { enableChatConnectors: true };
  chat.issueBinding.mockResolvedValue(null);
  email.thread.mockResolvedValue(null);
  browsers.list.mockResolvedValue([]);
});

describe("TaskIntegrations", () => {
  it("shows nothing for an ordinary task", async () => {
    renderTask();
    await waitFor(() => expect(browsers.list).toHaveBeenCalled());
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByText(/Connected to/)).toBeNull();
  });

  it("doesn't ask for a chat conversation while chat connectors are off", async () => {
    flags.value = {};
    chat.issueBinding.mockResolvedValue(binding);
    renderTask();
    await waitFor(() => expect(email.thread).toHaveBeenCalled());
    expect(chat.issueBinding).not.toHaveBeenCalled();
    expect(screen.queryByText(/Connected to/)).toBeNull();
  });

  it("skips the assistant's chat tasks", () => {
    renderTask("chat:abc");
    expect(email.thread).not.toHaveBeenCalled();
    expect(browsers.list).not.toHaveBeenCalled();
  });

  it("sends a board message to the bound conversation and keeps one key for the send", async () => {
    sessionStorage.clear();
    issues.listAttachments.mockResolvedValue([]);
    chat.issueBinding.mockResolvedValue(binding);
    chat.publishBoardMessage.mockResolvedValue({ id: "pub-1", state: "pending", attempts: 0 });
    chat.publicationStatus.mockResolvedValue({ publication: { id: "pub-1", state: "pending", attempts: 1 }, total: 1, published: 0 });
    renderTask();

    expect(await screen.findByText("Connected to Slack")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open in Slack/ }).getAttribute("href")).toBe("https://slack.test/archives/C1");
    expect(screen.getByRole("link", { name: "Activity" }).getAttribute("href")).toBe("/TES/apps/chat/e1/activity");

    fireEvent.click(screen.getByRole("button", { name: "Send to Slack" }));
    fireEvent.input(screen.getByLabelText("Message to Slack"), { target: { value: "Shipping today" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(chat.publishBoardMessage).toHaveBeenCalledTimes(1));
    const [endpointId, conversationId, input] = chat.publishBoardMessage.mock.calls[0]!;
    expect([endpointId, conversationId, input.body, input.attachmentIds]).toEqual(["e1", "conv-1", "Shipping today", []]);
    expect(input.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    // Kept before it went, so a reload finishes this send instead of making another.
    const keptKey = Object.keys(sessionStorage).find((key) => key.startsWith("ui-new:board-send:"))!;
    expect(JSON.parse(sessionStorage.getItem(keptKey)!).idempotencyKey).toBe(input.idempotencyKey);
    expect(await screen.findByText("Queued")).toBeTruthy();
    expect((screen.getByLabelText("Message to Slack") as HTMLTextAreaElement).disabled).toBe(true);

    chat.publicationStatus.mockResolvedValue({ publication: { id: "pub-1", state: "published", attempts: 1 }, total: 1, published: 1 });
    await waitFor(() => expect(screen.queryByLabelText("Message to Slack")).toBeNull(), { timeout: 4000 });
    expect(sessionStorage.getItem(keptKey)).toBeNull();
  });

  it("brings back an unconfirmed send after a reload and repeats it with the same key, files and all", async () => {
    sessionStorage.clear();
    sessionStorage.setItem(
      'ui-new:board-send:v1:["co1","task-1","e1","conv-1"]',
      JSON.stringify({
        body: "Kept from before",
        attachmentIds: ["a1"],
        attachmentNames: [{ id: "a1", name: "plan.pdf" }],
        idempotencyKey: "11111111-2222-4333-8444-555555555555",
        publication: null,
      }),
    );
    issues.listAttachments.mockResolvedValue([]);
    chat.issueBinding.mockResolvedValue(binding);
    chat.publishBoardMessage.mockReset();
    chat.publishBoardMessage.mockResolvedValue({ id: "pub-2", state: "published", attempts: 1 });
    renderTask();

    expect(await screen.findByText(/wasn't confirmed before the page closed/)).toBeTruthy();
    expect((screen.getByLabelText("Message to Slack") as HTMLTextAreaElement).value).toBe("Kept from before");
    expect(screen.getByText("plan.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    await waitFor(() => expect(chat.publishBoardMessage).toHaveBeenCalledTimes(1));
    expect(chat.publishBoardMessage.mock.calls[0]![2]).toEqual({
      body: "Kept from before",
      idempotencyKey: "11111111-2222-4333-8444-555555555555",
      attachmentIds: ["a1"],
    });
    await waitFor(() => expect(sessionStorage.length).toBe(0));
  });

  it("opens an email thread and records an uncertain delivery without resending", async () => {
    email.thread.mockResolvedValue(thread);
    email.resolve.mockResolvedValue({ ...thread.publications[0], outcome: "sent", providerMessageId: "msg-9" });
    renderTask();

    expect(await screen.findByText("Invoice 42")).toBeTruthy();
    expect(screen.getByText(/1 message · ada@agentmail.to · 1 send needs checking/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    expect(await screen.findByText("Can you send the invoice?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause inbox" })).toBeTruthy();

    const send = screen.getByRole("button", { name: "It was sent" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.input(screen.getByLabelText("AgentMail message id"), { target: { value: "msg-9" } });
    fireEvent.click(send);
    await waitFor(() => expect(email.resolve).toHaveBeenCalledWith("co1", "p2", "sent", "msg-9"));
  });

  it("pauses the thread's inbox", async () => {
    email.thread.mockResolvedValue(thread);
    email.control.mockResolvedValue({ ...thread.endpoint, status: "paused" });
    renderTask();
    fireEvent.click(await screen.findByRole("button", { name: "Open thread" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pause inbox" }));
    await waitFor(() => expect(email.control).toHaveBeenCalledWith("inbox-1", "pause"));
  });

  it("shows an open browser and its live view", async () => {
    browsers.list.mockResolvedValue([
      { id: "b1", sessionId: "s1", issueId: "task-1", status: "running", runStatus: null, progress: "Reading docs", costCents: 12, idleDeadline: null, expiresAt: null, error: null, createdAt: "2026-10-28T10:00:00Z" },
    ]);
    browsers.viewer.mockResolvedValue({ url: "https://live.browser-use.test/v?token=x", viewport: "fit" });
    browsers.releaseViewport.mockResolvedValue({});
    browsers.control.mockResolvedValue({});
    renderTask();

    expect(await screen.findByText("The agent is browsing")).toBeTruthy();
    expect(screen.getByText("Reading docs · $0.12")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Watch" }));

    const frame = await waitFor(() => {
      const found = document.querySelector<HTMLIFrameElement>("iframe[title='Live browser']");
      if (!found) throw new Error("no live view yet");
      return found;
    });
    expect(frame.getAttribute("src")).toBe("https://live.browser-use.test/v?token=x");
    expect(browsers.viewer).toHaveBeenCalledWith("task-1", "b1", expect.stringMatching(/^[0-9a-f-]{36}$/), expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(browsers.control).toHaveBeenCalledWith("task-1", "b1", "cancel"));
  });
});
