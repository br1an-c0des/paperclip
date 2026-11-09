import type { IssueComment } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { Request } from "@/requests/request-model";
import {
  badgeCount,
  buildChat,
  chatDocumentLink,
  chatMessageSource,
  documentHash,
  documentKeyFromHash,
  newestUnreadable,
  openChatAgentKey,
  quietRunText,
  readThrough,
  shownReplies,
  statusTag,
  unreadChatCounts,
  unreadMessagesLabel,
  yourChatAgent,
  type ChatEntry,
  type ChatTask,
} from "./chat-model";

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

  it("draws the chat's documents where they were first saved, inside the loaded history", () => {
    const doc = (id: string, createdAt: string) => ({
      id,
      key: id,
      title: null,
      latestRevisionNumber: 1,
      createdByAgentId: "a1",
      createdByUserId: null,
      createdAt,
      updatedAt: "2026-10-27T12:00:00",
    });
    const entries = buildChat({
      comments: [message("c1", "2026-10-27T10:00:00", { user: "u1" }), message("c2", "2026-10-27T10:10:00", { agent: "a1" })],
      documents: [doc("plan", "2026-10-27T10:05:00"), doc("old", "2026-10-26T09:00:00")],
      moreHistory: true,
      youId: "u1",
      now: NOW,
    });
    expect(kinds(entries)).toEqual(["day:Today", "M:c1", "document", "M:c2"]);
    expect(entries.find((entry) => entry.kind === "document")?.key).toBe("document:plan");
    expect(kinds(buildChat({ comments: [message("c1", "2026-10-27T10:00:00", { user: "u1" })], documents: [doc("plan", "2026-10-27T10:05:00")], search: "c1", youId: "u1", now: NOW }))).toEqual(["M:c1"]);
  });
});

