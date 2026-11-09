import type { IssueQueuedCommentEntry, IssueQueuedCommentQueue } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
    mount(queue());
    expect(screen.getByRole("button", { name: "Steer now" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Interrupt" })).toBeNull();
  });

  it("offers Send before the previous run starts, and says when the server keeps the messages queued (#19370)", async () => {
    const waiting = queue({ targetRunId: null, state: "deferred" });
    interrupt.mockResolvedValue(waiting);
    mount(waiting);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(interrupt).toHaveBeenCalledWith("t1", { queueId: "q1", revision: "rev1", targetRunId: null }));
    expect(await screen.findByText("Messages are still queued. They'll send when the task is ready.")).toBeTruthy();
    expect(screen.getByText("“Message c1”")).toBeTruthy();
  });
});
