import type {
  ToolCatalogEntry,
  ToolConnection,
  ToolProfileBinding,
  ToolProfileDefaultAction,
  ToolProfileEntry,
  ToolProfileStatus,
  ToolProfileSummary,
  ToolProfileWithDetails,
  ToolRiskLevel,
} from "@paperclipai/shared";
import type { ProfileEntryInput, ProfileTarget } from "@/api/tool-access";

/*
 * View model for access profiles (`/apps/advanced/profiles*`, the old UI's pages/tools/profiles/).
 * A profile decides which tools a run gets. The pages speak per app ("All Gmail tools", "All Gmail
 * except 2", "3 of 12 Gmail tools"); the server stores entries (an application, connection, tool,
 * name pattern or risk level, included or excluded). This module translates between the two, counts
 * what a profile allows, and labels its assignments. After profile-model.ts, profile-summary.ts,
 * wizard-draft.ts and ProfileDetail.tsx.
 */

// ---------------------------------------------------------------------------------------------
// Tools and apps

export type ToolCapability = "read" | "write" | "destructive";

export function toolCapability(tool: Pick<ToolCatalogEntry, "isDestructive" | "isWrite">): ToolCapability {
  if (tool.isDestructive) return "destructive";
  if (tool.isWrite) return "write";
  return "read";
}

export const CAPABILITY_LABEL: Record<ToolCapability, string> = {
  read: "Read-only",
  write: "Makes changes",
  destructive: "Destructive",
};

/** A connected app and the tools its catalog has now. */
export type AppGroup = {
  /** The application id, or the connection's for connections without one. */
  appKey: string;
  applicationId: string | null;
  connectionId: string;
  name: string;
  tools: ToolCatalogEntry[];
};

