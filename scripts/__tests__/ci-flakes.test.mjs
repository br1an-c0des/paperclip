import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyRuns, cleanLog, collectRows, failedJobs, formatReport, formatTable, jobLabel, parseArgs,
  parseFailLine, parseFailures, shortenTest,
} from "../ci-flakes.mjs";

// Trimmed from real job logs of this repo's Test workflow (ANSI colours and timestamps kept):
// vitest-assertion.log from run 44797032206 attempt 1 (bug 68; stdout's summary lines interleave
// the failure), vitest-hook-timeout.log from run 44565891427 (bug 62), typecheck.log from run
// 44794034412's typecheck job.
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "ci-flakes");
const fixture = (name) => readFileSync(path.join(fixtures, name), "utf8");

test("parseArgs: defaults, values and errors", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  assert.deepEqual(parseArgs([], now), { since: "2026-11-07", repo: "br1an-c0des/paperclip", workflow: "Test" });
  assert.deepEqual(parseArgs(["--since", "2026-11-19", "--repo=a/b", "--workflow", "Other"], now),
    { since: "2026-11-19", repo: "a/b", workflow: "Other" });
  assert.throws(() => parseArgs(["--since", "19-11-2026"], now), /YYYY-MM-DD/);
  assert.throws(() => parseArgs(["--repo", "nope"], now), /owner\/name/);
  assert.throws(() => parseArgs(["--since"], now), /needs a value/);
  assert.throws(() => parseArgs(["--bogus"], now), /Unknown argument/);
});

test("cleanLog strips the BOM, timestamps and ANSI colours", () => {
  const lines = cleanLog("﻿2026-11-20T18:59:55.7756669Z \x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m x\r\nplain\n");
  assert.deepEqual(lines, [" FAIL  x", "plain", ""]);
});

test("parseFailLine reads the project, file and test chain", () => {
  assert.deepEqual(parseFailLine(" FAIL   @paperclipai/server (shared)  src/a.test.ts > suite > does a thing"),
    { project: "server (shared)", test: "src/a.test.ts > suite > does a thing" });
  assert.deepEqual(parseFailLine(" FAIL  src/b.test.ts [ src/b.test.ts ]"), { project: null, test: "src/b.test.ts" });
  assert.deepEqual(parseFailLine(" FAIL  @paperclipai/ui-new  src/c.spec.tsx > renders"),
    { project: "ui-new", test: "src/c.spec.tsx > renders" });
  assert.equal(parseFailLine(" ✓ src/a.test.ts (3 tests)"), null);
  assert.equal(parseFailLine("this FAILs nothing"), null);
});

test("parseFailures: an assertion failure with interleaved summary lines", () => {
  assert.deepEqual(parseFailures(fixture("vitest-assertion.log")), [{
    test: "server (shared): src/services/fresh-continuation-fallback.test.ts > fresh-continuation fallback > does not mistake a recycled PID for the old writer",
    assertion: "AssertionError: expected { Object (kind, reason, ...) } to match object { kind: 'continued' }",
  }]);
});

test("parseFailures: a hook timeout", () => {
  assert.deepEqual(parseFailures(fixture("vitest-hook-timeout.log")), [{
    test: "server (shared): src/__tests__/heartbeat-worktree-suppression.test.ts > heartbeat worktree suppression > suppresses new assignment wakes in worktree instances without creating heartbeat runs",
    assertion: "Error: Hook timed out in 30000ms.",
  }]);
});

test("parseFailures: several FAILs, a file-level one, duplicates dropped", () => {
  const log = [
    " FAIL  @paperclipai/server (isolated)  src/a.test.ts > one",
    "AssertionError: expected 8 to be less than or equal to 6",
    " FAIL  @paperclipai/server (isolated)  src/a.test.ts > one",
    "AssertionError: expected 8 to be less than or equal to 6",
    " FAIL  @paperclipai/server (shared)  src/b.test.ts [ src/b.test.ts ]",
    "",
    "Error: Cannot find module './gone.js'",
  ].join("\n");
  assert.deepEqual(parseFailures(log), [
    { test: "server (isolated): src/a.test.ts > one", assertion: "AssertionError: expected 8 to be less than or equal to 6" },
    { test: "server (shared): src/b.test.ts", assertion: "Error: Cannot find module './gone.js'" },
  ]);
});

