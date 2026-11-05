import type { TranscriptEntry } from "@paperclipai/adapter-utils";
import {
  approvedReviewBadge,
  checkRow,
  hookRow,
  isFatalProviderError,
  isStatusNotice,
  mcpStartupFailure,
  modelRow,
  noticeCategory,
  planFromPayload,
  researchRow,
  reviewRow,
  statusChip,
  waitRow,
  withoutProposedPlanBlock,
  type ActivityRow,
  type Plan,
  type RowStatus,
  type StatusChip,
} from "./activity-model";

/*
 * The run modal's Transcript view (board 16): transcript entries grouped into what the board draws.
 *
 * - The start of the run, the agent's messages, thinking, and tool calls paired with their results,
 *   each saying what ran and how it went (exit code, time, a refusal) and an edit's inline diff.
 * - The runner's own activity (upstream's Nov 5 task-chat upgrades, U42): web searches, model
 *   switches, waits, verification checks, hook and auto-review decisions as dedicated rows; harness
 *   status notices as chips; subagents as a tree with the calls each made; the agent's native plan
 *   and a plan it proposed; MCP servers that failed to start, which lead the view.
 * - Diffs, notes (stderr, system lines and other harness events), the finish line and the outcome.
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
  | {
      kind: "thinking";
      key: string;
      ts: string;
      endTs: string;
      text: string;
      streaming: boolean;
      /** A provider's reasoning summary, which Codex writes as headlines (#19271), not raw thinking. */
      summary?: boolean;
    }
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
      /** The ids the tool gateway's decisions name the call by (tool-decisions.ts matches them). */
      refs: ToolRefs;
      /** How it went, when the runner says (upstream #19265): the exit code and the time it took. */
      exitCode?: number | null;
      durationMs?: number | null;
      /** Why a policy or rule refused the call. */
      blocked?: string | null;
      /** What the agent said the call is for. */
      description?: string | null;
      /** The edit's patch was shortened for display; the counts still cover all of it. */
      diffTruncated?: boolean;
      /** An automatic review that approved the call, folded onto it. */
      review?: string | null;
    }
  | {
      /**
       * A dedicated row (upstream #19262, #19266): a web search, model switch, wait, verification
       * check, hook or auto-review. Later events for the same id update it.
       */
      kind: "activity";
      key: string;
      ts: string;
      row: ActivityRow;
      /** For an auto-review: the tool call it reviewed, and its badge there if it approved it. */
      target?: string;
      review?: string;
    }
  | {
      /** A harness status notice as a chip (upstream #19267): compaction, a retry, a fallback. */
      kind: "chip";
      key: string;
      ts: string;
      chip: StatusChip;
      /** The notice, so the chip can be re-read once later work says how it ended. */
      payload: Record<string, unknown>;
    }
  | {
      /** Subagents dispatched together (upstream #19264), each with the tool calls it made. */
      kind: "subagents";
      key: string;
      ts: string;
      agents: Subagent[];
    }
  | {
      /** The agent's native plan for the turn (upstream #19252): the latest snapshot of it. */
      kind: "plan";
      key: string;
      ts: string;
      plan: Plan;
    }
  | {
      /** A plan the harness proposed (upstream #19291); once complete, the task's Plan takes it. */
      kind: "proposal";
      key: string;
      ts: string;
      markdown: string;
      streaming: boolean;
    }
  | {
      /** MCP servers that failed to start (upstream #19289), shown once at the top of the run. */
      kind: "health";
      key: string;
      ts: string;
      failures: { server: string; reason: string | null }[];
    }
  | {
      /** A harness asking for permission or input mid-turn; answered from the run modal. */
      kind: "request";
      key: string;
      ts: string;
      request: RuntimeRequest;
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

export type ToolRefs = { toolUseId?: string; invocationId?: string; actionRequestId?: string };

export type ToolItem = Extract<TranscriptItem, { kind: "tool" }>;

export type Subagent = {
  id: string;
  /** The subagent type the harness dispatched, such as `Explore`. */
  role: string;
  /** The short task the parent gave it. */
  description: string;
  prompt: string | null;
  model: string | null;
  status: "running" | "done" | "error" | "stopped";
  /** Its latest progress while it runs, and what it reported once it's done. */
  progress: string | null;
  result: string | null;
  endTs: string | null;
  tools: ToolItem[];
};

/** The latest state of a runtime request: later entries for the same request replace earlier ones. */
export type RuntimeRequest = Omit<Extract<TranscriptEntry, { kind: "runtime_request" }>, "kind" | "ts">;

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

/** The ids a tool call carries, with a call id found in its input as the old UI finds it. */
function toolRefs(entry: Extract<TranscriptEntry, { kind: "tool_call" }>): ToolRefs {
  const fields = record(entry.input);
  const fromInput = fields
    ? [fields.toolUseId, fields.tool_use_id, fields.callId, fields.call_id, fields.id].find((candidate): candidate is string => typeof candidate === "string" && !!candidate.trim())
    : undefined;
  const refs: ToolRefs = {};
  const toolUseId = entry.toolUseId ?? fromInput;
  if (toolUseId) refs.toolUseId = toolUseId;
  if (entry.invocationId) refs.invocationId = entry.invocationId;
  if (entry.actionRequestId) refs.actionRequestId = entry.actionRequestId;
  return refs;
}

/**
 * A runner tool-execution event as a step: its id, the tool, what it's doing ("Terminal: npm test"
 * reads as the title "npm test"), and its output once there is some.
 */
export function toolExecution(entry: Extract<TranscriptEntry, { kind: "provider_activity" }>) {
  const payload = entry.payload;
  const id = typeof payload.executionId === "string" && payload.executionId ? payload.executionId : null;
  if (!id) return null;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const reported = text(payload.name);
  const operation = text(payload.operation);
  const subject = text(payload.subject);
  const target = text(payload.target);
  const process = payload.transport === "process";
  const changes = fileChangeDiff(payload.fileChanges);
  // A process's reported name is its command line; it reads as a command, or as the read, search
  // or listing it was when the runner says so and names one file (as the old UI does).
  const name = process
    ? ((operation === "search" || target) && operation ? PROCESS_NAMES[operation] : undefined) ?? "Bash"
    : reported ?? (entry.summary || "Tool");
  const progress = (typeof payload.progress === "string" ? payload.progress : "").replace(/ \(pending\)$/, "");
  // "Terminal: npm test" reads as "npm test"; a bare name, or an MCP tool's full name, adds nothing.
  const bare = progress === name || (/^mcp__[^_]+__/.test(progress) && progress.endsWith(`__${name}`));
  const fromProgress = bare ? "" : progress.startsWith(`${name}: `) ? progress.slice(name.length + 2) : progress;
  // The runner's subject (a command, pattern or query) or target (a file) say what ran best.
  const title = subject ?? target ?? (process ? reported : null) ?? (fromProgress || changes?.file || "");
  const rawOutput = typeof payload.output === "string" && payload.output !== "null" ? payload.output : null;
  const exit = typeof payload.exitCode === "number" ? `exit_code: ${payload.exitCode}` : null;
  const output = rawOutput ? (exit ? `${exit}\n${rawOutput}` : rawOutput) : null;
  const input = payload.input === undefined || payload.input === null ? "" : pretty(payload.input);
  const running = entry.status === "running";
  const step: StepKind = process
    ? operation === "read" ? "read" : operation === "search" || operation === "list" ? "search" : "command"
    : operation === "edit" || changes ? "edit" : stepKind(name, payload.input ?? null);
  return {
    id,
    name,
    title: truncate(compact(title), 140),
    input,
    output,
    step,
    parent: text(payload.parentItemId),
    exitCode: !running && typeof payload.exitCode === "number" ? payload.exitCode : null,
    // Codex reports 0 for calls it didn't time; 0ms says nothing.
    durationMs: !running && typeof payload.durationMs === "number" && payload.durationMs > 0 ? payload.durationMs : null,
    blocked: text(payload.blockedReason),
    description: text(payload.description),
    changes,
  };
}

/** Names the tool rows already know, for a process that only read, searched or listed. */
const PROCESS_NAMES: Record<string, string> = { read: "Read", search: "Grep", list: "Glob" };

/**
 * One edit call's `fileChanges` (upstream #19269) as diff lines: each file's unified patch, under
 * its path when there are several. The counts are the producer's, which cover the whole patch even
 * when the patch itself was shortened (`diffTruncated`).
 */
export function fileChangeDiff(value: unknown): { file: string; lines: DiffLine[]; added: number; removed: number; truncated: boolean } | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const changes = value.slice(0, 32).map(record).filter((change): change is Record<string, unknown> => !!change && typeof change.path === "string" && !!change.path);
  if (changes.length === 0) return null;
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let truncated = false;
  const count = (n: unknown) => (typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null);
  for (const change of changes) {
    if (changes.length > 1) lines.push({ type: "file", text: change.path as string });
    const parsed = unifiedDiffLines(typeof change.diff === "string" ? change.diff : "");
    lines.push(...parsed.lines);
    added += count(change.additions) ?? parsed.added;
    removed += count(change.deletions) ?? parsed.removed;
    truncated ||= change.diffTruncated === true;
  }
  return { file: changes[0]!.path as string, lines, added, removed, truncated };
}

