import type { AgentPermissions } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { AdapterInfo, BuiltInManagedResourceState } from "@/api/agents";
import { bindingText, buildRuntimePatch, configDifferences, configValueText, creatorLabel, releaseLabel, runtimeDraft, skillPin } from "./agent-model";
import { budgetCents, provisionHarnesses, resourceState } from "./built-in-model";
import { extrasConfig, extrasDraft, fieldVisible, harnessChangeChoices, harnessChangePatch, harnessFields } from "./harness-model";
import { bundleDraft, bundleProblem, bundleUpdate } from "./instructions-model";
import { boundaryEditable, boundaryHasScope, boundaryTarget, lowTrustBoundary, trustPreset, trustUpdate, withBoundaryTarget, withoutBoundaryTarget, withPreset } from "./trust-model";

/* The pure parts of the M7 agent settings: trust, harness settings and changes, revisions, skills, the bundle and built-ins. */

const switches = { canCreateAgents: true, canCreateSkills: true, canAssignTasks: true };

describe("trust presets", () => {
  it("reads standard unless the preset says low trust", () => {
    expect(trustPreset(undefined)).toBe("standard");
    expect(trustPreset({ canCreateAgents: true, trustPreset: "low_trust_review" })).toBe("low_trust_review");
  });

  it("going to low trust drops hiring and adds the review policy", () => {
    const next = withPreset({ canCreateAgents: true, authorizationPolicy: { protectedAgent: { enabled: true } } as never }, "low_trust_review");
    expect(next.canCreateAgents).toBe(false);
    expect(next.authorizationPolicy).toMatchObject({
      trustPreset: "low_trust_review",
      reviewPreset: { id: "low_trust_review", version: 1, rawOutputDisposition: "quarantine" },
      protectedAgent: { enabled: true },
    });
    expect(trustUpdate(switches, next)).toMatchObject({ canCreateAgents: false, canAssignTasks: true, trustPreset: "low_trust_review" });
  });

  it("going back to standard sends a policy without the trust keys", () => {
    const low = withBoundaryTarget({ canCreateAgents: false }, "co", { type: "project", id: "p1" });
    const next = withPreset(low, "standard");
    expect(next.trustPreset).toBe("standard");
    expect(next.authorizationPolicy).toEqual({});
  });

  it("sets, reads and clears one boundary target", () => {
    const withProject = withBoundaryTarget({ canCreateAgents: false }, "co", { type: "project", id: "p1" });
    const boundary = lowTrustBoundary(withProject);
    expect(boundary).toMatchObject({ mode: "low_trust_review", companyId: "co", projectIds: ["p1"] });
    expect(boundaryTarget(boundary)).toEqual({ type: "project", id: "p1" });
    expect(boundaryHasScope(boundary)).toBe(true);
    const withTask = withBoundaryTarget(withProject, "co", { type: "root_issue", id: "i1" });
    expect(lowTrustBoundary(withTask)).toMatchObject({ rootIssueId: "i1" });
    expect(lowTrustBoundary(withTask)?.projectIds).toBeUndefined();
    const cleared = withoutBoundaryTarget(withTask);
    expect(boundaryHasScope(lowTrustBoundary(cleared))).toBe(false);
  });

  it("leaves boundaries with several targets alone", () => {
    const permissions: Partial<AgentPermissions> = {
      trustPreset: "low_trust_review",
      authorizationPolicy: { trustBoundary: { mode: "low_trust_review", projectIds: ["a", "b"] } },
    };
    expect(boundaryEditable(lowTrustBoundary(permissions))).toBe(false);
    expect(boundaryTarget(lowTrustBoundary(permissions))).toBeNull();
  });
});

