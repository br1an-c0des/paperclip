import type { TranscriptEntry } from "@paperclipai/adapter-utils";

/*
 * The run modal's Transcript view (board 16): transcript entries grouped into what the board draws.
 *
 * - The start of the run, the agent's messages, thinking, and tool calls paired with their results.
 * - Diffs, notes (stderr, system lines and the harness's events), the finish line and the outcome.
 * - Long stretches of steps between two messages fold behind "Show N more steps", with a summary
 *   such as "read 6 files · ran 4 commands · edited 2 files".
 * - The Thinking and Tool calls chips hide those kinds of item.
 *
 * Every item has a stable `key` (from where it starts), so a live transcript can be reconciled in
 * place as entries stream in and open details stay open. Normalisation follows the old UI's
 * `normalizeTranscript` (ui/src/components/transcript/RunTranscriptView.tsx).
 */

export type StepKind = "read" | "command" | "edit" | "search" | "web" | "task" | "other";

export type DiffLine = { type: "add" | "remove" | "context" | "hunk" | "file"; text: string };

export type TranscriptItem =
  | { kind: "started"; key: string; ts: string; model: string; sessionId: string }
  | { kind: "message"; key: string; ts: string; role: "assistant" | "user"; text: string; streaming: boolean }
  | { kind: "thinking"; key: string; ts: string; endTs: string; text: string; streaming: boolean }
  | {
      kind: "tool";
      key: string;
      ts: string;
      endTs: string | null;
      name: string;
      step: StepKind;
      title: string;
      input: string;
      output: string | null;
      status: "running" | "done" | "error";
      /** For edits: the change as diff lines, and how many lines it adds and removes. */
      diff: DiffLine[] | null;
      added: number;
      removed: number;
    }
  | { kind: "diff"; key: string; ts: string; file: string | null; lines: DiffLine[]; added: number; removed: number }
  | { kind: "note"; key: string; ts: string; tone: "info" | "warn" | "error"; label: string; lines: string[] }
  | {
      kind: "finished";
      key: string;
      ts: string;
      isError: boolean;
      text: string;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      costUsd: number;
    }
  | {
      kind: "outcome";
      key: string;
      ts: string;
      disposition: string;
      summary: string;
      checks: { label: string; passed: boolean | null }[];
      remaining: string[];
      artifacts: string[];
    }
  | { kind: "output"; key: string; ts: string; text: string };

export type FoldItem = {
  kind: "fold";
  key: string;
  ts: string;
  endTs: string;
  items: TranscriptItem[];
  summary: string;
};

