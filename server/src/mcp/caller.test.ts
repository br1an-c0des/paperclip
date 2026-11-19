import { Router } from "express";
import { describe, expect, it, vi } from "vitest";
import { resolveAgentAccess } from "@paperclipai/shared";
import type { Db } from "@paperclipai/db";

vi.mock("../services/agent-access.js", () => ({
  loadAgentAccess: vi.fn(async () => resolveAgentAccess({ level: "worker" })),
}));

const { resolveMcpCaller } = await import("./caller.js");
const { createCatalogDispatch, McpToolError } = await import("./dispatch.js");
const { loadAgentAccess } = await import("../services/agent-access.js");

const db = {} as Db;
const COMPANY = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const RUN = "33333333-3333-4333-8333-333333333333";

describe("resolveMcpCaller", () => {
  it("a run token resolves to a run caller with its run id", async () => {
    const caller = await resolveMcpCaller(db, {
      type: "agent", source: "agent_jwt", agentId: AGENT, companyId: COMPANY, runId: RUN,
    });
    expect(caller).toMatchObject({ kind: "run", agentId: AGENT, companyId: COMPANY, runId: RUN, userId: null, grantId: null });
    expect(caller.access["tasks:update_own"]).toBe(true);
    expect(caller.actor.runId).toBe(RUN);
    expect(loadAgentAccess).toHaveBeenCalledWith(db, AGENT);
  });

  it("an agent key resolves without a run id", async () => {
    const caller = await resolveMcpCaller(db, {
      type: "agent", source: "agent_key", agentId: AGENT, companyId: COMPANY, keyId: "key-1", runId: RUN,
    });
    expect(caller).toMatchObject({ kind: "agent_key", agentId: AGENT, companyId: COMPANY, runId: null });
    // The key's actor must not carry a run id the client chose with a header.
    expect(caller.actor.runId ?? null).toBeNull();
  });

  it("a board session is refused", async () => {
    await expect(resolveMcpCaller(db, { type: "board", source: "session", userId: "user-1" })).rejects.toMatchObject({ status: 401 });
    await expect(resolveMcpCaller(db, { type: "none", source: "none" })).rejects.toMatchObject({ status: 401 });
    // A run token without its run id is not a run.
    await expect(resolveMcpCaller(db, { type: "agent", source: "agent_jwt", agentId: AGENT, companyId: COMPANY })).rejects.toMatchObject({ status: 401 });
  });
});

