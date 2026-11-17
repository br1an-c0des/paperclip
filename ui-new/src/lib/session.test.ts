import { describe, expect, it } from "vitest";
import { gateLoading, safeNextPath, sessionChecked, type GateRead } from "./session";

describe("safeNextPath", () => {
  it("keeps paths inside the app", () => {
    expect(safeNextPath("/GEA/issues/GEA-12?tab=runs")).toBe("/GEA/issues/GEA-12?tab=runs");
  });

  it("falls back to / for anything else", () => {
    for (const next of [null, undefined, "", "https://evil.example", "//evil.example", "/auth", "/auth?next=/x"]) {
      expect(safeNextPath(next)).toBe("/");
    }
  });
});

const user = { session: { id: "s1", userId: "u1" }, user: { id: "u1", email: "ann@example.com", name: "Ann" } };
const unread: GateRead = { isPending: true, data: undefined, error: null, dataUpdatedAt: 0 };
const answered = (data: unknown, dataUpdatedAt = 2_000): GateRead => ({ isPending: false, data, error: null, dataUpdatedAt });
const health = answered({ status: "ok", deploymentMode: "authenticated" });

describe("gateLoading", () => {
  const gate = (reads: Partial<{ health: GateRead; session: GateRead; access: GateRead }>, authenticated = true, bootstrapPending = false) =>
    gateLoading({ authenticated, bootstrapPending, health, session: unread, access: unread, ...reads });

  it("waits for a session read that hasn't started yet, instead of taking it for signed out", () => {
    // Health has just answered, which enables the session read in that same update: it's pending
    // with nothing fetched yet (the fresh-load bounce through /auth).
    expect(gate({})).toBe(true);
    expect(gate({ health: unread })).toBe(true);
  });

  it("decides once the session has answered, signed in or out", () => {
    expect(gate({ session: answered(null) })).toBe(false);
    expect(gate({ session: answered(user) })).toBe(true); // board access still to come
    expect(gate({ session: answered(user), access: answered({ companyIds: ["c1"] }) })).toBe(false);
    expect(gate({ session: { ...unread, isPending: false, error: new Error("401") } })).toBe(false);
  });

  it("doesn't wait for reads the instance doesn't make", () => {
    // local_trusted: no session read; bootstrap pending: no board-access read.
    expect(gate({}, false)).toBe(false);
    expect(gate({ session: answered(user) }, true, true)).toBe(false);
  });
});

describe("sessionChecked", () => {
  const since = 1_000;
  const check = (reads: Partial<{ health: GateRead; session: GateRead }>, authenticated = true) =>
    sessionChecked({ authenticated, health, session: answered(user), since, ...reads });

  it("counts a session read from the server since the page loaded, however late the gate mounted", () => {
    expect(check({})).toBe(true);
    expect(check({}, false)).toBe(true);
  });

  it("doesn't count reads saved from the last visit, or that failed", () => {
    expect(check({ session: answered(user, 500) })).toBe(false);
    expect(check({ health: answered(health.data, 500) })).toBe(false);
    expect(check({ session: { ...answered(user), error: new Error("offline") } })).toBe(false);
    expect(check({ health: unread })).toBe(false);
  });

  it("needs a signed-in session on an authenticated instance", () => {
    expect(check({ session: answered(null) })).toBe(false);
    expect(check({ session: unread })).toBe(false);
  });
});
