import type { Agent, BackupRetentionPolicy, Company, FeedbackDataSharingPreference, PluginRecord, PluginStatus } from "@paperclipai/shared";
import type { AdapterInfo } from "@/api/agents";
import type { BundledPlugin } from "@/api/plugins";
import type { HealthStatus } from "@/api/health";
import { harnessLabel, harnessType, RUNNER_HARNESSES } from "@/agents/agent-model";
import type { Tone } from "@/ui/Status";

/*
 * App settings' pure logic (boards 28–30): the sections and their addresses, including the old UI's
 * instance-settings addresses; how harnesses group into In use, Other built-in and Installed from
 * npm, with their agent counts; what an install field means; plugin status; and the General
 * section's deployment, sign-in and backup wording.
 *
 * Mirrored from the shared package (ui-new imports it with `import type` only), checked at each
 * upstream sync:
 * - `DAILY_RETENTION_PRESETS`, `WEEKLY_RETENTION_PRESETS`, `MONTHLY_RETENTION_PRESETS`
 *   (packages/shared/src/types/instance.ts);
 * - `sanitizeAssetNamespace` (validators/asset.ts), for the avatar's namespace;
 * - the old UI's `normalizeRememberedInstanceSettingsPath` (ui/src/lib/instance-settings.ts) and
 *   `isExperimentalPluginIdentity` (ui/src/pages/PluginManager.tsx).
 */

// ---------------------------------------------------------------------------------------------
// Sections and addresses

export type AppSectionKey = "account" | "general" | "organizations" | "admins" | "harnesses" | "plugins";

/** Where App settings lives inside a company, as the old UI's instance settings do. */
export const APP_SETTINGS_PATH = "/company/settings/instance";

export type AppSection = {
  key: AppSectionKey;
  label: string;
  /** The settings-visibility key an operator can hide it with (`PAPERCLIP_HIDDEN_SETTINGS`). */
  hiddenKey?: string;
  /** Only instance admins can see it. */
  admin: boolean;
};

export const APP_SECTIONS: ({ heading: string } | AppSection)[] = [
  { heading: "You" },
  { key: "account", label: "Account", hiddenKey: "instance.profile", admin: false },
  { heading: "This instance" },
  { key: "general", label: "General", admin: true },
  { key: "organizations", label: "Organizations", admin: true },
  { key: "admins", label: "Admins", hiddenKey: "instance.access", admin: true },
  { key: "harnesses", label: "Harnesses", hiddenKey: "instance.adapters", admin: true },
  { key: "plugins", label: "Plugins", hiddenKey: "instance.plugins", admin: true },
];

/** The sections this person sees: instance sections only for instance admins, minus hidden ones. */
export function visibleSections(isAdmin: boolean, hidden: readonly string[] = []): ({ heading: string } | AppSection)[] {
  const hiddenSet = new Set(hidden);
  const shown = APP_SECTIONS.filter((entry) => "heading" in entry || ((isAdmin || !entry.admin) && !(entry.hiddenKey && hiddenSet.has(entry.hiddenKey))));
  // Drop a heading with nothing under it.
  return shown.filter((entry, index) => !("heading" in entry) || (shown[index + 1] !== undefined && !("heading" in shown[index + 1]!)));
}

/** The section to open when the address names none: General for admins, otherwise Account. */
export function defaultSection(sections: readonly ({ heading: string } | AppSection)[]): AppSectionKey | null {
  const keys = sections.flatMap((entry) => ("heading" in entry ? [] : [entry.key]));
  return keys.includes("general") ? "general" : (keys[0] ?? null);
}

const SECTION_KEYS = new Set<AppSectionKey>(["account", "general", "organizations", "admins", "harnesses", "plugins"]);

/** The old UI's section names, and their sections here. */
const OLD_SECTIONS: Record<string, AppSectionKey> = {
  profile: "account",
  access: "admins",
  adapters: "harnesses",
  // No Experimental page (board 30): its address opens General.
  experimental: "general",
  heartbeats: "general",
  companies: "organizations",
  orgs: "organizations",
};

