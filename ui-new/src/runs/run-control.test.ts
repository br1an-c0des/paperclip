import type { ToolRunDecision } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { requestStatusLabel, resolveInput, unanswerableReason } from "./runtime-requests";
import { decisionLookup, summarizeDecision } from "./tool-decisions";
import type { RuntimeRequest } from "./transcript-model";
import { silenceAge, silenceAlert, snoozedUntil, watchdogErrorMessage, watchdogInput } from "./watchdog";

/* What the run modal and the Runs section do to a run while it goes, checked without a server. */

const decision = (fields: Partial<ToolRunDecision> & { status?: string; approvalState?: string }): ToolRunDecision =>
  ({
    invocation: { id: "inv-1", status: fields.status ?? "succeeded", approvalState: fields.approvalState ?? "not_required" },
    actionRequest: null,
    auditEvents: [],
    latestAuditEvent: null,
    decision: null,
    outcome: null,
    reasonCode: null,
    denialReason: null,
    pendingAction: null,
    ...fields,
  }) as unknown as ToolRunDecision;

describe("tool decisions", () => {
  it("matches a call by invocation, then action request, then its tool-use id", () => {
    const allowed = decision({ decision: "allow" });
    const held = decision({
      invocation: { id: "inv-2", status: "pending", approvalState: "pending" } as ToolRunDecision["invocation"],
      actionRequest: { id: "act-9", status: "pending" } as ToolRunDecision["actionRequest"],
    });
    const find = decisionLookup([allowed, held]);
    expect(find({ invocationId: "inv-1" })).toBe(allowed);
    expect(find({ actionRequestId: "act-9" })).toBe(held);
    expect(find({ toolUseId: "inv-2" })).toBe(held);
    expect(find({ toolUseId: "other" })).toBeNull();
    expect(decisionLookup(undefined)({ invocationId: "inv-1" })).toBeNull();
  });

  it("puts the gateway's decision in a word", () => {
    expect(summarizeDecision(decision({ decision: "allow" }))).toMatchObject({ label: "Allowed", tone: "green" });
    expect(summarizeDecision(decision({ status: "denied", denialReason: "Not on the allow list" }))).toEqual({ label: "Denied", tone: "red", detail: "Not on the allow list" });
    expect(
      summarizeDecision(decision({ pendingAction: { actionRequestId: "abcdef123456", issueId: null, interactionId: null, approvalId: null, status: "pending", previewMarkdown: null } })),
    ).toMatchObject({ label: "Needs approval", tone: "amber", detail: "Action request abcdef12" });
    expect(summarizeDecision(decision({ status: "timed_out" }))).toMatchObject({ label: "Timed out", tone: "red" });
  });
});

const request = (fields: Partial<RuntimeRequest> = {}): RuntimeRequest => ({
  requestId: "q1",
  requestKind: "command_approval",
  turnId: "turn-1",
  requestType: "permission",
  status: "pending",
  prompt: "Run the migration?",
  choices: [
    { key: "accept", label: "Allow once" },
    { key: "decline", label: "Deny" },
  ],
  fields: [],
  ...fields,
});

describe("runtime requests", () => {
  it("sends a permission's choice as the action", () => {
    expect(resolveInput("r1", request(), { action: "accept" })).toEqual({
      runId: "r1",
      requestId: "q1",
      turnId: "turn-1",
      requestKind: "command_approval",
      resolution: { action: "accept" },
    });
  });

  it("sends input as answers for user input and as content for an elicitation", () => {
    const fields = [{ name: "branch", label: "Branch", placeholder: null }];
    const values = { action: "submit" as const, values: { branch: "main" } };
    expect(resolveInput("r1", request({ requestKind: "user_input", requestType: "input", fields }), values)).toMatchObject({
      resolution: { action: "submit", answers: { branch: { answers: ["main"] } } },
    });
    expect(resolveInput("r1", request({ requestKind: "elicitation", requestType: "input", fields }), values)).toMatchObject({
      resolution: { action: "submit", content: { branch: "main" } },
    });
    expect(resolveInput("r1", request(), values)).toEqual({ error: "This permission doesn't take written answers." });
  });

  it("says why a request can't be answered here", () => {
    expect(unanswerableReason(request(), true)).toBeNull();
    expect(unanswerableReason(request(), false)).toMatch(/run has ended/);
    expect(unanswerableReason(request({ turnId: null }), true)).toMatch(/missing/);
    expect(unanswerableReason(request({ questionSet: { schema: "paperclip.question_set.v1", questions: [] } }), true)).toMatch(/thread/);
    expect(unanswerableReason(request({ status: "resolved" }), false)).toBeNull();
    expect(resolveInput("r1", request({ requestKind: null }), { action: "accept" })).toEqual({ error: expect.any(String) });
  });

  it("labels an answered request with its choice", () => {
    expect(requestStatusLabel(request())).toBe("Waiting for an answer");
    expect(requestStatusLabel(request({ status: "resolved", resolvedAction: "accept" }))).toBe("Answered · Allow once");
    expect(requestStatusLabel(request({ status: "expired" }))).toBe("Expired");
  });
});

const silence = (level: string, fields: Record<string, unknown> = {}) =>
  ({
    lastOutputAt: null,
    lastOutputSeq: 0,
    lastOutputStream: null,
    silenceStartedAt: null,
    silenceAgeMs: 25 * 60_000,
    level,
    suspicionThresholdMs: 0,
    criticalThresholdMs: 0,
    snoozedUntil: null,
    evaluationIssueId: "eval-1",
    evaluationIssueIdentifier: "TES-99",
    evaluationIssueAssigneeAgentId: null,
    ...fields,
  }) as never;

describe("the output-silence watchdog", () => {
  it("warns only about going runs that are suspicious or critical", () => {
    expect(silenceAlert({ status: "running", outputSilence: silence("critical") })).toEqual({
      level: "critical",
      age: "25 minutes",
      evaluationIssueId: "eval-1",
      evaluationIssueIdentifier: "TES-99",
    });
    expect(silenceAlert({ status: "running", outputSilence: silence("ok") })).toBeNull();
    expect(silenceAlert({ status: "succeeded", outputSilence: silence("critical") })).toBeNull();
    expect(snoozedUntil({ status: "running", outputSilence: silence("snoozed", { snoozedUntil: "2026-10-28T12:00:00Z" }) })).toEqual(new Date("2026-10-28T12:00:00Z"));
  });

  it("reads silence ages as a person would say them", () => {
    expect(silenceAge(30_000)).toBe("under 1 minute");
    expect(silenceAge(60 * 60_000)).toBe("1 hour");
    expect(silenceAge(65 * 60_000)).toBe("1h 5m");
    expect(silenceAge(null)).toBeNull();
  });

  it("snoozes for an hour and names the evaluation task", () => {
    const alert = silenceAlert({ status: "running", outputSilence: silence("suspicious") })!;
    const now = Date.parse("2026-10-28T10:00:00Z");
    expect(watchdogInput("r1", alert, "snooze", now)).toEqual({
      runId: "r1",
      decision: "snooze",
      evaluationIssueId: "eval-1",
      snoozedUntil: "2026-10-28T11:00:00.000Z",
      reason: "Snoozed from the run",
    });
    expect(watchdogInput("r1", alert, "continue")).toEqual({ runId: "r1", decision: "continue", evaluationIssueId: "eval-1" });
  });

  it("explains a refusal", () => {
    expect(watchdogErrorMessage(new ApiError("Forbidden", 403, null))).toMatch(/Only the board/);
    expect(watchdogErrorMessage(new Error("Run not found"))).toBe("Run not found");
  });
});
