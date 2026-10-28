import type { Agent, CompanySkillListItem } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  createPayload,
  draftProblem,
  isCoreSkill,
  leadAgents,
  leadsWithout,
  libraryCounts,
  matchesQuery,
  newFileProblem,
  providedByHarness,
  repositoryProblem,
  repositoryUrl,
  skillOrigin,
  skillsView,
  slugFor,
  sortedFiles,
  sortLibrary,
  sourceLine,
  splitCategories,
  syncLabel,
  versionName,
} from "./skills-model";

const skill = (extra: Partial<CompanySkillListItem>): CompanySkillListItem =>
  ({
    id: extra.key ?? "s",
    key: "company/c1/notes",
    slug: "notes",
    name: "notes",
    description: null,
    sourceType: "local_path",
    sourceBadge: "local",
    sourceLabel: null,
    sourceLocator: null,
    forkedFromSkillId: null,
    attachedAgentCount: 0,
    categories: [],
    ...extra,
  }) as CompanySkillListItem;

const agent = (id: string, extra: { reportsTo?: string | null; adapterType?: string; status?: string } = {}) => ({
  id,
  name: id.toUpperCase(),
  status: (extra.status ?? "idle") as Agent["status"],
  reportsTo: extra.reportsTo ?? null,
  adapterType: extra.adapterType ?? "claude_local",
});

describe("addresses", () => {
  it("reads the library, sources and Studio addresses, old ones included", () => {
    expect(skillsView("")).toEqual({ section: "library", skillId: null });
    expect(skillsView("abc")).toEqual({ section: "library", skillId: "abc" });
    expect(skillsView("abc/files/SKILL.md")).toEqual({ section: "library", skillId: "abc" });
    expect(skillsView("sources/s1")).toEqual({ section: "sources", sourceId: "s1" });
    expect(skillsView("studio")).toEqual({ section: "studio", skillId: null, creating: false });
    expect(skillsView("studio/new")).toEqual({ section: "studio", skillId: null, creating: true });
    expect(skillsView("studio/abc/")).toEqual({ section: "studio", skillId: "abc", creating: false });
    expect(skillsView("abc/studio")).toEqual({ section: "redirect", to: "studio/abc" });
  });
});

describe("where a skill comes from", () => {
  it("tells bundled, authored and imported skills apart", () => {
    expect(skillOrigin(skill({ key: "paperclipai/paperclip/paperclip", sourceBadge: "paperclip" }))).toBe("bundled");
    expect(skillOrigin(skill({ key: "company/c1/notes" }))).toBe("authored");
    // As the server sends one: managed in the Paperclip workspace, with the "paperclip" badge.
    expect(skillOrigin(skill({ key: "company/c1/notes", sourceBadge: "paperclip", sourceLabel: "Paperclip workspace" }))).toBe("authored");
    expect(skillOrigin(skill({ key: "acme/skills/review", sourceType: "github", sourceBadge: "github", forkedFromSkillId: null }))).toBe("imported");
    expect(skillOrigin(skill({ key: "local/abc/x", forkedFromSkillId: "orig" }))).toBe("authored");
  });

  it("says where an imported skill came from", () => {
    expect(sourceLine(skill({ sourceLabel: "Paperclip bundled" }))).toBe("Paperclip bundled");
    expect(sourceLine(skill({ sourceType: "github", key: "acme/skills/review" }))).toBe("acme/skills");
    expect(sourceLine(skill({ sourceType: "local_path" }))).toBe("A local folder");
  });
});

describe("the core skills and lead agents", () => {
  it("knows the core skills and that the Runner provides paperclip", () => {
    expect(isCoreSkill("paperclipai/paperclip/para-memory-files")).toBe(true);
    expect(isCoreSkill("paperclipai/paperclip/slack")).toBe(false);
    expect(providedByHarness("paperclipai/paperclip/paperclip", "paperclip_runner")).toBe(true);
    expect(providedByHarness("paperclipai/paperclip/paperclip-board", "paperclip_runner")).toBe(false);
    expect(providedByHarness("paperclipai/paperclip/paperclip", "claude_local")).toBe(false);
  });

  it("counts top-level agents and managers as leads, not retired agents or reports", () => {
    const agents = [agent("ceo"), agent("cto", { reportsTo: "ceo" }), agent("dev", { reportsTo: "cto" }), agent("old", { status: "terminated" })];
    expect(leadAgents(agents).map((entry) => entry.id)).toEqual(["ceo", "cto"]);
  });

  it("lists the leads without a core skill, leaving Runner agents out for paperclip", () => {
    const agents = [agent("bob", { adapterType: "paperclip_runner" }), agent("ann"), agent("dev", { reportsTo: "ann" })];
    expect(leadsWithout("paperclipai/paperclip/paperclip", [], agents).map((entry) => entry.id)).toEqual(["ann"]);
    expect(leadsWithout("paperclipai/paperclip/paperclip-board", [{ id: "ann" }], agents).map((entry) => entry.id)).toEqual(["bob"]);
    expect(leadsWithout("paperclipai/paperclip/slack", [], agents)).toEqual([]);
  });
});