export type AppSettingsRoute =
  | { kind: "section"; section: AppSectionKey }
  | { kind: "default" }
  /** Somewhere else in the company, such as `/company/settings/environments`. */
  | { kind: "redirect"; to: string };

/**
 * What the address after `/company/settings/instance` opens. The old UI's addresses keep working:
 * `/profile`, `/access`, `/adapters` and `/experimental` move to their sections here, a plugin's
 * settings page (`/plugins/:id`) opens it under Plugins (`?plugin=:id`), and Environments moves to organization settings,
 * since the API keeps environments per organization (board 30).
 */
export function appSettingsRoute(rest: string): AppSettingsRoute {
  const segments = rest.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
  const first = segments[0];
  if (!first) return { kind: "default" };
  if (first === "environments") return { kind: "redirect", to: "/company/settings/environments" };
  if (first === "plugins" && segments.length > 1) {
    const pluginId = rest.split("/").filter(Boolean)[1]!;
    return { kind: "redirect", to: `${APP_SETTINGS_PATH}/plugins?plugin=${encodeURIComponent(pluginId)}` };
  }
  if (SECTION_KEYS.has(first as AppSectionKey)) {
    return segments.length === 1
      ? { kind: "section", section: first as AppSectionKey }
      : { kind: "redirect", to: `${APP_SETTINGS_PATH}/${first}` };
  }
  const moved = OLD_SECTIONS[first];
  return moved ? { kind: "redirect", to: `${APP_SETTINGS_PATH}/${moved}` } : { kind: "default" };
}

/**
 * The old UI's addresses outside a company, `/instance`, `/instance/settings/*` and `/settings/*`,
 * as the suffix under App settings: `/instance/settings/plugins` is `/plugins`.
 */
export function legacySettingsSuffix(kind: "instance" | "settings", rest: string): string {
  const segments = rest.split("/").filter(Boolean);
  if (kind === "instance") {
    if (segments[0]?.toLowerCase() !== "settings") return "";
    segments.shift();
  }
  return segments.length ? `/${segments.join("/")}` : "";
}

// ---------------------------------------------------------------------------------------------
// Harnesses

export type HarnessUsage = Record<string, { agents: number; viaRunner: number }>;

/**
 * How many agents use each harness. An agent on the Paperclip Runner counts for its harness (Claude
 * Code, Codex…) and for the runner. Terminated agents don't count.
 */
export function harnessUsage(agents: readonly Pick<Agent, "adapterType" | "adapterConfig" | "status">[]): HarnessUsage {
  const usage: HarnessUsage = {};
  const add = (type: string, viaRunner: boolean) => {
    const entry = (usage[type] ??= { agents: 0, viaRunner: 0 });
    entry.agents += 1;
    if (viaRunner) entry.viaRunner += 1;
  };
  for (const agent of agents) {
    if (agent.status === "terminated") continue;
    const config = (agent.adapterConfig ?? {}) as Record<string, unknown>;
    const onRunner = agent.adapterType === "paperclip_runner";
    add(harnessType(agent.adapterType, config), onRunner);
    if (onRunner) add("paperclip_runner", false);
  }
  return usage;
}

export type HarnessState = "ready" | "off" | "paused" | "failed";

export type HarnessRow = {
  type: string;
  label: string;
  adapter: AdapterInfo;
  agents: number;
  viaRunner: number;
  state: HarnessState;
  /** The switch: on means offered when hiring (or, for an override, the override is active). */
  on: boolean;
  /** For an external package registered under a built-in type: that harness's name. */
  replaces?: string;
};

/** A harness's name: the agent pages' label, or an external package's own label if it has one. */
export function adapterLabel(adapter: Pick<AdapterInfo, "type" | "label" | "source">) {
  return adapter.source === "external" && adapter.label && adapter.label !== adapter.type ? adapter.label : harnessLabel(adapter.type);
}