test("parseFailures: an interleaved line before the assertion is passed over", () => {
  assert.deepEqual(parseFailures(" FAIL  src/a.test.ts > one\nJSON report written to /tmp/pt-x/server.json\nAssertionError: expected 1 to be 2\n"),
    [{ test: "src/a.test.ts > one", assertion: "AssertionError: expected 1 to be 2" }]);
});

test("parseFailures: a FAIL with no error line takes the next non-blank line", () => {
  assert.deepEqual(parseFailures(" FAIL  src/a.test.ts > one\n\n  something odd\n"),
    [{ test: "src/a.test.ts > one", assertion: "something odd" }]);
});

test("parseFailures: tsc errors from pnpm -r typecheck", () => {
  const [failure, ...rest] = parseFailures(fixture("typecheck.log"));
  assert.equal(rest.length, 0);
  assert.equal(failure.test, "packages/plugins/plugin-llm-wiki: tests/plugin.spec.ts(520,3)");
  assert.match(failure.assertion, /^error TS2739: Type '\{ id: string;/);
});

test("parseFailures: no test failure falls back to GitHub's first error line", () => {
  const log = "2026-11-20T18:00:00.0000000Z Running\n2026-11-20T18:00:01.0000000Z ##[error]The operation was canceled.\n";
  assert.deepEqual(parseFailures(log), [{ test: "(no failed test in the log)", assertion: "The operation was canceled." }]);
  assert.deepEqual(parseFailures(""), [{ test: "(no failed test in the log)", assertion: "" }]);
});

test("jobLabel shortens shard jobs only", () => {
  assert.equal(jobLabel("Thorough tier, shard 5/10"), "shard 5/10");
  assert.equal(jobLabel("Opt-in tier, shard 12/12"), "shard 12/12");
  assert.equal(jobLabel("Typecheck, ui-new and runner tests"), "Typecheck, ui-new and runner tests");
});

const run = (id, fields) => ({ id, name: "Test", status: "completed", conclusion: "success", run_attempt: 1,
  head_branch: "main", created_at: `2026-11-2${id % 10}T00:00:00Z`, ...fields });

test("classifyRuns: re-runs and red runs of the workflow, oldest first", () => {
  const runs = [
    run(3, { run_attempt: 2 }),
    run(1, { run_attempt: 3, conclusion: "failure" }),
    run(2, { conclusion: "failure" }),
    run(4, { conclusion: "cancelled" }),
    run(5, { status: "in_progress", conclusion: null, run_attempt: 2 }),
    run(6, { name: "Opt-in tier (weekly)", conclusion: "failure" }),
    run(7, { conclusion: "timed_out" }),
  ];
  const { reruns, red } = classifyRuns(runs);
  assert.deepEqual(reruns.map((item) => item.id), [1, 3]);
  assert.deepEqual(red.map((item) => item.id), [1, 2, 7]);
});

test("failedJobs keeps failed and timed-out jobs", () => {
  const jobs = [{ conclusion: "success" }, { conclusion: "failure" }, { conclusion: "skipped" }, { conclusion: "timed_out" }];
  assert.equal(failedJobs(jobs).length, 2);
});

test("formatTable escapes pipes and backticks and squashes whitespace", () => {
  const table = formatTable([{ date: "2026-11-20", branch: "a|b", runId: 1, attempt: 1, job: "shard 1/2",
    test: "src/a.test.ts > `x`", assertion: "expected\n  1 | 2" }]);
  assert.equal(table.split("\n")[2], "| 2026-11-20 | a\\|b | 1 | 1 | shard 1/2 | src/a.test.ts > 'x' | expected 1 \\| 2 |");
});

test("shortenTest drops the middle suites of a long name", () => {
  const long = `src/a.test.ts > ${"suite ".repeat(30).trim()} > the test`;
  assert.equal(shortenTest(long), "src/a.test.ts > … > the test");
  assert.equal(shortenTest("src/a.test.ts > short"), "src/a.test.ts > short");
});

test("collectRows walks runs, attempts, jobs and logs through the api", () => {
  const calls = [];
  const runs = [
    run(1, { run_attempt: 2, head_branch: "feat/x", created_at: "2026-11-20T18:53:37Z" }),
    run(2, { conclusion: "failure", created_at: "2026-11-21T10:00:00Z" }),
    run(3, { run_attempt: 2, created_at: "2026-11-21T11:00:00Z" }),
  ];
  const jobs = {
    "1/1": [{ id: 11, name: "Thorough tier, shard 5/10", conclusion: "failure" }, { id: 12, name: "Typecheck", conclusion: "success" }],
    "2/1": [{ id: 21, name: "Typecheck, ui-new and runner tests", conclusion: "failure" }],
    "3/1": [{ id: 31, name: "Thorough tier, shard 1/10", conclusion: "cancelled" }],
  };
  const logs = { 11: fixture("vitest-hook-timeout.log"), 21: fixture("typecheck.log") };
  const api = {
    json(apiPath) {
      calls.push(apiPath);
      if (apiPath.includes("/actions/runs?")) return { workflow_runs: runs };
      const match = /runs\/(\d+)\/attempts\/(\d+)\/jobs/.exec(apiPath);
      return { jobs: jobs[`${match[1]}/${match[2]}`] };
    },
    text(apiPath) {
      calls.push(apiPath);
      return logs[/jobs\/(\d+)\/logs/.exec(apiPath)[1]];
    },
  };
  const options = { since: "2026-11-19", repo: "o/r", workflow: "Test" };
  const result = collectRows(api, options);
  assert.equal(calls[0], "repos/o/r/actions/runs?created=%3E%3D2026-11-19&per_page=100&page=1");
  assert.equal(result.rerunCount, 2);
  assert.equal(result.redCount, 1);
  assert.deepEqual(result.rerunRows.map((row) => [row.date, row.branch, row.runId, row.attempt, row.job, row.test.split(" > ")[0]]), [
    ["2026-11-20", "feat/x", 1, 1, "shard 5/10", "server (shared): src/__tests__/heartbeat-worktree-suppression.test.ts"],
    ["2026-11-21", "main", 3, 1, "(no failed job)", ""],
  ]);
  assert.deepEqual(result.redRows.map((row) => [row.runId, row.attempt, row.job, row.test]), [
    [2, 1, "Typecheck, ui-new and runner tests", "packages/plugins/plugin-llm-wiki: tests/plugin.spec.ts(520,3)"],
  ]);
  const report = formatReport(options, result);
  assert.match(report, /^# CI flakes: o\/r, workflow Test, runs since 2026-11-19$/m);
  assert.match(report, /^## Re-run runs: 2$/m);
  assert.match(report, /^## Red on their latest attempt: 1$/m);
});

test("collectRows pages through the run list and survives a missing log", () => {
  const page = (n, count) => Array.from({ length: count }, (_, i) => run(n * 1000 + i, {}));
  const pages = { 1: page(1, 100), 2: [...page(2, 4), run(9, { conclusion: "failure" })] };
  const api = {
    json(apiPath) {
      const match = /[?&]page=(\d+)/.exec(apiPath);
      if (match && apiPath.includes("/actions/runs?")) return { workflow_runs: pages[match[1]] };
      return { jobs: [{ id: 91, name: "Thorough tier, shard 2/10", conclusion: "failure" }] };
    },
    text() {
      throw new Error("HTTP 410: logs expired\nmore");
    },
  };
  const result = collectRows(api, { since: "2026-11-19", repo: "o/r", workflow: "Test" });
  assert.equal(result.redCount, 1);
  assert.deepEqual(result.redRows[0].test, "(log unavailable)");
  assert.equal(result.redRows[0].assertion, "HTTP 410: logs expired");
});
