import type { AttentionItem } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import type { LiveRun } from "@/api/heartbeats";
import type { Request } from "@/requests/request-model";
import {
  budgetView,
  codeView,
  crew,
  crewSummary,
  feedApprovalIds,
  formatCents,
  openRequests,
  projectSpend,
  repoName,
  requestFilters,
  stuckWork,
  waitingTargets,
  type ProjectTask,
} from "./dashboard-model";

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function task(id: string, fields: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id,
    identifier: id.toUpperCase(),
    title: `Task ${id}`,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    updatedAt: NOW,
    blockedBy: [],
    interruption: null,
    reviewAttention: undefined,
    ...fields,
  } as ProjectTask;
}

const run = (id: string, agentId: string, issueId: string, status = "running"): LiveRun =>
  ({ id, agentId, agentName: agentId, issueId, status, startedAt: null, createdAt: NOW.toISOString() }) as LiveRun;

describe("budgetView", () => {
  it("compares this month's spend with a monthly budget and projects the pace", () => {
    const view = budgetView({ budget: { amountCents: 30_000, windowKind: "calendar_month_utc" }, monthCents: 14_218, allTimeCents: null, now: NOW });
    expect(view.period).toBe("October");
    expect(view.spentCents).toBe(14_218);
    expect(view.percent).toBe(47);
    expect(view.tone).toBe("ok");
    expect(view.limitLabel).toBe("of $300 monthly limit");
    // 14.5 days into a 31-day month.
    expect(view.pace).toBe("On pace for about $304 by Oct 31.");
  });

  it("warns from 80% and caps the meter when over", () => {
    const budget = { amountCents: 10_000, windowKind: "calendar_month_utc" as const };
    expect(budgetView({ budget, monthCents: 8_000, allTimeCents: null, now: NOW }).tone).toBe("warn");
    const over = budgetView({ budget, monthCents: 12_000, allTimeCents: null, now: NOW });
    expect(over.tone).toBe("over");
    expect(over.percent).toBe(100);
  });

  it("uses all-time spend for a lifetime budget, without a pace", () => {
    const view = budgetView({ budget: { amountCents: 50_000, windowKind: "lifetime" }, monthCents: 100, allTimeCents: 20_000, now: NOW });
    expect(view.period).toBe("All time");
    expect(view.spentCents).toBe(20_000);
    expect(view.limitLabel).toBe("of $500 lifetime limit");
    expect(view.pace).toBeNull();
  });

  it("shows spend without a limit, and no pace on the first day", () => {
    const view = budgetView({ budget: null, monthCents: 500, allTimeCents: null, now: new Date("2026-10-01T08:00:00Z") });
    expect(view.limitCents).toBeNull();
    expect(view.percent).toBeNull();
    expect(view.limitLabel).toBe("No budget set");
    expect(view.pace).toBeNull();
  });
});

describe("money helpers", () => {
  it("formats cents", () => {
    expect(formatCents(14_218)).toBe("$142.18");
    expect(formatCents(22_049, true)).toBe("$220");
  });

  it("finds the project's spend, zero when it has none", () => {
    const rows = [{ projectId: "p1", costCents: 120 }, { projectId: null, costCents: 5 }];
    expect(projectSpend(rows, "p1")).toBe(120);
    expect(projectSpend(rows, "p2")).toBe(0);
    expect(projectSpend(undefined, "p1")).toBeNull();
  });
});

describe("codeView", () => {
  const codebase = {
    workspaceId: null,
    repoUrl: null,
    repoRef: null,
    defaultRef: null,
    repoName: null,
    localFolder: null,
    managedFolder: "/managed",
    effectiveLocalFolder: "/managed",
    origin: "managed_checkout" as const,
  };

  it("lists repositories primary first, with open checkouts and running dev servers", () => {
    const view = codeView(
      {
        codebase,
        workspaces: [
          { sourceType: "git_repo", repoUrl: "https://github.com/acme/lib.git", repoRef: null, defaultRef: "develop", cwd: null, isPrimary: false },
          { sourceType: "git_repo", repoUrl: "https://github.com/acme/app", repoRef: "main", defaultRef: null, cwd: null, isPrimary: true },
        ],
      },
      [
        {
          executionWorkspaceStatus: "active",
          linkedIssues: [{ id: "1", identifier: "TES-1", title: "One", status: "in_progress", priority: "high", updatedAt: NOW }],
          primaryService: { id: "s", serviceName: "web", status: "running", url: "http://localhost:5173", port: 5173, healthStatus: "healthy", updatedAt: NOW },
        },
        { executionWorkspaceStatus: "archived", linkedIssues: [], primaryService: null },
      ] as never,
    );
    expect(view.repos).toEqual([
      { name: "acme/app", branch: "main", primary: true },
      { name: "acme/lib", branch: "develop", primary: false },
    ]);
    expect(view.checkouts).toEqual({ count: 1, tasks: ["TES-1"] });
    expect(view.services).toEqual([{ name: "web", url: "http://localhost:5173" }]);
  });

  it("falls back to the codebase, or a local folder", () => {
    expect(codeView({ workspaces: [], codebase: { ...codebase, repoUrl: "git@github.com:acme/x.git", repoName: null, defaultRef: "main" } }, []).repos).toEqual([
      { name: "acme/x", branch: "main", primary: true },
    ]);
    const local = codeView({ workspaces: [], codebase: { ...codebase, origin: "local_folder", localFolder: "/srv/app" } }, undefined);
    expect(local.repos).toEqual([]);
    expect(local.folder).toBe("/srv/app");
  });

  it("names repositories from their URLs", () => {
    expect(repoName("https://github.com/acme/app.git")).toBe("acme/app");
    expect(repoName("git@github.com:acme/app.git")).toBe("acme/app");
  });
});

