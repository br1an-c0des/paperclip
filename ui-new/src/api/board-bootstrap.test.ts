import { QueryClient } from "@tanstack/solid-query";
import { describe, expect, it } from "vitest";
import { boardAccessFromBootstrap } from "./access";
import { asSession } from "./auth";
import { companiesFromBootstrap } from "./companies";
import { queryKeys } from "./queryKeys";
import { seedBoardBootstrap } from "@/lib/session";

// The session with `boardBootstrap` (U4): read through `readBoardBootstrap`, then seeded into the
// companies list and board access.

const company = {
  id: "c1",
  name: "Test",
  description: null,
  status: "active",
  pauseReason: null,
  pausedAt: null,
  issuePrefix: "TES",
  issueCounter: 4,
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
  defaultResponsibleUserId: null,
  defaultDecisionOwnerUserId: null,
  budgetOwnerUserId: null,
  requireBoardApprovalForNewAgents: false,
  interactionResolverGovernance: {},
  feedbackDataSharingEnabled: false,
  feedbackDataSharingConsentAt: null,
  feedbackDataSharingConsentByUserId: null,
  feedbackDataSharingTermsVersion: null,
  logoAssetId: null,
  logoUrl: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-02T10:00:00.000Z",
};

function wire(userId = "u1", bootstrapUser = userId, extra: Record<string, unknown> = {}) {
  return {
    session: { id: `paperclip:session:${userId}`, userId },
    user: { id: userId, email: "a@b.c", name: "Ann", image: null },
    sentryDsn: null,
    boardBootstrap: {
      userId: bootstrapUser,
      companies: [company],
      boardAccess: { userId: bootstrapUser, isInstanceAdmin: false, companyIds: ["c1"] },
      ...extra,
    },
  };
}

describe("asSession", () => {
  it("keeps a bootstrap for the signed-in account", () => {
    const session = asSession(wire());
    expect(session?.boardBootstrap?.boardAccess.companyIds).toEqual(["c1"]);
    expect(session?.boardBootstrap?.companies[0]?.issuePrefix).toBe("TES");
  });

  it("drops one for another account, or a malformed one, and keeps the session", () => {
    const other = asSession(wire("u1", "u2"));
    expect(other?.user.id).toBe("u1");
    expect(other?.boardBootstrap).toBeUndefined();
    expect("boardBootstrap" in (other ?? {})).toBe(false);
    const broken = asSession({ ...wire(), boardBootstrap: { userId: "u1", companies: "nope" } });
    expect(broken?.boardBootstrap).toBeUndefined();
    expect(broken?.session.userId).toBe("u1");
  });

  it("reads a session without one, and one wrapped in data", () => {
    const { boardBootstrap: _drop, ...plain } = wire();
    expect(asSession(plain)?.boardBootstrap).toBeUndefined();
    expect(asSession({ data: wire() })?.boardBootstrap?.userId).toBe("u1");
    expect(asSession(null)).toBeNull();
  });
});

describe("companiesFromBootstrap", () => {
  it("gives the list read's shape back, with dates as strings", () => {
    const session = asSession(wire())!;
    expect(session.boardBootstrap!.companies[0]!.createdAt).toBeInstanceOf(Date);
    const [first] = companiesFromBootstrap(session.boardBootstrap!);
    expect(first!.createdAt).toBe("2026-10-01T10:00:00.000Z");
    expect(first).toEqual(company);
  });
});

describe("boardAccessFromBootstrap", () => {
  it("answers as /cli-auth/me does, with the session's person and source", () => {
    const session = asSession(wire())!;
    expect(boardAccessFromBootstrap(session.boardBootstrap!, session)).toEqual({
      user: { id: "u1", email: "a@b.c", name: "Ann", image: null },
      userId: "u1",
      isInstanceAdmin: false,
      companyIds: ["c1"],
      source: "session",
    });
    const cloud = { ...session, session: { id: "paperclip:cloud_tenant:u1", userId: "u1" } };
    expect(boardAccessFromBootstrap(session.boardBootstrap!, cloud).source).toBe("cloud_tenant");
  });
});

describe("seedBoardBootstrap", () => {
  it("seeds the account's companies and replaces cached board access", async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.access.currentBoardAccess, { userId: "u0", isInstanceAdmin: true, companyIds: ["old"], user: null, source: "session" });
    await seedBoardBootstrap(client, asSession(wire()));
    expect(client.getQueryData(queryKeys.companies.list("u1"))).toEqual([company]);
    expect(client.getQueryData<{ companyIds: string[] }>(queryKeys.access.currentBoardAccess)?.companyIds).toEqual(["c1"]);
    expect(client.getQueryState(queryKeys.companies.list("u1"))?.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("leaves the caches alone without a bootstrap", async () => {
    const client = new QueryClient();
    await seedBoardBootstrap(client, asSession(wire("u1", "u2")));
    await seedBoardBootstrap(client, null);
    expect(client.getQueryData(queryKeys.companies.list("u1"))).toBeUndefined();
    expect(client.getQueryData(queryKeys.access.currentBoardAccess)).toBeUndefined();
  });
});
