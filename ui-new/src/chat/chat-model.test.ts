import type { IssueComment } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { Request } from "@/requests/request-model";
import { buildChat, quietRunText, shownReplies, statusTag, type ChatEntry, type ChatTask } from "./chat-model";

const NOW = new Date("2026-10-27T15:00:00");

function message(id: string, at: string, from: { user?: string; agent?: string }, body = id, runId: string | null = null) {
  return {
    id,
    body,
    createdAt: at,
    authorType: from.agent ? "agent" : "user",
    authorUserId: from.user ?? null,
    authorAgentId: from.agent ?? null,
    createdByRunId: runId,
  } as unknown as IssueComment;
}

function task(id: string, createdAt: string, extra: Partial<ChatTask> = {}): ChatTask {
  return { id, identifier: id.toUpperCase(), title: `Task ${id}`, status: "todo", projectId: null, assigneeAgentId: "a1", originRunId: null, createdAt, ...extra };
}

const kinds = (entries: ChatEntry[]) => entries.map((entry) => (entry.kind === "message" ? `${entry.head ? "M" : "m"}:${entry.comment.id}` : entry.kind === "day" ? `day:${entry.label}` : `${entry.kind}`));

describe("buildChat", () => {
  it("groups messages from one author close together under one header", () => {
    const entries = buildChat({
      comments: [
        message("c1", "2026-10-27T10:00:00", { user: "u1" }),
        message("c2", "2026-10-27T10:01:00", { user: "u1" }),
        message("c3", "2026-10-27T10:02:00", { agent: "a1" }),
        message("c4", "2026-10-27T10:20:00", { agent: "a1" }),
        message("c5", "2026-10-27T10:21:00", { agent: "a1" }),
      ],
      youId: "u1",
      now: NOW,
    });
    expect(kinds(entries)).toEqual(["day:Today", "M:c1", "m:c2", "M:c3", "M:c4", "m:c5"]);
    const first = entries[1] as Extract<ChatEntry, { kind: "message" }>;
    expect(first.author).toEqual({ kind: "you", id: "u1" });
  });

  it("puts a day line before each day and starts a new group after it", () => {
    const entries = buildChat({
      comments: [message("c1", "2026-10-26T23:58:00", { user: "u1" }), message("c2", "2026-10-27T00:01:00", { user: "u1" })],
      youId: "u1",
      now: NOW,
    });
    expect(kinds(entries)).toEqual(["day:Yesterday", "M:c1", "day:Today", "M:c2"]);
  });

  it("draws /new as a session line, not a message", () => {
    const entries = buildChat({
      comments: [
        message("c1", "2026-10-27T10:00:00", { user: "u1" }),
        message("c2", "2026-10-27T10:01:00", { user: "u1" }, " /new "),
        message("c3", "2026-10-27T10:02:00", { user: "u1" }),
      ],
      youId: "u1",
      now: NOW,
    });
    expect(kinds(entries)).toEqual(["day:Today", "M:c1", "session", "M:c3"]);
  });

  it("attaches a hand-off to the message from the run that made it, else places it on its own", () => {
    const entries = buildChat({
      comments: [message("c1", "2026-10-27T10:00:00", { user: "u1" }), message("c2", "2026-10-27T10:05:00", { agent: "a1" }, "Made a task", "run-1")],
      handoffs: [task("t1", "2026-10-27T10:04:00", { originRunId: "run-1" }), task("t2", "2026-10-27T10:03:00", { originRunId: "run-old" })],
      youId: "u1",
      now: NOW,
    });
    expect(kinds(entries)).toEqual(["day:Today", "M:c1", "handoff", "M:c2"]);
    const reply = entries[3] as Extract<ChatEntry, { kind: "message" }>;
    expect(reply.tasks.map((item) => item.id)).toEqual(["t1"]);
  });

  it("places reports when they finished, and holds back cards older than the loaded history", () => {
    const entries = buildChat({
      comments: [message("c1", "2026-10-27T10:00:00", { user: "u1" }), message("c2", "2026-10-27T12:00:00", { user: "u1" })],
      reports: [
        task("r1", "2026-10-27T08:00:00", { status: "done", completedAt: "2026-10-27T11:00:00" }),
        task("r2", "2026-10-20T08:00:00", { status: "done", completedAt: "2026-10-20T09:00:00" }),
      ],
      moreHistory: true,
      youId: "u1",
      now: NOW,
    });
    expect(kinds(entries)).toEqual(["day:Today", "M:c1", "report", "M:c2"]);
  });

  it("leaves out queued messages and sorts requests in time", () => {
    const request = { key: "req:1", state: "open", createdAt: new Date("2026-10-27T10:30:00") } as unknown as Request;
    const entries = buildChat({
      comments: [message("c1", "2026-10-27T10:00:00", { user: "u1" }), message("c2", "2026-10-27T11:00:00", { user: "u1" })],
      requests: [request],
      hiddenCommentIds: new Set(["c2"]),
      youId: "u1",
      now: NOW,
    });
    expect(kinds(entries)).toEqual(["day:Today", "M:c1", "request"]);
  });

  it("leaves a line for reply runs that ended without a message", () => {
    const run = (runId: string, status: string, finishedAt: string | null) => ({ runId, status, agentId: "a1", createdAt: "2026-10-27T10:00:00", startedAt: "2026-10-27T10:00:00", finishedAt });
    const entries = buildChat({
      comments: [message("c1", "2026-10-27T10:00:00", { user: "u1" }), message("c2", "2026-10-27T10:01:00", { agent: "a1" }, "hi", "r1")],
      runs: [run("r1", "succeeded", "2026-10-27T10:01:01"), run("r2", "failed", "2026-10-27T10:05:00"), run("r3", "running", null), run("r4", "succeeded", "2026-10-27T10:06:00")],
      liveRunIds: new Set(["r4"]),
      youId: "u1",
      now: NOW,
    });
    expect(kinds(entries)).toEqual(["day:Today", "M:c1", "M:c2", "run"]);
    expect(quietRunText({ status: "failed", error: "boom" })).toBe("couldn't reply: boom");
  });

  it("searches messages only", () => {
    const entries = buildChat({
      comments: [message("c1", "2026-10-27T10:00:00", { user: "u1" }, "funding rates"), message("c2", "2026-10-27T11:00:00", { agent: "a1" }, "OKX funding")],
      handoffs: [task("t1", "2026-10-27T10:30:00")],
      search: "okx",
      youId: "u1",
      now: NOW,
    });
    expect(kinds(entries)).toEqual(["M:c2"]);
  });
});

describe("shownReplies", () => {
  const now = new Date("2026-10-27T12:00:30Z");
  it("keeps a running reply, and a finished one until its message arrives or the wait runs out", () => {
    const turns = [
      { runId: "r1", status: "running", finishedAt: null },
      { runId: "r2", status: "succeeded", finishedAt: "2026-10-27T12:00:20Z" },
      { runId: "r3", status: "succeeded", finishedAt: "2026-10-27T12:00:25Z" },
      { runId: "r4", status: "failed", finishedAt: "2026-10-27T11:59:00Z" },
    ];
    const comments = [message("c1", "2026-10-27T12:00:21Z", { agent: "a1" }, "done", "r2")];
    expect(shownReplies(turns, comments, now).map((turn) => turn.runId)).toEqual(["r1", "r3"]);
  });

  it("matches a message by its derived run too", () => {
    const comments = [{ createdByRunId: null, derivedCreatedByRunId: "r1" }];
    expect(shownReplies([{ runId: "r1", status: "succeeded", finishedAt: now }], comments, now)).toEqual([]);
  });
});

describe("statusTag", () => {
  it("writes the status the way the card does", () => {
    expect(statusTag("in_progress")).toBe("IN PROGRESS");
  });
});
