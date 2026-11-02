import type {
  CompanySkillAuditResult,
  CompanySkillDetail,
  CompanySkillSharingScope,
  CompanySkillUpdateRequest,
  CompanySkillUpdateStatus,
  ProjectRepositoryOptions,
  SkillSource,
  SkillSourceScanProgress,
} from "@paperclipai/shared";
import { skillOrigin, slugFor } from "./skills-model";

/*
 * A skill's settings and checks, beyond the library's detail (skills-model.ts):
 *
 * - Settings (`PATCH …/skills/:id`): description, tagline, categories, author, homepage, icon,
 *   colour and who sees it (the organization, or only you). Public links are refused by the server
 *   ("not available in this version"), so they aren't offered.
 * - Rename (`POST …/skills/:id/rename`): only skills written here; the server moves the agents
 *   that use it onto the new key.
 * - Audit (`POST …/skills/:id/audit`): scans the installed files and records the verdict.
 * - Reset (`POST …/skills/:id/reset`): a catalog skill back to the catalog's files, discarding
 *   saved edits with `force`.
 * - A source's GitHub connection (`PATCH …/skill-sources/:id/settings { connectionId }`), and the
 *   live progress of a repository scan (`POST …/skill-sources/discover` as NDJSON).
 */

export type SharingChoice = Exclude<CompanySkillSharingScope, "public_link">;

export const SHARING_OPTIONS: readonly { value: SharingChoice; label: string; help: string }[] = [
  { value: "company", label: "Organization", help: "Everyone in the organization sees it and can give it to agents." },
  { value: "private", label: "Only me", help: "Only you see it in the library." },
];

export type SkillSettingsDraft = {
  name: string;
  description: string;
  tagline: string;
  categories: string;
  authorName: string;
  homepageUrl: string;
  iconUrl: string;
  color: string;
  sharingScope: SharingChoice;
};

type SettingsSource = Pick<CompanySkillDetail, "name" | "description" | "tagline" | "categories" | "authorName" | "homepageUrl" | "iconUrl" | "color" | "sharingScope">;

export function settingsDraft(skill: SettingsSource): SkillSettingsDraft {
  return {
    name: skill.name,
    description: skill.description ?? "",
    tagline: skill.tagline ?? "",
    categories: skill.categories.join(", "),
    authorName: skill.authorName ?? "",
    homepageUrl: skill.homepageUrl ?? "",
    iconUrl: skill.iconUrl ?? "",
    color: skill.color ?? "",
    sharingScope: skill.sharingScope === "private" ? "private" : "company",
  };
}

/** "Engineering, review ,engineering" → ["Engineering", "review"]: trimmed, no repeats (any case). */
export function parseCategories(text: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(",")) {
    const value = part.trim().replace(/\s+/g, " ");
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out;
}

const blankToNull = (value: string) => (value.trim() ? value.trim() : null);

/** The settings that changed, or null when nothing did. */
export function settingsPatch(skill: SettingsSource, draft: SkillSettingsDraft): CompanySkillUpdateRequest | null {
  const patch: CompanySkillUpdateRequest = {};
  const text = (key: "description" | "tagline" | "authorName" | "homepageUrl" | "iconUrl" | "color") => {
    const next = blankToNull(draft[key]);
    if (next !== (skill[key] ?? null)) patch[key] = next;
  };
  text("description");
  text("tagline");
  text("authorName");
  text("homepageUrl");
  text("iconUrl");
  text("color");
  const categories = parseCategories(draft.categories);
  if (categories.join("\n") !== skill.categories.join("\n")) patch.categories = categories;
  const scope = skill.sharingScope === "private" ? "private" : "company";
  if (draft.sharingScope !== scope) patch.sharingScope = draft.sharingScope;
  return Object.keys(patch).length ? patch : null;
}

/** A rename's request when the name changed: the slug follows the name, as the old Studio's does. */
export function renameRequest(skill: Pick<CompanySkillDetail, "name" | "slug" | "currentVersionId">, draft: Pick<SkillSettingsDraft, "name">) {
  const name = draft.name.trim();
  if (!name || name === skill.name) return null;
  return { name, slug: slugFor(name) || null, expectedVersionId: skill.currentVersionId };
}

