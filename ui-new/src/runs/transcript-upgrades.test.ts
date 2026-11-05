import { describe, expect, it } from "vitest";
import { upgradeRunEvents, upgradeRunLog } from "./fixtures/upgrade-run";
import { parseLogSlice } from "./run-log";
import { buildTranscript } from "./parsers";
import { buildItems, latestPlan, runHealth, stepCount, transcriptSteps, visibleItems, type TranscriptItem } from "./transcript-model";

/*
 * The Nov 5 task-chat upgrades (U42) read from a runner log: the fixture has one of every new row.
 */

const START = "2026-11-05T16:20:00.000Z";

function itemsOf(upTo?: number, live = false) {
  const { chunks } = parseLogSlice(upgradeRunLog(START, upTo), "");
  return buildItems(buildTranscript(chunks, "paperclip_runner"), live);
}

const ofKind = <K extends TranscriptItem["kind"]>(items: TranscriptItem[], kind: K) => items.filter((item): item is Extract<TranscriptItem, { kind: K }> => item.kind === kind);

describe("the runner's activity rows", () => {
  const items = itemsOf();

  it("lifts an MCP startup failure out of the steps", () => {
    expect(runHealth(items)).toEqual([{ server: "github", reason: "needs re-authentication" }]);
    expect(transcriptSteps(items).map((item) => item.kind)).not.toContain("health");
  });

  it("keeps the latest native plan snapshot in one item", () => {
    const plans = ofKind(items, "plan");
    expect(plans).toHaveLength(1);
    expect(plans[0]!.plan.steps.map((step) => step.status)).toEqual(["completed", "completed", "completed", "completed", "in_progress"]);
    expect(latestPlan(items)?.explanation).toBe("Fix ISO week dates");
  });

  it("marks a Codex reasoning summary", () => {
    expect(ofKind(items, "thinking")[0]).toMatchObject({ summary: true });
  });

  it("gives web searches, model switches, waits and checks their own rows", () => {
    const rows = ofKind(items, "activity").map((item) => [item.row.label, item.row.detail]);
    expect(rows).toEqual(
      expect.arrayContaining([
        ["Searched the web", "“Temporal.PlainDate.from ISO week date”"],
        ["Opened a web page", "tc39.es/proposal-temporal/docs/plaindate.html"],
        ["Switched models", "gpt-5.6-sol → gpt-5.6-luna · capacity"],
        ["Waited 30s", ""],
        ["Check passed", "node --test server/src/export/worker.test.ts"],
        ["Check failed", "pnpm --filter @paperclipai/server typecheck"],
        ["Check not run", "pnpm test:e2e"],
      ]),
    );
    const search = ofKind(items, "activity").find((item) => item.row.label === "Searched the web")!;
    expect(search.row.links?.map((link) => link.host)).toEqual(["tc39.es", "developer.mozilla.org", "github.com", "nodejs.org"]);
    expect(ofKind(items, "activity").find((item) => item.row.label === "Check not run")!.row.note).toBe("Not needed");
  });

  it("shows hook and auto-review decisions, folding an approval onto its call", () => {
    const rows = ofKind(items, "activity").filter((item) => item.row.icon === "hook" || item.row.icon === "review");
    expect(rows.map((item) => [item.row.label, item.row.tone, item.row.note])).toEqual([
      ["PreToolUse hook blocked Bash", "blocked", "Pushing to main is not allowed from agent runs."],
      ["Auto-review denied", "blocked", "Downloading and running a script from the network isn't allowed."],
    ]);
    expect(ofKind(items, "tool").find((tool) => tool.key === "tool:exec:edit-1")).toMatchObject({ review: "Auto-approved · low risk" });
  });

  it("says what each tool ran and how it went", () => {
    const tools = ofKind(items, "tool");
    expect(tools.find((tool) => tool.key === "tool:exec:c1")).toMatchObject({ name: "Bash", step: "command", title: "node --test server/src/export/worker.test.ts", status: "error", exitCode: 1, durationMs: 2300 });
    expect(tools.find((tool) => tool.key === "tool:exec:c2")).toMatchObject({ status: "done", exitCode: 0, durationMs: 14_200 });
    expect(tools.find((tool) => tool.key === "tool:exec:c3")).toMatchObject({ title: "git push origin main", blocked: "Blocked by the preToolUse hook" });
  });

  it("shows each edit's diff, saying when it was shortened", () => {
    const tools = ofKind(items, "tool");
    const edit = tools.find((tool) => tool.key === "tool:exec:edit-1")!;
    expect(edit).toMatchObject({ step: "edit", title: "server/src/export/worker.ts", added: 3, removed: 1 });
    expect(edit.diff?.[0]).toEqual({ type: "hunk", text: "@@ -41,6 +41,9 @@ export function parseExportDate(" });
    expect(edit.diff?.filter((line) => line.type === "add")).toHaveLength(3);
    expect(tools.find((tool) => tool.key === "tool:exec:edit-2")).toMatchObject({ added: 1240, removed: 0, diffTruncated: true });
  });

  it("nests subagents dispatched together into one tree, with their own calls", () => {
    const groups = ofKind(items, "subagents");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.agents.map((agent) => [agent.role, agent.description, agent.status, agent.tools.length])).toEqual([
      ["Explore", "Find the date parsing tests", "done", 2],
      ["general-purpose", "Check other callers of parseExportDate", "done", 1],
    ]);
    expect(groups[0]!.agents[0]!.result).toContain("worker.test.ts");
    expect(ofKind(items, "tool").some((tool) => tool.key.startsWith("tool:exec:sa-"))).toBe(false);
  });

  it("shows harness status notices as chips, settled by what came after", () => {
    expect(ofKind(items, "chip").map((item) => item.chip.label)).toEqual(["Context compacted", "Recovered after retry"]);
  });

  it("shows a proposed plan once, without repeating it in a message", () => {
    const proposals = ofKind(items, "proposal");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ streaming: false });
    expect(proposals[0]!.markdown).toMatch(/^# Parse ISO week dates/);
    expect(ofKind(items, "note").some((note) => note.lines.join("").includes("proposed_plan"))).toBe(false);
  });

  it("folds activity rows with the steps, but keeps a row that stopped the agent when tool calls are hidden", () => {
    const shown = visibleItems(transcriptSteps(items), { thinking: true, tools: false, expanded: new Set() });
    const activity = shown.filter((item) => item.kind === "activity").map((item) => (item.kind === "activity" ? item.row.label : ""));
    expect(activity).toEqual(["PreToolUse hook blocked Bash", "Auto-review denied", "Check failed"]);
    expect(stepCount(items)).toBeGreaterThan(20);
  });
});

