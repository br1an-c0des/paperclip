import type { ConnectionIntentInteraction } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { CompanyJoinRequest } from "@/api/access";
import { setupHref } from "./ConnectionControls";
import { joinCarriesSecrets, joinReach, requestFromJoin } from "./join-model";
import { requestFromInteraction } from "./request-model";

const join = {
  id: "j1",
  inviteId: "inv1",
  companyId: "c1",
  requestType: "agent",
  status: "pending_approval",
  requestIp: "127.0.0.1",
  requestingUserId: null,
  requestEmailSnapshot: null,
  agentName: "Hermes on the lab box",
  adapterType: "hermes_gateway",
  capabilities: "Reads papers.",
  agentDefaultsPayload: { apiBaseUrl: "https://hermes.example/api", apiKey: { type: "secret_ref", secretId: "s1" } },
  claimSecretExpiresAt: null,
  claimSecretConsumedAt: null,
  createdAgentId: null,
  approvedByUserId: null,
  approvedAt: null,
  rejectedByUserId: null,
  rejectedAt: null,
  createdAt: "2026-10-28T10:00:00Z",
  updatedAt: "2026-10-28T10:00:00Z",
  requesterUser: null,
  invite: { id: "inv1", humanRole: null, inviteMessage: "For the research team" },
} as unknown as CompanyJoinRequest;

const ctx = { youId: "me", agentName: () => undefined, personName: (id: string) => (id === "u2" ? "Sam K." : id) };

describe("join requests", () => {
  it("says where Paperclip will reach an agent, and whether it sent credentials, without showing them", () => {
    expect(joinReach({ url: "wss://gateway.example" })).toBe("wss://gateway.example");
    expect(joinReach(join.agentDefaultsPayload)).toBe("https://hermes.example/api");
    expect(joinReach(null)).toBeNull();
    // A key already stored as a company secret arrives as a reference.
    expect(joinCarriesSecrets(join.agentDefaultsPayload)).toBe(true);
    expect(joinCarriesSecrets({ url: "http://x", headers: {} })).toBe(false);
    expect(joinCarriesSecrets({ headers: { "x-openclaw-token": "t" } })).toBe(true);
  });

  it("builds an agent's join request as an approval", () => {
    const request = requestFromJoin(join, ctx);
    expect(request).toMatchObject({
      key: "join:j1",
      kind: "approval",
      shape: "join",
      state: "open",
      title: "Let Hermes on the lab box join as an agent?",
      askVerb: "asks to join as an agent",
      body: "For the research team",
      respond: { allowed: true },
    });
    expect(request.next).toMatch(/^Approving creates Hermes on the lab box, reporting to the CEO/);
  });

  it("builds a person's join request with the invite's role, and settles a decided one", () => {
    const person = {
      ...join,
      requestType: "human",
      agentName: null,
      requesterUser: { id: "u3", name: "Ana", email: "ana@example.com", image: null },
      invite: { id: "inv2", humanRole: "operator", inviteMessage: null },
    } as unknown as CompanyJoinRequest;
    expect(requestFromJoin(person, ctx).title).toBe("Let Ana join as an operator?");
    const rejected = requestFromJoin({ ...person, status: "rejected", rejectedByUserId: "u2", rejectedAt: "2026-10-28T11:00:00Z" } as unknown as CompanyJoinRequest, ctx);
    expect(rejected.state).toBe("settled");
    expect(rejected.verdict).toMatchObject({ text: "Sam K. rejected", tone: "muted" });
  });
});

/*
 * Connection requests (`connection_intent`) are created only by the server for an agent run, so
 * these cover the stored shape.
 */
const intent = {
  id: "ci1",
  companyId: "c1",
  issueId: "t1",
  kind: "connection_intent",
  status: "pending",
  addresseeUserId: "me",
  createdByAgentId: "a1",
  effectiveResolverPolicy: "human_only",
  createdAt: "2026-10-28T10:00:00Z",
  updatedAt: "2026-10-28T10:00:00Z",
  payload: { version: 1, serviceSlug: "github", serviceName: "GitHub", requestingAgentId: "a1", requestingAgentName: "Builder", phase: "requested" },
} as unknown as ConnectionIntentInteraction;

const intentCtx = { youId: "me", agentName: (id: string) => (id === "a1" ? "Builder" : undefined), personName: (id: string) => (id === "u2" ? "Sam K." : id) };

describe("connection requests", () => {
  it("can be answered by the person it's addressed to, and only by them", () => {
    const request = requestFromInteraction(intent, intentCtx);
    expect(request).toMatchObject({ shape: "connection", title: "Connect GitHub", askVerb: "asks to connect an app", audience: { kind: "named", label: "You" }, respond: { allowed: true } });
    const theirs = requestFromInteraction({ ...intent, addresseeUserId: "u2" } as ConnectionIntentInteraction, intentCtx);
    expect(theirs.respond).toEqual({ allowed: false, reason: "Waiting on Sam K. Only Sam K. can answer this." });
  });

  it("asks for access to an existing connection, and for an AI connection", () => {
    const access = requestFromInteraction(
      { ...intent, payload: { ...intent.payload, accessRequest: { connectionId: "conn1", connectionName: "Team GitHub", tools: [] } } } as ConnectionIntentInteraction,
      intentCtx,
    );
    expect(access.title).toBe("Give Builder access to Team GitHub?");
    const ai = requestFromInteraction({ ...intent, payload: { ...intent.payload, purpose: "ai", serviceName: "Anthropic" } } as ConnectionIntentInteraction, intentCtx);
    expect(ai.title).toBe("Connect Anthropic so Builder can run");
    expect(ai.next).toBe("Once Builder has a working AI connection, the task resumes on its own.");
  });

  it("settles connected and declined requests", () => {
    const connected = requestFromInteraction({ ...intent, status: "accepted", resolvedByUserId: "me", result: { version: 1, outcome: "connected", connectionId: "conn1" } } as unknown as ConnectionIntentInteraction, intentCtx);
    expect(connected.verdict?.text).toBe("You connected it");
    const superseded = requestFromInteraction({ ...intent, status: "expired", result: { version: 1, outcome: "superseded" } } as unknown as ConnectionIntentInteraction, intentCtx);
    expect(superseded.verdict?.text).toBe("Replaced by a newer request");
  });

  it("sends new connections to the app's setup in Apps", () => {
    expect(setupHref("TES", { serviceSlug: "github" })).toBe("/TES/apps/connect?source=github");
    expect(setupHref("TES", { serviceSlug: "agentmail", purpose: "channel" }, "/apps/chat/new?type=agentmail")).toBe("/TES/apps/chat/new?type=agentmail");
    expect(setupHref("TES", { serviceSlug: "anthropic", purpose: "ai" })).toBe("/TES/apps/ai");
  });
});
