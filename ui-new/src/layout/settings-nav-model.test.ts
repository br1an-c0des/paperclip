import { describe, expect, it } from "vitest";
import { backToAppHref, nextAppPath, settingsArea } from "./settings-nav-model";

describe("settingsArea", () => {
  it("shows the main nav outside settings", () => {
    for (const path of ["/TES/dashboard", "/TES/issues/TES-1", "/TES/agents/bob/settings", "/TES/projects/web/settings", "/TES/apps", "/TES"]) {
      expect(settingsArea(path, "TES")).toBeNull();
    }
  });

  it("shows App settings' sidebar for the instance settings and their old addresses", () => {
    for (const path of [
      "/TES/company/settings/instance",
      "/TES/company/settings/instance/",
      "/TES/company/settings/instance/admins",
      "/TES/company/settings/instance/plugins/abc",
      "/TES/instance/settings/profile",
      "/TES/settings/general",
      "/tes/company/settings/instance/account",
    ]) {
      expect(settingsArea(path, "TES")).toBe("app");
    }
  });

  it("shows Company settings' sidebar for the company settings, plugin pages and export and import", () => {
    for (const path of [
      "/TES/company/settings",
      "/TES/company/settings/members",
      "/TES/company/settings/linear-sync",
      "/TES/company/export/files",
      "/TES/company/import",
    ]) {
      expect(settingsArea(path, "TES")).toBe("company");
    }
  });

  it("leaves out the retired tools pages, which redirect out of settings", () => {
    expect(settingsArea("/TES/company/settings/tools/abc", "TES")).toBeNull();
  });

  it("doesn't mistake lookalike addresses or another company for settings", () => {
    expect(settingsArea("/TES/company/settingsx", "TES")).toBeNull();
    expect(settingsArea("/TES/instances", "TES")).toBeNull();
    expect(settingsArea("/NOR/company/settings", "TES")).toBeNull();
  });
});

describe("Back to app", () => {
  it("remembers each page outside settings, with its query and hash", () => {
    expect(nextAppPath(null, { pathname: "/TES/issues", search: "?task=TES-4", hash: "#c1" }, "TES")).toBe("/TES/issues?task=TES-4#c1");
    expect(nextAppPath("/TES/dashboard", { pathname: "/TES/inbox" }, "TES")).toBe("/TES/inbox");
  });

  it("keeps it while you move between sections and between the two settings areas", () => {
    let remembered = nextAppPath(null, { pathname: "/TES/projects/web" }, "TES");
    for (const pathname of [
      "/TES/company/settings",
      "/TES/company/settings/members",
      "/TES/company/settings/instance",
      "/TES/company/settings/instance/general",
      "/TES/company/settings/secrets",
      "/TES/settings/profile",
    ]) {
      remembered = nextAppPath(remembered, { pathname, search: "?x=1" }, "TES");
    }
    expect(remembered).toBe("/TES/projects/web");
    expect(backToAppHref(remembered, "TES")).toBe("/TES/projects/web");
  });

  it("falls back to the dashboard with nothing remembered", () => {
    expect(nextAppPath(null, { pathname: "/TES/company/settings" }, "TES")).toBeNull();
    expect(backToAppHref(null, "TES")).toBe("/TES/dashboard");
  });

  it("falls back to this company's dashboard when the page belongs to another company", () => {
    expect(backToAppHref("/NOR/issues", "TES")).toBe("/TES/dashboard");
    expect(backToAppHref("/tes/issues?task=1", "TES")).toBe("/tes/issues?task=1");
  });

  it("never sends you back into settings", () => {
    expect(backToAppHref("/TES/company/settings/members", "TES")).toBe("/TES/dashboard");
  });
});
