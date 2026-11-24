import type { Agent, ClaudeRunPreview, RunPromptDraft } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  cleanup();
});

const api = vi.hoisted(() => ({ runPreviewDraft: vi.fn() }));
vi.mock("@/api/agents", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/agents")>()), agentsApi: api }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));

const { NewTaskPromptPreview, draftFromPayload, promptPreviewAvailability, usesClaudeCli } = await import("./NewTaskPromptPreview");
const { ApiError } = await import("@/api/client");

const cli = { id: "a1", adapterType: "claude_local", adapterConfig: { engine: "cli" } } as unknown as Agent;
const ready = { assignee: { kind: "agent" as const, id: "a1" }, agent: cli, repeating: false, status: "todo" as const, hasContent: true };

const preview: ClaudeRunPreview = {
  supported: true,
  project: null,
  manifest: {} as never,
  blockers: [],
  prompt: {
    kind: "assignment",
    issueId: null,
    systemPrompt: [
      { id: "agent_instructions", label: "Agent instructions", placement: "system", delivery: "fresh_only", reason: "", source: "AGENTS.md", text: "You are Ada.", chars: 12 },
    ],
    firstMessage: [
      {
        id: "task_brief",
        label: "Task brief",
        placement: "first_message",
        delivery: "every_run",
        reason: "",
        source: "task",
        text: '- Issue: "TES-44"\n- Title: "Count the ledger"',
        chars: 40,
        parts: [
          { id: "task_brief.issue", label: "Issue", source: "task", text: '- Issue: "TES-44"\n- Title: "Count the ledger"', chars: 40, pending: "The task's id and identifier are given when it's created." },
        ],
      },
    ],
    firstMessageChars: 40,
  },
};

function mount(availability = promptPreviewAvailability(ready), draft: () => RunPromptDraft = () => ({ title: "Count the ledger" }), offline = () => false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(() => (
    <QueryClientProvider client={client}>
      <NewTaskPromptPreview availability={availability} draft={draft} offline={offline} />
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  api.runPreviewDraft.mockReset();
});

describe("promptPreviewAvailability", () => {
  it("is open for an agent on claude_local's CLI engine, with Repeat off", () => {
    expect(promptPreviewAvailability(ready)).toEqual({ agentId: "a1" });
    // No engine set, or "auto": the CLI, as the server decides.
    expect(usesClaudeCli({ adapterType: "claude_local", adapterConfig: {} } as Agent)).toBe(true);
    expect(usesClaudeCli({ adapterType: "claude_local", adapterConfig: { engine: "auto" } } as unknown as Agent)).toBe(true);
  });

  it("says why it's closed", () => {
    const reason = (patch: Partial<typeof ready>) => promptPreviewAvailability({ ...ready, ...patch });
    expect(reason({ assignee: null, agent: undefined })).toEqual({ reason: "No assignee yet" });
    expect(reason({ assignee: { kind: "user", id: "u1" }, agent: undefined })).toEqual({ reason: "Assigned to a person" });
    expect(reason({ agent: { ...cli, adapterType: "codex_local" } as Agent })).toEqual({ reason: "Only for Claude agents" });
    expect(reason({ agent: { ...cli, adapterConfig: { engine: "acp" } } as unknown as Agent })).toEqual({ reason: "Not on the ACP engine" });
    expect(reason({ repeating: true })).toEqual({ reason: "Not for recurring tasks" });
    expect(reason({ status: "backlog" })).toEqual({ reason: "A Backlog task doesn't start a run" });
    expect(reason({ hasContent: false })).toEqual({ reason: "Write a title or description first" });
  });
});

describe("draftFromPayload", () => {
  it("keeps the fields the prompt reads, as the create request sends them", () => {
    expect(
      draftFromPayload({
        title: "Count", description: "The ledger", status: "todo", priority: "high", workMode: "ask", projectId: "p1", parentId: "t1",
        goalId: "g1", executionWorkspacePreference: "isolated_workspace", executionWorkspaceSettings: { mode: "isolated_workspace" },
        projectWorkspaceId: "w1", allowDuplicate: true, idempotencyKey: "k", labelIds: ["l1"], assigneeAgentId: "a1",
      }),
    ).toEqual({
      title: "Count", description: "The ledger", status: "todo", priority: "high", workMode: "ask", projectId: "p1", parentId: "t1",
      goalId: "g1", executionWorkspacePreference: "isolated_workspace", executionWorkspaceSettings: { mode: "isolated_workspace" },
      projectWorkspaceId: "w1",
    });
  });
});

describe("NewTaskPromptPreview", () => {
  it("is disabled with the reason beside it", () => {
    mount(promptPreviewAvailability({ ...ready, assignee: null, agent: undefined }));
    const button = screen.getByRole("button", { name: "Preview the prompt" });
    expect(button).toBeDisabled();
    expect(screen.getByText("No assignee yet")).toBeInTheDocument();
    expect(button.getAttribute("aria-describedby")).toBe(screen.getByText("No assignee yet").id);
    fireEvent.click(button);
    expect(api.runPreviewDraft).not.toHaveBeenCalled();
  });

  it("drafts the prompt when opened, with the values filled in at launch marked", async () => {
    api.runPreviewDraft.mockResolvedValue(preview);
    mount();
    expect(screen.getByRole("button", { name: "Preview the prompt" })).toBeEnabled();
    expect(api.runPreviewDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview the prompt" }));
    expect(await screen.findByRole("dialog", { name: "Prompt preview" })).toBeInTheDocument();
    expect(await screen.findByText("First message")).toBeInTheDocument();
    expect(screen.getByText("System prompt")).toBeInTheDocument();
    expect(screen.getAllByText("filled in at launch").length).toBeGreaterThan(0);
    expect(api.runPreviewDraft).toHaveBeenCalledWith("a1", { title: "Count the ledger" }, "co1", expect.anything());
  });

  it("reads the draft again on each opening, not while typing", async () => {
    api.runPreviewDraft.mockResolvedValue(preview);
    const [title, setTitle] = createSignal("First");
    mount(promptPreviewAvailability(ready), () => ({ title: title() }));
    fireEvent.click(screen.getByRole("button", { name: "Preview the prompt" }));
    await screen.findByText("First message");
    setTitle("Second");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.runPreviewDraft).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The page is hidden from the accessibility tree until the dialog has gone.
    fireEvent.click(await screen.findByRole("button", { name: "Preview the prompt" }));
    await waitFor(() => expect(api.runPreviewDraft).toHaveBeenCalledTimes(2));
    expect(api.runPreviewDraft.mock.calls[1]![1]).toEqual({ title: "Second" });
  });

  it("shows loading, then the server's error", async () => {
    let fail!: (error: unknown) => void;
    api.runPreviewDraft.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Preview the prompt" }));
    expect(await screen.findByText("Drafting the prompt…")).toBeInTheDocument();
    fail(new ApiError("Project not found", 404, { error: "Project not found" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Project not found. Check the project, parent and goal.");
  });

  it("says when Paperclip can't be reached", async () => {
    api.runPreviewDraft.mockRejectedValue(new TypeError("Failed to fetch"));
    mount(promptPreviewAvailability(ready), () => ({ title: "Count" }), () => true);
    fireEvent.click(screen.getByRole("button", { name: "Preview the prompt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Paperclip can't be reached");
  });

  it("says when there's no prompt for this agent", async () => {
    api.runPreviewDraft.mockResolvedValue({ supported: false, reason: "remote_target" } satisfies ClaudeRunPreview);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Preview the prompt" }));
    expect(await screen.findByText(/runs on a remote target/)).toBeInTheDocument();
  });
});
