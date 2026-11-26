import { describe, expect, it } from "vitest";
import { contextCompactedRunEvent } from "@paperclipai/adapter-utils";
import { REDACTED_EVENT_VALUE } from "../../redaction.js";
import { prepareHeartbeatRunEventPayloadForStorage } from "./run-log.js";

// A claude_local compaction event (bug 96) as the run's event store keeps it: the redaction it
// passes through lets token-count keys through only as finite numbers, so the event leaves an
// unknown size out rather than writing null.

const base = {
  compactionId: "b1529e2c-c9de-468e-bb1e-89772abdfa45",
  trigger: "manual",
  sessionId: "10632812-510b-4a83-a708-a5031e2982d7",
  emittedAt: "2026-11-25T12:00:00.000Z",
  sourceKind: "claude_local" as const,
};

const stored = (event: ReturnType<typeof contextCompactedRunEvent>) =>
  prepareHeartbeatRunEventPayloadForStorage(event.eventType, event.payload!);

describe("a context.compacted event in storage", () => {
  it("keeps every field of an event with unknown sizes", () => {
    const event = contextCompactedRunEvent({ ...base, preTokens: null, postTokens: null });
    const payload = stored(event);
    expect(JSON.stringify(payload)).not.toContain(REDACTED_EVENT_VALUE);
    expect(payload).toEqual(event.payload);
  });

  it("keeps the sizes when Claude reports them", () => {
    const event = contextCompactedRunEvent({ ...base, preTokens: 41_981, postTokens: 10_166 });
    const payload = stored(event);
    expect(JSON.stringify(payload)).not.toContain(REDACTED_EVENT_VALUE);
    expect((payload.prpEvent as { payload: Record<string, unknown> }).payload).toMatchObject({ preTokens: 41_981, postTokens: 10_166 });
  });

  it("would mask an explicit null size, which is why the event leaves it out", () => {
    const event = contextCompactedRunEvent({ ...base, preTokens: 41_981, postTokens: 10_166 });
    const inner = (event.payload!.prpEvent as { payload: Record<string, unknown> }).payload;
    inner.postTokens = null;
    expect((stored(event).prpEvent as { payload: Record<string, unknown> }).payload.postTokens).toBe(REDACTED_EVENT_VALUE);
  });
});
