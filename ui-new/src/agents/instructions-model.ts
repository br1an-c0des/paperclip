import type { AgentInstructionCandidate, AgentInstructionsBundle, AgentInstructionsFileSummary } from "@paperclipai/shared";
import type { InstructionsBundleUpdate } from "@/api/agents";

/*
 * The Instructions section's pure parts (board 27): the file list as a tree with the entry file
 * first, a line diff for a change a run suggested, the checks for a new file's path, and the bundle
 * settings' draft.
 */

export type DiffLine = { kind: "same" | "add" | "remove"; text: string };

/** A line diff from `before` to `after` (longest common subsequence; fine for instruction files). */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1]! + 1 : Math.max(table[(i + 1) * cols + j]!, table[i * cols + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + j + 1]!) {
      out.push({ kind: "remove", text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) out.push({ kind: "remove", text: a[i++]! });
  while (j < b.length) out.push({ kind: "add", text: b[j++]! });
  return out;
}

/** The changed lines with up to `context` unchanged lines around them; gaps become null. */
export function diffHunks(lines: readonly DiffLine[], context = 2): (DiffLine | null)[] {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) keep.add(k);
  });
  const out: (DiffLine | null)[] = [];
  let last = -1;
  for (const index of [...keep].sort((x, y) => x - y)) {
    if (last >= 0 && index > last + 1) out.push(null);
    out.push(lines[index]!);
    last = index;
  }
  return out;
}

/** "adds 1 line", "adds 3 lines, removes 1". */
export function diffSummary(lines: readonly DiffLine[]) {
  const added = lines.filter((line) => line.kind === "add").length;
  const removed = lines.filter((line) => line.kind === "remove").length;
  const plural = (count: number) => (count === 1 ? "1 line" : `${count} lines`);
  const parts = [added ? `adds ${plural(added)}` : "", removed ? `removes ${plural(removed)}` : ""].filter(Boolean);
  return parts.join(", ") || "no line changes";
}

export type FileRow =
  | { kind: "folder"; path: string; name: string; depth: number }
  | { kind: "file"; path: string; name: string; depth: number; file: AgentInstructionsFileSummary };

/** The files as a tree: the entry file first, then top-level files, then folders with their files. */
export function fileRows(files: readonly AgentInstructionsFileSummary[]): FileRow[] {
  const sorted = [...files].sort((a, b) => {
    if (a.isEntryFile !== b.isEntryFile) return a.isEntryFile ? -1 : 1;
    const aDepth = a.path.split("/").length;
    const bDepth = b.path.split("/").length;
    if ((aDepth === 1) !== (bDepth === 1)) return aDepth === 1 ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  const rows: FileRow[] = [];
  const seen = new Set<string>();
  for (const file of sorted) {
    const parts = file.path.split("/");
    for (let depth = 0; depth < parts.length - 1; depth += 1) {
      const folder = parts.slice(0, depth + 1).join("/");
      if (seen.has(folder)) continue;
      seen.add(folder);
      rows.push({ kind: "folder", path: folder, name: parts[depth]!, depth });
    }
    rows.push({ kind: "file", path: file.path, name: parts[parts.length - 1]!, depth: parts.length - 1, file });
  }
  return rows;
}

/** "6 files · 9.4 KB". */
export function bundleSize(files: readonly AgentInstructionsFileSummary[]) {
  const bytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  const size = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
  return `${files.length === 1 ? "1 file" : `${files.length} files`} · ${size}`;
}

/** Why a new file's path can't be used, or null. Paths are relative, end in a known text extension, and don't climb out. */
export function newFileProblem(path: string, existing: readonly { path: string }[]): string | null {
  const value = path.trim();
  if (!value) return "Name the file, such as TOOLS.md or research/sources.md.";
  if (value.startsWith("/") || value.split("/").some((part) => part === ".." || part === "." || part === "")) return "Use a relative path inside the instructions folder.";
  if (!/\.(md|markdown|txt|json|ya?ml)$/i.test(value)) return "Use a text file: .md, .txt, .json or .yaml.";
  if (existing.some((file) => file.path === value)) return `${value} already exists.`;
  return null;
}

export type BundleDraft = { mode: "managed" | "external"; rootPath: string; entryFile: string };

/** The bundle settings as saved. A managed bundle's folder is Paperclip's own. */
export function bundleDraft(bundle: Pick<AgentInstructionsBundle, "mode" | "rootPath" | "managedRootPath" | "entryFile">): BundleDraft {
  const mode = bundle.mode ?? "managed";
  return { mode, rootPath: mode === "external" ? (bundle.rootPath ?? "") : bundle.managedRootPath, entryFile: bundle.entryFile || "AGENTS.md" };
}

/** Why the draft can't be saved, or null. An external folder is an absolute path; the entry file is relative. */
export function bundleProblem(draft: BundleDraft): string | null {
  if (draft.mode === "external" && !/^(\/|[A-Za-z]:[\\/]|~\/)/.test(draft.rootPath.trim())) return "Give the folder as an absolute path, such as /srv/agents/prompts.";
  const entry = draft.entryFile.trim();
  if (!entry) return "Name the entry file, such as AGENTS.md.";
  if (entry.startsWith("/") || entry.split("/").some((part) => part === ".." || part === "")) return "The entry file is a path inside the folder.";
  return null;
}

/** The `PATCH /agents/:id/instructions-bundle` body, or null when nothing changed. */
export function bundleUpdate(saved: BundleDraft, draft: BundleDraft): InstructionsBundleUpdate | null {
  const entryFile = draft.entryFile.trim();
  const rootPath = draft.rootPath.trim();
  if (draft.mode === saved.mode && entryFile === saved.entryFile && (draft.mode === "managed" || rootPath === saved.rootPath)) return null;
  return { mode: draft.mode, rootPath: draft.mode === "external" ? rootPath : null, entryFile };
}

/** Suggested changes a person can act on: the per-run preserved edits, not whole-folder failures. */
export function actionableCandidates(candidates: readonly AgentInstructionCandidate[] | undefined) {
  return (candidates ?? []).filter((candidate) => candidate.contract !== "agent_files" && candidate.content !== null);
}
