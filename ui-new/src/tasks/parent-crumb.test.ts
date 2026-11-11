import type { Issue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { crumbLabel, PARENT_TITLE_LIMIT, parentCrumb, parentLabel, truncateTitle } from "./parent-crumb";

type Ancestors = NonNullable<Issue["ancestors"]>;
const ancestor = (id: string, identifier: string | null, title: string) => ({ id, identifier, title }) as Ancestors[number];
const task = (parentId: string | null, ancestors: unknown[]) => ({ parentId, ancestors: ancestors as Ancestors });

describe("truncateTitle", () => {
  it("keeps a title up to 48 characters", () => {
    const title = "x".repeat(PARENT_TITLE_LIMIT);
    expect(truncateTitle(title)).toBe(title);
  });

  it("cuts a longer one to 47 and an ellipsis", () => {
    const title = "Plan the engineering team and hiring process for the next product launch";
    expect(truncateTitle(title)).toBe(`${title.slice(0, 47)}…`);
    expect(Array.from(truncateTitle(title))).toHaveLength(48);
  });

  it("counts code points, so an emoji isn't split", () => {
    expect(truncateTitle("🚀".repeat(60))).toBe(`${"🚀".repeat(47)}…`);
  });
});

describe("parentCrumb", () => {
  it("has nothing for a top-level task", () => {
    expect(parentCrumb(task(null, []))).toBeNull();
    expect(parentCrumb(undefined)).toBeNull();
  });

  it("names only the immediate parent", () => {
    const crumb = parentCrumb(task("p1", [ancestor("p1", "TES-12", "Parent"), ancestor("root", "TES-1", "Root")]));
    expect(crumb).toEqual({ kind: "link", id: "p1", identifier: "TES-12", title: "Parent", label: "Parent" });
  });

  it("uses the nearest ancestor when the parent isn't matched by id", () => {
    expect(parentCrumb(task("p1", [ancestor("other", "TES-7", "Nearest")]))).toMatchObject({ id: "other", title: "Nearest" });
  });

  it("has nothing while the parent hasn't been read", () => {
    expect(parentCrumb(task("p1", []))).toBeNull();
  });

  it("truncates the label and keeps the whole title", () => {
    const title = "A".repeat(60);
    const crumb = parentCrumb(task("p1", [ancestor("p1", "TES-12", title)]));
    expect(crumb).toMatchObject({ title, label: `${"A".repeat(47)}…` });
    expect(parentLabel(crumb!)).toBe(`Parent task: ${title} TES-12`);
  });

  it("shows a private parent as a lock, with no title", () => {
    const crumb = parentCrumb(task("p1", [{ id: "p1", identifier: "TES-12", locked: true }]));
    expect(crumb).toEqual({ kind: "locked", id: "p1", identifier: "TES-12" });
    expect(parentLabel(crumb!)).toBe("Parent task TES-12, private, you don't have access");
    expect(parentLabel({ kind: "locked", id: "p1", identifier: null })).toBe("Parent task, private, you don't have access");
  });

  it("names the header crumb by its title alone, and a private one without its number (U128, #20804)", () => {
    expect(crumbLabel(parentCrumb(task("p1", [ancestor("p1", "TES-12", "Prepare")]))!)).toBe("Parent task: Prepare");
    expect(crumbLabel({ kind: "locked", id: "p1", identifier: "TES-12" })).toBe("Parent task, private, you don't have access");
  });
});
