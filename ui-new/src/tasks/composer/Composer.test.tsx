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
});