describe("crew", () => {
  const agents = [
    { id: "a1", name: "Builder", status: "idle" },
    { id: "a2", name: "Analyst", status: "idle" },
    { id: "a3", name: "Writer", status: "paused" },
    { id: "a4", name: "Gone", status: "terminated" },
  ] as never;

  it("shows running agents first with their run's task, then blocked, paused and idle ones", () => {
    const tasks = [
      task("t1", { status: "in_progress", assigneeAgentId: "a1" }),
      task("t2", { status: "blocked", assigneeAgentId: "a2" }),
      task("t3", { status: "todo", assigneeAgentId: "a3" }),
      task("t4", { status: "todo", assigneeAgentId: "a4" }),
      task("t5", { status: "done", assigneeAgentId: "a2" }),
    ];
    const members = crew({ tasks, liveRuns: [run("r1", "a1", "t1"), run("r9", "a9", "elsewhere")], agents });
    expect(members.map((member) => [member.agentId, member.state, member.task?.id, member.runId])).toEqual([
      ["a1", "running", "t1", "r1"],
      ["a2", "blocked", "t2", null],
      ["a3", "paused", "t3", null],
    ]);
    expect(members[1]!.openCount).toBe(1);
    expect(crewSummary(members)).toBe("1 running · 1 blocked · 1 paused");
  });

  it("counts a queued run, and an agent with a run but no assigned task", () => {
    const members = crew({ tasks: [task("t1", { status: "todo" })], liveRuns: [run("r1", "a2", "t1", "queued")], agents });
    expect(members).toEqual([{ agentId: "a2", state: "queued", task: expect.objectContaining({ id: "t1" }), runId: "r1", openCount: 0 }]);
    expect(crewSummary(members)).toBe("1 running");
  });
});

describe("waitingTargets", () => {
  const item = (fields: Partial<AttentionItem>): AttentionItem =>
    ({
      sourceKind: "issue_thread_interaction",
      subject: { kind: "interaction", id: "i1" },
      relatedIssue: { kind: "issue", id: "t1" },
      project: { id: "p1" },
      dismissal: null,
      archivedAt: null,
      whyNow: "Waiting",
      activityAt: NOW.toISOString(),
      ...fields,
    }) as AttentionItem;

  it("keeps the project's requests and sign-offs, and leaves out other projects and dismissed items", () => {
    const targets = waitingTargets(
      [
        item({}),
        item({ sourceKind: "approval", relatedIssue: { kind: "issue", id: "t2" } as never }),
        item({ sourceKind: "review", subject: { kind: "issue", id: "t3" } as never, relatedIssue: null, project: null, whyNow: "Review it" }),
        item({ relatedIssue: { kind: "issue", id: "x" } as never, project: { id: "p2" } as never }),
        item({ relatedIssue: { kind: "issue", id: "t4" } as never, dismissal: { isActive: true } as never }),
        item({ sourceKind: "blocker_attention", relatedIssue: { kind: "issue", id: "t5" } as never }),
      ],
      "p1",
      new Set(["t1", "t2", "t3", "t4", "t5"]),
    );
    expect(targets.requestTaskIds).toEqual(["t1", "t2"]);
    expect(targets.signoffs).toEqual([{ taskId: "t3", whyNow: "Review it", since: NOW.toISOString() }]);
  });

  it("leaves out snoozed items and finds an approval's tasks from its linked issues", () => {
    const approval = item({ sourceKind: "approval", subject: { kind: "approval", id: "ap1" } as never, relatedIssue: null, project: null });
    const otherApproval = item({ sourceKind: "approval", subject: { kind: "approval", id: "ap2" } as never, relatedIssue: null, project: null });
    const snoozed = item({ relatedIssue: { kind: "issue", id: "t6" } as never, dismissal: { isActive: true, kind: "snooze", snoozedUntil: "2026-10-16" } as never });
    const targets = waitingTargets(
      [approval, otherApproval, snoozed],
      "p1",
      new Set(["t6", "t7"]),
      new Map([
        ["ap1", ["t7"]],
        ["ap2", ["elsewhere"]],
      ]),
    );
    expect(targets.requestTaskIds).toEqual(["t7"]);
    expect(feedApprovalIds([approval, otherApproval, approval, snoozed])).toEqual(["ap1", "ap2"]);
  });
});

