import { describe, expect, it } from "vitest";
import type { CaseDetail, CaseHandoffView, CaseSummary } from "@/api/cases";
import {
  asksForCase,
  caseFields,
  caseMembership,
  caseStats,
  currentNote,
  handoffMove,
  orderCases,
  phaseTrack,
  roundsOf,
  withStartCaseRequest,
  workflowUse,
} from "./case-model";
import { parseWorkflowDiagram } from "./workflow-diagram";

const diagram = parseWorkflowDiagram("```mermaid\nstateDiagram-v2\n[*] --> Research\nResearch --> Build\nBuild --> Backtest\nBacktest --> Build\nBacktest --> [*]\n```")!;

function kase(id: string, extra: Partial<CaseSummary> = {}): CaseSummary {
  return {
    id,
    companyId: "co1",
    projectId: null,
    caseNumber: 1,
    identifier: `TES-${id}`,
    caseType: "Strategy",
    key: null,
    title: `Case ${id}`,
    summary: null,
    status: "in_progress",
    fields: {},
    workIssueId: null,
    workflowId: null,
    workflow: null,
    phase: null,
    handoffVersion: 0,
    workIssue: null,
    pendingHandoff: null,
    parentCaseId: null,
    completedAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...extra,
  };
}

function handoff(phase: string, extra: Partial<CaseHandoffView> = {}): CaseHandoffView {
  return {
    id: `h-${phase}-${Math.random()}`,
    phase,
    state: "delivered",
    destinationKind: "agent",
    toAgentId: `agent-${phase}`,
    toAgentName: `${phase} agent`,
    assignmentAppliedAt: "2026-10-01T00:00:00Z",
    workflowTransition: null,
    ...extra,
  } as CaseHandoffView;
}

describe("phaseTrack", () => {
  it("marks phases before the current one done, with the agent who took each and its rounds", () => {
    // Newest first, as the API lists them.
    const handoffs = [handoff("Build"), handoff("Backtest"), handoff("Build"), handoff("Research")];
    const steps = phaseTrack({ diagram, phase: "Build", status: "in_progress", taskStatus: "in_progress", handoffs });
    expect(steps.map((step) => step.state)).toEqual(["done", "current", "done", "future"]);
    expect(steps[1]).toMatchObject({ name: "Build", agentName: "Build agent", rounds: 2, note: "working now" });
    expect(steps[2]!.note).toBe("");
    expect(steps[3]).toMatchObject({ name: "Done", end: true });
  });

  it("queues a hand-off the agent hasn't released yet on the phase it goes to", () => {
    const pending = handoff("Backtest", { state: "awaiting_release", assignmentAppliedAt: null });
    const steps = phaseTrack({ diagram, phase: "Build", status: "in_progress", taskStatus: "in_progress", pending });
    expect(steps.map((step) => step.state)).toEqual(["done", "done", "queued", "future"]);
    expect(steps[2]!.note).toBe("hand-off queued");
  });

  it("says an applied hand-off is waiting to start", () => {
    const pending = handoff("Build", { state: "pending_dispatch" });
    const steps = phaseTrack({ diagram, phase: "Build", status: "draft", taskStatus: "todo", pending });
    expect(steps[1]).toMatchObject({ state: "current", note: "waiting to start" });
  });

  it("draws a done case all done", () => {
    expect(phaseTrack({ diagram, phase: "done", status: "done" }).every((step) => step.state === "done")).toBe(true);
  });

  it("doesn't count a hand-off cancelled before it moved the work", () => {
    expect(roundsOf([handoff("Build"), handoff("Build", { state: "cancelled", assignmentAppliedAt: null })], "build")).toBe(1);
  });
});

describe("currentNote", () => {
  it("follows the main task's status", () => {
    expect(currentNote("in_progress", null)).toBe("working now");
    expect(currentNote("todo", null)).toBe("up next");
    expect(currentNote("blocked", null)).toBe("blocked");
    expect(currentNote(undefined, null)).toBe("");
  });
});