describe("the library", () => {
  const list = [
    skill({ key: "paperclipai/paperclip/slack", name: "slack", sourceBadge: "paperclip" }),
    skill({ key: "paperclipai/paperclip/paperclip", name: "paperclip", sourceBadge: "paperclip", attachedAgentCount: 2 }),
    skill({ key: "acme/skills/review", name: "Review", sourceType: "github", sourceBadge: "github", description: "Reviews pull requests", categories: ["Code"] }),
    skill({ key: "company/c1/notes", name: "notes" }),
  ];

  it("counts each filter", () => {
    expect(libraryCounts(list)).toEqual({ all: 4, bundled: 2, imported: 1, authored: 1, unused: 3 });
  });

  it("searches name, description and categories", () => {
    expect(matchesQuery(list[2]!, "pull code")).toBe(true);
    expect(matchesQuery(list[2]!, "slack")).toBe(false);
  });

  it("puts the core skills first", () => {
    expect(sortLibrary(list).map((entry) => entry.name)).toEqual(["paperclip", "notes", "Review", "slack"]);
  });
});

describe("files and versions", () => {
  it("names versions", () => {
    expect(versionName({ revisionNumber: 3, label: "Initial version", releaseName: null })).toBe("v3 · Initial version");
    expect(versionName({ revisionNumber: 4, label: null, releaseName: null })).toBe("v4");
  });

  it("puts SKILL.md first, then by kind and path", () => {
    const files = sortedFiles([
      { path: "scripts/run.sh", kind: "script" },
      { path: "references/b.md", kind: "reference" },
      { path: "SKILL.md", kind: "skill" },
      { path: "references/a.md", kind: "reference" },
    ]);
    expect(files.map((file) => file.path)).toEqual(["SKILL.md", "references/a.md", "references/b.md", "scripts/run.sh"]);
  });

  it("checks a new file's path", () => {
    const existing = [{ path: "SKILL.md" }];
    expect(newFileProblem("references/notes.md", existing)).toBeNull();
    expect(newFileProblem("  ", existing)).toMatch(/path/);
    expect(newFileProblem("../x.md", existing)).toMatch(/relative/);
    expect(newFileProblem("skill.md", existing)).toMatch(/exists/);
  });
});

describe("a new skill", () => {
  it("makes a slug and a starting SKILL.md", () => {
    expect(slugFor("  Release Notes! ")).toBe("release-notes");
    const payload = createPayload({ name: "Release notes", slug: "", description: "Write release notes", categories: "Docs, docs ,Writing" });
    expect(payload).toMatchObject({ name: "Release notes", slug: "release-notes", description: "Write release notes", categories: ["Docs", "Writing"] });
    expect(payload.markdown).toContain("description: Write release notes");
    expect(splitCategories("")).toEqual([]);
  });

  it("refuses a missing name or a slug that's taken", () => {
    const existing = [{ slug: "notes", key: "company/c1/notes" }];
    expect(draftProblem({ name: "", slug: "", description: "", categories: "" }, existing)).toMatch(/name/);
    expect(draftProblem({ name: "Notes", slug: "", description: "", categories: "" }, existing)).toMatch(/already/);
    expect(draftProblem({ name: "Notes", slug: "notes-2", description: "", categories: "" }, existing)).toBeNull();
  });
});

describe("sources", () => {
  it("checks and expands repository addresses", () => {
    expect(repositoryProblem("acme/skills")).toBeNull();
    expect(repositoryProblem("https://github.com/acme/skills")).toBeNull();
    expect(repositoryProblem("https://gitlab.com/acme/skills")).toMatch(/GitHub/);
    expect(repositoryProblem("https://github.com/acme")).toMatch(/owner/);
    expect(repositoryProblem("not a repo")).toMatch(/address/);
    expect(repositoryUrl("acme/skills")).toBe("https://github.com/acme/skills");
  });

  it("says how a source's sync stands", () => {
    expect(syncLabel({ syncState: "ready", lastError: null, enabled: true })).toBe("Up to date");
    expect(syncLabel({ syncState: "ready", lastError: "boom", enabled: true })).toBe("Sync failed");
    expect(syncLabel({ syncState: "ready", lastError: null, enabled: false })).toBe("Paused");
  });
});