describe("harness settings", () => {
  const schema = {
    fields: [
      { key: "engine", label: "Execution engine", type: "select" as const, default: "auto", options: [{ value: "auto", label: "Default" }, { value: "acp", label: "ACP" }] },
      { key: "stateDir", label: "State directory", type: "text" as const, meta: { visibleWhen: { key: "engine", values: ["acp"] } } },
      { key: "model", label: "Model", type: "text" as const },
      { key: "acpxPermissionMode", label: "Permissions", type: "select" as const, options: [{ value: "approve-all", label: "All" }] },
    ],
  };

  it("takes the schema's fields and the hand-written ones, without what the section edits elsewhere", () => {
    expect(harnessFields("claude_local", schema).map((field) => field.key)).toEqual(["engine", "stateDir", "dangerouslySkipPermissions", "maxTurnsPerRun"]);
    expect(harnessFields("http", null).map((field) => field.key)).toEqual(["url"]);
    expect(harnessFields("process", null)).toEqual([]);
  });

  it("shows a field only when its condition holds", () => {
    const fields = harnessFields("claude_local", schema);
    const draft = extrasDraft(fields, { engine: "auto" });
    expect(fieldVisible(fields[1]!, draft)).toBe(false);
    expect(fieldVisible(fields[1]!, { ...draft, engine: "acp" })).toBe(true);
    const cursorOnly = { key: "acpxSessionMode", label: "Cursor mode", type: "select" as const, meta: { visibleWhen: { key: "acpxAgent", value: "cursor" } } };
    expect(fieldVisible(cursorOnly, {}, { provider: "codex" })).toBe(false);
    expect(fieldVisible(cursorOnly, {}, { provider: "acpx", acpxAgent: "cursor" })).toBe(true);
  });

  it("reads defaults and turns edits back into config", () => {
    const fields = harnessFields("openclaw_gateway", null);
    const config = { url: "wss://gw", scopes: ["operator.admin"], waitTimeoutMs: 5000 };
    const base = extrasDraft(fields, config);
    expect(base).toMatchObject({ url: "wss://gw", scopes: "operator.admin", sessionKeyStrategy: "issue", autoPairOnFirstConnect: true, waitTimeoutMs: "5000" });
    const result = extrasConfig(fields, base, { ...base, scopes: "operator.admin, operator.read", waitTimeoutMs: "", disableDeviceAuth: true }, config);
    expect(result).toEqual({ entries: { scopes: ["operator.admin", "operator.read"], waitTimeoutMs: undefined, disableDeviceAuth: true } });
    expect(extrasConfig(fields, base, { ...base, url: " " }, config)).toEqual({ problem: "Gateway URL can't be empty." });
    expect(extrasConfig(fields, base, { ...base, waitTimeoutMs: "soon" }, config)).toEqual({ problem: "Wait timeout (ms) must be a number." });
  });

  it("keeps an object field an object", () => {
    const fields = [{ key: "headers", label: "Headers", type: "textarea" as const }];
    const config = { headers: { "x-a": "1" } };
    const base = extrasDraft(fields, config);
    expect(extrasConfig(fields, base, { headers: '{"x-a":"2"}' }, config)).toEqual({ entries: { headers: { "x-a": "2" } } });
    expect(extrasConfig(fields, base, { headers: "[1]" }, config)).toEqual({ problem: "Headers must be a JSON object." });
  });

  it("sends secrets only when retyped", () => {
    const fields = [{ key: "apiKey", label: "API key", type: "text" as const, meta: { secret: true } }];
    const base = extrasDraft(fields, { apiKey: "***REDACTED***" });
    expect(base.apiKey).toBe("");
    expect(extrasConfig(fields, base, base, {})).toEqual({ entries: {} });
  });

  it("merges harness settings into the runtime patch", () => {
    const agent = { adapterType: "claude_local", adapterConfig: { model: "m", engine: "auto" }, runtimeConfig: {}, defaultEnvironmentId: null };
    const draft = runtimeDraft(agent);
    expect(buildRuntimePatch(agent, draft, draft, { engine: "acp" })).toEqual({ adapterConfig: { model: "m", engine: "acp" }, replaceAdapterConfig: true });
    expect(buildRuntimePatch(agent, draft, draft, {})).toBeNull();
  });
});

