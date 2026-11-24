import type { ClaudeRunPreview, ClaudeRunPreviewManifest, RunPromptPreview, RunPromptSection } from "@paperclipai/shared";
import { reply, type MockApi } from "./fixtures/mock-api";
import { expect, test } from "./fixtures/test";
import { AGENT_ID, CHAT_ID, ISSUES, PROJECTS } from "./fixtures/world";

// Step 4b part 2: the agent's Runtime section shows what its runs get, from the run preview (mocked),
// for tasks in no project or in a project picked in "For tasks in". Step 5 added the Prompt part: a
// draft of the next run's prompt for a picked task and kind of wake. Nothing here starts a run.

const manifest: ClaudeRunPreviewManifest = {
  version: 1,
  engine: "cli",
  configDir: "/paperclip/instances/default/agents/m7-test-builder/claude",
  settingSources: ["user"],
  credential: { kind: "managed_connection", method: "subscription", connectionId: "conn-m7", connectionName: "M7 test Max" },
  overriddenEnv: [],
  skills: [
    { name: "paperclip", key: "paperclip", origin: "always_on", plugin: "paperclip" },
    { name: "complain", key: "complain", origin: "always_on", plugin: "paperclip" },
    { name: "m7-test-review", key: "company/m7-test-review", origin: "assigned", plugin: "company" },
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
  github: { mode: "connection", identitySource: "personal", login: "m7-test-bot" },
};

const section = (id: RunPromptSection["id"], label: string, text: string, extra: Partial<RunPromptSection> = {}): RunPromptSection => ({
  id, label, placement: "first_message", delivery: "every_run", reason: "M7 test reason", source: "M7 test source",
  text, chars: text.length, ...extra,
});

/** A draft: the system prompt, then the first message's sections. */
function draft(kind: RunPromptPreview["kind"], issueId: string | null, firstMessage: RunPromptSection[]): RunPromptPreview {
  return {
    kind,
    issueId,
    systemPrompt: [section("agent_instructions", "Agent instructions", "M7 test: you are the Builder.", { placement: "system", delivery: "fresh_only" })],
    firstMessage,
    firstMessageChars: firstMessage.map((entry) => entry.text).join("\n\n").length,
  };
}

const noTaskDraft = draft("no_task", null, [section("task_brief", "Task brief", "null"), section("heartbeat_template", "Heartbeat template", "M7 test: do the work.")]);

/** The Runtime section's other reads, which no other spec visits yet: empty answers. */
function runtimeReads(api: MockApi) {
  api.get("/adapters/:adapterType/config-schema", () => ({ fields: [] }));
  api.get("/adapters", () => []);
  api.get("/instance/settings", () => ({ defaultEnvironmentId: null }));
  api.get("/companies/:companyId/environments", () => []);
  api.get("/companies/:companyId/ai-connections", () => []);
  api.get("/companies/:companyId/adapters/:adapterType/detect-model", () => null);
  api.get("/agents/:agentId/config-revisions", () => []);
  api.get("/agents/:agentId/task-sessions", () => []);
}

test("the Runtime section shows what runs get, for no project and for a project", async ({ page, api }) => {
  runtimeReads(api);
  const asked: Array<string | null> = [];
  api.get("/agents/:agentId/run-preview", ({ params, query }): ClaudeRunPreview => {
    expect(params.agentId).toBe(AGENT_ID);
    const projectId = query.get("projectId");
    asked.push(projectId);
    if (!projectId) return { supported: true, project: null, manifest, blockers: [], prompt: noTaskDraft };
    const project = PROJECTS.find((entry) => entry.id === projectId)!;
    return {
      supported: true,
      project: { id: project.id, name: project.name, checkout: { kind: "not_cloned", repoUrl: "https://github.com/m7-test/site" } },
      manifest: { ...manifest, credential: null, claudeMd: { enabled: false, reason: "not_cloned" }, repoSkills: { enabled: false, reason: "not_cloned" } },
      blockers: [{ code: "claude_credential_missing", message: "M7 test: no Claude credential for this agent." }],
      prompt: noTaskDraft,
    };
  });

  await page.goto("/MSE/agents/m7-test-builder/runtime");
  const card = page.locator("section.rp");
  await expect(card.getByRole("heading", { name: "What runs get" })).toBeVisible();
  await expect(card.getByText("Claude subscription · connection M7 test Max")).toBeVisible();
  await expect(card.getByText("No project selected")).toHaveCount(2);
  await expect(card.getByText("Each new task starts a fresh session; later wakes on the same task resume it")).toBeVisible();
  await expect(card.getByRole("alert")).toHaveCount(0);

  const picker = card.getByLabel("For tasks in");
  const project = PROJECTS[0]!;
  await picker.selectOption(project.id);
  await expect(card.getByRole("alert")).toContainText("M7 test: no Claude credential for this agent.");
  await expect(card.getByText("Not cloned yet: read on the first run")).toHaveCount(2);
  await expect(card.getByText("https://github.com/m7-test/site")).toBeVisible();
  await expect(card.getByText("None: runs will be refused")).toBeVisible();
  expect(asked).toContain(project.id);

  // Nothing scrolls sideways at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Remembered on the device: a reload asks for the same project.
  await page.reload();
  await expect(card.getByText("Not cloned yet: read on the first run")).toHaveCount(2);
  await expect(card.getByLabel("For tasks in")).toHaveValue(project.id);
  expect(api.writes).toEqual([]);
});

test("a project whose tasks get their own worktree shows where, and reads the repo from its commit", async ({ page, api }) => {
  runtimeReads(api);
  const project = PROJECTS[0]!;
  const worktrees = "/home/m7/site/.paperclip/worktrees";
  api.get("/agents/:agentId/run-preview", ({ query }): ClaudeRunPreview => {
    if (!query.get("projectId")) return { supported: true, project: null, manifest, blockers: [], prompt: noTaskDraft };
    return {
      supported: true,
      project: { id: project.id, name: project.name, checkout: { kind: "local", path: "/home/m7/site", worktree: { dir: worktrees, baseRef: "origin/main" } } },
      manifest: {
        ...manifest,
        claudeMd: { enabled: true, path: `${worktrees}/<task branch>/CLAUDE.md` },
        repoSkills: { enabled: true, dir: `${worktrees}/<task branch>/.claude/skills`, count: 2 },
      },
      blockers: [],
      prompt: noTaskDraft,
    };
  });

  await page.goto("/MSE/agents/m7-test-builder/runtime");
  const card = page.locator("section.rp");
  await expect(card.getByText("No project selected")).toHaveCount(2);
  await card.getByLabel("For tasks in").selectOption(project.id);
  await expect(card.getByText("From origin/main, in")).toBeVisible();
  await expect(card.getByText(worktrees, { exact: true })).toBeVisible();
  await expect(card.getByText(`${worktrees}/<task branch>/CLAUDE.md`)).toBeVisible();
  await expect(card.getByText("2 skills from")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(api.writes).toEqual([]);
});

test("an agent whose runs aren't sealed says why instead", async ({ page, api }) => {
  runtimeReads(api);
  api.get("/agents/:agentId/run-preview", (): ClaudeRunPreview => ({ supported: false, reason: "runner" }));
  await page.goto("/MSE/agents/m7-test-builder/runtime");
  const card = page.locator("section.rp");
  await expect(card.getByText("Not available: runs on Paperclip Runner aren't sealed.")).toBeVisible();
  await expect(card.getByLabel("For tasks in")).toHaveCount(0);
});

test("the Prompt part drafts the next run for a picked task and kind, marking what the launch fills in", async ({ page, api }) => {
  runtimeReads(api);
  const task = ISSUES.find((issue) => issue.assigneeAgentId === AGENT_ID && !issue.conversationAgentId && issue.status === "todo")!;
  const asked: string[] = [];
  api.get("/agents/:agentId/run-preview", ({ query }) => {
    const issueId = query.get("issueId");
    const kind = query.get("kind");
    asked.push(`${issueId ?? "-"}:${kind ?? "-"}`);
    if (!issueId) return { supported: true, project: null, manifest, blockers: [], prompt: noTaskDraft } satisfies ClaudeRunPreview;
    if (issueId === CHAT_ID) return reply(422, { error: "M7 test: not one of the agent's chats", code: "not_a_chat" });
    const wake = section("wake", "Wake", "## Paperclip Wake Payload\n- checkout: already claimed by the harness for this run", {
      parts: [
        { id: "wake.header", label: "Wake header", source: "wake renderer", text: "## Paperclip Wake Payload", chars: 25 },
        {
          id: "wake.checkout_line", label: "Checkout", source: "wake payload: checkedOutByHarness",
          text: "\n- checkout: already claimed by the harness for this run", chars: 57,
          pending: "The harness checks the task out when the run starts; predicted from the task's status and assignee.",
        },
      ],
    });
    const brief = section("task_brief", "Task brief", `M7 test brief for ${task.title} (${kind})`);
    return { supported: true, project: null, manifest, blockers: [], prompt: draft(kind === "comment" ? "comment" : "assignment", issueId, [wake, brief]) } satisfies ClaudeRunPreview;
  });

  await page.goto("/MSE/agents/m7-test-builder/runtime");
  const prompt = page.locator("section.rp-prompt");
  await expect(prompt.getByRole("heading", { name: "Prompt", exact: true })).toBeVisible();
  // Without a task: the draft of a run without one.
  await expect(prompt.locator(".ps-label", { hasText: "Heartbeat template" })).toBeVisible();
  await expect(prompt.getByLabel("Kind")).toBeDisabled();

  // The agent's own task, then a comment on it.
  await prompt.getByRole("button", { name: /^Task: / }).click();
  await page.getByRole("option", { name: new RegExp(task.title) }).click();
  await expect(prompt.locator(".ps-label", { hasText: "Wake" })).toBeVisible();
  await prompt.getByLabel("Kind").selectOption("comment");
  await expect.poll(() => asked).toContain(`${task.id}:comment`);
  await prompt.locator('details[data-section="wake"] > summary').click();
  const checkout = prompt.locator('[data-part="wake.checkout_line"]');
  await expect(checkout.getByText("filled in at launch")).toBeVisible();
  await expect(checkout.getByRole("button", { name: "Why it's filled in at launch" })).toBeVisible();
  await prompt.locator('details[data-section="task_brief"] > summary').click();
  await expect(prompt.getByText(`M7 test brief for ${task.title} (comment)`)).toBeVisible();

  // A chat the server says isn't one of the agent's: a note beside the picker, the rows stay.
  await prompt.getByRole("button", { name: /^Task: / }).click();
  await page.getByRole("option", { name: /M7 test Chat with Builder/ }).click();
  await expect(prompt.getByLabel("Kind")).toHaveValue("chat_turn");
  await expect(prompt.getByRole("status")).toHaveText("Not one of this agent's chats, so there's no chat turn to draft.");
  await expect(page.locator("section.rp").getByText("Claude subscription · connection M7 test Max")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(api.writes).toEqual([]);
});