/**
 * A unified diff body as diff lines. File headers (`diff --git`, `index`, `---`, `+++`) are skipped
 * before a file's first hunk, since the row already names the file; inside a hunk, `--- x` is a
 * removed line. Follows the old UI's ui/src/components/task-chat/diff-lines.ts.
 */
export function unifiedDiffLines(patch: string): { lines: DiffLine[]; added: number; removed: number } {
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let inHunk = false;
  const source = patch.endsWith("\n") ? patch.slice(0, -1) : patch;
  for (const raw of source ? source.split("\n") : []) {
    if (raw.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (raw.startsWith("@@")) {
      inHunk = true;
      lines.push({ type: "hunk", text: raw });
      continue;
    }
    if (raw === "\\ No newline at end of file") continue;
    if (!inHunk && /^(\+\+\+ |--- |index |new file mode|deleted file mode|similarity index|rename from|rename to)/.test(raw)) continue;
    if (raw.startsWith("+")) {
      added += 1;
      lines.push({ type: "add", text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      removed += 1;
      lines.push({ type: "remove", text: raw.slice(1) });
    } else {
      lines.push({ type: "context", text: raw.startsWith(" ") ? raw.slice(1) : raw });
    }
  }
  return { lines, added, removed };
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

export function buildItems(source: readonly TranscriptEntry[], streaming: boolean): TranscriptItem[] {
  const entries = withoutProposedBlocks(source);
  const items: TranscriptItem[] = [];
  const openTools = new Map<string, Extract<TranscriptItem, { kind: "tool" }>>();
  // Some transports also report a subagent's spawning call as a tool; its subagent card owns it.
  const delegationIds = new Set(
    entries.flatMap((entry) => (entry.kind === "provider_activity" && entry.family === "delegation" && typeof entry.payload.delegationId === "string" ? [entry.payload.delegationId] : [])),
  );
  const subagents = new Map<string, Subagent>();
  const keyed = new Map<string, TranscriptItem>();
  // A subagent's tool calls go under it; everything else into the transcript.
  const place = (tool: ToolItem, parent: string | null | undefined) => {
    const owner = parent ? subagents.get(parent) : undefined;
    if (owner) owner.tools.push(tool);
    else items.push(tool);
  };
  // Tool-execution steps that a later call has already filled in.
  const absorbed = new Set<string>();
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
          if (entry.channel === "summary") last.summary = true;
        } else {
          const summary = entry.channel === "summary" ? { summary: true } : {};
          items.push({ kind: "thinking", key: keyFor("thinking", entry.ts), ts: entry.ts, endTs: entry.ts, text: entry.text, streaming: live, ...summary });
        }
        break;
      }
      case "tool_call": {
        const id = entry.toolUseId ?? entry.invocationId ?? null;
        const open = id ? openTools.get(id) : undefined;
        // Streaming harnesses re-send a call as it progresses: fold the update in.
        if (open && open.status === "running") {
          open.refs = { ...open.refs, ...toolRefs(entry) };
          if (entry.input !== null && entry.input !== undefined) {
            open.input = pretty(entry.input);
            open.title = toolTitle(open.name, entry.input) || open.title;
            const diff = editDiff(entry.input);
            if (diff) Object.assign(open, { diff: diff.lines, added: diff.added, removed: diff.removed });
          }
          break;
        }
        // The runner reports an MCP call twice: as a tool execution, then as the call itself with its
        // input. The call fills in the execution's step rather than adding another.
        const execution = id
          ? [...items].reverse().find(
              (item): item is Extract<TranscriptItem, { kind: "tool" }> =>
                item.kind === "tool" && item.key.startsWith("tool:exec:") && item.name === entry.name && !absorbed.has(item.key),
            )
          : undefined;
        if (execution && id) {
          absorbed.add(execution.key);
          execution.input = pretty(entry.input);
          execution.title = toolTitle(entry.name, entry.input) || execution.title;
          execution.refs = { ...execution.refs, ...toolRefs(entry) };
          openTools.set(id, execution);
          break;
        }
        const diff = editDiff(entry.input);
        const detail = entry.detail;
        const item: Extract<TranscriptItem, { kind: "tool" }> = {
          kind: "tool",
          key: id ? `tool:${id}` : keyFor("tool", entry.ts),
          ts: entry.ts,
          endTs: null,
          name: entry.name,
          step: stepKind(entry.name, entry.input),
          title: detail?.subject ?? detail?.target ?? toolTitle(entry.name, entry.input),
          input: pretty(entry.input),
          output: null,
          status: "running",
          diff: diff?.lines ?? null,
          added: diff?.added ?? 0,
          removed: diff?.removed ?? 0,
          refs: toolRefs(entry),
          ...(detail
            ? {
                exitCode: detail.exitCode ?? null,
                durationMs: detail.durationMs || null,
                blocked: detail.blockedReason ?? null,
                description: detail.description ?? null,
              }
            : {}),
        };
        place(item, entry.parentToolUseId);
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
            refs: entry.toolUseId ? { toolUseId: entry.toolUseId } : {},
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
        // The runner's running usage totals; the run's stats show the final ones.
        if (entry.subtype === "paperclip.usage") break;
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
      case "runtime_request": {
        // A request's later states (resolved, expired) update the item where it was first asked.
        const { kind: _kind, ts: _ts, ...request } = entry;
        const asked = items.find((item): item is Extract<TranscriptItem, { kind: "request" }> => item.kind === "request" && item.request.requestId === entry.requestId);
        if (asked) asked.request = request;
        else items.push({ kind: "request", key: `request:${entry.requestId}`, ts: entry.ts, request });
        break;
      }
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
      case "provider_activity": {
        // The runner reports each tool it runs as started, progressed and completed events: one step.
        const execution = entry.family === "tool_execution" ? toolExecution(entry) : null;
        if (execution) {
          if (delegationIds.has(execution.id)) break;
          const existing = openTools.get(`exec:${execution.id}`);
          const status = entry.status === "failed" ? "error" : entry.status === "running" ? "running" : "done";
          const outcome = {
            exitCode: execution.exitCode,
            durationMs: execution.durationMs,
            blocked: execution.blocked,
            description: execution.description,
          };
          if (existing) {
            if (!absorbed.has(existing.key)) {
              existing.title = execution.title || existing.title;
              existing.input = execution.input || existing.input;
            }
            existing.output = execution.output ?? existing.output;
            existing.status = status;
            if (status !== "running") existing.endTs = entry.ts;
            if (execution.step !== "other") existing.step = execution.step;
            // Each event carries the call's latest facts; a later one refines what an earlier said.
            for (const [field, value] of Object.entries(outcome)) if (value !== null) Object.assign(existing, { [field]: value });
            // An edit reports an optimistic patch when it starts and the exact one when it lands.
            if (execution.changes) {
              Object.assign(existing, { diff: execution.changes.lines, added: execution.changes.added, removed: execution.changes.removed, diffTruncated: execution.changes.truncated });
            }
          } else {
            const item: Extract<TranscriptItem, { kind: "tool" }> = {
              kind: "tool",
              key: `tool:exec:${execution.id}`,
              ts: entry.ts,
              endTs: status === "running" ? null : entry.ts,
              name: execution.name,
              step: execution.step,
              title: execution.title,
              input: execution.input,
              output: execution.output,
              status,
              diff: execution.changes?.lines ?? null,
              added: execution.changes?.added ?? 0,
              removed: execution.changes?.removed ?? 0,
              refs: { toolUseId: execution.id },
              ...outcome,
              ...(execution.changes?.truncated ? { diffTruncated: true } : {}),
            };
            place(item, execution.parent);
            openTools.set(`exec:${execution.id}`, item);
          }
          break;
        }
        const payload = entry.payload;
        const status: RowStatus = entry.status === "failed" ? "error" : entry.status === "running" ? "running" : "done";
        const interrupted = entry.status === "interrupted";
        const id = (field: string) => (typeof payload[field] === "string" && payload[field] ? (payload[field] as string) : null);
        // Later events for the same id update the row where it first appeared.
        const activity = (key: string, row: ActivityRow, target?: string, review?: string) => {
          const existing = keyed.get(key);
          if (existing?.kind === "activity") {
            existing.row = row;
            if (target) existing.target = target;
            existing.review = review;
            return;
          }
          const item: TranscriptItem = { kind: "activity", key, ts: entry.ts, row, ...(target ? { target } : {}), ...(review ? { review } : {}) };
          keyed.set(key, item);
          items.push(item);
        };

        if (entry.family === "plan") {
          const plan = planFromPayload(payload);
          if (!plan) break;
          const key = `plan:${plan.id}`;
          const existing = keyed.get(key);
          if (existing?.kind === "plan") existing.plan = plan;
          else {
            const item: TranscriptItem = { kind: "plan", key, ts: entry.ts, plan };
            keyed.set(key, item);
            items.push(item);
          }
          break;
        }
        if (entry.family === "plan_proposal") {
          const proposal = id("proposalId");
          if (!proposal) break;
          const key = `proposal:${proposal}`;
          const markdown = typeof payload.markdown === "string" ? payload.markdown : "";
          const live = entry.status === "running";
          const existing = keyed.get(key);
          if (existing?.kind === "proposal") {
            existing.markdown = markdown || existing.markdown;
            existing.streaming = live;
          } else {
            const item: TranscriptItem = { kind: "proposal", key, ts: entry.ts, markdown, streaming: live };
            keyed.set(key, item);
            items.push(item);
          }
          break;
        }
        if (entry.family === "delegation") {
          const delegation = id("delegationId");
          if (!delegation) break;
          const children = (Array.isArray(payload.children) ? payload.children : []).slice(0, 64).map(record).filter((child): child is Record<string, unknown> => !!child);
          const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
          const agentStatus = (raw: unknown): Subagent["status"] =>
            raw === "completed" || raw === "closed" ? "done" : raw === "failed" ? "error" : raw === "interrupted" || raw === "cancelled" ? "stopped" : "running";
          children.forEach((child, index) => {
            const childId = `${delegation}:${text(child.childId) ?? index}`;
            const childStatus = agentStatus(child.status ?? payload.status);
            const next = {
              role: text(child.role) ?? "Subagent",
              description: text(child.summary) ?? text(child.role) ?? "Subagent",
              prompt: text(child.prompt),
              model: text(child.model),
              status: childStatus,
              progress: childStatus === "running" ? text(child.activitySummary) : null,
              // Harnesses without a dedicated result keep their activity text in `activitySummary`.
              result: text(child.result) ?? (childStatus === "running" ? null : text(child.activitySummary)),
              endTs: childStatus === "running" ? null : entry.ts,
            };
            const known = subagents.get(childId);
            if (known) {
              Object.assign(known, next, { prompt: next.prompt ?? known.prompt, model: next.model ?? known.model, result: next.result ?? known.result });
              return;
            }
            const agent: Subagent = { id: childId, ...next, tools: [] };
            subagents.set(childId, agent);
            // The first child owns the tool calls made under the delegation's own id.
            if (index === 0) subagents.set(delegation, agent);
            // Subagents dispatched back to back share one tree.
            const group = items[items.length - 1];
            if (group?.kind === "subagents") group.agents.push(agent);
            else items.push({ kind: "subagents", key: `subagents:${childId}`, ts: entry.ts, agents: [agent] });
          });
          break;
        }
        if (entry.family === "hook") {
          activity(`hook:${id("hookId") ?? keyFor("hook", entry.ts)}`, hookRow(payload, interrupted));
          break;
        }
        if (entry.family === "safety") {
          activity(`review:${id("reviewId") ?? keyFor("review", entry.ts)}`, reviewRow(payload, interrupted), id("targetExecutionId") ?? undefined, approvedReviewBadge(payload)?.label);
          break;
        }
        if (entry.family === "research") {
          activity(`research:${id("researchId") ?? keyFor("research", entry.ts)}`, researchRow(payload, status));
          break;
        }
        if (entry.family === "model_identity" && (entry.eventType === "model.route.changed" || entry.eventType === "model.verification.updated")) {
          activity(`model:${id("routeId") ?? id("verificationId") ?? keyFor("model", entry.ts)}`, modelRow(entry.eventType, payload, status));
          break;
        }
        if (entry.family === "wait") {
          activity(`wait:${id("waitId") ?? keyFor("wait", entry.ts)}`, waitRow(payload, status, interrupted));
          break;
        }
        if (entry.family === "verification") {
          activity(`check:${id("verificationId") ?? keyFor("check", entry.ts)}`, checkRow(payload));
          break;
        }
        if (entry.family === "provider_notice") {
          const failure = mcpStartupFailure(payload);
          if (failure) {
            // One line per server; a later report replaces an earlier one.
            const health = items.find((item): item is Extract<TranscriptItem, { kind: "health" }> => item.kind === "health");
            if (health) health.failures = [...health.failures.filter((known) => known.server !== failure.server), failure];
            else items.push({ kind: "health", key: "health", ts: entry.ts, failures: [failure] });
            break;
          }
          const chip = isStatusNotice(payload) ? statusChip(payload) : null;
          if (chip) {
            // Each retry keeps its own place, so work between two retries can't make the later one look recovered.
            const notice = id("noticeId");
            const key = notice && noticeCategory(payload) !== "provider_retry" ? `chip:${notice}` : keyFor("chip", entry.ts);
            const existing = keyed.get(key);
            if (existing?.kind === "chip") Object.assign(existing, { chip, payload });
            else {
              const item: TranscriptItem = { kind: "chip", key, ts: entry.ts, chip, payload };
              keyed.set(key, item);
              items.push(item);
            }
            break;
          }
        }
        items.push({ kind: "note", key: keyFor("activity", entry.ts), ts: entry.ts, tone: entry.status === "failed" ? "error" : "info", label: entry.title || entry.family, lines: [entry.summary].filter(Boolean) });
        break;
      }
    }
  }
  foldApprovedReviews(items);
  return settleChips(items, streaming);
}

/** Messages whose `<proposed_plan>` block became a completed proposal show it as the proposal instead. */
function withoutProposedBlocks(entries: readonly TranscriptEntry[]): readonly TranscriptEntry[] {
  const proposed = new Set(
    entries.flatMap((entry) =>
      entry.kind === "provider_activity" && entry.family === "plan_proposal" && entry.payload.status === "completed" && typeof entry.payload.proposalId === "string"
        ? [entry.payload.proposalId]
        : [],
    ),
  );
  if (proposed.size === 0) return entries;
  const texts = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === "assistant" && entry.itemId && proposed.has(entry.itemId)) texts.set(entry.itemId, (texts.get(entry.itemId) ?? "") + entry.text);
  }
  const done = new Set<string>();
  return entries.flatMap((entry): TranscriptEntry[] => {
    if (entry.kind !== "assistant" || !entry.itemId || !texts.has(entry.itemId)) return [entry];
    if (done.has(entry.itemId)) return [];
    done.add(entry.itemId);
    const text = withoutProposedPlanBlock(texts.get(entry.itemId)!);
    return text ? [{ ...entry, text, delta: false }] : [];
  });
}

