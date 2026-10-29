import { describe, expect, it } from "vitest";
import { diagramLoops, diagramSource, findPhase, parseWorkflowDiagram, workflowSummary } from "./workflow-diagram";

const WORKFLOW = `Take a trading idea from research to a reviewed backtest, with a person signing off.

\`\`\`mermaid
stateDiagram-v2
  direction LR
  %% the strategy pipeline
  [*] --> Research
  Research --> Build: spec ready
  Build --> Backtest: candidate ready
  Backtest --> Build: fix needed
  Backtest --> Approval
  state "Paper trade" as Paper
  Approval --> Paper: approved
  note right of Approval
    Waits on a person.
  end note
  Paper --> [*]
\`\`\`

## Transitions

- **Research → Build:** when the spec is saved.
`;

describe("parseWorkflowDiagram", () => {
  it("reads the phases in the order the work reaches them, with display names", () => {
    const diagram = parseWorkflowDiagram(WORKFLOW)!;
    expect(diagram.phases.map((phase) => phase.name)).toEqual(["Research", "Build", "Backtest", "Approval", "Paper trade"]);
    expect(diagram.phases[4]).toEqual({ id: "Paper", name: "Paper trade" });
    expect(diagram.ends).toBe(true);
    expect(diagram.edges).toContainEqual({ from: "Research", to: "Build", label: "spec ready" });
  });

  it("is null without a state diagram", () => {
    expect(parseWorkflowDiagram("Source, ingest, validate.")).toBeNull();
    expect(parseWorkflowDiagram("```mermaid\nflowchart LR\n  A --> B\n```")).toBeNull();
    expect(parseWorkflowDiagram(null)).toBeNull();
  });

  it("passes through pseudo-states without making them phases", () => {
    const diagram = parseWorkflowDiagram("```mermaid\nstateDiagram-v2\n  state check <<choice>>\n  [*] --> Verify\n  Verify --> check\n  check --> Fix: failed\n  check --> Ship: passed\n  Fix --> Verify\n```")!;
    expect(diagram.phases.map((phase) => phase.id)).toEqual(["Verify", "Fix", "Ship"]);
    expect(diagram.ends).toBe(false);
  });

  it("keeps states the start doesn't reach, in the order they appear", () => {
    const diagram = parseWorkflowDiagram("```mermaid\nstateDiagram\n  A --> B\n  C : on its own\n```")!;
    expect(diagram.phases.map((phase) => phase.id)).toEqual(["A", "B", "C"]);
  });

  it("finds the first state diagram among several Mermaid blocks", () => {
    expect(diagramSource("```mermaid\nflowchart LR\nA-->B\n```\n\n~~~mermaid\nstateDiagram-v2\n[*] --> A\n~~~\n")).toContain("[*] --> A");
  });
});

describe("findPhase", () => {
  it("matches a free-text phase by state ID or name, ignoring case and spacing", () => {
    const diagram = parseWorkflowDiagram(WORKFLOW)!;
    expect(findPhase(diagram, "build")).toBe(1);
    expect(findPhase(diagram, "paper_trade")).toBe(4);
    expect(findPhase(diagram, "Paper")).toBe(4);
    expect(findPhase(diagram, "Deploy")).toBe(-1);
    expect(findPhase(diagram, null)).toBe(-1);
  });
});

describe("diagramLoops", () => {
  it("lists transitions back to an earlier phase", () => {
    const loops = diagramLoops(parseWorkflowDiagram(WORKFLOW)!);
    expect(loops).toHaveLength(1);
    expect(loops[0]!.from.name).toBe("Backtest");
    expect(loops[0]!.to.name).toBe("Build");
    expect(loops[0]!.label).toBe("fix needed");
  });
});

describe("workflowSummary", () => {
  it("is the first paragraph of prose", () => {
    expect(workflowSummary(WORKFLOW)).toBe("Take a trading idea from research to a reviewed backtest, with a person signing off.");
  });

  it("skips a title heading and shortens long text", () => {
    expect(workflowSummary("# Bug fix\n\nReproduce, fix and **verify** a bug.")).toBe("Reproduce, fix and verify a bug.");
    expect(workflowSummary(`${"word ".repeat(80)}`, 40)).toHaveLength(40);
  });
});
