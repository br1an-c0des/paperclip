import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SET_ASIDE_CONFIG_ENTRIES,
  createSealedRunHome,
  prepareAgentClaudeConfigDir,
  resolveAgentClaudeConfigDir,
  resolveAgentClaudeSetAsideDir,
} from "./agent-config-dir.js";

async function exists(target: string): Promise<boolean> {
  return fs.lstat(target).then(() => true).catch(() => false);
}

describe("agent Claude config folder", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-agent-config-dir-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("puts the config and set-aside folders in the agent's folder", () => {
    const env = { PAPERCLIP_HOME: path.join(root, "home"), PAPERCLIP_INSTANCE_ID: "inst" };
    const configDir = resolveAgentClaudeConfigDir(env, "company-1", "agent-1");
    const setAsideDir = resolveAgentClaudeSetAsideDir(env, "company-1", "agent-1", "run-1");
    expect(configDir.startsWith(path.join(root, "home"))).toBe(true);
    expect(configDir.endsWith(path.join("companies", "company-1", "agents", "agent-1", "claude-config"))).toBe(true);
    expect(setAsideDir).toBe(path.join(path.dirname(configDir), "claude-config-set-aside", "run-1"));
  });

  it("lists what loads as configuration", () => {
    expect([...SET_ASIDE_CONFIG_ENTRIES].sort()).toEqual([
      "CLAUDE.local.md", "CLAUDE.md", "agents", "commands", "hooks", "output-styles", "rules",
      "settings.json", "settings.local.json", "skills",
    ].sort());
  });

  it("sets aside stray configuration and leaves Claude Code's own files", async () => {
    const configDir = path.join(root, "claude-config");
    const setAsideDir = path.join(root, "claude-config-set-aside", "run-1");
    await fs.mkdir(path.join(configDir, "skills", "x"), { recursive: true });
    await fs.mkdir(path.join(configDir, "projects", "p"), { recursive: true });
    await fs.writeFile(path.join(configDir, "settings.json"), "{}");
    await fs.writeFile(path.join(configDir, "skills", "x", "SKILL.md"), "# x");
    await fs.writeFile(path.join(configDir, "projects", "p", "s.jsonl"), "{}\n");
    await fs.writeFile(path.join(configDir, ".claude.json"), "{}");

    const result = await prepareAgentClaudeConfigDir({ configDir, setAsideDir });

    expect(result.setAside).toEqual(["settings.json", "skills"]);
    expect(await fs.readFile(path.join(setAsideDir, "settings.json"), "utf8")).toBe("{}");
    expect(await fs.readFile(path.join(setAsideDir, "skills", "x", "SKILL.md"), "utf8")).toBe("# x");
    expect(await exists(path.join(configDir, "settings.json"))).toBe(false);
    expect(await exists(path.join(configDir, "skills"))).toBe(false);
    expect(await fs.readFile(path.join(configDir, "projects", "p", "s.jsonl"), "utf8")).toBe("{}\n");
    expect(await fs.readFile(path.join(configDir, ".claude.json"), "utf8")).toBe("{}");
  });

  it("creates a missing config folder privately and no set-aside folder when nothing moves", async () => {
    const configDir = path.join(root, "agent", "claude-config");
    const setAsideDir = path.join(root, "agent", "claude-config-set-aside", "run-1");

    const result = await prepareAgentClaudeConfigDir({ configDir, setAsideDir });

    expect(result.setAside).toEqual([]);
    const stats = await fs.stat(configDir);
    expect(stats.isDirectory()).toBe(true);
    if (process.platform !== "win32") expect(stats.mode & 0o777).toBe(0o700);
    expect(await exists(path.join(root, "agent", "claude-config-set-aside"))).toBe(false);
  });

  it("two concurrent runs setting aside the same file both carry on", async () => {
    const configDir = path.join(root, "claude-config");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, "settings.json"), "{\"hooks\":{}}");
    const setAsideA = path.join(root, "claude-config-set-aside", "run-a");
    const setAsideB = path.join(root, "claude-config-set-aside", "run-b");

    const [a, b] = await Promise.all([
      prepareAgentClaudeConfigDir({ configDir, setAsideDir: setAsideA }),
      prepareAgentClaudeConfigDir({ configDir, setAsideDir: setAsideB }),
    ]);

    expect([...a.setAside, ...b.setAside]).toEqual(["settings.json"]);
    const moved = [
      await exists(path.join(setAsideA, "settings.json")),
      await exists(path.join(setAsideB, "settings.json")),
    ].filter(Boolean);
    expect(moved).toHaveLength(1);
    expect(await exists(path.join(configDir, "settings.json"))).toBe(false);
  });

  it("createSealedRunHome gives a HOME with XDG folders and removes it on cleanup", async () => {
    const home = await createSealedRunHome("agent-1");
    try {
      expect(Object.keys(home.env).sort()).toEqual(["HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"]);
      expect((await fs.stat(home.env.HOME)).isDirectory()).toBe(true);
      for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME"]) {
        expect(home.env[key].startsWith(home.env.HOME + path.sep), key).toBe(true);
        expect((await fs.stat(home.env[key])).isDirectory(), key).toBe(true);
      }
      expect(home.env.HOME).not.toBe(os.homedir());
    } finally {
      await home.cleanup();
    }
    expect(await exists(home.env.HOME)).toBe(false);
    await home.cleanup();
  });
});