/** An approved auto-review is a badge on the call it approved, not a row of its own. */
function foldApprovedReviews(items: TranscriptItem[]) {
  const tools = new Map<string, ToolItem>();
  for (const item of items) {
    if (item.kind === "tool" && item.refs.toolUseId) tools.set(item.refs.toolUseId, item);
    if (item.kind === "subagents") for (const agent of item.agents) for (const tool of agent.tools) if (tool.refs.toolUseId) tools.set(tool.refs.toolUseId, tool);
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.kind !== "activity" || !item.review) continue;
    const tool = item.target ? tools.get(item.target) : undefined;
    if (!tool) continue;
    tool.review = item.review;
    items.splice(index, 1);
  }
}

/** Whether an item is new provider work, which shows that a retry before it recovered. */
function isWork(item: TranscriptItem) {
  return (
    (item.kind === "message" && item.role === "assistant" && !!item.text.trim()) ||
    (item.kind === "thinking" && !!item.text.trim()) ||
    item.kind === "tool" ||
    item.kind === "activity" ||
    item.kind === "subagents" ||
    item.kind === "diff"
  );
}

/**
 * Status chips read again with what came after them: a retry followed by real work recovered; of
 * several retries in a row only the latest shows; a fatal error that ended the retries tells the
 * whole story; and a retry or compaction still going when the run ended was cut short.
 */
