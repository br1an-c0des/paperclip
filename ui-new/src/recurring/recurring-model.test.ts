import type { RoutineListItem, RoutineRevisionSnapshot, RoutineRunSummary } from "@paperclipai/shared";
import { describe, expect, it } from "vitest";
import {
  builtInsUsed,
  filterRuns,
  groupRoutines,
  isOccurrence,
  matchesSearch,
  nextLabel,
  occurrencesByRoutine,
  placeholderSegments,
  revisionChanges,
  runOutcome,
  templatePlaceholders,
  triggerKinds,
  whenLabel,
} from "./recurring-model";
import { routineSection } from "./RoutineRedirect";
import { triggerState, webhookCheck, webhookSetupSteps } from "./webhook";

function routine(overrides: Partial<RoutineListItem> = {}): RoutineListItem {
  return {
    id: "r1",
    companyId: "c1",
    projectId: null,
    folderId: null,
    goalId: null,
    parentIssueId: null,
    title: "Funding snapshot",
    description: null,
    assigneeAgentId: null,
    priority: "medium",
    status: "active",
    concurrencyPolicy: "coalesce_if_active",
    catchUpPolicy: "skip_missed",
    activityGatePolicy: "always",
    activityGateScope: "company",
    variables: [],
    latestRevisionId: null,
    latestRevisionNumber: 1,
    createdByAgentId: null,
    createdByUserId: null,
    responsibleUserId: null,
    updatedByAgentId: null,
    updatedByUserId: null,
    lastTriggeredAt: null,
    lastEnqueuedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    triggers: [],
    lastRun: null,
    activeIssue: null,
    ...overrides,
  };
}

const schedule = (cron: string, extra: Partial<RoutineListItem["triggers"][number]> = {}) => ({
  id: `t-${cron}`,
  kind: "schedule",
  label: null,
  enabled: true,
  cronExpression: cron,
  timezone: "UTC",
  nextRunAt: null,
  lastFiredAt: null,
  lastResult: null,
  ...extra,
});

describe("occurrences", () => {
  it("groups the tasks a routine made under it, newest first", () => {
    const tasks = [
      { id: "a", originKind: "routine_execution", originId: "r1", createdAt: new Date("2026-10-20") },
      { id: "b", originKind: "manual", originId: null, createdAt: new Date("2026-10-21") },
      { id: "c", originKind: "routine_execution", originId: "r1", createdAt: new Date("2026-10-23") },
      { id: "d", originKind: "routine_execution", originId: "r2", createdAt: new Date("2026-10-22") },
    ] as const;
    const byRoutine = occurrencesByRoutine(tasks.map((task) => ({ ...task })));
    expect(byRoutine.get("r1")?.map((task) => task.id)).toEqual(["c", "a"]);
    expect(byRoutine.get("r2")?.map((task) => task.id)).toEqual(["d"]);
    expect(byRoutine.size).toBe(2);
    expect(isOccurrence({ originKind: "routine_execution", originId: null })).toBe(false);
  });
});

describe("groupRoutines", () => {
  const names = {
    folders: [
      { id: "f2", name: "Reports", position: 2 },
      { id: "f1", name: "Market data", position: 1 },
    ],
    project: (id: string) => ({ p1: "Trading" })[id],
    agent: (id: string) => ({ a1: "Quant Researcher" })[id],
  };
  const list = [
    routine({ id: "1", title: "Weekly PnL", folderId: "f2", projectId: "p1", assigneeAgentId: "a1" }),
    routine({ id: "2", title: "funding", folderId: "f1" }),
    routine({ id: "3", title: "Audit", folderId: null, assigneeAgentId: "a1" }),
    routine({ id: "4", title: "Backfill", folderId: "f1" }),
  ];

  it("keeps folder order, empty folders and Unfiled last", () => {
    const groups = groupRoutines(list, "folder", { ...names, folders: [...names.folders, { id: "f3", name: "Empty", position: 3 }] });
    expect(groups.map((group) => group.label)).toEqual(["Market data", "Reports", "Empty", "Unfiled"]);
    expect(groups[0]!.routines.map((each) => each.title)).toEqual(["Backfill", "funding"]);
    expect(groups[2]!.routines).toEqual([]);
    expect(groups[3]!.folderId).toBeNull();
  });

  it("groups by project and assignee, with the empty group last", () => {
    expect(groupRoutines(list, "project", names).map((group) => `${group.label}:${group.routines.length}`)).toEqual(["Trading:1", "No project:3"]);
    expect(groupRoutines(list, "assignee", names).map((group) => group.label)).toEqual(["Quant Researcher", "Unassigned"]);
    expect(groupRoutines(list, "none", names)[0]!.routines).toHaveLength(4);
  });

  it("searches titles and descriptions", () => {
    expect(matchesSearch({ title: "Funding", description: "Pull rates from {{exchanges}}" }, "rates")).toBe(true);
    expect(matchesSearch({ title: "Funding", description: null }, "pnl")).toBe(false);
  });
});

