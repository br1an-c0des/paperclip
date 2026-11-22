import type { InstanceExperimentalSettingsWithManaged } from "@paperclipai/shared";
// The schema at runtime, in the test only: an upstream rename or removal fails here, not in the app.
import { instanceExperimentalSettingsSchema } from "@paperclipai/shared/validators/instance";
import { describe, expect, it } from "vitest";
import {
  FEATURE_GROUPS,
  LEFT_OUT,
  featureFlag,
  featurePatch,
  featureRowState,
  linkedNote,
  visibleFeatureGroups,
  parseCleanupDays,
  WORKTREE_CLEANUP_VALUE_INFO,
  worktreeCleanupInfo,
  worktreeCleanupNote,
  worktreeCleanupOptions,
  worktreeCleanupPatch,
  worktreeCleanupValuesShown,
  type FeatureContext,
} from "./features-model";
import type { WorktreeCleanupStatus } from "@paperclipai/shared";

const schemaKeys = Object.keys(instanceExperimentalSettingsSchema.shape);
const booleanKeys = schemaKeys.filter((key) => {
  const field = instanceExperimentalSettingsSchema.shape[key as keyof typeof instanceExperimentalSettingsSchema.shape];
  return typeof field.parse(undefined) === "boolean";
});
const listed = FEATURE_GROUPS.flatMap((group) => group.flags.map((flag) => flag.key));

const settings = (patch: Partial<InstanceExperimentalSettingsWithManaged> = {}) =>
  ({ ...instanceExperimentalSettingsSchema.parse({}), ...patch }) as InstanceExperimentalSettingsWithManaged;
const context = (patch: Partial<InstanceExperimentalSettingsWithManaged> = {}, extra: Partial<FeatureContext> = {}): FeatureContext => ({
  settings: settings(patch),
  hidden: new Set(),
  editable: true,
  ...extra,
});
const flag = (key: Parameters<typeof featureFlag>[0]) => featureFlag(key)!;

describe("the Features card's flags", () => {
  it("lists only boolean flags that exist in the shared schema, each once", () => {
    for (const key of listed) expect(booleanKeys, `${key} is not a flag in instanceExperimentalSettingsSchema`).toContain(key);
    expect(new Set(listed).size).toBe(listed.length);
    for (const key of FEATURE_GROUPS.flatMap((group) => group.flags.flatMap((entry) => entry.requires ?? []))) {
      expect(listed, `requirement ${key} has no switch in the card`).toContain(key);
    }
  });

  it("sorts every flag in the schema: in the card or left out with a reason", () => {
    for (const key of Object.keys(LEFT_OUT)) expect(booleanKeys, `${key} is not a flag in instanceExperimentalSettingsSchema`).toContain(key);
    for (const key of listed) expect(LEFT_OUT).not.toHaveProperty(key);
    const unsorted = booleanKeys.filter((key) => !listed.includes(key as never) && !(key in LEFT_OUT));
    expect(unsorted, "new upstream flags: sort them under decision 12").toEqual([]);
  });

  it("keeps out the flags decision 12 drops or builds in, and maintainer tools", () => {
    for (const key of ["enableStreamlinedUi", "enableDecisions", "enableEnvironments", "enableSmokeLab", "enableConferenceRoomChat", "enablePaperclipDeveloperMode"]) {
      expect(listed).not.toContain(key);
    }
  });

  it("has no agent chat switch: chat is always on (U57, upstream #19360)", () => {
    expect(listed).not.toContain("enableAgentChat");
    expect(featureFlag("enableAgentChat")).toBeUndefined();
    expect(LEFT_OUT.enableAgentChat).toMatch(/^Built in/);
  });
});