describe("the AI connection in the runtime draft", () => {
  const binding = { provider: "anthropic" as const, method: "api_key" as const, mode: "shared" as const, connectionId: "c1", grantId: "g1" };

  it("compares bindings whatever their key order", () => {
    expect(bindingText({ grantId: "g1", mode: "shared", provider: "anthropic", method: "api_key", connectionId: "c1" })).toBe(bindingText(binding));
    expect(bindingText(undefined)).toBe("");
  });

  it("sets and removes the connection in the whole runtime config", () => {
    const agent = { adapterType: "claude_local", adapterConfig: {}, runtimeConfig: { heartbeat: { enabled: false } }, defaultEnvironmentId: null };
    const base = runtimeDraft(agent);
    expect(buildRuntimePatch(agent, { ...base, connection: bindingText(binding) }, base)).toEqual({
      runtimeConfig: { heartbeat: { enabled: false }, aiConnection: binding },
    });
    const bound = { ...agent, runtimeConfig: { ...agent.runtimeConfig, aiConnection: binding } };
    const boundBase = runtimeDraft(bound);
    expect(buildRuntimePatch(bound, { ...boundBase, connection: "" }, boundBase)).toEqual({ runtimeConfig: { heartbeat: { enabled: false } } });
  });
});

describe("changing the harness", () => {
  const adapters = [
    { type: "claude_local", disabled: false },
    { type: "codex_local", disabled: false },
    { type: "gemini_local", disabled: true },
    { type: "paperclip_runner", disabled: false },
    { type: "process", disabled: false, loaded: false },
  ] as AdapterInfo[];

  it("offers the other harnesses that are on", () => {
    expect(harnessChangeChoices(adapters, "claude_local").map((choice) => choice.type)).toEqual(["codex_local"]);
  });

  it("keeps the harness-agnostic settings and the connection only for the same provider", () => {
    const agent = {
      adapterConfig: { model: "opus", engine: "acp", env: { A: { type: "plain", value: "1" } }, timeoutSec: 60, instructionsFilePath: "/x/AGENTS.md" },
      runtimeConfig: { heartbeat: { enabled: true }, aiConnection: { provider: "anthropic" as const, method: "api_key" as const, mode: "responsible_user" as const } },
    };
    expect(harnessChangePatch(agent, "codex_local", "gpt-5", false)).toEqual({
      adapterType: "codex_local",
      adapterConfig: { env: { A: { type: "plain", value: "1" } }, instructionsFilePath: "/x/AGENTS.md", timeoutSec: 60, model: "gpt-5" },
      replaceAdapterConfig: true,
      runner: "auto",
      runtimeConfig: { heartbeat: { enabled: true } },
    });
    expect(harnessChangePatch(agent, "process", "", true)).toEqual({
      adapterType: "process",
      adapterConfig: { env: { A: { type: "plain", value: "1" } }, instructionsFilePath: "/x/AGENTS.md", timeoutSec: 60 },
      replaceAdapterConfig: true,
    });
  });
});