describe("when and next", () => {
  it("names the schedule, or how else it starts", () => {
    expect(whenLabel([schedule("0 9 * * 1-5")])).toBe("Weekdays at 09:00");
    expect(whenLabel([schedule("0 9 * * 1-5"), schedule("0 17 * * *")])).toBe("Weekdays at 09:00 +1 more");
    expect(whenLabel([{ ...schedule(""), kind: "webhook", cronExpression: null }])).toBe("When a webhook arrives");
    expect(whenLabel([{ ...schedule(""), kind: "api", cronExpression: null }])).toBe("When the API calls it");
    expect(whenLabel([])).toBe("Only when run by hand");
    expect(triggerKinds([{ kind: "api" }, { kind: "schedule" }, { kind: "schedule" }])).toEqual(["schedule", "api"]);
  });

  it("gives the earliest next run, or why there's none", () => {
    const triggers = [
      schedule("0 9 * * *", { nextRunAt: new Date("2026-10-27T09:00:00Z") }),
      schedule("0 8 * * *", { nextRunAt: new Date("2026-10-26T08:00:00Z") }),
    ];
    expect(nextLabel({ status: "active" }, triggers, "UTC")).toBe("Next Mon Oct 26, 08:00");
    expect(nextLabel({ status: "paused" }, triggers, "UTC")).toBe("Paused");
    expect(nextLabel({ status: "archived" }, triggers, "UTC")).toBe("Archived");
    expect(nextLabel({ status: "active" }, [{ ...schedule(""), kind: "webhook", setupPending: false }], "UTC")).toBe("On each webhook");
    expect(nextLabel({ status: "active" }, [], "UTC")).toBe("No schedule");
  });
});

describe("runOutcome", () => {
  const issue = { id: "i1", identifier: "TES-9", title: "Snapshot", status: "in_progress", priority: "medium", updatedAt: new Date() };
  const run = (overrides: Partial<RoutineRunSummary>) => ({ status: "issue_created", failureReason: null, linkedIssue: null, ...overrides }) as RoutineRunSummary;

  it("names the task's status, or why there's no task", () => {
    expect(runOutcome(run({ linkedIssue: issue }))).toMatchObject({ label: "In progress", live: true, madeTask: true, task: { identifier: "TES-9" } });
    expect(runOutcome(run({ status: "coalesced", linkedIssue: { ...issue, status: "todo" } })).label).toBe("Added to TES-9, which was still open");
    expect(runOutcome(run({ status: "skipped", failureReason: "no_external_activity" })).label).toBe("Skipped, nothing changed");
    expect(runOutcome(run({ status: "skipped", failureReason: "some_new_reason" })).label).toBe("Skipped: Some new reason");
    expect(runOutcome(run({ status: "failed", failureReason: "the secret isn't set" }))).toMatchObject({ label: "Failed: the secret isn't set", tone: "red" });
  });

  it("filters runs that made a task", () => {
    const runs = [run({ linkedIssue: issue }), run({ status: "skipped" }), run({ status: "failed" })];
    expect(filterRuns(runs, "all")).toHaveLength(3);
    expect(filterRuns(runs, "task")).toHaveLength(1);
    expect(filterRuns(runs, "none")).toHaveLength(2);
  });
});

describe("text", () => {
  it("cuts placeholders out as chips", () => {
    expect(placeholderSegments("Pull {{exchanges}} for {{ date }}.")).toEqual([
      { text: "Pull ", placeholder: false },
      { text: "{{exchanges}}", placeholder: true },
      { text: " for ", placeholder: false },
      { text: "{{ date }}", placeholder: true },
      { text: ".", placeholder: false },
    ]);
    expect(templatePlaceholders("For {{date}} in {{region}}", "Use {{region}} and {{alert\\_bps}}")).toEqual(["region", "alert_bps"]);
    expect(builtInsUsed("Snapshot for {{date}}", null)).toEqual(["date"]);
    expect(builtInsUsed("Snapshot", "at {{timestamp}}")).toEqual(["timestamp"]);
  });
});

