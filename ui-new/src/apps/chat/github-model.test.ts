import type { GitHubChatConfiguration, GitHubReviewPolicy } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { ChatEndpoint, ChatIdentityLink } from "@/api/chat-endpoints";
import {
  appSettingsUrl,
  botMention,
  defaultAppName,
  failingChecks,
  knownOrganizations,
  lines,
  manifestAction,
  mentionsAllowed,
  parseScore,
  peopleRows,
  toggleEvent,
  wizardPollMs,
  withoutPerson,
  withPerson,
} from "./github-model";

describe("guided registration", () => {
  it("posts manifests to GitHub's new-App pages only", () => {
    expect(manifestAction("https://github.com/settings/apps/new?state=x")).toBe("https://github.com/settings/apps/new?state=x");
    expect(manifestAction("https://github.com/organizations/acme-co/settings/apps/new")).toContain("acme-co");
    expect(() => manifestAction("https://evil.example/settings/apps/new")).toThrow();
    expect(() => manifestAction("https://user:pw@github.com/settings/apps/new")).toThrow();
    expect(() => manifestAction("https://github.com/settings/apps/new#x")).toThrow();
    expect(() => manifestAction("https://github.com/login")).toThrow();
  });

  it("polls until the state settles", () => {
    expect(wizardPollMs("install")).toBe(5000);
    expect(wizardPollMs("verify")).toBe(5000);
    expect(wizardPollMs("create")).toBe(false);
    expect(wizardPollMs("connected")).toBe(false);
  });

  it("collects organizations from project repositories and live bots", () => {
    const endpoints = [
      { provider: "github", status: "active", setup: { step: "complete", github: { stage: "test", ownerType: "organization", ownerLogin: "Beta" } } },
      { provider: "github", status: "draft", setup: { step: "provider_setup", github: { stage: "setup", ownerType: "organization", ownerLogin: "Draft" } } },
    ] as unknown as ChatEndpoint[];
    const repositories = [
      { fullName: "acme/one", ownerType: "organization" },
      { fullName: "ACME/two", ownerType: "organization" },
      { fullName: "me/three", ownerType: "user" },
    ];
    expect(knownOrganizations(repositories, endpoints)).toEqual(["ACME", "Beta"]);
  });

  it("names the App after the agent, within GitHub's limit", () => {
    expect(defaultAppName("")).toBe("GitHub Reviewer");
    expect(defaultAppName("x".repeat(40))).toHaveLength(34);
  });

  it("hides delivery checks once a delivery arrived", () => {
    const state = {
      endpointId: "e",
      state: "verify" as const,
      verification: {
        ready: false,
        checks: [
          { key: "webhook", label: "Webhook", ok: false, detail: "" },
          { key: "repos", label: "Repositories", ok: false, detail: "" },
          { key: "app", label: "App", ok: true, detail: "" },
        ],
      },
    };
    expect(failingChecks(state, false).map((check) => check.key)).toEqual(["webhook", "repos"]);
    expect(failingChecks(state, true).map((check) => check.key)).toEqual(["repos"]);
  });

  it("builds the @mention and the App's settings address", () => {
    const endpoint = { botUsername: "review-bot[bot]", setup: { step: "complete", github: { stage: "test", appOwnerType: "organization", appOwnerLogin: "acme" } } } as unknown as ChatEndpoint;
    expect(botMention(endpoint)).toBe("@review-bot");
    expect(appSettingsUrl(endpoint)).toBe("https://github.com/organizations/acme/settings/apps/review-bot");
    expect(appSettingsUrl({ ...endpoint, setup: { step: "complete" } } as ChatEndpoint)).toBe("https://github.com/settings/apps");
  });
});

const configuration = (over: Partial<GitHubChatConfiguration> = {}): GitHubChatConfiguration => ({
  version: 1,
  toolsEnabled: true,
  responsibleUserId: "u1",
  memberAccess: "selected",
  people: [],
  defaults: { invocation: "linked_authors", events: ["opened"] } as GitHubReviewPolicy,
  repositories: {},
  ...over,
});

describe("people", () => {
  const links = [
    { id: "1", principalId: "p1", externalLabel: "ann", status: "linked", githubUserId: "g1", githubLogin: "ann", paperclipUserId: "u1", paperclipUserLabel: "Ann" },
    { id: "2", principalId: "p2", externalLabel: "bob", status: "revoked", githubUserId: "g2", githubLogin: "bob", paperclipUserId: "u2" },
  ] as ChatIdentityLink[];

  it("keeps configured members whose link was revoked and adds linked ones", () => {
    const config = configuration({ people: [{ kind: "member", userId: "u2", githubUserId: "g2", login: "bob" }] });
    const rows = peopleRows(config, links);
    expect(rows.members.map((row) => [row.login, row.linked, row.explicit])).toEqual([
      ["bob", false, true],
      ["ann", true, false],
    ]);
    expect(mentionsAllowed(config, rows.members[1]!)).toBe(false);
    expect(mentionsAllowed({ ...config, memberAccess: "all_linked" }, rows.members[1]!)).toBe(true);
  });

  it("adds, replaces and removes people by GitHub ID", () => {
    const guest = { kind: "guest" as const, githubUserId: "g9", login: "octo", sponsorUserId: "u1", permissionProfile: "restricted" as const };
    const added = withPerson(configuration(), guest);
    expect(added.people).toHaveLength(1);
    expect(withPerson(added, { ...guest, login: "octocat" }).people[0]!.login).toBe("octocat");
    expect(withoutPerson(added, "g9").people).toHaveLength(0);
  });
});

describe("review policy", () => {
  it("splits lists by line", () => {
    expect(lines(" main\n\n release/* \n")).toEqual(["main", "release/*"]);
  });

  it("accepts a whole passing score from 1 to 5, or report only", () => {
    expect(parseScore("4", false)).toEqual({ ok: true, value: 4 });
    expect(parseScore("6", false).ok).toBe(false);
    expect(parseScore("", false).ok).toBe(false);
    expect(parseScore("2.5", false).ok).toBe(false);
    expect(parseScore("", true)).toEqual({ ok: true, value: null });
  });

  it("keeps events in their canonical order", () => {
    const policy = { events: ["mention"] } as unknown as GitHubReviewPolicy;
    expect(toggleEvent(policy, "opened", true).events).toEqual(["opened", "mention"]);
    expect(toggleEvent(policy, "mention", false).events).toEqual([]);
  });
});
