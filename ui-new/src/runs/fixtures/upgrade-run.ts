/*
 * A runner log with every row the Nov 5 task-chat upgrades added (U42), for the tests and for
 * checking the run modal and the chat's live reply in a browser (the log is served in place of a
 * real run's with route interception). The payloads follow the runner's protocol schemas
 * (packages/paperclip-runner/protocol/schemas/provider-event.schema.json) and the old UI's stories.
 * Only type imports, so Node can run it directly to write the log out.
 */

export type FixtureEvent = { eventType: string; payload: Record<string, unknown>; itemId?: string };

const tool = (executionId: string, phase: "started" | "progressed" | "completed", fields: Record<string, unknown>): FixtureEvent => ({
  eventType: `tool.execution.${phase}`,
  payload: {
    schema: "paperclip.tool.execution.v1",
    executionId,
    transport: "builtin",
    operation: "unknown",
    status: phase === "completed" ? "completed" : "running",
    output: null,
    outputBytes: 0,
    outputTruncated: false,
    outputDigest: null,
    ...fields,
  },
});

const message = (itemId: string, text: string, channel: "progress" | "final" = "progress"): FixtureEvent => ({
  eventType: "item.completed",
  itemId,
  payload: { kind: "agentMessage", channel, text },
});

const notice = (noticeId: string, category: string, summary: string, details: { name: string; value: string }[] = [], extra: Record<string, unknown> = {}): FixtureEvent => ({
  eventType: "provider.notice.recorded",
  itemId: noticeId,
  payload: { schema: "paperclip.provider.notice.v1", noticeId, severity: "warning", category, scope: "turn", recoverable: true, userActionable: false, summary, details, ...extra },
});

const PATCH = `--- a/server/src/export/worker.ts
+++ b/server/src/export/worker.ts
@@ -41,6 +41,9 @@ export function parseExportDate(
   const trimmed = value.trim();
-  return Temporal.PlainDate.from(trimmed);
+  const week = /^(\\d{4})-W(\\d{2})-(\\d)$/.exec(trimmed);
+  if (week) return fromIsoWeek(Number(week[1]), Number(week[2]), Number(week[3]));
+  return Temporal.PlainDate.from(trimmed);
 }`;

const plan = (revision: number, statuses: string[]): FixtureEvent => ({
  eventType: "plan.updated",
  payload: {
    schema: "paperclip.plan.updated.v1",
    planId: "turn-1",
    revision,
    explanation: "Fix ISO week dates",
    steps: ["Check how Temporal parses week dates", "Parse week dates in parseExportDate", "Add tests", "Run the worker tests", "Report back"].map((body, index) => ({
      stepId: `s${index + 1}`,
      body,
      status: statuses[index] ?? "pending",
    })),
    complete: statuses.every((status) => status === "completed") && statuses.length === 5,
    syncStatus: "not_applicable",
    documentRevision: null,
  },
});

const PROPOSAL = `# Parse ISO week dates in the export worker

## Steps

1. Detect \`YYYY-Www-D\` in \`parseExportDate\`.
2. Convert it with \`fromIsoWeek\`.
3. Add worker tests for week dates.`;

