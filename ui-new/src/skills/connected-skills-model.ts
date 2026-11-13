import type { CompanyMcpSkill } from "@paperclipai/shared";
import { formatBytes } from "@/runs/run-model";
import type { Tone } from "@/ui/Status";

/*
 * Connected app skills (U137, upstream #21219): the pure parts of the review list in the Library,
 * as the old UI's ConnectedAppSkills words them. Each skill a connected app publishes is
 * `pending_review` until the board approves it against its manifest digest, `approved`, `declined`,
 * or `unavailable` (removed, too large, invalid, or generated on demand, so its content can't be
 * checked). A changed skill comes back to review with the reason `changed`.
 */

export const STATUS_LABEL: Record<CompanyMcpSkill["status"], string> = {
  pending_review: "Needs review",
  approved: "Approved",
  declined: "Declined",
  unavailable: "Not available",
};

export const STATUS_TONE: Record<CompanyMcpSkill["status"], Tone> = {
  pending_review: "amber",
  approved: "green",
  declined: "red",
  unavailable: "violet",
};

/** Why the skill is in its state, in plain words, or null when the status says enough. */
export function connectedSkillNote(skill: Pick<CompanyMcpSkill, "appName" | "statusReason">): string | null {
  switch (skill.statusReason) {
    case "changed":
      return `${skill.appName} changed this skill. Agents won't use it until you approve the new version.`;
    case "dynamic":
      return "This skill is generated each time it's used, so Paperclip can't check its content. It isn't offered to agents.";
    case "too_large":
      return "This skill is bigger than apps can rely on (512 files or 16 MiB), so it isn't offered to agents.";
    case "invalid":
      return "This skill's listing doesn't follow the MCP skills format, so it isn't offered to agents.";
    case "verification_failed":
      return `${skill.appName} sent files that didn't match what it listed, so Paperclip stopped using this skill. Refresh the app to see its current version.`;
    case "removed":
      return `${skill.appName} no longer offers this skill.`;
    default:
      return null;
  }
}

/** Waiting for review or declined: the board can approve it (again). */
export function reviewable(skill: Pick<CompanyMcpSkill, "status">) {
  return skill.status === "pending_review" || skill.status === "declined";
}

/** "3 files · 12.4 KB", or null when the size isn't known (a generated skill). */
export function sizeLine(skill: Pick<CompanyMcpSkill, "fileCount" | "totalBytes">): string | null {
  if (skill.fileCount === null || skill.totalBytes === null) return null;
  return `${skill.fileCount === 1 ? "1 file" : `${skill.fileCount} files`} · ${formatBytes(skill.totalBytes)}`;
}

/** "2 waiting for review", or null when none waits. */
export function waitingLine(skills: readonly Pick<CompanyMcpSkill, "status">[]): string | null {
  const waiting = skills.filter((skill) => skill.status === "pending_review").length;
  return waiting > 0 ? `${waiting} waiting for review` : null;
}

/** Waiting ones first, then approved, declined and unavailable; by name within each. */
export function sortConnectedSkills<T extends Pick<CompanyMcpSkill, "status" | "name" | "appName">>(skills: readonly T[]): T[] {
  const order: Record<CompanyMcpSkill["status"], number> = { pending_review: 0, approved: 1, declined: 2, unavailable: 3 };
  return [...skills].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name) || a.appName.localeCompare(b.appName));
}

export type SkillPreview = { skillId: string; manifestDigest?: string; markdown?: string; loading: boolean; error?: string };

/**
 * Whether the instructions shown are the skill's current version. Text read for an older manifest
 * is never shown as this one, and while it's open the board can't approve until the current text
 * has loaded. A skill that isn't open can be approved as listed.
 */
export function previewCurrent(skill: Pick<CompanyMcpSkill, "id" | "manifestDigest">, preview: SkillPreview | null): boolean {
  if (!preview || preview.skillId !== skill.id) return true;
  return Boolean(preview.markdown !== undefined && preview.manifestDigest && preview.manifestDigest === skill.manifestDigest);
}

/** Approve only a skill the board can review, with a digest to bind to, when nothing else is in flight. */
export function canApprove(skill: Pick<CompanyMcpSkill, "id" | "status" | "manifestDigest">, preview: SkillPreview | null, busy: boolean) {
  return reviewable(skill) && Boolean(skill.manifestDigest) && !busy && previewCurrent(skill, preview);
}
