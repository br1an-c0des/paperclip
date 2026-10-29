/*
 * Links into a task (`tasks/thread`, `documents-artifacts/documents`): `#comment-<id>` scrolls the
 * Activity section to that comment, and `#document-<key>` opens that document in Docs and files.
 * Agents write these links into comments (the paperclip skill documents them), search results carry
 * them, and the old task page followed them.
 */

export type TaskAnchor = { kind: "comment"; id: string } | { kind: "document"; key: string };

function decode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** What a page fragment points at, or null for any other fragment. */
export function parseTaskAnchor(hash: string | null | undefined): TaskAnchor | null {
  if (!hash) return null;
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment.startsWith("comment-") && fragment.length > "comment-".length) return { kind: "comment", id: decode(fragment.slice("comment-".length)) };
  if (fragment.startsWith("document-") && fragment.length > "document-".length) return { kind: "document", key: decode(fragment.slice("document-".length)) };
  return null;
}

/** The section an anchor opens. */
export function anchorSection(anchor: TaskAnchor) {
  return anchor.kind === "comment" ? "activity" : "files";
}

/** The element id a comment is drawn with, so the page can scroll to it. */
export function commentElementId(commentId: string) {
  return `comment-${commentId}`;
}

/** Whether the reader is close enough to the foot of the thread to follow new entries as they come. */
export function nearBottom(scroll: { scrollTop: number; scrollHeight: number; clientHeight: number }, slack = 160) {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= slack;
}
