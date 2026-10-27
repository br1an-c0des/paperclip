import type { ActivityEvent, Agent, CompactIssue, DashboardRunActivityDay } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { LiveRun } from "@/api/heartbeats";
import type { OrgNode } from "@/api/org";
import type { RunSummary } from "@/api/runs";
import {
  activityLine,
  agentDetail,
  buildOrgTree,
  chartMax,
  filterCounts,
  harnessAndModel,
  legacyFilter,
  liveRunByAgent,
  managerChoices,
  matchesFilter,
  matchesSearch,
  monthSpendCents,
  orgState,
  projectProgress,
  runCountsByAgent,
  runDayBars,
  runTotals,
  shortAgo,
  sortRows,
  successRate,
  taskIndex,
  topSpenders,
  treeSize,
  type OrgTreeNode,
} from "./org-model";

type TestAgent = Pick<Agent, "id" | "name" | "status" | "reportsTo">;

const agent = (id: string, reportsTo: string | null = null, status: Agent["status"] = "idle"): TestAgent => ({ id, name: id.toUpperCase(), status, reportsTo });
const node = (id: string, reports: OrgNode[] = []): OrgNode => ({ id, name: id.toUpperCase(), role: "general", status: "idle", reports });
const shape = (nodes: OrgTreeNode<TestAgent>[]): unknown => nodes.map((entry) => (entry.reports.length ? { [entry.agent.id]: shape(entry.reports) } : entry.agent.id));

const task = (id: string, assigneeAgentId: string | null, status: CompactIssue["status"], extra: Partial<CompactIssue> = {}) =>
  ({ id, identifier: id.toUpperCase(), title: `Task ${id}`, assigneeAgentId, status, projectId: null, ...extra }) as CompactIssue;
const liveRun = (agentId: string, extra: Partial<LiveRun> = {}): LiveRun => ({
  id: `run-${agentId}`,
  status: "running",
  agentId,
  agentName: agentId,
  startedAt: "2026-10-27T11:42:00Z",
  createdAt: "2026-10-27T11:41:00Z",
  ...extra,
});

describe("buildOrgTree", () => {
  it("follows the server's tree and sorts siblings by name", () => {
    const agents = [agent("ceo"), agent("cto", "ceo"), agent("qa", "cto"), agent("fe", "cto")];
    const tree = buildOrgTree([node("ceo", [node("cto", [node("qa"), node("fe")])])], agents);
    expect(shape(tree)).toEqual([{ ceo: [{ cto: ["fe", "qa"] }] }]);
  });

  it("moves the reports of pending hires and built-ins up to their place", () => {
    const agents = [agent("ceo"), agent("hire", "ceo", "pending_approval"), agent("de", "hire"), agent("bot"), agent("x", "bot")];
    const tree = buildOrgTree([node("ceo", [node("hire", [node("de")])]), node("bot", [node("x")])], agents, new Set(["bot"]));
    expect(shape(tree)).toEqual([{ ceo: ["de"] }, "x"]);
  });

  it("adds agents the server tree misses under their manager, or at the top", () => {
    const agents = [agent("ceo"), agent("new", "ceo"), agent("orphan", "gone")];
    expect(shape(buildOrgTree([node("ceo")], agents))).toEqual([{ ceo: ["new"] }, "orphan"]);
  });

  it("builds the tree from reportsTo when the server tree hasn't loaded", () => {
    const agents = [agent("qa", "cto"), agent("cto", "ceo"), agent("ceo")];
    expect(shape(buildOrgTree(undefined, agents))).toEqual([{ ceo: [{ cto: ["qa"] }] }]);
  });

  it("breaks a reporting loop instead of dropping it", () => {
    const agents = [agent("a", "b"), agent("b", "a")];
    const tree = buildOrgTree([], agents);
    expect(treeSize(tree)).toBe(2);
    expect(shape(tree)).toEqual([{ a: ["b"] }]);
  });

  it("never draws an agent twice and leaves out ones the list doesn't have", () => {
    const tree = buildOrgTree([node("a", [node("b")]), node("b"), node("ghost")], [agent("a"), agent("b", "a")]);
    expect(shape(tree)).toEqual([{ a: ["b"] }]);
  });
});

describe("managerChoices", () => {
  const agents = [agent("ceo"), agent("cto", "ceo"), agent("qa", "cto"), agent("fe", "cto"), agent("de", "ceo"), agent("old", null, "terminated")];

  it("leaves out the selection and everyone below it, so no loop forms", () => {
    expect(managerChoices(new Set(["cto"]), agents).map((entry) => entry.id)).toEqual(["ceo", "de"]);
  });

  it("leaves out retired agents and pending hires", () => {
    expect(managerChoices(new Set(["qa"]), agents).map((entry) => entry.id)).toEqual(["ceo", "cto", "de", "fe"]);
  });
});

