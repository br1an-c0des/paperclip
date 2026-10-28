import type { ConnectionGrant } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  agentGrants,
  audienceChange,
  audienceSummary,
  connectionTypeLabel,
  delegationAgents,
  grantAccountLabel,
  grantState,
  organizationGrant,
  otherPersonalGrants,
  personalGrantFor,
  usesOrganizationIdentity,
  usesPersonalIdentities,
} from "./identity-model";

const grant = (fields: Partial<ConnectionGrant>) => ({ id: "g", kind: "organization", status: "active", members: [], delegations: [], ...fields }) as ConnectionGrant;
const member = (subjectId: string) => ({ subjectType: "user", subjectId }) as never;

describe("connection identities", () => {
  it("names the connection's type and what each policy uses", () => {
    expect(connectionTypeLabel("per_user")).toBe("Personal");
    expect(connectionTypeLabel("per_agent")).toBe("Dedicated agent");
    expect(connectionTypeLabel("shared")).toBe("Organization");
    expect(usesPersonalIdentities("per_user_with_fallback")).toBe(true);
    expect(usesPersonalIdentities("shared")).toBe(false);
    expect(usesOrganizationIdentity("per_user_with_fallback")).toBe(true);
    expect(usesOrganizationIdentity("per_user")).toBe(false);
  });

  it("reads a missing identity as not connected", () => {
    expect(grantState(null).label).toBe("Not connected");
    expect(grantState("needs_reauthorization").kind).toBe("attention");
    expect(grantState("active").label).toBe("Connected");
  });

  it("labels the account by its provider's name, never a secret", () => {
    expect(grantAccountLabel(grant({ providerTenant: { name: "Acme" } } as never))).toBe("Acme");
    expect(grantAccountLabel(grant({ kind: "user" }), "Ada")).toBe("Ada");
    expect(grantAccountLabel(grant({}))).toBe("Shared credential");
  });

  it("finds the default organization identity, yours, others' and the agents'", () => {
    const grants = [
      grant({ id: "o1" }),
      grant({ id: "o2", isDefault: true } as never),
      grant({ id: "u1", kind: "user", subjectUserId: "me" } as never),
      grant({ id: "u2", kind: "user", subjectUserId: "you" } as never),
      grant({ id: "a1", kind: "agent" }),
    ];
    expect(organizationGrant(grants)?.id).toBe("o2");
    expect(personalGrantFor(grants, "me")?.id).toBe("u1");
    expect(personalGrantFor(grants, null)).toBeNull();
    expect(otherPersonalGrants(grants, "me").map((entry) => entry.id)).toEqual(["u2"]);
    expect(agentGrants(grants).map((entry) => entry.id)).toEqual(["a1"]);
  });
});

describe("audiences and delegations", () => {
  it("reads no members as everyone", () => {
    expect(audienceSummary(grant({}))).toBe("Everyone in the organization");
    expect(audienceSummary(grant({ members: [member("u1")] }))).toBe("1 chosen person");
  });

  it("saves only a real change, and never an empty chosen list", () => {
    const current = grant({ members: [member("u1")] });
    expect(audienceChange(current, "selected", new Set(["u1"]))).toBeNull();
    expect(audienceChange(current, "selected", new Set())).toBeNull();
    expect(audienceChange(current, "selected", new Set(["u2", "u1"]))).toEqual(["u1", "u2"]);
    expect(audienceChange(current, "all", new Set(["u1"]))).toEqual([]);
    expect(audienceChange(grant({}), "all", new Set())).toBeNull();
  });

  it("splits the agents into delegated and available", () => {
    const agents = [{ id: "a1" }, { id: "a2" }];
    const result = delegationAgents(grant({ delegations: [{ agentId: "a2" }] as never }), agents);
    expect(result.delegated.map((agent) => agent.id)).toEqual(["a2"]);
    expect(result.available.map((agent) => agent.id)).toEqual(["a1"]);
  });
});
