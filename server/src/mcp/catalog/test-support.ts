import { resolveAgentAccess, type AgentAccess } from "@paperclipai/shared";
import type { CatalogDispatch, McpCaller } from "./types.js";

/** Fixtures for the catalog's unit tests. */
export const TEST_COMPANY_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_AGENT_ID = "22222222-2222-4222-8222-222222222222";
export const TEST_RUN_ID = "33333333-3333-4333-8333-333333333333";
export const TEST_TASK_ID = "44444444-4444-4444-8444-444444444444";

export function testCaller(input: { kind?: "run" | "agent_key"; access?: AgentAccess } = {}): McpCaller {
  const kind = input.kind ?? "run";
  const runId = kind === "run" ? TEST_RUN_ID : null;
  return {
    kind,
    actor: { type: "agent", source: kind === "run" ? "agent_jwt" : "agent_key", agentId: TEST_AGENT_ID, companyId: TEST_COMPANY_ID, runId },
    companyId: TEST_COMPANY_ID,
    agentId: TEST_AGENT_ID,
    userId: null,
    runId,
    grantId: null,
    access: resolveAgentAccess(input.access ?? { level: "worker" }),
  };
}

export interface RecordedCall { method: string; path: string; body?: unknown }

/** A dispatch that records each call and answers with `respond` (default: `{}`). */
export function recordingDispatch(respond: (call: RecordedCall) => unknown = () => ({})): CatalogDispatch & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const dispatch = (async (method, path, body) => {
    const call: RecordedCall = body === undefined ? { method, path } : { method, path, body };
    calls.push(call);
    return respond(call);
  }) as CatalogDispatch & { calls: RecordedCall[] };
  dispatch.calls = calls;
  return dispatch;
}