function settleChips(items: TranscriptItem[], live: boolean): TranscriptItem[] {
  if (!items.some((item) => item.kind === "chip")) return items;
  const out: TranscriptItem[] = [];
  items.forEach((item, index) => {
    if (item.kind !== "chip") {
      out.push(item);
      return;
    }
    const later = items.slice(index + 1);
    const category = noticeCategory(item.payload);
    if (category === "provider_retry") {
      if (later.some((next) => next.kind === "chip" && isFatalProviderError(next.payload))) return;
      const signal = later.find((next) => isWork(next) || (next.kind === "chip" && noticeCategory(next.payload) === "provider_retry"));
      if (signal?.kind === "chip") return;
      item.chip = statusChip(item.payload, { resolved: !!signal, stopped: !signal && !live }) ?? item.chip;
    } else if (category === "context_compaction") {
      item.chip = statusChip(item.payload, { stopped: !live }) ?? item.chip;
    }
    out.push(item);
  });
  return out;
}

/** "read 6 files · ran 4 commands · edited 2 files". */
export function stepSummary(items: readonly TranscriptItem[]) {
  const tally = new Map<StepKind | "note", number>();
  for (const item of items) {
    if (item.kind === "tool") tally.set(item.step, (tally.get(item.step) ?? 0) + 1);
    else if (item.kind === "diff") tally.set("edit", (tally.get("edit") ?? 0) + 1);
    else if (item.kind === "activity") {
      const kind = item.row.icon === "web" ? "search" : item.row.icon === "page" ? "web" : "other";
      tally.set(kind, (tally.get(kind) ?? 0) + 1);
    } else tally.set("note", (tally.get("note") ?? 0) + 1);
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
  return items.filter((item) => item.kind !== "started" && item.kind !== "finished" && item.kind !== "outcome" && item.kind !== "health" && item.kind !== "plan").length;
}

/**
 * The items the Transcript view draws in time order: all but the outcome and the MCP warning, which
 * lead the view.
 */
export function transcriptSteps(items: readonly TranscriptItem[]) {
  return items.filter((item) => item.kind !== "outcome" && item.kind !== "health");
}

/** MCP servers that failed to start in the run (upstream #19289). */
export function runHealth(items: readonly TranscriptItem[]) {
  return items.find((item): item is Extract<TranscriptItem, { kind: "health" }> => item.kind === "health")?.failures ?? [];
}

/** The agent's latest native plan in the run, for the plan card above the chat's composer. */
export function latestPlan(items: readonly TranscriptItem[]): Plan | null {
  let latest: Plan | null = null;
  for (const item of items) if (item.kind === "plan") latest = item.plan;
  return latest;
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

const FOLDABLE = new Set<TranscriptItem["kind"]>(["tool", "diff", "note", "output", "activity"]);

/**
 * What the Transcript view draws: the items the chips allow, with long stretches of steps between
 * messages folded. A stretch keeps its last steps visible, so the latest work in a live run shows.
 */
export function visibleItems(items: readonly TranscriptItem[], options: ShowOptions): ShownItem[] {
  const foldAt = options.foldAt ?? 6;
  const keepTail = options.keepTail ?? 2;
  const allowed = items.filter((item) => {
    if (item.kind === "thinking") return options.thinking;
    // A dedicated row is a step like a tool call, except one that stopped the agent: its reason
    // explains what happened next.
    if (item.kind === "tool" || item.kind === "diff") return options.tools;
    if (item.kind === "activity") return options.tools || item.row.tone === "blocked" || item.row.tone === "failed";
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
