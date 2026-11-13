import { describe, expect, it } from "vitest";
import { companySettingsEntries, parseSettingsPath, sectionHref, transferRedirect } from "./sections";

describe("parseSettingsPath", () => {
  it("opens General at the root", () => {
    expect(parseSettingsPath(undefined)).toEqual({ kind: "section", key: "general" });
    expect(parseSettingsPath("")).toEqual({ kind: "section", key: "general" });
    expect(parseSettingsPath("/")).toEqual({ kind: "section", key: "general" });
  });

  it("knows each section's address", () => {
    for (const key of ["members", "secrets", "budgets", "environments", "transfer"] as const) {
      expect(parseSettingsPath(key)).toEqual({ kind: "section", key });
    }
    expect(parseSettingsPath("paperclip-models")).toEqual({ kind: "section", key: "connections" });
    expect(sectionHref("/TES/company/settings", "connections")).toBe("/TES/company/settings/paperclip-models");
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
    // Paperclip Models was Connections, at the old UI's address.
    expect(parseSettingsPath("connections")).toEqual({ kind: "redirect", key: "connections" });
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

describe("companySettingsEntries", () => {
  const base = "/TES/company/settings";
  const rows = (entries: ReturnType<typeof companySettingsEntries>) =>
    entries.map((entry) => ("heading" in entry ? `# ${entry.heading}` : `${entry.label} ${entry.href}${entry.tag ? ` (${entry.tag})` : ""}${entry.end ? " end" : ""}`));

  it("lists the organization's sections, then the plugins' pages", () => {
    expect(rows(companySettingsEntries(base, [{ label: "Linear sync", routePath: "linear-sync" }]))).toEqual([
      "# Organization",
      "General /TES/company/settings end",
      "Members /TES/company/settings/members",
      "Paperclip Models /TES/company/settings/paperclip-models",
      "Secrets /TES/company/settings/secrets",
      "Budgets /TES/company/settings/budgets",
      "Environments /TES/company/settings/environments",
      "Import and export /TES/company/settings/transfer",
      "# From plugins",
      "Linear sync /TES/company/settings/linear-sync (plugin)",
    ]);
  });

  it("points to the plugin pages overview when no plugin adds one", () => {
    expect(rows(companySettingsEntries(base, [])).slice(-2)).toEqual(["# From plugins", "Plugin pages /TES/company/settings/plugins (none)"]);
  });
});
