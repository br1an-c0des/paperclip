import type { ProviderTraceMetadata } from "@paperclipai/shared";
import type { ProviderTraceEntry } from "@/api/runs";
import { formatBytes } from "./run-model";

/*
 * The Provider trace view (board 16, `view` = trace): a trace's frames as rows. Frames come from
 * the server with bodies withheld (`parsed`), so a row describes the request or response from what
 * is left: the method and model, how many messages and tools, the stop reason and token counts.
 */

export type TraceRow = {
  frameId: number;
  direction: "request" | "response" | "stderr";
  time: string | null;
  summary: string;
  size: string;
  parsed: unknown;
  withheld: string[];
  exactAvailable: boolean;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const count = (value: unknown) => (Array.isArray(value) ? value.length : null);

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** A one-line description of a frame's parsed body. */
export function frameSummary(parsed: unknown, direction: TraceRow["direction"]): string {
  const body = record(parsed);
  if (!body) return typeof parsed === "string" ? parsed.slice(0, 120) : direction;
  const parts: string[] = [];
  const method = typeof body.method === "string" ? body.method : null;
  const path = typeof body.path === "string" ? body.path : typeof body.url === "string" ? body.url : null;
  if (method || path) parts.push([method, path].filter(Boolean).join(" "));
  const inner = record(body.body) ?? body;
  if (typeof inner.model === "string") parts.push(inner.model);
  const messages = count(inner.messages) ?? count(inner.input);
  if (messages !== null) parts.push(plural(messages, "message"));
  const tools = count(inner.tools);
  if (tools !== null) parts.push(plural(tools, "tool"));
  if (typeof body.status === "number") parts.push(String(body.status));
  const stop = inner.stop_reason ?? inner.finish_reason ?? inner.stopReason;
  if (typeof stop === "string") parts.push(`stop: ${stop}`);
  const usage = record(inner.usage);
  if (usage) {
    const n = (key: string) => (typeof usage[key] === "number" ? (usage[key] as number) : null);
    const input = n("input_tokens") ?? n("prompt_tokens");
    const cached = n("cache_read_input_tokens");
    const output = n("output_tokens") ?? n("completion_tokens");
    if (input !== null) parts.push(`${input.toLocaleString()} in`);
    if (cached) parts.push(`${cached.toLocaleString()} cached`);
    if (output !== null) parts.push(`${output.toLocaleString()} out`);
  }
  if (typeof inner.type === "string" && parts.length === 0) parts.push(inner.type);
  return parts.join(" · ") || Object.keys(body).slice(0, 4).join(", ");
}

export function traceRows(entries: readonly ProviderTraceEntry[]): TraceRow[] {
  return entries
    .filter((entry) => entry.kind === "frame" && typeof entry.frameId === "number")
    .map((entry) => {
      const direction: TraceRow["direction"] =
        entry.direction === "client_to_provider" ? "request" : entry.direction === "provider_to_client" ? "response" : "stderr";
      return {
        frameId: entry.frameId!,
        direction,
        time: typeof entry.timestamp === "string" ? entry.timestamp : null,
        summary: frameSummary(entry.parsed, direction),
        size: typeof entry.byteLength === "number" ? formatBytes(entry.byteLength) : "",
        parsed: entry.parsed ?? null,
        withheld: Array.isArray(entry.withheldPaths) ? entry.withheldPaths : [],
        exactAvailable: entry.exactAvailable === true,
      };
    });
}

const STATUS: Record<ProviderTraceMetadata["status"], string> = {
  capturing: "Recording",
  complete: "Complete",
  incomplete: "Incomplete",
  truncated: "Cut short at 64 MiB",
  deleted: "Deleted",
  expired: "Expired",
};

/** "38 frames · 2.1 MB · anthropic · Complete". */
export function traceMetaLine(trace: ProviderTraceMetadata) {
  return [plural(trace.frameCount, "frame"), formatBytes(trace.byteCount), trace.provider, STATUS[trace.status] ?? trace.status]
    .filter(Boolean)
    .join(" · ");
}

/** Whether there's a trace to open: deleted and expired ones have nothing left. */
export function traceReadable(trace: ProviderTraceMetadata | null | undefined) {
  return !!trace && trace.status !== "deleted" && trace.status !== "expired";
}

/** Decodes a revealed frame's bytes, pretty-printing JSON. */
export function decodeFrame(rawBase64: string) {
  let text: string;
  try {
    const bytes = Uint8Array.from(atob(rawBase64), (char) => char.charCodeAt(0));
    text = new TextDecoder().decode(bytes);
  } catch {
    return rawBase64;
  }
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
