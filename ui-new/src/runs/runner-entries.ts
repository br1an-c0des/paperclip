import type { TranscriptEntry } from "@paperclipai/adapter-utils";
import { proposedPlanMarkdown } from "./activity-model";
import { contextSignal, createCompactionTracker } from "./compactions";
import { createPaperclipRunnerParser } from "./paperclip-runner-parser";

/*
 * The runner's log through the copied parser (paperclip-runner-parser.ts), plus the two event shapes
 * the old UI reads only from stored events (ui/src/components/transcript/native-run-events.ts), so a
 * run's log gives the run modal and the live reply the same rows as the old task chat:
 *
 * - a verification check (`item.completed` of kind `verification`, upstream #19262), which the
 *   parser would show as a plain line, becomes a `verification` activity;
 * - Codex's plan-mode deltas (`item.delta` of kind `plan`, #19291), which the parser would show as
 *   a line per delta, build up one streaming `plan_proposal` until `plan.proposed` completes it;
 * - a context compaction (`context.compacted`, U58), which the parser would show as a generic
 *   activity, becomes one "Context compacted" activity sized from the context readings around it
 *   (compactions.ts, as for the task thread's dividers), once per compaction. Its "after" size can
 *   come from a later reading, filled in on the same payload as the rest of the log is read.
 *
 * The copy itself stays as upstream has it, so it can be checked line for line at each sync.
 */

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord => (value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {});
const text = (value: unknown) => (typeof value === "string" ? value : undefined);

export function createRunnerTranscriptParser() {
  const parser = createPaperclipRunnerParser();
  let proposals = new Map<string, string>();
  let completed = new Set<string>();
  let compactions = createCompactionTracker();

  const extra = (line: string, ts: string): TranscriptEntry[] | null => {
    if (!line.includes("paperclip.prp.event")) return null;
    let envelope: JsonRecord;
    try {
      envelope = record(JSON.parse(line));
    } catch {
      return null;
    }
    if (envelope.type !== "paperclip.prp.event") return null;
    const event = record(envelope.event);
    const eventType = text(event.eventType);
    const payload = record(event.payload);
    const itemId = text(event.itemId) ?? text(record(payload.item).id) ?? null;

    const context = contextSignal(event);
    if (context?.kind === "reading") {
      // The parser still reads the usage item; only its context size is noted here.
      compactions.reading(context.usedTokens);
      return null;
    }
    if (context?.kind === "compacted") {
      const compaction = compactions.compacted(context, { ...payload });
      if (!compaction) return [];
      return [{ kind: "provider_activity", ts, family: "context", eventType: "context.compacted", status: "completed", title: "Context compacted", summary: "Context compacted", payload: compaction }];
    }

    if (eventType === "item.completed" && payload.kind === "verification") {
      const check = record(payload.verification);
      const commandOrCheck = text(check.commandOrCheck)?.trim();
      if (!commandOrCheck) return null;
      const status = check.status === "passed" || check.status === "failed" ? check.status : "not_run";
      return [
        {
          kind: "provider_activity",
          ts,
          family: "verification",
          eventType: "verification.recorded",
          status: status === "passed" ? "completed" : status === "failed" ? "failed" : "informational",
          title: "Verification",
          summary: commandOrCheck,
          payload: {
            verificationId: itemId ?? `${commandOrCheck}:${ts}`,
            commandOrCheck,
            status,
            detail: text(check.detail)?.trim() || null,
            reasonCode: status === "not_run" ? text(check.reasonCode)?.trim() || null : null,
          },
        },
      ];
    }

    if (eventType === "item.delta" && itemId && text(payload.kind)?.replaceAll("_", "").toLowerCase() === "plan") {
      if (completed.has(itemId)) return [];
      const delta = text(payload.text) ?? text(record(payload.update).delta) ?? text(payload.delta) ?? "";
      const markdown = (proposals.get(itemId) ?? "") + delta;
      proposals.set(itemId, markdown);
      return [proposalEntry(ts, itemId, proposedPlanMarkdown(markdown), false)];
    }

    if (eventType === "plan.proposed") {
      const proposalId = text(payload.proposalId);
      if (!proposalId) return null;
      const done = payload.status === "completed";
      if (done) completed.add(proposalId);
      // A completed proposal is already the unwrapped document; a streaming one may not carry it.
      const markdown = text(payload.markdown) ?? proposedPlanMarkdown(proposals.get(proposalId) ?? "");
      proposals.set(proposalId, markdown);
      return [proposalEntry(ts, proposalId, markdown, done, payload)];
    }
    return null;
  };

  return {
    parseLine: (line: string, ts: string) => extra(line, ts) ?? parser.parseLine(line, ts),
    reset: () => {
      parser.reset();
      proposals = new Map();
      completed = new Set();
      compactions = createCompactionTracker();
    },
  };
}

function proposalEntry(ts: string, proposalId: string, markdown: string, done: boolean, payload: JsonRecord = {}): TranscriptEntry {
  return {
    kind: "provider_activity",
    ts,
    family: "plan_proposal",
    eventType: "plan.proposed",
    status: done ? "completed" : "running",
    title: "Plan",
    summary: done ? "Proposed a plan" : "Writing a plan",
    payload: { ...payload, proposalId, markdown, status: done ? "completed" : "streaming" },
  };
}
