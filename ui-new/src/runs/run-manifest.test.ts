import { describe, expect, it } from "vitest";
import { githubText } from "./run-manifest";

describe("the manifest's GitHub line", () => {
  it("names the connection's account and source", () => {
    expect(githubText({ mode: "connection", identitySource: "personal", login: "octocat" })).toBe("Connection: octocat (personal)");
    expect(githubText({ mode: "connection", identitySource: "dedicated", login: "builder-bot" })).toBe("Connection: builder-bot (dedicated)");
    expect(githubText({ mode: "connection", identitySource: "personal", login: null })).toBe("Connection: account not recorded (personal)");
    expect(githubText({ mode: "connection", identitySource: "shared", login: null })).toBe("Connection: account not recorded (shared)");
  });

  it("names the server's login, or none", () => {
    expect(githubText({ mode: "server_login" })).toBe("This server's GitHub login");
    expect(githubText({ mode: "none" })).toBe("None");
  });

  it("shows nothing for an older manifest or an unknown mode", () => {
    expect(githubText(undefined)).toBeNull();
    expect(githubText({ mode: "host" } as never)).toBeNull();
  });
});
