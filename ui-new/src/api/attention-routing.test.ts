import { afterEach, describe, expect, it, vi } from "vitest";
import { approvalsApi } from "./approvals";
import { attentionApi } from "./attention";
import { inboxApi } from "./inbox";

// What the Inbox sends for routing (U133, upstream #20959): fingerprinted dismissals, claim,
// transfer, withdraw, receipts and approval cancel.

function stubFetch() {
  const fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  const calls = () =>
    fetch.mock.calls.map((call) => {
      const [url, init] = call as unknown as [string, RequestInit | undefined];
      return { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined };
    });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("hiding a card for you", () => {
  it("sends the card's fingerprint with an archive and a snooze", async () => {
    const calls = stubFetch();
    await inboxApi.clear("c1", "attention:a", "fp-1");
    await inboxApi.snooze("c1", "attention:a", "2026-11-14T09:00:00.000Z", "fp-1");
    await inboxApi.clear("c1", "receipt:r", null);
    expect(calls()).toEqual([
      { url: "/api/companies/c1/inbox-dismissals", method: "POST", body: { itemKey: "attention:a", fingerprint: "fp-1" } },
      { url: "/api/companies/c1/inbox-dismissals", method: "POST", body: { itemKey: "attention:a", kind: "snooze", snoozedUntil: "2026-11-14T09:00:00.000Z", fingerprint: "fp-1" } },
      { url: "/api/companies/c1/inbox-dismissals", method: "POST", body: { itemKey: "receipt:r" } },
    ]);
  });
});

describe("routing a card", () => {
  it("claims, transfers and withdraws by the card's source", async () => {
    const calls = stubFetch();
    await attentionApi.claim("c1", "issue_thread_interaction", "i 1");
    await attentionApi.transfer("c1", "issue_thread_interaction", "i1", { userId: "u2" });
    await attentionApi.close("c1", "approval", "a1", { mode: "withdraw", reason: "Out of date" });
    await attentionApi.receipts("c1");
    expect(calls()).toEqual([
      { url: "/api/companies/c1/attention/issue_thread_interaction/i%201/claim", method: "POST", body: {} },
      { url: "/api/companies/c1/attention/issue_thread_interaction/i1/transfer", method: "POST", body: { userId: "u2" } },
      { url: "/api/companies/c1/attention/approval/a1/close", method: "POST", body: { mode: "withdraw", reason: "Out of date" } },
      { url: "/api/companies/c1/attention?view=mine&limit=1", method: "GET", body: undefined },
    ]);
  });

  it("withdraws an approval with its reason, or none", async () => {
    const calls = stubFetch();
    await approvalsApi.cancel("a1", "Superseded");
    await approvalsApi.cancel("a2");
    expect(calls()).toEqual([
      { url: "/api/approvals/a1/cancel", method: "POST", body: { reason: "Superseded" } },
      { url: "/api/approvals/a2/cancel", method: "POST", body: {} },
    ]);
  });
});
