import type { EmailPublicationSummary, EmailThreadSummary, TaskBrowser } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  canResolveDelivery,
  canSendToBinding,
  currentBrowser,
  deliveriesNeedingAttention,
  deliveryFor,
  idleCountdown,
  inboxToggle,
  isTaskId,
  openDeliveries,
  paneSize,
  threadSummary,
  uncommentedMessages,
} from "./integrations-model";

describe("which tasks carry integrations", () => {
  it("skips the assistant's chat tasks", () => {
    expect(isTaskId("issue-1")).toBe(true);
    expect(isTaskId("chat:abc")).toBe(false);
    expect(isTaskId("")).toBe(false);
  });

  it("sends board messages to chat conversations, not to calls or email", () => {
    expect(canSendToBinding({ provider: "slack" })).toBe(true);
    expect(canSendToBinding({ provider: "speko" })).toBe(false);
    expect(canSendToBinding({ provider: "agentmail" })).toBe(false);
    expect(canSendToBinding(null)).toBe(false);
  });
});

describe("email threads", () => {
  const publication = (fields: Partial<EmailPublicationSummary>) =>
    ({ id: "p", issueId: "t", conversationId: "c", outcome: "sent", error: null, providerMessageId: "m1", ...fields }) as EmailPublicationSummary;
  const thread = {
    conversationId: "c",
    issueId: "t",
    subject: "Invoice",
    endpoint: { id: "e1", address: "ada@agentmail.to", status: "active" },
    messages: [
      { id: "1", providerMessageId: "m1", commentId: "k1" },
      { id: "2", providerMessageId: "m2", commentId: null },
    ],
    publications: [
      publication({ id: "sent" }),
      publication({ id: "queued", outcome: "queued", providerMessageId: null }),
      publication({ id: "unsure", outcome: "uncertain" }),
      publication({ id: "failed", outcome: "failed", providerMessageId: null }),
    ],
  } as unknown as EmailThreadSummary;

  it("lists sends that aren't messages yet, and which need checking", () => {
    expect(openDeliveries(thread).map((entry) => entry.id)).toEqual(["queued", "unsure", "failed"]);
    expect(deliveriesNeedingAttention(thread).map((entry) => entry.id)).toEqual(["unsure", "failed"]);
    expect(canResolveDelivery({ outcome: "uncertain" })).toBe(true);
    expect(canResolveDelivery({ outcome: "failed" })).toBe(false);
  });

  it("matches a message to its delivery and finds the ones without a comment", () => {
    expect(deliveryFor(thread, thread.messages[0]!)?.id).toBe("sent");
    expect(deliveryFor(thread, thread.messages[1]!)).toBeNull();
    expect(uncommentedMessages(thread).map((message) => message.id)).toEqual(["2"]);
  });

  it("summarises the thread and offers the inbox's pause or resume", () => {
    expect(threadSummary(thread)).toBe("2 messages · ada@agentmail.to");
    expect(inboxToggle("active")).toBe("pause");
    expect(inboxToggle("paused")).toBe("resume");
    expect(inboxToggle("attention")).toBeNull();
  });
});

describe("browsers", () => {
  const browser = (fields: Partial<TaskBrowser>) => ({ id: "b", status: "running", createdAt: "2026-10-28T10:00:00Z", idleDeadline: null, ...fields }) as TaskBrowser;

  it("shows the newest browser still open", () => {
    expect(currentBrowser([browser({ id: "old" }), browser({ id: "new", createdAt: "2026-10-28T11:00:00Z" })])?.id).toBe("new");
    expect(currentBrowser([browser({ status: "closed" }), browser({ status: "failed" })])).toBeNull();
    expect(currentBrowser(undefined)).toBeNull();
  });

  it("counts down an idle browser", () => {
    const now = Date.parse("2026-10-28T10:00:00Z");
    expect(idleCountdown(browser({ status: "idle", idleDeadline: "2026-10-28T10:04:05Z" }), now)).toBe("Closes in 4:05");
    expect(idleCountdown(browser({ status: "running", idleDeadline: "2026-10-28T10:04:05Z" }), now)).toBeNull();
  });

  it("keeps a pane's shape within the provider's bounds", () => {
    expect(paneSize(1200, 700)).toEqual({ width: 1200, height: 700 });
    expect(paneSize(12288, 3456)).toEqual({ width: 6144, height: 1728 });
    expect(paneSize(0, 700)).toBeNull();
  });
});
