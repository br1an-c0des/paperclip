import { describe, expect, it } from "vitest";
import {
  CLAUDE_CREDENTIAL_MISSING,
  PAPERCLIP_MCP_UNAVAILABLE,
  SEALED_HOST_ENV_KEYS,
  projectSealedHostEnvironment,
  resolveClaudeRunCredential,
} from "./sealed-env.js";

describe("projectSealedHostEnvironment", () => {
  const host: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    TZ: "UTC",
    HTTPS_PROXY: "http://proxy:3128",
    NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
    HOME: "/home/server",
    USERPROFILE: "C:\\Users\\server",
    XDG_CONFIG_HOME: "/home/server/.config",
    XDG_DATA_HOME: "/home/server/.local/share",
    XDG_CACHE_HOME: "/home/server/.cache",
    BETTER_AUTH_SECRET: "secret",
    PAPERCLIP_AGENT_JWT_SECRET: "jwt",
    DATABASE_URL: "postgres://x",
    ANTHROPIC_API_KEY: "",
    CLAUDE_CODE_OAUTH_TOKEN: "host-token",
    CLAUDE_CONFIG_DIR: "/home/server/.claude",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0",
    GITHUB_TOKEN: "ghp_x",
  };

  it("keeps the allowlisted host values", () => {
    const env = projectSealedHostEnvironment(host);
    expect(env).toMatchObject({
      PATH: "/usr/bin",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      TZ: "UTC",
      HTTPS_PROXY: "http://proxy:3128",
      NODE_EXTRA_CA_CERTS: "/etc/ca.pem",
    });
  });

  it("drops home folders, server secrets, credentials and Claude settings", () => {
    const env = projectSealedHostEnvironment(host);
    for (const key of [
      "HOME",
      "USERPROFILE",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_CACHE_HOME",
      "BETTER_AUTH_SECRET",
      "PAPERCLIP_AGENT_JWT_SECRET",
      "DATABASE_URL",
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CONFIG_DIR",
      "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
      "GITHUB_TOKEN",
    ]) {
      expect(env, key).not.toHaveProperty(key);
    }
  });

  it("skips undefined values and leaves no HOME-like key on the allowlist", () => {
    expect(projectSealedHostEnvironment({ PATH: undefined, TZ: "UTC" })).toEqual({ TZ: "UTC" });
    for (const key of ["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"]) {
      expect(SEALED_HOST_ENV_KEYS.has(key), key).toBe(false);
    }
  });
});

describe("resolveClaudeRunCredential", () => {
  const none = { managedAiConnection: undefined, managedAiRouting: undefined, connectionName: null };

  it("names the error codes", () => {
    expect(CLAUDE_CREDENTIAL_MISSING).toBe("claude_credential_missing");
    expect(PAPERCLIP_MCP_UNAVAILABLE).toBe("paperclip_mcp_unavailable");
  });

  it("a managed subscription connection", () => {
    expect(resolveClaudeRunCredential({
      env: {},
      managedAiConnection: { connectionId: "conn-1", method: "subscription", provider: "anthropic" },
      managedAiRouting: undefined,
      connectionName: "Brian's Max",
    })).toEqual({ kind: "managed_connection", method: "subscription", connectionId: "conn-1", connectionName: "Brian's Max" });
  });

  it("a managed API key connection wins over the agent's env", () => {
    expect(resolveClaudeRunCredential({
      env: { CLAUDE_CODE_OAUTH_TOKEN: "agent-token" },
      managedAiConnection: { connectionId: "conn-2", method: "api_key" },
      managedAiRouting: null,
      connectionName: null,
    })).toEqual({ kind: "managed_connection", method: "api_key", connectionId: "conn-2", connectionName: null });
  });

  it("a routed managed connection", () => {
    expect(resolveClaudeRunCredential({
      env: {},
      managedAiConnection: { connectionId: "conn-3", method: "api_key" },
      managedAiRouting: { provider: "openrouter" },
      connectionName: "Router",
    })).toEqual({ kind: "managed_connection", method: "routed", connectionId: "conn-3", connectionName: "Router" });
  });

  it.each([
    [{ CLAUDE_CODE_OAUTH_TOKEN: "t" }, "subscription"],
    [{ ANTHROPIC_API_KEY: "k" }, "api_key"],
    [{ ANTHROPIC_AUTH_TOKEN: "a" }, "auth_token"],
    [{ CLAUDE_CODE_USE_BEDROCK: "1" }, "bedrock"],
    [{ CLAUDE_CODE_USE_BEDROCK: "true" }, "bedrock"],
    [{ CLAUDE_CODE_USE_VERTEX: "1" }, "vertex"],
    [{ CLAUDE_CODE_USE_FOUNDRY: "TRUE" }, "foundry"],
    [{ CLAUDE_CODE_OAUTH_TOKEN: "t", ANTHROPIC_API_KEY: "k" }, "subscription"],
    [{ ANTHROPIC_API_KEY: "k", CLAUDE_CODE_USE_BEDROCK: "1" }, "api_key"],
  ] as const)("agent env %o is %s", (env, method) => {
    expect(resolveClaudeRunCredential({ ...none, env: { ...env } })).toEqual({
      kind: "agent_env",
      method,
      connectionId: null,
      connectionName: null,
    });
  });

  it("empty and blank values are not a credential", () => {
    expect(resolveClaudeRunCredential({ ...none, env: { ANTHROPIC_API_KEY: "", CLAUDE_CODE_OAUTH_TOKEN: "  " } })).toBeNull();
    expect(resolveClaudeRunCredential({ ...none, env: { CLAUDE_CODE_USE_BEDROCK: "0", CLAUDE_CODE_USE_VERTEX: "false" } })).toBeNull();
    expect(resolveClaudeRunCredential({ ...none, env: {} })).toBeNull();
  });
});