describe("orgState and agentDetail", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const tasks = taskIndex([
    task("t1", "ml", "blocked"),
    task("t2", "qr", "in_progress"),
    task("t3", "fe", "todo"),
    task("t4", "fe", "done"),
  ]);
  const live = liveRunByAgent([liveRun("qr", { issueId: "t2" }), liveRun("se", { status: "queued" })]);

  it("reads approval, pause and error from the status, then live runs, then blocked work", () => {
    expect(orgState({ id: "x", status: "pending_approval" }, live, tasks)).toBe("pending");
    expect(orgState({ id: "qr", status: "paused" }, live, tasks)).toBe("paused");
    expect(orgState({ id: "x", status: "error" }, live, tasks)).toBe("error");
    expect(orgState({ id: "qr", status: "idle" }, live, tasks)).toBe("running");
    expect(orgState({ id: "se", status: "idle" }, live, tasks)).toBe("idle");
    expect(orgState({ id: "ml", status: "idle" }, live, tasks)).toBe("blocked");
    expect(orgState({ id: "fe", status: "idle" }, live, tasks)).toBe("idle");
  });

  it("says what a working agent is on and links its run", () => {
    const detail = agentDetail({ id: "qr", urlKey: "quant", lastHeartbeatAt: null, pausedAt: null, pauseReason: null }, "running", live, tasks, now);
    expect(detail).toMatchObject({ text: "T2 · 18m", href: "/agents/quant/runs/run-qr", runId: "run-qr", task: { identifier: "T2" } });
  });

  it("names the blocked task, the pause, the pending hire and the last run", () => {
    const base = { urlKey: "k", lastHeartbeatAt: null, pausedAt: null, pauseReason: null };
    expect(agentDetail({ ...base, id: "ml" }, "blocked", live, tasks, now)).toMatchObject({ text: "T1 is blocked", href: "/issues/T1" });
    expect(agentDetail({ ...base, id: "x", pauseReason: "budget", pausedAt: new Date("2026-10-20T12:00:00Z") }, "paused", live, tasks, now).text).toBe("Hit its budget · Oct 20");
    expect(agentDetail({ ...base, id: "x" }, "pending", live, tasks, now).href).toBe("/inbox");
    expect(agentDetail({ ...base, id: "fe", lastHeartbeatAt: new Date("2026-10-27T09:00:00Z") }, "idle", live, tasks, now).text).toBe("Last run 3h ago · 1 open");
    expect(agentDetail({ ...base, id: "zz" }, "idle", live, tasks, now).text).toBe("No runs yet");
  });

  it("formats short times", () => {
    expect(shortAgo("2026-10-27T11:59:40Z", now)).toBe("now");
    expect(shortAgo("2026-10-25T12:00:00Z", now)).toBe("2d");
  });
});

describe("roster filters, search and sort", () => {
  const rows = [
    { state: "running" as const, builtIn: false },
    { state: "blocked" as const, builtIn: false },
    { state: "pending" as const, builtIn: false },
    { state: "paused" as const, builtIn: false },
    { state: "idle" as const, builtIn: false },
    { state: "idle" as const, builtIn: true },
  ];

  it("counts each filter as board 20 draws it", () => {
    expect(filterCounts(rows)).toEqual({ all: 6, running: 1, attention: 2, paused: 1, idle: 1, builtin: 1 });
    expect(matchesFilter("error", false, "attention")).toBe(true);
  });

  it("maps the old UI's tabs", () => {
    expect(legacyFilter("active")).toBe("all");
    expect(legacyFilter("error")).toBe("attention");
    expect(legacyFilter("builtin")).toBe("builtin");
    expect(legacyFilter("nope")).toBe("all");
  });

  it("matches every word of a search", () => {
    const quant = { name: "Quant Researcher", role: "researcher" as Agent["role"], title: "Research lead" };
    expect(matchesSearch(quant, "quant lead")).toBe(true);
    expect(matchesSearch(quant, "quant engineer")).toBe(false);
  });

  it("sorts by status, name or spend", () => {
    const list = [
      { name: "b", state: "idle" as const, spendCents: 50 },
      { name: "a", state: "running" as const, spendCents: 10 },
      { name: "c", state: "pending" as const, spendCents: 90 },
    ];
    expect(sortRows(list, "status").map((row) => row.name)).toEqual(["c", "a", "b"]);
    expect(sortRows(list, "name").map((row) => row.name)).toEqual(["a", "b", "c"]);
    expect(sortRows(list, "spend").map((row) => row.name)).toEqual(["c", "b", "a"]);
  });
});

