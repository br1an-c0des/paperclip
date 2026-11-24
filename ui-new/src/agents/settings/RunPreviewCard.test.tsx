import type { AgentDetail, ClaudeRunPreview, ClaudeRunPreviewManifest, RunPromptPreview, RunPromptSection } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  cleanup();
});

const api = vi.hoisted(() => ({ runPreview: vi.fn(), assignedTasks: vi.fn() }));
const issues = vi.hoisted(() => ({ search: vi.fn() }));
const chats = vi.hoisted(() => ({ list: vi.fn() }));
const projects = vi.hoisted(() => ({
  data: [
    { id: "p1", name: "Site", archivedAt: null },
    { id: "p2", name: "App", archivedAt: null },
  ],
}));
vi.mock("@/api/agents", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/agents")>()), agentsApi: api }));
vi.mock("@/api/issues", () => ({ issuesApi: issues }));
vi.mock("@/api/chat", () => ({ chatApi: chats }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
vi.mock("@/lib/company-data", () => ({ useProjectsQuery: () => projects }));

const { RunPreviewCard } = await import("./RunPreviewCard");
const { projectKey } = await import("./run-preview-model");
const { ApiError } = await import("@/api/client");

const agent = { id: "a1", companyId: "co1", name: "Ada" } as unknown as AgentDetail;

const manifest: ClaudeRunPreviewManifest = {
  version: 1,
  engine: "cli",
  configDir: "/data/agents/a1/claude",
  settingSources: ["user"],
  credential: { kind: "managed_connection", method: "subscription", connectionId: "c1", connectionName: "Claude Max" },
  overriddenEnv: [],
  skills: [
    { name: "paperclip", key: "paperclip", origin: "always_on", plugin: "paperclip" },
    { name: "complain", key: "complain", origin: "always_on", plugin: "paperclip" },
    { name: "review", key: "company/review", origin: "assigned", plugin: "company" },
  ],
  skillNameClashes: [],
  builtInSkills: true,
  mcpServers: [{ name: "paperclip", url: "http://localhost:3100/mcp" }],
  strictMcpConfig: true,
  access: { level: "worker", overrides: {} },
  instructions: { entryFile: "AGENTS.md", sent: true },
  claudeMd: { enabled: false, reason: "no_project" },
  repoSkills: { enabled: false, reason: "no_project" },
  autoMemory: false,
  envKeys: [],
  extraArgs: [],
  github: { mode: "connection", identitySource: "personal", login: "octocat" },
};

const noProject: ClaudeRunPreview = { supported: true, project: null, manifest, blockers: [], prompt: null };
const app: ClaudeRunPreview = {
  supported: true,
  project: { id: "p2", name: "App", checkout: { kind: "not_cloned", repoUrl: "https://github.com/acme/app" } },
  manifest: { ...manifest, claudeMd: { enabled: false, reason: "not_cloned" }, repoSkills: { enabled: false, reason: "not_cloned" } },
  blockers: [],
  prompt: null,
};

const site: ClaudeRunPreview = {
  supported: true,
  project: {
    id: "p1",
    name: "Site",
    checkout: { kind: "local", path: "/work/site", worktree: { dir: "/work/site/.paperclip/worktrees", baseRef: "main" } },
  },
  manifest: {
    ...manifest,
    claudeMd: { enabled: true, path: "/work/site/.paperclip/worktrees/<task branch>/CLAUDE.md" },
    repoSkills: { enabled: true, dir: "/work/site/.paperclip/worktrees/<task branch>/.claude/skills", count: 1 },
  },
  blockers: [],
  prompt: null,
};

function mount(props: { dirty?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(() => (
    <QueryClientProvider client={client}>
      <RunPreviewCard agent={agent} dirty={props.dirty} />
    </QueryClientProvider>
  ));
  return client;
}

/** The value beside a row's label. */
function row(label: string) {
  const key = [...document.querySelectorAll(".rp .ri-k")].find((node) => node.firstChild?.textContent?.trim() === label);
  return key?.nextElementSibling?.textContent?.trim() ?? null;
}

beforeEach(() => {
  api.runPreview.mockReset();
  api.assignedTasks.mockReset();
  api.assignedTasks.mockResolvedValue([
    { id: "t2", identifier: "TES-2", title: "Fix the signup form" },
    { id: "t3", identifier: "TES-3", title: "Review the pricing copy" },
  ]);
  issues.search.mockReset();
  issues.search.mockResolvedValue([{ id: "t9", identifier: "TES-9", title: "Someone else's task" }]);
  chats.list.mockReset();
  chats.list.mockResolvedValue([
    { id: "c1", identifier: "TES-6", title: "Chat with Ada", conversationAgentId: "a1" },
    { id: "c2", identifier: "TES-7", title: "Chat with Bob", conversationAgentId: "a2" },
  ]);
  localStorage.clear();
});

/** A draft's sections, as the server sends them. */
function draft(kind: RunPromptPreview["kind"], issueId: string | null, sections: RunPromptSection[]): RunPromptPreview {
  return {
    kind,
    issueId,
    systemPrompt: [{
      id: "agent_instructions", label: "Agent instructions", placement: "system", delivery: "fresh_only",
      reason: "the agent's instructions file was read", source: "instructions file: AGENTS.md", text: "You are Ada.", chars: 12,
    }],
    firstMessage: sections,
    firstMessageChars: sections.map((section) => section.text).join("\n\n").length,
  };
}

const briefSection = (text: string): RunPromptSection => ({
  id: "task_brief", label: "Task brief", placement: "first_message", delivery: "every_run",
  reason: "a fresh session gets the full brief", source: "context: paperclipTaskMarkdownAssignment", text, chars: text.length,
});

const wakeSection: RunPromptSection = {
  id: "wake", label: "Wake", placement: "first_message", delivery: "every_run", reason: "assigned the task",
  source: "context: paperclipWake", text: "## Paperclip Wake Payload\n- checkout: already claimed by the harness for this run", chars: 82,
  parts: [
    { id: "wake.header", label: "Wake header", source: "wake renderer", text: "## Paperclip Wake Payload", chars: 25 },
    {
      id: "wake.checkout_line", label: "Checkout", source: "wake payload: checkedOutByHarness",
      text: "\n- checkout: already claimed by the harness for this run", chars: 57,
      pending: "The harness checks the task out when the run starts; predicted from the task's status and assignee.",
    },
  ],
};

/** Opens the task picker and picks the option with this name. */
async function pickTask(name: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: /^Task: / }));
  fireEvent.click(await screen.findByRole("option", { name }));
}

describe("What runs get", () => {
  it("lists what a run on a task in no project gets", async () => {
    api.runPreview.mockResolvedValue(noProject);
    mount();
    await screen.findByText("Claude subscription · connection Claude Max");
    expect(api.runPreview).toHaveBeenCalledWith("a1", { projectId: null }, "co1", expect.anything());
    expect(row("Engine")).toBe("CLI, sealed · config folder /data/agents/a1/claude");
    expect(row("Skills")).toContain("3 skills");
    expect(row("MCP servers")).toBe("paperclip");
    expect(row("Access")).toBe("Worker");
    expect(row("GitHub")).toBe("Connection: octocat (personal)");
    expect(row("CLAUDE.md")).toBe("No project selected");
    expect(row("Repo skills")).toBe("No project selected");
    expect(row("Session")).toBe("Each new task starts a fresh session; later wakes on the same task resume it");
    expect(row("Repository")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByLabelText("For tasks in") as HTMLSelectElement).value).toBe("");
  });

  it("previews the chosen project, remembers it for the agent, and reads a repo that isn't cloned", async () => {
    api.runPreview.mockImplementation((_id: string, query: { projectId?: string | null }) => Promise.resolve(query.projectId === "p2" ? app : noProject));
    mount();
    await screen.findByText("Claude subscription · connection Claude Max");
    fireEvent.change(screen.getByLabelText("For tasks in"), { target: { value: "p2" } });
    await waitFor(() => expect(row("CLAUDE.md")).toBe("Not cloned yet: read on the first run"));
    expect(api.runPreview).toHaveBeenLastCalledWith("a1", { projectId: "p2" }, "co1", expect.anything());
    expect(row("Repo skills")).toBe("Not cloned yet: read on the first run");
    expect(row("Repository")).toBe("Not cloned yet, from https://github.com/acme/app");
    expect(localStorage.getItem(projectKey("a1"))).toBe("p2");
  });

  it("shows a project whose tasks get their own worktree", async () => {
    api.runPreview.mockImplementation((_id: string, query: { projectId?: string | null }) => Promise.resolve(query.projectId === "p1" ? site : noProject));
    mount();
    await screen.findByText("Claude subscription · connection Claude Max");
    expect(row("Task worktrees")).toBeNull();
    fireEvent.change(screen.getByLabelText("For tasks in"), { target: { value: "p1" } });
    await waitFor(() => expect(row("Task worktrees")).toBe("From main, in /work/site/.paperclip/worktrees"));
    expect(row("Repository")).toBe("/work/site");
    expect(row("CLAUDE.md")).toBe("/work/site/.paperclip/worktrees/<task branch>/CLAUDE.md");
    expect(row("Repo skills")).toBe("1 skill from /work/site/.paperclip/worktrees/<task branch>/.claude/skills");
  });

  it("starts from the remembered project, and drops one that's gone", async () => {
    localStorage.setItem(projectKey("a1"), "p2");
    api.runPreview.mockResolvedValue(app);
    mount();
    await screen.findByText("Not cloned yet, from");
    expect(api.runPreview).toHaveBeenCalledWith("a1", { projectId: "p2" }, "co1", expect.anything());
    expect((screen.getByLabelText("For tasks in") as HTMLSelectElement).value).toBe("p2");
    cleanup();

    localStorage.setItem(projectKey("a1"), "deleted");
    api.runPreview.mockReset();
    api.runPreview.mockResolvedValue(noProject);
    mount();
    await screen.findByText("Claude subscription · connection Claude Max");
    expect(api.runPreview).toHaveBeenCalledWith("a1", { projectId: null }, "co1", expect.anything());
  });

  it("warns about a blocker at the top, and shows no credential", async () => {
    api.runPreview.mockResolvedValue({
      ...noProject,
      manifest: { ...manifest, credential: null },
      blockers: [{ code: "claude_credential_missing", message: "No Claude credential: connect one in AI connections." }],
    });
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("A run would be refused before it starts");
    expect(alert.textContent).toContain("No Claude credential: connect one in AI connections.");
    expect(row("Credential")).toBe("None: runs will be refused");
  });

  it("says why in one line when it isn't available, without rows or a project picker", async () => {
    api.runPreview.mockResolvedValue({ supported: false, reason: "not_cli_engine" });
    mount();
    await screen.findByText(/^Not available on the ACP engine/);
    expect(document.querySelector(".rp .ri-kvl")).toBeNull();
    expect(screen.queryByLabelText("For tasks in")).toBeNull();
  });

  it("shows an error, and says unsaved changes aren't in it yet", async () => {
    api.runPreview.mockRejectedValue(new Error("Agent not found"));
    mount();
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't load what runs get.");
    cleanup();

    api.runPreview.mockReset();
    api.runPreview.mockResolvedValue(noProject);
    mount({ dirty: true });
    await screen.findByText("These are the saved settings. Save to see your changes here.");
  });

  it("refetches when the agent is refreshed after a save", async () => {
    api.runPreview.mockResolvedValue(noProject);
    const client = mount();
    await screen.findByText("Claude subscription · connection Claude Max");
    expect(api.runPreview).toHaveBeenCalledTimes(1);
    await client.invalidateQueries({ queryKey: ["agents", "detail", "a1"] });
    await waitFor(() => expect(api.runPreview).toHaveBeenCalledTimes(2));
  });
});

