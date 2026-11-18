import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relPath: string) => readFileSync(path.join(repoRoot, relPath), "utf8");

// Chat agents answer "how do I find X?" from the board skill; without this section they
// had no source for the web UI's quick search and told people to ask in chat instead.
describe("paperclip-board skill web UI guidance", () => {
  const skill = read("skills/paperclip-board/SKILL.md");
  // ui/ removed 2026-11-17 (hard fork): the checks against the old UI's command palette, routes and sidebar are gone.
  const section = skill.slice(skill.indexOf("## Finding Things in the Web UI"), skill.indexOf("## Presentation Rules"));

  it("documents the quick-search shortcut the command palette actually binds", () => {
    expect(section.length).toBeGreaterThan(0);
    expect(section).toContain("**Cmd+K**");
    expect(section).toContain("**Ctrl+K**");
  });

  it("documents the handoff to full search and the search route it opens", () => {
    expect(section).toContain("**Search all**");
    expect(section).toContain("Cmd/Ctrl+Enter");
    expect(section).toContain("/{prefix}/search");
  });

  it("keeps the overlay promise to the shortcut and describes the sidebar Search item as full search", () => {
    expect(section).toMatch(/sidebar \*\*Search\*\* item[^\n]*opens the full search page/);
    expect(section).not.toMatch(/search icon[^\n]*opens over the current page/i);
  });

  it("does not claim operators narrow the quick-search results", () => {
    expect(section).toContain("they do not narrow the quick-search results");
  });

  it("tells the agent it cannot operate the person's browser", () => {
    expect(section).toMatch(/cannot press keys, focus fields, or open the palette/);
  });

  it("is discoverable from the skill description", () => {
    const frontmatter = skill.slice(0, skill.indexOf("\n---", 4));
    expect(frontmatter).toContain("finding things in the Paperclip web UI");
  });
});
