import { describe, expect, it } from "vitest";
import { isClaudeRunManifest } from "@paperclipai/shared";
import {
  buildClaudeRunManifest,
  parseClaudeRunAccess,
  summarizeClaudeRunManifest,
  type ClaudeRunManifestInput,
} from "./run-manifest.js";

function fullInput(overrides: Partial<ClaudeRunManifestInput> = {}): ClaudeRunManifestInput {
  return {
    configDir: "/paperclip/companies/co/agents/ag/claude-config",
    credential: { kind: "agent_env", method: "subscription", connectionId: null, connectionName: null },
    setAside: { dir: "/paperclip/companies/co/agents/ag/claude-config-set-aside/run-1", entries: ["skills", "settings.json"] },
    overriddenEnv: ["HOME", "CLAUDE_CONFIG_DIR"],
    skills: [
      { key: "paperclipai/paperclip/paperclip", runtimeName: "paperclip" },
      { key: "paperclipai/paperclip/complain", runtimeName: "complain" },
      { key: "paperclipai/paperclip/paperclip-create-agent", runtimeName: "paperclip-create-agent" },
      { key: "company/co/frontend-design", runtimeName: "frontend-design" },
    ],
    repoSkills: {
      load: { enabled: true, dir: "/repo/.claude/skills", count: 2 },
      skills: [
        { name: "frontend-design", dir: "/repo/.claude/skills/frontend-design" },
        { name: "release", dir: "/repo/.claude/skills/release" },
      ],
    },
    mcpServers: [
      { name: "paperclip", url: "http://127.0.0.1:3100/api/mcp/paperclip", token: "run-secret-token", connectionId: "paperclip" } as never,
      { name: "GitHub", url: "https://example.test/github/mcp" },
    ],
    access: { level: "worker", overrides: { "tasks:delete": true } },
    instructions: { entryFile: "/agents/ag/AGENTS.md", sent: true },
    claudeMd: { enabled: true, path: "/repo/CLAUDE.md" },
    env: { PATH: "/usr/bin", HOME: "/tmp/home", CLAUDE_CODE_OAUTH_TOKEN: "secret", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
    extraArgs: ["--debug"],
    session: { mode: "fresh", reason: "no_saved_session" },
    ...overrides,
  };
}

describe("buildClaudeRunManifest", () => {
  it("maps a full input to the manifest", () => {
    const manifest = buildClaudeRunManifest(fullInput());

    expect(isClaudeRunManifest(manifest)).toBe(true);
    expect(manifest).toEqual({
      version: 1,
      engine: "cli",
      configDir: "/paperclip/companies/co/agents/ag/claude-config",
      settingSources: ["user"],
      credential: { kind: "agent_env", method: "subscription", connectionId: null, connectionName: null },
      setAside: {
        dir: "/paperclip/companies/co/agents/ag/claude-config-set-aside/run-1",
        entries: ["settings.json", "skills"],
      },
      overriddenEnv: ["CLAUDE_CONFIG_DIR", "HOME"],
      skills: [
        { name: "paperclip", key: "paperclipai/paperclip/paperclip", origin: "always_on", plugin: "paperclip" },
        { name: "complain", key: "paperclipai/paperclip/complain", origin: "always_on", plugin: "paperclip" },
        {
          name: "paperclip-create-agent",
          key: "paperclipai/paperclip/paperclip-create-agent",
          origin: "assigned",
          plugin: "paperclip",
        },
        { name: "frontend-design", key: "company/co/frontend-design", origin: "assigned", plugin: "company" },
        { name: "frontend-design", key: "repo:.claude/skills/frontend-design", origin: "repo", plugin: "project" },
        { name: "release", key: "repo:.claude/skills/release", origin: "repo", plugin: "project" },
      ],
      skillNameClashes: ["frontend-design"],
      builtInSkills: true,
      mcpServers: [
        { name: "paperclip", url: "http://127.0.0.1:3100/api/mcp/paperclip" },
        { name: "GitHub", url: "https://example.test/github/mcp" },
      ],
      strictMcpConfig: true,
      access: { level: "worker", overrides: { "tasks:delete": true } },
      instructions: { entryFile: "/agents/ag/AGENTS.md", sent: true },
      claudeMd: { enabled: true, path: "/repo/CLAUDE.md" },
      repoSkills: { enabled: true, dir: "/repo/.claude/skills", count: 2 },
      autoMemory: false,
      envKeys: ["CLAUDE_CODE_DISABLE_AUTO_MEMORY", "CLAUDE_CODE_OAUTH_TOKEN", "HOME", "PATH"],
      extraArgs: ["--debug"],
      session: { mode: "fresh", reason: "no_saved_session" },
    });
  });

  it("uses plain skill names, with the plugin by key", () => {
    const manifest = buildClaudeRunManifest(fullInput());
    for (const skill of manifest.skills) expect(skill.name).not.toContain(":");
    expect(manifest.skills.find((skill) => skill.key === "company/co/frontend-design")?.plugin).toBe("company");
    expect(manifest.skills.find((skill) => skill.key === "paperclipai/paperclip/complain")?.plugin).toBe("paperclip");
  });

  it("lists repo skills last, from the project plugin", () => {
    const manifest = buildClaudeRunManifest(fullInput());
    const origins = manifest.skills.map((skill) => skill.origin);
    expect(origins.slice(-2)).toEqual(["repo", "repo"]);
    expect(manifest.skills.filter((skill) => skill.origin === "repo").every((skill) => skill.plugin === "project")).toBe(true);
  });

  it("lists no repo skills and no clash when the repo's skills are skipped", () => {
    const manifest = buildClaudeRunManifest(fullInput({
      repoSkills: { load: { enabled: false, reason: "project_switch_off" }, skills: [] },
      claudeMd: { enabled: false, reason: "not_in_repo" },
    }));
    expect(manifest.skills.some((skill) => skill.origin === "repo")).toBe(false);
    expect(manifest.skillNameClashes).toEqual([]);
    expect(manifest.repoSkills).toEqual({ enabled: false, reason: "project_switch_off" });
    expect(manifest.claudeMd).toEqual({ enabled: false, reason: "not_in_repo" });
  });

  it("never carries an MCP server's token or an env value", () => {
    const serialized = JSON.stringify(buildClaudeRunManifest(fullInput()));
    expect(serialized).not.toContain("run-secret-token");
    expect(serialized).not.toContain("secret\"");
    expect(serialized).not.toContain("/usr/bin");
  });

  it("records no set-aside folder when nothing moved", () => {
    expect(buildClaudeRunManifest(fullInput({ setAside: { dir: "/x", entries: [] } })).setAside).toBeNull();
  });

  it("records a resumed session", () => {
    const manifest = buildClaudeRunManifest(fullInput({
      session: { mode: "resumed", sessionId: "11111111-1111-4111-8111-111111111111" },
      instructions: { entryFile: "/agents/ag/AGENTS.md", sent: false },
    }));
    expect(manifest.session).toEqual({ mode: "resumed", sessionId: "11111111-1111-4111-8111-111111111111" });
    expect(manifest.instructions.sent).toBe(false);
  });
});

describe("parseClaudeRunAccess", () => {
  it("keeps a known level and its overrides", () => {
    expect(parseClaudeRunAccess({ level: "manager", overrides: { "agents:create": false } }))
      .toEqual({ level: "manager", overrides: { "agents:create": false } });
    expect(parseClaudeRunAccess({ level: "read_only" })).toEqual({ level: "read_only", overrides: {} });
  });

  it("is null for a missing or unknown access", () => {
    expect(parseClaudeRunAccess(undefined)).toBeNull();
    expect(parseClaudeRunAccess(null)).toBeNull();
    expect(parseClaudeRunAccess({ level: "owner" })).toBeNull();
  });
});

describe("summarizeClaudeRunManifest", () => {
  it("summarises a loaded run", () => {
    expect(summarizeClaudeRunManifest(buildClaudeRunManifest(fullInput())))
      .toBe("Sealed run: 4 skills, 2 MCP servers, CLAUDE.md loaded, repo skills 2.");
  });

  it("names the skip reasons", () => {
    expect(summarizeClaudeRunManifest(buildClaudeRunManifest(fullInput({
      repoSkills: { load: { enabled: false, reason: "no_project" }, skills: [] },
      claudeMd: { enabled: false, reason: "no_project" },
    })))).toBe("Sealed run: 4 skills, 2 MCP servers, CLAUDE.md skipped: no_project, repo skills skipped: no_project.");
  });
});
