import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAPERCLIP_TOOL_NAMES } from "../mcp/catalog/tool-names.js";

const skill = readFileSync(new URL("../../../skills/paperclip/SKILL.md", import.meta.url), "utf8");

describe("the paperclip skill teaches the MCP tools", () => {
  it("names only tools in the Paperclip catalog", () => {
    const named = new Set(skill.match(/\bpaperclip_[a-z_]+\b/g) ?? []);
    const known = new Set<string>(PAPERCLIP_TOOL_NAMES);
    expect([...named].filter(name => !known.has(name))).toEqual([]);
    for (const tool of ["paperclip_task_context", "paperclip_finish", "paperclip_block", "paperclip_report_progress", "paperclip_ask_board", "paperclip_request_approval"]) {
      expect(named).toContain(tool);
    }
  });

  it("doesn't teach curl and stays short", () => {
    expect(skill).not.toMatch(/\bcurl\b/i);
    expect(skill.split("\n").length).toBeLessThan(150);
  });

  it("says every run ends with finish, block or progress with continue", () => {
    expect(skill).toContain("**End the run with exactly one of:**");
    expect(skill).toContain("`continue: true`");
    expect(skill).toContain("A final message alone doesn't end a run");
  });
});
