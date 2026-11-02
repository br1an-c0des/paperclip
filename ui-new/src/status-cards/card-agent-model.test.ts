import { describe, expect, it } from "vitest";
import { agentCardCheck, blocksCreate, harnessJwt, sortForCards, summarizerCardCheck, type CardAgent } from "./card-agent-model";

const agent = (patch: Partial<CardAgent> = {}): CardAgent => ({
  id: "a1",
  name: "Quill",
  status: "idle",
  adapterType: "claude_local",
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
  ...patch,
});

// As this instance's `GET /adapters` answers it.
const jwt = harnessJwt([
  { type: "claude_local", capabilities: { supportsLocalAgentJwt: true } },
  { type: "codex_local", capabilities: { supportsLocalAgentJwt: true } },
  { type: "process", capabilities: { supportsLocalAgentJwt: true } },
  { type: "http", capabilities: { supportsLocalAgentJwt: false } },
  { type: "openclaw_gateway", capabilities: { supportsLocalAgentJwt: false } },
  { type: "paperclip_runner", capabilities: { supportsLocalAgentJwt: false } },
]);

describe("agentCardCheck", () => {
  it("passes an idle agent on a harness that gets a run key, and one on the Paperclip Runner", () => {
    expect(agentCardCheck(agent(), jwt).level).toBe("ok");
    expect(agentCardCheck(agent({ adapterType: "paperclip_runner" }), jwt).level).toBe("ok");
  });

  it("can't use a process agent: it runs a command, not a model", () => {
    const check = agentCardCheck(agent({ adapterType: "process", status: "paused" }), jwt);
    expect(check.level).toBe("blocked");
    expect(check.title).toBe("Can't write cards");
    expect(blocksCreate(check)).toBe(true);
  });

  it("warns about harnesses that don't get a run key", () => {
    expect(agentCardCheck(agent({ adapterType: "http" }), jwt)).toMatchObject({ level: "warn", title: "Needs its own API key" });
    expect(agentCardCheck(agent({ adapterType: "openclaw_gateway" }), jwt).level).toBe("warn");
  });

  it("warns about a paused agent, one over budget, and one in error, pointing to the agent", () => {
    expect(agentCardCheck(agent({ status: "paused" }), jwt)).toMatchObject({ level: "warn", title: "Paused", action: "open_agent", agentId: "a1" });
    expect(agentCardCheck(agent({ status: "paused", budgetMonthlyCents: 150, spentMonthlyCents: 150 }), jwt).title).toBe("Paused: budget used up");
    expect(agentCardCheck(agent({ status: "error" }), jwt)).toMatchObject({ level: "warn", title: "Last run failed" });
    expect(blocksCreate(agentCardCheck(agent({ status: "paused" }), jwt))).toBe(false);
  });

  it("blocks a retired agent and one waiting for approval", () => {
    expect(agentCardCheck(agent({ status: "terminated" }), jwt).level).toBe("blocked");
    expect(agentCardCheck(agent({ status: "pending_approval" }), jwt)).toMatchObject({ level: "blocked", action: "approve" });
  });

  it("doesn't guess about a harness before the list arrives", () => {
    expect(agentCardCheck(agent({ adapterType: "http" }), undefined).level).toBe("ok");
    expect(agentCardCheck(agent({ adapterType: "process" }), undefined).level).toBe("blocked");
  });
});

describe("summarizerCardCheck", () => {
  it("waits for the settings and the built-in state", () => {
    expect(summarizerCardCheck({ enabled: undefined }, undefined, jwt).level).toBe("unknown");
    expect(summarizerCardCheck({ enabled: true }, undefined, jwt).level).toBe("unknown");
  });

  it("blocks every state but ready, since the server refuses the card (422 summarizer_not_configured)", () => {
    expect(summarizerCardCheck({ enabled: false }, undefined, jwt)).toMatchObject({ level: "blocked", title: "No Summarizer" });
    expect(summarizerCardCheck({ enabled: true, status: "not_provisioned", agentId: null }, undefined, jwt)).toMatchObject({
      level: "blocked",
      action: "setup_summarizer",
    });
    expect(summarizerCardCheck({ enabled: true, status: "pending_approval", agentId: "s1" }, undefined, jwt)).toMatchObject({ action: "approve" });
    expect(summarizerCardCheck({ enabled: true, status: "needs_setup", agentId: "s1" }, undefined, jwt)).toMatchObject({ action: "open_agent", agentId: "s1" });
    const paused = summarizerCardCheck({ enabled: true, status: "paused", agentId: "s1" }, agent({ id: "s1", status: "paused" }), jwt);
    expect(paused).toMatchObject({ level: "blocked", title: "Paused", action: "open_agent", agentId: "s1" });
    expect(blocksCreate(paused)).toBe(true);
  });

  it("checks a ready Summarizer's own agent", () => {
    expect(summarizerCardCheck({ enabled: true, status: "ready", agentId: "s1" }, agent({ id: "s1" }), jwt).level).toBe("ok");
    expect(summarizerCardCheck({ enabled: true, status: "ready", agentId: "s1" }, undefined, jwt).level).toBe("ok");
    expect(summarizerCardCheck({ enabled: true, status: "ready", agentId: "s1" }, agent({ id: "s1", status: "error" }), jwt).level).toBe("warn");
  });
});

describe("sortForCards", () => {
  it("offers the agents that can write a card first, then warnings, then the ones that can't", () => {
    const sorted = sortForCards(
      [
        agent({ id: "p", name: "Pipe", adapterType: "process" }),
        agent({ id: "z", name: "Zed", status: "paused" }),
        agent({ id: "b", name: "Bob", adapterType: "paperclip_runner" }),
        agent({ id: "a", name: "Ada" }),
        agent({ id: "h", name: "Hook", adapterType: "http" }),
      ],
      jwt,
    );
    expect(sorted.map((entry) => entry.agent.id)).toEqual(["a", "b", "h", "z", "p"]);
    expect(sorted.map((entry) => entry.check.level)).toEqual(["ok", "ok", "warn", "warn", "blocked"]);
  });
});
