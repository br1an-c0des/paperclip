import type { McpJsonImportDraft, ToolCatalogEntry, ToolConnection, ToolPolicy, ToolProfileEntry, ToolProfileWithDetails } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { agentAppRows, agentPolicies, assignableProfiles, gitHubIdentities, policyGovernsAgent, unavailableTools } from "./agent-tools-model";
import { credentialValues, draftSummary, draftUrl, humanizeKey, missingKeys, pasteProblem } from "./paste-model";
import {
  allowRows,
  allowsLabel,
  appSelectionLabel,
  assignedLabel,
  assignmentChanges,
  assignmentDraft,
  buildEntries,
  countAllowed,
  groupCatalogByApp,
  newToolsAppLabel,
  parseEntries,
  profileKeyFrom,
  readWizardMeta,
  resumeStep,
  templateSelections,
  toggleApp,
  toggleTool,
  withWizardMeta,
  type AppGroup,
} from "./profile-model";
import { moreAppsTab, moreAppsView } from "./routes-model";

const tool = (id: string, extra: Partial<ToolCatalogEntry> = {}) =>
  ({
    id,
    toolName: id,
    title: null,
    applicationId: "app-1",
    connectionId: "conn-1",
    isWrite: false,
    isDestructive: false,
    isReadOnly: true,
    riskLevel: "read",
    status: "active",
    addedAt: null,
    firstSeenAt: null,
    ...extra,
  }) as unknown as ToolCatalogEntry;

const group = (tools: ToolCatalogEntry[], extra: Partial<AppGroup> = {}): AppGroup => ({
  appKey: "app-1",
  applicationId: "app-1",
  connectionId: "conn-1",
  name: "Gmail",
  tools,
  ...extra,
});

const entry = (extra: Partial<ToolProfileEntry>) => ({ id: `e-${Math.random()}`, effect: "include", ...extra }) as ToolProfileEntry;

describe("moreAppsView", () => {
  it("keeps the old UI's addresses", () => {
    expect(moreAppsView("assistant-connection")).toEqual({ section: "assistant" });
    expect(moreAppsView("gateways")).toEqual({ section: "gateways" });
    expect(moreAppsView("gateways/g1/tokens")).toEqual({ section: "gateway", gatewayId: "g1", tab: "tokens" });
    expect(moreAppsView("advanced")).toEqual({ section: "advanced", tab: "paste-config" });
    expect(moreAppsView("advanced/profiles")).toEqual({ section: "advanced", tab: "profiles" });
    expect(moreAppsView("advanced/profiles/new")).toEqual({ section: "profile-new" });
    expect(moreAppsView("advanced/profiles/p1")).toEqual({ section: "profile", profileId: "p1" });
    expect(moreAppsView("advanced/profiles/p1/edit")).toEqual({ section: "profile-edit", profileId: "p1" });
  });

  it("redirects the rest as the old UI does", () => {
    expect(moreAppsView("gateways/g1")).toEqual({ section: "redirect", to: "gateways/g1/overview" });
    expect(moreAppsView("gateways/g1/nope")).toEqual({ section: "redirect", to: "gateways/g1/overview" });
    expect(moreAppsView("advanced/gateways")).toEqual({ section: "redirect", to: "gateways" });
    expect(moreAppsView("advanced/smoke-lab")).toEqual({ section: "redirect", to: "advanced/profiles" });
    expect(moreAppsView("advanced/policies")).toEqual({ section: "redirect", to: "advanced/profiles" });
    expect(moreAppsView("advanced/audit")).toEqual({ section: "redirect", to: "" });
    expect(moreAppsView("advanced/run-your-own")).toEqual({ section: "redirect", to: "" });
  });

  it("leaves the other Apps pages alone", () => {
    expect(moreAppsView("")).toBeNull();
    expect(moreAppsView("review")).toBeNull();
    expect(moreAppsView("abc/permissions")).toBeNull();
  });

  it("names the tab a page sits under", () => {
    expect(moreAppsTab({ section: "profile", profileId: "p" })).toBe("advanced");
    expect(moreAppsTab({ section: "gateway", gatewayId: "g", tab: "overview" })).toBe("gateways");
    expect(moreAppsTab({ section: "assistant" })).toBe("assistant");
  });
});

