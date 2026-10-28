import { describe, expect, it } from "vitest";
import type { LiveRun } from "@/api/heartbeats";
import type { WorkloadRun } from "@/api/workload";
import {
  dayWindow,
  formatClock,
  formatDuration,
  formatHours,
  groupAgents,
  heatDays,
  heatLevel,
  heatmap,
  agentStates,
  openWork,
  rosterIds,
  suggestion,
  todayLanes,
  waitingChains,
  windowFraction,
  type WorkloadAgent,
  type WorkloadInput,
  type WorkloadTask,
} from "./workload-model";

// Local times, so the tests read the same in every time zone. "Now" is Tuesday Oct 27, 4:30 pm.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const NOW = at(27, 16, 30);
const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 60 * 60 * 1000;

function agent(id: string, fields: Partial<WorkloadAgent> = {}): WorkloadAgent {
  return { id, name: id.toUpperCase(), role: "engineer", status: "idle", ...fields };
}

function task(id: string, fields: Partial<WorkloadTask> = {}): WorkloadTask {
  return {
    id,
    identifier: id.toUpperCase(),
    title: `Task ${id}`,
    status: "todo",
    priority: "medium",
    projectId: "p1",
    assigneeAgentId: null,
    assigneeUserId: null,
    createdAt: new Date(at(20, 9)),
    updatedAt: new Date(at(27, 9)),
    ...fields,
  };
}

function run(id: string, agentId: string, issueId: string | null, start: number, end: number | null, fields: Partial<WorkloadRun> = {}): WorkloadRun {
  return {
    id,
    agentId,
    issueId,
    status: end === null ? "running" : "succeeded",
    invocationSource: "assignment",
    startedAt: iso(start),
    finishedAt: end === null ? null : iso(end),
    createdAt: iso(start),
    ...fields,
  };
}

function live(id: string, agentId: string, issueId: string | null, status: "running" | "queued", start: number): LiveRun {
  return { id, agentId, agentName: agentId, issueId, status, startedAt: status === "running" ? iso(start) : null, createdAt: iso(start) };
}

function input(fields: Partial<WorkloadInput> = {}): WorkloadInput {
  return {
    scope: { kind: "project", projectId: "p1" },
    agents: [],
    tasks: [],
    runs: [],
    runsTruncated: false,
    liveRuns: [],
    projects: [{ id: "p1", name: "trading workbench", color: "#22b5a5" }, { id: "p2", name: "gearBase" }],
    youId: "me",
    now: NOW,
    ...fields,
  };
}

describe("formatting", () => {
  it("formats durations, hours and clock times", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(4.5 * HOUR)).toBe("4h 30m");
    expect(formatDuration(2 * HOUR)).toBe("2h");
    expect(formatHours(0)).toBe("0h");
    expect(formatHours(4.54 * HOUR)).toBe("4.5h");
    expect(formatHours(12.4 * HOUR)).toBe("12h");
    expect(formatClock(at(27, 14, 25))).toBe("2:25 pm");
    expect(formatClock(at(27, 0, 5))).toBe("12:05 am");
    expect(formatClock(at(27, 16))).toBe("4 pm");
  });
});

