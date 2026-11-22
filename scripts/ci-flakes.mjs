#!/usr/bin/env node
// Lists the flakes a re-run hides, and the runs that are still red.
//
//   node scripts/ci-flakes.mjs [--since YYYY-MM-DD] [--repo owner/name] [--workflow name]
//
// A re-run that passes overwrites the run's result, so `gh run list` shows the run as green and
// the flake leaves no trace. This reads every run of the `Test` workflow created since --since
// (default: 14 days ago) and prints two Markdown tables:
//
// - Re-run runs (`run_attempt > 1`): each earlier attempt's failed jobs, and the failed tests in
//   their logs (Vitest's ` FAIL ` lines and the first assertion after each; tsc errors for a
//   typecheck job).
// - Runs red on their latest attempt, the same way.
//
// Needs `gh`, logged in (it reads public data, so any login will do). The parsing is in pure
// functions, tested in scripts/__tests__/ci-flakes.test.mjs; only `ghJson` and `ghText` call gh.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const defaultRepo = "br1an-c0des/paperclip";
export const defaultWorkflow = "Test";
export const defaultSinceDays = 14;
const redConclusions = new Set(["failure", "timed_out", "startup_failure"]);
const maxCell = 160;

// ---------- Arguments ----------

export function parseArgs(argv, now = new Date()) {
  const since = new Date(now.getTime() - defaultSinceDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const options = { since, repo: defaultRepo, workflow: defaultWorkflow };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [name, inline] = arg.startsWith("--") && arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, null];
    const take = () => {
      if (inline !== null) return inline;
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value.`);
      i += 1;
      return value;
    };
    if (name === "--since") options.since = take();
    else if (name === "--repo") options.repo = take();
    else if (name === "--workflow") options.workflow = take();
    else if (name === "--help" || name === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.since)) throw new Error(`--since wants YYYY-MM-DD, not "${options.since}".`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo)) throw new Error(`--repo wants owner/name, not "${options.repo}".`);
  return options;
}

// ---------- Log parsing ----------

const ansiPattern = /\x1b\[[0-9;?]*[A-Za-z]/g;
// GitHub prefixes every log line with an ISO timestamp and a space.
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;

/** Removes ANSI colours, GitHub's per-line timestamps and the byte-order mark; returns lines. */
export function cleanLog(text) {
  return text.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n").split("\n")
    .map((line) => line.replace(ansiPattern, "").replace(timestampPattern, "").replace(/^\ufeff/, ""));
}

const failPattern = /^\s*FAIL\s+(.*)$/;
const testFilePattern = /(?:^|\s)(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\b(.*)$/;
// A line that says what went wrong: an error class, an assertion, a timeout.
const assertionPattern = /\b(?:\w*Error|expected|assert\w*|timed out|Timeout)\b/i;
const separatorPattern = /^[\s⎯─-]*$|^\s*(?:Test Files|Tests|Start at|Duration)\s/;

/**
 * Parses one Vitest FAIL line (colours already stripped) into project and test, for example
 * `FAIL   @paperclipai/server (shared)  src/x.test.ts > suite > name`
 * → { project: "server (shared)", test: "src/x.test.ts > suite > name" }.
 * A file-level failure (`FAIL  src/x.test.ts [ src/x.test.ts ]`) gives just the file.
 */
export function parseFailLine(line) {
  const match = failPattern.exec(line);
  if (!match) return null;
  const body = match[1];
  const file = testFilePattern.exec(body);
  if (!file) return { project: null, test: body.trim() };
  const project = body.slice(0, file.index).trim().replace(/^@paperclipai\//, "") || null;
  const rest = file[2].replace(/\s*\[\s*\S+\s*\]\s*$/, "").trimEnd();
  return { project, test: `${file[1]}${rest}` };
}

/** The first line within a few after `start` that reads as an assertion, else the first non-blank one. */
function assertionAfter(lines, start) {
  const window = [];
  for (let i = start + 1; i < Math.min(lines.length, start + 16); i += 1) {
    const line = lines[i].trim();
    if (failPattern.test(lines[i])) break;
    if (line === "" || separatorPattern.test(lines[i])) continue;
    window.push(line);
  }
  return window.find((line) => assertionPattern.test(line)) ?? window[0] ?? "";
}

/**
 * The failures one job's log shows: Vitest's FAIL lines with the assertion after each, else tsc
 * errors, else GitHub's first `##[error]` line. Each is { test, assertion }; duplicates dropped.
 */
export function parseFailures(text) {
  const lines = cleanLog(text);
  const found = [];
  const add = (test, assertion) => {
    if (!found.some((item) => item.test === test && item.assertion === assertion)) found.push({ test, assertion });
  };
  lines.forEach((line, index) => {
    const fail = parseFailLine(line);
    if (!fail) return;
    add(fail.project ? `${fail.project}: ${fail.test}` : fail.test, assertionAfter(lines, index));
  });
  if (found.length > 0) return found;

  // pnpm -r prefixes each line with the package: "packages/x typecheck: src/a.ts(1,2): error TS2322: …".
  const tscPattern = /^(?:##\[error\])?(?:(\S+) typecheck: )?(\S+\(\d+,\d+\)): (error TS\d+: .*)$/;
  for (const line of lines) {
    const match = tscPattern.exec(line.trim());
    if (match) add(match[1] ? `${match[1]}: ${match[2]}` : match[2], match[3]);
  }
  if (found.length > 0) return found;

  const error = lines.map((line) => line.trim()).find((line) => line.startsWith("##[error]"));
  return [{ test: "(no failed test in the log)", assertion: error ? error.slice("##[error]".length) : "" }];
}

/** "Thorough tier, shard 5/10" → "shard 5/10"; any other job name as it is. */
export function jobLabel(name) {
  const shard = /\bshard (\d+\/\d+)/.exec(name);
  return shard ? `shard ${shard[1]}` : name;
}

// ---------- Runs ----------

/** Splits the workflow's runs into re-run runs and runs red on their latest attempt, oldest first. */
export function classifyRuns(runs, workflow = defaultWorkflow) {
  const own = runs.filter((run) => run.name === workflow && run.status === "completed")
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  return {
    reruns: own.filter((run) => run.run_attempt > 1),
    red: own.filter((run) => redConclusions.has(run.conclusion)),
  };
}

/** The jobs that failed in one attempt's job list. */
export function failedJobs(jobs) {
  return jobs.filter((job) => redConclusions.has(job.conclusion));
}

// ---------- Output ----------

function cell(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const short = text.length > maxCell ? `${text.slice(0, maxCell - 1)}…` : text;
  return short.replace(/\|/g, "\\|").replace(/`/g, "'");
}

/** A long "file > suite > … > test" keeps its file and test name and drops the suites between. */
export function shortenTest(test) {
  if (test.length <= maxCell) return test;
  const parts = test.split(" > ");
  return parts.length > 2 ? `${parts[0]} > … > ${parts.at(-1)}` : test;
}

/** A Markdown table of rows { date, branch, runId, attempt, job, test, assertion }. */
export function formatTable(rows) {
  const header = ["Date", "Branch", "Run", "Attempt", "Shard/job", "Test", "Assertion"];
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const row of rows) {
    lines.push(`| ${[row.date, row.branch, row.runId, row.attempt, row.job, shortenTest(row.test ?? ""), row.assertion].map(cell).join(" | ")} |`);
  }
  return lines.join("\n");
}

/** The whole report, given { since, repo, workflow } and the two lists of rows. */
export function formatReport({ since, repo, workflow }, { rerunRows, redRows, rerunCount, redCount }) {
  const parts = [
    `# CI flakes: ${repo}, workflow ${workflow}, runs since ${since}`,
    "",
    `## Re-run runs: ${rerunCount}`,
    "",
    "Each earlier attempt's failed jobs and tests. The run list shows these runs by their last attempt.",
    "",
    rerunRows.length > 0 ? formatTable(rerunRows) : "None.",
    "",
    `## Red on their latest attempt: ${redCount}`,
    "",
    redRows.length > 0 ? formatTable(redRows) : "None.",
    "",
  ];
  return parts.join("\n");
}

/**
 * Builds the report's rows through `api`, which has `json(path)` and `text(path)` (the gh layer in
 * the CLI, a fake in tests). Re-run runs get a row per failed test of every attempt before the
 * latest; red runs, of the latest attempt.
 */
export function collectRows(api, { since, repo, workflow }) {
  const runs = [];
  for (let page = 1; ; page += 1) {
    const result = api.json(`repos/${repo}/actions/runs?created=${encodeURIComponent(`>=${since}`)}&per_page=100&page=${page}`);
    runs.push(...result.workflow_runs);
    if (result.workflow_runs.length < 100) break;
  }
  const { reruns, red } = classifyRuns(runs, workflow);

  const rowsFor = (run, attempt) => {
    const jobs = api.json(`repos/${repo}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`).jobs;
    const base = { date: run.created_at.slice(0, 10), branch: run.head_branch, runId: run.id, attempt };
    const failed = failedJobs(jobs);
    if (failed.length === 0) return [{ ...base, job: "(no failed job)", test: "", assertion: "" }];
    return failed.flatMap((job) => {
      let failures;
      try {
        failures = parseFailures(api.text(`repos/${repo}/actions/jobs/${job.id}/logs`));
      } catch (error) {
        failures = [{ test: "(log unavailable)", assertion: String(error.message ?? error).split("\n")[0] }];
      }
      return failures.map((failure) => ({ ...base, job: jobLabel(job.name), ...failure }));
    });
  };

  const rerunRows = reruns.flatMap((run) => Array.from({ length: run.run_attempt - 1 }, (_, i) => rowsFor(run, i + 1)).flat());
  const redRows = red.flatMap((run) => rowsFor(run, run.run_attempt));
  return { rerunRows, redRows, rerunCount: reruns.length, redCount: red.length };
}

// ---------- The gh layer ----------

function gh(apiPath) {
  return execFileSync("gh", ["api", apiPath], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

export const ghApi = {
  json: (apiPath) => JSON.parse(gh(apiPath)),
  text: (apiPath) => gh(apiPath),
};

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`[ci-flakes] ${error.message}`);
    return 2;
  }
  if (options.help) {
    console.log("node scripts/ci-flakes.mjs [--since YYYY-MM-DD] [--repo owner/name] [--workflow name]");
    return 0;
  }
  try {
    process.stdout.write(formatReport(options, collectRows(ghApi, options)));
    return 0;
  } catch (error) {
    console.error(`[ci-flakes] ${String(error.stderr || error.message).trim()}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
