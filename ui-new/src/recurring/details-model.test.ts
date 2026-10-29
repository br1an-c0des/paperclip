import type { Project, RoutineVariable } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  activityLabel,
  activitySummary,
  cleanOptions,
  mergeActivity,
  parseOptionLines,
  pluginDefaultDrift,
  replaceVariable,
  runWorkspacePayload,
  withOptions,
  withType,
} from "./details-model";

const variable = (extra: Partial<RoutineVariable> = {}): RoutineVariable => ({
  name: "region",
  label: null,
  type: "text",
  defaultValue: null,
  required: true,
  options: [],
  ...extra,
});

describe("Choice options", () => {
  it("trims, drops blanks and repeats, and caps at 50 options of 120 characters", () => {
    expect(cleanOptions([" eu ", "", "us", "eu", "  "])).toEqual(["eu", "us"]);
    expect(cleanOptions(Array.from({ length: 60 }, (_, index) => `o${index}`))).toHaveLength(50);
    expect(cleanOptions(["x".repeat(200)])[0]).toHaveLength(120);
    expect(parseOptionLines("eu\r\nus\n\neu")).toEqual(["eu", "us"]);
  });

  it("makes a Choice only with at least one option", () => {
    expect(withOptions(variable(), ["", " "])).toBeNull();
    expect(withOptions(variable(), ["eu", "us"])).toMatchObject({ type: "select", options: ["eu", "us"], defaultValue: null });
  });

  it("keeps the default only while it's still an option", () => {
    expect(withOptions(variable({ type: "select", options: ["eu", "us"], defaultValue: "us" }), ["us", "apac"])?.defaultValue).toBe("us");
    expect(withOptions(variable({ type: "select", options: ["eu", "us"], defaultValue: "us" }), ["eu"])?.defaultValue).toBeNull();
    expect(withOptions(variable({ defaultValue: "eu" }), ["eu"])?.defaultValue).toBe("eu");
  });

  it("drops the options and default when it stops being a Choice", () => {
    expect(withType(variable({ type: "select", options: ["eu"], defaultValue: "eu" }), "text")).toMatchObject({ type: "text", options: [], defaultValue: null });
  });

  it("replaces one input by name", () => {
    const list = [variable(), variable({ name: "date" })];
    expect(replaceVariable(list, variable({ required: false }))).toEqual([variable({ required: false }), variable({ name: "date" })]);
  });
});

describe("pluginDefaultDrift", () => {
  const routine = {
    title: "Weekly digest",
    description: "Sum up the week",
    priority: "medium",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    activityGatePolicy: "always",
    activityGateScope: "company",
  };

  it("lists the fields that moved from the plugin's defaults", () => {
    expect(pluginDefaultDrift(routine, { ...routine })).toEqual([]);
    expect(pluginDefaultDrift({ ...routine, title: "Digest", priority: "high" }, routine)).toEqual(["title", "priority"]);
  });

  it("ignores fields the defaults leave out, and a null default other than the description", () => {
    expect(pluginDefaultDrift(routine, { title: "Weekly digest" })).toEqual([]);
    expect(pluginDefaultDrift(routine, { title: "Weekly digest", priority: null, description: null })).toEqual(["description"]);
    expect(pluginDefaultDrift(routine, null)).toEqual([]);
  });
});

describe("activity", () => {
  it("labels known and unknown actions", () => {
    expect(activityLabel("routine.trigger_secret_rotated")).toBe("Replaced the webhook secret");
    expect(activityLabel("routine.folder_moved")).toBe("Folder moved");
  });

  it("summarizes runs, change summaries and other details", () => {
    expect(activitySummary({ action: "routine.run_triggered", details: { source: "schedule", status: "issue_created" } })).toBe("Schedule · made a task");
    expect(activitySummary({ action: "routine.run_triggered", details: { source: "manual", status: "coalesced" } })).toBe("Run now · coalesced");
    expect(activitySummary({ action: "routine.updated", details: { changeSummary: "Renamed it" } })).toBe("Renamed it");
    expect(activitySummary({ action: "routine.updated", details: { routineId: "r1", title: "New", nested: { a: 1 } } })).toBe("title: New");
    expect(activitySummary({ action: "routine.webhook_rejected", details: null })).toBe("Check the secret in the sending app");
    expect(activitySummary({ action: "routine.created", details: null })).toBe("");
  });

  it("merges lists without repeats, newest first", () => {
    const merged = mergeActivity([
      [{ id: "a", createdAt: new Date("2026-10-01") }],
      [
        { id: "b", createdAt: new Date("2026-10-03") },
        { id: "a", createdAt: new Date("2026-10-01") },
      ],
    ]);
    expect(merged.map((event) => event.id)).toEqual(["b", "a"]);
  });
});

describe("runWorkspacePayload", () => {
  const project = {
    id: "p1",
    executionWorkspacePolicy: { enabled: true, defaultMode: "shared_workspace", defaultProjectWorkspaceId: "pw1" },
    workspaces: [{ id: "pw0", isPrimary: true }],
  } as unknown as Project;

  it("sends nothing without a project, or when neither choice shows", () => {
    expect(runWorkspacePayload(null, { workspace: "isolated_workspace", reused: null, environmentId: "e1" }, { workspaces: true })).toEqual({});
    expect(runWorkspacePayload(project, { workspace: "isolated_workspace", reused: null, environmentId: null }, { workspaces: false })).toEqual({});
  });

  it("sends the mode and the project's workspace", () => {
    expect(runWorkspacePayload(project, { workspace: "isolated_workspace", reused: null, environmentId: null }, { workspaces: true })).toEqual({
      executionWorkspacePreference: "isolated_workspace",
      executionWorkspaceSettings: { mode: "isolated_workspace" },
      projectWorkspaceId: "pw1",
    });
  });

  it("reuses another task's worktree", () => {
    const reused = { id: "ew1", name: "feat/x", mode: "isolated_workspace", projectWorkspaceId: "pw9" };
    expect(runWorkspacePayload(project, { workspace: "reuse_existing", reused, environmentId: "e1" }, { workspaces: true })).toEqual({
      executionWorkspacePreference: "reuse_existing",
      executionWorkspaceId: "ew1",
      executionWorkspaceSettings: { mode: "isolated_workspace", environmentId: "e1" },
      projectWorkspaceId: "pw9",
    });
  });

  it("sends only the environment when the workspace choice doesn't show", () => {
    expect(runWorkspacePayload(project, { workspace: "shared_workspace", reused: null, environmentId: "e1" }, { workspaces: false })).toEqual({
      executionWorkspaceSettings: { environmentId: "e1" },
    });
  });
});
