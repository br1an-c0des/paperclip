import { describe, expect, it } from "vitest";
import { serverGitHubLoginPatch, usesServerGitHubLogin } from "./ToolsSection";

describe("Use this server's GitHub login", () => {
  it("is on only when runtimeConfig.github.useServerLogin is true", () => {
    expect(usesServerGitHubLogin({ github: { useServerLogin: true } })).toBe(true);
    expect(usesServerGitHubLogin({ github: { useServerLogin: false } })).toBe(false);
    expect(usesServerGitHubLogin({})).toBe(false);
    expect(usesServerGitHubLogin(undefined)).toBe(false);
  });

  it("turning it on keeps the rest of the runtime config", () => {
    const runtimeConfig = { heartbeat: { enabled: true }, aiConnection: { mode: "default" } } as never;
    expect(serverGitHubLoginPatch({ runtimeConfig }, true)).toEqual({
      runtimeConfig: { heartbeat: { enabled: true }, aiConnection: { mode: "default" }, github: { useServerLogin: true } },
    });
  });

  it("turning it off removes the setting", () => {
    expect(serverGitHubLoginPatch({ runtimeConfig: { heartbeat: { enabled: true }, github: { useServerLogin: true } } }, false)).toEqual({
      runtimeConfig: { heartbeat: { enabled: true } },
    });
  });
});