describe("featureRowState", () => {
  it("blocks turning a flag on until what it needs is on, but lets it be turned off", () => {
    const dot = flag("enableOpenAiDot");
    expect(featureRowState(dot, context()).disabled).toBe(true);
    expect(featureRowState(dot, context()).note).toBe("Turn on Assistant connections (MCP) first.");
    expect(featureRowState(dot, context({ enablePublicMcp: true })).disabled).toBe(false);
    expect(featureRowState(dot, context({ enableOpenAiDot: true })).disabled).toBe(false);
    const grok = featureRowState(flag("enableGrokBot"), context({ enableNativeRunner: false }));
    expect(grok.requirements).toEqual([
      { key: "enablePublicMcp", label: "Assistant connections (MCP)", on: false },
      { key: "enableNativeRunner", label: "Paperclip Runner", on: false },
    ]);
    expect(grok.note).toBe("Turn on Assistant connections (MCP) and Paperclip Runner first.");
  });

  it("is read-only for people who aren't instance admins and while loading", () => {
    expect(featureRowState(flag("enableCases"), context({}, { editable: false })).disabled).toBe(true);
    expect(featureRowState(flag("enableCases"), { settings: undefined, hidden: new Set(), editable: true }).disabled).toBe(true);
    expect(featureRowState(flag("enableCases"), context()).disabled).toBe(false);
  });

  it("locks keys Paperclip Cloud manages", () => {
    const state = featureRowState(flag("enableCases"), context({ enableCases: true, managedKeys: { enableCases: { managed: true, managedBy: "paperclip-cloud" } } }));
    expect(state).toMatchObject({ checked: true, managed: true, disabled: true, note: "Managed by Paperclip Cloud." });
  });

  it("locks a linked switch whose other half is fixed", () => {
    const managed = { managed: true, managedBy: "paperclip-cloud" } as const;
    expect(featureRowState(flag("enableStatusCards"), context({ managedKeys: { enableSummaries: managed } })).disabled).toBe(true);
    expect(featureRowState(flag("enableStatusCards"), context()).disabled).toBe(false);
    expect(
      featureRowState(flag("enableSummaries"), context({ enableSummaries: true, enableStatusCards: true, managedKeys: { enableStatusCards: managed } })).note,
    ).toBe("Status cards needs this on.");
  });
});

describe("featurePatch", () => {
  it("sends the one key, plus the linked changes", () => {
    expect(featurePatch(flag("enableCases"), true, settings())).toEqual({ enableCases: true });
    expect(featurePatch(flag("enableStatusCards"), true, settings())).toEqual({ enableStatusCards: true, enableSummaries: true });
    expect(featurePatch(flag("enableStatusCards"), false, settings({ enableStatusCards: true, enableSummaries: true }))).toEqual({ enableStatusCards: false });
    expect(featurePatch(flag("enableSummaries"), false, settings({ enableStatusCards: true, enableSummaries: true }))).toEqual({
      enableSummaries: false,
      enableStatusCards: false,
    });
    expect(featurePatch(flag("enableSummaries"), false, settings({ enableSummaries: true }))).toEqual({ enableSummaries: false });
    // Plain requirements aren't changed for you.
    expect(featurePatch(flag("enablePublicMcp"), false, settings({ enablePublicMcp: true, enableOpenAiDot: true }))).toEqual({ enablePublicMcp: false });
  });

  it("says what else a switch changes", () => {
    expect(linkedNote(flag("enableStatusCards"), settings())).toBe("Turning this on also turns on Summaries.");
    expect(linkedNote(flag("enableSummaries"), settings({ enableSummaries: true, enableStatusCards: true }))).toBe("Turning this off also turns off Status cards.");
    expect(linkedNote(flag("enableSummaries"), settings({ enableSummaries: true }))).toBeNull();
  });
});

describe("visibleFeatureGroups", () => {
  it("drops flags an operator hides, and the whole card with the Experimental page", () => {
    const groups = visibleFeatureGroups(new Set(["instance.experimental.enableCases"]));
    expect(groups.flatMap((group) => group.flags.map((entry) => entry.key))).not.toContain("enableCases");
    expect(groups.length).toBe(FEATURE_GROUPS.length);
    expect(visibleFeatureGroups(new Set(["instance.experimental"]))).toEqual([]);
  });
});

