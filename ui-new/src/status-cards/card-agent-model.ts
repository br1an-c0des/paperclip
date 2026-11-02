import type { Agent } from "@paperclipai/shared";
import type { BuiltInAgentStatus } from "@/api/agents";

/*
 * Whether an agent can run a status card (decision 44): write its query and summaries back. A
 * card's setup is a hidden task assigned to the card's agent, which must call
 * `PUT /status-cards/:id/query` and `PUT /status-cards/:id/summary` from that task's run. What the
 * API lets the board know beforehand, from the server (status-cards.ts, built-in-agents.ts,
 * heartbeat/runtime-execution.ts, native-runtime/paperclip-runner-tool-authority.ts):
 *
 * - The default, the built-in Summarizer, must be set up and `ready`: anything else (built-in agents
 *   off, not set up, waiting for approval, needing setup, paused) makes the server refuse the card
 *   with 422 `summarizer_not_configured`. Its state is `GET /companies/:id/built-in-agents`.
 * - The agent must call the API from its run. An agent on the Paperclip Runner does it with the
 *   runner's `call_api` tool, which covers the status-card routes; a direct harness does it with the
 *   run key Paperclip injects, which only harnesses with `capabilities.supportsLocalAgentJwt`
 *   (`GET /adapters`) get. Others (HTTP, gateways, cloud harnesses) need their own Paperclip API
 *   key. `process` runs a fixed command, not a model, so it can't build a query at all.
 * - A paused agent doesn't run, so the setup waits; one in `error` may not start it, and the card
 *   then stays in Setting up (decision 44, "A retried setup can stall"); one over its monthly budget
 *   is paused by the server.
 *
 * Not knowable from the API: whether the server can mint run keys at all. Without
 * `PAPERCLIP_AGENT_JWT_SECRET` (or `BETTER_AUTH_SECRET`) every agent's API calls fail, whatever the
 * runner; only the startup banner says so.
 */

export type CardAgentLevel = "ok" | "warn" | "blocked" | "unknown";

/** What the board can do about it: set up the Summarizer, open the agent (resume or fix it), or approve its hire. */
export type CardAgentAction = "setup_summarizer" | "open_agent" | "approve";

export type CardAgentCheck = {
  level: CardAgentLevel;
  /** One line for the picker's hint and the notice's heading. */
  title: string;
  /** What it means for the card, and what to do. */
  detail?: string;
  action?: CardAgentAction;
  /** The agent the action opens. */
  agentId?: string | null;
};

/** Just what the rules read of an agent. */
export type CardAgent = Pick<Agent, "id" | "name" | "status" | "adapterType" | "budgetMonthlyCents" | "spentMonthlyCents">;

/** The harness capability the rules read (`GET /adapters`); missing when the list isn't loaded. */
export type HarnessJwt = ReadonlyMap<string, boolean>;

/** The Summarizer's built-in state; `enabled` is the instance's `enableBuiltInAgents`. */
export type SummarizerState = {
  enabled: boolean | undefined;
  status?: BuiltInAgentStatus;
  agentId?: string | null;
};

const RANK: Record<CardAgentLevel, number> = { ok: 0, unknown: 1, warn: 2, blocked: 3 };

const worse = (a: CardAgentCheck, b: CardAgentCheck) => (RANK[b.level] > RANK[a.level] ? b : a);

/** Whether the harness lets the agent call the API from its run; undefined when it isn't known. */
function harnessCheck(agent: CardAgent, jwt: HarnessJwt | undefined): CardAgentCheck {
  if (agent.adapterType === "process") {
    return {
      level: "blocked",
      title: "Can't write cards",
      detail: `${agent.name} runs a fixed command, not a model, so it can't build a card's query. Choose an agent with a model harness.`,
    };
  }
  // The Runner calls the API with its own tool (call_api), which covers the status-card routes.
  if (agent.adapterType === "paperclip_runner") return { level: "ok", title: "Paperclip Runner" };
  const supports = jwt?.get(agent.adapterType);
  if (supports === true) return { level: "ok", title: "Can write cards" };
  if (supports === false) {
    return {
      level: "warn",
      title: "Needs its own API key",
      detail: `${agent.name}'s harness doesn't get a Paperclip key for its runs. It can write the card only if it has a Paperclip API key of its own (an outside agent's claimed key).`,
    };
  }
  return { level: "unknown", title: "Harness not checked" };
}

