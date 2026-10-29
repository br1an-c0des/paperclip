import type { ResolveRuntimeRequestInput, RuntimeRequestResolution } from "@/api/heartbeats";
import type { RuntimeRequest } from "./transcript-model";

/*
 * Answering a runtime request: a native run's harness stopping mid-turn to ask for permission (run
 * this command, write this file) or for input (fields to fill in). After the old UI's task thread
 * (ui/src/components/TaskChatThread.tsx, the runtime branch of its pending inputs):
 *
 * - A permission is answered with one of its choices, sent as the action (allow once, allow for the
 *   session, deny, cancel).
 * - Input is submitted as the fields' values: `answers` for a harness's user-input request,
 *   `content` for an MCP elicitation.
 * - A request with a question set becomes a question card in the task thread, which owns the
 *   answer, so it isn't answered here.
 *
 * The server needs the provider turn and the request kind to route the answer; a request missing
 * either can't be answered.
 */

export type RequestAnswer = { action: string } | { action: "submit"; values: Record<string, string> };

/** Why the request can't be answered from the run modal, or null when it can. */
export function unanswerableReason(request: RuntimeRequest, runActive: boolean): string | null {
  if (request.status !== "pending") return null;
  if (!runActive) return "The run has ended, so this request can't be answered any more.";
  if (request.questionSet) return "Answer it in the task's thread, where it shows as a question.";
  if (!request.turnId || !request.requestKind) return "This request is missing what's needed to answer it.";
  if (request.requestType === "input" && request.fields.length === 0) return "This request asks for input without any fields to fill in.";
  return null;
}

/** The request body for an answer, or an error to show. */
export function resolveInput(runId: string, request: RuntimeRequest, answer: RequestAnswer): ResolveRuntimeRequestInput | { error: string } {
  if (!request.turnId || !request.requestKind) return { error: "This request is missing what's needed to answer it." };
  let resolution: RuntimeRequestResolution;
  if (!("values" in answer)) {
    resolution = { action: answer.action as "accept" | "accept_for_session" | "decline" | "cancel" };
  } else if (request.requestKind === "user_input") {
    resolution = { action: "submit", answers: Object.fromEntries(Object.entries(answer.values).map(([field, value]) => [field, { answers: [value] }])) };
  } else if (request.requestKind === "elicitation") {
    resolution = { action: "submit", content: answer.values };
  } else {
    return { error: "This permission doesn't take written answers." };
  }
  return { runId, requestId: request.requestId, turnId: request.turnId, requestKind: request.requestKind, resolution };
}

const STATUS_LABEL: Record<RuntimeRequest["status"], string> = {
  pending: "Waiting for an answer",
  resolved: "Answered",
  expired: "Expired",
  cancelled: "Cancelled",
};

/** "Answered · Allow once", "Expired". */
export function requestStatusLabel(request: RuntimeRequest) {
  const choice = request.resolvedAction ? request.choices.find((option) => option.key === request.resolvedAction)?.label ?? request.resolvedAction : null;
  return choice && request.status !== "pending" ? `${STATUS_LABEL[request.status]} · ${choice}` : STATUS_LABEL[request.status];
}