describe("openRequests and requestFilters", () => {
  const request = (key: string, kind: Request["kind"], state: Request["state"], at: string) =>
    ({ key, kind, state, createdAt: new Date(at) }) as Request;

  it("keeps open and set-aside requests, newest first, and counts each kind", () => {
    const waiting = openRequests([
      { taskId: "t1", requests: [request("a", "question", "open", "2026-10-01"), request("b", "proposal", "settled", "2026-10-02")] },
      { taskId: "t2", requests: [request("c", "approval", "set_aside", "2026-10-03")] },
    ]);
    expect(waiting.map((entry) => [entry.taskId, entry.request.key])).toEqual([
      ["t2", "c"],
      ["t1", "a"],
    ]);
    expect(requestFilters(waiting, 2)).toEqual([
      { value: "all", label: "All", count: 4 },
      { value: "question", label: "Questions", count: 1 },
      { value: "approval", label: "Approvals", count: 1 },
      { value: "signoff", label: "Sign-offs", count: 2 },
    ]);
  });
});

describe("stuckWork", () => {
  const input = (tasks: ProjectTask[], fields: Partial<Parameters<typeof stuckWork>[0]> = {}) =>
    stuckWork({ tasks, liveTaskIds: new Set(), exclude: new Set(), agentName: (id) => (id === "a1" ? "Builder" : undefined), now: NOW, ...fields });

  it("finds failed runs, blocked tasks, stalled reviews, stale and unassigned work, in that order", () => {
    const old = new Date(NOW.getTime() - 10 * DAY);
    const items = input([
      task("unassigned", { status: "todo", updatedAt: old }),
      task("stale", { status: "in_progress", assigneeAgentId: "a1", updatedAt: new Date(NOW.getTime() - 4 * DAY) }),
      task("review", { status: "in_review", reviewAttention: { state: "stalled", paths: [], reason: null } }),
      task("blocked", {
        status: "blocked",
        assigneeAgentId: "a1",
        updatedAt: new Date(NOW.getTime() - 5 * 60 * 60 * 1000),
        blockedBy: [
          { id: "b1", identifier: "TES-9", status: "in_progress" },
          { id: "b2", identifier: "TES-8", status: "done" },
        ] as never,
      }),
      task("failed", { status: "in_progress", interruption: { state: "failed", canRetry: true } as never }),
      task("fine", { status: "in_progress", assigneeAgentId: "a1" }),
      task("parked", { status: "backlog", updatedAt: old }),
    ]);
    expect(items.map((item) => [item.task.id, item.reason, item.action])).toEqual([
      ["failed", "interrupted", "open"],
      ["blocked", "blocked", "open"],
      ["review", "review", "open"],
      ["stale", "stale", "open"],
      ["unassigned", "unassigned", "assign"],
    ]);
    expect(items[0]!.detail).toBe("Its last run failed · it can be retried");
    expect(items[1]!.detail).toBe("Blocked by TES-9 for 5 hours · Builder is waiting");
    expect(items[3]!.detail).toBe("No activity for 4 days · assigned to Builder");
    expect(items[4]!.detail).toBe("Medium priority · no assignee for 10 days");
  });

  it("leaves out tasks that are running, already waiting on you, or only just unassigned", () => {
    const old = new Date(NOW.getTime() - 10 * DAY);
    const items = input(
      [
        task("running", { status: "in_progress", assigneeAgentId: "a1", updatedAt: old }),
        task("asked", { status: "blocked" }),
        task("fresh", { status: "todo" }),
      ],
      { liveTaskIds: new Set(["running"]), exclude: new Set(["asked"]) },
    );
    expect(items).toEqual([]);
  });

  it("says what an interruption is waiting for", () => {
    const [item] = input([task("t", { status: "todo", interruption: { state: "waiting_for_user", userAction: "budget" } as never })]);
    expect(item!.detail).toBe("Stopped by the budget");
  });
});