function harnessRow(adapter: AdapterInfo, usage: HarnessUsage): HarnessRow {
  const used = usage[adapter.type] ?? { agents: 0, viaRunner: 0 };
  const override = adapter.source === "external" && Boolean(adapter.overriddenBuiltin);
  const state: HarnessState =
    adapter.loaded === false ? "failed" : override ? (adapter.overridePaused ? "paused" : "ready") : adapter.disabled ? "off" : "ready";
  return {
    type: adapter.type,
    label: adapterLabel(adapter),
    adapter,
    agents: used.agents,
    viaRunner: used.viaRunner,
    state,
    on: override ? !adapter.overridePaused : !adapter.disabled,
    replaces: override ? harnessLabel(adapter.type) : undefined,
  };
}

/** Retired harnesses: listed only while an agent still uses one. */
const RETIRED = new Set(["acpx_local"]);

/**
 * Board 29's three groups: built-in harnesses some agent uses (most used first), the other built-in
 * ones, and the packages installed from npm or a local folder.
 */
export function groupHarnesses(adapters: readonly AdapterInfo[], usage: HarnessUsage) {
  const rows = adapters.map((adapter) => harnessRow(adapter, usage));
  const byLabel = (a: HarnessRow, b: HarnessRow) => a.label.localeCompare(b.label);
  const builtIn = rows.filter((row) => row.adapter.source === "builtin");
  return {
    inUse: builtIn.filter((row) => row.agents > 0).sort((a, b) => b.agents - a.agents || byLabel(a, b)),
    otherBuiltIn: builtIn.filter((row) => row.agents === 0 && !RETIRED.has(row.type)).sort(byLabel),
    installed: rows.filter((row) => row.adapter.source === "external").sort(byLabel),
  };
}

function agentCount(count: number) {
  return count === 0 ? "no agents yet" : count === 1 ? "1 agent" : `${count} agents`;
}

/** "Built in · 3 agents, 1 on the Paperclip Runner"; "Version 0.4.1 · no agents yet". */
export function harnessSummary(row: HarnessRow): string {
  const parts: string[] = [];
  if (row.adapter.source === "builtin") parts.push("Built in");
  else if (row.adapter.isLocalPath) parts.push(row.adapter.version ? `Local folder · version ${row.adapter.version}` : "Local folder");
  else parts.push(row.adapter.version ? `Version ${row.adapter.version}` : "From npm");
  if (row.replaces) parts.push(`replaces the built-in ${row.replaces}`);
  parts.push(row.viaRunner > 0 ? `${agentCount(row.agents)}, ${row.viaRunner} on the Paperclip Runner` : agentCount(row.agents));
  if (row.type === "paperclip_runner") {
    const carried = [...RUNNER_HARNESSES].map(harnessLabel).sort((a, b) => a.localeCompare(b));
    parts.push(`carries ${carried.slice(0, -1).join(", ")} and ${carried.at(-1)}`);
  }
  return parts.join(" · ");
}

export const HARNESS_STATE: Record<HarnessState, { label: string; tone: Tone | null }> = {
  ready: { label: "Ready", tone: "green" },
  off: { label: "Off", tone: null },
  paused: { label: "Paused", tone: "amber" },
  failed: { label: "Didn't load", tone: "red" },
};

export type InstallTarget = { packageName: string; version?: string; isLocalPath: boolean };

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/**
 * What an install field holds: a local folder (an absolute, relative, home or Windows path), or an
 * npm package with an optional `@version`. Returns a problem to show instead when it's neither.
 */
export function parseInstallTarget(input: string): { ok: true; target: InstallTarget } | { ok: false; problem: string } {
  const value = input.trim();
  if (!value) return { ok: false, problem: "Enter an npm package name or a folder path." };
  if (/^(?:\/|\.{1,2}[\\/]|~[\\/]?|[A-Za-z]:[\\/]|\\\\)/.test(value)) {
    return { ok: true, target: { packageName: value, isLocalPath: true } };
  }
  const at = value.lastIndexOf("@");
  const name = at > 0 ? value.slice(0, at) : value;
  const version = at > 0 ? value.slice(at + 1) : undefined;
  if (!NPM_NAME.test(name)) return { ok: false, problem: "That isn't an npm package name. Package names are lowercase, like @acme/paperclip-adapter." };
  if (version !== undefined && !/^[\w.+-]+$/.test(version)) return { ok: false, problem: "That version isn't valid. Use a version like 1.2.0, or a tag like latest." };
  return { ok: true, target: version ? { packageName: name, version, isLocalPath: false } : { packageName: name, isLocalPath: false } };
}

