import type { ProjectIconName, ProjectStatus } from "@paperclipai/shared";

/*
 * New project's form (board N1): what the dialog holds, what's missing before it can be created, and
 * the create request it becomes. Every field maps to `createProjectSchema` in
 * packages/shared/src/validators/project.ts:
 *
 * - the tile: one of eight colors (`color`, the gradient's first stop as hex) and either the name's
 *   first letter (no `icon`) or one of fifteen icons;
 * - name and description;
 * - status (Backlog, Planned, In progress), lead agent, visibility and target date;
 * - code: GitHub repositories from the company's connections (`repositoryIds`, the first becomes
 *   primary), a folder on the server (a primary `local_path` workspace), or none.
 *
 * A private project's members are added once it exists (`POST /projects/:id/access-members`); the
 * person creating it is its owner and always has access.
 */

export type CodeSource = "github" | "local" | "none";
export type Member = { kind: "agent" | "user"; id: string };
export type NewProjectStatus = Extract<ProjectStatus, "backlog" | "planned" | "in_progress">;

export type NewProjectDraft = {
  name: string;
  description: string;
  color: string;
  /** Null shows the name's first letter. */
  icon: ProjectIconName | null;
  status: NewProjectStatus;
  leadAgentId: string | null;
  visibility: "open" | "private";
  members: Member[];
  /** `YYYY-MM-DD`, or empty. */
  targetDate: string;
  source: CodeSource;
  /** GitHub repository ids in order; the first is the primary. */
  repositoryIds: string[];
  folder: string;
};

/** The board's eight tile colors, as 160deg disc gradients. The first stop is what's saved. */
export const TILE_COLORS: { name: string; stops: [string, string] }[] = [
  { name: "Amber", stops: ["#f7b52f", "#f5822a"] },
  { name: "Red", stops: ["#f2286f", "#f2272c"] },
  { name: "Pink", stops: ["#ff2bd6", "#8b2cf0"] },
  { name: "Violet", stops: ["#8b2cf0", "#1f6fe0"] },
  { name: "Blue", stops: ["#3b3df5", "#22b5a5"] },
  { name: "Teal", stops: ["#22b5a5", "#4c7896"] },
  { name: "Green", stops: ["#2fd12f", "#22b5a5"] },
  { name: "Gray", stops: ["#c9c9cf", "#8f8c86"] },
];

/** The board's fifteen icons, all in `PROJECT_ICON_NAMES` (its "chart" isn't, so "rocket" stands in). */
export const TILE_ICONS: { value: ProjectIconName; label: string }[] = [
  { value: "folder", label: "Folder" },
  { value: "rocket", label: "Rocket" },
  { value: "code", label: "Code" },
  { value: "terminal", label: "Terminal" },
  { value: "database", label: "Database" },
  { value: "globe", label: "Globe" },
  { value: "package", label: "Package" },
  { value: "layers", label: "Layers" },
  { value: "briefcase", label: "Briefcase" },
  { value: "compass", label: "Compass" },
  { value: "target", label: "Target" },
  { value: "flame", label: "Flame" },
  { value: "zap", label: "Lightning" },
  { value: "bug", label: "Bug" },
  { value: "lightbulb", label: "Light bulb" },
];

export const NEW_PROJECT_STATUSES: { value: NewProjectStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In progress" },
];

/** A saved project color as a disc gradient: the board's pair when it's one of them. */
export function tileGradient(color: string | null | undefined) {
  if (!color) return null;
  const known = TILE_COLORS.find((entry) => entry.stops[0].toLowerCase() === color.toLowerCase());
  const [from, to] = known?.stops ?? [color, `color-mix(in srgb, ${color} 60%, #000)`];
  return `linear-gradient(160deg, ${from}, ${to})`;
}

/** New projects start Planned, as the old dialog makes them, on a color picked at random. */
export function emptyProjectDraft(seed: Partial<NewProjectDraft> = {}, random: () => number = Math.random): NewProjectDraft {
  return {
    name: "",
    description: "",
    color: TILE_COLORS[Math.floor(random() * TILE_COLORS.length)]!.stops[0],
    icon: null,
    status: "planned",
    leadAgentId: null,
    visibility: "open",
    members: [],
    targetDate: "",
    source: "none",
    repositoryIds: [],
    folder: "",
    ...seed,
  };
}

/** Why the draft can't be created yet, or null. */
export function projectProblem(draft: NewProjectDraft): string | null {
  if (!draft.name.trim()) return "Give the project a name.";
  if (draft.source === "local" && !draft.folder.trim()) return "Enter the folder on the server, or choose None.";
  if (draft.source === "github" && draft.repositoryIds.length === 0) return "Add a repository, or choose None.";
  if (draft.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.targetDate)) return "The target date isn't a date.";
  return null;
}

/** The create request. Fields left at their defaults are left out. */
export function buildProjectPayload(draft: NewProjectDraft, idempotencyKey?: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: draft.name.trim(),
    status: draft.status,
    visibility: draft.visibility,
    color: draft.color,
  };
  const description = draft.description.trim();
  if (description) payload.description = description;
  if (draft.icon) payload.icon = draft.icon;
  if (draft.leadAgentId) payload.leadAgentId = draft.leadAgentId;
  if (draft.targetDate) payload.targetDate = draft.targetDate;
  if (draft.source === "github" && draft.repositoryIds.length > 0) payload.repositoryIds = [...draft.repositoryIds];
  if (draft.source === "local" && draft.folder.trim()) {
    payload.workspace = { sourceType: "local_path", cwd: draft.folder.trim(), isPrimary: true };
  }
  if (idempotencyKey) payload.idempotencyKey = idempotencyKey;
  return payload;
}

/** The members to add after creating a private project; none for an open one. You're the owner already. */
export function membersToAdd(draft: Pick<NewProjectDraft, "visibility" | "members">, youId: string | null) {
  if (draft.visibility !== "private") return [];
  return draft.members.filter((member) => !(member.kind === "user" && member.id === youId));
}
