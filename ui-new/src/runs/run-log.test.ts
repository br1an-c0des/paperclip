import { describe, expect, it } from "vitest";
import { logAsText, mergeChunks, parseLogSlice, streamCounts, utf8Length, type RunLogChunk } from "./run-log";

const record = (seq: number, chunk: string, stream = "stdout") => JSON.stringify({ ts: `2026-10-26T10:00:0${seq}Z`, stream, chunk, seq });

describe("parseLogSlice", () => {
  it("reads records and carries an unfinished one over to the next slice", () => {
    const first = parseLogSlice(`${record(1, "a")}\n${record(2, "b", "stderr")}\n{"ts":"2026`);
    expect(first.chunks.map((chunk) => [chunk.seq, chunk.stream, chunk.chunk])).toEqual([
      [1, "stdout", "a"],
      [2, "stderr", "b"],
    ]);
    const second = parseLogSlice(`-10-26T10:00:03Z","stream":"system","chunk":"c","seq":3}\n`, first.rest);
    expect(second.chunks).toEqual([{ ts: "2026-10-26T10:00:03Z", stream: "system", chunk: "c", seq: 3 }]);
    expect(second.rest).toBe("");
  });

  it("skips a fragment from reading mid-file, malformed rows and empty chunks", () => {
    const { chunks } = parseLogSlice(`unk":"tail of a record"}\nnot json\n${JSON.stringify({ ts: "x", chunk: "" })}\n${record(4, "d")}\n`);
    expect(chunks.map((chunk) => chunk.chunk)).toEqual(["d"]);
  });
});

describe("mergeChunks", () => {
  const chunk = (seq: number | undefined, text: string): RunLogChunk => ({ ts: "t", stream: "stdout", chunk: text, ...(seq === undefined ? {} : { seq }) });

  it("drops chunks it already has, by sequence number or by content", () => {
    const start = [chunk(1, "a"), chunk(undefined, "note")];
    expect(mergeChunks(start, [chunk(1, "a"), chunk(undefined, "note")])).toBe(start);
  });

  it("keeps the longer copy of a sequence number, since the socket's copy can be cut short", () => {
    const merged = mergeChunks([chunk(1, "hel")], [chunk(1, "hello")]);
    expect(merged.map((item) => item.chunk)).toEqual(["hello"]);
  });

  it("puts late sequenced chunks in order and appends the rest", () => {
    const merged = mergeChunks([chunk(1, "a"), chunk(3, "c")], [chunk(2, "b"), chunk(4, "d"), chunk(undefined, "x")]);
    expect(merged.map((item) => item.chunk)).toEqual(["a", "b", "c", "d", "x"]);
  });
});

describe("helpers", () => {
  it("counts streams, writes a plain-text log and measures UTF-8", () => {
    const chunks: RunLogChunk[] = [
      { ts: "t1", stream: "stdout", chunk: "out\n" },
      { ts: "t2", stream: "stderr", chunk: "err" },
    ];
    expect(streamCounts(chunks)).toEqual({ stdout: 1, stderr: 1, system: 0 });
    expect(logAsText(chunks)).toBe("t1 stdout out\nt2 stderr err");
    expect(utf8Length("a→b")).toBe(5);
  });
});
