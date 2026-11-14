import type { ExecutionAgentQueue } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  agentQueueOf,
  agentQueueParts,
  isWaitingToStart,
  pastStartGrace,
  QUEUED_START_GRACE_MS,
  queueWait,
  shownTaskRun,
  startedRuns,
  startGraceEndsAt,
  waitingTasks,
  WAITING_TO_START,
} from "./queue-wait";

/* U151 (upstream #21405, #21447, #21564): a queued run that never started waits, it isn't working. */

const queue: ExecutionAgentQueue = { agentId: "a1", agentName: "Codie", maxConcurrentRuns: 20, runningCount: 20, position: 41, queuedCount: 295 };
const atCapacity = { phase: "queued", label: "Waiting for Codie", cause: "agent_at_capacity", agentQueue: queue } as const;
const routine = { phase: "queued", label: "Waiting for TES-12 to finish", cause: "routine_execution_in_progress", agentQueue: null } as const;
const ordinary = { phase: "queued", label: "Queued", cause: null, agentQueue: null } as const;
const created = "2026-11-14T10:00:00.000Z";
const at = (seconds: number) => new Date(created).getTime() + seconds * 1000;

describe("the agent's line", () => {
  it("reads the place in line only for the agent_at_capacity cause", () => {
    expect(agentQueueOf(atCapacity)).toBe(queue);
    expect(agentQueueOf({ ...atCapacity, cause: "task_drain" })).toBeNull();
    expect(agentQueueOf({ ...atCapacity, agentQueue: null })).toBeNull();
    expect(agentQueueOf(null)).toBeNull();
  });

  it("words it as upstream does, with one slot singular", () => {
    expect(agentQueueParts(queue)).toEqual(["Waiting for Codie", "20 slots max", "41 of 295 in line"]);
    expect(agentQueueParts({ ...queue, maxConcurrentRuns: 1, position: 2, queuedCount: 2 })).toEqual(["Waiting for Codie", "1 slot max", "2 of 2 in line"]);
  });
});

describe("queueWait", () => {
  it("names the agent's line first, with no grace", () => {
    expect(queueWait({ status: "queued", startedAt: null, createdAt: created, execution: atCapacity }, at(1))).toEqual({
      kind: "agent",
      queue,
      label: "Waiting for Codie · 20 slots max · 41 of 295 in line",
    });
  });

  it("names a routine's hold in the server's words", () => {
    expect(queueWait({ status: "queued", startedAt: null, createdAt: created, execution: routine }, at(1))).toEqual({ kind: "hold", label: "Waiting for TES-12 to finish" });
  });

  it("reads ordinary admission as working for 30 seconds, then says Waiting to start", () => {
    const run = { status: "queued", startedAt: null, createdAt: created, execution: ordinary };
    expect(queueWait(run, at(29))).toBeNull();
    expect(queueWait(run, at(30))).toEqual({ kind: "start", label: WAITING_TO_START });
    expect(startGraceEndsAt(run)).toBe(at(0) + QUEUED_START_GRACE_MS);
  });

  it("never calls a started run waiting to start", () => {
    const running = { status: "running", startedAt: created, createdAt: created, execution: null };
    expect(queueWait(running, at(600))).toBeNull();
    expect(pastStartGrace({ status: "queued", startedAt: created, createdAt: created }, at(600))).toBe(false);
    expect(startGraceEndsAt(running)).toBeNull();
  });

  it("keeps a provider wait on a running run (U120)", () => {
    const run = { status: "running", startedAt: created, execution: { phase: "waiting_for_provider", label: "Waiting for the provider", cause: null } } as const;
    expect(queueWait(run, at(1))).toEqual({ kind: "hold", label: "Waiting for the provider" });
  });

  it("can't time a run without its creation time", () => {
    expect(queueWait({ status: "queued", startedAt: null }, at(600))).toBeNull();
  });
});

describe("waitingTasks", () => {
  it("marks a task waiting only when none of its live runs has started", () => {
    const waiting = waitingTasks([
      { issueId: "t1", status: "queued", startedAt: null, execution: atCapacity },
      { issueId: "t2", status: "queued", startedAt: null, execution: ordinary },
      { issueId: "t2", status: "running", startedAt: created },
      { issueId: "t3", status: "queued", startedAt: null, execution: routine },
      { issueId: "t4", status: "running", startedAt: created },
      { issueId: null, status: "queued", startedAt: null },
    ]);
    expect([...waiting.keys()]).toEqual(["t1", "t3"]);
    expect(waiting.get("t1")).toEqual({ queue, label: "Waiting for Codie · 20 slots max · 41 of 295 in line" });
    expect(waiting.get("t3")).toEqual({ queue: null, label: "Waiting for TES-12 to finish" });
  });

  it("keeps the agent's line when another waiting run of the task has none", () => {
    const waiting = waitingTasks([
      { issueId: "t1", status: "queued", startedAt: null, execution: ordinary },
      { issueId: "t1", status: "queued", startedAt: null, execution: atCapacity },
    ]);
    expect(waiting.get("t1")?.queue).toBe(queue);
    expect(waitingTasks([{ issueId: "t1", status: "queued", startedAt: null }]).get("t1")).toEqual({ queue: null, label: WAITING_TO_START });
  });
});

describe("started runs", () => {
  const runs = [
    { id: "r1", issueId: "t1", status: "queued", startedAt: null },
    { id: "r2", issueId: "t1", status: "running", startedAt: created },
    { id: "r3", issueId: "t2", status: "queued", startedAt: null },
    { id: "r4", issueId: "t3", status: "queued", startedAt: created },
  ];

  it("counts only runs that have started; a re-queued run has", () => {
    expect(isWaitingToStart(runs[0]!)).toBe(true);
    expect(isWaitingToStart(runs[3]!)).toBe(false);
    expect(startedRuns(runs).map((run) => run.id)).toEqual(["r2", "r4"]);
  });

  it("shows a task's started run over one still waiting", () => {
    expect(shownTaskRun(runs, "t1")?.id).toBe("r2");
    expect(shownTaskRun(runs, "t2")?.id).toBe("r3");
    expect(shownTaskRun(runs, "t9")).toBeUndefined();
  });
});
