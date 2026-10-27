import type { DocumentAnnotationThread } from "@paperclipai/shared";

/*
 * Annotation threads on a document's text, as the old UI shows them
 * (ui/src/components/IssueDocumentAnnotations.tsx and DocumentAnnotationPanel.tsx): which threads
 * to list and in what order, the open count, when a new comment can't be anchored, and where a
 * passage sits in the rendered text. Turning a selection into an anchor is in anchor.ts.
 */

const squash = (value: string) => value.replace(/s+/g, " ").trim();

type ThreadLike = Pick<DocumentAnnotationThread, "status" | "anchorState" | "normalizedStart" | "markdownStart" | "createdAt">;

export type ThreadFilter = "open" | "resolved" | "all";

/**
 * Threads to list, in document order. Orphaned threads lost their passage and can't be shown in
 * place, so they're left out, as in the old UI.
 */
export function visibleThreads<T extends ThreadLike>(threads: readonly T[], filter: ThreadFilter = "all"): T[] {
  return threads
    .filter((thread) => thread.anchorState !== "orphaned")
    .filter((thread) => filter === "all" || thread.status === filter)
    .sort(
      (a, b) =>
        a.normalizedStart - b.normalizedStart ||
        a.markdownStart - b.markdownStart ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

/** Unresolved threads that still point at text: the count on the document's comment button. */
export function openThreadCount(threads: readonly ThreadLike[]) {
  return threads.filter((thread) => thread.status === "open" && thread.anchorState !== "orphaned").length;
}

/** Why a new comment can't be anchored right now, or null when it can. */
export function newCommentBlock(input: { editing: boolean; viewingHistory: boolean; hasRevision: boolean }): string | null {
  if (input.viewingHistory) return "Comments go on the current revision. Return to it to comment.";
  if (input.editing) return "Save or cancel your edits to comment on the text.";
  if (!input.hasRevision) return "This document has no saved revision yet.";
  return null;
}

/** "Quoted passage…", cut at a word near `max` characters. */
export function quote(text: string, max = 140) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Where a passage sits in a container's text, as raw character offsets, for drawing its
 * highlight. Whitespace is squashed on both sides before matching, as the anchors are.
 */
export function rawSpanFor(containerText: string, passage: string): { start: number; end: number } | null {
  const needle = squash(passage);
  if (!needle) return null;
  // Map each normalized character back to its raw index.
  const map: number[] = [];
  let normalized = "";
  let pendingSpace = false;
  for (let index = 0; index < containerText.length; index += 1) {
    const char = containerText[index]!;
    if (/\s/.test(char)) {
      if (normalized.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      normalized += " ";
      map.push(index - 1);
      pendingSpace = false;
    }
    normalized += char;
    map.push(index);
  }
  const at = normalized.indexOf(needle);
  if (at === -1) return null;
  const start = map[at]!;
  const end = map[at + needle.length - 1]! + 1;
  return { start, end };
}
