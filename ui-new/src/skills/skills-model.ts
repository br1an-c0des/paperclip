import { builtInSkill, PAPERCLIP_CORE_SKILL_KEY, recommendedForLeads } from "@/agents/agent-model";
import type {
  Agent,
  CatalogSkill,
  CompanySkillCreateRequest,
  CompanySkillFileInventoryEntry,
  CompanySkillListItem,
  CompanySkillProjectScanCandidate,
  CompanySkillUpdateStatus,
  CompanySkillVersion,
  FolderListItem,
  SkillSource,
} from "@paperclipai/shared";

/*
 * The Skills pages' view model, apart from the components so it can be tested: where each skill
 * comes from, Paperclip's core skills and who should have them, the library's filters, and the
 * Studio's drafts, files and versions.
 */

// ---------------------------------------------------------------------------------------------
// The pages' addresses

export type SkillsView =
  | { section: "library"; skillId: string | null }
  | { section: "catalog"; catalogId: string | null }
  | { section: "sources"; sourceId: string | null }
  | { section: "studio"; skillId: string | null; creating: boolean }
  | { section: "redirect"; to: string };

/**
 * What `/:prefix/skills/<rest>` shows. The old UI's library addresses (`/skills/:skillId`, and deeper
 * ones like `/skills/:skillId/files/…`) open the library on that skill; `/skills/:skillId/studio`
 * moves to the Studio. The catalog is `/skills/catalog` and `/skills/catalog/:catalogId` (the old
 * UI's `/skills?view=catalog&catalog=…` is turned into it by the page).
 */
