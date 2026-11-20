import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PaperclipSkillEntry } from "@paperclipai/adapter-utils/server-utils";
import {
  CLAUDE_PROMPT_BUNDLE_LAYOUT,
  buildClaudePromptBundleKey,
  claudeSkillPlugin,
  prepareClaudePromptBundle,
} from "./prompt-cache.js";

async function writeSkill(root: string, name: string): Promise<string> {
  const dir = path.join(root, "library", name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`);
  return dir;
}

async function list(dir: string): Promise<string[]> {
  return (await fs.readdir(dir)).sort();
}

async function exists(target: string): Promise<boolean> {
  return fs.lstat(target).then(() => true).catch(() => false);
}

describe("the Claude prompt bundle", () => {
  let root: string;
  let previousHome: string | undefined;
  let previousInstance: string | undefined;
  let skills: PaperclipSkillEntry[];
  const logs: string[] = [];
  const onLog = async (_stream: "stdout" | "stderr", chunk: string) => {
    logs.push(chunk);
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-prompt-cache-"));
    previousHome = process.env.PAPERCLIP_HOME;
    previousInstance = process.env.PAPERCLIP_INSTANCE_ID;
    process.env.PAPERCLIP_HOME = path.join(root, "paperclip-home");
    process.env.PAPERCLIP_INSTANCE_ID = "prompt-cache-test";
    logs.length = 0;
    skills = [
      { key: "paperclipai/paperclip/paperclip", runtimeName: "paperclip", source: await writeSkill(root, "paperclip") },
      { key: "paperclipai/paperclip/complain", runtimeName: "complain", source: await writeSkill(root, "complain") },
      { key: "company/company-1/review", runtimeName: "review", source: await writeSkill(root, "review") },
    ];
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = previousHome;
    if (previousInstance === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
    else process.env.PAPERCLIP_INSTANCE_ID = previousInstance;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("holds a paperclip plugin and a company plugin", async () => {
    const bundle = await prepareClaudePromptBundle({ companyId: "company-1", skills, instructionsContents: null, onLog });

    expect(bundle.pluginDir).toBe(path.join(bundle.rootDir, "plugins"));
    expect(await list(bundle.pluginDir)).toEqual(["company", "paperclip"]);

    const paperclipManifest = JSON.parse(
      await fs.readFile(path.join(bundle.pluginDir, "paperclip", ".claude-plugin", "plugin.json"), "utf8"),
    );
    expect(paperclipManifest).toEqual({
      name: "paperclip",
      description: "Paperclip's own skills: working in Paperclip, feedback, hiring, memory",
    });
    expect(await list(path.join(bundle.pluginDir, "paperclip", "skills"))).toEqual(["complain", "paperclip"]);

    const companyManifest = JSON.parse(
      await fs.readFile(path.join(bundle.pluginDir, "company", ".claude-plugin", "plugin.json"), "utf8"),
    );
    expect(companyManifest).toEqual({ name: "company", description: "Skills from this company's skill library" });
    expect(await list(path.join(bundle.pluginDir, "company", "skills"))).toEqual(["review"]);

    const linked = path.join(bundle.pluginDir, "company", "skills", "review");
    expect((await fs.lstat(linked)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(path.join(linked, "SKILL.md"), "utf8")).toContain("# review");
    expect(logs).toEqual([]);
  });

  it("leaves out a plugin with no skills", async () => {
    const bundle = await prepareClaudePromptBundle({
      companyId: "company-1",
      skills: skills.filter((skill) => skill.key.startsWith("paperclipai/paperclip/")),
      instructionsContents: null,
      onLog,
    });
    expect(await list(bundle.pluginDir)).toEqual(["paperclip"]);
    expect(await exists(path.join(bundle.pluginDir, "company"))).toBe(false);
  });

  it("keeps .claude/skills with every skill for the remote path", async () => {
    const bundle = await prepareClaudePromptBundle({
      companyId: "company-1",
      skills,
      instructionsContents: "Be brief.",
      onLog,
    });
    expect(bundle.addDir).toBe(bundle.rootDir);
    expect(await list(path.join(bundle.rootDir, ".claude", "skills"))).toEqual(["complain", "paperclip", "review"]);
    expect(bundle.instructionsFilePath).toBe(path.join(bundle.rootDir, "agent-instructions.md"));
    expect(await fs.readFile(bundle.instructionsFilePath!, "utf8")).toBe("Be brief.");
  });

  it("prepares the same bundle twice, also concurrently", async () => {
    const [a, b] = await Promise.all([
      prepareClaudePromptBundle({ companyId: "company-1", skills, instructionsContents: null, onLog }),
      prepareClaudePromptBundle({ companyId: "company-1", skills, instructionsContents: null, onLog }),
    ]);
    const c = await prepareClaudePromptBundle({ companyId: "company-1", skills, instructionsContents: null, onLog });
    expect(a.bundleKey).toBe(b.bundleKey);
    expect(c.bundleKey).toBe(a.bundleKey);
    expect(await list(path.join(c.pluginDir, "paperclip", "skills"))).toEqual(["complain", "paperclip"]);
    expect(logs).toEqual([]);
  });

  it("claudeSkillPlugin sorts keys by where the skill comes from", () => {
    expect(claudeSkillPlugin("paperclipai/paperclip/paperclip")).toBe("paperclip");
    expect(claudeSkillPlugin("paperclipai/paperclip/complain")).toBe("paperclip");
    expect(claudeSkillPlugin("paperclipai/paperclip/para-memory-files")).toBe("paperclip");
    expect(claudeSkillPlugin("company/company-1/review")).toBe("company");
    expect(claudeSkillPlugin("github.com/acme/remote-skill")).toBe("company");
    expect(claudeSkillPlugin("paperclipai/other/thing")).toBe("company");
  });

  it("the bundle key depends on the layout", async () => {
    expect(CLAUDE_PROMPT_BUNDLE_LAYOUT).toBe(2);
    const input = { skills, instructionsContents: "Be brief." };
    const layout1 = await buildClaudePromptBundleKey({ ...input, layout: 1 });
    const layout2 = await buildClaudePromptBundleKey({ ...input, layout: 2 });
    expect(layout1).not.toBe(layout2);
    expect(await buildClaudePromptBundleKey(input)).toBe(layout2);
  });
});