/** Whether the agent will run at all. */
function statusCheck(agent: CardAgent): CardAgentCheck {
  if (agent.status === "terminated") {
    return { level: "blocked", title: "Retired", detail: `${agent.name} is retired and won't run.`, agentId: agent.id };
  }
  if (agent.status === "pending_approval") {
    return { level: "blocked", title: "Waiting for approval", detail: `${agent.name}'s hire hasn't been approved, so it can't run yet.`, action: "approve", agentId: agent.id };
  }
  if (agent.status === "paused") {
    const overBudget = agent.budgetMonthlyCents > 0 && agent.spentMonthlyCents >= agent.budgetMonthlyCents;
    return {
      level: "warn",
      title: overBudget ? "Paused: budget used up" : "Paused",
      detail: overBudget
        ? `${agent.name} has used its monthly budget, so it's paused. The card's setup waits until you raise the budget and resume it.`
        : `${agent.name} is paused. The card's setup and updates wait until you resume it.`,
      action: "open_agent",
      agentId: agent.id,
    };
  }
  if (agent.status === "error") {
    return {
      level: "warn",
      title: "Last run failed",
      detail: `${agent.name}'s last run failed. If the setup doesn't start, the card stays in Setting up: fix the agent, then use Run setup again.`,
      action: "open_agent",
      agentId: agent.id,
    };
  }
  return { level: "ok", title: "Can write cards" };
}

/** An agent chosen for the card. */
export function agentCardCheck(agent: CardAgent, jwt: HarnessJwt | undefined): CardAgentCheck {
  const harness = harnessCheck(agent, jwt);
  if (harness.level === "blocked") return harness;
  const status = statusCheck(agent);
  const result = worse(harness, status);
  return result.level === "unknown" ? { level: "ok", title: "Can write cards" } : result;
}

/**
 * The default (no agent chosen): the built-in Summarizer, which must be `ready`, and then its own
 * agent's harness. `agent` is the Summarizer's row in the company's agents when it has one.
 */
export function summarizerCardCheck(state: SummarizerState, agent: CardAgent | undefined, jwt: HarnessJwt | undefined): CardAgentCheck {
  if (state.enabled === undefined) return { level: "unknown", title: "Checking the Summarizer…" };
  if (!state.enabled) {
    return {
      level: "blocked",
      title: "No Summarizer",
      detail: "Built-in agents are off on this instance, so there's no Summarizer to run the card. Choose an agent, or turn on Built-in agents in App settings → Features.",
    };
  }
  switch (state.status) {
    case undefined:
      return { level: "unknown", title: "Checking the Summarizer…" };
    case "not_provisioned":
      return {
        level: "blocked",
        title: "Not set up",
        detail: "The Summarizer isn't set up in this company, so the card can't be created with it. Set it up, or choose an agent.",
        action: "setup_summarizer",
      };
    case "pending_approval":
      return {
        level: "blocked",
        title: "Waiting for approval",
        detail: "The Summarizer's hire is waiting for approval in the Inbox. Approve it, then resume it, or choose an agent.",
        action: "approve",
        agentId: state.agentId,
      };
    case "needs_setup":
      return {
        level: "blocked",
        title: "Needs setup",
        detail: "The Summarizer needs a harness and model before it can run. Finish its setup, or choose an agent.",
        action: "open_agent",
        agentId: state.agentId,
      };
    case "paused":
      return {
        level: "blocked",
        title: "Paused",
        detail: "The Summarizer is paused, and the server only gives cards to a ready Summarizer. Resume it on its page, or choose an agent.",
        action: "open_agent",
        agentId: state.agentId,
      };
    case "ready":
      return agent ? agentCardCheck(agent, jwt) : { level: "ok", title: "Ready" };
  }
}

/** Order for the picker: agents that can run a card first, then the ones with a warning, then the rest; by name within each. */
export function sortForCards<T extends CardAgent>(agents: readonly T[], jwt: HarnessJwt | undefined): { agent: T; check: CardAgentCheck }[] {
  return agents
    .map((agent) => ({ agent, check: agentCardCheck(agent, jwt) }))
    .sort((a, b) => RANK[a.check.level] - RANK[b.check.level] || a.agent.name.localeCompare(b.agent.name));
}

/** The harness capability as a map, from `GET /adapters`. */
export function harnessJwt(adapters: readonly { type: string; capabilities?: { supportsLocalAgentJwt?: boolean } }[] | undefined): HarnessJwt | undefined {
  if (!adapters) return undefined;
  return new Map(adapters.map((adapter) => [adapter.type, adapter.capabilities?.supportsLocalAgentJwt === true]));
}

/** Whether Create is held back: a check that can never work as things stand. */
export function blocksCreate(check: CardAgentCheck): boolean {
  return check.level === "blocked";
}
