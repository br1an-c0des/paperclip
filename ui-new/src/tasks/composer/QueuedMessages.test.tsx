import type { IssueQueuedCommentEntry, IssueQueuedCommentQueue } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAutoSteer } from "./auto-steer";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetAutoSteer();
});

const interrupt = vi.fn();
const steer = vi.fn();
vi.mock("@/api/queued-comments", () => ({
  queuedCommentsApi: { get: vi.fn(), interrupt: (...args: unknown[]) => interrupt(...args), steer: (...args: unknown[]) => steer(...args) },
}));
vi.mock("@/api/instance-settings", () => ({ instanceSettingsApi: { experimental: async () => ({ enableLegacyComposerSubmit: false }) } }));

const { QueuedMessages } = await import("./QueuedMessages");

const entry = (id: string, position: number): IssueQueuedCommentEntry =>
  ({ comment: { id, body: `Message ${id}` }, position, canEdit: true, canDiscard: true }) as IssueQueuedCommentEntry;

const queue = (extra: Partial<IssueQueuedCommentQueue> = {}): IssueQueuedCommentQueue => ({
  issueId: "t1",
  queueId: "q1",
  state: "queued",
  targetRunId: "r1",
  revision: "rev1",
  protocol: "paperclip_runner_v1",
  steeringDisposition: "available",
  entries: [entry("c1", 0)],
  ...extra,
});

function mount(current: IssueQueuedCommentQueue) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      <QueuedMessages taskId="t1" queue={current} />
    </QueryClientProvider>
  ));
}