describe("resolveMcpCaller for outside connections", () => {
  const GRANT = "55555555-5555-4555-8555-555555555555";
  const grant = (input: { accessLevel: "read_only" | "worker" | "manager" | "admin"; actAsAgentId?: string | null; accessOverrides?: Record<string, boolean> }) => ({
    id: GRANT, companyId: COMPANY, userId: "user-1", clientId: "client", resource: "https://paperclip.example/mcp/paperclip",
    purpose: "personal" as const, agentId: null, scopes: ["paperclip:read"], revokedAt: null,
    actAsAgentId: input.actAsAgentId ?? null, accessLevel: input.accessLevel, accessOverrides: input.accessOverrides ?? null,
    revocationRevision: 0, revocationIndexReceipt: null, createdAt: new Date(),
  });
  const person = { type: "board" as const, source: "mcp_oauth" as const, userId: "user-1", companyIds: [COMPANY], memberships: [{ companyId: COMPANY, membershipRole: "member", status: "active" }], grantId: GRANT };

  it("a personal grant acting as the person is oauth_person at the grant's level", async () => {
    const caller = await resolveMcpCaller(db, person, { grant: grant({ accessLevel: "read_only", accessOverrides: { "tasks:comment": true } }) });
    expect(caller).toMatchObject({ kind: "oauth_person", companyId: COMPANY, agentId: null, userId: "user-1", runId: null, grantId: GRANT });
    expect(caller.access["tasks:read"]).toBe(true);
    expect(caller.access["tasks:comment"]).toBe(true);
    expect(caller.access["tasks:create"]).toBe(false);
  });

  it("a viewer's connection is read-only whatever its level", async () => {
    const viewer = { ...person, memberships: [{ companyId: COMPANY, membershipRole: "viewer", status: "active" }] };
    const caller = await resolveMcpCaller(db, viewer, { grant: grant({ accessLevel: "admin" }) });
    expect(caller.access["tasks:update_own"]).toBe(false);
    expect(caller.access["tasks:read"]).toBe(true);
  });

  it("a grant acting as an agent uses the lower of the two levels", async () => {
    vi.mocked(loadAgentAccess).mockResolvedValueOnce(resolveAgentAccess({ level: "manager" }));
    const asAgent = { type: "agent" as const, source: "mcp_oauth" as const, agentId: AGENT, companyId: COMPANY, grantId: GRANT };
    const caller = await resolveMcpCaller(db, asAgent, { grant: grant({ accessLevel: "worker", actAsAgentId: AGENT }) });
    expect(caller).toMatchObject({ kind: "oauth_agent", agentId: AGENT, userId: "user-1", grantId: GRANT, runId: null });
    expect(caller.access["tasks:update_own"]).toBe(true);
    // The agent is a manager, but the connection is worker.
    expect(caller.access["labels:manage"]).toBe(false);
    vi.mocked(loadAgentAccess).mockResolvedValueOnce(resolveAgentAccess({ level: "worker" }));
    const capped = await resolveMcpCaller(db, asAgent, { grant: grant({ accessLevel: "admin", actAsAgentId: AGENT }) });
    // And the other way round: an admin connection can't lift a worker agent.
    expect(capped.access["labels:manage"]).toBe(false);
  });

  it("a dormant agent grant (Dot) is oauth_agent on its agent, uncapped", async () => {
    vi.mocked(loadAgentAccess).mockResolvedValueOnce(resolveAgentAccess({ level: "manager" }));
    const caller = await resolveMcpCaller(db, { type: "agent", source: "mcp_oauth", agentId: AGENT, companyId: COMPANY });
    expect(caller).toMatchObject({ kind: "oauth_agent", agentId: AGENT, grantId: null });
    expect(caller.access["labels:manage"]).toBe(true);
  });
});

describe("createCatalogDispatch", () => {
  async function runCaller() {
    return resolveMcpCaller(db, { type: "agent", source: "agent_jwt", agentId: AGENT, companyId: COMPANY, runId: RUN });
  }

  it("a 403 from a route surfaces missingAction and requestable", async () => {
    const api = Router();
    api.delete("/issues/:id", (_req, res) => {
      res.status(403).json({ error: "Deleting tasks needs tasks:delete", code: "access_denied", missingAction: "tasks:delete", requestable: true });
    });
    const dispatch = createCatalogDispatch(api, await runCaller());
    const error: unknown = await dispatch("DELETE", "/issues/abc").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(McpToolError);
    expect(error).toMatchObject({ status: 403, code: "access_denied", missingAction: "tasks:delete", requestable: true });
    expect((error as Error).message).toBe("Deleting tasks needs tasks:delete");
  });

  it("re-enters the API as the caller, with the run id header and a JSON body", async () => {
    const api = Router();
    api.patch("/issues/:id", (req, res) => {
      res.json({ actor: req.actor, runHeader: req.header("x-paperclip-run-id"), body: req.body, id: req.params.id });
    });
    api.get("/empty", (_req, res) => { res.status(204).end(); });
    api.get("/plain", (_req, res) => { res.status(500).send("boom"); });
    const caller = await runCaller();
    const dispatch = createCatalogDispatch(api, caller);
    const result = await dispatch("PATCH", "/issues/TES-1", { status: "done" }) as Record<string, unknown>;
    expect(result).toEqual({ actor: caller.actor, runHeader: RUN, body: { status: "done" }, id: "TES-1" });
    expect(await dispatch("GET", "/empty")).toBeNull();
    await expect(dispatch("GET", "/plain")).rejects.toMatchObject({ status: 500, code: null });
  });

  it("runs extra middleware before the API, such as the route policy", async () => {
    const api = Router();
    api.post("/anything", (_req, res) => { res.json({ ok: true }); });
    const dispatch = createCatalogDispatch(api, await runCaller(), {
      middleware: [(_req, res) => { res.status(403).json({ error: "no", code: "access_denied", missingAction: "api:raw", requestable: false }); }],
    });
    await expect(dispatch("POST", "/anything", {})).rejects.toMatchObject({ status: 403, missingAction: "api:raw", requestable: false });
  });
});
