import type { ProviderTraceMetadata } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { decodeFrame, frameSummary, traceMetaLine, traceReadable, traceRows } from "./trace-model";

describe("provider trace rows", () => {
  it("describes requests and responses from their redacted bodies", () => {
    expect(
      frameSummary({ method: "POST", path: "/v1/messages", body: { model: "claude-opus-5-5", messages: [1, 2, 3], tools: [1, 2] } }, "request"),
    ).toBe("POST /v1/messages · claude-opus-5-5 · 3 messages · 2 tools");
    expect(
      frameSummary({ status: 200, body: { stop_reason: "tool_use", usage: { input_tokens: 1180, cache_read_input_tokens: 44906, output_tokens: 212 } } }, "response"),
    ).toBe("200 · stop: tool_use · 1,180 in · 44,906 cached · 212 out");
    expect(frameSummary(null, "stderr")).toBe("stderr");
  });

  it("keeps only frames, with their direction, size and what was withheld", () => {
    const rows = traceRows([
      { kind: "interpretation", frameId: 1 },
      {
        kind: "frame",
        frameId: 1,
        direction: "client_to_provider",
        timestamp: "2026-10-26T07:26:03Z",
        byteLength: 46_800,
        parsed: { body: { model: "m" } },
        withheldPaths: ["$.body.messages"],
        exactAvailable: true,
      },
    ]);
    expect(rows).toEqual([
      {
        frameId: 1,
        direction: "request",
        time: "2026-10-26T07:26:03Z",
        summary: "m",
        size: "46 KB",
        parsed: { body: { model: "m" } },
        withheld: ["$.body.messages"],
        exactAvailable: true,
      },
    ]);
  });
});

describe("trace metadata", () => {
  const trace = { frameCount: 38, byteCount: 2.1 * 1024 * 1024, provider: "anthropic", status: "complete" } as ProviderTraceMetadata;

  it("summarises a trace and knows when there's nothing left to open", () => {
    expect(traceMetaLine(trace)).toBe("38 frames · 2.1 MB · anthropic · Complete");
    expect(traceReadable(trace)).toBe(true);
    expect(traceReadable({ ...trace, status: "expired" })).toBe(false);
    expect(traceReadable(null)).toBe(false);
  });

  it("decodes a revealed frame, pretty-printing JSON", () => {
    expect(decodeFrame(btoa('{"a":1}'))).toBe('{\n  "a": 1\n}');
    expect(decodeFrame(btoa("plain"))).toBe("plain");
  });
});