/** Compares dotted release versions, ignoring any pre-release part: negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) => value.replace(/^v/, "").split(/[-+]/)[0]!.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The newer npm version to offer, or null when there's none (or the harness is a local folder). */
export function updateOffer(adapter: Pick<AdapterInfo, "version" | "isLocalPath">, latest: string | null | undefined): string | null {
  if (adapter.isLocalPath || !latest) return null;
  if (!adapter.version) return latest;
  return compareVersions(adapter.version, latest) < 0 ? latest : null;
}

// ---------------------------------------------------------------------------------------------
// Plugins

export const PLUGIN_STATUS: Record<PluginStatus, { label: string; tone: Tone | null }> = {
  ready: { label: "Ready", tone: "green" },
  installed: { label: "Starting", tone: "cyan" },
  upgrade_pending: { label: "Update waiting", tone: "amber" },
  error: { label: "Error", tone: "red" },
  disabled: { label: "Off", tone: null },
  uninstalled: { label: "Removed", tone: null },
};

export function pluginName(plugin: Pick<PluginRecord, "packageName" | "manifestJson">) {
  return plugin.manifestJson?.displayName?.trim() || plugin.packageName;
}

/** The plugin's switch: on unless it's been turned off (or removed). */
export function pluginOn(status: PluginStatus) {
  return status !== "disabled" && status !== "uninstalled";
}

/** A name for an initials disc, without the punctuation that would become an initial: "Kitchen Sink (Example)" is KS. */
export function discName(name: string) {
  return name.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim() || name;
}

/** The first line of a plugin's stored error, for its row. */
export function pluginErrorSummary(lastError: string | null | undefined) {
  return lastError?.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "It stopped with an error and no message.";
}

/** Sandbox and environment-provider plugins are experimental, as the old UI marks them. */
export function isExperimentalPlugin(input: {
  packageName?: string | null;
  packagePath?: string | null;
  manifestJson?: PluginRecord["manifestJson"] | null;
  bundledExperimental?: boolean;
}) {
  if (input.bundledExperimental) return true;
  if ((input.packageName ?? "").includes("sandbox") || (input.packagePath ?? "").includes("sandbox")) return true;
  return input.manifestJson?.environmentDrivers?.some((driver) => driver.kind === "sandbox_provider") === true;
}

/** The bundled plugins with the installed record of each, first-party ones first. */
export function bundledRows(bundled: readonly BundledPlugin[], installed: readonly PluginRecord[]) {
  const byPackage = new Map(installed.map((plugin) => [plugin.packageName, plugin]));
  return [...bundled]
    .sort((a, b) => (a.tag === b.tag ? a.displayName.localeCompare(b.displayName) : a.tag === "first-party" ? -1 : 1))
    .map((plugin) => ({ plugin, installed: byPackage.get(plugin.packageName) ?? null }));
}

// ---------------------------------------------------------------------------------------------
// General

export type InstanceHealth = HealthStatus & {
  features?: { companyDeletionEnabled?: boolean };
  databaseBackup?: {
    enabled: boolean;
    status: "ok" | "warning";
    latestBackup?: { mtime: string; ageHours: number; sizeBytes: number } | null;
    warnings?: { code: string; message: string }[];
  };
};

/** Board 28's Mode row: the pill and the line beside it. */
export function deploymentMode(health: InstanceHealth | undefined) {
  if (health?.deploymentMode === "local_trusted") {
    return { label: "Local trusted", note: "No sign-in: browser requests act as the local board." };
  }
  return {
    label: "Authenticated",
    note: health?.deploymentExposure === "public" ? "Public: sign-in required, for a public address." : "Private network: sign-in required, for a LAN, VPN or tailnet.",
  };
}

/** The sign-in checks the server reports, each passed or not. */
export function signInChecks(health: InstanceHealth | undefined): { ok: boolean; text: string }[] {
  if (!health || health.deploymentMode === "local_trusted") return [];
  return [
    { ok: health.authReady === true, text: health.authReady ? "Sign-in is ready" : "Sign-in isn't ready: check the auth secret and public URL" },
    {
      ok: health.bootstrapStatus !== "bootstrap_pending",
      text: health.bootstrapStatus === "bootstrap_pending" ? "No instance admin yet: claim the first-admin invite" : "An instance admin exists",
    },
  ];
}

