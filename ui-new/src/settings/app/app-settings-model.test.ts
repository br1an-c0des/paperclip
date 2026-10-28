import type { Company, PluginRecord } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { AdapterInfo } from "@/api/agents";
import type { BundledPlugin } from "@/api/plugins";
import {
  accessChanged,
  appSettingsRoute,
  avatarNamespace,
  backupStatus,
  bundledRows,
  compareVersions,
  defaultSection,
  demoteProblem,
  discName,
  deploymentMode,
  displayNameProblem,
  groupHarnesses,
  harnessSummary,
  harnessUsage,
  isExperimentalPlugin,
  legacySettingsSuffix,
  parseInstallTarget,
  pluginErrorSummary,
  pluginOn,
  renameEdit,
  signInChecks,
  sortOrganizations,
  updateOffer,
  visibleSections,
} from "./app-settings-model";

function adapter(type: string, extra: Partial<AdapterInfo> = {}): AdapterInfo {
  return {
    type,
    label: type,
    source: "builtin",
    disabled: false,
    loaded: true,
    capabilities: { supportsInstructionsBundle: true, supportsSkills: true, supportsLocalAgentJwt: true, supportsAcp: false },
    ...extra,
  };
}

function agent(adapterType: string, adapterConfig: Record<string, unknown> = {}, status = "idle") {
  return { adapterType, adapterConfig, status } as never;
}

describe("sections and addresses", () => {
  it("shows admins every section and others only Account", () => {
    const keys = (isAdmin: boolean, hidden?: string[]) =>
      visibleSections(isAdmin, hidden).map((entry) => ("heading" in entry ? `# ${entry.heading}` : entry.key));
    expect(keys(true)).toEqual(["# You", "account", "# This instance", "general", "organizations", "admins", "harnesses", "plugins"]);
    expect(keys(false)).toEqual(["# You", "account"]);
    expect(keys(true, ["instance.adapters", "instance.profile"])).toEqual(["# This instance", "general", "organizations", "admins", "plugins"]);
  });

  it("opens General for admins and Account otherwise", () => {
    expect(defaultSection(visibleSections(true))).toBe("general");
    expect(defaultSection(visibleSections(false))).toBe("account");
    expect(defaultSection(visibleSections(false, ["instance.profile"]))).toBeNull();
  });

  it("resolves sections and the old UI's instance-settings addresses", () => {
    expect(appSettingsRoute("")).toEqual({ kind: "default" });
    expect(appSettingsRoute("/harnesses")).toEqual({ kind: "section", section: "harnesses" });
    expect(appSettingsRoute("/Plugins")).toEqual({ kind: "section", section: "plugins" });
    expect(appSettingsRoute("/profile")).toEqual({ kind: "redirect", to: "/company/settings/instance/account" });
    expect(appSettingsRoute("/access")).toEqual({ kind: "redirect", to: "/company/settings/instance/admins" });
    expect(appSettingsRoute("/adapters")).toEqual({ kind: "redirect", to: "/company/settings/instance/harnesses" });
    expect(appSettingsRoute("/experimental")).toEqual({ kind: "redirect", to: "/company/settings/instance/general" });
    expect(appSettingsRoute("/plugins/123")).toEqual({ kind: "redirect", to: "/company/settings/instance/plugins" });
    expect(appSettingsRoute("/environments/abc/edit")).toEqual({ kind: "redirect", to: "/company/settings/environments" });
    expect(appSettingsRoute("/nope")).toEqual({ kind: "default" });
  });

  it("maps the unprefixed old addresses to a suffix", () => {
    expect(legacySettingsSuffix("instance", "")).toBe("");
    expect(legacySettingsSuffix("instance", "settings")).toBe("");
    expect(legacySettingsSuffix("instance", "settings/plugins/abc")).toBe("/plugins/abc");
    expect(legacySettingsSuffix("instance", "other")).toBe("");
    expect(legacySettingsSuffix("settings", "adapters")).toBe("/adapters");
  });
});

