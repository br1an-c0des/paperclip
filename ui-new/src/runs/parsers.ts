import type { TranscriptEntry } from "@paperclipai/adapter-utils";
import { redactHomePathUserSegments, redactTranscriptEntryPaths } from "@paperclipai/adapter-utils/log-redaction";
import { parseClaudeStdoutLine } from "@paperclipai/adapter-claude-local/ui";
import { parseCodexStdoutLine } from "@paperclipai/adapter-codex-local/ui";
import { parseCursorStdoutLine } from "@paperclipai/adapter-cursor-local/ui";
import { parseGeminiStdoutLine } from "@paperclipai/adapter-gemini-local/ui";
import { createGrokStdoutParser } from "@paperclipai/adapter-grok-local/ui";
import { parseKimiStdoutLine } from "@paperclipai/adapter-kimi-local/ui";
import { parseOpenClawGatewayStdoutLine } from "@paperclipai/adapter-openclaw-gateway/ui";
import { parseOpenCodeStdoutLine } from "@paperclipai/adapter-opencode-local/ui";
import { parsePiStdoutLine } from "@paperclipai/adapter-pi-local/ui";
import { parseStdoutLine as parseHermesGatewayStdoutLine } from "@paperclipai/hermes-paperclip-adapter/gateway/ui";
import { parseHermesStdoutLine } from "@paperclipai/hermes-paperclip-adapter/ui";
import { createPaperclipRunnerParser } from "./paperclip-runner-parser";
import type { RunLogChunk } from "./run-log";

/*
 * Turning a run's output into transcript entries. Each harness writes its own stdout format, and
 * each adapter package ships the parser the old UI uses (`@paperclipai/adapter-*\/ui`), so ui-new
 * imports the same parsers rather than keeping copies. `buildTranscript` follows
 * ui/src/adapters/transcript.ts.
 *
 * The Paperclip runner (`paperclip_runner`) has no package parser, so ui-new keeps a copy of the
 * old UI's (paperclip-runner-parser.ts). Native-runtime runs go through the runner too: their log
 * is the runner's event envelopes, whatever the agent's harness, so they use that parser.
 *
 * Not covered yet, so their output shows as plain lines:
 * - `cursor_cloud`, whose parser is in `@paperclipai/adapter-cursor-cloud/ui`, a package ui-new
 *   doesn't depend on yet;
 * - external adapters, whose parsers the old UI loads from the server at run time
 *   (ui/src/adapters/dynamic-loader.ts).
 */

export type { TranscriptEntry };

type LineParser = { parseLine: (line: string, ts: string) => TranscriptEntry[]; reset?: () => void };

const stateless = (parse: (line: string, ts: string) => TranscriptEntry[]) => (): LineParser => ({ parseLine: parse });

const plainLines = stateless((line, ts) => [{ kind: "stdout", ts, text: line }]);

const PARSERS: Record<string, () => LineParser> = {
  claude_local: stateless(parseClaudeStdoutLine),
  codex_local: stateless(parseCodexStdoutLine),
  cursor: stateless(parseCursorStdoutLine),
  gemini_local: stateless(parseGeminiStdoutLine),
  grok_local: createGrokStdoutParser,
  kimi_local: stateless(parseKimiStdoutLine),
  hermes_local: stateless(parseHermesStdoutLine),
  hermes_gateway: stateless(parseHermesGatewayStdoutLine),
  opencode_local: stateless(parseOpenCodeStdoutLine),
  pi_local: stateless(parsePiStdoutLine),
  openclaw_gateway: stateless(parseOpenClawGatewayStdoutLine),
  process: plainLines,
  http: plainLines,
};

const RUNNER = "paperclip_runner";

/**
 * Whether a local harness's own package can read its output as a structured transcript. The
 * runner's events are read separately where they're needed (the chat reads them from the run's
 * events), so it doesn't count here.
 */
export function hasStructuredParser(adapterType: string | null | undefined) {
  return !!adapterType && adapterType in PARSERS && adapterType !== "process" && adapterType !== "http";
}

/** The parser for a run: the runner's for runner and native runs, else the harness's own. */
function parserFor(adapterType: string | null | undefined, runtimeMode?: string): LineParser {
  if (runtimeMode === "native" || adapterType === RUNNER) return createPaperclipRunnerParser();
  return adapterType && PARSERS[adapterType] ? PARSERS[adapterType]!() : plainLines();
}

/**
 * Whether the transcript should say its output shows as plain lines because ui-new can't read it
 * yet. The process and HTTP adapters write plain output anyway, so they don't need the note.
 */
export function showsPlainLines(adapterType: string | null | undefined, runtimeMode?: string) {
  if (runtimeMode === "native" || adapterType === RUNNER) return false;
  return !!adapterType && !(adapterType in PARSERS);
}

/** Streamed text and thinking arrive as deltas; consecutive ones join into one entry. */
function append(entries: TranscriptEntry[], entry: TranscriptEntry) {
  if ((entry.kind === "thinking" || entry.kind === "assistant") && entry.delta) {
    const last = entries[entries.length - 1];
    if (last && last.kind === entry.kind && last.delta && last.channel === entry.channel) {
      last.text += entry.text;
      last.ts = entry.ts;
      return;
    }
  }
  entries.push(entry);
}

function truncate(line: string, max = 160) {
  return line.length <= max ? line : `${line.slice(0, max - 3)}...`;
}

/**
 * Builds the transcript from a run's chunks. stderr and system chunks pass through; stdout is split
 * into lines, carrying a partial line over to the next chunk, and each line goes to the harness's
 * parser. A line the parser throws on becomes an error entry instead of breaking the transcript.
 * `censorUsername` hides the user's name in home-directory paths, per the instance setting;
 * `runtimeMode` is the run's, as a native run's output is the runner's.
 */
export function buildTranscript(
  chunks: readonly RunLogChunk[],
  adapterType: string | null | undefined,
  options: { censorUsername?: boolean; runtimeMode?: string } = {},
): TranscriptEntry[] {
  const redaction = { enabled: options.censorUsername ?? false };
  const parser = parserFor(adapterType, options.runtimeMode);
  const entries: TranscriptEntry[] = [];
  let buffer = "";

  const parseLine = (line: string, ts: string) => {
    try {
      for (const entry of parser.parseLine(line, ts)) append(entries, redactTranscriptEntryPaths(entry, redaction));
    } catch (error) {
      parser.reset?.();
      const reason = error instanceof Error && error.message ? error.message : String(error);
      append(entries, {
        kind: "result",
        ts,
        text: redactHomePathUserSegments(`Couldn't read a line of output (${reason}): ${truncate(line)}`, redaction),
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
        subtype: "transcript_parse_error",
        isError: true,
        errors: [],
      });
    }
  };

  for (const chunk of chunks) {
    if (chunk.stream !== "stdout") {
      entries.push({ kind: chunk.stream, ts: chunk.ts, text: redactHomePathUserSegments(chunk.chunk, redaction) });
      continue;
    }
    const lines = `${buffer}${chunk.chunk}`.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) parseLine(trimmed, chunk.ts);
    }
  }
  const trailing = buffer.trim();
  if (trailing) parseLine(trailing, chunks[chunks.length - 1]?.ts ?? new Date().toISOString());
  parser.reset?.();
  return entries;
}