describe("profile selections", () => {
  const tools = [tool("a"), tool("b", { isWrite: true, isReadOnly: false }), tool("c", { isDestructive: true, isReadOnly: false })];
  const gmail = group(tools);

  it("toggles an app and its tools", () => {
    expect(toggleApp(gmail, undefined)).toEqual({ kind: "all" });
    expect(toggleApp(gmail, { kind: "all" })).toEqual({ kind: "none" });
    expect(toggleTool(gmail, { kind: "all" }, "b")).toEqual({ kind: "all_except", excluded: ["b"] });
    expect(toggleTool(gmail, { kind: "all_except", excluded: ["b"] }, "b")).toEqual({ kind: "all" });
    expect(toggleTool(gmail, { kind: "none" }, "a")).toEqual({ kind: "some", included: ["a"] });
    expect(toggleTool(gmail, { kind: "some", included: ["a"] }, "a")).toEqual({ kind: "none" });
  });

  it("labels a selection", () => {
    expect(appSelectionLabel(gmail, { kind: "all" })).toBe("All Gmail tools (3)");
    expect(appSelectionLabel(gmail, { kind: "all_except", excluded: ["a"] })).toBe("All Gmail except 1");
    expect(appSelectionLabel(gmail, { kind: "some", included: ["a"] })).toBe("1 of 3 Gmail tools");
    expect(appSelectionLabel(gmail, { kind: "none" })).toBe("None selected");
  });

  it("applies templates by capability", () => {
    expect(templateSelections("read_only", [gmail])).toEqual({ "app-1": { kind: "some", included: ["a"] } });
    expect(templateSelections("everyday", [gmail])).toEqual({ "app-1": { kind: "some", included: ["a", "b"] } });
    expect(templateSelections("full_access", [gmail])).toEqual({ "app-1": { kind: "all" } });
    expect(templateSelections("scratch", [gmail])).toEqual({ "app-1": { kind: "none" } });
  });

  it("round-trips selections through entries", () => {
    const entries = buildEntries([gmail], { "app-1": { kind: "all_except", excluded: ["c"] } }, [
      { id: "r", kind: "tool_name", value: "search_*", effect: "include" },
    ]);
    expect(entries).toEqual([
      { selectorType: "application", effect: "include", applicationId: "app-1" },
      { selectorType: "catalog_entry", effect: "exclude", catalogEntryId: "c" },
      { selectorType: "tool_name", effect: "include", toolName: "search_*" },
    ]);
    const parsed = parseEntries([gmail], entries.map((input, index) => entry({ ...input, id: `e${index}` } as Partial<ToolProfileEntry>)));
    expect(parsed.selections).toEqual({ "app-1": { kind: "all_except", excluded: ["c"] } });
    expect(parsed.rules).toEqual([{ id: "e2", kind: "tool_name", value: "search_*", effect: "include" }]);
  });

  it("stores only opt-outs when new tools are allowed", () => {
    expect(buildEntries([gmail], { "app-1": { kind: "some", included: ["a", "b"] } }, [], "allow")).toEqual([
      { selectorType: "catalog_entry", effect: "exclude", catalogEntryId: "c" },
    ]);
    expect(countAllowed([gmail], { "app-1": { kind: "some", included: ["a", "b"] } }, "allow", 10)).toEqual({ allowed: 9, total: 10 });
    expect(countAllowed([gmail], { "app-1": { kind: "some", included: ["a", "b"] } }, "deny", 10)).toEqual({ allowed: 2, total: 10 });
  });

  it("uses a connection include for apps without an application", () => {
    const own = group([tool("x", { applicationId: null })], { appKey: "conn-9", applicationId: null, connectionId: "conn-9" });
    expect(buildEntries([own], { "conn-9": { kind: "all" } })).toEqual([{ selectorType: "connection", effect: "include", connectionId: "conn-9" }]);
  });

  it("groups the catalog by app", () => {
    const groups = groupCatalogByApp(
      [tool("b"), tool("a"), tool("z", { applicationId: null, connectionId: "conn-2" })],
      new Map([["app-1", "Gmail"]]),
      new Map([["conn-2", "My server"]]),
    );
    expect(groups.map((entry) => [entry.name, entry.tools.map((t) => t.id)])).toEqual([
      ["Gmail", ["a", "b"]],
      ["My server", ["z"]],
    ]);
  });
});