export function skillsView(rest: string): SkillsView {
  const [first, second, third] = rest.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (!first) return { section: "library", skillId: null };
  if (first === "catalog") return { section: "catalog", catalogId: second ? safeDecode(second) : null };
  if (first === "sources") return { section: "sources", sourceId: second ?? null };
  if (first === "studio") return second === "new" ? { section: "studio", skillId: null, creating: true } : { section: "studio", skillId: second ?? null, creating: false };
  if (second === "studio" && !third) return { section: "redirect", to: `studio/${first}` };
  return { section: "library", skillId: first };
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Where the old UI's `?view=catalog&catalog=<id>` lands, or null for any other query. */
export function legacyCatalogPath(search: { view?: string; catalog?: string }) {
  if (search.view !== "catalog") return null;
  return search.catalog ? `catalog/${encodeURIComponent(search.catalog)}` : "catalog";
}

// ---------------------------------------------------------------------------------------------
// Where a skill comes from

/**
 * The core Paperclip skills (`PAPERCLIP_CORE_SKILL_KEYS` in server/src/services/company-skills.ts):
 * the operating skill plus what a lead agent needs to run the company. The agent page's skills
 * section marks the same ones, so both read agent-model's lists.
 */
export function isCoreSkill(key: string) {
  return key.trim().toLowerCase() === PAPERCLIP_CORE_SKILL_KEY || recommendedForLeads(key);
}

/** Whether an agent's harness already provides this skill: the Paperclip Runner carries the operating skill. */
export function providedByHarness(key: string, adapterType: string) {
  return builtInSkill(adapterType, key) === "runner";
}

export type SkillOrigin = "bundled" | "imported" | "authored";

export const ORIGIN_LABEL: Record<SkillOrigin, string> = {
  bundled: "Bundled with Paperclip",
  imported: "Imported",
  authored: "Authored here",
};

type OriginInput = Pick<CompanySkillListItem, "key" | "sourceBadge" | "sourceType" | "forkedFromSkillId">;

/**
 * Bundled skills ship with Paperclip (`paperclipai/paperclip/…`); authored ones were written in this
 * company (their key is `company/<id>/<slug>`, forks included); everything else came in from a
 * source, the catalog, a URL or a folder.
 */
export function skillOrigin(skill: OriginInput): SkillOrigin {
  // Authored skills carry the "paperclip" badge too ("Paperclip workspace"), so they're told apart first.
  if (skill.key.startsWith("company/") || skill.forkedFromSkillId) return "authored";
  if (skill.sourceBadge === "paperclip" || skill.key.startsWith("paperclipai/paperclip/")) return "bundled";
  return "imported";
}

/** Where an imported skill came from, in a few words. */
export function sourceLine(skill: Pick<CompanySkillListItem, "sourceType" | "sourceLabel" | "sourceLocator" | "sourceBadge" | "key">) {
  if (skill.sourceLabel) return skill.sourceLabel;
  switch (skill.sourceType) {
    case "github":
      return skill.key.split("/").slice(0, 2).join("/");
    case "url":
      return skill.sourceLocator ?? "A URL";
    case "catalog":
      return "Paperclip catalog";
    case "skills_sh":
      return "skills.sh";
    default:
      return "A local folder";
  }
}

// ---------------------------------------------------------------------------------------------
// Lead agents and the core skills

type LeadAgent = Pick<Agent, "id" | "name" | "status" | "reportsTo" | "adapterType">;

/**
 * Lead agents: the ones at the top of the org chart, and anyone with reports. Retired agents and
 * pending hires aren't counted.
 */
export function leadAgents<A extends LeadAgent>(agents: readonly A[]): A[] {
  const active = agents.filter((agent) => agent.status !== "terminated" && agent.status !== "pending_approval");
  const managers = new Set(active.flatMap((agent) => (agent.reportsTo ? [agent.reportsTo] : [])));
  return active.filter((agent) => !agent.reportsTo || managers.has(agent.id)).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The lead agents a core skill is recommended for that don't have it. Runner agents are left out
 * for `paperclip`, which the Runner provides.
 */
export function leadsWithout<A extends LeadAgent>(key: string, usedBy: readonly { id: string }[], agents: readonly A[]): A[] {
  if (!isCoreSkill(key)) return [];
  const has = new Set(usedBy.map((agent) => agent.id));
  return leadAgents(agents).filter((agent) => !has.has(agent.id) && !providedByHarness(key, agent.adapterType));
}

// ---------------------------------------------------------------------------------------------
// The library's filters

export type LibraryFilter = "all" | "bundled" | "imported" | "authored" | "unused";

export const LIBRARY_FILTERS: readonly { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "bundled", label: "Bundled" },
  { value: "imported", label: "Imported" },
  { value: "authored", label: "Authored" },
  { value: "unused", label: "Not in use" },
];

export function isLibraryFilter(value: unknown): value is LibraryFilter {
  return LIBRARY_FILTERS.some((filter) => filter.value === value);
}

type Listed = OriginInput & Pick<CompanySkillListItem, "name" | "slug" | "description" | "attachedAgentCount" | "categories">;

export function matchesLibrary(skill: Listed, filter: LibraryFilter) {
  if (filter === "all") return true;
  if (filter === "unused") return skill.attachedAgentCount === 0;
  return skillOrigin(skill) === filter;
}

export function libraryCounts(skills: readonly Listed[]) {
  return Object.fromEntries(LIBRARY_FILTERS.map(({ value }) => [value, skills.filter((skill) => matchesLibrary(skill, value)).length])) as Record<LibraryFilter, number>;
}

/** Every word of the query in the skill's name, slug, description or categories. */
export function matchesQuery(skill: Listed, query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [skill.name, skill.slug, skill.description ?? "", ...skill.categories].join(" ").toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}

/** The core skills first, then by name. */
export function sortLibrary<S extends Listed>(skills: readonly S[]): S[] {
  return [...skills].sort((a, b) => Number(isCoreSkill(b.key)) - Number(isCoreSkill(a.key)) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

// ---------------------------------------------------------------------------------------------
// Versions and files

/** "v3 · Initial version", or "v3". */
export function versionName(version: Pick<CompanySkillVersion, "revisionNumber" | "label" | "releaseName">) {
  const label = version.releaseName ?? version.label;
  return label ? `v${version.revisionNumber} · ${label}` : `v${version.revisionNumber}`;
}

const KIND_ORDER: Record<CompanySkillFileInventoryEntry["kind"], number> = { skill: 0, markdown: 1, reference: 2, script: 3, asset: 4, other: 5 };

/** The skill's files, SKILL.md first, then by kind and path. */
export function sortedFiles(inventory: readonly CompanySkillFileInventoryEntry[]) {
  return [...inventory].sort((a, b) => {
    const top = Number(b.path === "SKILL.md") - Number(a.path === "SKILL.md");
    return top || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.path.localeCompare(b.path);
  });
}

/** Why a new file's path won't do, or null. Paths are relative, with no `..`, and new. */
export function newFileProblem(path: string, existing: readonly { path: string }[]) {
  const clean = path.trim().replace(/^\.?\/+/, "");
  if (!clean) return "Give the file a path, like references/notes.md.";
  if (clean.split("/").some((part) => part === ".." || part === "." || part === "")) return "Use a plain relative path, without “..” or empty folders.";
  if (/[\\:*?"<>|]/.test(clean)) return "Paths can't contain \\ : * ? \" < > or |.";
  if (existing.some((file) => file.path.toLowerCase() === clean.toLowerCase())) return "A file with that path already exists.";
  return null;
}

// ---------------------------------------------------------------------------------------------
// A new skill

/** The slug a name makes: lower case, dashes for anything else, at most 80 characters. */
export function slugFor(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** A SKILL.md to start from, with the frontmatter agents read. */
export function starterMarkdown(name: string, description: string) {
  const title = name.trim() || "New skill";
  const summary = description.trim() || "Describe when agents should use this skill.";
  return [
    "---",
    `name: ${title}`,
    `description: ${summary}`,
    "---",
    "",
    `# ${title}`,
    "",
    summary,
    "",
    "## When to use it",
    "",
    "- ",
    "",
    "## How",
    "",
    "1. ",
    "",
  ].join("\n");
}

export type SkillDraft = { name: string; slug: string; description: string; categories: string };

export function draftProblem(draft: SkillDraft, existing: readonly Pick<CompanySkillListItem, "slug" | "key">[]) {
  if (!draft.name.trim()) return "Give the skill a name.";
  const slug = draft.slug.trim() || slugFor(draft.name);
  if (!slug) return "The name needs a letter or a number.";
  if (existing.some((skill) => skill.key.startsWith("company/") && skill.slug === slug)) return `A skill called “${slug}” already exists here.`;
  return null;
}

/** "a, B ,a" → ["a", "B"]: trimmed, without repeats (ignoring case). */
export function splitCategories(value: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value.split(",")) {
    const category = entry.trim().replace(/\s+/g, " ");
    if (!category || seen.has(category.toLowerCase())) continue;
    seen.add(category.toLowerCase());
    out.push(category);
  }
  return out;
}

export function createPayload(draft: SkillDraft): CompanySkillCreateRequest {
  return {
    name: draft.name.trim(),
    slug: draft.slug.trim() || slugFor(draft.name) || null,
    description: draft.description.trim() || null,
    markdown: starterMarkdown(draft.name, draft.description),
    categories: splitCategories(draft.categories),
  };
}

// ---------------------------------------------------------------------------------------------
// Sources

const SYNC_LABEL: Record<NonNullable<SkillSource["syncState"]>, string> = {
  pending: "Waiting to sync",
  refreshing: "Syncing",
  ready: "Up to date",
  error: "Sync failed",
  paused: "Paused",
};

export function syncLabel(source: Pick<SkillSource, "syncState" | "lastError" | "enabled">) {
  if (source.lastError) return "Sync failed";
  if (!source.enabled) return "Paused";
  return SYNC_LABEL[source.syncState ?? "ready"];
}

/** A GitHub repository address, "owner/repo", or null. */
export function repositoryProblem(value: string) {
  const text = value.trim();
  if (!text) return "Paste a GitHub repository address.";
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) return null;
  try {
    const url = new URL(text);
    if (!/(^|\.)github\.com$/.test(url.hostname)) return "Sources are GitHub repositories for now.";
    if (url.pathname.split("/").filter(Boolean).length < 2) return "Include the owner and repository, like github.com/owner/repo.";
    return null;
  } catch {
    return "That isn't a repository address. Try github.com/owner/repo.";
  }
}

/** "owner/repo" becomes its GitHub address; full addresses stay as they are. */
export function repositoryUrl(value: string) {
  const text = value.trim();
  return /^[\w.-]+\/[\w.-]+$/.test(text) ? `https://github.com/${text}` : text;
}

/** "main", or "default branch" for HEAD. */
export function branchLabel(ref: string) {
  return ref === "HEAD" ? "default branch" : ref;
}

// ---------------------------------------------------------------------------------------------
// Folders

/** The library's folder pick: every skill, the ones in no folder, or one folder and those under it. */
export type FolderPick = "all" | "unfiled" | string;

/** Folders in tree order (parents before children, siblings by position then name), with their depth. */
export function folderTree(folders: readonly FolderListItem[]): FolderListItem[] {
  const byParent = new Map<string | null, FolderListItem[]>();
  for (const folder of folders) {
    const list = byParent.get(folder.parentId) ?? [];
    list.push(folder);
    byParent.set(folder.parentId, list);
  }
  const known = new Set(folders.map((folder) => folder.id));
  const out: FolderListItem[] = [];
  const walk = (parentId: string | null) => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    for (const child of children) {
      out.push(child);
      walk(child.id);
    }
  };
  walk(null);
  // A folder whose parent isn't listed still shows, at the top level.
  for (const folder of folders) if (folder.parentId && !known.has(folder.parentId) && !out.includes(folder)) out.push(folder);
  return out;
}

/** A folder and every folder under it, by path. */
export function folderSubtree(folders: readonly Pick<FolderListItem, "id" | "path">[], folderId: string): Set<string> {
  const root = folders.find((folder) => folder.id === folderId);
  if (!root) return new Set([folderId]);
  return new Set(folders.filter((folder) => folder.id === root.id || folder.path.startsWith(`${root.path}/`)).map((folder) => folder.id));
}

export function matchesFolder(skill: Pick<CompanySkillListItem, "folderId">, pick: FolderPick, subtree: ReadonlySet<string> | null) {
  if (pick === "all") return true;
  if (pick === "unfiled") return !skill.folderId;
  return Boolean(skill.folderId && subtree?.has(skill.folderId));
}

/** System folders (Bundled and its groups, a person's own folder) can't be renamed or removed. */
export function folderEditable(folder: Pick<FolderListItem, "systemKey">) {
  return !folder.systemKey;
}

/** Why a folder name won't do, or null. */
export function folderNameProblem(name: string, siblings: readonly Pick<FolderListItem, "name">[]) {
  const clean = name.trim();
  if (!clean) return "Give the folder a name.";
  if (clean.length > 80) return "Keep it under 80 characters.";
  if (siblings.some((folder) => folder.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) return "A folder with that name is already there.";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Sorting

export type LibrarySort = "name" | "recent" | "stars" | "agents";

export const LIBRARY_SORTS: readonly { value: LibrarySort; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "recent", label: "Recently updated" },
  { value: "stars", label: "Most stars" },
  { value: "agents", label: "Most used" },
];

export function isLibrarySort(value: unknown): value is LibrarySort {
  return LIBRARY_SORTS.some((sort) => sort.value === value);
}

type Sortable = Listed & Pick<CompanySkillListItem, "updatedAt" | "starCount">;

/** By name keeps the core skills first; the other orders fall back to the name. */
export function sortSkills<S extends Sortable>(skills: readonly S[], sort: LibrarySort): S[] {
  if (sort === "name") return sortLibrary(skills);
  const byName = (a: S, b: S) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const key = (skill: S) =>
    sort === "recent" ? new Date(skill.updatedAt).getTime() : sort === "stars" ? skill.starCount : skill.attachedAgentCount;
  return [...skills].sort((a, b) => key(b) - key(a) || byName(a, b));
}

// ---------------------------------------------------------------------------------------------
// The catalog

export type CatalogKindFilter = "all" | "bundled" | "optional" | "installed";

export const CATALOG_FILTERS: readonly { value: CatalogKindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "bundled", label: "Recommended" },
  { value: "optional", label: "Optional" },
  { value: "installed", label: "Installed" },
];

export function isCatalogFilter(value: unknown): value is CatalogKindFilter {
  return CATALOG_FILTERS.some((filter) => filter.value === value);
}

/** The library's copy of each catalog skill, by catalog id. Installed skills keep the catalog's key. */
export function installedFromCatalog<S extends Pick<CompanySkillListItem, "key">>(catalog: readonly CatalogSkill[], skills: readonly S[]) {
  const byKey = new Map(skills.map((skill) => [skill.key.trim().toLowerCase(), skill]));
  const out = new Map<string, S>();
  for (const entry of catalog) {
    const found = byKey.get(entry.key.trim().toLowerCase());
    if (found) out.set(entry.id, found);
  }
  return out;
}

export function matchesCatalog(entry: CatalogSkill, filter: CatalogKindFilter, installed: boolean, query: string) {
  if (filter === "installed" && !installed) return false;
  if ((filter === "bundled" || filter === "optional") && entry.kind !== filter) return false;
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const text = [entry.name, entry.slug, entry.description, entry.category, ...entry.tags, ...entry.recommendedForRoles].join(" ").toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}

/** Catalog skills by category (categories by name, "Other" last), each sorted by name. */
export function catalogGroups(entries: readonly CatalogSkill[]) {
  const groups = new Map<string, CatalogSkill[]>();
  for (const entry of entries) {
    const key = entry.category || "other";
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => Number(a === "other") - Number(b === "other") || a.localeCompare(b))
    .map(([category, list]) => ({ category, label: categoryLabel(category), skills: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** "software-development" → "Software development". */
export function categoryLabel(slug: string) {
  const text = slug.replace(/[-_]+/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "Other";
}

/** "4.9 KB". */
export function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(1))} KB`;
  return `${Number((bytes / 1024 / 1024).toFixed(1))} MB`;
}

// ---------------------------------------------------------------------------------------------
// Updates

const HOLD_TEXT: Record<NonNullable<CompanySkillUpdateStatus["updateHoldReason"]>, string> = {
  local_modifications: "It was changed here, so updates wait until you install one on purpose.",
  audit_hard_stop: "The new version failed Paperclip's safety check, so it isn't installed.",
  origin_unavailable: "Its source can't be reached right now.",
  compatibility_invalid: "The new version isn't a valid skill.",
  operator_hold: "Updates are on hold for this skill.",
};

export type UpdateLine = { tone: "none" | "available" | "held"; text: string; canInstall: boolean };

/** What the update check says, in words, and whether Install update is offered. */
export function updateLine(status: CompanySkillUpdateStatus | undefined): UpdateLine | null {
  if (!status) return null;
  if (!status.supported) return { tone: "none", text: status.reason ?? "Updates aren't tracked for this skill.", canInstall: false };
  const hold = status.updateHoldReason ? HOLD_TEXT[status.updateHoldReason] : null;
  if (status.hasUpdate) {
    const refs = status.latestRef ? ` (${shortRef(status.currentRef)} → ${shortRef(status.latestRef)})` : "";
    return {
      tone: hold ? "held" : "available",
      text: hold ? `A newer version is available${refs}. ${hold}` : `A newer version is available${refs}.`,
      canInstall: status.updateHoldReason !== "audit_hard_stop" && status.updateHoldReason !== "compatibility_invalid",
    };
  }
  if (hold) return { tone: "held", text: hold, canInstall: false };
  return { tone: "none", text: status.currentRef ? `Up to date at ${shortRef(status.currentRef)}.` : "Up to date.", canInstall: false };
}

/** A commit's first 7 characters; anything else as it is. */
export function shortRef(ref: string | null | undefined) {
  if (!ref) return "?";
  return /^[0-9a-f]{12,}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

// ---------------------------------------------------------------------------------------------
// Comparing versions

/** The versions to compare by default: the target (or the newest) against the one before it. */
export function compareSelection(versions: readonly Pick<CompanySkillVersion, "id" | "revisionNumber">[], targetId?: string | null) {
  const sorted = [...versions].sort((a, b) => b.revisionNumber - a.revisionNumber);
  const after = (targetId ? sorted.find((version) => version.id === targetId) : null) ?? sorted[0] ?? null;
  if (!after) return { before: null, after: null };
  const before = sorted.find((version) => version.revisionNumber < after.revisionNumber) ?? null;
  return { before: before?.id ?? null, after: after.id };
}

/** Every file path in either version, SKILL.md first. */
export function comparedPaths(before: Pick<CompanySkillVersion, "fileInventory"> | null, after: Pick<CompanySkillVersion, "fileInventory"> | null) {
  const paths = new Set([...(before?.fileInventory ?? []), ...(after?.fileInventory ?? [])].map((file) => file.path));
  return [...paths].sort((a, b) => Number(b === "SKILL.md") - Number(a === "SKILL.md") || a.localeCompare(b));
}

/** How a file changed between two versions. */
export function fileChange(before: Pick<CompanySkillVersion, "fileInventory"> | null, after: Pick<CompanySkillVersion, "fileInventory"> | null, path: string) {
  const old = before?.fileInventory.find((file) => file.path === path);
  const next = after?.fileInventory.find((file) => file.path === path);
  if (!old && next) return "added" as const;
  if (old && !next) return "removed" as const;
  return old?.content === next?.content ? ("same" as const) : ("changed" as const);
}

// ---------------------------------------------------------------------------------------------
// Imports and project scans

/** Why an import address won't do, or null: a path, a GitHub address, a skills.sh link or a URL. */
export function importProblem(value: string) {
  const text = value.trim();
  if (!text) return "Paste a path or an address.";
  if (/^(\/|~\/|\.\.?\/|[A-Za-z]:[\\/])/.test(text)) return null;
  if (/^[\w.-]+\/[\w.-]+(\/.*)?$/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? null : "Use an https:// address or a folder path.";
  } catch {
    return "That isn't a path or an address.";
  }
}

export type ScanSelection = { workspaceId: string; path: string; slug?: string };

export const scanKey = (workspaceId: string, path: string) => `${workspaceId}:${path}`;

/** New skills and ones whose name is taken (imported under another name) can be picked. */
export function selectableCandidate(candidate: Pick<CompanySkillProjectScanCandidate, "status">) {
  return candidate.status === "new" || candidate.status === "conflict";
}

/** The name a clashing skill is imported under unless changed. */
export function conflictSlug(candidate: Pick<CompanySkillProjectScanCandidate, "slug">) {
  return `${candidate.slug}-copy`;
}

/** Slugs are lower case letters, numbers and single dashes. */
export function slugProblem(slug: string | undefined) {
  if (slug === undefined) return null;
  const clean = slug.trim();
  if (!clean) return "Give it a name.";
  return slugFor(clean) === clean ? null : `Use lower case letters, numbers and dashes, like ${slugFor(clean) || "my-skill"}.`;
}

const STATUS_TEXT: Record<CompanySkillProjectScanCandidate["status"], string> = {
  new: "New",
  already_imported: "Already in the library",
  conflict: "Name taken",
  skipped: "Skipped",
};

export function candidateStatus(candidate: Pick<CompanySkillProjectScanCandidate, "status">) {
  return STATUS_TEXT[candidate.status];
}

/** A browsed path's skill folder: a SKILL.md file means the folder it's in. */
export function skillFolderOf(path: string) {
  if (/^skill\.md$/i.test(path)) return ".";
  return /\/skill\.md$/i.test(path) ? path.slice(0, -"/SKILL.md".length) || "." : path;
}