/** The run's events in order. `upTo` cuts it short, for a run that's still going. */
export function upgradeRunEvents(upTo?: number): FixtureEvent[] {
  const events: FixtureEvent[] = [
    notice("mcp-startup:github", "mcp_server_startup_failed", "github MCP server failed to start: needs re-authentication", [
      { name: "server", value: "github" },
      { name: "reason", value: "needs re-authentication" },
    ], { scope: "session", userActionable: true }),
    plan(1, ["in_progress"]),
    { eventType: "item.delta", itemId: "r1", payload: { kind: "reasoning", channel: "summary", text: "**Checking the parser**\n\nI'll look at how `parseExportDate` hands strings to Temporal.\n\n**Looking up Temporal's week dates**" } },
    { eventType: "item.completed", itemId: "r1", payload: { kind: "reasoning", channel: "summary" } },
    message("m1", "I'll check how `Temporal.PlainDate.from` treats ISO week dates before touching the parser."),
    { eventType: "research.started", itemId: "ws-1", payload: { schema: "paperclip.research.v1", researchId: "ws-1", action: "search", status: "running", query: "Temporal.PlainDate.from ISO week date", url: null, pattern: null, sources: [] } },
    {
      eventType: "research.completed",
      itemId: "ws-1",
      payload: {
        schema: "paperclip.research.v1",
        researchId: "ws-1",
        action: "search",
        status: "completed",
        query: "Temporal.PlainDate.from ISO week date",
        url: null,
        pattern: null,
        sources: [
          { sourceId: "a", title: "Temporal.PlainDate — TC39 proposal docs", url: "https://tc39.es/proposal-temporal/docs/plaindate.html", snippet: null },
          { sourceId: "b", title: "Temporal.PlainDate.from() - MDN", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDate/from", snippet: null },
          { sourceId: "c", title: "Support ISO week-date strings · Issue #2312", url: "https://github.com/tc39/proposal-temporal/issues/2312", snippet: null },
          { sourceId: "d", title: "Node.js 24 release notes", url: "https://nodejs.org/en/blog/release/v24.0.0", snippet: null },
        ],
      },
    },
    { eventType: "research.completed", itemId: "ws-2", payload: { schema: "paperclip.research.v1", researchId: "ws-2", action: "open_page", status: "completed", query: null, url: "https://tc39.es/proposal-temporal/docs/plaindate.html", pattern: null, sources: [] } },
    { eventType: "model.route.changed", payload: { schema: "paperclip.model.route_changed.v1", routeId: "turn-1", provider: "openai", requestedModel: "gpt-5.6-sol", fromModel: "gpt-5.6-sol", effectiveModel: "gpt-5.6-luna", reason: "capacity" } },
    notice("compact-1", "context_compaction", "Compacting context", [{ name: "Phase", value: "running" }]),
    notice("compact-1", "context_compaction", "Context compacted", [{ name: "Phase", value: "completed" }]),
    plan(2, ["completed", "in_progress"]),
    // Subagents dispatched together, each with the calls it made.
    { eventType: "delegation.started", itemId: "sa-1", payload: { schema: "paperclip.delegation.v1", delegationId: "sa-1", action: "spawn", status: "running", children: [{ childId: "sa-1", role: "Explore", model: "claude-haiku-5-5", status: "running", summary: "Find the date parsing tests", activitySummary: "Reading the worker tests", prompt: "List the tests that cover parseExportDate and how they build dates." }] } },
    { eventType: "delegation.started", itemId: "sa-2", payload: { schema: "paperclip.delegation.v1", delegationId: "sa-2", action: "spawn", status: "running", children: [{ childId: "sa-2", role: "general-purpose", model: null, status: "running", summary: "Check other callers of parseExportDate", activitySummary: null, prompt: "Find every caller of parseExportDate." }] } },
    tool("sa-1-t1", "completed", { operation: "read", name: "Read", target: "server/src/export/worker.test.ts", parentItemId: "sa-1", durationMs: 40 }),
    tool("sa-1-t2", "completed", { operation: "search", name: "Grep", subject: "parseExportDate", parentItemId: "sa-1", durationMs: 120 }),
    tool("sa-2-t1", "completed", { operation: "search", name: "Grep", subject: "parseExportDate(", parentItemId: "sa-2", durationMs: 90 }),
    { eventType: "delegation.completed", itemId: "sa-1", payload: { schema: "paperclip.delegation.v1", delegationId: "sa-1", action: "spawn", status: "completed", children: [{ childId: "sa-1", role: "Explore", model: "claude-haiku-5-5", status: "completed", summary: "Find the date parsing tests", activitySummary: null, result: "One suite, `worker.test.ts`; it covers calendar dates only." }] } },
    { eventType: "delegation.completed", itemId: "sa-2", payload: { schema: "paperclip.delegation.v1", delegationId: "sa-2", action: "spawn", status: "completed", children: [{ childId: "sa-2", role: "general-purpose", model: null, status: "completed", summary: "Check other callers of parseExportDate", activitySummary: null, result: "Only the export worker calls it." }] } },
    message("m2", "Week dates aren't supported upstream, so I'll parse them in `parseExportDate`."),
    // An auto-review approves the edit (it folds onto the edit row); a hook blocks a push.
    { eventType: "safety.review.completed", payload: { schema: "paperclip.safety.review.v1", reviewId: "rev-1", targetExecutionId: "edit-1", status: "completed", decision: "allowed", summary: null, actionKind: "applyPatch", action: "apply_patch server/src/export/worker.ts", riskLevel: "low", userConsent: null, rationale: null, decidedBy: "auto-reviewer" } },
    tool("edit-1", "started", { operation: "edit", name: "Edit", target: "server/src/export/worker.ts" }),
    tool("edit-1", "completed", {
      operation: "edit",
      name: "Edit",
      target: "server/src/export/worker.ts",
      durationMs: 300,
      fileChanges: [{ path: "server/src/export/worker.ts", operation: "modify", previousPath: null, additions: 3, deletions: 1, diff: PATCH, diffTruncated: false }],
    }),
    tool("edit-2", "completed", {
      operation: "edit",
      name: "Write",
      target: "server/src/export/worker.test.ts",
      durationMs: 210,
      fileChanges: [{ path: "server/src/export/worker.test.ts", operation: "create", previousPath: null, additions: 1240, deletions: 0, diff: "@@ -0,0 +1,1240 @@\n+import { describe, it } from \"vitest\";\n+describe(\"parseExportDate\", () => {", diffTruncated: true }],
    }),
    plan(3, ["completed", "completed", "completed", "in_progress"]),
    tool("c1", "started", { transport: "process", operation: "execute", name: "node --test server/src/export/worker.test.ts", subject: "node --test server/src/export/worker.test.ts" }),
    tool("c1", "completed", { transport: "process", operation: "execute", status: "failed", name: "node --test server/src/export/worker.test.ts", subject: "node --test server/src/export/worker.test.ts", output: "✔ parses calendar dates\n✖ parses ISO week dates\n\n5 passed, 1 failed", exitCode: 1, durationMs: 2300 }),
    notice("retry-1", "provider_retry", "stream disconnected before completion", [{ name: "Attempt", value: "1" }, { name: "Max attempts", value: "5" }, { name: "Reason", value: "responseStreamDisconnected" }]),
    { eventType: "wait.started", itemId: "sleep-1", payload: { schema: "paperclip.wait.v1", waitId: "sleep-1", reason: "timer", status: "running", plannedDurationMs: 30_000, elapsedDurationMs: null } },
    { eventType: "wait.completed", itemId: "sleep-1", payload: { schema: "paperclip.wait.v1", waitId: "sleep-1", reason: "timer", status: "completed", plannedDurationMs: 30_000, elapsedDurationMs: 30_000 } },
    tool("c2", "completed", { transport: "process", operation: "execute", name: "node --test server/src/export/worker.test.ts", subject: "node --test server/src/export/worker.test.ts", output: "6 passed", exitCode: 0, durationMs: 14_200 }),
    { eventType: "hook.completed", payload: { schema: "paperclip.hook.v1", hookId: "hook-1", event: "preToolUse", scope: "tool", status: "blocked", blocking: true, durationMs: 80, summary: null, outcome: "blocked", message: "Pushing to main is not allowed from agent runs.", source: ".codex/hooks.json", toolName: "Bash" } },
    tool("c3", "completed", { transport: "process", operation: "execute", status: "failed", name: "git push origin main", subject: "git push origin main", blockedReason: "Blocked by the preToolUse hook" }),
    { eventType: "safety.review.completed", payload: { schema: "paperclip.safety.review.v1", reviewId: "rev-2", targetExecutionId: null, status: "completed", decision: "denied", summary: null, actionKind: "networkAccess", action: "curl https://example.com/install.sh", riskLevel: "high", userConsent: null, rationale: "Downloading and running a script from the network isn't allowed.", decidedBy: "auto-reviewer" } },
    { eventType: "item.completed", itemId: "v1", payload: { kind: "verification", text: "passed", verification: { commandOrCheck: "node --test server/src/export/worker.test.ts", status: "passed", detail: "6 tests passed" } } },
    { eventType: "item.completed", itemId: "v2", payload: { kind: "verification", text: "failed", verification: { commandOrCheck: "pnpm --filter @paperclipai/server typecheck", status: "failed", detail: "2 errors in src/export/worker.ts" } } },
    { eventType: "item.completed", itemId: "v3", payload: { kind: "verification", text: "not_run", verification: { commandOrCheck: "pnpm test:e2e", status: "not_run", reasonCode: "not_needed" } } },
    // Codex plan mode: the plan streams as plan-item deltas, then plan.proposed completes it.
    { eventType: "item.delta", itemId: "plan-item-1", payload: { kind: "plan", text: "<proposed_plan>\n# Parse ISO week dates in the export worker\n\n## Steps\n\n1. Detect " } },
    { eventType: "item.delta", itemId: "plan-item-1", payload: { kind: "plan", text: "`YYYY-Www-D` in `parseExportDate`." } },
    { eventType: "plan.proposed", itemId: "plan-item-1", payload: { schema: "paperclip.plan.proposed.v1", proposalId: "plan-item-1", status: "completed", markdown: PROPOSAL, source: "codex_plan_item" } },
    plan(4, ["completed", "completed", "completed", "completed", "in_progress"]),
    message("final", "Week-date strings like `2026-W45-4` now parse to the matching calendar day. The worker tests pass; typecheck still reports two errors that predate this change.", "final"),
  ];
  return upTo === undefined ? events : events.slice(0, upTo);
}

/** The events as a stored run log: one `{ ts, stream, chunk }` record per line, a second apart. */
export function upgradeRunLog(startedAt: string, upTo?: number): string {
  const start = new Date(startedAt).getTime();
  return upgradeRunEvents(upTo)
    .map((event, index) => {
      const ts = new Date(start + (index + 1) * 1000).toISOString();
      const envelope = { type: "paperclip.prp.event", event: { schema: "paperclip.prp.event.v1", sourceSeq: index + 1, eventType: event.eventType, ...(event.itemId ? { itemId: event.itemId } : {}), payload: event.payload } };
      return JSON.stringify({ ts, stream: "stdout", chunk: `${JSON.stringify(envelope)}\n`, seq: index + 1 });
    })
    .join("\n")
    .concat("\n");
}
