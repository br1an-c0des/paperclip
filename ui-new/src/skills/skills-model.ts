import type { Agent, CompanySkillCreateRequest, CompanySkillFileInventoryEntry, CompanySkillListItem, CompanySkillVersion, SkillSource } from "@paperclipai/shared";

/*
 * The Skills pages' view model, apart from the components so it can be tested: where each skill
 * comes from, Paperclip's core skills and who should have them, the library's filters, and the
 * Studio's drafts, files and versions.
 */

// ---------------------------------------------------------------------------------------------
// The pages' addresses

export type SkillsView =
  | { section: "library"; skillId: string | null }
  | { section: "sources"; sourceId: string | null }
  | { section: "studio"; skillId: string | null; creating: boolean }
  | { section: "redirect"; to: string };

/**
 * What `/:prefix/skills/<rest>` shows. The old UI's library addresses (`/skills/:skillId`, and deeper
 * ones like `/skills/:skillId/files/…`) open the library on that skill; `/skills/:skillId/studio`
 * moves to the Studio.
 */
export function skillsView(rest: string): SkillsView {
  const [first, second, third] = rest.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (!first) return { section: "library", skillId: null };
  if (first === "sources") return { section: "sources", sourceId: second ?? null };
  if (first === "studio") return second === "new" ? { section: "studio", skillId: null, creating: true } : { section: "studio", skillId: second ?? null, creating: false };
  if (second === "studio" && !third) return { section: "redirect", to: `studio/${first}` };
  return { section: "library", skillId: first };
}

// ---------------------------------------------------------------------------------------------
// Where a skill comes from

/**
 * The core Paperclip skills, as the server lists them (`PAPERCLIP_CORE_SKILL_KEYS` in
 * server/src/services/company-skills.ts): what a lead agent needs to run the company with Paperclip.
 * New companies' first agent gets them.
 */
export const CORE_SKILL_KEYS = [
  "paperclipai/paperclip/paperclip",
  "paperclipai/paperclip/paperclip-board",
  "paperclipai/paperclip/paperclip-converting-plans-to-tasks",
  "paperclipai/paperclip/paperclip-create-agent",
  "paperclipai/paperclip/para-memory-files",
] as const;

/** The operating skill itself. The Paperclip Runner carries it in its protocol, so its agents don't need it. */
export const PAPERCLIP_SKILL_KEY = "paperclipai/paperclip/paperclip";

export function isCoreSkill(key: string) {
  return (CORE_SKILL_KEYS as readonly string[]).includes(key);
}

/** Whether an agent's harness already provides this skill. */
export function providedByHarness(key: string, adapterType: string) {
  return key === PAPERCLIP_SKILL_KEY && adapterType === "paperclip_runner";
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