export function settingsProblem(draft: SkillSettingsDraft): string | null {
  if (!draft.name.trim()) return "Name the skill.";
  if (/[\r\n]/.test(draft.name)) return "The name is one line.";
  if (!slugFor(draft.name)) return "The name needs a letter or number.";
  if (draft.tagline.trim().length > 120) return "Keep the tagline to 120 characters.";
  for (const [label, value] of [
    ["homepage", draft.homepageUrl],
    ["icon", draft.iconUrl],
  ] as const) {
    if (value.trim() && !/^https?:\/\//i.test(value.trim())) return `The ${label} is a web address (https://…).`;
  }
  return null;
}

/** Only skills written here can be renamed; the server refuses catalog, imported and scanned ones. */
export function canRename(skill: Parameters<typeof skillOrigin>[0] & Pick<CompanySkillDetail, "editable">) {
  return skillOrigin(skill) === "authored" && skill.editable;
}

/** Only catalog skills reset, to the catalog's files. */
export function canReset(skill: Pick<CompanySkillDetail, "sourceType">) {
  return skill.sourceType === "catalog";
}

/** An update held for local edits can be installed anyway, discarding them (`force`). */
export function canForceInstall(status: CompanySkillUpdateStatus | undefined) {
  return !!status?.hasUpdate && status.updateHoldReason === "local_modifications";
}

// ---------------------------------------------------------------------------------------------
// Audit

const VERDICT: Record<CompanySkillAuditResult["verdict"], { label: string; tone: "green" | "amber" | "red" }> = {
  pass: { label: "Passed", tone: "green" },
  warning: { label: "Warnings", tone: "amber" },
  fail: { label: "Failed", tone: "red" },
};

export function auditVerdict(verdict: CompanySkillAuditResult["verdict"]) {
  return VERDICT[verdict] ?? { label: verdict, tone: "amber" as const };
}

/** One line for the audit: "Passed: nothing found", "2 warnings, 1 error". */
export function auditLine(result: Pick<CompanySkillAuditResult, "verdict" | "findings">) {
  if (result.findings.length === 0) return result.verdict === "pass" ? "Nothing found." : "No details given.";
  const errors = result.findings.filter((finding) => finding.severity === "error").length;
  const warnings = result.findings.length - errors;
  return [errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : null, warnings ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}` : null].filter(Boolean).join(", ") + ".";
}

/** Whether the files changed since the origin's (the installed hash differs from the origin's). */
export function auditDrift(result: Pick<CompanySkillAuditResult, "installedHash" | "originHash">) {
  return !!result.originHash && !!result.installedHash && result.originHash !== result.installedHash;
}

// ---------------------------------------------------------------------------------------------
// A source's GitHub connection

export type ConnectionChoice = { id: string; name: string };

const repoKey = (url: string) =>
  url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");

/**
 * The connections that can read this repository, from what the person's GitHub connections list
 * (`GET …/skill-sources/repositories`). The server checks the pick again on every request.
 */
export function connectionChoices(options: ProjectRepositoryOptions | undefined, repositoryUrl: string): ConnectionChoice[] {
  if (!options) return [];
  const names = new Map((options.connections ?? []).map((connection) => [connection.id, connection.name]));
  const repo = options.repositories.find((entry) => repoKey(entry.url) === repoKey(repositoryUrl) || entry.fullName.toLowerCase() === repoKey(repositoryUrl));
  const ids = repo?.connectionIds ?? [];
  return ids.map((id, index) => ({ id, name: names.get(id) ?? repo?.connections[index] ?? "GitHub connection" }));
}

/** Every connection the person has, for a source whose repository isn't listed (private, or moved). */
export function allConnections(options: ProjectRepositoryOptions | undefined): ConnectionChoice[] {
  return (options?.connections ?? []).map((connection) => ({ id: connection.id, name: connection.name }));
}

/** Whether a failing source should offer a connection choice, as the old page does. */
export function needsConnection(source: Pick<SkillSource, "lastError" | "repairAction" | "connectionId">) {
  return !!source.lastError && (source.repairAction === "connection" || (!source.repairAction && !source.connectionId));
}

// ---------------------------------------------------------------------------------------------
// Live scan progress

/** "Downloading the repository: 40%", "Checking skill 3 of 12: tools/lint". */
export function scanProgressLine(progress: SkillSourceScanProgress | null) {
  if (!progress) return "Reading the repository…";
  switch (progress.phase) {
    case "connecting":
      return "Connecting to GitHub…";
    case "downloading":
      return progress.download ? `Downloading the repository: ${Math.round(progress.download.percent)}%` : "Downloading the repository…";
    case "listing":
      return "Looking for skills…";
    case "checking": {
      const of = progress.totalSkills ? ` of ${progress.totalSkills}` : "";
      return `Checking skill ${Math.min(progress.checkedSkills + 1, progress.totalSkills ?? Infinity)}${of}${progress.currentPath ? `: ${progress.currentPath}` : ""}`;
    }
    default:
      return "Reading the repository…";
  }
}

/** A fraction for a meter while the scan reports one, else null. */
export function scanFraction(progress: SkillSourceScanProgress | null) {
  if (!progress) return null;
  if (progress.phase === "downloading" && progress.download) return Math.max(0, Math.min(1, progress.download.percent / 100));
  if (progress.phase === "checking" && progress.totalSkills) return Math.max(0, Math.min(1, progress.checkedSkills / progress.totalSkills));
  return null;
}