describe("profile labels and wizard progress", () => {
  const summary = {
    accessMode: "selected" as const,
    allowedToolCount: 9,
    allowedApplicationCount: 3,
    excludedToolCount: 0,
    totalToolCount: 20,
    assignmentCount: 0,
    appliesToAgentCount: 0,
    isCompanyDefault: false,
  };

  it("summarises what a profile allows and who has it", () => {
    expect(allowsLabel(summary)).toBe("9 tools · 3 apps");
    expect(allowsLabel({ ...summary, accessMode: "all_except", excludedToolCount: 2 })).toBe("All except 2 tools");
    expect(allowsLabel({ ...summary, accessMode: "all_except" })).toBe("All tools");
    expect(assignedLabel(summary)).toEqual({ text: "Not assigned yet", unassigned: true });
    expect(assignedLabel({ ...summary, appliesToAgentCount: 1, assignmentCount: 1 })).toEqual({ text: "1 agent", unassigned: false });
    expect(assignedLabel({ ...summary, isCompanyDefault: true })).toEqual({ text: "Organization default", unassigned: false });
  });

  it("keeps the wizard's step in the metadata", () => {
    const metadata = withWizardMeta({ other: 1 }, { lastCompletedStep: 1, template: "everyday" });
    expect(metadata).toEqual({ other: 1, wizard: { lastCompletedStep: 1, template: "everyday" } });
    const meta = readWizardMeta({ metadata });
    expect(meta).toEqual({ lastCompletedStep: 1, template: "everyday" });
    expect(resumeStep(meta)).toBe(2);
    expect(resumeStep({ lastCompletedStep: 3, template: null })).toBe(3);
    expect(readWizardMeta({ metadata: { wizard: { lastCompletedStep: 9 } } })).toBeNull();
  });

  it("derives an identifier from the name", () => {
    expect(profileKeyFrom("  Everyday Work! ")).toBe("everyday-work");
  });

  it("names the apps that added new tools", () => {
    expect(newToolsAppLabel([{ applicationName: "Gmail", connectionName: null }])).toBe("Gmail");
    expect(newToolsAppLabel([{ applicationName: "Gmail", connectionName: null }, { applicationName: null, connectionName: "Slack" }])).toBe("Gmail and Slack");
    expect(newToolsAppLabel([])).toBe("An app");
  });
});

describe("allowRows", () => {
  it("lists the allowed tools and why", () => {
    const profile = {
      summary: { accessMode: "selected" },
      defaultAction: "deny",
      entries: [entry({ selectorType: "application", applicationId: "app-1" }), entry({ selectorType: "catalog_entry", catalogEntryId: "b", effect: "exclude" })],
    } as unknown as ToolProfileWithDetails;
    const rows = allowRows(profile, [tool("a"), tool("b"), tool("c", { applicationId: "app-2", connectionId: "conn-2" })], new Map([["app-1", "Gmail"]]), [
      { id: "conn-1", name: "Gmail", status: "active", healthStatus: "ok" } as ToolConnection,
    ]);
    expect(rows.map((row) => [row.id, row.app, row.source, row.degraded])).toEqual([["a", "Gmail", "All Gmail", false]]);
  });
});

describe("assignmentChanges", () => {
  it("binds and unbinds only what the wizard manages", () => {
    const bindings = [
      { targetType: "agent" as const, targetId: "a1" },
      { targetType: "agent" as const, targetId: "a2" },
      { targetType: "issue" as const, targetId: "i1" },
    ];
    const draft = assignmentDraft(bindings);
    draft.agentIds.delete("a2");
    draft.agentIds.add("a3");
    draft.companyDefault = true;
    expect(assignmentChanges("co", bindings, draft)).toEqual({
      bind: [
        { targetType: "company", targetId: "co" },
        { targetType: "agent", targetId: "a3" },
      ],
      unbind: [{ targetType: "agent", targetId: "a2" }],
    });
  });
});

