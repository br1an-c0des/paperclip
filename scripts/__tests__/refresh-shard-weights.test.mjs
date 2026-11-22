import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  averageSeconds,
  fileSecondsFromReport,
  readReportsDir,
  renderWeights,
  repoRelativePath,
  secondsFromReports,
} from "../refresh-shard-weights.mjs";
import { parseShardWeights } from "../test.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "refresh-shard-weights.mjs");
const ciRoot = "/home/runner/work/paperclip/paperclip";

// A Vitest JSON report as CI's shards write them: startTime/endTime per file span its tests.
function report(files) {
  return {
    numTotalTestSuites: files.length,
    startTime: 1_000,
    success: true,
    testResults: files.map(({ name, start = 1_000, seconds, tests = [] }) => ({
      name,
      startTime: start,
      endTime: start + seconds * 1000,
      status: "passed",
      message: "",
      assertionResults: tests.map((duration, index) => ({ title: `t${index}`, status: "passed", duration })),
    })),
  };
}

test("repoRelativePath strips CI's workspace or a given root, and leaves other paths out", () => {
  assert.equal(repoRelativePath(`${ciRoot}/server/src/a.test.ts`), "server/src/a.test.ts");
  assert.equal(repoRelativePath("/home/me/paperclip/packages/db/src/d.test.ts", ["/home/me/paperclip"]), "packages/db/src/d.test.ts");
  assert.equal(repoRelativePath("/elsewhere/x.test.ts", ["/home/me/paperclip"]), null);
});

test("fileSecondsFromReport: the file's span, not the sum of its tests' durations", () => {
  // Hooks and gaps between tests make the span longer than the tests' sum: the span is what the file costs.
  const seconds = fileSecondsFromReport(report([{ name: `${ciRoot}/server/src/a.test.ts`, seconds: 12.34, tests: [1000, 2000] }]));
  assert.deepEqual(seconds, [[`${ciRoot}/server/src/a.test.ts`, 12.34]]);
  // Without start and end times, the tests' durations.
  const bare = { testResults: [{ name: "x.test.ts", assertionResults: [{ duration: 1500 }, { duration: 500 }, {}] }] };
  assert.deepEqual(fileSecondsFromReport(bare), [["x.test.ts", 2]]);
});

test("fileSecondsFromReport adds the gap before each file on its worker, rebuilt from the times", () => {
  // Two workers: a [0, 10] then d [12, 20]; b [0, 5] then c [6, 9]. c waited 1 s after b, d 2 s after
  // a (d follows the worker that freed up last before it started: a's, at 10, not b's chain, free at 9).
  // e [20, 20] follows d with no gap. A worker's first file (a, b) gets the median gap, 1 s of 0, 1
  // and 2; a file with no time at all still costs 0.1 s.
  const seconds = fileSecondsFromReport(report([
    { name: "d", start: 12_000, seconds: 8 },
    { name: "a", start: 0, seconds: 10 },
    { name: "c", start: 6_000, seconds: 3 },
    { name: "b", start: 0, seconds: 5 },
    { name: "e", start: 20_000, seconds: 0 },
  ]));
  assert.deepEqual(Object.fromEntries(seconds), { d: 10, a: 11, c: 4, b: 6, e: 0.1 });
});

test("secondsFromReports: repo-relative files from every phase report of a run", () => {
  const seconds = secondsFromReports([
    report([{ name: `${ciRoot}/server/src/a.test.ts`, seconds: 30 }, { name: `${ciRoot}/server/src/b.test.ts`, seconds: 0.04 }]),
    report([{ name: `${ciRoot}/packages/db/src/d.test.ts`, seconds: 4 }]),
  ]);
  // b's 0.04 s counts as the 0.1 s floor.
  assert.deepEqual(Object.fromEntries(seconds), { "server/src/a.test.ts": 30, "server/src/b.test.ts": 0.1, "packages/db/src/d.test.ts": 4 });
});

test("averageSeconds: per file, the mean of the runs that have it", () => {
  const mean = averageSeconds([new Map([["a", 10], ["b", 4]]), new Map([["a", 20]])]);
  assert.deepEqual(Object.fromEntries(mean), { a: 15, b: 4 });
});

test("renderWeights: sorted keys, one decimal, and test.mjs reads it back", () => {
  const source = [{ run: 7, commit: "abc", branch: "main", date: "2026-11-21T23:11:42Z" }];
  const text = renderWeights(source, new Map([["server/z.test.ts", 3], ["packages/a.test.ts", 12.345], ["cli/m.test.ts", 0.04]]));
  assert.ok(text.endsWith("\n"));
  const keys = [...text.matchAll(/^ {4}"([^"]+)": /gm)].map((match) => match[1]);
  assert.deepEqual(keys, ["cli/m.test.ts", "packages/a.test.ts", "server/z.test.ts"]);
  assert.match(text, /"packages\/a\.test\.ts": 12\.3,/);
  assert.match(text, /"server\/z\.test\.ts": 3\.0\n/);
  assert.match(text, /"cli\/m\.test\.ts": 0\.0,/);
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.source, source);
  assert.deepEqual(Object.fromEntries(parseShardWeights(text)), { "cli/m.test.ts": 0, "packages/a.test.ts": 12.3, "server/z.test.ts": 3 });
});

test("readReportsDir finds the reports in nested artifact folders and skips other JSON", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "refresh-weights-"));
  mkdirSync(path.join(dir, "test-reports-shard-1-of-2"));
  writeFileSync(path.join(dir, "test-reports-shard-1-of-2", "shard-1-of-2-server.json"), JSON.stringify(report([{ name: "a", seconds: 1 }])));
  writeFileSync(path.join(dir, "other.json"), JSON.stringify({ hello: "world" }));
  const reports = readReportsDir(dir);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].testResults[0].name, "a");
});

test("--from writes the weights file from downloaded reports", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "refresh-weights-"));
  const reports = path.join(dir, "reports");
  for (const shard of [1, 2]) {
    mkdirSync(path.join(reports, `test-reports-shard-${shard}-of-2`), { recursive: true });
    writeFileSync(path.join(reports, `test-reports-shard-${shard}-of-2`, `shard-${shard}-of-2-server.json`),
      JSON.stringify(report([{ name: `${ciRoot}/server/src/s${shard}.test.ts`, seconds: shard * 10 }])));
  }
  const out = path.join(dir, "test-weights.json");
  const result = spawnSync(process.execPath, [script, "--from", reports, "--out", out], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const written = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(written.seconds, { "server/src/s1.test.ts": 10, "server/src/s2.test.ts": 20 });
  assert.deepEqual(written.source, [{ reports }]);
  assert.match(result.stdout, /2 test files/);
});