describe("revisionChanges", () => {
  const snapshot = (routineOverrides: Partial<RoutineRevisionSnapshot["routine"]> = {}, triggers: RoutineRevisionSnapshot["triggers"] = []): RoutineRevisionSnapshot => ({
    version: 1,
    routine: {
      id: "r1",
      companyId: "c1",
      projectId: null,
      goalId: null,
      parentIssueId: null,
      title: "Snapshot",
      description: null,
      assigneeAgentId: "a1",
      priority: "medium",
      status: "active",
      concurrencyPolicy: "skip_if_active",
      catchUpPolicy: "skip_missed",
      activityGatePolicy: "always",
      activityGateScope: "company",
      variables: [],
      env: null,
      responsibleUserId: null,
      ...routineOverrides,
    },
    triggers,
  });
  const trigger = (overrides: Partial<RoutineRevisionSnapshot["triggers"][number]> = {}) => ({
    id: "t1",
    kind: "schedule" as const,
    label: null,
    enabled: true,
    cronExpression: "0 9 * * *",
    timezone: "UTC",
    publicId: null,
    signingMode: null,
    replayWindowSec: null,
    ...overrides,
  });
  const names = { agent: (id: string) => ({ a1: "the CEO", a2: "Quant Researcher" })[id], project: () => undefined };

  it("says what changed in the boards' words", () => {
    const before = snapshot({}, [trigger()]);
    const after = snapshot(
      {
        assigneeAgentId: "a2",
        concurrencyPolicy: "coalesce_if_active",
        variables: [{ name: "alert_bps", label: null, type: "number", defaultValue: 30, required: false, options: [] }],
        env: { DERIBIT_API_KEY: { type: "secret_ref", secretId: "s1" } },
      },
      [trigger({ cronExpression: "0 9 * * 1-5" }), trigger({ id: "t2", kind: "webhook", cronExpression: null, signingMode: "hmac_sha256" })],
    );
    expect(revisionChanges(before, after, names)).toEqual([
      "Assigned to Quant Researcher, was the CEO",
      "If the last one is still open: Add it to the open one, was Skip it",
      "Added the input alert_bps, default 30",
      "Added the secret DERIBIT_API_KEY",
      "Schedule: Weekdays at 09:00, was Every day at 09:00",
      "Added a webhook",
    ]);
  });

  it("starts with Created, and notices removals and switches", () => {
    expect(revisionChanges(null, snapshot(), names)).toEqual(["Created"]);
    const before = snapshot({ description: "old" }, [trigger(), trigger({ id: "t2", kind: "api", cronExpression: null })]);
    const after = snapshot({ description: "new", status: "paused" }, [trigger({ enabled: false })]);
    expect(revisionChanges(before, after, names)).toEqual(["Rewrote the description", "Paused", "Turned off the schedule Every day at 09:00", "Removed an API trigger"]);
  });
});

describe("webhooks", () => {
  it("reads the connection check, ignoring deliveries from before", () => {
    expect(webhookCheck(undefined)).toBe("waiting");
    const trigger = { lastWebhookDelivery: { status: "rejected" as const, receivedAt: "2026-10-27T10:00:00Z", test: true } };
    expect(webhookCheck(trigger)).toBe("rejected");
    expect(webhookCheck(trigger, "2026-10-27T10:05:00Z")).toBe("waiting");
    expect(webhookCheck(trigger, "2026-10-27T09:00:00Z")).toBe("rejected");
  });

  it("describes a trigger's state", () => {
    expect(triggerState({ kind: "webhook", enabled: true, setupPending: true, lastWebhookDelivery: null })).toMatch(/Setup unfinished/);
    expect(triggerState({ kind: "schedule", enabled: false })).toBe("Off");
    expect(triggerState({ kind: "webhook", enabled: true, lastWebhookDelivery: { status: "received", receivedAt: "", test: false } })).toBe("Receiving events");
  });

  it("writes setup steps for the sender", () => {
    const github = webhookSetupSteps({ sender: "github", title: "Sync", url: "https://x/fire", secret: "s3cret", setupPending: true });
    expect(github).toContain("Secret: s3cret");
    expect(github).toContain("X-Hub-Signature-256");
    expect(github).toContain("only test the connection");
    const app = webhookSetupSteps({ sender: "app", title: "Sync", url: "https://x/fire", secret: "s3cret", setupPending: false });
    expect(app).toContain("Authorization: Bearer s3cret");
    expect(app).toContain("This webhook is on");
  });
});

describe("routineSection", () => {
  it("maps the old detail sections to the panel's", () => {
    expect(routineSection("runs")).toBe("runs");
    expect(routineSection("activity")).toBe("runs");
    expect(routineSection("history")).toBe("history");
    expect(routineSection("triggers")).toBeUndefined();
    expect(routineSection(null)).toBeUndefined();
  });
});
