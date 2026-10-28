import { describe, expect, it } from "vitest";
import type { CompanyInviteRecord, CompanyJoinRequest, CompanyMember } from "@/api/access";
import { approveRole, inviteMeta, inviteTitle, memberMeta, requesterName, roleLabel, sortInvites, visibleMembers } from "./members-model";

const NOW = new Date("2026-10-27T12:00:00Z");

function member(overrides: Partial<CompanyMember>): CompanyMember {
  return {
    id: "m",
    companyId: "c",
    principalType: "user",
    principalId: "u",
    status: "active",
    membershipRole: "operator",
    createdAt: "2026-09-12T10:00:00Z",
    updatedAt: "2026-09-12T10:00:00Z",
    user: { id: "u", email: "u@example.com", name: "U", image: null },
    grants: [],
    ...overrides,
  };
}

function invite(overrides: Partial<CompanyInviteRecord>): CompanyInviteRecord {
  return {
    id: "i",
    inviteType: "company_join",
    allowedJoinTypes: "human",
    humanRole: "operator",
    expiresAt: "2026-10-30T10:00:00Z",
    invitedByUserId: "me",
    revokedAt: null,
    acceptedAt: null,
    createdAt: "2026-10-20T10:00:00Z",
    state: "active",
    invitedByUser: null,
    ...overrides,
  };
}

describe("members", () => {
  it("lists owners first, then by name, without removed members", () => {
    const list = visibleMembers([
      member({ id: "a", membershipRole: "viewer", user: { id: "a", email: null, name: "Ann", image: null } }),
      member({ id: "b", membershipRole: "owner", user: { id: "b", email: null, name: "Zed", image: null } }),
      member({ id: "c", membershipRole: "viewer", user: { id: "c", email: null, name: "Al", image: null } }),
      member({ id: "d", status: "archived" }),
    ]);
    expect(list.map((entry) => entry.id)).toEqual(["b", "c", "a"]);
  });

  it("says when someone joined and whether they're suspended", () => {
    expect(memberMeta(member({}), NOW)).toBe("Joined Sep 12");
    expect(memberMeta(member({ status: "suspended" }), NOW)).toBe("Joined Sep 12 · suspended");
  });

  it("labels roles", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel(null)).toBe("No role");
  });
});

describe("invites", () => {
  it("names the role and who made it", () => {
    expect(inviteTitle(invite({ humanRole: "viewer" }))).toBe("Invite link · Viewer");
    expect(inviteMeta(invite({}), "me", NOW)).toBe("Created by you on Oct 20 · expires Oct 30 · not used yet");
    expect(inviteMeta(invite({ state: "revoked", invitedByUserId: "x", invitedByUser: { id: "x", email: null, name: "Maya", image: null } }), "me", NOW)).toBe(
      "Created by Maya on Oct 20 · revoked",
    );
  });

  it("puts active invites first, newest first", () => {
    const sorted = sortInvites([
      invite({ id: "old-used", state: "accepted", createdAt: "2026-10-25T00:00:00Z" }),
      invite({ id: "older", createdAt: "2026-10-01T00:00:00Z" }),
      invite({ id: "newer", createdAt: "2026-10-21T00:00:00Z" }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["newer", "older", "old-used"]);
  });
});

describe("join requests", () => {
  const base = { requestType: "human", requesterUser: null, invite: null, requestEmailSnapshot: null, agentName: null } as unknown as CompanyJoinRequest;

  it("names the person or the agent", () => {
    expect(requesterName({ ...base, requesterUser: { id: "u", email: "j@example.com", name: "Jordan P.", image: null } })).toBe("Jordan P.");
    expect(requesterName({ ...base, requestEmailSnapshot: "j@example.com" })).toBe("j@example.com");
    expect(requesterName({ ...base, requestType: "agent", agentName: "Scout" })).toBe("Scout");
  });

  it("approves with the invite's role", () => {
    expect(approveRole({ ...base, invite: { id: "i", humanRole: "viewer", inviteMessage: null } })).toBe("viewer");
    expect(approveRole(base)).toBe("operator");
    expect(approveRole({ ...base, requestType: "agent" })).toBeNull();
  });
});
