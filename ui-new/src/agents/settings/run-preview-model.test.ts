import type { ClaudeRunPreviewProject } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  blockerLines,
  checkoutValue,
  chosenProject,
  claudeMdValue,
  credentialValue,
  engineValue,
  instructionsValue,
  previewManifest,
  projectChoices,
  projectKey,
  readStoredProject,
  repoSkillsValue,
  storeProject,
  taskWorktreeValue,
  unsupportedText,
} from "./run-preview-model";

const local: ClaudeRunPreviewProject = { id: "p1", name: "Site", checkout: { kind: "local", path: "/work/site" } };
const notCloned: ClaudeRunPreviewProject = { id: "p2", name: "App", checkout: { kind: "not_cloned", repoUrl: "https://github.com/acme/app" } };
const noWorkspace: ClaudeRunPreviewProject = { id: "p3", name: "Notes", checkout: { kind: "none" } };

describe("a preview that isn't available", () => {
  it("says why in one line, for each reason", () => {
    expect(unsupportedText("not_claude_local")).toMatch(/only Claude \(claude_local\) runs are sealed/);
    expect(unsupportedText("not_cli_engine")).toMatch(/^Not available on the ACP engine/);
    expect(unsupportedText("runner")).toMatch(/Paperclip Runner/);
    expect(unsupportedText("remote_target")).toMatch(/remote target/);
    expect(unsupportedText("something_new")).toBe("Not available for this agent.");
  });

  it("has no manifest", () => {
    expect(previewManifest({ supported: false, reason: "runner" })).toBeNull();
    expect(previewManifest(undefined)).toBeNull();
  });
});

describe("blockers", () => {
  it("are the server's messages, or the code when a message is missing", () => {
    expect(
      blockerLines([
        { code: "claude_credential_missing", message: "No Claude credential: connect one in AI connections." },
        { code: "paperclip_mcp_unavailable", message: "  " },
      ]),
    ).toEqual(["No Claude credential: connect one in AI connections.", "paperclip_mcp_unavailable"]);
    expect(blockerLines([])).toEqual([]);
    expect(blockerLines(undefined)).toEqual([]);
  });
});