describe("revisions, skills and origin", () => {
  it("lists the settings two revisions differ in", () => {
    const before = { name: "Bob", adapterConfig: { model: "a", env: { X: { type: "plain", value: "1" } } }, runtimeConfig: {} };
    const after = { name: "Bob", adapterConfig: { model: "b", env: { X: { type: "plain", value: "1" } }, search: true }, runtimeConfig: { heartbeat: { enabled: true } } };
    expect(configDifferences(before, after)).toEqual([
      { path: "adapterConfig.model", before: "a", after: "b" },
      { path: "adapterConfig.search", before: undefined, after: true },
      { path: "runtimeConfig", before: {}, after: undefined },
      { path: "runtimeConfig.heartbeat.enabled", before: undefined, after: true },
    ]);
    expect(configValueText(undefined)).toBe("Not set");
    expect(configValueText(["a"])).toBe('["a"]');
  });

  it("pins a skill release and unpins it", () => {
    const desired = [{ key: "other", versionId: null }];
    expect(skillPin(desired, "core", "v7")).toEqual([{ key: "other", versionId: null }, { key: "core", versionId: "v7" }]);
    expect(skillPin([...desired, { key: "core", versionId: "v7" }], "core", null)).toEqual([
      { key: "other", versionId: null },
      { key: "core", versionId: null },
    ]);
    expect(skillPin(desired, "core", null)).toEqual(desired);
    expect(releaseLabel({ releaseName: "V7 — Roster champion", label: null, releaseId: "v7", releasedAt: "2026-07-21" })).toBe("V7, Roster champion · released 2026-07-21");
  });

  it("names who created the agent", () => {
    const users = [{ principalId: "u1", user: { name: "Ana", email: "ana@x" } }];
    expect(creatorLabel({ createdByUserId: "local-board" }, users)).toBe("the board");
    expect(creatorLabel({ createdByUserId: "u1" }, users)).toBe("Ana");
    expect(creatorLabel({ createdByUserId: "u2" }, users)).toBe("a former member");
    expect(creatorLabel({ createdByUserId: null }, users)).toBeNull();
  });
});

describe("bundle settings", () => {
  const managed = { mode: "managed" as const, rootPath: null, managedRootPath: "/p/agents/a/instructions", entryFile: "AGENTS.md" };

  it("saves only a change", () => {
    const saved = bundleDraft(managed);
    expect(bundleUpdate(saved, saved)).toBeNull();
    expect(bundleUpdate(saved, { ...saved, entryFile: "README.md" })).toEqual({ mode: "managed", rootPath: null, entryFile: "README.md" });
    expect(bundleUpdate(saved, { mode: "external", rootPath: "/srv/prompts", entryFile: "AGENTS.md" })).toEqual({ mode: "external", rootPath: "/srv/prompts", entryFile: "AGENTS.md" });
  });

  it("checks the folder and the entry file", () => {
    expect(bundleProblem({ mode: "external", rootPath: "prompts", entryFile: "AGENTS.md" })).toMatch(/absolute path/);
    expect(bundleProblem({ mode: "managed", rootPath: "", entryFile: "../x.md" })).toMatch(/inside the folder/);
    expect(bundleProblem({ mode: "external", rootPath: "/srv/p", entryFile: "AGENTS.md" })).toBeNull();
  });
});

describe("built-in agents", () => {
  const resource = (patch: Partial<BuiltInManagedResourceState>): BuiltInManagedResourceState => ({
    resourceKind: "skill",
    resourceKey: "k",
    resourceId: "r",
    stockVersion: "v2",
    stockStatus: "stock_current",
    updateAvailable: false,
    resetAvailable: false,
    ...patch,
  });

  it("says what each managed resource offers", () => {
    expect(resourceState(resource({})).action).toBeNull();
    expect(resourceState(resource({ stockStatus: "stock_update_available", updateAvailable: true })).action).toBe("update");
    expect(resourceState(resource({ stockStatus: "operator_modified", resetAvailable: true, changedFiles: ["SKILL.md"] }))).toMatchObject({ text: "Edited: SKILL.md", action: "reset" });
    expect(resourceState(resource({ stockStatus: "missing" })).action).toBe("reset");
  });

  it("offers the allowed harnesses and reads the budget", () => {
    expect(provisionHarnesses({ definition: { allowedAdapterTypes: ["codex_local"] } as never }, ["claude_local", "codex_local"])).toEqual(["codex_local"]);
    expect(provisionHarnesses({ definition: {} as never }, ["claude_local"])).toEqual(["claude_local"]);
    expect(budgetCents("")).toBeUndefined();
    expect(budgetCents("$25.5")).toBe(2550);
    expect(budgetCents("lots")).toBeNull();
  });
});