describe("What runs get: the prompt", () => {
  const sectionLabels = () => [...document.querySelectorAll(".rp-prompt .ps-label")].map((node) => node.textContent);

  it("shows the draft of a run without a task until a task is picked", async () => {
    api.runPreview.mockResolvedValue({ ...noProject, prompt: draft("no_task", null, [briefSection("null")]) });
    mount();
    await waitFor(() => expect(sectionLabels()).toEqual(["Agent instructions", "Task brief"]));
    expect(screen.getByRole("button", { name: /^Task: No task\./ })).toBeTruthy();
    const kind = screen.getByLabelText("Kind") as HTMLSelectElement;
    expect(kind.disabled).toBe(true);
    expect([...kind.options].map((option) => option.textContent)).toEqual(["No task"]);
  });

  it("refetches with the picked task and kind, the agent's own tasks listed first", async () => {
    api.runPreview.mockImplementation((_id: string, query: { issueId?: string | null; kind?: string | null }) =>
      Promise.resolve({
        ...noProject,
        prompt: query.issueId
          ? draft(query.kind as RunPromptPreview["kind"], query.issueId, [briefSection(`brief for ${query.issueId} as ${query.kind}`)])
          : draft("no_task", null, [briefSection("null")]),
      }));
    mount();
    await waitFor(() => expect(sectionLabels()).toContain("Task brief"));
    fireEvent.click(screen.getByRole("button", { name: /^Task: / }));
    const listbox = await screen.findByRole("listbox", { name: "Task for the prompt draft" });
    await waitFor(() => expect(listbox.textContent).toContain("Fix the signup form"));
    // The agent's tasks, then its chats (not another agent's).
    expect([...listbox.querySelectorAll("[role=group]")].map((group) => group.getAttribute("aria-label")))
      .toEqual(["Assigned to this agent", "Chats with this agent"]);
    expect(listbox.textContent).not.toContain("Chat with Bob");
    fireEvent.click(screen.getByRole("option", { name: /Fix the signup form/ }));
    await waitFor(() =>
      expect(api.runPreview).toHaveBeenLastCalledWith("a1", { issueId: "t2", kind: "assignment" }, "co1", expect.anything()));

    const kind = screen.getByLabelText("Kind") as HTMLSelectElement;
    expect([...kind.options].map((option) => option.textContent)).toEqual(["Fresh assignment", "Comment"]);
    fireEvent.change(kind, { target: { value: "comment" } });
    await waitFor(() =>
      expect(api.runPreview).toHaveBeenLastCalledWith("a1", { issueId: "t2", kind: "comment" }, "co1", expect.anything()));
    await waitFor(() => expect(document.querySelector(".rp-prompt")?.textContent).toContain("brief for t2 as comment"));
  });

  it("finds other tasks by search", async () => {
    api.runPreview.mockResolvedValue({ ...noProject, prompt: draft("no_task", null, [briefSection("null")]) });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^Task: / }));
    fireEvent.input(await screen.findByLabelText("Find a task"), { target: { value: "else" } });
    await waitFor(() => expect(issues.search).toHaveBeenCalledWith("co1", { q: "else", limit: 8 }, expect.anything()));
    expect(await screen.findByRole("option", { name: /Someone else's task/ })).toBeTruthy();
  });

  it("marks a value filled in at launch, with why behind an i", async () => {
    api.runPreview.mockResolvedValue({ ...noProject, prompt: draft("assignment", "t2", [wakeSection]) });
    mount();
    await waitFor(() => expect(sectionLabels()).toContain("Wake"));
    const part = document.querySelector('.rp-prompt [data-part="wake.checkout_line"]')!;
    expect(part.querySelector(".rp-pending")?.textContent).toContain("filled in at launch");
    expect(part.querySelector(".rp-pending button")?.getAttribute("aria-label")).toBe("Why it's filled in at launch");
    // The part is shown without the blank line before it.
    expect(part.querySelector("pre")?.textContent).toBe("- checkout: already claimed by the harness for this run");
    expect(document.querySelector('.rp-prompt [data-part="wake.header"] .rp-pending')).toBeNull();
  });

  it("offers a chat turn for the agent's chat, and says so when it isn't one", async () => {
    api.runPreview.mockImplementation((_id: string, query: { issueId?: string | null }) =>
      query.issueId
        ? Promise.reject(new ApiError("This task isn't one of the agent's chats", 422, { error: "This task isn't one of the agent's chats", code: "not_a_chat" }))
        : Promise.resolve({ ...noProject, prompt: draft("no_task", null, [briefSection("null")]) }));
    mount();
    await waitFor(() => expect(sectionLabels()).toContain("Task brief"));
    await pickTask(/Chat with Ada/);
    await waitFor(() =>
      expect(api.runPreview).toHaveBeenLastCalledWith("a1", { issueId: "c1", kind: "chat_turn" }, "co1", expect.anything()));
    expect([...(screen.getByLabelText("Kind") as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(["Chat turn"]);
    expect((await screen.findByText("Not one of this agent's chats, so there's no chat turn to draft.")).getAttribute("role")).toBe("status");
    // No draft, and the manifest stays.
    expect(sectionLabels()).toEqual([]);
    expect(row("Engine")).toBe("CLI, sealed · config folder /data/agents/a1/claude");
  });

  it("says when a task has no comment to wake on", async () => {
    api.runPreview.mockImplementation((_id: string, query: { kind?: string | null }) =>
      query.kind === "comment"
        ? Promise.reject(new ApiError("This task has no comments yet", 422, { error: "This task has no comments yet", code: "no_comment" }))
        : Promise.resolve({ ...noProject, prompt: draft("assignment", "t2", [briefSection("brief")]) }));
    mount();
    await pickTask(/Fix the signup form/);
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "comment" } });
    expect(await screen.findByText("No comments on this task yet, so nothing to wake on.")).toBeTruthy();
  });
});
