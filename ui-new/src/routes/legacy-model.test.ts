import { describe, expect, it } from "vitest";
import { caseLinkTarget, companyLegacyTarget, identifierPrefix, isUuid, legacyToolsTarget, projectLegacyTab, withSearchAndHash } from "./legacy-model";

describe("identifierPrefix", () => {
  it("reads the company prefix of a task or case identifier", () => {
    expect(identifierPrefix("PAP-123")).toBe("PAP");
    expect(identifierPrefix("tes-6")).toBe("tes");
    expect(identifierPrefix("PAP-C7")).toBe("PAP");
  });

  it("is null for anything else", () => {
    expect(identifierPrefix("0b6f0c56-6f0a-4a4e-9d6c-1f6d2b6c7a10")).toBeNull();
    expect(identifierPrefix("PAP")).toBeNull();
    expect(identifierPrefix("PAP-abc")).toBeNull();
  });
});

describe("isUuid", () => {
  it("tells ids from identifiers", () => {
    expect(isUuid("0b6f0c56-6f0a-4a4e-9d6c-1f6d2b6c7a10")).toBe(true);
    expect(isUuid("PAP-1")).toBe(false);
  });
});

describe("withSearchAndHash", () => {
  it("keeps the query and the fragment", () => {
    expect(withSearchAndHash("issues/PAP-1", "?a=1", "#comment-x")).toBe("issues/PAP-1?a=1#comment-x");
    expect(withSearchAndHash("issues", "", "")).toBe("issues");
  });

  it("lets the target's own query win", () => {
    expect(withSearchAndHash("issues?view=done", "?view=all&q=x", "")).toBe("issues?view=done&q=x");
  });
});

describe("legacyToolsTarget", () => {
  it("follows the old UI's Tools redirects", () => {
    expect(legacyToolsTarget()).toBe("apps/advanced/profiles");
    expect(legacyToolsTarget("connections")).toBe("apps");
    expect(legacyToolsTarget("policies")).toBe("apps/advanced/profiles");
    expect(legacyToolsTarget("mcp")).toBe("apps/advanced/mcp");
  });
});

describe("companyLegacyTarget", () => {
  it.each([
    ["issues/active", "issues?view=active"],
    ["issues/done", "issues?view=done"],
    ["issues/recent", "issues"],
    ["tasks", "issues"],
    ["dashboard/live", "dashboard"],
    ["decisions", "inbox"],
    ["decisions/queue/mine", "inbox"],
    ["approvals", "inbox"],
    ["approvals/pending", "inbox"],
    ["goals", "dashboard"],
    ["tools", "apps/advanced/profiles"],
    ["tools/overview", "apps"],
    ["company/settings/tools/mcp", "apps/advanced/mcp"],
    ["companies", "/companies"],
    ["board-chat", "chats"],
    ["artifacts", "search?scope=artifacts"],
    ["cases", "issues?group=case"],
    ["status-cards/abc", "status/abc"],
  ])("%s goes to %s", (from, to) => {
    expect(companyLegacyTarget(from)).toBe(to);
  });

  it("leaves current addresses alone", () => {
    expect(companyLegacyTarget("issues")).toBeNull();
    expect(companyLegacyTarget("issues/PAP-1")).toBeNull();
    expect(companyLegacyTarget("approvals/all")).toBeNull();
    expect(companyLegacyTarget("approvals/0b6f0c56-6f0a-4a4e-9d6c-1f6d2b6c7a10")).toBeNull();
    expect(companyLegacyTarget("goals/g1")).toBeNull();
    expect(companyLegacyTarget("dashboard")).toBeNull();
    expect(companyLegacyTarget("company/settings")).toBeNull();
  });
});

describe("caseLinkTarget", () => {
  it("opens the main task's Case section, else the first linked task's, else the list by case", () => {
    expect(caseLinkTarget({ workIssueId: "uuid-1", workIssue: { identifier: "TES-19" } })).toBe("issues/TES-19?section=case");
    expect(caseLinkTarget({ workIssueId: "uuid-1", workIssue: null })).toBe("issues/uuid-1?section=case");
    expect(caseLinkTarget({ workIssueId: null, issueLinks: [{ issue: { id: "uuid-2", identifier: "TES-20" } }] })).toBe("issues/TES-20?section=case");
    expect(caseLinkTarget({ workIssueId: null, issueLinks: [] })).toBe("issues?group=case");
  });
});

describe("projectLegacyTab", () => {
  it("sends the old tabs to settings sections", () => {
    expect(projectLegacyTab("configuration")).toBe("settings");
    expect(projectLegacyTab("budget")).toBe("settings/budget");
    expect(projectLegacyTab("workspaces")).toBe("settings/code");
    expect(projectLegacyTab("workspaces/w1")).toBe("settings/code");
    expect(projectLegacyTab("issues")).toBeNull();
  });
});
