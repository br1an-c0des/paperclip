import type { AgentInstructionCandidate, AgentInstructionsFileSummary } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { actionableCandidates, bundleDraft, bundleSize, bundleUpdate, diffHunks, diffSummary, fileDate, fileRows, lineDiff, newFileProblem, renameProblem } from "./instructions-model";

describe("fileDate", () => {
  it("prefers the last change, then creation, and invents neither", () => {
    expect(fileDate({ createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-06T10:00:00Z" })).toEqual({ label: "Updated", at: "2026-11-06T10:00:00Z" });
    expect(fileDate({ createdAt: "2026-11-01T10:00:00Z" })).toEqual({ label: "Created", at: "2026-11-01T10:00:00Z" });
    expect(fileDate({ updatedAt: "not a date" })).toBeNull();
    expect(fileDate({ updatedAt: "1970-01-01T00:00:00Z" })).toBeNull();
    expect(fileDate({})).toBeNull();
    expect(fileDate(undefined)).toBeNull();
  });
});

const file = (path: string, size = 10, isEntryFile = false) => ({ path, size, isEntryFile }) as AgentInstructionsFileSummary;

describe("lineDiff", () => {
  it("marks added and removed lines", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });

  it("summarizes the change", () => {
    expect(diffSummary(lineDiff("a", "a\nb"))).toBe("adds 1 line");
    expect(diffSummary(lineDiff("a\nb", "c\nd\ne"))).toBe("adds 3 lines, removes 2 lines");
    expect(diffSummary(lineDiff("a", "a"))).toBe("no line changes");
  });

  it("keeps context around changes and marks the gaps", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].join("\n");
    const after = before.replace("2", "two").replace("9", "nine");
    const hunks = diffHunks(lineDiff(before, after), 1);
    expect(hunks.map((line) => (line ? `${line.kind}:${line.text}` : "…"))).toEqual([
      "same:1",
      "remove:2",
      "add:two",
      "same:3",
      "…",
      "same:8",
      "remove:9",
      "add:nine",
      "same:10",
    ]);
  });
});

describe("files", () => {
  it("lists the entry file first, then top-level files, then folders", () => {
    const rows = fileRows([file("research/sources.md"), file("TOOLS.md"), file("AGENTS.md", 10, true), file("research/deep/notes.md"), file("HEARTBEAT.md")]);
    expect(rows.map((row) => `${row.kind}:${row.path}:${row.depth}`)).toEqual([
      "file:AGENTS.md:0",
      "file:HEARTBEAT.md:0",
      "file:TOOLS.md:0",
      "folder:research:0",
      "folder:research/deep:1",
      "file:research/deep/notes.md:2",
      "file:research/sources.md:1",
    ]);
  });

  it("sizes the bundle", () => {
    expect(bundleSize([file("AGENTS.md", 41)])).toBe("1 file · 41 B");
    expect(bundleSize([file("a.md", 2048), file("b.md", 1024)])).toBe("2 files · 3.0 KB");
  });

  it("checks a new file's path", () => {
    const existing = [file("AGENTS.md")];
    expect(newFileProblem("", existing)).toMatch(/Name the file/);
    expect(newFileProblem("/etc/passwd.md", existing)).toMatch(/relative path/);
    expect(newFileProblem("../up.md", existing)).toMatch(/relative path/);
    expect(newFileProblem("notes//a.md", existing)).toMatch(/relative path/);
    expect(newFileProblem("script.sh", existing)).toMatch(/text file/);
    expect(newFileProblem("AGENTS.md", existing)).toBe("AGENTS.md already exists.");
    expect(newFileProblem("research/sources.md", existing)).toBeNull();
  });

  it("checks a renamed file's path", () => {
    const existing = [file("AGENTS.md"), file("TOOLS.md"), file("notes/today.md")];
    expect(renameProblem("TOOLS.md", "TOOLS.md", existing)).toBe("Choose a different name.");
    expect(renameProblem("agents.md", "TOOLS.md", existing)).toBe("AGENTS.md already exists.");
    expect(renameProblem("../TOOLS.md", "TOOLS.md", existing)).toMatch(/relative path/);
    expect(renameProblem("tools.sh", "TOOLS.md", existing)).toMatch(/text file/);
    expect(renameProblem(" reference/TOOLS.md ", "TOOLS.md", existing)).toBeNull();
    // The server compares names without case, so a change of case alone is refused.
    expect(renameProblem("tools.md", "TOOLS.md", existing)).toBe("Choose a different name.");
  });
});

describe("actionableCandidates", () => {
  it("keeps the per-run suggestions a person can accept", () => {
    const candidates = [
      { runId: "a", contract: "legacy", content: "x" },
      { runId: "b", contract: "agent_files", content: "y" },
      { runId: "c", contract: "legacy", content: null },
    ] as unknown as AgentInstructionCandidate[];
    expect(actionableCandidates(candidates).map((candidate) => candidate.runId)).toEqual(["a"]);
    expect(actionableCandidates(undefined)).toEqual([]);
  });
});

// The rest of the bundle settings' tests are in settings-models.test.ts.
describe("bundle settings: requireExistingEntry", () => {
  const managed = bundleDraft({ mode: "managed", rootPath: null, managedRootPath: "/data/agents/a1/instructions", entryFile: "AGENTS.md" });

  it("asks the server to find an external folder's entry file rather than create it", () => {
    expect(bundleUpdate(managed, managed)).toBeNull();
    expect(bundleUpdate(managed, { mode: "external", rootPath: " /srv/prompts ", entryFile: "AGENTS.md" })).toEqual({
      mode: "external",
      rootPath: "/srv/prompts",
      entryFile: "AGENTS.md",
      requireExistingEntry: true,
    });
    const external = { mode: "external" as const, rootPath: "/srv/prompts", entryFile: "AGENTS.md" };
    expect(bundleUpdate(external, { ...external, entryFile: "CLAUDE.md" })).toEqual({ mode: "external", rootPath: "/srv/prompts", entryFile: "CLAUDE.md", requireExistingEntry: true });
  });

  it("lets a managed bundle start a new entry file, and moves back to managed without the check", () => {
    expect(bundleUpdate(managed, { ...managed, entryFile: "CLAUDE.md" })).toEqual({ mode: "managed", rootPath: null, entryFile: "CLAUDE.md" });
    const external = { mode: "external" as const, rootPath: "/srv/prompts", entryFile: "AGENTS.md" };
    expect(bundleUpdate(external, { ...external, mode: "managed" })).toEqual({ mode: "managed", rootPath: null, entryFile: "AGENTS.md" });
  });
});