export function executionPolicy(mode: "kubernetes" | "any" | undefined) {
  return mode === "kubernetes" ? "Only the Kubernetes sandbox: local and SSH runs are refused" : "Any environment: local, SSH or sandbox";
}

export const RETENTION = {
  dailyDays: { label: "Daily backups", help: "Every backup in this window is kept.", values: [3, 7, 14], unit: "day" },
  weeklyWeeks: { label: "Weekly backups", help: "Then one a week.", values: [1, 2, 4], unit: "week" },
  monthlyMonths: { label: "Monthly backups", help: "Then one a month.", values: [1, 3, 6], unit: "month" },
} as const satisfies Record<keyof BackupRetentionPolicy, { label: string; help: string; values: readonly number[]; unit: string }>;

export function retentionLabel(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** The server's backup check in a line: when the last backup ran, or what's wrong. */
export function backupStatus(backup: InstanceHealth["databaseBackup"], now = Date.now()): { ok: boolean; text: string } | null {
  if (!backup) return null;
  if (!backup.enabled) return { ok: false, text: "Automatic backups are off in the server's configuration." };
  const warning = backup.warnings?.[0];
  if (backup.status === "warning" && warning) return { ok: false, text: warning.message };
  const latest = backup.latestBackup;
  if (!latest) return { ok: true, text: "Backups run about every hour." };
  const minutes = Math.max(0, Math.round((now - new Date(latest.mtime).getTime()) / 60_000));
  const ago = minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
  return { ok: true, text: `Last backup ${ago}, ${(latest.sizeBytes / 1_048_576).toFixed(1)} MB. Backups run about every hour.` };
}

export const FEEDBACK_OPTIONS: { value: FeedbackDataSharingPreference; label: string }[] = [
  { value: "prompt", label: "Ask each time" },
  { value: "allowed", label: "Always allow" },
  { value: "not_allowed", label: "Don't allow" },
];

// ---------------------------------------------------------------------------------------------
// Organizations, admins and account

/** Active organizations first, then paused, then archived; by name within each. */
export function sortOrganizations(companies: readonly Company[]) {
  const rank = (status: Company["status"]) => (status === "active" ? 0 : status === "paused" ? 1 : 2);
  return [...companies].sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
}

/** A rename to save, or null when the name is empty or unchanged. */
export function renameEdit(current: string, draft: string): string | null {
  const name = draft.trim();
  return name && name !== current ? name : null;
}

export function personLabel(user: { name: string | null; email: string | null; id: string }) {
  return user.name?.trim() || user.email || `User ${user.id.slice(0, 6)}`;
}

/**
 * Why an admin can't be removed, or null when they can: not yourself (you'd lose this page) and not
 * the last one.
 */
export function demoteProblem(user: { id: string; isInstanceAdmin: boolean }, youId: string | null, adminCount: number): string | null {
  if (!user.isInstanceAdmin) return null;
  if (user.id === youId) return "You can't remove yourself. Ask another admin.";
  if (adminCount <= 1) return "The instance needs at least one admin.";
  return null;
}

/** Whether two sets of organization ids differ. */
export function accessChanged(saved: ReadonlySet<string>, draft: ReadonlySet<string>) {
  return saved.size !== draft.size || [...draft].some((id) => !saved.has(id));
}

/** The avatar's storage namespace, cleaned the way the server accepts. */
export function avatarNamespace(userId: string) {
  const segment = userId.trim().replace(/[^a-zA-Z0-9_.:@|-]+/g, "-").replace(/-{2,}/g, "-");
  return segment && segment !== "." && segment !== ".." ? `profiles/${segment}` : "profiles";
}

/** A problem with a display name, or null. */
export function displayNameProblem(name: string) {
  const value = name.trim();
  if (!value) return "Enter a name.";
  if (value.length > 120) return "Keep it under 120 characters.";
  return null;
}