describe("the rows' values", () => {
  it("name the engine and its config folder", () => {
    expect(engineValue({ engine: "cli", configDir: "/home/p/.paperclip/agents/a1/claude" })).toEqual({ text: "CLI, sealed · config folder", path: "/home/p/.paperclip/agents/a1/claude" });
    expect(engineValue({ engine: "cli", configDir: "" })).toEqual({ text: "CLI, sealed", path: null });
  });

  it("show the project's checkout plainly", () => {
    expect(checkoutValue(local.checkout)).toEqual({ text: null, path: "/work/site" });
    expect(checkoutValue(notCloned.checkout)).toEqual({ text: "Not cloned yet, from", path: "https://github.com/acme/app" });
    expect(checkoutValue(noWorkspace.checkout)).toEqual({ text: "None: runs work in the agent's own folder", path: null });
    expect(checkoutValue(undefined).text).toBe("Not recorded");
  });

  it("say no project is selected", () => {
    expect(claudeMdValue({ enabled: false, reason: "no_project" }, null).text).toBe("No project selected");
    expect(repoSkillsValue({ enabled: false, reason: "no_project" }, null).text).toBe("No project selected");
  });

  it("say a chosen project without a workspace has no repository (the preview reads no_project for it)", () => {
    expect(claudeMdValue({ enabled: false, reason: "no_project" }, noWorkspace).text).toBe("Not loaded: the project has no repository");
    expect(repoSkillsValue({ enabled: false, reason: "no_project" }, noWorkspace).text).toBe("Not loaded: the project has no repository");
  });

  it("name the credential, or say runs will be refused without one", () => {
    expect(credentialValue({ kind: "managed_connection", method: "subscription", connectionId: "c1", connectionName: "Claude Max" })).toBe("Claude subscription · connection Claude Max");
    expect(credentialValue(null)).toBe("None: runs will be refused");
    expect(credentialValue(undefined)).toBe("Not recorded");
  });

  it("show where tasks get their own worktree, and from what", () => {
    const worktreeCheckout = { kind: "local" as const, path: "/work/site", worktree: { dir: "/work/site/.paperclip/worktrees", baseRef: "origin/main" } };
    expect(checkoutValue(worktreeCheckout)).toEqual({ text: null, path: "/work/site" });
    expect(taskWorktreeValue(worktreeCheckout)).toEqual({ text: "From origin/main, in", path: "/work/site/.paperclip/worktrees" });
    expect(taskWorktreeValue({ ...worktreeCheckout, worktree: { dir: "/w", baseRef: null } })).toEqual({ text: "From a branch fetched on the first run, in", path: "/w" });
    expect(taskWorktreeValue(local.checkout)).toBeNull();
    expect(taskWorktreeValue(notCloned.checkout)).toBeNull();
    expect(taskWorktreeValue(undefined)).toBeNull();
    expect(claudeMdValue({ enabled: false, reason: "base_not_fetched" }, local).text).toBe("Not fetched yet: read from the task's worktree on its first run");
    expect(repoSkillsValue({ enabled: false, reason: "base_not_fetched" }, local).text).toBe("Not fetched yet: read from the task's worktree on its first run");
  });

  it("read a repository that isn't cloned yet", () => {
    expect(claudeMdValue({ enabled: false, reason: "not_cloned" }, notCloned).text).toBe("Not cloned yet: read on the first run");
    expect(repoSkillsValue({ enabled: false, reason: "not_cloned" }, notCloned).text).toBe("Not cloned yet: read on the first run");
  });

  it("give the file and skills that would load", () => {
    expect(claudeMdValue({ enabled: true, path: "/work/site/CLAUDE.md" }, local)).toEqual({ text: null, path: "/work/site/CLAUDE.md" });
    expect(repoSkillsValue({ enabled: true, dir: "/work/site/.claude/skills", count: 3 }, local)).toEqual({ text: "3 skills from", path: "/work/site/.claude/skills" });
    expect(repoSkillsValue({ enabled: true, dir: "/work/site/.claude/skills", count: 1 }, local).text).toBe("1 skill from");
  });

  it("give the other reasons in words", () => {
    expect(claudeMdValue({ enabled: false, reason: "project_switch_off" }, local).text).toBe("Off for this project");
    expect(claudeMdValue({ enabled: false, reason: "no_file" }, local).text).toBe("Not loaded: the repository has no CLAUDE.md at its root");
    expect(repoSkillsValue({ enabled: false, reason: "no_skills" }, local).text).toBe("None: the repository has no skills in .claude/skills");
    expect(claudeMdValue({ enabled: false, reason: "not_in_repo" }, noWorkspace).text).toBe("Not loaded: the project has no repository");
    expect(repoSkillsValue({ enabled: false, reason: "not_in_repo" }, local).text).toBe("Not loaded: runs won't be in the project's repository");
    expect(claudeMdValue(undefined, null).text).toBe("Not recorded");
  });

  it("name the instructions' entry file", () => {
    expect(instructionsValue({ entryFile: "AGENTS.md", sent: true })).toEqual({ text: null, path: "AGENTS.md" });
    expect(instructionsValue({ entryFile: null, sent: false }).text).toBe("None");
  });
});

describe("the project choice", () => {
  const projects = [
    { id: "p1", name: "Site", archivedAt: null },
    { id: "old", name: "Old", archivedAt: "2026-01-01T00:00:00Z" },
    { id: "p2", name: "App", archivedAt: null },
  ];

  it("offers the projects that aren't archived, in order", () => {
    expect(projectChoices(projects)).toEqual([
      { id: "p1", name: "Site" },
      { id: "p2", name: "App" },
    ]);
    expect(projectChoices(undefined)).toEqual([]);
  });

  it("keeps the remembered project while the list loads, and only if it's still there", () => {
    const choices = projectChoices(projects);
    expect(chosenProject("p2", undefined)).toBe("p2");
    expect(chosenProject("p2", choices)).toBe("p2");
    expect(chosenProject("old", choices)).toBeNull();
    expect(chosenProject("gone", choices)).toBeNull();
    expect(chosenProject(null, choices)).toBeNull();
  });

  it("is remembered per agent, and No project forgets it", () => {
    const data = new Map<string, string>();
    const store = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    storeProject("a1", "p1", store);
    storeProject("a2", "p2", store);
    expect(readStoredProject("a1", store)).toBe("p1");
    expect(readStoredProject("a2", store)).toBe("p2");
    storeProject("a1", null, store);
    expect(data.has(projectKey("a1"))).toBe(false);
    expect(readStoredProject("a1", store)).toBeNull();
  });

  it("survives storage that throws or is missing", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredProject("a1", broken)).toBeNull();
    expect(() => storeProject("a1", "p1", broken)).not.toThrow();
    expect(readStoredProject("a1", null)).toBeNull();
  });
});
