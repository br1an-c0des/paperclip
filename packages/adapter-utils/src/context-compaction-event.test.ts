import { describe, expect, it } from "vitest";
import { acpCompactionMarkerEvent, contextCompactedRunEvent } from "./context-compaction-event.js";

describe("contextCompactedRunEvent", () => {
  const base = {
    compactionId: "c-1",
    trigger: "auto",
    preTokens: 118000,
    postTokens: 21000,
    sessionId: "s-1",
    emittedAt: "2026-11-25T10:00:00.000Z",
    sourceKind: "claude_local" as const,
  };

  it("builds the run event in the envelope the compaction readers take", () => {
    const event = contextCompactedRunEvent(base);
    expect(event).toMatchObject({
      eventType: "context.compacted",
      stream: "system",
      level: "info",
      message: "Context compacted",
    });
    const envelope = event.payload?.prpEvent as Record<string, unknown>;
    expect(envelope.schema).toBe("paperclip.prp.event.v1");
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.eventType).toBe("context.compacted");
    expect(envelope.sourceKind).toBe("claude_local");
    expect(envelope.normalizedSessionId).toBe("s-1");
    expect(envelope.emittedAt).toBe("2026-11-25T10:00:00.000Z");
    expect(envelope.payload).toEqual({
      schema: "paperclip.context.compacted.v1",
      compactionId: "c-1",
      reason: "auto",
      preTokens: 118000,
      postTokens: 21000,
      sameSession: true,
    });
  });

  it("gives the reason \"provider\" when the trigger is unknown, and leaves unknown sizes out", () => {
    const event = contextCompactedRunEvent({ ...base, trigger: null, preTokens: null, postTokens: null, sessionId: null });
    const envelope = event.payload?.prpEvent as Record<string, unknown>;
    expect((envelope.payload as Record<string, unknown>).reason).toBe("provider");
    // The server's redaction masks a token-count key that isn't a finite number, so no null.
    expect(envelope.payload).not.toHaveProperty("preTokens");
    expect(envelope.payload).not.toHaveProperty("postTokens");
    expect(envelope.normalizedSessionId).toBeNull();
  });
});

describe("acpCompactionMarkerEvent", () => {
  const now = () => new Date("2026-11-25T10:00:00.000Z");
  const inner = (event: ReturnType<typeof acpCompactionMarkerEvent>) =>
    (event?.payload?.prpEvent as { payload: Record<string, unknown> }).payload;

  it("reads the patched agent's marker", () => {
    const event = acpCompactionMarkerEvent({ paperclip: { compacted: { trigger: "auto", preTokens: 150000, postTokens: 20000, compactionId: "c-9" } } }, "s-2", now);
    expect(event?.eventType).toBe("context.compacted");
    expect((event?.payload?.prpEvent as Record<string, unknown>).normalizedSessionId).toBe("s-2");
    expect(inner(event)).toMatchObject({ compactionId: "c-9", reason: "auto", preTokens: 150000, postTokens: 20000 });
  });

  it("gives null without the marker", () => {
    expect(acpCompactionMarkerEvent(undefined, "s-2", now)).toBeNull();
    expect(acpCompactionMarkerEvent({ usage: { input_tokens: 1 } }, "s-2", now)).toBeNull();
    expect(acpCompactionMarkerEvent({ paperclip: { compacted: "yes" } }, "s-2", now)).toBeNull();
  });

  it("drops fields of the wrong type and bounds the strings", () => {
    const event = acpCompactionMarkerEvent({ paperclip: { compacted: { trigger: 7, preTokens: "lots", postTokens: -1, compactionId: "x".repeat(500) } } }, "s-2", now);
    expect(inner(event)).toMatchObject({ reason: "provider" });
    expect(inner(event)).not.toHaveProperty("preTokens");
    expect(inner(event)).not.toHaveProperty("postTokens");
    expect((inner(event).compactionId as string).length).toBe(200);
    expect(inner(acpCompactionMarkerEvent({ paperclip: { compacted: {} } }, "s-2", now)).compactionId).toBe("s-2:2026-11-25T10:00:00.000Z");
  });
});
