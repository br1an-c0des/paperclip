/*
 * Links into a task (`tasks/thread`, `documents-artifacts/documents`): `#comment-<id>` scrolls the
 * Activity section to that comment, and `#document-<key>` opens that document in Docs and files;
 * `#document-<key>&image=2` opens it on its second image, in the gallery (since the 2026-11-01
 * sync, upstream cd5f93055).
 * Agents write these links into comments (the paperclip skill documents them), search results carry
 * them, and the old task page followed them.
 */

/** `image` is a 1-based position in the document's gallery, or null for none. */
export type TaskAnchor = { kind: "comment"; id: string } | { kind: "document"; key: string; image: number | null };

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
  if (fragment.startsWith("document-") && fragment.length > "document-".length) {
    const [key = "", ...rest] = fragment.slice("document-".length).split("&");
    const image = new URLSearchParams(rest.join("&")).get("image");
    const position = image && /^[1-9]\d*$/.test(image) ? Number(image) : null;
    return key ? { kind: "document", key: decode(key), image: position } : null;
  }
  return null;
}

/** The fragment that opens a document, on one of its images (1-based) or none. */
export function documentAnchor(key: string, image: number | null = null) {
  return `#document-${encodeURIComponent(key)}${image ? `&image=${image}` : ""}`;
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
