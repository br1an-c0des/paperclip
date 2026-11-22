#!/usr/bin/env node
// Refreshes scripts/test-weights.json, the seconds per test file that `scripts/test.mjs --shard`
// balances CI's shards by, from the Vitest JSON reports CI's shards upload
// (test-reports-shard-<i>-of-<n>, kept 14 days):
//
//   node scripts/refresh-shard-weights.mjs                 # the latest green Test run on main
//   node scripts/refresh-shard-weights.mjs --run <id> [--run <id> …]   # these runs, averaged per file
//   node scripts/refresh-shard-weights.mjs --from <dir>    # reports already downloaded (gh run download)
//
// Options: --repo <owner/name> (default br1an-c0des/paperclip), --branch <name> (default main),
// --out <file> (default scripts/test-weights.json), --root <prefix> (a checkout path to strip from
// report paths besides CI's workspace and this checkout).
//
// A file's seconds are how long it held a CI worker (2 workers on 4 cores, so what the shards really
// cost): its span in the report (first test's start to last test's end) plus the gap before it on
// its worker, where its fork, import and beforeAll hooks ran, which the JSON report doesn't time
// (fileSecondsFromReport). The gaps matter: in run 44960577747 they were 0.25 s at the median but up
// to 35 s, and without them hundreds of files would weigh nothing. With several runs, each file gets
// the mean of the runs that have it. Every file in the reports is written, sorted, at one decimal;
// files the runs didn't have fall back to classification.csv in scripts/test.mjs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
export const defaultOut = path.join(scriptsDir, "test-weights.json");
export const defaultRepo = "br1an-c0des/paperclip";
const workflowFile = "test.yml";
const artifactPattern = "test-reports-shard-*";
// GitHub's checkout: /home/runner/work/<repository>/<repository>/.
const ciWorkspace = /^\/home\/runner\/work\/[^/]+\/[^/]+\//;

/** A report's test file path relative to the checkout it ran in, or null when it's under none of them. */
export function repoRelativePath(name, roots = [repoRoot]) {
  if (ciWorkspace.test(name)) return name.replace(ciWorkspace, "");
  for (const root of roots) {
    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return null;
}

// The least a file is taken to cost: a file at 0 would never add to a shard's load, so every such
// file would land on the same shard.
export const minimumSeconds = 0.1;

/**
 * `[file, seconds]` for every test file in one Vitest JSON report (one phase of one shard), paths as
 * the report has them. A file's seconds are what it held a worker for: the gap since the previous
 * file on its worker ended (the fork and import, its beforeAll hooks, the previous file's afterAll),
 * then its span (its first test's start to its last test's end, which is all the report times).
 *
 * The report doesn't say which worker ran a file, so the chains are rebuilt from the times: the
 * worker count is the most spans that overlap, and each file, in start order, follows the worker
 * that freed up last before it started. A worker's first file has no gap of its own (what comes
 * before it is the phase's start-up), so it gets the median gap of the report. Without times, a
 * file's seconds are the sum of its tests' durations.
 */
export function fileSecondsFromReport(report) {
  const results = report.testResults ?? [];
  const timed = results.filter((result) => Number.isFinite(result.startTime) && Number.isFinite(result.endTime));
  const gaps = workerGaps(timed);
  const known = [...gaps.values()].filter((gap) => gap !== null).sort((a, b) => a - b);
  const medianGap = known.length === 0 ? 0 : known[Math.floor(known.length / 2)];
  return results.map((result) => {
    if (!gaps.has(result)) {
      const tests = (result.assertionResults ?? []).reduce((sum, test) => sum + (Number.isFinite(test.duration) ? test.duration : 0), 0);
      return [result.name, Math.max(minimumSeconds, tests / 1000)];
    }
    const span = Math.max(0, result.endTime - result.startTime);
    return [result.name, Math.max(minimumSeconds, (span + (gaps.get(result) ?? medianGap)) / 1000)];
  });
}

// Map of each timed result to the milliseconds its worker sat between the previous file and it
// (null for a worker's first file).
function workerGaps(results) {
  const events = results.flatMap((result) => [[result.startTime, 1], [result.endTime, -1]])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let running = 0;
  let workers = 0;
  for (const [, change] of events) {
    running += change;
    workers = Math.max(workers, running);
  }
  const freeAt = [];
  const gaps = new Map();
  for (const result of [...results].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime)) {
    let worker = -1;
    for (let index = 0; index < freeAt.length; index += 1) {
      if (freeAt[index] <= result.startTime && (worker < 0 || freeAt[index] > freeAt[worker])) worker = index;
    }
    if (worker < 0 && freeAt.length < workers) {
      freeAt.push(result.endTime);
      gaps.set(result, null);
      continue;
    }
    gaps.set(result, worker < 0 ? 0 : result.startTime - freeAt[worker]);
    freeAt[worker < 0 ? 0 : worker] = result.endTime;
  }
  return gaps;
}

/**
 * Repo-relative seconds per file across one run's reports (one per shard and phase). A file in more
 * than one report counts the time of each. Paths under no known checkout are left out, with a warning.
 */
export function secondsFromReports(reports, roots = [repoRoot], warn = () => {}) {
  const seconds = new Map();
  for (const report of reports) {
    for (const [name, value] of fileSecondsFromReport(report)) {
      const file = repoRelativePath(name, roots);
      if (file === null) {
        warn(`left out, not under a known checkout: ${name}`);
        continue;
      }
      seconds.set(file, (seconds.get(file) ?? 0) + value);
    }
  }
  return seconds;
}

