import type { AgentDetail, ClaudeRunPreview, ClaudeRunPreviewManifest } from "@paperclipai/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  cleanup();
});

const api = vi.hoisted(() => ({ runPreview: vi.fn() }));
const projects = vi.hoisted(() => ({
  data: [
    { id: "p1", name: "Site", archivedAt: null },
    { id: "p2", name: "App", archivedAt: null },
  ],
}));
vi.mock("@/api/agents", () => ({ agentsApi: api }));
vi.mock("@/lib/company", () => ({ useCompany: () => () => ({ id: "co1", issuePrefix: "TES" }) }));
vi.mock("@/lib/company-data", () => ({ useProjectsQuery: () => projects }));

const { RunPreviewCard } = await import("./RunPreviewCard");
const { projectKey } = await import("./run-preview-model");

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

const noProject: ClaudeRunPreview = { supported: true, project: null, manifest, blockers: [] };
const app: ClaudeRunPreview = {
  supported: true,
  project: { id: "p2", name: "App", checkout: { kind: "not_cloned", repoUrl: "https://github.com/acme/app" } },
  manifest: { ...manifest, claudeMd: { enabled: false, reason: "not_cloned" }, repoSkills: { enabled: false, reason: "not_cloned" } },
  blockers: [],
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
  localStorage.clear();
});

describe("What runs get", () => {
  it("lists what a run on a task in no project gets", async () => {
    api.runPreview.mockResolvedValue(noProject);
    mount();
    await screen.findByText("Claude subscription · connection Claude Max");
    expect(api.runPreview).toHaveBeenCalledWith("a1", null, "co1", expect.anything());
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
    api.runPreview.mockImplementation((_id: string, projectId: string | null) => Promise.resolve(projectId === "p2" ? app : noProject));
    mount();
    await screen.findByText("Claude subscription · connection Claude Max");
    fireEvent.change(screen.getByLabelText("For tasks in"), { target: { value: "p2" } });
    await waitFor(() => expect(row("CLAUDE.md")).toBe("Not cloned yet: read on the first run"));
    expect(api.runPreview).toHaveBeenLastCalledWith("a1", "p2", "co1", expect.anything());
    expect(row("Repo skills")).toBe("Not cloned yet: read on the first run");
    expect(row("Repository")).toBe("Not cloned yet, from https://github.com/acme/app");
    expect(localStorage.getItem(projectKey("a1"))).toBe("p2");
  });

  it("shows a project whose tasks get their own worktree", async () => {
    api.runPreview.mockImplementation((_id: string, projectId: string | null) => Promise.resolve(projectId === "p1" ? site : noProject));
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
    expect(api.runPreview).toHaveBeenCalledWith("a1", "p2", "co1", expect.anything());
    expect((screen.getByLabelText("For tasks in") as HTMLSelectElement).value).toBe("p2");
    cleanup();

    localStorage.setItem(projectKey("a1"), "deleted");
    api.runPreview.mockReset();
    api.runPreview.mockResolvedValue(noProject);
    mount();
    await screen.findByText("Claude subscription · connection Claude Max");
    expect(api.runPreview).toHaveBeenCalledWith("a1", null, "co1", expect.anything());
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