describe("rosterIds", () => {
  it("lists a project's agents with live runs, open work or recent runs, leaving hidden agents out", () => {
    const agents = [agent("a"), agent("b"), agent("c"), agent("d"), agent("e", { status: "terminated" }), agent("f")];
    const tasks = [task("t1", { assigneeAgentId: "a" }), task("t2", { assigneeAgentId: "e" }), task("t3", { status: "done", assigneeAgentId: "f" }), task("x", { projectId: "p2", assigneeAgentId: "d" })];
    const ids = rosterIds(
      input({
        agents,
        tasks,
        liveRuns: [live("l1", "b", "t3", "running", at(27, 16))],
        runs: [run("r1", "c", "t3", at(26, 10), at(26, 11)), run("r2", "d", "x", at(27, 9), at(27, 10)), run("r3", "f", "t3", at(1, 9), at(1, 10))],
      }),
      at(21, 0),
    );
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("lists every visible agent on the company page", () => {
    const ids = rosterIds(input({ scope: { kind: "company" }, agents: [agent("a"), agent("b", { status: "pending_approval" }), agent("c", { status: "paused" })] }), 0);
    expect(ids).toEqual(["a", "c"]);
  });
});

describe("groupAgents", () => {
  it("groups by team, built-in agents last, and drops the heading for a single group", () => {
    const groups = groupAgents(
      [agent("q", { role: "researcher", name: "Quant" }), agent("s", { role: "engineer", name: "Strategy" }), agent("c", { role: "ceo", name: "CEO" }), agent("sum", { role: "general", name: "Summarizer" })],
      new Set(["sum"]),
    );
    expect(groups).toEqual([
      { label: "Leadership", agentIds: ["c"] },
      { label: "Research", agentIds: ["q"] },
      { label: "Engineering", agentIds: ["s"] },
      { label: "Built in", agentIds: ["sum"] },
    ]);
    expect(groupAgents([agent("a"), agent("b")], new Set())).toEqual([{ label: "", agentIds: ["a", "b"] }]);
  });
});

describe("waitingChains", () => {
  const blocker = { id: "t1", identifier: "T1", title: "Backfill", status: "in_progress" as const, priority: "high" as const, assigneeAgentId: "qr", assigneeUserId: null };

  it("chains a blocked task to its blocker, ringing the blocked one", () => {
    const chains = waitingChains(
      input({
        tasks: [task("t1", { status: "in_progress", assigneeAgentId: "qr" }), task("t2", { status: "blocked", assigneeAgentId: "ml", blockedBy: [blocker] })],
        liveRuns: [live("l1", "qr", "t1", "running", at(27, 16))],
      }),
    );
    expect(chains).toHaveLength(1);
    expect(chains[0]!.nodes.map((node) => [node.kind, node.agentId, node.label, node.note, node.held])).toEqual([
      ["agent", "qr", "T1", "running", false],
      ["agent", "ml", "T2", "blocked", true],
    ]);
    expect(chains[0]!.summary).toBe("T2 starts when T1 is done.");
  });

  it("goes one level deeper when the server names a terminal blocker, and notes an unassigned one", () => {
    const deeper = { ...blocker, id: "t0", identifier: "T0", status: "todo" as const, assigneeAgentId: null };
    const chains = waitingChains(input({ tasks: [task("t2", { status: "blocked", blockedBy: [{ ...blocker, terminalBlockers: [deeper] }] })] }));
    expect(chains[0]!.nodes.map((node) => node.label)).toEqual(["T0", "T1", "T2"]);
    expect(chains[0]!.nodes[0]!.kind).toBe("nobody");
    expect(chains[0]!.summary).toBe("T2 waits on T1, which waits on T0. Nobody is assigned to T0.");
  });

  it("ignores resolved blockers and puts reviews waiting on you first", () => {
    const chains = waitingChains(
      input({
        tasks: [
          task("t2", { status: "blocked", assigneeAgentId: "ml", priority: "critical", blockedBy: [{ ...blocker, id: "t9", status: "in_progress" }] }),
          task("t3", { status: "blocked", blockedBy: [{ ...blocker, status: "done" }] }),
          task("t4", { status: "in_review", assigneeUserId: "me" }),
          task("t5", { status: "in_review", assigneeUserId: "someone" }),
        ],
        runs: [run("r1", "fe", "t4", at(27, 13), at(27, 14)), run("r2", "fe", "t5", at(27, 11), at(27, 12))],
      }),
    );
    expect(chains.map((chain) => chain.key)).toEqual(["review:t4", "blocked:t2", "review:t5"]);
    expect(chains[0]!.nodes.map((node) => [node.kind, node.label, node.note])).toEqual([
      ["agent", "T4", "in review"],
      ["you", "You", "review"],
    ]);
    expect(chains[0]!.summary).toBe("Your review is the next step for T4.");
  });
});

describe("openWork", () => {
  const tasks = [
    task("a1", { status: "in_progress", assigneeAgentId: "a" }),
    task("a2", { status: "todo", assigneeAgentId: "a" }),
    task("a3", { status: "todo", assigneeAgentId: "a", projectId: "p2" }),
    task("a4", { status: "done", assigneeAgentId: "a" }),
    task("b1", { status: "blocked", assigneeAgentId: "b" }),
  ];

  it("splits a project's open work by status, busiest first, leaving out agents with none", () => {
    const result = openWork(input({ tasks }), ["b", "a", "c"]);
    expect(result.rows.map((row) => [row.agentId, row.total, row.segments.map((segment) => `${segment.label}:${segment.count}`)])).toEqual([
      ["a", 2, ["In progress:1", "Todo:1"]],
      ["b", 1, ["Blocked:1"]],
    ]);
    expect(result.key.map((segment) => segment.label)).toEqual(["In progress", "Todo", "Blocked"]);
  });

  it("splits the company's open work by project and keeps agents with none", () => {
    const result = openWork(input({ scope: { kind: "company" }, tasks }), ["a", "b", "c"]);
    expect(result.rows.map((row) => [row.agentId, row.segments.map((segment) => `${segment.label}:${segment.count}`)])).toEqual([
      ["a", ["trading workbench:2", "gearBase:1"]],
      ["b", ["trading workbench:1"]],
      ["c", []],
    ]);
    expect(result.key[0]!.gradient).toContain("#22b5a5");
  });
});

describe("dayWindow", () => {
  it("runs from 6 am to midnight, or from the hour of an earlier bar", () => {
    const window = dayWindow(NOW);
    expect(window.start).toBe(at(27, 6));
    expect(window.end).toBe(at(28, 0));
    expect(window.ticks.map((tick) => tick.label)).toEqual(["6a", "9a", "12p", "3p", "6p", "9p"]);
    expect(windowFraction(window, at(27, 15))).toBe(0.5);
    expect(dayWindow(NOW, at(27, 4, 20)).start).toBe(at(27, 4));
    expect(dayWindow(NOW, at(26, 22)).start).toBe(at(27, 0));
  });
});

describe("todayLanes", () => {
  const agents = [
    agent("qr", { name: "Quant Researcher", runtimeConfig: { heartbeat: { enabled: true, intervalSec: 4 * 3600 } }, lastHeartbeatAt: new Date(at(27, 16, 12)) } as Partial<WorkloadAgent>),
    agent("ml", { name: "ML Engineer" }),
    agent("fe", { name: "Frontend Engineer" }),
    agent("ce", { name: "CEO", status: "paused", pausedAt: new Date(at(20, 9)) }),
  ];
  const blocker = { id: "t1", identifier: "T1", title: "Backfill", status: "in_progress" as const, priority: "high" as const, assigneeAgentId: "qr", assigneeUserId: null };
  const tasks = [
    task("t1", { status: "in_progress", assigneeAgentId: "qr" }),
    task("t5", { status: "todo", priority: "low", assigneeAgentId: "qr" }),
    task("t6", { status: "todo", priority: "high", assigneeAgentId: "qr" }),
    task("t2", { status: "blocked", assigneeAgentId: "ml", blockedBy: [blocker], updatedAt: new Date(at(27, 11, 30)) }),
    task("t3", { status: "in_review", assigneeUserId: "me" }),
    task("other", { projectId: "p2", assigneeAgentId: "fe" }),
  ];
  const runs = [
    run("r3", "qr", "t1", at(27, 16, 12), null),
    run("r2", "fe", "t3", at(27, 13, 30), at(27, 14, 25), { costUsd: "0.30" }),
    run("r1", "qr", "t1", at(27, 11, 18), at(27, 13, 12), { costUsd: "1.20" }),
    run("r0", "qr", "t1", at(26, 10), at(26, 11)),
    run("rx", "fe", "other", at(27, 15), at(27, 15, 30)),
  ];
  const data = input({ agents, tasks, runs, liveRuns: [live("r3", "qr", "t1", "running", at(27, 16, 12))] });
  const { lanes, window, legend } = todayLanes(data, ["qr", "ml", "fe", "ce"]);
  const lane = (id: string) => lanes.find((entry) => entry.agentId === id)!;

  it("draws today's runs in the scope, the live one up to now, and adds up busy time and spend", () => {
    const qr = lane("qr");
    expect(qr.state).toEqual({ key: "running", label: "Running T1", runId: "r3", taskId: "t1" });
    const runBars = qr.bars.filter((bar) => bar.kind === "run" || bar.kind === "live");
    expect(runBars.map((bar) => [bar.kind, bar.runId, bar.end - bar.start])).toEqual([
      ["run", "r1", (114 * 60_000)],
      ["live", "r3", 18 * 60_000],
    ]);
    expect(runBars[1]!.tip).toBe("T1 · running 18m");
    expect(qr.busyMs).toBe((114 + 18) * 60_000);
    expect(qr.spendUsd).toBeCloseTo(1.2);
    expect(window.start).toBe(at(27, 6));
    expect(legend.map((entry) => entry.label)).toEqual(["T1", "T3"]);
  });

  it("schedules heartbeats after now and orders the queue by status and priority", () => {
    const qr = lane("qr");
    const scheduled = qr.bars.filter((bar) => bar.kind === "scheduled");
    expect(scheduled.map((bar) => bar.start)).toEqual([at(27, 20, 12)]);
    expect(scheduled[0]!.tip).toBe("Heartbeat every 4h · next at 8:12 pm");
    expect(qr.queue.map((item) => item.task.id)).toEqual(["t6", "t5"]);
    expect(qr.queueNote).toBe("");
  });

  it("starts a blocked stretch after the agent's last run today, when that ended later", () => {
    const result = todayLanes(input({ agents, tasks, runs: [run("m1", "ml", "t2", at(27, 12), at(27, 13))] }), ["ml"]);
    expect(result.lanes[0]!.bars.map((bar) => [bar.kind, bar.start])).toEqual([
      ["run", at(27, 12)],
      ["blocked", at(27, 13)],
    ]);
  });

  it("shows a blocked agent waiting from its task's last update, and a paused one", () => {
    const ml = lane("ml");
    expect(ml.state.key).toBe("blocked");
    expect(ml.bars).toEqual([
      expect.objectContaining({ kind: "blocked", start: at(27, 11, 30), end: NOW, label: "Waiting on T1" }),
    ]);
    expect(ml.queueNote).toBe("Nothing else queued");
    const ce = lane("ce");
    expect(ce.state.label).toBe("Paused");
    expect(ce.bars).toEqual([expect.objectContaining({ kind: "paused", start: window.start, end: window.end })]);
  });

  it("says when an idle agent last finished, and what waits on your review", () => {
    const fe = lane("fe");
    expect(fe.state).toEqual({ key: "idle", label: "Idle since 3:30 pm", runId: null, taskId: null });
    expect(fe.bars.map((bar) => bar.runId)).toEqual(["r2"]);
    expect(fe.queueNote).toBe("Queue is empty · T3 is in review with you");
  });

  it("gives the same state line on its own, for the heatmap rows", () => {
    expect(agentStates(data, ["fe", "ml"]).get("fe")!.label).toBe("Idle since 3:30 pm");
    expect(agentStates(data, ["fe", "ml"]).get("ml")!.key).toBe("blocked");
  });

  it("doesn't call an agent blocked while it has open work it can do", () => {
    const mixed = input({ agents, tasks: [...tasks, task("t7", { status: "todo", assigneeAgentId: "ml" })], runs });
    expect(agentStates(mixed, ["ml"]).get("ml")!.key).toBe("idle");
  });

  it("puts queued runs at the now line, and says when an agent is busy on another project", () => {
    const result = todayLanes(
      input({ agents, tasks, runs: [], liveRuns: [live("q1", "ml", "t2", "queued", at(27, 16, 20)), live("l2", "fe", "other", "running", at(27, 16))] }),
      ["ml", "fe"],
    );
    const ml = result.lanes[0]!;
    expect(ml.state.label).toBe("Queued T2");
    expect(ml.bars).toEqual([expect.objectContaining({ kind: "queued", start: NOW, label: "T2 next", runId: "q1" })]);
    expect(result.lanes[1]!.state).toEqual({ key: "elsewhere", label: "Running elsewhere", runId: "l2", taskId: null });
    expect(result.lanes[1]!.bars).toEqual([]);
  });

  it("labels chat replies as chat across the company, and leaves them out of a project", () => {
    const chatRuns = [run("c1", "qr", "chat", at(27, 15), at(27, 15, 10)), run("c2", "qr", "chat", at(27, 16, 20), null)];
    const liveChat = [live("c2", "qr", "chat", "running", at(27, 16, 20))];
    const company = todayLanes(
      input({ scope: { kind: "company" }, agents: [agent("qr")], tasks: [], runs: chatRuns, liveRuns: liveChat, chatIds: new Set(["chat"]) }),
      ["qr"],
    ).lanes[0]!;
    expect(company.state).toEqual({ key: "running", label: "Replying in a chat", runId: "c2", taskId: null });
    expect(company.bars.map((bar) => [bar.kind, bar.label, bar.taskId])).toEqual([
      ["run", "Chat", null],
      ["live", "Chat", null],
    ]);
    expect(company.bars[0]!.tip).toBe("Chat · 3 pm · 10m");

    const project = todayLanes(input({ agents: [agent("qr")], runs: chatRuns, liveRuns: liveChat, chatIds: new Set(["chat"]) }), ["qr"]).lanes[0]!;
    expect(project.state.key).toBe("elsewhere");
    expect(project.bars).toEqual([]);
  });
});

describe("heatmap", () => {
  it("covers 7 days of 4-hour blocks or 30 days, ending today", () => {
    const week = heatDays("week", NOW);
    expect(week).toHaveLength(7);
    expect(week[0]).toEqual({ start: at(21, 0), label: "Wed 21", today: false });
    expect(week[6]!.label).toBe("Today");
    const month = heatDays("month", NOW);
    expect(month).toHaveLength(30);
    expect(month[0]!.label).toBe("Sep 28");
    expect(month[1]!.label).toBe("");
  });

  it("levels busy time by its share of a block, or hours in a day", () => {
    expect([0, 30, 60, 150, 200].map((minutes) => heatLevel("week", minutes * 60_000))).toEqual([0, 1, 2, 3, 4]);
    expect([0, 1, 3, 6, 10].map((hours) => heatLevel("month", hours * HOUR))).toEqual([0, 1, 2, 3, 4]);
  });

  const agents = [agent("a", { name: "Busy" }), agent("b", { name: "Quiet" }), agent("c", { name: "Paused", status: "paused", pausedAt: new Date(at(26, 10)) })];
  const tasks = [task("t1", { assigneeAgentId: "a" }), task("t2", { assigneeAgentId: "a" })];
  const runs = [
    run("r1", "a", "t1", at(27, 8), at(27, 11), { costUsd: "2.00" }),
    run("r2", "a", "t1", at(25, 14), at(25, 15)),
    run("r3", "b", "t2", at(26, 9), at(26, 9, 20)),
    run("r4", "c", "t2", at(22, 1), at(22, 2)),
  ];

  it("fills blocks from runs, outlines what's ahead, hatches paused time, and adds an all-agents row", () => {
    const map = heatmap(input({ agents, tasks, runs }), ["a", "b", "c"], "week");
    const a = map.rows[0]!;
    expect(a.busyMs).toBe(4 * HOUR);
    expect(a.activeDays).toBe(2);
    expect(a.costUsd).toBe(2);
    // Today: 8 am–12 pm holds all 3 of r1's hours; 4–8 pm has started; 8 pm–12 am is ahead.
    expect(a.days[6]!.map((cell) => cell.kind)).toEqual(["busy", "busy", "busy", "busy", "busy", "ahead"]);
    expect(a.days[6]![2]).toEqual(expect.objectContaining({ level: 4, busyMs: 3 * HOUR, tip: "Busy · Today, 8 am–12 pm: 3h busy" }));
    const c = map.rows[2]!;
    expect(c.days[1]![0]!.level).toBe(2);
    expect(c.days[5]![3]!.kind).toBe("paused");
    expect(c.days[5]![2]!.kind).toBe("paused");
    expect(c.days[5]![1]!.kind).toBe("busy");
    expect(map.pausedShown).toBe(true);
    expect(map.total.days[6]![2]).toEqual(expect.objectContaining({ level: 2, tip: "Today, 8 am–12 pm: 1 of 3 agents busy" }));
    expect(map.total.busyMs).toBe(4 * HOUR + 20 * 60_000 + HOUR);
  });

  it("marks the busiest agent and the one with the most room that can take work", () => {
    const map = heatmap(input({ agents, tasks, runs }), ["a", "b", "c"], "week");
    expect(map.rows[0]!.flags).toEqual([{ kind: "busiest", title: "Busiest", body: "4h of runs this week, 2.3× the average agent." }]);
    expect(map.rows[1]!.flags).toEqual([{ kind: "spare", title: "Most spare capacity", body: "Only 0.3h busy this week. Nothing open is assigned to it." }]);
    expect(map.rows[2]!.flags).toEqual([]);
  });

  it("leaves markers off when nobody was busy for long", () => {
    const short = [run("r1", "a", "t1", at(27, 8), at(27, 8, 20)), run("r2", "b", "t2", at(27, 9), at(27, 9, 1))];
    const map = heatmap(input({ agents, tasks, runs: short }), ["a", "b"], "week");
    expect(map.rows.flatMap((row) => row.flags)).toEqual([]);
  });

  it("says which days are older than the loaded runs", () => {
    const map = heatmap(input({ agents, tasks, runs: runs.slice(0, 2), runsTruncated: true }), ["a"], "month");
    expect(map.loadedFrom).toBe(at(25, 14));
    expect(map.rows[0]!.days[0]![0]!.kind).toBe("unloaded");
    expect(map.rows[0]!.days[27]![0]!.kind).toBe("busy");
  });
});

describe("suggestion", () => {
  it("offers the most urgent unassigned todo to the free agent with the least open work", () => {
    const result = suggestion(
      input({
        agents: [agent("a", { name: "Ada" }), agent("b", { name: "Bea" }), agent("c", { name: "Cy", status: "paused" }), agent("d", { name: "Di" })],
        tasks: [
          task("u1", { priority: "low", createdAt: new Date(at(10, 9)) }),
          task("u2", { priority: "high", title: "Cost profile editor", createdAt: new Date(at(17, 9)) }),
          task("u3", { status: "backlog", priority: "critical" }),
          task("x1", { assigneeAgentId: "a" }),
        ],
        runs: [run("r1", "b", "x1", at(27, 13), at(27, 14, 25))],
        liveRuns: [live("l1", "d", null, "running", at(27, 16))],
      }),
      ["a", "b", "c", "d"],
    );
    expect(result).toEqual({
      task: expect.objectContaining({ id: "u2" }),
      agentId: "b",
      title: "Give U2 to Bea?",
      body: 'Bea has been idle since 2:25 pm, with nothing open assigned. "Cost profile editor" has had no assignee for 10 days.',
      next: "Assigning moves U2 to Bea, which picks it up on its next run.",
    });
  });

  it("offers nothing without unassigned work or a free agent", () => {
    expect(suggestion(input({ agents: [agent("a")], tasks: [task("x", { assigneeAgentId: "a" })] }), ["a"])).toBeNull();
    const busy = [task("u"), task("x1", { assigneeAgentId: "a" }), task("x2", { assigneeAgentId: "a" }), task("x3", { assigneeAgentId: "a" })];
    expect(suggestion(input({ agents: [agent("a")], tasks: busy }), ["a"])).toBeNull();
  });
});