/** Per file, the mean of the runs (Maps of file to seconds) that have it. */
export function averageSeconds(runs) {
  const totals = new Map();
  for (const run of runs) {
    for (const [file, value] of run) {
      const entry = totals.get(file) ?? { sum: 0, count: 0 };
      entry.sum += value;
      entry.count += 1;
      totals.set(file, entry);
    }
  }
  return new Map([...totals].map(([file, { sum, count }]) => [file, sum / count]));
}

/** test-weights.json's text: `{ source, seconds }`, files sorted, seconds at one decimal. */
export function renderWeights(source, seconds) {
  const files = [...seconds.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lines = files.map((file, index) => `    ${JSON.stringify(file)}: ${(Math.round(seconds.get(file) * 10) / 10).toFixed(1)}`
    + (index < files.length - 1 ? "," : ""));
  const sourceText = JSON.stringify(source, null, 2).split("\n").map((line, index) => (index === 0 ? line : `  ${line}`)).join("\n");
  return `{\n  "source": ${sourceText},\n  "seconds": {\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}  }\n}\n`;
}

function jsonFilesUnder(dir) {
  return readdirSync(dir).sort().flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return jsonFilesUnder(file);
    return name.endsWith(".json") ? [file] : [];
  });
}

/** Every Vitest JSON report (an object with a testResults array) under a directory, nested or not. */
export function readReportsDir(dir) {
  return jsonFilesUnder(dir).flatMap((file) => {
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      return data && Array.isArray(data.testResults) ? [data] : [];
    } catch {
      return [];
    }
  });
}

/** Shards whose reports are missing, from the test-reports-shard-<i>-of-<n> folder names under dir. */
function missingShards(dir) {
  const found = new Set();
  let count = 0;
  for (const file of jsonFilesUnder(dir)) {
    const match = /test-reports-shard-(\d+)-of-(\d+)/.exec(file) ?? /shard-(\d+)-of-(\d+)-/.exec(path.basename(file));
    if (!match) continue;
    found.add(Number(match[1]));
    count = Math.max(count, Number(match[2]));
  }
  return Array.from({ length: count }, (_, index) => index + 1).filter((shard) => !found.has(shard));
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`gh ${args.join(" ")}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`gh ${args.join(" ")} failed (${result.status}): ${result.stderr.trim()}`);
  return result.stdout;
}

function latestGreenRun(repo, branch) {
  const runs = JSON.parse(gh(["run", "list", "-R", repo, "--workflow", workflowFile, "--branch", branch, "--status", "success",
    "--limit", "1", "--json", "databaseId"]));
  if (runs.length === 0) throw new Error(`no green ${workflowFile} run on ${branch} in ${repo}`);
  return String(runs[0].databaseId);
}

function runSource(repo, run) {
  const info = JSON.parse(gh(["run", "view", run, "-R", repo, "--json", "databaseId,headSha,headBranch,createdAt,conclusion"]));
  if (info.conclusion !== "success") console.warn(`[weights] warning: run ${run} concluded ${info.conclusion}, not success`);
  return { run: info.databaseId, commit: info.headSha, branch: info.headBranch, date: info.createdAt };
}

function parseArgs(argv) {
  const options = { runs: [], from: [], repo: defaultRepo, branch: "main", out: defaultOut, roots: [repoRoot] };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const take = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${name} needs a value`);
      return value;
    };
    if (name === "--run") options.runs.push(take());
    else if (name === "--from") options.from.push(path.resolve(take()));
    else if (name === "--repo") options.repo = take();
    else if (name === "--branch") options.branch = take();
    else if (name === "--out") options.out = path.resolve(take());
    else if (name === "--root") options.roots.push(path.resolve(take()));
    else if (name === "--help" || name === "-h") options.help = true;
    else throw new Error(`unknown argument: ${name}`);
  }
  return options;
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 13).map((line) => line.replace(/^\/\/ ?/, "")).join("\n"));
    return 0;
  }
  const warn = (message) => console.warn(`[weights] warning: ${message}`);
  if (options.runs.length === 0 && options.from.length === 0) options.runs.push(latestGreenRun(options.repo, options.branch));

  const source = [];
  const runs = [];
  const readRun = (dir, label) => {
    const missing = missingShards(dir);
    if (missing.length > 0) warn(`${label}: no reports for shard ${missing.join(", ")}; their files keep the fallback weights`);
    const reports = readReportsDir(dir);
    if (reports.length === 0) throw new Error(`${label}: no Vitest JSON reports under ${dir}`);
    runs.push(secondsFromReports(reports, options.roots, warn));
  };
  for (const run of options.runs) {
    source.push(runSource(options.repo, run));
    const dir = mkdtempSync(path.join(os.tmpdir(), `shard-weights-${run}-`));
    try {
      console.log(`[weights] downloading run ${run}'s ${artifactPattern} artifacts`);
      gh(["run", "download", run, "-R", options.repo, "--pattern", artifactPattern, "-D", dir]);
      readRun(dir, `run ${run}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  for (const dir of options.from) {
    source.push({ reports: dir });
    readRun(dir, dir);
  }

  const seconds = averageSeconds(runs);
  writeFileSync(options.out, renderWeights(source, seconds));
  const total = [...seconds.values()].reduce((sum, value) => sum + value, 0);
  const from = source.map((entry) => (entry.run ? `run ${entry.run} (${entry.commit.slice(0, 10)}, ${entry.date})` : entry.reports)).join(", ");
  const shown = path.relative(process.cwd(), options.out);
  console.log(`[weights] wrote ${shown && !shown.startsWith("..") ? shown : options.out}: ${seconds.size} test files, `
    + `${(total / 60).toFixed(1)} worker-minutes, from ${from}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`[weights] ${error.message}`);
    process.exitCode = 1;
  }
}