describe("paste a config", () => {
  const draft = {
    name: "docs",
    transport: "mcp_remote",
    status: "draft",
    config: { url: "https://mcp.example.com/mcp" },
    credentialRefs: [],
    credentialFields: [{ configPath: "headers.Authorization", label: "API_TOKEN", placement: "header", key: "Authorization", prefix: "Bearer ", required: true }],
    warnings: [],
  } as unknown as McpJsonImportDraft;

  it("checks the JSON before sending it", () => {
    expect(pasteProblem("")).toBeNull();
    expect(pasteProblem("{}")).toBeNull();
    expect(pasteProblem("{ nope")).toMatch(/valid JSON/);
  });

  it("describes a draft and its keys", () => {
    expect(humanizeKey("GITHUB_TOKEN")).toBe("Github token");
    expect(draftSummary(draft)).toBe("Connects over the web · needs 1 key");
    expect(draftUrl(draft)).toBe("https://mcp.example.com/mcp");
    expect(draftUrl({ ...draft, transport: "local_stdio" } as McpJsonImportDraft)).toBeNull();
    expect(missingKeys(draft, {})).toEqual(["headers.Authorization"]);
    expect(credentialValues(draft, { "docs::headers.Authorization": " secret " })).toEqual({ "headers.Authorization": "secret" });
  });
});

describe("agent tools", () => {
  const connection = (id: string, extra: Partial<ToolConnection> = {}) =>
    ({ id, name: id, status: "active", enabled: true, healthStatus: "ok", connectionPurpose: "tool", transport: "mcp_remote", installs: [], ...extra }) as unknown as ToolConnection;

  it("lists tool connections with their install state, installed first", () => {
    const rows = agentAppRows(
      [
        connection("b-server"),
        connection("a-server", { installs: [{ targetType: "agent", targetId: "agent-1" }] as ToolConnection["installs"] }),
        connection("ai", { connectionPurpose: "ai" }),
        connection("gone", { status: "archived" }),
        connection("all", { installs: [{ targetType: "company", targetId: "co" }] as ToolConnection["installs"] }),
      ],
      { entries: [], allowedTools: [tool("t", { connectionId: "b-server" })] } as never,
      "agent-1",
    );
    expect(rows.map((row) => [row.connection.id, row.installed, row.installedForAll, row.permitted])).toEqual([
      ["a-server", true, false, false],
      ["all", true, true, false],
      ["b-server", false, false, true],
    ]);
  });

  it("reads which policies apply to an agent", () => {
    const policy = (selectors: Record<string, unknown>, extra: Partial<ToolPolicy> = {}) =>
      ({ id: "p", name: "p", enabled: true, policyType: "require_approval", selectors, config: { connectionId: "c1" }, ...extra }) as unknown as ToolPolicy;
    expect(policyGovernsAgent(policy({}), "a")).toBe(true);
    expect(policyGovernsAgent(policy({ agentIds: ["b"] }), "a")).toBe(false);
    expect(policyGovernsAgent(policy({ agentId: "a" }), "a")).toBe(true);
    expect(policyGovernsAgent(policy({ actorType: "user" }), "a")).toBe(false);
    const rows = agentPolicies([policy({}), policy({}, { enabled: false }), policy({ agentId: "b" })], "a");
    expect(rows.map((row) => [row.order, row.effect, row.connectionId])).toEqual([[1, "Ask first", "c1"]]);
  });

  it("finds the tools it would be blocked from", () => {
    expect(unavailableTools([tool("b"), tool("a"), tool("a"), tool("q", { status: "quarantined" })], [tool("b")]).map((t) => t.id)).toEqual(["a"]);
  });

  it("offers the active profiles it doesn't have yet", () => {
    const profile = (id: string, extra: Partial<ToolProfileWithDetails> = {}) => ({ id, name: id, status: "active", profileKey: id, bindings: [], ...extra }) as unknown as ToolProfileWithDetails;
    const list = [profile("b"), profile("a"), profile("app", { profileKey: "app:c1" }), profile("d", { status: "draft" }), profile("have")];
    expect(assignableProfiles(list, [profile("have")]).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("picks its GitHub identities", () => {
    const github = connection("gh");
    const grant = (extra: Record<string, unknown>) => ({ status: "active", kind: "user", subjectUserId: null, ...extra }) as never;
    const found = gitHubIdentities(
      [{ connection: github, currentUserId: "u1", grants: [grant({ subjectUserId: "u1" }), grant({ kind: "agent", subjectAgentId: "agent-1" })] }],
      "agent-1",
    );
    expect(found.dedicated?.connection.id).toBe("gh");
    expect(found.personal?.connection.id).toBe("gh");
    expect(gitHubIdentities([{ connection: github, grants: [grant({ kind: "agent", subjectAgentId: "other" })] }], "agent-1").dedicated).toBeNull();
  });
});
