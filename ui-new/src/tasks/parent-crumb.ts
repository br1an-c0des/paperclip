import type { Issue } from "@paperclipai/shared";

/*
 * The parent task in the task header (U104), after the old UI's breadcrumbs (#20366,
 * ui/src/components/BreadcrumbBar.tsx, IssueDetail.tsx): only the immediate parent, its title cut
 * to 48 characters (counted as code points, so an emoji isn't split) with the whole title kept for
 * hover and screen readers, and a private parent shown as a lock with its number and no link. The
 * Details "Parent" row (TaskEditors.tsx `ParentControl`) stays where the parent is changed.
 */

/** How many characters of the parent's title the header shows, the old UI's limit. */
export const PARENT_TITLE_LIMIT = 48;

/** The title cut to `limit` characters, ending in an ellipsis when it was longer. */
export function truncateTitle(title: string, limit = PARENT_TITLE_LIMIT) {
  const characters = Array.from(title);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : title;
}

export type ParentCrumb =
  | { kind: "link"; id: string; identifier: string | null; title: string; label: string }
  | { kind: "locked"; id: string; identifier: string | null };

/**
 * The header's parent for a task: its immediate parent from the detail's `ancestors` (nearest
 * first), or nothing for a top-level task. A private parent may come as `{ id, identifier,
 * locked: true }`, which shows only as a lock (the old UI's `isLockedIssueStub`).
 */
export function parentCrumb(task: Pick<Issue, "parentId" | "ancestors"> | undefined): ParentCrumb | null {
  if (!task?.parentId) return null;
  const ancestors = task.ancestors ?? [];
  const parent = ancestors.find((ancestor) => ancestor.id === task.parentId) ?? ancestors[0];
  if (!parent) return null;
  if ((parent as { locked?: unknown }).locked === true || typeof parent.title !== "string") {
    return { kind: "locked", id: parent.id, identifier: parent.identifier ?? null };
  }
  const title = parent.title.trim() || parent.identifier || "Untitled task";
  return { kind: "link", id: parent.id, identifier: parent.identifier ?? null, title, label: truncateTitle(title) };
}

/** The parent's accessible name: its whole title and its number, as the old UI labels the crumb. */
export function parentLabel(crumb: ParentCrumb) {
  if (crumb.kind === "locked") return `Parent task ${crumb.identifier ?? ""}, private, you don't have access`.replace(" ,", ",");
  return `Parent task: ${[crumb.title, crumb.identifier].filter(Boolean).join(" ")}`;
}