describe("handoffMove", () => {
  it("names the move between phases", () => {
    const transition = (from: string | null, to: string) => ({ from: { workflowId: null, name: null, phase: from }, to: { workflowId: null, name: null, phase: to }, documentRevisionId: null });
    expect(handoffMove({ phase: "Build", destinationKind: "agent", workflowTransition: transition("Research", "Build") })).toBe("Research → Build");
    expect(handoffMove({ phase: "Research", destinationKind: "agent", workflowTransition: transition(null, "Research") })).toBe("Started · Research");
    expect(handoffMove({ phase: "done", destinationKind: "done", workflowTransition: null })).toBe("Closed the case");
  });
});

describe("caseMembership", () => {
  it("gives each task its cases: main tasks from the list, links from each case", () => {
    const cases = [kase("C1", { workIssueId: "t1" }), kase("C2")];
    const link = (caseId: string, issueId: string, role: "work" | "reference") => ({ id: `${caseId}-${issueId}`, caseId, issueId, role, createdAt: "", issue: { id: issueId, identifier: null, title: "", status: "todo" } });
    const details = new Map<string, CaseDetail>([
      ["C1", { ...cases[0]!, issueLinks: [link("C1", "t1", "work"), link("C1", "t2", "reference")] } as CaseDetail],
      ["C2", { ...cases[1]!, issueLinks: [link("C2", "t2", "work")] } as CaseDetail],
    ]);
    const byTask = caseMembership(cases, details);
    expect(byTask.get("t1")!.map((entry) => [entry.case.id, entry.role])).toEqual([["C1", "main"]]);
    expect(byTask.get("t2")!.map((entry) => [entry.case.id, entry.role])).toEqual([["C1", "reference"], ["C2", "work"]]);
    expect(byTask.has("t3")).toBe(false);
  });
});

describe("orderCases", () => {
  it("puts open cases first, each parent followed by its children, closed ones last", () => {
    const order = orderCases([kase("done", { status: "done" }), kase("child", { parentCaseId: "parent" }), kase("parent"), kase("other")]);
    expect(order.map((entry) => [entry.case.id, entry.depth])).toEqual([
      ["parent", 0],
      ["child", 1],
      ["other", 0],
      ["done", 0],
    ]);
  });

  it("survives a parent loop", () => {
    expect(orderCases([kase("a", { parentCaseId: "b" }), kase("b", { parentCaseId: "a" })])).toHaveLength(2);
  });
});

describe("workflowUse", () => {
  it("counts the cases on each workflow", () => {
    expect(workflowUse([kase("1", { workflowId: "w" }), kase("2", { workflowId: "w" }), kase("3")]).get("w")).toBe(2);
  });
});

describe("caseFields and caseStats", () => {
  it("flattens one level, turns plain lists into pills and empty values into not set", () => {
    const rows = caseFields({ market: ["BTC", "ETH"], backtest: { sharpe: 1.62 }, paper: null, nested: [{ a: 1 }] });
    expect(rows).toEqual([
      { key: "market", value: { kind: "list", items: ["BTC", "ETH"] } },
      { key: "backtest.sharpe", value: { kind: "text", text: "1.62" } },
      { key: "paper", value: { kind: "unset" } },
      { key: "nested", value: { kind: "text", text: '[{"a":1}]' } },
    ]);
  });

  it("takes the first set fields as stats", () => {
    expect(caseStats({ paper: null, risk_per_trade: 0.005, backtest: { sharpe: 1.62 } })).toEqual([
      { key: "risk per trade", value: "0.005" },
      { key: "sharpe", value: "1.62" },
    ]);
  });
});

describe("Start a case", () => {
  it("adds the request to the description, naming the template", () => {
    const text = withStartCaseRequest("Find mean reversion.", { id: "w1", name: "Strategy pipeline" });
    expect(text).toBe(
      'Find mean reversion.\n\n---\n\nSet up a case for this task and make this task its main task. Use the company\'s "Strategy pipeline" workflow (workflowId w1).',
    );
    expect(asksForCase(text)).toBe(true);
    expect(withStartCaseRequest("", null)).toBe("Set up a case for this task and make this task its main task. Write the case's workflow yourself.");
    expect(asksForCase("Just a task")).toBe(false);
  });
});
