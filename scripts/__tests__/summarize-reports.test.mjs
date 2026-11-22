// Tests for scripts/ci/summarize-reports.mjs, the run summary of a CI shard's Vitest reports.
// The fixtures are real reports from this repo's CI, trimmed to a few files each:
// red (run 44956445103, shard 8: openapi-routes failed), green (run 44960577747, shard 3) and
// hook-timeout (run 44565887434, shard 5: an afterEach hook timed out).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  firstRepoFrame,
  maxFailuresPerPhase,
  messageHead,
  parseArgs,
  parseReportName,
  summarize,
} from "../ci/summarize-reports.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures", "summarize-reports");
const script = path.join(here, "..", "ci", "summarize-reports.mjs");
const root = "/home/runner/work/paperclip/paperclip";

function tempDir(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "summarize-reports-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function report(files, extra = {}) {
  const tests = files.flatMap((file) => file.assertionResults);
  return {
    numPassedTests: tests.filter((a) => a.status === "passed").length,
    numFailedTests: tests.filter((a) => a.status === "failed").length,
    numPendingTests: 0,
    numTodoTests: 0,
    startTime: 1000,
    testResults: files,
    ...extra,
  };
}

function failedTest(title, message, ancestors = ["suite"]) {
  return { ancestorTitles: ancestors, title, fullName: [...ancestors, title].join(" "), status: "failed", failureMessages: [message] };
}

