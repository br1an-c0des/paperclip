import type { IssueComment } from "@paperclipai/shared";
import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const markRead = vi.fn(async (chatId: string, _through: string) => ({ id: chatId, lastReadAt: "" }));

vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
vi.mock("@/lib/live-events", () => ({ useLiveEvent: () => undefined }));
vi.mock("@/lib/session", () => ({ useSession: () => ({ youId: () => "me" }) }));
vi.mock("@/lib/company-data", () => ({ useExperimentalSettingsQuery: () => ({ data: { enableAgentChat: true } }) }));
vi.mock("@/api/chat", () => ({ chatApi: { list: vi.fn(async () => []), markRead: (chatId: string, through: string) => markRead(chatId, through) } }));

const { useChatReadMarker } = await import("./chat-read");

const agentMessage = (id: string, at: string) =>
  ({ id, createdAt: at, authorAgentId: "a1", authorUserId: null, authorType: "agent", origin: "comment", presentation: null, body: id }) as unknown as IssueComment;

function mount(options: { unread: boolean; atFoot: () => boolean; comments: () => IssueComment[] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(() => (
    <QueryClientProvider client={client}>
      {(() => {
        useChatReadMarker({ chatId: () => "chat1", agentId: () => "a1", unread: () => options.unread, comments: options.comments, ready: () => true, atFoot: options.atFoot });
        return null;
      })()}
    </QueryClientProvider>
  ));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useChatReadMarker", () => {
  beforeEach(() => {
    markRead.mockClear();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  it("marks an unread chat read through its newest agent message once you're at the foot", async () => {
    const [foot, setFoot] = createSignal(false);
    mount({ unread: true, atFoot: foot, comments: () => [agentMessage("c1", "2026-10-27T10:00:00Z"), agentMessage("c2", "2026-10-27T10:05:00Z")] });
    await settle();
    expect(markRead).not.toHaveBeenCalled();
    setFoot(true);
    window.dispatchEvent(new Event("scroll"));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("chat1", "c2"));
  });

  it("leaves a chat that loaded read alone until a new agent message arrives", async () => {
    const [comments, setComments] = createSignal([agentMessage("c1", "2026-10-27T10:00:00Z")]);
    mount({ unread: false, atFoot: () => true, comments });
    await settle();
    expect(markRead).not.toHaveBeenCalled();
    setComments([...comments(), agentMessage("c2", "2026-10-27T10:05:00Z")]);
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("chat1", "c2"));
    expect(markRead).toHaveBeenCalledTimes(1);
  });
});