describe("harnesses", () => {
  const usage = harnessUsage([
    agent("claude_local"),
    agent("claude_local"),
    agent("paperclip_runner", { provider: "acpx", acpxAgent: "claude" }),
    agent("codex_local", {}, "terminated"),
    agent("paperclip_runner"),
  ]);

  it("counts agents per harness, the runner's for their harness too, and skips terminated ones", () => {
    expect(usage).toEqual({
      claude_local: { agents: 3, viaRunner: 1 },
      codex_local: { agents: 1, viaRunner: 1 },
      paperclip_runner: { agents: 2, viaRunner: 0 },
    });
  });

  it("groups built-in harnesses by use and keeps installed packages apart", () => {
    const groups = groupHarnesses(
      [
        adapter("codex_local"),
        adapter("claude_local"),
        adapter("gemini_local", { disabled: true }),
        adapter("acpx_local"),
        adapter("paperclip_runner"),
        adapter("aider", { source: "external", packageName: "@acme/aider", version: "0.4.1" }),
        adapter("codex_local-x", { source: "external", label: "Fancy Codex" }),
      ],
      usage,
    );
    expect(groups.inUse.map((row) => row.label)).toEqual(["Claude Code", "Paperclip Runner", "Codex"]);
    expect(groups.otherBuiltIn.map((row) => [row.label, row.on, row.state])).toEqual([["Gemini CLI", false, "off"]]);
    expect(groups.installed.map((row) => row.label)).toEqual(["aider", "Fancy Codex"]);
  });

  it("treats an override's switch as its pause, and flags packages that didn't load", () => {
    const groups = groupHarnesses(
      [
        adapter("claude_local", { source: "external", overriddenBuiltin: true, overridePaused: true, packageName: "claude-fork" }),
        adapter("broken", { source: "external", loaded: false }),
      ],
      {},
    );
    const [broken, override] = groups.installed;
    expect(override).toMatchObject({ on: false, state: "paused", replaces: "Claude Code" });
    expect(broken?.state).toBe("failed");
  });

  it("summarizes a row", () => {
    const groups = groupHarnesses(
      [adapter("claude_local"), adapter("paperclip_runner"), adapter("aider", { source: "external", version: "0.4.1" })],
      usage,
    );
    expect(harnessSummary(groups.inUse[0]!)).toBe("Built in · 3 agents, 1 on the Paperclip Runner");
    expect(harnessSummary(groups.inUse[1]!)).toBe("Built in · 2 agents · carries Claude Code, Codex, OpenCode and Pi");
    expect(harnessSummary(groups.installed[0]!)).toBe("Version 0.4.1 · no agents yet");
  });

  it("reads an install field as a folder or an npm package with a version", () => {
    expect(parseInstallTarget("  ")).toMatchObject({ ok: false });
    expect(parseInstallTarget("/home/me/adapter")).toEqual({ ok: true, target: { packageName: "/home/me/adapter", isLocalPath: true } });
    expect(parseInstallTarget("~/adapter")).toMatchObject({ target: { isLocalPath: true } });
    expect(parseInstallTarget("E:\\Projects\\adapter")).toMatchObject({ target: { isLocalPath: true } });
    expect(parseInstallTarget("./adapter")).toMatchObject({ target: { isLocalPath: true } });
    expect(parseInstallTarget("@acme/paperclip-adapter")).toEqual({ ok: true, target: { packageName: "@acme/paperclip-adapter", isLocalPath: false } });
    expect(parseInstallTarget("@acme/paperclip-adapter@0.5.0")).toEqual({
      ok: true,
      target: { packageName: "@acme/paperclip-adapter", version: "0.5.0", isLocalPath: false },
    });
    expect(parseInstallTarget("aider@latest")).toMatchObject({ target: { packageName: "aider", version: "latest" } });
    expect(parseInstallTarget("Not A Package")).toMatchObject({ ok: false });
    expect(parseInstallTarget("pkg@1 2")).toMatchObject({ ok: false });
  });

  it("offers an update only when npm has a newer version", () => {
    expect(compareVersions("0.4.1", "0.5.0")).toBeLessThan(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.2.0", "1.2")).toBe(0);
    expect(updateOffer({ version: "0.4.1" }, "0.5.0")).toBe("0.5.0");
    expect(updateOffer({ version: "0.5.0" }, "0.5.0")).toBeNull();
    expect(updateOffer({ version: "0.6.0" }, "0.5.0")).toBeNull();
    expect(updateOffer({ version: "0.4.1", isLocalPath: true }, "0.5.0")).toBeNull();
    expect(updateOffer({ version: "0.4.1" }, null)).toBeNull();
  });
});

describe("plugins", () => {
  it("reads status and errors", () => {
    expect(pluginOn("ready")).toBe(true);
    expect(pluginOn("error")).toBe(true);
    expect(pluginOn("disabled")).toBe(false);
    expect(pluginErrorSummary("\n  Worker crashed\nstack…")).toBe("Worker crashed");
    expect(pluginErrorSummary(null)).toMatch(/no message/);
  });

  it("drops punctuation from a disc's name", () => {
    expect(discName("Kitchen Sink (Example)")).toBe("Kitchen Sink Example");
    expect(discName("exe.dev Sandbox")).toBe("exe dev Sandbox");
    expect(discName("()")).toBe("()");
  });

  it("marks sandbox plugins experimental", () => {
    expect(isExperimentalPlugin({ packageName: "@paperclipai/plugin-e2b", bundledExperimental: true })).toBe(true);
    expect(isExperimentalPlugin({ packageName: "@acme/plugin-fake-sandbox" })).toBe(true);
    expect(isExperimentalPlugin({ packageName: "@acme/plugin-linear" })).toBe(false);
  });

  it("pairs bundled plugins with their installed record, first-party first", () => {
    const bundled = [
      { packageName: "b", displayName: "Hello", tag: "example" },
      { packageName: "a", displayName: "Wiki", tag: "first-party" },
    ] as BundledPlugin[];
    const installed = [{ packageName: "b", status: "ready" }] as PluginRecord[];
    expect(bundledRows(bundled, installed).map((row) => [row.plugin.displayName, row.installed?.status ?? null])).toEqual([
      ["Wiki", null],
      ["Hello", "ready"],
    ]);
  });
});

describe("general", () => {
  it("describes the deployment and its sign-in checks", () => {
    expect(deploymentMode({ status: "ok", deploymentMode: "local_trusted" }).label).toBe("Local trusted");
    expect(deploymentMode({ status: "ok", deploymentMode: "authenticated", deploymentExposure: "public" }).note).toMatch(/^Public/);
    expect(signInChecks({ status: "ok", deploymentMode: "local_trusted" })).toEqual([]);
    expect(signInChecks({ status: "ok", deploymentMode: "authenticated", authReady: true, bootstrapStatus: "bootstrap_pending" })).toEqual([
      { ok: true, text: "Sign-in is ready" },
      { ok: false, text: "No instance admin yet: claim the first-admin invite" },
    ]);
  });

  it("says when the last backup ran, or what's wrong", () => {
    const now = Date.parse("2026-10-27T12:00:00Z");
    expect(backupStatus(undefined)).toBeNull();
    expect(backupStatus({ enabled: false, status: "ok" })?.ok).toBe(false);
    expect(backupStatus({ enabled: true, status: "warning", warnings: [{ code: "database_backup_stale", message: "Stale" }] })).toEqual({ ok: false, text: "Stale" });
    expect(
      backupStatus({ enabled: true, status: "ok", latestBackup: { mtime: "2026-10-27T11:12:00Z", ageHours: 0.8, sizeBytes: 558_540 } }, now)?.text,
    ).toBe("Last backup 48 min ago, 0.5 MB. Backups run about every hour.");
  });
});

describe("organizations, admins and account", () => {
  it("sorts organizations by status, then name", () => {
    const companies = [
      { name: "Zed", status: "active" },
      { name: "Old", status: "archived" },
      { name: "Acme", status: "active" },
      { name: "Hold", status: "paused" },
    ] as Company[];
    expect(sortOrganizations(companies).map((company) => company.name)).toEqual(["Acme", "Zed", "Hold", "Old"]);
  });

  it("saves a rename only when the name changes", () => {
    expect(renameEdit("Acme", " Acme ")).toBeNull();
    expect(renameEdit("Acme", "")).toBeNull();
    expect(renameEdit("Acme", "Acme Labs ")).toBe("Acme Labs");
  });

  it("keeps you and the last admin", () => {
    expect(demoteProblem({ id: "me", isInstanceAdmin: true }, "me", 3)).toMatch(/yourself/);
    expect(demoteProblem({ id: "a", isInstanceAdmin: true }, "me", 1)).toMatch(/at least one/);
    expect(demoteProblem({ id: "a", isInstanceAdmin: true }, "me", 2)).toBeNull();
    expect(demoteProblem({ id: "a", isInstanceAdmin: false }, "me", 1)).toBeNull();
  });

  it("compares organization access", () => {
    expect(accessChanged(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(false);
    expect(accessChanged(new Set(["a"]), new Set(["a", "b"]))).toBe(true);
    expect(accessChanged(new Set(["a", "b"]), new Set(["a", "c"]))).toBe(true);
  });

  it("cleans the avatar namespace and checks the name", () => {
    expect(avatarNamespace("local-board")).toBe("profiles/local-board");
    expect(avatarNamespace("a b/c")).toBe("profiles/a-b-c");
    expect(avatarNamespace("..")).toBe("profiles");
    expect(displayNameProblem("  ")).toBe("Enter a name.");
    expect(displayNameProblem("x".repeat(121))).toMatch(/120/);
    expect(displayNameProblem("Brian")).toBeNull();
  });
});