test("a red shard lists each failed test with its file, full name, error and repo frame", () => {
  const markdown = summarize(path.join(fixtures, "red"), { root, outcome: "failure" });
  assert.match(markdown, /^### Tests, shard 8\/10: 1 failed test\n/);
  assert.match(markdown, /\| server \| 3 \| \*\*1\*\* \| 6 \| \*\*1\*\* \| 5 \| \d+m \d\ds \|/);
  assert.match(markdown, /\| packages \| 1 \| 0 \| 3 \| 0 \| 0 \| \d+s \|/);
  assert.ok(markdown.indexOf("| server |") < markdown.indexOf("| packages |"), "phases in run order");
  assert.match(markdown, /#### Failed in server\n\n- `server\/src\/__tests__\/openapi-routes\.test\.ts` › openapi routes › covers the mounted server routes exactly\n/);
  assert.match(markdown, /  AssertionError: expected \{ unknownRouteFiles: \[\], …\(3\) \} to deeply equal/);
  assert.match(markdown, /  at server\/src\/__tests__\/openapi-routes\.test\.ts:1336:8\n/);
  assert.doesNotMatch(markdown, /node_modules|\/home\/runner/, "no stack beyond the repo frame, and repo paths only");
  assert.doesNotMatch(markdown, /adapter-models|provider-trace-cancellation/, "passing files aren't listed");
});

test("a green shard says no failures", () => {
  const markdown = summarize(path.join(fixtures, "green"), { root, outcome: "success" });
  assert.match(markdown, /^### Tests, shard 3\/10: no failures\n/);
  assert.match(markdown, /\| server \| 2 \| 0 \| 6 \| 0 \| 0 \|/);
  assert.doesNotMatch(markdown, /Failed in|step's log/);
});

test("a failed step whose reports hold no failed test doesn't claim no failures", () => {
  const markdown = summarize(path.join(fixtures, "green"), { root, outcome: "failure" });
  assert.match(markdown, /^### Tests, shard 3\/10: no failed test, but the step failed\n/);
  assert.match(markdown, /failure happened outside one/);
  assert.match(summarize(path.join(fixtures, "green"), { root, outcome: "cancelled" }), /but the step was cancelled/);
});

test("a hook timeout shows the error's opening lines and the hook's line in the test file", () => {
  const markdown = summarize(path.join(fixtures, "hook-timeout"), { root });
  assert.match(markdown, /^### Tests, shard 5\/10: 1 failed test\n/);
  assert.match(markdown, /heartbeat worktree suppression › suppresses new assignment wakes/);
  assert.match(markdown, /  Error: Hook timed out in 30000ms\.\n  If this is a long-running hook, .*"hookTimeout"\.\n  at server\/src\/__tests__\/heartbeat-worktree-suppression\.test\.ts:75:3\n/);
});

test("no report directory, or an empty one, says the tests wrote no reports", (t) => {
  const missing = summarize(path.join(tempDir(t), "test-reports"), { root, outcome: "failure" });
  assert.match(missing, /^### Tests: no test reports\n\nNo report directory/);
  const empty = summarize(tempDir(t), { root, outcome: "failure" });
  assert.match(empty, /^### Tests: no test reports\n\nNo reports in/);
});

test("an unreadable report is named and keeps the headline from saying no failures", (t) => {
  const dir = tempDir(t);
  writeFileSync(path.join(dir, "shard-2-of-10-server.json"), '{"testResults": [');
  writeFileSync(path.join(dir, "shard-2-of-10-packages.json"), JSON.stringify(report([])));
  writeFileSync(path.join(dir, "notes.txt"), "not a report");
  const markdown = summarize(dir, { root });
  assert.match(markdown, /^### Tests, shard 2\/10: a report couldn't be read\n/);
  assert.match(markdown, /- `shard-2-of-10-server\.json` couldn't be read: /);
  assert.match(markdown, /\| packages \| 0 \|/);
  assert.doesNotMatch(markdown, /notes/);
});

test("a file that fails without a failed test is listed with the file's own error", (t) => {
  const dir = tempDir(t);
  const message = "Error: Failed to load url ./missing-module (resolved id: ./missing-module) in /home/runner/work/paperclip/paperclip/server/src/x.test.ts. Does the file exist?\n    at loadAndTransform (file:///home/runner/work/paperclip/paperclip/node_modules/vite/dist/node.js:1:1)";
  writeFileSync(path.join(dir, "shard-1-of-10-server-serial.json"), JSON.stringify(report([
    { name: `${root}/server/src/x.test.ts`, status: "failed", message, assertionResults: [] },
  ])));
  const markdown = summarize(dir, { root });
  assert.match(markdown, /^### Tests, shard 1\/10: 1 file failed outside a test\n/);
  assert.match(markdown, /#### Failed in server-serial\n\n- `server\/src\/x\.test\.ts` \(the file itself\)\n/);
  assert.match(markdown, /Failed to load url \.\/missing-module/);
  assert.doesNotMatch(markdown, /loadAndTransform/);
});

test("a phase with many failures lists the first ones and counts the rest", (t) => {
  const dir = tempDir(t);
  const total = maxFailuresPerPhase + 5;
  const tests = Array.from({ length: total }, (_, index) => failedTest(`case ${index}`, `Error: boom ${index}`));
  writeFileSync(path.join(dir, "shard-4-of-10-server.json"), JSON.stringify(report([
    { name: `${root}/server/src/many.test.ts`, status: "failed", message: "", assertionResults: tests },
  ])));
  const markdown = summarize(dir, { root });
  assert.match(markdown, new RegExp(`^### Tests, shard 4/10: ${total} failed tests\\n`));
  assert.equal(markdown.match(/^- `server/gm).length, maxFailuresPerPhase);
  assert.match(markdown, /- …and 5 more; every one is in the shard's test-reports artifact\./);
});

test("Markdown in names and backticks in errors can't break the summary", (t) => {
  const dir = tempDir(t);
  const message = "Error: expected ```fenced``` and `code`\n    at x (/elsewhere/file.js:1:1)";
  writeFileSync(path.join(dir, "server.json"), JSON.stringify(report([
    {
      name: `${root}/server/src/odd.test.ts`,
      status: "failed",
      message: "",
      assertionResults: [{ ...failedTest("a | b <img src=x> *bold* `tick`", message, ["outer [x](y)"]), failureMessages: [message, "second", "third"] }],
    },
  ])));
  const markdown = summarize(dir, { root });
  assert.match(markdown, /^### Tests: 1 failed test\n/, "an unsharded report has no shard in its title");
  assert.match(markdown, /› outer \\\[x\\\]\\\(y\\\) › a \\\| b \\<img src=x\\> \\\*bold\\\* \\`tick\\`\n/);
  assert.match(markdown, /  ````text\n  Error: expected ```fenced``` and `code`\n  ````\n/);
  assert.match(markdown, /\(and 2 more errors\)/);
  assert.doesNotMatch(markdown, /elsewhere/, "a frame outside the repo isn't shown");
});

test("messageHead keeps the error's opening lines, without colour codes or the stack", () => {
  assert.equal(messageHead("\u001b[31mAssertionError\u001b[39m: nope\n\n    at a (/x.js:1:1)\n    at b"), "AssertionError: nope");
  assert.equal(messageHead("one\ntwo\nthree\nfour", { lines: 2 }), "one\ntwo\n…");
  assert.equal(messageHead("x".repeat(50), { chars: 10 }), `${"x".repeat(10)}\n…`);
  assert.equal(messageHead(undefined), "");
});

test("firstRepoFrame skips node_modules and frames outside the root", () => {
  const message = [
    "Error: x",
    `    at f (file://${root}/node_modules/vitest/dist/run.js:1:2)`,
    "    at g (node:internal/process/task_queues:104:5)",
    "    at h (/somewhere/else.js:3:4)",
    `    at ${root}/server/src/a.test.ts:12:3`,
  ].join("\n");
  assert.equal(firstRepoFrame(message, root), "server/src/a.test.ts:12:3");
  assert.equal(firstRepoFrame(message, `${root}/`), "server/src/a.test.ts:12:3");
  assert.equal(firstRepoFrame("Error: no stack", root), null);
});

test("parseReportName reads the shard and the phase", () => {
  assert.deepEqual(parseReportName("shard-8-of-10-server-serial.json"), { shard: { index: 8, count: 10 }, phase: "server-serial" });
  assert.deepEqual(parseReportName("packages.json"), { shard: null, phase: "packages" });
  assert.equal(parseReportName("notes.txt"), null);
});

test("parseArgs takes a directory, --root and --outcome", () => {
  assert.deepEqual(parseArgs(["dir", "--root", "/r", "--outcome", "failure"]), { dir: "dir", root: "/r", outcome: "failure" });
  assert.equal(parseArgs(["dir", "--outcome", ""]).outcome, null);
  assert.throws(() => parseArgs([]), /usage/);
  assert.throws(() => parseArgs(["a", "b"]), /unexpected argument b/);
  assert.throws(() => parseArgs(["a", "--root"]), /--root needs a value/);
  assert.throws(() => parseArgs(["a", "--bogus"]), /unknown option --bogus/);
});

test("the command prints the summary, uses GITHUB_WORKSPACE as the root and exits 0", () => {
  const env = { ...process.env, GITHUB_WORKSPACE: root };
  const red = spawnSync(process.execPath, [script, path.join(fixtures, "red"), "--outcome", "failure"], { encoding: "utf8", env });
  assert.equal(red.status, 0, red.stderr);
  assert.equal(red.stdout, summarize(path.join(fixtures, "red"), { root, outcome: "failure" }));
  const usage = spawnSync(process.execPath, [script], { encoding: "utf8", env });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage/);
});

test("the fixtures stay small", () => {
  for (const name of ["red/shard-8-of-10-server.json", "red/shard-8-of-10-packages.json", "green/shard-3-of-10-server.json",
    "green/shard-3-of-10-packages.json", "hook-timeout/shard-5-of-10-server.json"]) {
    assert.ok(readFileSync(path.join(fixtures, name)).length < 20_000, name);
  }
});
