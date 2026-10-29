import type { GetSummarySlotResponse, SummarySlotRevision } from "@paperclipai/shared";
import type { BuiltInAgentSummary } from "./summary-api";

/*
 * The AI brief's pure logic (board 8's Brief, M12), after ui/src/components/SummarySlotCard.tsx:
 * which revision is shown, the earlier ones to pick from, whether the Summarizer is at work, and
 * what to say when it isn't set up.
 */

export const SUMMARIZER_KEY = "summarizer";

/** The old card offers 30 revisions at most, the latest included. */
const MAX_REVISIONS = 30;

/** Where the Summarizer stands, for the note above the brief. */
export type SummarizerState =
  /** Not provisioned or missing its harness: someone sets it up under Manage agents. */
  | { kind: "setup"; name: string }
  | { kind: "pending"; name: string }
  | { kind: "paused"; name: string; agentId: string }
  | { kind: "ready" }
  /** Built-in agents are off or the list didn't load: existing summaries show, nothing new can be asked for. */
  | { kind: "unknown" };

export function summarizerState(builtIns: readonly BuiltInAgentSummary[] | undefined): SummarizerState {
  const entry = builtIns?.find((item) => item.definition.key === SUMMARIZER_KEY);
  if (!entry) return { kind: "unknown" };
  const name = entry.definition.displayName || "Summarizer";
  if (entry.status === "not_provisioned" || entry.status === "needs_setup") return { kind: "setup", name };
  if (entry.status === "pending_approval") return { kind: "pending", name };
  const agentId = entry.agent?.id ?? entry.agentId;
  if (entry.status === "paused" && agentId) return { kind: "paused", name, agentId };
  return { kind: "ready" };
}

/** The Summarizer is writing a new revision in an open task. */
export function isGenerating(response: GetSummarySlotResponse | undefined) {
  const issue = response?.generatingIssue;
  return response?.slot?.status === "generating" && !!issue && issue.status !== "done" && issue.status !== "cancelled";
}

export type BriefRevision = { id: string; number: number; createdAt: string };

export type BriefView = {
  body: string;
  /** The revision shown, when the revisions have loaded. */
  shown: BriefRevision | null;
  /** When it was written: the shown revision's time, or the document's. */
  at: string | null;
  /** An earlier revision is shown instead of the latest. */
  historical: boolean;
  latestNumber: number;
  /** Earlier revisions, newest first, for History. */
  earlier: BriefRevision[];
};

const revision = (entry: SummarySlotRevision): BriefRevision => ({
  id: entry.id,
  number: entry.revisionNumber,
  createdAt: new Date(entry.createdAt).toISOString(),
});

/** The brief to show: the latest, or the earlier revision picked in History. Null with no summary yet. */
export function briefView(
  response: GetSummarySlotResponse | undefined,
  revisions: readonly SummarySlotRevision[] | undefined,
  selectedId: string | null,
): BriefView | null {
  const document = response?.document;
  if (!document) return null;
  const list = revisions ?? [];
  const latest = list.find((entry) => entry.id === document.latestRevisionId) ?? null;
  const picked = selectedId && selectedId !== document.latestRevisionId ? (list.find((entry) => entry.id === selectedId) ?? null) : null;
  const shown = picked ?? latest;
  return {
    body: picked?.body ?? document.body,
    shown: shown ? revision(shown) : null,
    at: new Date(shown?.createdAt ?? document.updatedAt).toISOString(),
    historical: picked !== null,
    latestNumber: document.latestRevisionNumber,
    earlier: list
      .filter((entry) => entry.id !== document.latestRevisionId)
      .sort((a, b) => b.revisionNumber - a.revisionNumber)
      .slice(0, MAX_REVISIONS - 1)
      .map(revision),
  };
}

/** "just now", "12m ago", "3h ago", "2d ago", then "Oct 12". */
export function generatedAgo(value: string, now: Date = new Date()) {
  const date = new Date(value);
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