describe("QueuedMessages", () => {
  it.each(["unsupported", "temporarily_unavailable"] as const)("offers Interrupt in place of a disabled Steer when steering is %s (#19450)", async (steeringDisposition) => {
    interrupt.mockResolvedValue(queue({ steeringDisposition, entries: [] }));
    mount(queue({ steeringDisposition }));
    expect(screen.queryByRole("button", { name: "Steer now" })).toBeNull();
    const button = screen.getByRole("button", { name: "Interrupt" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(interrupt).toHaveBeenCalledWith("t1", { queueId: "q1", revision: "rev1", targetRunId: "r1" }));
    expect(steer).not.toHaveBeenCalled();
  });

  it("keeps Steer when the runner can take it", () => {
    // Someone else's message: never sent on its own, so it keeps the button.
    mount(queue({ entries: [{ ...entry("c1", 0), canEdit: false }] }));
    expect(screen.getByRole("button", { name: "Steer now" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Interrupt" })).toBeNull();
    expect(screen.queryByText(/Sending in/)).toBeNull();
  });

  it("says a run that's still starting takes the queue into its first turn (#20168)", async () => {
    const starting = queue({
      targetRunId: null,
      state: "deferred",
      executionWait: { reason: "first_turn_pending", message: "The agent is still starting. These messages will be included in its first turn." },
    });
    mount(starting);
    expect(screen.getByText(/The agent is still starting\. These messages will be included in its first turn\./)).toBeTruthy();
    expect(screen.queryByText(/Sending in/)).toBeNull();
  });

  it("offers Send before the previous run starts, and says when the server keeps the messages queued (#19370)", async () => {
    const waiting = queue({ targetRunId: null, state: "deferred" });
    interrupt.mockResolvedValue(waiting);
    mount(waiting);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(interrupt).toHaveBeenCalledWith("t1", { queueId: "q1", revision: "rev1", targetRunId: null }));
    expect(await screen.findByText("Messages are still queued. They'll send when the task is ready.")).toBeTruthy();
    expect(screen.getByText("Message c1")).toBeTruthy();
  });
});

describe("QueuedMessages automatic steering (U84, #19970)", () => {
  const advance = async (ms: number) => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  };
  const mine = () => {
    const at = new Date(Date.now()).toISOString();
    return { ...entry("c1", 0), comment: { id: "c1", body: "Message c1", createdAt: at, updatedAt: at } } as unknown as IssueQueuedCommentEntry;
  };

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-11-09T12:00:00Z"), toFake: ["Date", "setInterval", "clearInterval"] });
  });
  afterEach(() => vi.useRealTimers());

  it("shows Sending in Xs with Edit and Cancel in place of Steer now, then steers it in", async () => {
    steer.mockResolvedValue(queue({ entries: [] }));
    mount(queue({ entries: [mine()] }));
    expect(screen.getByText("Sending in 5s")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Steer now" })).toBeNull();
    await advance(2_100);
    expect(screen.getByText("Sending in 3s")).toBeTruthy();
    expect(steer).not.toHaveBeenCalled();
    await advance(3_000);
    expect(steer).toHaveBeenCalledOnce();
    expect(steer).toHaveBeenCalledWith("t1", "c1", { queueId: "q1", revision: "rev1", targetRunId: "r1" });
  });

  it("Cancel keeps it queued and brings Steer now back", async () => {
    mount(queue({ entries: [mine()] }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Sending in/)).toBeNull();
    expect(screen.getByRole("button", { name: "Steer now" })).toBeTruthy();
    await advance(10_000);
    expect(steer).not.toHaveBeenCalled();
    expect(screen.getByText("Message c1")).toBeTruthy();
  });

  it("Edit stops the countdown while the editor is open", async () => {
    mount(queue({ entries: [mine()] }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Edit queued message" })).toBeTruthy();
    await advance(10_000);
    expect(steer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Sending in 5s")).toBeTruthy();
  });

  it("draws a message as Markdown without its images, with thumbnails and +N (U100, #20367)", () => {
    const body = "Use **this** layout, see [the spec](https://example.com/spec).\n\n" + [1, 2, 3, 4].map((n) => `![Screen ${n}](/api/attachments/a${n}/content)`).join("\n");
    const { container } = mount(queue({ entries: [{ ...entry("c1", 0), canEdit: false, comment: { id: "c1", body } } as IssueQueuedCommentEntry] }));
    const text = container.querySelector(".qm-md")!;
    expect(text.querySelector("strong")?.textContent).toBe("this");
    expect(text.querySelector("a")?.getAttribute("href")).toBe("https://example.com/spec");
    expect(text.textContent).not.toContain("![");
    expect(text.querySelector("img")).toBeNull();
    const thumbs = screen.getByRole("group", { name: "Queued images" });
    expect(Array.from(thumbs.querySelectorAll("img")).map((image) => image.getAttribute("src"))).toEqual(["/api/attachments/a1/content", "/api/attachments/a2/content", "/api/attachments/a3/content"]);
    expect(thumbs.textContent).toContain("+1");
    // The U84 controls stay beside it.
    expect(screen.getByRole("button", { name: "Steer now" })).toBeTruthy();
  });

  it("leaves an inline image out of the row's text", () => {
    const { container } = mount(queue({ entries: [{ ...entry("c1", 0), canEdit: false, comment: { id: "c1", body: "Before ![x](https://example.com/x.png) after" } } as IssueQueuedCommentEntry] }));
    expect(container.querySelector(".qm-md")?.textContent?.replace(/\s+/g, " ").trim()).toBe("Before after");
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a chat message held at the daily limit with why it waits, and nothing to send (U101, #20292)", () => {
    const held = queue({
      queueId: null,
      targetRunId: null,
      state: "deferred",
      steeringDisposition: "unsupported",
      executionWait: { reason: "daily_limit", message: "The agent has reached its daily limit. Your message is saved until work can resume." },
      entries: [{ ...entry("c1", 0), canEdit: false, canDiscard: false }],
    });
    mount(held);
    expect(screen.getByText(/The agent has reached its daily limit\. Your message is saved until work can resume\./)).toBeTruthy();
    expect(screen.getByText("Message c1")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^(Send|Steer now|Interrupt|Edit)$/ })).toBeNull();
    expect((screen.getByRole("button", { name: "More for queued message 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Sending in/)).toBeNull();
  });

  it("leaves a failed attempt queued, says so, and doesn't retry", async () => {
    steer.mockRejectedValue(new Error("rejected"));
    mount(queue({ entries: [mine()] }));
    await advance(5_100);
    await advance(0);
    expect(await screen.findByText("Couldn't steer. The message is still queued.")).toBeTruthy();
    expect(screen.queryByText(/Sending in/)).toBeNull();
    await advance(10_000);
    expect(steer).toHaveBeenCalledOnce();
  });
});