describe("while the run goes", () => {
  it("streams a proposed plan from Codex's plan deltas", () => {
    const events = upgradeRunEvents();
    const cut = events.findIndex((event) => event.eventType === "plan.proposed");
    const proposals = ofKind(itemsOf(cut, true), "proposal");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ streaming: true });
    expect(proposals[0]!.markdown).toBe("# Parse ISO week dates in the export worker\n\n## Steps\n\n1. Detect `YYYY-Www-D` in `parseExportDate`.");
  });

  it("shows a retry with no work after it as going, then stopped once the run ends", () => {
    const events = upgradeRunEvents();
    const cut = events.findIndex((event) => event.payload.noticeId === "retry-1") + 1;
    expect(ofKind(itemsOf(cut, true), "chip").at(-1)!.chip).toMatchObject({ label: "Reconnecting (attempt 1 of 5)", active: true });
    expect(ofKind(itemsOf(cut, false), "chip").at(-1)!.chip.label).toBe("Retry stopped");
  });

  it("shows a compaction still going as going, and as stopped once the run ends", () => {
    const cut = upgradeRunEvents().findIndex((event) => event.payload.noticeId === "compact-1") + 1;
    expect(ofKind(itemsOf(cut, true), "chip")[0]!.chip.label).toBe("Compacting context");
    expect(ofKind(itemsOf(cut, false), "chip")[0]!.chip.label).toBe("Compaction stopped");
  });

  it("keeps a subagent running with its progress", () => {
    const cut = upgradeRunEvents().findIndex((event) => event.eventType === "delegation.completed");
    const agent = ofKind(itemsOf(cut, true), "subagents")[0]!.agents[0]!;
    expect(agent).toMatchObject({ status: "running", progress: "Reading the worker tests" });
  });
});