describe("document links", () => {
  const chat = { id: "44d8a512-9877-4d79-a5e7-a7e79d199795", identifier: "TES-13" };

  it("reads and writes the #document- fragment", () => {
    expect(documentHash("plan")).toBe("#document-plan");
    expect(documentKeyFromHash("#document-paperclip-context-reference")).toBe("paperclip-context-reference");
    expect(documentKeyFromHash(documentHash("a b"))).toBe("a b");
    expect(documentKeyFromHash("#comment-1")).toBeNull();
    expect(documentKeyFromHash("#document-")).toBeNull();
    expect(documentKeyFromHash("")).toBeNull();
    expect(documentKeyFromHash("#document-plan&image=2")).toBe("plan");
    expect(documentKeyFromHash("#document-&image=2")).toBeNull();
    expect(chatDocumentLink("/TES/issues/TES-13#document-plan&image=2", chat)).toBe("plan");
  });

  it("knows links to the chat's own documents", () => {
    expect(chatDocumentLink("/TES/issues/TES-13#document-paperclip-context-reference", chat)).toBe("paperclip-context-reference");
    expect(chatDocumentLink("/issues/tes-13#document-plan", chat)).toBe("plan");
    expect(chatDocumentLink(`http://localhost:3100/TES/issues/${chat.id}#document-plan`, chat)).toBe("plan");
    expect(chatDocumentLink("#document-plan", chat)).toBe("plan");
  });

  it("leaves other links alone", () => {
    expect(chatDocumentLink("/TES/issues/TES-14#document-plan", chat)).toBeNull();
    expect(chatDocumentLink("/TES/issues/TES-13", chat)).toBeNull();
    expect(chatDocumentLink("/TES/issues/TES-13#comment-1", chat)).toBeNull();
    expect(chatDocumentLink("/TES/projects/x#document-plan", chat)).toBeNull();
    expect(chatDocumentLink("/TES/issues/TES-13#document-plan", null)).toBeNull();
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

describe("yourChatAgent", () => {
  const listed = new Map([["chat1", "bob"]]);

  it("finds your chats in the list, or from a task's own fields when you started it", () => {
    expect(yourChatAgent({ id: "chat1" }, listed, "me")).toBe("bob");
    expect(yourChatAgent({ id: "chat2", conversationAgentId: "ada", createdByUserId: "me" }, listed, "me")).toBe("ada");
  });

  it("leaves tasks, and other people's chats, as tasks", () => {
    expect(yourChatAgent({ id: "t1", conversationAgentId: null, createdByUserId: "me" }, listed, "me")).toBeUndefined();
    expect(yourChatAgent({ id: "chat3", conversationAgentId: "ada", createdByUserId: "maya" }, listed, "me")).toBeUndefined();
    expect(yourChatAgent({ id: "chat3", conversationAgentId: "ada", createdByUserId: null }, listed, null)).toBeUndefined();
  });
});

/** A message the agent sent from another task's run (send_chat_message, decision 48). */
function sent(id: string, at: string, agent: string, source: { taskId: string; identifier: string; runId: string }) {
  return {
    ...message(id, at, { agent }, id, source.runId),
    metadata: { version: 1, chatMessage: { sourceTaskId: source.taskId, sourceTaskIdentifier: source.identifier, sourceRunId: source.runId, contentHash: "h" } },
  } as unknown as IssueComment;
}

describe("messages sent from another task", () => {
  const briefing = { taskId: "t9", identifier: "TES-9", runId: "r9" };

  it("names the source task", () => {
    expect(chatMessageSource(sent("c1", "2026-10-27T08:00:00", "a1", briefing))).toEqual({ taskId: "t9", identifier: "TES-9", runId: "r9" });
    expect(chatMessageSource(message("c2", "2026-10-27T08:00:00", { agent: "a1" }))).toBeNull();
  });

  it("starts its own group, and the next message starts another", () => {
    const entries = buildChat({
      comments: [
        message("c1", "2026-10-27T10:00:00", { agent: "a1" }),
        sent("c2", "2026-10-27T10:01:00", "a1", briefing),
        message("c3", "2026-10-27T10:02:00", { agent: "a1" }),
        message("c4", "2026-10-27T10:03:00", { agent: "a1" }),
      ],
      youId: "u1",
      now: NOW,
    });
    expect(kinds(entries)).toEqual(["day:Today", "M:c1", "M:c2", "M:c3", "m:c4"]);
    expect((entries[2] as Extract<ChatEntry, { kind: "message" }>).source?.identifier).toBe("TES-9");
  });

  it("leaves out the report card for a task that sent a message, and attaches no hand-offs to it", () => {
    const entries = buildChat({
      comments: [sent("c1", "2026-10-27T08:00:00", "a1", briefing)],
      reports: [task("t9", "2026-10-27T07:59:00", { status: "done", completedAt: "2026-10-27T08:01:00" }), task("t8", "2026-10-27T07:00:00")],
      handoffs: [task("h1", "2026-10-27T08:00:30", { originRunId: "r9" })],
      youId: "u1",
      now: NOW,
    });
    expect(kinds(entries)).toEqual(["day:Today", "report", "M:c1", "handoff"]);
    expect((entries[1] as Extract<ChatEntry, { kind: "report" }>).task.id).toBe("t8");
  });
});

describe("read state", () => {
  const agentMessage = (id: string, at: string, extra: Record<string, unknown> = {}) =>
    ({ ...message(id, at, { agent: "a1" }), origin: "comment", presentation: null, ...extra }) as unknown as IssueComment;

  it("finds the newest agent message, skipping people, notices, fast responses and deleted ones", () => {
    const comments = [
      agentMessage("c1", "2026-10-27T10:00:00"),
      agentMessage("c2", "2026-10-27T10:05:00"),
      message("c3", "2026-10-27T10:06:00", { user: "u1" }),
      agentMessage("c4", "2026-10-27T10:07:00", { presentation: { kind: "system_notice" } }),
      agentMessage("c5", "2026-10-27T10:08:00", { origin: "fast_response" }),
      agentMessage("c6", "2026-10-27T10:09:00", { deletedAt: "2026-10-27T10:10:00" }),
    ];
    expect(newestUnreadable(comments)?.id).toBe("c2");
    expect(newestUnreadable([])).toBeNull();
  });

  it("marks read through the newest message only when there's something new", () => {
    const newest = { id: "c2", createdAt: "2026-10-27T10:05:00" } as unknown as IssueComment;
    const at = new Date("2026-10-27T10:05:00").getTime();
    expect(readThrough(newest, { unread: true, marked: null })).toBe("c2");
    expect(readThrough(newest, { unread: false, marked: null })).toBeNull();
    expect(readThrough(newest, { unread: false, marked: { id: "c2", at } })).toBeNull();
    expect(readThrough(newest, { unread: false, marked: { id: "c1", at: at - 1000 } })).toBe("c2");
    expect(readThrough(newest, { unread: false, marked: { id: "", at: -Infinity } })).toBe("c2");
    expect(readThrough(null, { unread: true, marked: null })).toBeNull();
  });

  it("counts unread messages by agent, except the chat open", () => {
    const chats = [
      { conversationAgentId: "a1", isUnreadForMe: true, unreadMessageCount: 3 },
      { conversationAgentId: "a2", isUnreadForMe: false, unreadMessageCount: 0 },
      { conversationAgentId: "a3", isUnreadForMe: true, unreadMessageCount: 1 },
      { conversationAgentId: null, isUnreadForMe: true, unreadMessageCount: 4 },
    ];
    expect([...unreadChatCounts(chats)]).toEqual([
      ["a1", 3],
      ["a3", 1],
    ]);
    expect([...unreadChatCounts(chats, "a3")]).toEqual([["a1", 3]]);
    expect(unreadChatCounts(undefined).size).toBe(0);
  });

  it("goes by isUnreadForMe, and counts an unread chat without a count as one", () => {
    expect([...unreadChatCounts([{ conversationAgentId: "a1", isUnreadForMe: true }])]).toEqual([["a1", 1]]);
    expect(unreadChatCounts([{ conversationAgentId: "a1", isUnreadForMe: false, unreadMessageCount: 2 }]).size).toBe(0);
    // Two chats with one agent (an earlier session) add up.
    expect(
      unreadChatCounts([
        { conversationAgentId: "a1", isUnreadForMe: true, unreadMessageCount: 2 },
        { conversationAgentId: "a1", isUnreadForMe: true, unreadMessageCount: 5 },
      ]).get("a1"),
    ).toBe(7);
  });

  it("caps a badge at 99+ and labels it", () => {
    expect(badgeCount(7)).toBe("7");
    expect(badgeCount(99)).toBe("99");
    expect(badgeCount(100)).toBe("99+");
    expect(unreadMessagesLabel(1)).toBe("1 unread message");
    expect(unreadMessagesLabel(4)).toBe("4 unread messages");
  });

  it("knows which agent's chat the address shows", () => {
    expect(openChatAgentKey("/TES/agents/bob", "TES")).toBe("bob");
    expect(openChatAgentKey("/tes/agents/bob/", "TES")).toBe("bob");
    expect(openChatAgentKey("/TES/agents/bob/chat", "TES")).toBe("bob");
    expect(openChatAgentKey("/TES/agents/bob/overview", "TES")).toBe("bob");
    expect(openChatAgentKey("/TES/agents/bob%20two", "TES")).toBe("bob two");
    expect(openChatAgentKey("/TES/agents/bob/profile", "TES")).toBeNull();
    expect(openChatAgentKey("/TES/agents/bob/settings/runtime", "TES")).toBeNull();
    expect(openChatAgentKey("/TES/agents/new", "TES")).toBeNull();
    expect(openChatAgentKey("/TES/agents", "TES")).toBeNull();
    expect(openChatAgentKey("/TES/issues/TES-1", "TES")).toBeNull();
    expect(openChatAgentKey("/OTH/agents/bob", "TES")).toBeNull();
  });
});
