import { describe, expect, it } from "vitest";
import { parseSettingsPath, sectionHref, transferRedirect } from "./sections";

describe("parseSettingsPath", () => {
  it("opens General at the root", () => {
    expect(parseSettingsPath(undefined)).toEqual({ kind: "section", key: "general" });
    expect(parseSettingsPath("")).toEqual({ kind: "section", key: "general" });
    expect(parseSettingsPath("/")).toEqual({ kind: "section", key: "general" });
  });

  it("knows each section's address", () => {
    for (const key of ["members", "connections", "secrets", "budgets", "environments", "transfer"] as const) {
      expect(parseSettingsPath(key)).toEqual({ kind: "section", key });
    }
  });

  it("sends a deeper address to its section", () => {
    expect(parseSettingsPath("secrets/abc")).toEqual({ kind: "redirect", key: "secrets" });
  });

  it("lands the old UI's addresses on the matching section", () => {
    expect(parseSettingsPath("access")).toEqual({ kind: "redirect", key: "members" });
    expect(parseSettingsPath("invites")).toEqual({ kind: "redirect", key: "members", anchor: "invites" });
    expect(parseSettingsPath("members", "?tab=invites")).toEqual({ kind: "redirect", key: "members", anchor: "invites" });
    expect(parseSettingsPath("members", "?tab=members")).toEqual({ kind: "section", key: "members" });
    expect(parseSettingsPath("cloud-upstream")).toEqual({ kind: "redirect", key: "transfer" });
    expect(parseSettingsPath("instance/environments")).toEqual({ kind: "redirect", key: "environments" });
    expect(parseSettingsPath("instance/environments/new")).toEqual({ kind: "redirect", key: "environments" });
    expect(parseSettingsPath("instance/environments/env-1/edit")).toEqual({ kind: "redirect", key: "environments" });
  });

  it("leaves the other instance pages to app settings", () => {
    expect(parseSettingsPath("instance/profile")).toEqual({ kind: "instance" });
    expect(parseSettingsPath("instance")).toEqual({ kind: "instance" });
  });

  it("treats any other first segment as a plugin page", () => {
    expect(parseSettingsPath("linear-sync")).toEqual({ kind: "plugin", routePath: "linear-sync" });
    expect(parseSettingsPath("linear-sync/teams")).toEqual({ kind: "plugin", routePath: "linear-sync" });
  });
});

describe("sectionHref", () => {
  it("builds a section's address, with an anchor", () => {
    expect(sectionHref("/TES/company/settings", "general")).toBe("/TES/company/settings");
    expect(sectionHref("/TES/company/settings", "members", "invites")).toBe("/TES/company/settings/members#invites");
    expect(transferRedirect("/TES/company/settings", "import")).toBe("/TES/company/settings/transfer#import");
  });
});