/** The company's catalog by app, named by the application, else the connection. */
export function groupCatalogByApp(catalog: readonly ToolCatalogEntry[], applicationNames: Map<string, string>, connectionNames: Map<string, string>): AppGroup[] {
  const groups = new Map<string, AppGroup>();
  for (const tool of catalog) {
    const appKey = tool.applicationId ?? tool.connectionId;
    let group = groups.get(appKey);
    if (!group) {
      const name = (tool.applicationId ? applicationNames.get(tool.applicationId) : undefined) ?? connectionNames.get(tool.connectionId) ?? "Tools";
      group = { appKey, applicationId: tool.applicationId, connectionId: tool.connectionId, name, tools: [] };
      groups.set(appKey, group);
    }
    group.tools.push(tool);
  }
  for (const group of groups.values()) group.tools.sort((a, b) => a.toolName.localeCompare(b.toolName));
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------
// One app's selection

export type AppSelection =
  | { kind: "all" }
  | { kind: "all_except"; excluded: string[] }
  | { kind: "some"; included: string[] }
  | { kind: "none" };

export type Selections = Record<string, AppSelection>;

export function selectedToolIds(group: AppGroup, selection: AppSelection | undefined): Set<string> {
  if (!selection || selection.kind === "none") return new Set();
  if (selection.kind === "all") return new Set(group.tools.map((tool) => tool.id));
  if (selection.kind === "all_except") {
    const excluded = new Set(selection.excluded);
    return new Set(group.tools.filter((tool) => !excluded.has(tool.id)).map((tool) => tool.id));
  }
  const included = new Set(selection.included);
  return new Set(group.tools.filter((tool) => included.has(tool.id)).map((tool) => tool.id));
}

export type AppCheckState = "checked" | "indeterminate" | "unchecked";

export function appCheckState(group: AppGroup, selection: AppSelection | undefined): AppCheckState {
  const count = selectedToolIds(group, selection).size;
  if (count === 0) return "unchecked";
  return count === group.tools.length ? "checked" : "indeterminate";
}

/** "All Gmail tools (12)", "All Gmail except 2", "3 of 12 Gmail tools", "None selected". */
export function appSelectionLabel(group: AppGroup, selection: AppSelection | undefined) {
  const state = appCheckState(group, selection);
  if (state === "unchecked") return "None selected";
  if (selection?.kind === "all" || (selection?.kind === "all_except" && selection.excluded.length === 0)) {
    return `All ${group.name} tools (${group.tools.length})`;
  }
  if (selection?.kind === "all_except") return `All ${group.name} except ${selection.excluded.length}`;
  return `${selectedToolIds(group, selection).size} of ${group.tools.length} ${group.name} tools`;
}

/** The app's checkbox: off turns every tool on (and future ones); on turns them all off. */
export function toggleApp(group: AppGroup, selection: AppSelection | undefined): AppSelection {
  return appCheckState(group, selection) === "unchecked" ? { kind: "all" } : { kind: "none" };
}

/** One tool's checkbox. With the app on, unticking excludes; with it off, ticking picks tools one by one. */
export function toggleTool(group: AppGroup, selection: AppSelection | undefined, toolId: string): AppSelection {
  const current = selection ?? { kind: "none" as const };
  const willSelect = !selectedToolIds(group, current).has(toolId);
  if (current.kind === "all" || current.kind === "all_except") {
    const excluded = new Set(current.kind === "all_except" ? current.excluded : []);
    if (willSelect) excluded.delete(toolId);
    else excluded.add(toolId);
    if (excluded.size === 0) return { kind: "all" };
    if (excluded.size >= group.tools.length) return { kind: "none" };
    return { kind: "all_except", excluded: group.tools.filter((tool) => excluded.has(tool.id)).map((tool) => tool.id) };
  }
  const included = new Set(current.kind === "some" ? current.included : []);
  if (willSelect) included.add(toolId);
  else included.delete(toolId);
  if (included.size === 0) return { kind: "none" };
  return { kind: "some", included: group.tools.filter((tool) => included.has(tool.id)).map((tool) => tool.id) };
}

// ---------------------------------------------------------------------------------------------
// Rules beyond apps: a name pattern, a risk level, a tool id

export type RuleKind = "tool_name" | "risk_level" | "catalog_entry";

export type AdvancedRule = {
  id: string;
  kind: RuleKind;
  /** A name pattern (`*` wildcards), a risk level, or a tool id. */
  value: string;
  riskLevel?: ToolRiskLevel;
  effect: "include" | "exclude";
};

export const RULE_KINDS: { value: RuleKind; label: string }[] = [
  { value: "tool_name", label: "Tool name pattern" },
  { value: "risk_level", label: "Risk level" },
  { value: "catalog_entry", label: "Tool ID" },
];

export function ruleSummary(rule: AdvancedRule) {
  const verb = rule.effect === "include" ? "Allow" : "Block";
  if (rule.kind === "tool_name") return `${verb} tools matching ${rule.value}`;
  if (rule.kind === "risk_level") return `${verb} ${rule.riskLevel ?? rule.value} tools`;
  return `${verb} tool ${rule.value}`;
}

// ---------------------------------------------------------------------------------------------
// Selections <-> entries

/**
 * The entries a set of selections and rules stands for. An app that's on becomes an application (or
 * connection) include, its opt-outs tool excludes; picked tools become tool includes. When new tools
 * are allowed automatically, only the opt-outs are stored.
 */
export function buildEntries(groups: readonly AppGroup[], selections: Selections, rules: readonly AdvancedRule[] = [], defaultAction: ToolProfileDefaultAction = "deny") {
  const entries: ProfileEntryInput[] = [];
  for (const group of groups) {
    const selection = selections[group.appKey];
    if (!selection) continue;
    if (defaultAction === "allow") {
      const selected = selectedToolIds(group, selection);
      for (const tool of group.tools) {
        if (!selected.has(tool.id)) entries.push({ selectorType: "catalog_entry", effect: "exclude", catalogEntryId: tool.id });
      }
      continue;
    }
    if (selection.kind === "none") continue;
    if (selection.kind === "all" || selection.kind === "all_except") {
      entries.push(
        group.applicationId
          ? { selectorType: "application", effect: "include", applicationId: group.applicationId }
          : { selectorType: "connection", effect: "include", connectionId: group.connectionId },
      );
      if (selection.kind === "all_except") {
        for (const id of selection.excluded) entries.push({ selectorType: "catalog_entry", effect: "exclude", catalogEntryId: id });
      }
    } else {
      for (const id of selection.included) entries.push({ selectorType: "catalog_entry", effect: "include", catalogEntryId: id });
    }
  }
  for (const rule of rules) {
    if (rule.kind === "tool_name") entries.push({ selectorType: "tool_name", effect: rule.effect, toolName: rule.value });
    else if (rule.kind === "risk_level") entries.push({ selectorType: "risk_level", effect: rule.effect, riskLevel: rule.riskLevel ?? "destructive" });
    else entries.push({ selectorType: "catalog_entry", effect: rule.effect, catalogEntryId: rule.value });
  }
  return entries;
}

/** The selections and rules a stored profile stands for, to edit it or copy it. */
export function parseEntries(groups: readonly AppGroup[], entries: readonly ToolProfileEntry[]): { selections: Selections; rules: AdvancedRule[] } {
  const selections: Selections = {};
  const rules: AdvancedRule[] = [];
  const appOfTool = new Map<string, string>();
  const byApplication = new Map<string, AppGroup>();
  const byConnection = new Map<string, AppGroup>();
  for (const group of groups) {
    for (const tool of group.tools) appOfTool.set(tool.id, group.appKey);
    if (group.applicationId) byApplication.set(group.applicationId, group);
    byConnection.set(group.connectionId, group);
  }
  const appOn = new Set<string>();
  const excludes = new Map<string, Set<string>>();
  const includes = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.effect === "include" && entry.selectorType === "application" && entry.applicationId) {
      const group = byApplication.get(entry.applicationId);
      if (group) appOn.add(group.appKey);
      continue;
    }
    if (entry.effect === "include" && entry.selectorType === "connection" && entry.connectionId) {
      const group = byConnection.get(entry.connectionId);
      if (group && !group.applicationId) appOn.add(group.appKey);
      else rules.push({ id: entry.id, kind: "catalog_entry", value: entry.connectionId, effect: "include" });
      continue;
    }
    if (entry.selectorType === "catalog_entry" && entry.catalogEntryId) {
      const appKey = appOfTool.get(entry.catalogEntryId);
      if (!appKey) {
        rules.push({ id: entry.id, kind: "catalog_entry", value: entry.catalogEntryId, effect: entry.effect });
        continue;
      }
      const bucket = entry.effect === "exclude" ? excludes : includes;
      const set = bucket.get(appKey) ?? new Set<string>();
      set.add(entry.catalogEntryId);
      bucket.set(appKey, set);
      continue;
    }
    if (entry.selectorType === "tool_name" && entry.toolName) {
      rules.push({ id: entry.id, kind: "tool_name", value: entry.toolName, effect: entry.effect });
    } else if (entry.selectorType === "risk_level" && entry.riskLevel) {
      rules.push({ id: entry.id, kind: "risk_level", value: entry.riskLevel, riskLevel: entry.riskLevel, effect: entry.effect });
    }
  }
  for (const group of groups) {
    const known = (ids: Set<string> | undefined) => [...(ids ?? [])].filter((id) => group.tools.some((tool) => tool.id === id));
    const excluded = known(excludes.get(group.appKey));
    const included = known(includes.get(group.appKey));
    if (appOn.has(group.appKey)) selections[group.appKey] = excluded.length > 0 ? { kind: "all_except", excluded } : { kind: "all" };
    else if (included.length > 0) selections[group.appKey] = { kind: "some", included };
    else selections[group.appKey] = { kind: "none" };
  }
  return { selections, rules };
}