describe("runs and spend", () => {
  const now = new Date("2026-10-27T12:00:00Z");

  it("counts each agent's runs in the window and its success rate", () => {
    const runs: Pick<RunSummary, "agentId" | "status" | "createdAt">[] = [
      { agentId: "a", status: "succeeded", createdAt: "2026-10-26T00:00:00Z" },
      { agentId: "a", status: "failed", createdAt: "2026-10-25T00:00:00Z" },
      { agentId: "a", status: "running", createdAt: "2026-10-27T00:00:00Z" },
      { agentId: "a", status: "succeeded", createdAt: "2026-10-01T00:00:00Z" },
    ];
    const counts = runCountsByAgent(runs, new Date("2026-10-13T12:00:00Z")).get("a");
    expect(counts).toEqual({ total: 3, succeeded: 1, failed: 1 });
    expect(successRate(counts)).toBe(50);
    expect(successRate({ total: 1, succeeded: 0, failed: 0 })).toBeNull();
  });

  it("only counts the agent's spend for this month", () => {
    expect(monthSpendCents({ spentMonthlyCents: 1200, spendMonthUtc: "2026-10-01" }, now)).toBe(1200);
    expect(monthSpendCents({ spentMonthlyCents: 1200, spendMonthUtc: "2026-09-01" }, now)).toBe(0);
    expect(monthSpendCents({ spentMonthlyCents: 300 }, now)).toBe(300);
  });

  it("turns the dashboard's days into labelled bars and totals", () => {
    const day = (date: string, succeeded: number, failed = 0, recovered = 0): DashboardRunActivityDay => ({
      date, succeeded, failed, recovered, other: 0, total: succeeded + failed + recovered, failedByErrorCode: {},
    });
    const days = [day("2026-10-25", 3, 1), day("2026-10-26", 4, 0, 1), day("2026-10-27", 0)];
    const bars = runDayBars(days);
    expect(bars.map((bar) => bar.label)).toEqual(["Oct 25", "", "Oct 27"]);
    expect(bars[0]!.tip).toBe("Oct 25: 4 runs, 3 succeeded, 1 failed");
    expect(runTotals(days)).toEqual({ total: 9, succeeded: 7, recovered: 1, failed: 1, rate: 78 });
    expect(runTotals([]).rate).toBeNull();
    expect(chartMax(bars)).toBe(6);
  });

  it("ranks the top spenders and sums the rest", () => {
    const row = (name: string, spendCents: number) => ({ agent: { name }, spendCents });
    const result = topSpenders([row("a", 100), row("b", 0), row("c", 500), row("d", 200)], 2);
    expect(result.top.map((entry) => entry.agent.name)).toEqual(["c", "d"]);
    expect(result).toMatchObject({ max: 500, rest: { names: ["a"], cents: 100 } });
  });

  it("counts a project's done tasks, leaving cancelled ones out", () => {
    const tasks = [task("1", null, "done", { projectId: "p" }), task("2", null, "todo", { projectId: "p" }), task("3", null, "cancelled", { projectId: "p" }), task("4", null, "done", { projectId: "q" })];
    expect(projectProgress(tasks, "p")).toEqual({ done: 1, total: 2, open: 1, percent: 50 });
  });
});

describe("activityLine", () => {
  const names = {
    agent: (id: string) => (id === "a1" ? { name: "Quant Researcher", urlKey: "quant" } : undefined),
    person: (id: string) => (id === "u2" ? "Maya R." : "Someone"),
    youId: "u1",
  };
  const event = (extra: Partial<ActivityEvent>): ActivityEvent => ({
    id: "e",
    companyId: "c",
    actorType: "user",
    actorId: "u1",
    action: "issue.created",
    entityType: "issue",
    entityId: "i1",
    agentId: null,
    runId: null,
    details: null,
    createdAt: new Date("2026-10-27T10:00:00Z"),
    ...extra,
  });

  it("names you, people and agents, and links the task", () => {
    expect(activityLine(event({ details: { identifier: "TES-4" } }), names)).toMatchObject({ who: "You", verb: "created", target: "TES-4", href: "/issues/TES-4" });
    expect(activityLine(event({ actorId: "u2", action: "issue.comment_added", details: { identifier: "TES-4" } }), names)?.who).toBe("Maya R.");
    expect(activityLine(event({ actorType: "agent", actorId: "a1", action: "agent.paused", entityType: "agent", entityId: "a1" }), names)).toMatchObject({
      who: "Quant Researcher",
      verb: "paused",
      target: "Quant Researcher",
      href: "/agents/quant",
      tone: "gray",
    });
  });

  it("says what a status change did", () => {
    expect(activityLine(event({ action: "issue.updated", details: { identifier: "TES-4", changes: { status: { from: "todo", to: "done" } } } }), names)).toMatchObject({ verb: "finished", tone: "green" });
  });

  it("leaves out reads and inbox housekeeping", () => {
    expect(activityLine(event({ action: "issue.read_marked" }), names)).toBeNull();
    expect(activityLine(event({ action: "issue.inbox_archived" }), names)).toBeNull();
  });

  it("falls back to the action's words", () => {
    expect(activityLine(event({ action: "secret.rotated", entityType: "secret", details: { name: "API_KEY" } }), names)).toMatchObject({ verb: "rotated", target: "API_KEY" });
  });
});

describe("harness and model", () => {
  it("names the harness and runner as the agent page does", () => {
    const runner = { adapterType: "paperclip_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude", model: "claude-opus-5-5" } };
    expect(harnessAndModel(runner)).toEqual({ harness: "Claude Code · Paperclip Runner", model: "claude-opus-5-5" });
    expect(harnessAndModel({ adapterType: "claude_local", adapterConfig: {} })).toEqual({ harness: "Claude Code · Legacy runner", model: "Harness default" });
    expect(harnessAndModel({ adapterType: "process", adapterConfig: {} })).toEqual({ harness: "Process", model: "Managed externally" });
  });
});
