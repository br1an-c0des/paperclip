import { describe, expect, it } from "vitest";
import { exportCounts, exportFileName, importPlanLines, packageProblem } from "./transfer-model";

describe("export", () => {
  it("sums up what's in the package", () => {
    expect(exportCounts({ agents: 1, projects: 2, issues: 0, skills: 3, files: 12 })).toBe("1 agent · 2 projects · 0 tasks · 3 skills · 12 files");
  });

  it("names the download after the package root", () => {
    expect(exportFileName("test-shell-co")).toBe("test-shell-co.zip");
    expect(exportFileName("out/test-shell-co/")).toBe("test-shell-co.zip");
    expect(exportFileName("")).toBe("company.zip");
  });
});

describe("import", () => {
  it("lists what the import does", () => {
    expect(
      importPlanLines({
        companyAction: "create",
        agentPlans: [{ action: "create" }, { action: "create" }, { action: "skip" }] as never,
        projectPlans: [{ action: "create" }] as never,
        issuePlans: [],
      }),
    ).toEqual(["Creates a new organization", "Creates 2 agents", "Skips 1 agent", "Creates 1 project"]);
  });

  it("wants a zip", () => {
    expect(packageProblem(null)).toMatch(/zip/);
    expect(packageProblem(new File(["x"], "notes.txt", { type: "text/plain" }))).toMatch(/zip/);
    expect(packageProblem(new File(["x"], "co.zip", { type: "" }))).toBeNull();
  });
});
