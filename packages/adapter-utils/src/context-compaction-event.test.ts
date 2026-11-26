import { describe, expect, it } from "vitest";
import { contextCompactedRunEvent } from "./context-compaction-event.js";

describe("contextCompactedRunEvent", () => {
  const base = {
    compactionId: "c-1",
    trigger: "auto",
    preTokens: 118000,
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
      postTokens: null,
      sameSession: true,
    });
  });

  it("gives the reason \"provider\" when the trigger is unknown", () => {
    const event = contextCompactedRunEvent({ ...base, trigger: null, preTokens: null, sessionId: null });
    const envelope = event.payload?.prpEvent as Record<string, unknown>;
    expect((envelope.payload as Record<string, unknown>).reason).toBe("provider");
    expect((envelope.payload as Record<string, unknown>).preTokens).toBeNull();
    expect(envelope.normalizedSessionId).toBeNull();
  });
});
