import { transcriptSteps, visibleItems, type ShowOptions, type TranscriptItem } from "./transcript-model";

/*
 * Find in run (board 16's "Find in run" field): what the search reads, which folded stretches of
 * the transcript to open so their matches can show, and stepping through matches. The matches
 * themselves are found in the drawn view (find-in-run.ts), so they line up with what's on screen.
 */

/** The words a transcript item holds, as the reader can see them once it's open. */
export function itemText(item: TranscriptItem): string {
  switch (item.kind) {
    case "started":
      return `${item.model} ${item.sessionId}`;
    case "message":
    case "thinking":
    case "output":
      return item.text;
    case "tool":
      return [item.name, item.title, item.diff ? item.diff.map((line) => line.text).join("\n") : item.input, item.output ?? ""].join("\n");
    case "diff":
      return [item.file ?? "", ...item.lines.map((line) => line.text)].join("\n");
    case "note":
      return [item.label, ...item.lines].join("\n");
    case "finished":
      return item.text;
    case "outcome":
      return [item.summary, ...item.checks.map((check) => check.label), ...item.remaining, ...item.artifacts].join("\n");
  }
}

/** Whether `text` holds `query`, ignoring case. An empty query matches nothing. */
export function holds(text: string, query: string) {
  const needle = query.trim().toLowerCase();
  return needle.length > 0 && text.toLowerCase().includes(needle);
}

/**
 * The folds to open for a search: those hiding an item that matches. Fold keys don't depend on what's
 * open (transcript-model.ts), so they're read from the transcript with every fold shut.
 */
export function foldsToReveal(items: readonly TranscriptItem[], options: Omit<ShowOptions, "expanded">, query: string): Set<string> {
  const keys = new Set<string>();
  if (!query.trim()) return keys;
  for (const shown of visibleItems(transcriptSteps(items), { ...options, expanded: new Set() })) {
    if (shown.kind === "fold" && shown.items.some((item) => holds(itemText(item), query))) keys.add(shown.key);
  }
  return keys;
}

/** Where each match of `query` starts in `text`, ignoring case, without overlaps. */
export function matchOffsets(text: string, query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const haystack = text.toLowerCase();
  const offsets: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) offsets.push(at);
  return offsets;
}

/** The match `step` places from `current` (1 for next, -1 for previous), wrapping round. */
export function stepMatch(current: number, step: number, count: number) {
  if (count === 0) return -1;
  if (current < 0) return step < 0 ? count - 1 : 0;
  return (((current + step) % count) + count) % count;
}
