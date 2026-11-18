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
