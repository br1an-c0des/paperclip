import { describe, expect, it } from "vitest";
import { isClaudeRunManifest, type ClaudeRunManifest } from "./claude-run-manifest.js";

const minimalManifest: ClaudeRunManifest = {
  version: 1,
  engine: "cli",
  configDir: "/agents/a1/claude-config",
  settingSources: ["user"],
  credential: {
    kind: "managed_connection",
    method: "subscription",
    connectionId: "conn-1",
    connectionName: "Claude Max",
  },
  setAside: null,
  overriddenEnv: [],
  skills: [
    { name: "paperclip", key: "paperclipai/paperclip/paperclip", origin: "always_on", plugin: "paperclip" },
    { name: "review", key: "repo:.claude/skills/review", origin: "repo", plugin: "project" },
  ],
  skillNameClashes: [],
  builtInSkills: true,
  mcpServers: [{ name: "paperclip", url: "http://localhost:3100/mcp" }],
  strictMcpConfig: true,
  access: null,
  instructions: { entryFile: null, sent: false },
  claudeMd: { enabled: false, reason: "no_project" },
  repoSkills: { enabled: false, reason: "no_project" },
  autoMemory: false,
  envKeys: [],
  extraArgs: [],
  session: { mode: "fresh", reason: "no_saved_session" },
};

describe("isClaudeRunManifest", () => {
  it("accepts a minimal valid manifest", () => {
    expect(isClaudeRunManifest(minimalManifest)).toBe(true);
  });

  it("accepts a manifest that came through JSON", () => {
    expect(isClaudeRunManifest(JSON.parse(JSON.stringify(minimalManifest)))).toBe(true);
  });

  it("rejects another version", () => {
    expect(isClaudeRunManifest({ version: 2 })).toBe(false);
    expect(isClaudeRunManifest({ ...minimalManifest, version: 2 })).toBe(false);
  });

  it("rejects null and non-objects", () => {
    expect(isClaudeRunManifest(null)).toBe(false);
    expect(isClaudeRunManifest(undefined)).toBe(false);
    expect(isClaudeRunManifest("manifest")).toBe(false);
    expect(isClaudeRunManifest(1)).toBe(false);
  });

  it("rejects an ACP-shaped object", () => {
    expect(isClaudeRunManifest({ ...minimalManifest, engine: "acp" })).toBe(false);
    expect(isClaudeRunManifest({ engine: "acp", sessionId: "s1" })).toBe(false);
  });
});
