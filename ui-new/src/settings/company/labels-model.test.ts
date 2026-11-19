import type { IssueLabel } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { isLabelColor, isLabelNameTaken, labelNameProblem, sortLabels } from "./labels-model";

const label = (id: string, name: string): IssueLabel => ({ id, companyId: "co1", name, color: "#6366f1", createdAt: new Date(0), updatedAt: new Date(0) });

describe("labels-model", () => {
  it("lists labels by name, ignoring case", () => {
    expect(sortLabels([label("1", "ui"), label("2", "Bug"), label("3", "api")]).map((entry) => entry.name)).toEqual(["api", "Bug", "ui"]);
    expect(sortLabels(undefined)).toEqual([]);
  });

  it("checks a new name: present, short enough, and not another label's", () => {
    const labels = [label("1", "bug"), label("2", "ui")];
    expect(labelNameProblem(labels, "1", "  ")).toBe("A label needs a name.");
    expect(labelNameProblem(labels, "1", "x".repeat(49))).toMatch(/up to 48/);
    expect(labelNameProblem(labels, "1", " ui ")).toBe("Another label is already called “ui”.");
    expect(labelNameProblem(labels, "1", "bug")).toBeNull();
    // The server compares names exactly, so a different case isn't a clash.
    expect(labelNameProblem(labels, "1", "UI")).toBeNull();
  });

  it("recognises the server's name clash", () => {
    expect(isLabelNameTaken(new ApiError("taken", 409, { error: "taken", details: { code: "label_name_taken" } }))).toBe(true);
    expect(isLabelNameTaken(new ApiError("nope", 409, { error: "nope" }))).toBe(false);
  });

  it("takes only #rrggbb colours", () => {
    expect(isLabelColor("#22b5a5")).toBe(true);
    expect(isLabelColor("#fff")).toBe(false);
    expect(isLabelColor("red")).toBe(false);
  });
});