/** "Allows 14 of 63 tools", for the wizard's footer. */
export function countAllowed(groups: readonly AppGroup[], selections: Selections, defaultAction: ToolProfileDefaultAction, total: number) {
  if (defaultAction === "allow") {
    let excluded = 0;
    for (const group of groups) {
      const selection = selections[group.appKey];
      if (selection?.kind === "all_except") excluded += selection.excluded.length;
      else if (selection?.kind === "some") excluded += group.tools.length - selection.included.length;
      else if (selection?.kind === "none") excluded += group.tools.length;
    }
    return { allowed: Math.max(0, total - excluded), total };
  }
  let allowed = 0;
  for (const group of groups) allowed += selectedToolIds(group, selections[group.appKey]).size;
  return { allowed, total };
}

// ---------------------------------------------------------------------------------------------
// Templates (the wizard's first step and the empty state)

export type TemplateKey = "read_only" | "everyday" | "full_access" | "scratch" | "copy";

export const TEMPLATES: { key: TemplateKey; title: string; description: string }[] = [
  { key: "read_only", title: "Read-only", description: "See and fetch, but never change anything." },
  { key: "everyday", title: "Everyday work", description: "Read and make routine changes, no destructive tools." },
  { key: "full_access", title: "Full access", description: "Everything every connected app offers." },
  { key: "scratch", title: "Start from scratch", description: "An empty profile you build up tool by tool." },
  { key: "copy", title: "Copy an existing profile", description: "Start from a profile you already have." },
];

