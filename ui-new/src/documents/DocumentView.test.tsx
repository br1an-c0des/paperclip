import type { IssueDocument } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { documentsApi } from "@/api/documents";
import { DocumentView } from "./DocumentView";
import type { DocumentHost } from "./host";

vi.mock("@/api/documents", () => ({
  documentsApi: {
    get: vi.fn(),
    upsert: vi.fn(),
    lock: vi.fn(),
    unlock: vi.fn(),
    remove: vi.fn(),
    revisions: vi.fn(async () => []),
    restore: vi.fn(),
    annotations: { list: vi.fn(async () => []), create: vi.fn(), reply: vi.fn(), setStatus: vi.fn() },
  },
}));

// Mentions need the company's people; this test has no company, and no "@" is typed.
vi.mock("@/tasks/composer/MentionTextArea", () => ({
  useMentionCandidates: () => ({ candidates: () => [], people: {} }),
  MentionList: () => null,
}));

// CodeMirror needs real layout; the editor's textarea stand-in is enough here.
vi.mock("./cm-editor", () => ({
  createMarkdownEditor: () => {
    throw new Error("no CodeMirror in jsdom");
  },
}));

const api = vi.mocked(documentsApi, true);

function doc(overrides: Partial<IssueDocument> = {}): IssueDocument {
  return {
    id: "d1",
    companyId: "c1",
    issueId: "i1",
    key: "notes",
    title: "Notes",
    format: "markdown",
    body: "Hello there",
    latestRevisionId: "r3",
    latestRevisionNumber: 3,
    createdByAgentId: null,
    createdByUserId: "u1",
    updatedByAgentId: null,
    updatedByUserId: "u1",
    lockedAt: null,
    lockedByAgentId: null,
    lockedByUserId: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    updatedAt: new Date("2026-10-02T10:00:00Z"),
    ...overrides,
  };
}

const host: DocumentHost = {
  owner: { kind: "issue", id: "i1" },
  root: ["issues", "detail", "i1", "documents"],
  nameOf: (agentId, userId) => (agentId === "a1" ? "Ada" : userId === "u1" ? "You" : null),
  youId: () => "u1",
};

function show(props: Partial<Parameters<typeof DocumentView>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(() => (
    <QueryClientProvider client={client}>
      <DocumentView host={host} docKey="notes" backLabel="Back" onBack={() => {}} onDeleted={() => {}} {...props} />
    </QueryClientProvider>
  ));
}

describe("DocumentView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.revisions.mockResolvedValue([]);
    api.annotations.list.mockResolvedValue([]);
  });
  afterEach(cleanup);

  it("says who holds the lock, offers Unlock and hides Edit", async () => {
    api.get.mockResolvedValue(doc({ lockedAt: new Date(), lockedByAgentId: "a1" }));
    api.unlock.mockResolvedValue(doc());
    show();
    expect(await screen.findByText("Locked by Ada")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(api.unlock).toHaveBeenCalledWith(host.owner, "notes"));
    expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("saves from the revision the edit started on", async () => {
    api.get.mockResolvedValue(doc());
    api.upsert.mockResolvedValue(doc({ body: "Hello again", latestRevisionId: "r4", latestRevisionNumber: 4 }));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.input(screen.getByLabelText("Notes (Markdown)"), { target: { value: "Hello again" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.upsert).toHaveBeenCalledWith(host.owner, "notes", { title: "Notes", format: "markdown", body: "Hello again", baseRevisionId: "r3" }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
  });

  it("keeps the draft on a conflict and can overwrite the newer revision", async () => {
    api.get.mockResolvedValueOnce(doc());
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.input(screen.getByLabelText("Notes (Markdown)"), { target: { value: "Mine" } });
    api.upsert.mockRejectedValueOnce(new ApiError("Document was updated by someone else", 409, null));
    api.get.mockResolvedValue(doc({ body: "Theirs", latestRevisionId: "r4", latestRevisionNumber: 4, updatedByAgentId: "a1", updatedByUserId: null }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Changed while you were editing.")).toBeTruthy();
    expect((screen.getByLabelText("Notes (Markdown)") as HTMLTextAreaElement).value).toBe("Mine");
    api.upsert.mockResolvedValueOnce(doc({ body: "Mine", latestRevisionId: "r5", latestRevisionNumber: 5 }));
    fireEvent.click(screen.getByRole("button", { name: "Overwrite with mine" }));
    await waitFor(() => expect(api.upsert).toHaveBeenLastCalledWith(host.owner, "notes", expect.objectContaining({ body: "Mine", baseRevisionId: "r4" })));
  });

  it("stops saving when the document turns out to be locked", async () => {
    let locked = false;
    api.get.mockImplementation(async () => (locked ? doc({ lockedAt: new Date(), lockedByUserId: "u2" }) : doc()));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.input(screen.getByLabelText("Notes (Markdown)"), { target: { value: "Changed" } });
    api.upsert.mockRejectedValueOnce(new ApiError("Document is locked", 409, null));
    locked = true;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByLabelText("Notes (Markdown)") as HTMLTextAreaElement).value).toBe("Changed");
  });
});
