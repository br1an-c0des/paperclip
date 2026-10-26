/*
 * A run's output as chunks, from two sources that overlap: the stored log (`GET
 * /heartbeat-runs/:id/log`, newline-delimited JSON records read by byte offset) and the live-events
 * socket (`heartbeat.run.log`). The rules follow ui/src/lib/run-log-chunks.ts: records with a
 * server sequence number are ordered and de-duplicated by it; records without one are
 * de-duplicated by their content and keep arrival order.
 */

export type RunLogStream = "stdout" | "stderr" | "system";

export type RunLogChunk = { ts: string; stream: RunLogStream; chunk: string; seq?: number };

export function readStream(value: unknown): RunLogStream {
  return value === "stderr" || value === "system" ? value : "stdout";
}

export function readSeq(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Parses a slice of the stored log. A slice can end mid-record; the unfinished tail is returned as
 * `rest`, to be put in front of the next slice. A slice read from the middle of the file starts
 * mid-record too: that fragment isn't valid JSON and is skipped.
 */
export function parseLogSlice(content: string, carried = ""): { chunks: RunLogChunk[]; rest: string } {
  const lines = `${carried}${content}`.split("\n");
  const rest = lines.pop() ?? "";
  const chunks: RunLogChunk[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as { ts?: unknown; stream?: unknown; chunk?: unknown; seq?: unknown };
      if (typeof raw.chunk !== "string" || !raw.chunk) continue;
      const seq = readSeq(raw.seq);
      chunks.push({
        ts: typeof raw.ts === "string" ? raw.ts : new Date().toISOString(),
        stream: readStream(raw.stream),
        chunk: raw.chunk,
        ...(seq === undefined ? {} : { seq }),
      });
    } catch {
      // A partial or malformed record.
    }
  }
  return { chunks, rest };
}

function contentKey(chunk: RunLogChunk) {
  return `${chunk.ts}\u0000${chunk.stream}\u0000${chunk.chunk}`;
}

/**
 * Adds incoming chunks to a run's chunks. Returns the same array when nothing was new, so callers
 * can skip work. A chunk whose sequence number is already present is dropped, unless the incoming
 * copy is longer (the socket's copy can be cut short); sequenced chunks go in sequence order.
 */
export function mergeChunks(previous: readonly RunLogChunk[], incoming: readonly RunLogChunk[]): readonly RunLogChunk[] {
  if (incoming.length === 0) return previous;
  const next = [...previous];
  const bySeq = new Map<number, number>();
  const keys = new Set<string>();
  next.forEach((chunk, index) => {
    if (chunk.seq !== undefined) bySeq.set(chunk.seq, index);
    else keys.add(contentKey(chunk));
  });
  let changed = false;
  for (const chunk of incoming) {
    if (chunk.seq === undefined) {
      const key = contentKey(chunk);
      if (keys.has(key)) continue;
      keys.add(key);
      next.push(chunk);
      changed = true;
      continue;
    }
    const existing = bySeq.get(chunk.seq);
    if (existing !== undefined) {
      if (chunk.chunk.length > next[existing]!.chunk.length) {
        next[existing] = chunk;
        changed = true;
      }
      continue;
    }
    // Insert after the last chunk with a lower sequence number, so late arrivals land in order.
    let at = next.length;
    while (at > 0) {
      const before = next[at - 1]!;
      if (before.seq === undefined || before.seq < chunk.seq) break;
      at -= 1;
    }
    if (at === next.length) {
      next.push(chunk);
      bySeq.set(chunk.seq, at);
    } else {
      next.splice(at, 0, chunk);
      bySeq.clear();
      next.forEach((item, index) => item.seq !== undefined && bySeq.set(item.seq, index));
    }
    changed = true;
  }
  return changed ? next : previous;
}

export function streamCounts(chunks: readonly RunLogChunk[]) {
  const counts: Record<RunLogStream, number> = { stdout: 0, stderr: 0, system: 0 };
  for (const chunk of chunks) counts[chunk.stream] += 1;
  return counts;
}

/** The loaded output as plain text, one record per line, for "Download log". */
export function logAsText(chunks: readonly RunLogChunk[]) {
  return chunks.map((chunk) => `${chunk.ts} ${chunk.stream.padEnd(6)} ${chunk.chunk.replace(/\n$/, "")}`).join("\n");
}

/** Byte length of a string as UTF-8, to advance log offsets correctly past non-ASCII output. */
export function utf8Length(text: string) {
  return new TextEncoder().encode(text).length;
}
