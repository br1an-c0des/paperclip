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
  type FeatureContext,
} from "./features-model";

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

  it("keeps out the flags decision 12 drops or builds in, agent chat and maintainer tools", () => {
    for (const key of ["enableStreamlinedUi", "enableDecisions", "enableEnvironments", "enableAgentChat", "enableSmokeLab", "enableConferenceRoomChat", "enablePaperclipDeveloperMode"]) {
      expect(listed).not.toContain(key);
    }
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