export type ShownItem = TranscriptItem | FoldItem;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const compact = (value: string) => value.replace(/\s+/g, " ").trim();

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function pretty(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** `bash -lc '…'` and `cmd /c …` wrappers add nothing to the title. */
function stripShell(command: string) {
  const trimmed = compact(command);
  const wrapped = trimmed.match(/^(?:(?:\/bin\/)?(?:zsh|bash|sh)|cmd(?:\.exe)?(?:\s+\/[dsc])*)\s+(?:-lc|-c|\/c)\s+(.+)$/i);
  const inner = wrapped?.[1] ?? trimmed;
  const quoted = inner.match(/^(['"])([\s\S]*)\1$/);
  return compact(quoted?.[2] ?? inner);
}

/** What kind of step a tool call is, from its name and input, for the fold summary and icon. */
export function stepKind(name: string, input: unknown): StepKind {
  const n = name.toLowerCase().replace(/^mcp__[^_]+__/, "");
  if (/(^|_)(bash|shell|exec|command|run_command|terminal|powershell)/.test(n) || n === "command_execution") return "command";
  if (/(edit|write|patch|replace|create_file|str_replace|notebookedit)/.test(n)) return "edit";
  if (/(^|_)(read|view|open|cat)(_|$)|read_file|^read/.test(n)) return "read";
  if (/(grep|glob|search|find|^ls$|list_dir|list_files)/.test(n)) return n.includes("web") ? "web" : "search";
  if (/(web|fetch|http|browser|url)/.test(n)) return "web";
  if (/(task|agent|todo)/.test(n)) return "task";
  const fields = record(input);
  if (fields && (typeof fields.command === "string" || typeof fields.cmd === "string")) return "command";
  return "other";
}

/** The short line beside a tool's name: its command, file, pattern or query. */
export function toolTitle(name: string, input: unknown): string {
  if (typeof input === "string") return truncate(stepKind(name, input) === "command" ? stripShell(input) : compact(input), 140);
  const fields = record(input);
  if (!fields) return "";
  const command = typeof fields.command === "string" ? fields.command : typeof fields.cmd === "string" ? fields.cmd : null;
  if (command) return truncate(stripShell(command), 140);
  for (const key of ["file_path", "filePath", "path", "notebook_path", "pattern", "query", "url", "description", "prompt", "title", "name"]) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) return truncate(compact(value), 140);
  }
  if (Array.isArray(fields.command)) return truncate(fields.command.filter((part) => typeof part === "string").join(" "), 140);
  const keys = Object.keys(fields);
  return keys.length === 0 ? "" : truncate(keys.slice(0, 3).join(", "), 140);
}

const lineCount = (text: string) => (text ? text.replace(/\n$/, "").split("\n").length : 0);

/** For an edit or write: the change as diff lines. */
export function editDiff(input: unknown): { lines: DiffLine[]; added: number; removed: number } | null {
  const fields = record(input);
  if (!fields) return null;
  const before = typeof fields.old_string === "string" ? fields.old_string : typeof fields.oldString === "string" ? fields.oldString : null;
  const after = typeof fields.new_string === "string" ? fields.new_string : typeof fields.newString === "string" ? fields.newString : null;
  if (before !== null && after !== null) {
    const removed = before ? before.replace(/\n$/, "").split("\n") : [];
    const added = after ? after.replace(/\n$/, "").split("\n") : [];
    return {
      lines: [...removed.map((text) => ({ type: "remove" as const, text })), ...added.map((text) => ({ type: "add" as const, text }))],
      added: added.length,
      removed: removed.length,
    };
  }
  if (typeof fields.content === "string" && (typeof fields.file_path === "string" || typeof fields.path === "string")) {
    const lines = fields.content.replace(/\n$/, "").split("\n");
    return { lines: lines.map((text) => ({ type: "add" as const, text })), added: lineCount(fields.content), removed: 0 };
  }
  return null;
}

const DIFF_TYPES: Record<string, DiffLine["type"]> = {
  add: "add",
  remove: "remove",
  context: "context",
  hunk: "hunk",
  file_header: "file",
  truncation: "context",
};

/** Lines that only say a turn began carry nothing for a reader. */
const QUIET_SYSTEM = /^turn started$/i;

export function buildItems(entries: readonly TranscriptEntry[], streaming: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const openTools = new Map<string, Extract<TranscriptItem, { kind: "tool" }>>();
  const counts = new Map<string, number>();
  // Keys from where an item starts, plus a counter for items that start at the same moment.
  const keyFor = (kind: string, ts: string) => {
    const base = `${kind}:${ts}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return n === 1 ? base : `${base}:${n}`;
  };

  for (const entry of entries) {
    const last = items[items.length - 1];
    switch (entry.kind) {
      case "init":
        items.push({ kind: "started", key: keyFor("started", entry.ts), ts: entry.ts, model: entry.model, sessionId: entry.sessionId });
        break;
      case "assistant":
      case "user": {
        const live = streaming && entry.kind === "assistant" && entry.delta === true;
        if (last?.kind === "message" && last.role === entry.kind) {
          last.text += last.text.endsWith("\n") || entry.text.startsWith("\n") ? entry.text : `\n\n${entry.text}`;
          last.streaming = last.streaming || live;
        } else {
          items.push({ kind: "message", key: keyFor("message", entry.ts), ts: entry.ts, role: entry.kind, text: entry.text, streaming: live });
        }
        break;
      }
      case "thinking": {
        const live = streaming && entry.delta === true;
        if (last?.kind === "thinking") {
          last.text += last.text.endsWith("\n") || entry.text.startsWith("\n") ? entry.text : `\n${entry.text}`;
          last.endTs = entry.ts;
          last.streaming = last.streaming || live;
        } else {
          items.push({ kind: "thinking", key: keyFor("thinking", entry.ts), ts: entry.ts, endTs: entry.ts, text: entry.text, streaming: live });
        }
        break;
      }
      case "tool_call": {
        const id = entry.toolUseId ?? entry.invocationId ?? null;
        const open = id ? openTools.get(id) : undefined;
        // Streaming harnesses re-send a call as it progresses: fold the update in.
        if (open && open.status === "running") {
          if (entry.input !== null && entry.input !== undefined) {
            open.input = pretty(entry.input);
            open.title = toolTitle(open.name, entry.input) || open.title;
            const diff = editDiff(entry.input);
            if (diff) Object.assign(open, { diff: diff.lines, added: diff.added, removed: diff.removed });
          }
          break;
        }
        const diff = editDiff(entry.input);
        const item: Extract<TranscriptItem, { kind: "tool" }> = {
          kind: "tool",
          key: id ? `tool:${id}` : keyFor("tool", entry.ts),
          ts: entry.ts,
          endTs: null,
          name: entry.name,
          step: stepKind(entry.name, entry.input),
          title: toolTitle(entry.name, entry.input),
          input: pretty(entry.input),
          output: null,
          status: "running",
          diff: diff?.lines ?? null,
          added: diff?.added ?? 0,
          removed: diff?.removed ?? 0,
        };
        items.push(item);
        if (id) openTools.set(id, item);
        break;
      }
      case "tool_result": {
        const matched =
          openTools.get(entry.toolUseId) ??
          [...items].reverse().find((item): item is Extract<TranscriptItem, { kind: "tool" }> => item.kind === "tool" && item.status === "running");
        if (matched) {
          matched.output = entry.delta && matched.output ? matched.output + entry.content : entry.content;
          if (!entry.delta) {
            matched.status = entry.isError ? "error" : "done";
            matched.endTs = entry.ts;
            openTools.delete(entry.toolUseId);
          }
        } else {
          const name = entry.toolName ?? "Tool";
          items.push({
            kind: "tool",
            key: `tool:${entry.toolUseId || keyFor("result", entry.ts)}`,
            ts: entry.ts,
            endTs: entry.ts,
            name,
            step: stepKind(name, null),
            title: "",
            input: "",
            output: entry.content,
            status: entry.isError ? "error" : "done",
            diff: null,
            added: 0,
            removed: 0,
          });
        }
        break;
      }
      case "diff": {
        const type = DIFF_TYPES[entry.changeType] ?? "context";
        let diff = last?.kind === "diff" ? last : null;
        if (!diff) {
          diff = { kind: "diff", key: keyFor("diff", entry.ts), ts: entry.ts, file: null, lines: [], added: 0, removed: 0 };
          items.push(diff);
        }
        if (type === "file") diff.file = diff.file ?? entry.text;
        if (type === "add") diff.added += 1;
        if (type === "remove") diff.removed += 1;
        diff.lines.push({ type, text: entry.text });
        break;
      }
      case "stderr":
      case "system": {
        if (entry.kind === "system" && QUIET_SYSTEM.test(compact(entry.text))) break;
        const tone = entry.kind === "stderr" ? "warn" : "info";
        const label = entry.kind === "stderr" ? "stderr" : "Paperclip";
        if (last?.kind === "note" && last.label === label) last.lines.push(entry.text);
        else items.push({ kind: "note", key: keyFor("note", entry.ts), ts: entry.ts, tone, label, lines: [entry.text] });
        break;
      }
      case "stdout": {
        // Plain output while a command is running belongs to that command.
        const command = [...items].reverse().find((item): item is Extract<TranscriptItem, { kind: "tool" }> => item.kind === "tool" && item.status === "running" && item.step === "command");
        if (command) command.output = command.output ? `${command.output}\n${entry.text}` : entry.text;
        else if (last?.kind === "output") last.text += `\n${entry.text}`;
        else items.push({ kind: "output", key: keyFor("output", entry.ts), ts: entry.ts, text: entry.text });
        break;
      }
      case "result":
        if (entry.subtype === "transcript_parse_error") {
          items.push({ kind: "note", key: keyFor("note", entry.ts), ts: entry.ts, tone: "error", label: "Unreadable output", lines: [entry.text] });
          break;
        }
        items.push({
          kind: "finished",
          key: keyFor("finished", entry.ts),
          ts: entry.ts,
          isError: entry.isError,
          text: entry.text.trim() || entry.errors[0] || "",
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          cachedTokens: entry.cachedTokens,
          costUsd: entry.costUsd,
        });
        break;
      case "run_result":
        items.push({
          kind: "outcome",
          key: keyFor("outcome", entry.ts),
          ts: entry.ts,
          disposition: entry.disposition,
          summary: entry.summary,
          checks: entry.verification.map((check) => ({
            label: check.detail ? `${check.commandOrCheck} · ${check.detail}` : check.commandOrCheck,
            passed: check.status === "passed" ? true : check.status === "failed" ? false : null,
          })),
          remaining: entry.remainingWork.map((work) => work.description),
          artifacts: entry.artifacts.map((artifact) => artifact.title || artifact.ref),
        });
        break;
      case "run_terminal":
        if (entry.runState === "failed") {
          items.push({ kind: "note", key: keyFor("note", entry.ts), ts: entry.ts, tone: "error", label: "Run ended", lines: [entry.stopReason ?? `${entry.runState} · ${entry.disposition}`] });
        }
        break;
      case "runtime_request":
        items.push({
          kind: "note",
          key: `request:${entry.requestId}`,
          ts: entry.ts,
          tone: entry.status === "pending" ? "warn" : "info",
          label: entry.requestType === "permission" ? "Asked for permission" : "Asked for input",
          lines: [`${entry.prompt}${entry.status === "pending" ? "" : ` · ${entry.status}`}`],
        });
        break;
      case "workspace_change":
        items.push({
          kind: "note",
          key: `change:${entry.changeSetId}:${entry.revision}`,
          ts: entry.ts,
          tone: "info",
          label: "Workspace",
          lines: [
            `${entry.totals.files} ${entry.totals.files === 1 ? "file" : "files"} changed` +
              (entry.totals.additions !== null ? ` · +${entry.totals.additions}` : "") +
              (entry.totals.deletions !== null ? ` −${entry.totals.deletions}` : ""),
          ],
        });
        break;
      case "workspace_file_reference":
        items.push({ kind: "note", key: `file:${entry.referenceId}`, ts: entry.ts, tone: "info", label: "File", lines: [entry.path] });
        break;
      case "provider_activity":
        items.push({ kind: "note", key: keyFor("activity", entry.ts), ts: entry.ts, tone: entry.status === "failed" ? "error" : "info", label: entry.title || entry.family, lines: [entry.summary].filter(Boolean) });
        break;
    }
  }
  return items;
}

/** "read 6 files · ran 4 commands · edited 2 files". */
export function stepSummary(items: readonly TranscriptItem[]) {
  const tally = new Map<StepKind | "note", number>();
  for (const item of items) {
    if (item.kind === "tool") tally.set(item.step, (tally.get(item.step) ?? 0) + 1);
    else if (item.kind === "diff") tally.set("edit", (tally.get("edit") ?? 0) + 1);
    else tally.set("note", (tally.get("note") ?? 0) + 1);
  }
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  const read = tally.get("read");
  const command = tally.get("command");
  const edit = tally.get("edit");
  const search = tally.get("search");
  const web = tally.get("web");
  const other = (tally.get("other") ?? 0) + (tally.get("task") ?? 0);
  const notes = tally.get("note");
  if (read) parts.push(`read ${plural(read, "file", "files")}`);
  if (command) parts.push(`ran ${plural(command, "command", "commands")}`);
  if (edit) parts.push(`edited ${plural(edit, "file", "files")}`);
  if (search) parts.push(`searched ${plural(search, "time", "times")}`);
  if (web) parts.push(`fetched ${plural(web, "page", "pages")}`);
  if (other) parts.push(plural(other, "other step", "other steps"));
  if (notes) parts.push(plural(notes, "note", "notes"));
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Items that count as steps, for the Transcript tab's "41 steps". */
export function stepCount(items: readonly TranscriptItem[]) {
  return items.filter((item) => item.kind !== "started" && item.kind !== "finished" && item.kind !== "outcome").length;
}

export type ShowOptions = {
  thinking: boolean;
  tools: boolean;
  /** Fold keys the reader has opened. */
  expanded: ReadonlySet<string>;
  /** Fold a stretch of this many steps or more. */
  foldAt?: number;
  /** Steps left visible at the end of a folded stretch. */
  keepTail?: number;
};

const FOLDABLE = new Set<TranscriptItem["kind"]>(["tool", "diff", "note", "output"]);

/**
 * What the Transcript view draws: the items the chips allow, with long stretches of steps between
 * messages folded. A stretch keeps its last steps visible, so the latest work in a live run shows.
 */
export function visibleItems(items: readonly TranscriptItem[], options: ShowOptions): ShownItem[] {
  const foldAt = options.foldAt ?? 6;
  const keepTail = options.keepTail ?? 2;
  const allowed = items.filter((item) => {
    if (item.kind === "thinking") return options.thinking;
    if (item.kind === "tool" || item.kind === "diff") return options.tools;
    return true;
  });
  const shown: ShownItem[] = [];
  let stretch: TranscriptItem[] = [];
  const flush = () => {
    if (stretch.length >= foldAt) {
      const hidden = stretch.slice(0, stretch.length - keepTail);
      const key = `fold:${hidden[0]!.key}`;
      if (options.expanded.has(key)) {
        shown.push(...stretch);
      } else {
        shown.push({ kind: "fold", key, ts: hidden[0]!.ts, endTs: hidden[hidden.length - 1]!.ts, items: hidden, summary: stepSummary(hidden) });
        shown.push(...stretch.slice(stretch.length - keepTail));
      }
    } else {
      shown.push(...stretch);
    }
    stretch = [];
  };
  for (const item of allowed) {
    if (FOLDABLE.has(item.kind)) {
      stretch.push(item);
      continue;
    }
    flush();
    shown.push(item);
  }
  flush();
  return shown;
}
