import type { CatalogSkill, CompanySkillUpdateStatus, CompanySkillVersion, FolderListItem, ProjectSkillRepository } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  catalogGroups,
  categoryLabel,
  comparedPaths,
  compareSelection,
  conflictSlug,
  fileChange,
  folderNameProblem,
  folderSubtree,
  folderTree,
  importProblem,
  installedFromCatalog,
  legacyCatalogPath,
  matchesCatalog,
  matchesFolder,
  selectableCandidate,
  shortRef,
  sizeLabel,
  skillFolderOf,
  skillsView,
  slugProblem,
  sortSkills,
  updateLine,
} from "./skills-model";
import { groupRepositories } from "./SourceExtras";

/* The catalog, folders, sorting, updates, version comparison and imports (M7 slice E). */

const folder = (extra: Partial<FolderListItem>): FolderListItem =>
  ({ id: "f", parentId: null, name: "F", path: "f", depth: 1, position: 0, systemKey: null, itemCount: 0, ...extra }) as FolderListItem;

describe("addresses", () => {
  it("opens the catalog and its skills", () => {
    expect(skillsView("catalog")).toEqual({ section: "catalog", catalogId: null });
    expect(skillsView(`catalog/${encodeURIComponent("paperclipai:optional:browser:agent-browser")}`)).toEqual({
      section: "catalog",
      catalogId: "paperclipai:optional:browser:agent-browser",
    });
  });

  it("lands the old ?view=catalog addresses on the catalog", () => {
    expect(legacyCatalogPath({ view: "catalog" })).toBe("catalog");
    expect(legacyCatalogPath({ view: "catalog", catalog: "a:b" })).toBe("catalog/a%3Ab");
    expect(legacyCatalogPath({})).toBeNull();
  });
});

describe("folders", () => {
  const folders = [
    folder({ id: "b", name: "Bundled", path: "bundled", systemKey: "bundled" }),
    folder({ id: "core", parentId: "b", name: "Core", path: "bundled/core", depth: 2, systemKey: "bundled:core" }),
    folder({ id: "r", name: "Research", path: "research", position: 1 }),
    folder({ id: "orphan", parentId: "gone", name: "Orphan", path: "gone/orphan", depth: 2 }),
  ];

  it("orders folders as a tree and keeps orphans", () => {
    expect(folderTree(folders).map((entry) => entry.id)).toEqual(["b", "core", "r", "orphan"]);
  });

  it("includes the folders under the picked one", () => {
    expect([...folderSubtree(folders, "b")].sort()).toEqual(["b", "core"]);
    expect(matchesFolder({ folderId: "core" }, "b", folderSubtree(folders, "b"))).toBe(true);
    expect(matchesFolder({ folderId: "r" }, "b", folderSubtree(folders, "b"))).toBe(false);
    expect(matchesFolder({ folderId: null }, "unfiled", null)).toBe(true);
    expect(matchesFolder({ folderId: "r" }, "all", null)).toBe(true);
  });

  it("checks folder names against their siblings", () => {
    expect(folderNameProblem(" ", [])).toMatch(/name/);
    expect(folderNameProblem("research", [folder({ name: "Research" })])).toMatch(/already/);
    expect(folderNameProblem("Notes", [folder({ name: "Research" })])).toBeNull();
  });
});

describe("sorting", () => {
  const rows = [
    { key: "a", name: "Alpha", slug: "alpha", description: null, categories: [], attachedAgentCount: 1, starCount: 0, updatedAt: new Date("2026-01-01"), sourceBadge: "local", sourceType: "local_path", forkedFromSkillId: null },
    { key: "b", name: "Beta", slug: "beta", description: null, categories: [], attachedAgentCount: 3, starCount: 5, updatedAt: new Date("2026-03-01"), sourceBadge: "local", sourceType: "local_path", forkedFromSkillId: null },
  ] as never[];
  it("sorts by stars, use and recency, falling back to the name", () => {
    expect(sortSkills(rows, "stars").map((row: { name: string }) => row.name)).toEqual(["Beta", "Alpha"]);
    expect(sortSkills(rows, "agents").map((row: { name: string }) => row.name)).toEqual(["Beta", "Alpha"]);
    expect(sortSkills(rows, "recent").map((row: { name: string }) => row.name)).toEqual(["Beta", "Alpha"]);
    expect(sortSkills(rows, "name").map((row: { name: string }) => row.name)).toEqual(["Alpha", "Beta"]);
  });
});

describe("the catalog", () => {
  const entry = (extra: Partial<CatalogSkill>): CatalogSkill =>
    ({ id: "x", key: "paperclipai/optional/x/x", kind: "optional", category: "x", slug: "x", name: "x", description: "", tags: [], recommendedForRoles: [], ...extra }) as CatalogSkill;

  it("matches installed skills by key, ignoring case", () => {
    const installed = installedFromCatalog([entry({ id: "1", key: "Paperclipai/Bundled/Docs/Doc" })], [{ key: "paperclipai/bundled/docs/doc", id: "s1" }]);
    expect(installed.get("1")?.id).toBe("s1");
  });

  it("filters by kind, installation and words", () => {
    const browser = entry({ kind: "optional", tags: ["playwright"], name: "agent-browser" });
    expect(matchesCatalog(browser, "optional", false, "playwright")).toBe(true);
    expect(matchesCatalog(browser, "bundled", false, "")).toBe(false);
    expect(matchesCatalog(browser, "installed", false, "")).toBe(false);
    expect(matchesCatalog(browser, "all", true, "nothing like it")).toBe(false);
  });

  it("groups by category with readable names", () => {
    const groups = catalogGroups([entry({ id: "1", category: "software-development", name: "b" }), entry({ id: "2", category: "docs", name: "a" }), entry({ id: "3", category: "", name: "c" })]);
    expect(groups.map((group) => group.label)).toEqual(["Docs", "Software development", "Other"]);
    expect(categoryLabel("paperclip-operations")).toBe("Paperclip operations");
    expect(sizeLabel(5133)).toBe("5 KB");
    expect(sizeLabel(200)).toBe("200 B");
  });
});

