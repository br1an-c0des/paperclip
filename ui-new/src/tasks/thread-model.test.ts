import type { ActivityEvent, IssueComment } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { RunForIssue } from "@/api/issues";
import { activityLine } from "./activity-format";
import { buildThread, duration, stampLabel } from "./thread-model";

const names = {
  agent: (id: string) => ({ a1: "Ada", a2: "Ben" })[id],
  person: (id: string) => (id === "u2" ? "Cleo" : `User ${id}`),
  youId: () => "u1",
};

function comment(id: string, at: string, body = id) {
  return { id, body, createdAt: at, authorType: "user", authorUserId: "u1", authorAgentId: null } as unknown as IssueComment;
}

function event(id: string, at: string, action: string, details: Record<string, unknown> = {}, actor: Partial<ActivityEvent> = {}) {
  return { id, action, details, createdAt: at, actorType: "agent", actorId: "a1", agentId: "a1", ...actor } as unknown as ActivityEvent;
}

function run(id: string, status: string, startedAt: string, finishedAt: string | null, extra: Partial<RunForIssue> = {}) {
  return { runId: id, status, agentId: "a2", startedAt, finishedAt, createdAt: startedAt, ...extra } as RunForIssue;
}

describe("activityLine", () => {
  it("keeps a status change's statuses and words the rest of the update", () => {
    const line = activityLine(event("e1", "", "issue.updated", { status: "in_progress", priority: "high", _previous: { status: "todo", priority: "low" } }), names);
    expect(line).toEqual({ actor: "Ada", text: "changed the priority from low to high", status: { from: "todo", to: "in_progress" } });
  });

  it("leaves out comments, reads and updates with nothing to show", () => {
    expect(activityLine(event("e1", "", "issue.comment_added"), names)).toBeNull();
    expect(activityLine(event("e2", "", "issue.read_marked"), names)).toBeNull();
    expect(activityLine(event("e3", "", "issue.updated", { updatedAt: "x" }), names)).toBeNull();
  });

  it("names people, you and the system", () => {
    const you = activityLine(event("e1", "", "issue.created", {}, { actorType: "user", actorId: "u1", agentId: null }), names);
    const cleo = activityLine(event("e2", "", "issue.updated", { assigneeAgentId: "a2" }, { actorType: "user", actorId: "u2", agentId: null }), names);
    const system = activityLine(event("e3", "", "issue.released", {}, { actorType: "system", actorId: "system", agentId: null }), names);
    expect(you).toEqual({ actor: "You", text: "created this task" });
    expect(cleo).toEqual({ actor: "Cleo", text: "assigned Ben" });
    expect(system?.actor).toBe("Paperclip");
  });

  it("words blockers and documents", () => {
    expect(activityLine(event("e1", "", "issue.blockers_updated", { addedBlockedByIssues: [{ identifier: "TES-4" }] }), names)?.text).toBe("added blocker TES-4");
    expect(activityLine(event("e2", "", "issue.document_created", { key: "plan", title: "Plan" }), names)?.text).toBe("created a document: Plan");
  });
});

describe("buildThread", () => {
  it("merges comments, events and finished runs oldest first, grouping lines between comments", () => {
    const items = buildThread({
      comments: [comment("c2", "2026-10-01T12:00:00Z"), comment("c1", "2026-10-01T10:00:00Z")],
      events: [event("e1", "2026-10-01T09:00:00Z", "issue.created"), event("e2", "2026-10-01T11:00:00Z", "issue.checked_out")],
      runs: [run("r1", "succeeded", "2026-10-01T11:10:00Z", "2026-10-01T11:12:30Z"), run("r2", "running", "2026-10-01T12:30:00Z", null)],
      names,
    });
    expect(items.map((item) => (item.kind === "comment" ? item.comment.id : item.lines.map((line) => line.key)))).toEqual([
      ["event:e1"],
      "c1",
      ["event:e2", "run:r1"],
      "c2",
    ]);
    const runLine = items[2]!.kind === "lines" ? items[2].lines[1] : undefined;
    expect(runLine).toMatchObject({ actor: "Ben", text: "finished a run · 2m 30s", tone: "green", runId: "r1" });
  });

  it("holds back older events while earlier comments are left to load", () => {
    const items = buildThread({
      comments: [comment("c5", "2026-10-01T10:00:00Z")],
      events: [event("e1", "2026-10-01T09:00:00Z", "issue.created"), event("e2", "2026-10-01T11:00:00Z", "issue.checked_out")],
      runs: [],
      names,
      moreComments: true,
    });
    expect(items.map((item) => item.key)).toEqual(["comment:c5", "lines:event:e2"]);
  });

  it("shows a change repeated in a row once, with a count", () => {
    const items = buildThread({
      comments: [],
      events: [
        event("e1", "2026-10-01T09:00:00Z", "issue.updated", { labelIds: [] }),
        event("e2", "2026-10-01T09:01:00Z", "issue.updated", { labelIds: ["l1"] }),
        event("e3", "2026-10-01T09:02:00Z", "issue.updated", { labelIds: [] }),
        event("e4", "2026-10-01T09:03:00Z", "issue.created"),
      ],
      runs: [],
      names,
    });
    const lines = items[0]?.kind === "lines" ? items[0].lines : [];
    expect(lines.map((line) => [line.text, line.count])).toEqual([
      ["changed the labels", 3],
      ["created this task", undefined],
    ]);
    expect(lines[0]?.at.toISOString()).toBe("2026-10-01T09:02:00.000Z");
  });

  it("filters by kind and by search words", () => {
    const input = {
      comments: [comment("c1", "2026-10-01T10:00:00Z", "Ship the landing page")],
      events: [event("e1", "2026-10-01T09:00:00Z", "issue.created")],
      runs: [run("r1", "failed", "2026-10-01T11:00:00Z", "2026-10-01T11:00:45Z", { error: "Out of credit" })],
      names,
    };
    expect(buildThread({ ...input, filter: "comments" }).map((item) => item.key)).toEqual(["comment:c1"]);
    expect(buildThread({ ...input, filter: "changes" }).map((item) => item.kind)).toEqual(["lines"]);
    expect(buildThread({ ...input, search: "landing ship" }).map((item) => item.key)).toEqual(["comment:c1"]);
    const failed = buildThread({ ...input, search: "credit" });
    expect(failed[0]?.kind === "lines" && failed[0].lines[0]).toMatchObject({ text: "run failed · 45s: Out of credit", tone: "red" });
  });
});

describe("duration and stampLabel", () => {
  it("formats durations", () => {
    expect(duration("2026-10-01T10:00:00Z", "2026-10-01T10:00:45Z")).toBe("45s");
    expect(duration("2026-10-01T10:00:00Z", "2026-10-01T10:18:12Z")).toBe("18m 12s");
    expect(duration("2026-10-01T10:00:00Z", "2026-10-01T12:05:00Z")).toBe("2h 5m");
    expect(duration(null, "2026-10-01T10:00:00Z")).toBe("");
  });

  it("says today, yesterday, or the date", () => {
    const now = new Date(2026, 9, 26, 15, 0);
    expect(stampLabel(new Date(2026, 9, 26, 10, 31), now)).toBe("Today, 10:31 am");
    expect(stampLabel(new Date(2026, 9, 25, 21, 2), now)).toBe("Yesterday, 9:02 pm");
    expect(stampLabel(new Date(2026, 9, 12, 9, 14), now)).toBe("Oct 12, 9:14 am");
    expect(stampLabel(new Date(2025, 0, 3, 12, 0), now)).toBe("Jan 3, 2025, 12:00 pm");
  });
});
