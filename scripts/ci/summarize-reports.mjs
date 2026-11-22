#!/usr/bin/env node
// Summarizes a shard's Vitest JSON reports as Markdown, for the run summary on GitHub
// ($GITHUB_STEP_SUMMARY) in .github/workflows/test.yml:
//
//   node scripts/ci/summarize-reports.mjs <report-dir> [--root <dir>] [--outcome <outcome>]
//
// - <report-dir> holds what `scripts/test.mjs --report-dir` copies there: one Vitest JSON report
//   per phase, `shard-<i>-of-<n>-<phase>.json` (or `<phase>.json` for an unsharded run).
// - --root is stripped from the start of file paths (default $GITHUB_WORKSPACE, else the current
//   directory), so the summary shows repo paths.
// - --outcome is the test step's outcome (`steps.<id>.outcome`). When the step failed but no report
//   lists a failed test, the summary says so instead of "no failures": the failure happened outside
//   a test (a coverage check before the run, a crashed worker, a phase that wrote no report).
//
// Prints, per phase, its counts, and for each failed test its file, full name, the first lines of
// its error and the first stack frame in the repo. It always exits 0 unless its arguments are
// wrong: it reports, and the test step's own exit code is what fails the job.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Phases in the order scripts/test.mjs runs them; any other name sorts after these.
const phaseOrder = ["server", "server-serial", "packages"];
// Enough to read a failure, small enough that ten shards' summaries stay far below GitHub's 1 MiB
// per step.
export const maxFailuresPerPhase = 30;
export const maxMessageLines = 8;
export const maxMessageChars = 1200;

export function parseArgs(argv) {
  const options = { dir: null, root: process.env.GITHUB_WORKSPACE || process.cwd(), outcome: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === "--root") options.root = take();
    else if (arg === "--outcome") options.outcome = take() || null;
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else if (options.dir === null) options.dir = arg;
    else throw new Error(`unexpected argument ${arg}`);
  }
  if (options.dir === null) throw new Error("usage: summarize-reports.mjs <report-dir> [--root <dir>] [--outcome <outcome>]");
  return options;
}

/** `shard-8-of-10-server.json` → { shard: { index: 8, count: 10 }, phase: "server" }; null if not a report. */
export function parseReportName(fileName) {
  const sharded = /^shard-(\d+)-of-(\d+)-(.+)\.json$/.exec(fileName);
  if (sharded) return { shard: { index: Number(sharded[1]), count: Number(sharded[2]) }, phase: sharded[3] };
  const plain = /^(.+)\.json$/.exec(fileName);
  return plain ? { shard: null, phase: plain[1] } : null;
}