describe("updates", () => {
  const status = (extra: Partial<CompanySkillUpdateStatus>): CompanySkillUpdateStatus => ({
    supported: true,
    reason: null,
    trackingRef: "main",
    currentRef: "aaaaaaaaaaaaaaaa",
    latestRef: "bbbbbbbbbbbbbbbb",
    hasUpdate: false,
    installedHash: null,
    originHash: null,
    userModifiedAt: null,
    updateHoldReason: null,
    auditVerdict: null,
    auditCodes: [],
    ...extra,
  });

  it("offers an update when one is out", () => {
    expect(updateLine(status({ hasUpdate: true }))).toEqual({ tone: "available", text: "A newer version is available (aaaaaaa → bbbbbbb).", canInstall: true });
  });

  it("holds failed safety checks and explains local changes", () => {
    expect(updateLine(status({ hasUpdate: true, updateHoldReason: "audit_hard_stop" }))?.canInstall).toBe(false);
    const local = updateLine(status({ hasUpdate: true, updateHoldReason: "local_modifications" }));
    expect(local?.tone).toBe("held");
    expect(local?.canInstall).toBe(true);
  });

  it("says when updates aren't tracked or it's current", () => {
    expect(updateLine(status({ supported: false, reason: "Local skills don't update." }))?.text).toBe("Local skills don't update.");
    expect(updateLine(status({}))?.text).toBe("Up to date at aaaaaaa.");
    expect(updateLine(undefined)).toBeNull();
    expect(shortRef("v1.2")).toBe("v1.2");
  });
});

describe("comparing versions", () => {
  const version = (id: string, revisionNumber: number, files: Record<string, string>) =>
    ({ id, revisionNumber, fileInventory: Object.entries(files).map(([path, content]) => ({ path, kind: "markdown", content })) }) as unknown as CompanySkillVersion;
  const v1 = version("v1", 1, { "SKILL.md": "a", "old.md": "x" });
  const v2 = version("v2", 2, { "SKILL.md": "b", "new.md": "y" });
  const v3 = version("v3", 3, { "SKILL.md": "b" });

  it("compares the target with the version before it", () => {
    expect(compareSelection([v1, v2, v3])).toEqual({ before: "v2", after: "v3" });
    expect(compareSelection([v1, v2, v3], "v2")).toEqual({ before: "v1", after: "v2" });
    expect(compareSelection([v1], "v1")).toEqual({ before: null, after: "v1" });
    expect(compareSelection([])).toEqual({ before: null, after: null });
  });

  it("lists both versions' files and how each changed", () => {
    expect(comparedPaths(v1, v2)).toEqual(["SKILL.md", "new.md", "old.md"]);
    expect(fileChange(v1, v2, "SKILL.md")).toBe("changed");
    expect(fileChange(v1, v2, "new.md")).toBe("added");
    expect(fileChange(v1, v2, "old.md")).toBe("removed");
    expect(fileChange(v2, v3, "SKILL.md")).toBe("same");
  });
});

describe("imports and scans", () => {
  it("accepts paths, repositories and web addresses", () => {
    expect(importProblem("/home/me/skills/review")).toBeNull();
    expect(importProblem("owner/repo")).toBeNull();
    expect(importProblem("https://skills.sh/acme/review")).toBeNull();
    expect(importProblem("ftp://example.com/skill")).toMatch(/https/);
    expect(importProblem("")).toMatch(/Paste/);
    expect(importProblem("just words")).toMatch(/isn't/);
  });

  it("picks new and clashing skills, renaming the clashes", () => {
    expect(selectableCandidate({ status: "new" })).toBe(true);
    expect(selectableCandidate({ status: "conflict" })).toBe(true);
    expect(selectableCandidate({ status: "already_imported" })).toBe(false);
    expect(conflictSlug({ slug: "review" })).toBe("review-copy");
    expect(slugProblem(undefined)).toBeNull();
    expect(slugProblem("review-2")).toBeNull();
    expect(slugProblem("Review 2")).toMatch(/review-2/);
  });

  it("turns a browsed SKILL.md into its folder", () => {
    expect(skillFolderOf("skills/review/SKILL.md")).toBe("skills/review");
    expect(skillFolderOf("SKILL.md")).toBe(".");
    expect(skillFolderOf("skills/review")).toBe("skills/review");
  });

  it("groups project repositories that aren't sources yet", () => {
    const repo = (extra: Partial<ProjectSkillRepository>): ProjectSkillRepository => ({
      projectId: "p",
      projectName: "P",
      projectVisibility: "open",
      workspaceId: "w",
      repositoryUrl: "https://github.com/acme/app",
      trackingRef: "main",
      bindingId: null,
      sourceId: null,
      status: "available",
      lastError: null,
      ...extra,
    });
    const groups = groupRepositories([repo({ projectName: "A" }), repo({ projectName: "B", workspaceId: "w2" }), repo({ sourceId: "s", repositoryUrl: "https://github.com/acme/other" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe("acme/app");
    expect(groups[0]!.repos.map((entry) => entry.projectName)).toEqual(["A", "B"]);
  });
});
