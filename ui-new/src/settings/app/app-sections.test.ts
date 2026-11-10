import { describe, expect, it } from "vitest";
import { appSettingsEntries } from "./app-sections";
import { visibleSections } from "./app-settings-model";

describe("appSettingsEntries", () => {
  const base = "/TES/company/settings/instance";
  const rows = (isAdmin: boolean, hidden?: string[]) =>
    appSettingsEntries(base, visibleSections(isAdmin, hidden)).map((entry) => ("heading" in entry ? `# ${entry.heading}` : `${entry.label} ${entry.href}`));

  it("gives an instance admin every section, under its heading", () => {
    expect(rows(true)).toEqual([
      "# You",
      `Account ${base}/account`,
      "# This instance",
      `General ${base}/general`,
      `Organizations ${base}/organizations`,
      `Admins ${base}/admins`,
      `Harnesses ${base}/harnesses`,
      `Plugins ${base}/plugins`,
    ]);
  });

  it("gives everyone else Account only", () => {
    expect(rows(false)).toEqual(["# You", `Account ${base}/account`]);
  });

  it("leaves out what the operator hides, and a heading left empty", () => {
    expect(rows(true, ["instance.profile", "instance.plugins"])).toEqual([
      "# This instance",
      `General ${base}/general`,
      `Organizations ${base}/organizations`,
      `Admins ${base}/admins`,
      `Harnesses ${base}/harnesses`,
    ]);
    expect(rows(false, ["instance.profile"])).toEqual([]);
  });
});
