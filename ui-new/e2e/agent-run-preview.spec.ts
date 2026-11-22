import type { ClaudeRunPreview, ClaudeRunPreviewManifest } from "@paperclipai/shared";
import type { MockApi } from "./fixtures/mock-api";
import { expect, test } from "./fixtures/test";
import { AGENT_ID, PROJECTS } from "./fixtures/world";

// Step 4b part 2: the agent's Runtime section shows what its runs get, from the run preview (mocked),
// for tasks in no project or in a project picked in "For tasks in". Nothing here starts a run.

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
    if (!projectId) return { supported: true, project: null, manifest, blockers: [] };
    const project = PROJECTS.find((entry) => entry.id === projectId)!;
    return {
      supported: true,
      project: { id: project.id, name: project.name, checkout: { kind: "not_cloned", repoUrl: "https://github.com/m7-test/site" } },
      manifest: { ...manifest, credential: null, claudeMd: { enabled: false, reason: "not_cloned" }, repoSkills: { enabled: false, reason: "not_cloned" } },
      blockers: [{ code: "claude_credential_missing", message: "M7 test: no Claude credential for this agent." }],
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
    if (!query.get("projectId")) return { supported: true, project: null, manifest, blockers: [] };
    return {
      supported: true,
      project: { id: project.id, name: project.name, checkout: { kind: "local", path: "/home/m7/site", worktree: { dir: worktrees, baseRef: "origin/main" } } },
      manifest: {
        ...manifest,
        claudeMd: { enabled: true, path: `${worktrees}/<task branch>/CLAUDE.md` },
        repoSkills: { enabled: true, dir: `${worktrees}/<task branch>/.claude/skills`, count: 2 },
      },
      blockers: [],
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
