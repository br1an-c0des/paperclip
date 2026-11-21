import type { ClaudeRunManifest } from "@paperclipai/shared";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RunManifest } from "./RunManifest";

afterEach(cleanup);

const manifest: ClaudeRunManifest = {
  version: 1,
  engine: "cli",
  configDir: "/data/agents/a1/claude",
  settingSources: ["user"],
  credential: { kind: "managed_connection", method: "subscription", connectionId: "c1", connectionName: "Brian's Max" },
  setAside: { dir: "/data/agents/a1/claude.set-aside", entries: ["settings.json"] },
  overriddenEnv: ["CLAUDE_CONFIG_DIR"],
  skills: [
    { name: "paperclip", key: "paperclip", origin: "always_on", plugin: "paperclip" },
    { name: "review", key: "company/review", origin: "assigned", plugin: "company" },
    { name: "review", key: "repo:.claude/skills/review", origin: "repo", plugin: "project" },
  ],
  skillNameClashes: ["review"],
  builtInSkills: true,
  mcpServers: [{ name: "paperclip", url: "http://localhost:3100/mcp" }],
  strictMcpConfig: true,
  access: { level: "worker", overrides: {} },
  instructions: { entryFile: "AGENTS.md", sent: true },
  claudeMd: { enabled: false, reason: "no_project" },
  repoSkills: { enabled: false, reason: "project_switch_off" },
  autoMemory: false,
  envKeys: [],
  extraArgs: [],
  session: { mode: "fresh", reason: "no_saved_session" },
  github: { mode: "server_login" },
};

/** Each row's label and value text, in order. */
function rows() {
  const list = screen.getByRole("heading", { name: "What this run got" }).closest("section")!.querySelector(".ri-kvl")!;
  return [...list.children].map((row) => [row.children[0]!.firstChild!.textContent!.trim(), row.children[1]!.textContent!.trim()]);
}

describe("the run modal's What this run got", () => {
  it("lists the manifest's rows, as before the rows were shared", () => {
    render(() => <RunManifest manifest={manifest} />);
    expect(rows()).toEqual([
      ["Credential", "Claude subscription · connection Brian's Max"],
      ["Skills", "PaperclippaperclipCompanyreview (loaded twice)Repositoryreview (loaded twice)"],
      ["Repo skills", "Not loaded: off for this project"],
      ["MCP servers", "paperclip"],
      ["GitHub", "This server's GitHub login"],
      ["Access", "Worker"],
      ["CLAUDE.md", "Not loaded: the run has no project"],
      ["Instructions", "AGENTS.md, sent"],
      ["Session", "A new session: there was no saved session"],
      ["Auto memory", "Off"],
      ["Set aside", "settings.json"],
      ["Overridden", "CLAUDE_CONFIG_DIR"],
    ]);
  });

  it("keeps help behind the i buttons and shows no count", () => {
    render(() => <RunManifest manifest={{ ...manifest, setAside: null, overriddenEnv: [], github: undefined, repoSkills: { enabled: true, dir: "/r/.claude/skills", count: 1 } }} />);
    for (const name of ["About What this run got", "About Skills", "About MCP servers"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    const labels = rows().map(([label]) => label);
    expect(labels).not.toContain("Repo skills");
    expect(labels).not.toContain("GitHub");
    expect(labels).not.toContain("Set aside");
    expect(labels).not.toContain("Overridden");
    expect(within(screen.getByRole("heading", { name: "What this run got" }).closest("section")!).queryByText(/\d+ skills?$/)).toBeNull();
  });
});