export function isTemplateKey(value: string | null | undefined): value is TemplateKey {
  return TEMPLATES.some((template) => template.key === value);
}

/** The selections a template implies for the current catalog. */
export function templateSelections(key: TemplateKey, groups: readonly AppGroup[]): Selections {
  const selections: Selections = {};
  if (key === "scratch" || key === "copy") {
    for (const group of groups) selections[group.appKey] = { kind: "none" };
    return selections;
  }
  const matches = (tool: ToolCatalogEntry) =>
    key === "read_only" ? toolCapability(tool) === "read" : key === "everyday" ? toolCapability(tool) !== "destructive" : true;
  for (const group of groups) {
    const ids = group.tools.filter(matches).map((tool) => tool.id);
    if (ids.length === 0) selections[group.appKey] = { kind: "none" };
    else if (ids.length === group.tools.length) selections[group.appKey] = { kind: "all" };
    else selections[group.appKey] = { kind: "some", included: ids };
  }
  return selections;
}

/** A profile's identifier from its name: lower case, safe characters, at most 160. */
export function profileKeyFrom(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

// ---------------------------------------------------------------------------------------------
// Wizard progress, kept in the profile's metadata

export type WizardStep = 1 | 2 | 3;
export type WizardMeta = { lastCompletedStep: WizardStep; template: TemplateKey | null };

export function readWizardMeta(profile: Pick<ToolProfileWithDetails, "metadata"> | null | undefined): WizardMeta | null {
  const raw = (profile?.metadata as Record<string, unknown> | null | undefined)?.wizard;
  if (!raw || typeof raw !== "object") return null;
  const meta = raw as Record<string, unknown>;
  const step = meta.lastCompletedStep;
  if (step !== 1 && step !== 2 && step !== 3) return null;
  return { lastCompletedStep: step, template: isTemplateKey(meta.template as string) ? (meta.template as TemplateKey) : null };
}

export function withWizardMeta(metadata: Record<string, unknown> | null | undefined, meta: WizardMeta): Record<string, unknown> {
  return { ...(metadata ?? {}), wizard: meta };
}

/** A draft resumes at the first step not yet finished. */
export function resumeStep(meta: WizardMeta | null): WizardStep {
  return meta ? (Math.min(meta.lastCompletedStep + 1, 3) as WizardStep) : 1;
}

// ---------------------------------------------------------------------------------------------
// The index and a profile's page

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "9 tools · 3 apps", "All tools", "All except 2 tools". */
export function allowsLabel(summary: ToolProfileSummary) {
  if (summary.accessMode === "all_except") return summary.excludedToolCount === 0 ? "All tools" : `All except ${plural(summary.excludedToolCount, "tool")}`;
  const parts = [plural(summary.allowedToolCount, "tool")];
  if (summary.allowedApplicationCount > 0) parts.push(plural(summary.allowedApplicationCount, "app"));
  return parts.join(" · ");
}

/** "Organization default", "2 agents", "Not assigned yet" (which changes nobody's access). */
export function assignedLabel(summary: ToolProfileSummary): { text: string; unassigned: boolean } {
  if (summary.isCompanyDefault) return { text: "Organization default", unassigned: false };
  if (summary.appliesToAgentCount > 0) return { text: plural(summary.appliesToAgentCount, "agent"), unassigned: false };
  if (summary.assignmentCount > 0) return { text: plural(summary.assignmentCount, "assignment"), unassigned: false };
  return { text: "Not assigned yet", unassigned: true };
}

export const STATUS_LABEL: Record<ToolProfileStatus, string> = { draft: "Draft", active: "Active", disabled: "Off", archived: "Archived" };

/** Profiles an app's setup made for itself (`app:<connectionId>`), which its own page manages. */
export function isAppProfile(profile: Pick<ToolProfileWithDetails, "profileKey">) {
  return profile.profileKey.startsWith("app:");
}

export type Names = {
  agents: Map<string, string>;
  projects: Map<string, string>;
  routines: Map<string, string>;
};

export function assignmentLabel(binding: Pick<ToolProfileBinding, "targetType" | "targetId">, companyId: string, names: Names) {
  if (binding.targetType === "company") return "Organization default";
  if (binding.targetType === "agent") return names.agents.get(binding.targetId) ?? "Unknown agent";
  if (binding.targetType === "project") return names.projects.get(binding.targetId) ?? "Unknown project";
  if (binding.targetType === "routine") return names.routines.get(binding.targetId) ?? "Unknown routine";
  if (binding.targetId === companyId) return "Organization";
  return binding.targetId;
}

export function assignmentKind(type: ToolProfileBinding["targetType"]) {
  if (type === "company") return "Everyone without their own profile";
  if (type === "agent") return "Agent";
  if (type === "project") return "Project";
  if (type === "routine") return "Recurring task";
  return "Scoped assignment";
}

/** Whether a stored entry covers a tool. */
export function entryMatchesTool(entry: ToolProfileEntry, tool: ToolCatalogEntry) {
  switch (entry.selectorType) {
    case "application":
      return Boolean(entry.applicationId && entry.applicationId === tool.applicationId);
    case "connection":
      return Boolean(entry.connectionId && entry.connectionId === tool.connectionId);
    case "catalog_entry":
      return Boolean(entry.catalogEntryId && entry.catalogEntryId === tool.id);
    case "tool_name":
      return Boolean(entry.toolName && entry.toolName === tool.toolName);
    case "risk_level":
      return Boolean(entry.riskLevel && entry.riskLevel === tool.riskLevel);
    default:
      return false;
  }
}

export type AllowRow = {
  id: string;
  app: string;
  tool: string;
  capability: string;
  source: string;
  /** Allowed because new tools are allowed automatically, and added in the last 30 days. */
  autoAddedAt: string | null;
  /** Its connection is off or failing. */
  degraded: boolean;
  connectionId: string;
};

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

/** What a profile allows, tool by tool, and why each is in. */
export function allowRows(
  profile: ToolProfileWithDetails,
  catalog: readonly ToolCatalogEntry[],
  appNames: Map<string, string>,
  connections: readonly Pick<ToolConnection, "id" | "name" | "status" | "healthStatus">[],
  now = Date.now(),
): AllowRow[] {
  const excluded = profile.entries.filter((entry) => entry.effect === "exclude");
  const included = profile.entries.filter((entry) => entry.effect === "include");
  const allExcept = profile.summary.accessMode === "all_except";
  const connectionsById = new Map(connections.map((connection) => [connection.id, connection]));
  return catalog
    .filter((tool) => !excluded.some((entry) => entryMatchesTool(entry, tool)))
    .filter((tool) => allExcept || included.some((entry) => entryMatchesTool(entry, tool)))
    .map((tool) => {
      const match = allExcept ? null : (included.find((entry) => entryMatchesTool(entry, tool)) ?? null);
      const connection = connectionsById.get(tool.connectionId);
      const app = appNames.get(tool.applicationId ?? "") ?? connection?.name ?? "Unknown app";
      const added = tool.addedAt ?? tool.firstSeenAt;
      const addedTime = added ? new Date(added).getTime() : Number.NaN;
      return {
        id: tool.id,
        app,
        tool: tool.title || tool.toolName,
        capability: CAPABILITY_LABEL[toolCapability(tool)],
        source:
          match?.selectorType === "application" || match?.selectorType === "connection"
            ? `All ${app}`
            : match?.selectorType === "risk_level" && match.riskLevel
              ? `Rule: ${match.riskLevel} tools`
              : "Picked",
        autoAddedAt:
          profile.defaultAction === "allow" && Number.isFinite(addedTime) && now - addedTime <= THIRTY_DAYS ? new Date(addedTime).toISOString() : null,
        degraded: Boolean(connection && (connection.status !== "active" || connection.healthStatus === "error")),
        connectionId: tool.connectionId,
      };
    });
}

/** "Gmail", "Gmail and Slack", "Gmail and 2 more apps": who added the new tools. */
export function newToolsAppLabel(tools: readonly { applicationName: string | null; connectionName: string | null }[]) {
  const names = [...new Set(tools.map((tool) => tool.applicationName ?? tool.connectionName).filter((name): name is string => Boolean(name)))];
  if (names.length === 0) return "An app";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} more apps`;
}

// ---------------------------------------------------------------------------------------------
// Assignments

export type AssignmentDraft = { agentIds: Set<string>; projectIds: Set<string>; routineIds: Set<string>; companyDefault: boolean };

export function assignmentDraft(bindings: readonly Pick<ToolProfileBinding, "targetType" | "targetId">[]): AssignmentDraft {
  const ids = (type: string) => new Set(bindings.filter((binding) => binding.targetType === type).map((binding) => binding.targetId));
  return {
    agentIds: ids("agent"),
    projectIds: ids("project"),
    routineIds: ids("routine"),
    companyDefault: bindings.some((binding) => binding.targetType === "company"),
  };
}

/**
 * The binds and unbinds that take a profile's assignments to the draft. Only the kinds the wizard
 * edits (organization, agents, projects, recurring tasks) are touched; task and gateway bindings stay.
 */
export function assignmentChanges(companyId: string, bindings: readonly Pick<ToolProfileBinding, "targetType" | "targetId">[], draft: AssignmentDraft) {
  const want = new Map<string, ProfileTarget>();
  if (draft.companyDefault) want.set(`company:${companyId}`, { targetType: "company", targetId: companyId });
  for (const id of draft.agentIds) want.set(`agent:${id}`, { targetType: "agent", targetId: id });
  for (const id of draft.projectIds) want.set(`project:${id}`, { targetType: "project", targetId: id });
  for (const id of draft.routineIds) want.set(`routine:${id}`, { targetType: "routine", targetId: id });
  const managed = new Set(["company", "agent", "project", "routine"]);
  const have = new Set(bindings.map((binding) => `${binding.targetType}:${binding.targetId}`));
  return {
    bind: [...want.entries()].filter(([key]) => !have.has(key)).map(([, target]) => target),
    unbind: bindings
      .filter((binding) => managed.has(binding.targetType) && !want.has(`${binding.targetType}:${binding.targetId}`))
      .map((binding) => ({ targetType: binding.targetType, targetId: binding.targetId })),
  };
}
