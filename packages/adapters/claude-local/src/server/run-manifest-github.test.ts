import { describe, expect, it } from "vitest";
import { buildClaudeRunManifest, parseClaudeRunGitHub, type ClaudeRunManifestInput } from "./run-manifest.js";

/** The manifest's `github` field (step 4b, agent F): copied from `context.paperclipGitHub`. */

function input(github?: unknown): ClaudeRunManifestInput {
  return {
    configDir: "/paperclip/companies/co/agents/ag/claude-config",
    credential: { kind: "agent_env", method: "subscription", connectionId: null, connectionName: null },
    setAside: { dir: "/paperclip/set-aside", entries: [] },
    overriddenEnv: [],
    skills: [],
    repoSkills: { load: { enabled: false, reason: "no_project" }, skills: [] },
    mcpServers: [],
    access: null,
    ...(github === undefined ? {} : { github }),
    instructions: { entryFile: null, sent: false },
    claudeMd: { enabled: false, reason: "no_project" },
    env: {},
    extraArgs: [],
    session: { mode: "fresh", reason: "no_saved_session" },
  };
}

describe("the manifest's GitHub", () => {
  it("records a connection with its account", () => {
    expect(buildClaudeRunManifest(input({ mode: "connection", identitySource: "dedicated", login: "builder-bot" })).github)
      .toEqual({ mode: "connection", identitySource: "dedicated", login: "builder-bot" });
  });

  it.each(["server_login", "none"] as const)("records %s", (mode) => {
    expect(buildClaudeRunManifest(input({ mode })).github).toEqual({ mode });
  });

  it("leaves the field out when the server passed nothing, and stays version 1", () => {
    const manifest = buildClaudeRunManifest(input());
    expect(manifest).not.toHaveProperty("github");
    expect(manifest.version).toBe(1);
  });
});

describe("parseClaudeRunGitHub", () => {
  it("keeps only the known fields", () => {
    expect(parseClaudeRunGitHub({ mode: "connection", identitySource: "personal", login: " octocat ", token: "x" }))
      .toEqual({ mode: "connection", identitySource: "personal", login: "octocat" });
    expect(parseClaudeRunGitHub({ mode: "connection", identitySource: "shared", login: null }))
      .toEqual({ mode: "connection", identitySource: "shared", login: null });
    expect(parseClaudeRunGitHub({ mode: "connection" })).toEqual({ mode: "connection", identitySource: "personal", login: null });
    expect(parseClaudeRunGitHub({ mode: "none", extra: 1 })).toEqual({ mode: "none" });
  });

  it("is null for a missing or unknown shape", () => {
    expect(parseClaudeRunGitHub(undefined)).toBeNull();
    expect(parseClaudeRunGitHub("none")).toBeNull();
    expect(parseClaudeRunGitHub({ mode: "host" })).toBeNull();
  });
});
