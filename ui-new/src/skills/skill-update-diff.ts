import type { SkillSourceUpdateDiff, SkillSourceUpdateDiffFile } from "@paperclipai/shared";
import { shortRef } from "./skills-model";

/*
 * "What changed" for a pending skill update (U88, upstream #20155): `GET …/skills/:id/update-diff`
 * returns each file that differs between the installed and the latest tracked GitHub revisions,
 * with a unified line diff ("-" installed, "+" latest). This reads that diff into rows with their
 * line numbers, and words what the view says around it. SkillUpdateDiff.tsx draws it.
 */

export type PatchRowKind = "add" | "remove" | "context" | "hunk" | "note";

export interface PatchRow {
  kind: PatchRowKind;
  /** The line without its leading "+", "-" or " "; a hunk header or note as it is. */
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * A unified diff's rows. Hunk headers set the line numbers; "\ No newline at end of file" stays a
 * note under the line it belongs to. An empty diff (only the executable bit changed) has no rows.
 */
export function parsePatch(diff: string | null): { rows: PatchRow[]; added: number; removed: number } {
  const rows: PatchRow[] = [];
  let added = 0;
  let removed = 0;
  if (!diff) return { rows, added, removed };
  let oldLine = 1;
  let newLine = 1;
  for (const line of diff.replace(/\r?\n$/, "").split(/\r?\n/)) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      // A side with no lines names the line before the hunk; its first line is the next one.
      if (/^@@ -\d+,0 /.test(line)) oldLine += 1;
      if (/ \+\d+,0 @@/.test(line)) newLine += 1;
      rows.push({ kind: "hunk", text: line, oldLine: null, newLine: null });
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", text: line.slice(1), oldLine: null, newLine: newLine++ });
      added += 1;
    } else if (line.startsWith("-")) {
      rows.push({ kind: "remove", text: line.slice(1), oldLine: oldLine++, newLine: null });
      removed += 1;
    } else if (line.startsWith("\\")) {
      rows.push({ kind: "note", text: line.slice(1).trim(), oldLine: null, newLine: null });
    } else {
      rows.push({ kind: "context", text: line.startsWith(" ") ? line.slice(1) : line, oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return { rows, added, removed };
}

export const CHANGE_LABEL: Record<SkillSourceUpdateDiffFile["change"], string> = {
  added: "added",
  removed: "removed",
  modified: "changed",
  not_compared: "not compared",
};

/** Why a file has no line diff to show, or what else changed about it; null when the diff says it all. */
export function fileNote(file: SkillSourceUpdateDiffFile): string | null {
  const mode = file.executableChanged ? "Its executable permission changed." : null;
  if (file.diff === "") return mode ?? "No line changes.";
  if (file.diff !== null) return mode;
  const why: Record<NonNullable<SkillSourceUpdateDiffFile["diffUnavailable"]>, string> = {
    binary: "A binary file, so there's no line diff.",
    too_large: "Too large to compare line by line.",
    omitted: "Left out of one of the revisions (too large, a link, or held back by the safety check), so it can't be compared.",
    budget: "Not shown: the comparison reached its size limit.",
  };
  return [file.diffUnavailable ? why[file.diffUnavailable] : "No line diff is available.", mode].filter(Boolean).join(" ");
}

/** "abc1234 → def5678" for the dialog's description; null when either side is unknown. */
export function revisionRange(result: Pick<SkillSourceUpdateDiff, "currentRef" | "latestRef"> | undefined) {
  if (!result?.currentRef || !result.latestRef) return null;
  return `${shortRef(result.currentRef)} → ${shortRef(result.latestRef)}`;
}

export type DiffView =
  | { kind: "unsupported"; text: string }
  | { kind: "current"; text: string }
  | { kind: "same"; text: string }
  | { kind: "files"; summary: string; added: number; removed: number; truncated: string | null };

/** What the view shows for a response: a reason, "nothing to update", or the files and their totals. */
export function diffView(result: SkillSourceUpdateDiff): DiffView {
  if (!result.supported) return { kind: "unsupported", text: result.reason ?? "This skill's update can't be compared file by file." };
  if (!result.hasUpdate) return { kind: "current", text: `The installed revision is already the latest${result.latestRef ? ` (${shortRef(result.latestRef)})` : ""}. There's nothing to update.` };
  if (!result.files.length) return { kind: "same", text: "The newer revision changes nothing in this skill's files." };
  let added = 0;
  let removed = 0;
  for (const file of result.files) {
    const counts = parsePatch(file.diff);
    added += counts.added;
    removed += counts.removed;
  }
  const count = result.files.length;
  return {
    kind: "files",
    summary: `${count === 1 ? "1 file" : `${count} files`} changed`,
    added,
    removed,
    truncated: result.truncated ? "The update is too large to show in full: some files are missing or have no diff." : null,
  };
}