describe("worktree cleanup (step 4b part 3)", () => {
  const status = (patch: Partial<WorktreeCleanupStatus> = {}): WorktreeCleanupStatus => ({
    saved: null,
    mode: "merged",
    source: "environment",
    dryRun: false,
    restorePoints: { available: true, reason: null },
    values: { waitDays: 1, removeBuildOutput: true, restorePointAfterDays: 3, restorePointIdleDays: 7 },
    retentionDays: 90,
    ...patch,
  });

  it("retires the two worktree switches and puts the cleanup choice in Tasks and workspaces", () => {
    expect(listed).not.toContain("enableIsolatedWorkspaces");
    expect(listed).not.toContain("enableIsolatedWorkspacesByDefault");
    expect(LEFT_OUT.enableIsolatedWorkspaces).toMatch(/^Built in/);
    const tasks = visibleFeatureGroups(new Set()).find((group) => group.title === "Tasks and workspaces");
    expect(tasks?.worktreeCleanup).toBe(true);
    expect(visibleFeatureGroups(new Set(["instance.experimental.worktreeCleanup"])).find((group) => group.title === "Tasks and workspaces")?.worktreeCleanup).toBeUndefined();
  });

  it("offers its four levels, restore points unavailable without their prerequisites", () => {
    expect(worktreeCleanupOptions(status()).map((option) => [option.value, option.label, option.disabled])).toEqual([
      ["off", "Off", false],
      ["merged", "Merged work only", false],
      ["strict", "Merged or pushed", false],
      ["restore_points", "Everything, with restore points", false],
    ]);
    const unavailable = status({ restorePoints: { available: false, reason: "File storage is S3 and PAPERCLIP_SECRETS_MASTER_KEY isn't set." } });
    const restore = worktreeCleanupOptions(unavailable).find((option) => option.value === "restore_points")!;
    expect(restore.disabled).toBe(true);
    expect(restore.label).toMatch(/unavailable/);
    expect(worktreeCleanupNote(unavailable)).toMatch(/Restore points are unavailable: File storage is S3/);
  });

  it("says when the environment variables decide, and a dry run", () => {
    expect(worktreeCleanupNote(status())).toMatch(/environment variables decide\. Choosing/);
    expect(worktreeCleanupNote(status({ mode: "strict", dryRun: true }))).toMatch(/dry run/);
    expect(worktreeCleanupNote(status({ saved: "off", mode: "off", source: "setting" }))).toBeNull();
  });

  it("puts what each level does behind the info icon", () => {
    const info = worktreeCleanupInfo(status({ retentionDays: 30 }));
    expect(info).toMatch(/Off: nothing/);
    expect(info).toMatch(/Merged work only: archives/);
    expect(info).toMatch(/Merged or pushed: also removes/);
    expect(info).toMatch(/kept 30 days/);
    expect(WORKTREE_CLEANUP_VALUE_INFO.waitDays).toMatch(/Default 1 day\./);
    expect(WORKTREE_CLEANUP_VALUE_INFO.restorePointIdleDays).toMatch(/0 never/);
  });

  it("shows the values only when not off, and the restore point days only at that level", () => {
    expect(worktreeCleanupValuesShown("off")).toEqual({ general: false, restorePoints: false });
    expect(worktreeCleanupValuesShown(undefined)).toEqual({ general: false, restorePoints: false });
    expect(worktreeCleanupValuesShown("merged")).toEqual({ general: true, restorePoints: false });
    expect(worktreeCleanupValuesShown("restore_points")).toEqual({ general: true, restorePoints: true });
  });

  it("reads day counts from 0 to 365", () => {
    expect(parseCleanupDays(" 3 ")).toBe(3);
    expect(parseCleanupDays("0")).toBe(0);
    expect(parseCleanupDays("365")).toBe(365);
    for (const bad of ["", "-1", "1.5", "366", "abc"]) expect(parseCleanupDays(bad)).toBeNull();
  });

  it("saves the level, and a value with the level in force while the environment still decides", () => {
    expect(worktreeCleanupPatch(status(), { mode: "off" })).toEqual({ worktreeCleanup: "off" });
    expect(worktreeCleanupPatch(status(), { waitDays: 2 })).toEqual({ worktreeCleanup: "merged", worktreeCleanupWaitDays: 2 });
    expect(worktreeCleanupPatch(status({ saved: "strict", mode: "strict", source: "setting" }), { removeBuildOutput: false }))
      .toEqual({ worktreeCleanupRemoveBuildOutput: false });
    expect(worktreeCleanupPatch(status({ saved: "restore_points", mode: "restore_points", source: "setting" }), { restorePointAfterDays: 5, restorePointIdleDays: 0 }))
      .toEqual({ worktreeRestorePointAfterDays: 5, worktreeRestorePointIdleDays: 0 });
  });
});