// eslint-disable-next-line no-control-regex
const ansiPattern = /\u001b\[[0-9;]*[A-Za-z]/g;
const stackLinePattern = /^\s*at\s/;

/** The error's opening lines, up to its stack trace, capped in lines and characters. */
export function messageHead(message, { lines = maxMessageLines, chars = maxMessageChars } = {}) {
  const all = String(message ?? "").replace(ansiPattern, "").replace(/\r\n?/g, "\n").split("\n");
  const stackStart = all.findIndex((line) => stackLinePattern.test(line));
  const head = (stackStart === -1 ? all : all.slice(0, stackStart)).map((line) => line.trimEnd());
  while (head.length && head[head.length - 1] === "") head.pop();
  let text = head.slice(0, lines).join("\n");
  let cut = head.length > lines;
  if (text.length > chars) {
    text = text.slice(0, chars).trimEnd();
    cut = true;
  }
  return cut ? `${text}\n…` : text;
}

/** The first stack frame in the repo (not node_modules or Node's internals), as `path:line:col`. */
export function firstRepoFrame(message, root) {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  for (const line of String(message ?? "").replace(ansiPattern, "").split("\n")) {
    if (!stackLinePattern.test(line)) continue;
    const match = /(?:file:\/\/)?(\/[^\s()]+:\d+:\d+)/.exec(line);
    if (!match) continue;
    const location = match[1];
    if (!location.startsWith(prefix) || location.includes("/node_modules/")) continue;
    return location.slice(prefix.length);
  }
  return null;
}

export function repoPath(file, root) {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

// Backslash-escapes the ASCII punctuation Markdown could read as formatting or HTML.
function escapeMarkdown(text) {
  return String(text).replace(/[\\`*_{}[\]<>()#+!|~]/g, "\\$&").replace(/\s+/g, " ");
}

// A code span or fence longer than any run of backticks inside it.
function backtickFence(text, minimum) {
  const longest = Math.max(0, ...(String(text).match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(minimum, longest + 1));
}

function codeSpan(text) {
  const fence = backtickFence(text, 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One parsed report: counts, and every failure (a failed test, or a file that failed on its own). */
export function readPhase(report, root) {
  const files = Array.isArray(report.testResults) ? report.testResults : [];
  const tests = files.flatMap((file) => file.assertionResults ?? []);
  const countOf = (key, statuses) => (typeof report[key] === "number" ? report[key]
    : tests.filter((test) => statuses.includes(test.status)).length);
  const failures = [];
  for (const file of files) {
    const filePath = repoPath(file.name ?? "(unnamed file)", root);
    const failedTests = (file.assertionResults ?? []).filter((test) => test.status === "failed");
    for (const test of failedTests) {
      const messages = test.failureMessages ?? [];
      const titles = [...(test.ancestorTitles ?? []), test.title].filter(Boolean);
      failures.push({
        file: filePath,
        name: titles.length ? titles.join(" › ") : (test.fullName ?? "(unnamed test)"),
        message: messageHead(messages[0] ?? ""),
        frame: firstRepoFrame(messages[0] ?? "", root),
        moreErrors: Math.max(0, messages.length - 1),
      });
    }
    // A file can fail with no failed test: it didn't load, or a hook outside every test threw.
    if (file.status === "failed" && failedTests.length === 0) {
      failures.push({
        file: filePath,
        name: null,
        message: messageHead(file.message ?? "") || "The file failed without a failed test; see the step's log.",
        frame: firstRepoFrame(file.message ?? "", root),
        moreErrors: 0,
      });
    }
  }
  const endTimes = files.map((file) => file.endTime).filter(Number.isFinite);
  return {
    files: files.length,
    failedFiles: files.filter((file) => file.status === "failed").length,
    passed: countOf("numPassedTests", ["passed"]),
    failed: countOf("numFailedTests", ["failed"]),
    skipped: countOf("numPendingTests", ["skipped", "pending"]) + countOf("numTodoTests", ["todo"]),
    wallMs: Number.isFinite(report.startTime) && endTimes.length ? Math.max(...endTimes) - report.startTime : NaN,
    failures,
  };
}

function readReports(dir, root) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error.code === "ENOENT") return { phases: [], unreadable: [], missingDir: true };
    throw error;
  }
  const phases = [];
  const unreadable = [];
  for (const fileName of names.sort()) {
    const parsed = parseReportName(fileName);
    if (!parsed) continue;
    try {
      const report = JSON.parse(readFileSync(path.join(dir, fileName), "utf8"));
      phases.push({ fileName, ...parsed, ...readPhase(report, root) });
    } catch (error) {
      unreadable.push({ fileName, reason: error.message.split("\n")[0] });
    }
  }
  const rank = (phase) => {
    const index = phaseOrder.indexOf(phase);
    return index === -1 ? phaseOrder.length : index;
  };
  phases.sort((a, b) => rank(a.phase) - rank(b.phase) || a.phase.localeCompare(b.phase));
  return { phases, unreadable, missingDir: false };
}

function renderFailure(failure) {
  const where = failure.name ? `${codeSpan(failure.file)} › ${escapeMarkdown(failure.name)}` : `${codeSpan(failure.file)} (the file itself)`;
  const lines = [`- ${where}`];
  const body = [failure.message, failure.frame ? `at ${failure.frame}` : null].filter(Boolean).join("\n");
  if (body) {
    const fence = backtickFence(body, 3);
    lines.push(`  ${fence}text`, ...body.split("\n").map((line) => (line ? `  ${line}` : "")), `  ${fence}`);
  }
  if (failure.moreErrors) lines.push(`  (and ${plural(failure.moreErrors, "more error")})`);
  return lines.join("\n");
}

/** The Markdown summary of a report directory. */
export function summarize(dir, { root = process.cwd(), outcome = null } = {}) {
  const { phases, unreadable, missingDir } = readReports(dir, root);
  const shard = phases.find((phase) => phase.shard)?.shard
    ?? unreadable.map((entry) => parseReportName(entry.fileName)?.shard).find(Boolean)
    ?? null;
  const label = shard ? `Tests, shard ${shard.index}/${shard.count}` : "Tests";
  const failures = phases.flatMap((phase) => phase.failures);
  const failedTests = failures.length;
  const fileOnly = failures.filter((failure) => !failure.name).length;
  const stepFailed = outcome === "failure" || outcome === "cancelled";

  let headline;
  if (failedTests) {
    headline = [failedTests - fileOnly ? plural(failedTests - fileOnly, "failed test") : null,
      fileOnly ? `${plural(fileOnly, "file")} failed outside a test` : null].filter(Boolean).join(", ");
  }
  else if (phases.length === 0) headline = "no test reports";
  else if (unreadable.length) headline = "a report couldn't be read";
  else if (stepFailed) headline = `no failed test, but the step ${outcome === "cancelled" ? "was cancelled" : "failed"}`;
  else headline = "no failures";

  const out = [`### ${label}: ${headline}`, ""];
  if (phases.length === 0) {
    out.push(missingDir
      ? `No report directory (${codeSpan(dir)}): the tests didn't get as far as writing one. See the test step's log.`
      : `No reports in ${codeSpan(dir)}: the tests didn't get as far as writing one. See the test step's log.`, "");
  } else {
    out.push("| Phase | Files | Failed files | Tests passed | Tests failed | Skipped | Wall |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    const bold = (count) => (count ? `**${count}**` : "0");
    for (const phase of phases) {
      out.push(`| ${escapeMarkdown(phase.phase)} | ${phase.files} | ${bold(phase.failedFiles)} | ${phase.passed} `
        + `| ${bold(phase.failed)} | ${phase.skipped} | ${formatDuration(phase.wallMs)} |`);
    }
    out.push("");
  }
  for (const entry of unreadable) out.push(`- ${codeSpan(entry.fileName)} couldn't be read: ${escapeMarkdown(entry.reason)}`);
  if (unreadable.length) out.push("");
  if (!failedTests && phases.length && stepFailed) {
    out.push("The reports list no failed test, so the failure happened outside one: a check before the run, "
      + "a crashed worker, or a phase that wrote no report. See the test step's log.", "");
  }
  for (const phase of phases) {
    if (!phase.failures.length) continue;
    out.push(`#### Failed in ${escapeMarkdown(phase.phase)}`, "");
    for (const failure of phase.failures.slice(0, maxFailuresPerPhase)) out.push(renderFailure(failure));
    const rest = phase.failures.length - maxFailuresPerPhase;
    if (rest > 0) out.push(`- …and ${rest} more; every one is in the shard's test-reports artifact.`);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`summarize-reports: ${error.message}`);
    process.exit(2);
  }
  process.stdout.write(summarize(options.dir, options));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
