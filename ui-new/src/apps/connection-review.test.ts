import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { toolsApi } from "@/api/tools";
import { githubRecoveryUrl, reviewBadgeCount } from "./apps-model";

const installationError = (managementUrl: unknown) =>
  new ApiError("The GitHub App installation is suspended", 409, {
    error: "The GitHub App installation is suspended",
    details: { code: "github_installation_required", managementUrl },
  });

describe("a connection's Review badge", () => {
  it("counts each waiting call, and held-back actions once", () => {
    expect(reviewBadgeCount({ pendingActionRequestCount: 2, quarantinedCatalogEntryCount: 5 })).toBe(3);
    expect(reviewBadgeCount({ pendingActionRequestCount: 0, quarantinedCatalogEntryCount: 0 })).toBe(0);
    expect(reviewBadgeCount(undefined)).toBe(0);
  });

  it("reads the counts and profiles for one connection", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await toolsApi.reviewCounts("t 1");
    await toolsApi.profileConfiguration("t 1");
    expect(fetch.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      "/api/tool-connections/t%201/review-counts",
      "/api/tool-connections/t%201/profile-configuration",
    ]);
  });

  afterEach(() => vi.unstubAllGlobals());
});

describe("GitHub access recovery", () => {
  it("links to the installation settings when the installation is suspended", () => {
    expect(githubRecoveryUrl(installationError("https://github.com/organizations/acme/settings/installations/42"))).toBe(
      "https://github.com/organizations/acme/settings/installations/42",
    );
  });

  it("never links anywhere but github.com over https", () => {
    expect(githubRecoveryUrl(installationError("http://github.com/settings/installations/42"))).toBeNull();
    expect(githubRecoveryUrl(installationError("https://evil.example/settings"))).toBeNull();
    expect(githubRecoveryUrl(installationError("not a url"))).toBeNull();
    expect(githubRecoveryUrl(installationError(42))).toBeNull();
  });

  it("ignores other failures", () => {
    expect(githubRecoveryUrl(new ApiError("Boom", 500, { error: "Boom" }))).toBeNull();
    expect(githubRecoveryUrl(new Error("offline"))).toBeNull();
    expect(githubRecoveryUrl(null)).toBeNull();
  });
});
