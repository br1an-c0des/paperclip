#!/usr/bin/env node
// The fork's test runner (hard-fork step 3a). Runs a tier of the suite as a few `vitest run`
// invocations from the repo root:
//
//   node scripts/test.mjs [--tier quick|thorough|optin|all] [--workers N] [--changed <ref>]
//                         [--files <listfile>] [--dry-run] [--skip-preflight] [-- <vitest args>]
//
// - thorough (the default, `pnpm test`): server files in parallel, then the `serialServer` files
//   one at a time, then every non-server project in a single run. `optIn` files are left out.
// - optin: only the files matching `optIn` globs. all: thorough, then optin.
// - quick: thorough restricted to the tests a change touches (see selectChangedTests).
//
// Tiers live in scripts/test-tiers.json. Every phase runs even when an earlier one fails, and the
// summary lists every phase's counts and failed files. Before running, the runner lists each phase's
// files with `vitest list --filesOnly` and checks that every test file lands in exactly one phase.
//
// Upstream's scripts/run-vitest-stable.mjs (pnpm test:run*) is kept for upstream's CI workflows.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { invocationEnv } from "./ci-profile/record.mjs";
import { retryReporterEnabled, vitestRetryArgs } from "./ci/vitest-retry.mjs";
import { stalledFileReporterEnabled } from "./ci/stalled-file-reporter.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

export const tiersFile = path.join(scriptsDir, "test-tiers.json");
export const tierNames = ["quick", "thorough", "optin", "all"];
// Server projects are selected by name, so the server config can be split into several projects.
export const serverProjectFilter = "@paperclipai/server*";
const serverProjectPattern = /^@paperclipai\/server/;
// The fastest of 2, 4, 6 and 8 workers on the 60-file benchmark set, with no file failing only in
// parallel, and half of this machine's 16 cores (fork/test-suite-audit/results-runner.md).
export const defaultWorkers = 8;
// quick: a directory with more test files than this contributes no directory files.
export const quickMaxDirectoryFiles = 50;
const sourceOnlyArgs = ["--exclude", "**/dist/**"];

function usageError(message) {
  const error = new Error(message);
  error.usage = true;
  return error;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (String(value).trim() === "" || !Number.isInteger(parsed) || parsed < 1) {
    throw usageError(`${name} must be a positive integer. Received "${value}".`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const options = {
    tier: "thorough", workers: null, changed: null, filesList: null, dryRun: false, skipPreflight: false,
    vitestArgs: [],
  };
  const valueOf = (index, name) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw usageError(`Missing value for ${name}.`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      options.vitestArgs = argv.slice(index + 1);
      break;
    }
    const [name, inline] = arg.startsWith("--") && arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, null];
    const take = () => {
      if (inline !== null) return inline;
      const value = valueOf(index, name);
      index += 1;
      return value;
    };
    if (name === "--tier") options.tier = take();
    else if (name === "--workers") options.workers = positiveInteger(take(), "--workers");
    else if (name === "--changed") options.changed = take();
    else if (name === "--files") options.filesList = take();
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--skip-preflight") options.skipPreflight = true;
    else throw usageError(`Unknown argument "${arg}".`);
  }
  if (!tierNames.includes(options.tier)) {
    throw usageError(`Unknown tier "${options.tier}". Expected one of: ${tierNames.join(", ")}.`);
  }
  if (options.changed !== null && options.tier !== "quick") throw usageError("--changed works only with --tier quick.");
  if (options.tier === "quick" && options.changed === null) options.changed = "main";
  return options;
}

export function loadTiers(file = tiersFile) {
  const tiers = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(tiers.serialServer) || !tiers.serialServer.every((entry) => typeof entry === "string")) {
    throw new Error(`${file}: serialServer must be an array of repo-relative paths.`);
  }
  if (!Array.isArray(tiers.optIn) || !tiers.optIn.every((entry) =>
    typeof entry?.glob === "string" && typeof entry?.reason === "string" && entry.reason.trim())) {
    throw new Error(`${file}: optIn must be an array of { glob, reason } with a reason for each.`);
  }
  return tiers;
}

function isServerFile(file, projectOf) {
  const project = projectOf?.get(file);
  return project ? serverProjectPattern.test(project) : file.startsWith("server/");
}

function isOptIn(file, tiers) {
  return tiers.optIn.some(({ glob }) => path.posix.matchesGlob(file, glob));
}

function excludeArgs(patterns) {
  return patterns.flatMap((pattern) => ["--exclude", pattern]);
}

/**
 * The phases of a tier: `{ name, args, files }`, where `args` are `vitest run` arguments and `files`
 * is null for "every file the args select" or the absolute paths to run. Phases with no files are
 * left out. Pure: everything it needs comes in through `tiers` and `options`.
 *
 * options: { root, workers, inventory?: { file, project }[], files?: string[] | null,
 *            sharedDatabase?: boolean }. Paths in `tiers`, `inventory` and `files` are repo-relative.
 */
export function buildPlan(tier, tiers, options) {
  const { root, inventory = null, sharedDatabase = false } = options;
  const workers = options.workers ?? defaultWorkers;
  const restrictTo = options.files ?? null;
  const absolute = (file) => path.posix.join(root, file);
  const projectOf = inventory && new Map(inventory.map((entry) => [entry.file, entry.project]));
  const serial = new Set(tiers.serialServer);
  // A shared external test database can't be isolated per file, as in upstream's runner.
  const parallelArgs = sharedDatabase ? ["--no-file-parallelism", "--maxWorkers=1"]
    : ["--fileParallelism", `--maxWorkers=${workers}`];
  const serialArgs = ["--no-file-parallelism", "--maxWorkers=1"];

  function phases(prefix, files, { excludeOptIn }) {
    const optInExcludes = excludeOptIn ? tiers.optIn.map(({ glob }) => absolute(glob)) : [];
    const isServer = (file) => isServerFile(file, projectOf);
    const pick = (predicate) => files === null ? null : files.filter(predicate).map(absolute);
    const serialFiles = (files ?? tiers.serialServer)
      .filter((file) => serial.has(file) && isServer(file) && !(excludeOptIn && isOptIn(file, tiers)));
    const result = [
      {
        name: `${prefix}server`,
        args: ["--project", serverProjectFilter, ...parallelArgs,
          ...excludeArgs([...sourceOnlyArgs.slice(1), ...tiers.serialServer.map(absolute), ...optInExcludes])],
        files: pick((file) => isServer(file) && !serial.has(file)),
      },
      {
        name: `${prefix}server-serial`,
        args: ["--project", serverProjectFilter, ...serialArgs, ...sourceOnlyArgs],
        files: serialFiles.map(absolute),
      },
      {
        name: `${prefix}packages`,
        args: ["--project", `!${serverProjectFilter}`, `--maxWorkers=${workers}`,
          ...excludeArgs([...sourceOnlyArgs.slice(1), ...optInExcludes])],
        files: pick((file) => !isServer(file)),
      },
    ];
    return result.filter((phase) => phase.files === null || phase.files.length > 0);
  }

  function thorough(files) {
    return phases("", files === null ? null : files.filter((file) => !isOptIn(file, tiers)), { excludeOptIn: true });
  }

  function optin(files) {
    if (tiers.optIn.length === 0) return [];
    const candidates = files ?? (inventory ?? []).map((entry) => entry.file);
    return phases("optin-", candidates.filter((file) => isOptIn(file, tiers)), { excludeOptIn: false });
  }

  if (tier === "thorough") return thorough(restrictTo);
  if (tier === "quick") return thorough(restrictTo ?? []);
  if (tier === "optin") return optin(restrictTo);
  if (tier === "all") return [...thorough(restrictTo), ...optin(restrictTo)];
  throw new Error(`Unknown tier "${tier}".`);
}

/**
 * Runs every phase in order through `exec(phase)`, which returns an exit code or an object with
 * `exitCode` and any extra fields to keep. A failed or throwing phase doesn't stop the later
 * ones; an aborted `signal` (Ctrl-C) does, and the phases not started are marked skipped.
 */
export async function runPhases(phases, exec, { signal } = {}) {
  const results = [];
  for (const phase of phases) {
    if (signal?.aborted) {
      results.push({ phase: phase.name, exitCode: null, wallMs: 0, skipped: true });
      continue;
    }
    const started = performance.now();
    let outcome;
    try {
      outcome = await exec(phase);
    } catch (error) {
      outcome = { exitCode: 1, error: error?.message ?? String(error) };
    }
    const fields = typeof outcome === "number" ? { exitCode: outcome } : outcome;
    results.push({ ...fields, phase: phase.name, wallMs: performance.now() - started });
  }
  return results;
}

export function exitCodeFor(results) {
  return results.some((result) => result.exitCode !== 0) ? 1 : 0;
}

const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bvi\.(?:mock|doMock|importActual)\s*(?:<[^>]*>)?\(\s*|\brequire\(\s*)["'`]([^"'`]+)["'`]/g;

function withoutExtension(file) {
  return file.replace(/\.(?:[cm]?[jt]sx?)$/, "").replace(/\/index$/, "");
}

/**
 * quick: the test files a change touches. For each changed file:
 * - a changed test file selects itself;
 * - a changed source file selects the test files whose name contains its basename, the test files
 *   that import it (or mock it) by a relative path, and, when its directory holds at most
 *   `maxDirectoryFiles` test files (its own and its __tests__ folder's), those too.
 * Vitest's own --changed follows the server's module graph, which links nearly everything: a
 * one-line change in server/src/services/ selected ~1,370 files (results-runner.md).
 */
export function selectChangedTests(changedFiles, testFiles, readSource, { maxDirectoryFiles = quickMaxDirectoryFiles } = {}) {
  const tests = new Set(testFiles);
  const selected = new Set();
  const sourceExtensions = /\.(?:[cm]?[jt]sx?)$/;
  let importsByTest = null;
  const imports = () => {
    importsByTest ??= new Map(testFiles.map((file) => {
      const specifiers = new Set();
      for (const match of String(readSource(file) ?? "").matchAll(importPattern)) {
        const specifier = match[1];
        if (specifier.startsWith(".")) specifiers.add(withoutExtension(path.posix.join(path.posix.dirname(file), specifier)));
      }
      return [file, specifiers];
    }));
    return importsByTest;
  };
  for (const changed of changedFiles) {
    if (tests.has(changed)) {
      selected.add(changed);
      continue;
    }
    if (!sourceExtensions.test(changed)) continue;
    const dir = path.posix.dirname(changed);
    const base = path.posix.basename(changed).replace(sourceExtensions, "");
    const target = withoutExtension(changed);
    for (const file of testFiles) {
      // Match the name without its .test.ts suffix, so a change to test.mjs doesn't select every test.
      if (path.posix.basename(file).replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/, "").includes(base)) selected.add(file);
    }
    for (const [file, specifiers] of imports()) {
      if (specifiers.has(target)) selected.add(file);
    }
    const directoryFiles = testFiles.filter((file) => {
      const fileDir = path.posix.dirname(file);
      return fileDir === dir || fileDir === `${dir}/__tests__`;
    });
    if (directoryFiles.length <= maxDirectoryFiles) for (const file of directoryFiles) selected.add(file);
  }
  return { files: [...selected].sort() };
}

// ---------------------------------------------------------------------------------------------
// Everything below runs processes.

const vitestBin = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");

function log(message) {
  console.log(`[test] ${message}`);
}

function toRepoPath(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

// Suite-specific external URLs can name a shared mutable database (as in run-vitest-stable.mjs).
function hasSharedTestDatabase(env = process.env) {
  return Object.entries(env).some(([key, value]) =>
    key.startsWith("PAPERCLIP_") && key.endsWith("_TEST_DATABASE_URL") && value?.trim());
}

// Per-run home, config and temp directories, as upstream's runner sets them: config discovery
// otherwise prefers the checkout's .paperclip/config.json, and tests write under PAPERCLIP_HOME.
function createRunRoot() {
  const parent = process.platform === "win32" ? os.tmpdir() : "/tmp";
  const runRoot = realpathSync(mkdtempSync(path.join(parent, "pt-")));
  mkdirSync(path.join(runRoot, "t"), { recursive: true });
  return runRoot;
}

// Some tests leave read-only directories behind (runtime-context asset bundles are 0555), which
// rmSync can't empty, so make every directory writable and try again. Cleanup never fails a run.
export function removeRunRoot(runRoot) {
  try {
    rmSync(runRoot, { recursive: true, force: true });
    return;
  } catch {
    // Fall through to the chmod pass.
  }
  const makeWritable = (dir) => {
    chmodSync(dir, 0o700);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) makeWritable(path.join(dir, entry.name));
    }
  };
  try {
    makeWritable(runRoot);
    rmSync(runRoot, { recursive: true, force: true });
  } catch (error) {
    log(`warning: could not remove ${runRoot}: ${error.message}`);
  }
}

let invocation = 0;
function phaseEnv(runRoot) {
  invocation += 1;
  const home = path.join(runRoot, `h${invocation}`);
  mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PAPERCLIP_TEST_HOST_HOME: process.env.PAPERCLIP_TEST_HOST_HOME
      ?? (process.env.PAPERCLIP_HOME?.trim() || path.join(os.homedir(), ".paperclip")),
    PAPERCLIP_HOME: home,
    PAPERCLIP_CONFIG: path.join(home, "config.json"),
    PAPERCLIP_INSTANCE_ID: `vt-${process.pid}-${invocation}`,
    TMPDIR: path.join(runRoot, "t"),
  };
  delete env.PAPERCLIP_CI_TEST_SELECTION;
  delete env.PAPERCLIP_CI_SELECTION_HASH;
  return env;
}

// A --reporter on the command line replaces the config's reporters, so this repeats the root
// vitest.config.ts list and adds the JSON report the summary reads.
function reporterArgs(jsonFile, vitestArgs, env) {
  const userReporter = vitestArgs.some((arg) => arg === "--reporter" || arg.startsWith("--reporter="));
  const reporters = [
    ...(userReporter ? [] : ["default"]),
    ...(env.GITHUB_ACTIONS === "true" ? ["./scripts/ci/test-timing-reporter.mjs", "./scripts/ci/oversized-test-files.mjs"] : []),
    ...(env.PAPERCLIP_CI_PROFILE === "true" ? ["./scripts/ci-profile/vitest-reporter.mjs"] : []),
    ...(retryReporterEnabled(env) ? ["./scripts/ci/retry-reporter.mjs"] : []),
    ...(stalledFileReporterEnabled(env) ? ["./scripts/ci/stalled-file-reporter.mjs"] : []),
    "json",
  ];
  return [...reporters.map((reporter) => `--reporter=${reporter}`), `--outputFile.json=${jsonFile}`];
}

let currentChild = null;
function spawnAndWait(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: "inherit", ...options });
    currentChild = child;
    child.once("error", (error) => {
      currentChild = null;
      reject(error);
    });
    child.once("close", (code, signal) => {
      currentChild = null;
      resolve(code ?? (signal ? 128 + (os.constants.signals[signal] ?? 1) : 1));
    });
  });
}

function vitestList(args, env, outFile) {
  const result = spawnSync(process.execPath, [vitestBin, "list", "--filesOnly", `--json=${outFile}`, ...args], {
    cwd: repoRoot, env, encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`vitest list failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return JSON.parse(readFileSync(outFile, "utf8")).map((entry) => ({ file: toRepoPath(entry.file), project: entry.projectName }));
}

function pnpmCommand() {
  const execPath = process.env.npm_execpath;
  if (execPath && /pnpm/i.test(path.basename(execPath))) {
    return /\.[cm]?js$/.test(execPath) ? [process.execPath, [execPath]] : [execPath, []];
  }
  return ["corepack", ["pnpm"]];
}

async function preflight() {
  const [command, prefix] = pnpmCommand();
  for (const args of [["run", "preflight:workspace-links"], ["--filter", "@paperclipai/plugin-sdk", "ensure-build-deps"]]) {
    log(`preflight: pnpm ${args.join(" ")}`);
    const code = await spawnAndWait(command, [...prefix, ...args], { env: process.env });
    if (code !== 0) throw new Error(`preflight "pnpm ${args.join(" ")}" failed (${code})`);
  }
}

function readFilesList(file) {
  return readFileSync(path.resolve(file), "utf8").split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((line) => toRepoPath(path.resolve(repoRoot, line)));
}

function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function changedFilesSince(ref) {
  const [base] = git(["merge-base", ref, "HEAD"]);
  return [...new Set([...git(["diff", "--name-only", base]), ...git(["ls-files", "--others", "--exclude-standard"])])]
    .filter((file) => existsSync(path.join(repoRoot, file)));
}

function checkTiers(tiers, inventory) {
  const byFile = new Map(inventory.map((entry) => [entry.file, entry.project]));
  const problems = tiers.serialServer
    .filter((file) => !serverProjectPattern.test(byFile.get(file) ?? ""))
    .map((file) => `serialServer path is not a server test file: ${file}`);
  for (const { glob } of tiers.optIn) {
    if (!inventory.some((entry) => path.posix.matchesGlob(entry.file, glob))) log(`warning: optIn glob matches no test file: ${glob}`);
  }
  if (problems.length > 0) throw new Error(`${path.relative(repoRoot, tiersFile)}:\n  ${problems.join("\n  ")}`);
}

// The files each phase will run, and a check that every expected file is in exactly one phase.
function listPhases(phases, expected, env, runRoot) {
  const seen = new Map();
  const listed = phases.map((phase, index) => {
    const files = vitestList([...phase.args, ...(phase.files ?? [])], env, path.join(runRoot, `list-${index}.json`));
    for (const { file } of files) seen.set(file, [...(seen.get(file) ?? []), phase.name]);
    return { phase, files };
  });
  const missing = [...expected].filter((file) => !seen.has(file));
  const unexpected = [...seen.keys()].filter((file) => !expected.has(file));
  const duplicated = [...seen].filter(([, names]) => names.length > 1).map(([file, names]) => `${file} (${names.join(", ")})`);
  return { listed, missing, unexpected, duplicated };
}

function expectedFiles(tier, tiers, inventory, files) {
  const pool = files === null ? inventory.map((entry) => entry.file) : files.filter((file) => inventory.some((entry) => entry.file === file));
  if (tier === "thorough" || tier === "quick") return new Set(pool.filter((file) => !isOptIn(file, tiers)));
  if (tier === "optin") return new Set(pool.filter((file) => isOptIn(file, tiers)));
  return new Set(pool);
}

function formatSeconds(ms) {
  const seconds = ms / 1000;
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m${String(Math.round(seconds % 60)).padStart(2, "0")}s` : `${seconds.toFixed(1)}s`;
}

function pad(value, width, left = false) {
  const text = String(value);
  return left ? text.padEnd(width) : text.padStart(width);
}

function printSummary(tier, workers, results, wallMs) {
  console.log(`\n[test] summary: tier ${tier}, ${workers} workers, ${formatSeconds(wallMs)} in all`);
  console.log(`${pad("phase", 22, true)}${pad("files", 7)}${pad("passed", 9)}${pad("failed", 8)}${pad("skipped", 9)}${pad("wall", 9)}${pad("exit", 9)}`);
  const total = { files: 0, passed: 0, failed: 0, skippedTests: 0 };
  for (const result of results) {
    const count = (key) => result.skipped || result[key] === undefined ? "-" : result[key];
    for (const key of Object.keys(total)) total[key] += typeof result[key] === "number" ? result[key] : 0;
    console.log(`${pad(result.phase, 22, true)}${pad(count("files"), 7)}${pad(count("passed"), 9)}${pad(count("failed"), 8)}`
      + `${pad(count("skippedTests"), 9)}${pad(result.skipped ? "-" : formatSeconds(result.wallMs), 9)}`
      + `${pad(result.skipped ? "not run" : result.exitCode, 9)}`);
  }
  console.log(`${pad("total", 22, true)}${pad(total.files, 7)}${pad(total.passed, 9)}${pad(total.failed, 8)}${pad(total.skippedTests, 9)}`);
  const failures = results.filter((result) => result.exitCode !== 0);
  for (const result of failures) {
    if (result.skipped) {
      console.log(`[test] ${result.phase}: not run (interrupted)`);
      continue;
    }
    const why = result.error ?? (result.failedFiles?.length ? `${result.failedFiles.length} failed files`
      : result.exitCode === 130 ? "interrupted" : "exited non-zero with no failed test file; see its output above");
    console.log(`[test] ${result.phase} failed (exit ${result.exitCode}): ${why}`);
    for (const file of result.failedFiles ?? []) console.log(`  ${file}`);
    if (result.plannedFiles !== undefined && result.files !== undefined && result.files !== result.plannedFiles) {
      console.log(`  ran ${result.files} of ${result.plannedFiles} planned files`);
    }
  }
  const mismatched = results.filter((result) => result.exitCode === 0 && result.plannedFiles !== undefined && result.files !== result.plannedFiles);
  for (const result of mismatched) console.log(`[test] ${result.phase}: ran ${result.files} of ${result.plannedFiles} planned files`);
}

function readReport(jsonFile) {
  try {
    const report = JSON.parse(readFileSync(jsonFile, "utf8"));
    return {
      files: report.testResults.length,
      passed: report.numPassedTests,
      failed: report.numFailedTests,
      skippedTests: report.numPendingTests + (report.numTodoTests ?? 0),
      failedFiles: report.testResults.filter((file) => file.status === "failed").map((file) => toRepoPath(file.name)),
    };
  } catch {
    return {};
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tiers = loadTiers();
  const sharedDatabase = hasSharedTestDatabase();
  const workers = options.workers ?? defaultWorkers;
  if (sharedDatabase) log("a PAPERCLIP_*_TEST_DATABASE_URL is set: server files run one at a time");
  const runRoot = createRunRoot();
  const controller = new AbortController();
  const onSignal = (signal) => {
    if (!controller.signal.aborted) log(`${signal}: stopping after the current phase`);
    controller.abort();
    // Ctrl-C reaches Vitest through the terminal's process group; a second SIGINT would make it
    // exit without its teardown, so only SIGTERM is passed on.
    if (signal === "SIGTERM") currentChild?.kill(signal);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  try {
    const inventory = vitestList(sourceOnlyArgs, phaseEnv(runRoot), path.join(runRoot, "inventory.json"));
    checkTiers(tiers, inventory);
    let files = options.filesList ? readFilesList(options.filesList) : null;
    if (options.tier === "quick") {
      const changed = changedFilesSince(options.changed);
      const testFiles = inventory.map((entry) => entry.file);
      files = selectChangedTests(changed, testFiles, (file) => readFileSync(path.join(repoRoot, file), "utf8")).files
        .filter((file) => files === null || files.includes(file));
      log(`quick: ${changed.length} files changed since ${options.changed}, ${files.length} test files selected`);
    }
    if (files !== null) {
      const known = new Set(inventory.map((entry) => entry.file));
      for (const file of files.filter((item) => !known.has(item))) log(`warning: not a test file in any project: ${file}`);
    }

    const phases = buildPlan(options.tier, tiers, { root: repoRoot, workers, inventory, files, sharedDatabase });
    if (phases.length === 0) {
      log(`tier ${options.tier}: no test files to run`);
      return 0;
    }
    const expected = expectedFiles(options.tier, tiers, inventory, files);
    const listing = listPhases(phases, expected, phaseEnv(runRoot), runRoot);
    log(`tier ${options.tier}, ${workers} workers:`);
    for (const { phase, files: phaseFiles } of listing.listed) {
      const flags = phase.args.filter((arg) => /^--(?:no-)?file|^--maxWorkers/.test(arg)).join(" ");
      console.log(`  ${pad(phase.name, 22, true)}${pad(phaseFiles.length, 6)} files  ${flags}`);
    }
    const problems = [
      ...listing.missing.map((file) => `in no phase: ${file}`),
      ...listing.unexpected.map((file) => `not expected in this tier: ${file}`),
      ...listing.duplicated.map((entry) => `in more than one phase: ${entry}`),
    ];
    if (problems.length > 0) {
      console.error(`[test] the phases don't cover the tier's files exactly:\n  ${problems.join("\n  ")}`);
      return 1;
    }
    log(`coverage: every one of ${expected.size} test files is in exactly one phase`);
    if (options.dryRun) return 0;

    if (!options.skipPreflight) await preflight();
    const planned = new Map(listing.listed.map(({ phase, files: phaseFiles }) => [phase.name, phaseFiles.length]));
    const started = performance.now();
    const results = await runPhases(phases, async (phase) => {
      const env = invocationEnv("vitest", phaseEnv(runRoot));
      const jsonFile = path.join(runRoot, `${phase.name}.json`);
      log(`phase ${phase.name}: ${planned.get(phase.name)} files`);
      const exitCode = await spawnAndWait(process.execPath, [vitestBin, "run", ...phase.args,
        ...reporterArgs(jsonFile, options.vitestArgs, env), ...vitestRetryArgs(env), ...options.vitestArgs,
        ...(phase.files ?? [])], { env });
      return { exitCode, plannedFiles: planned.get(phase.name), ...readReport(jsonFile) };
    }, { signal: controller.signal });
    printSummary(options.tier, workers, results, performance.now() - started);
    return controller.signal.aborted ? 130 : exitCodeFor(results);
  } finally {
    removeRunRoot(runRoot);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => {
    process.exitCode = code;
  }, (error) => {
    console.error(`[test] ${error.usage ? "" : "error: "}${error.message}`);
    process.exitCode = error.usage ? 2 : 1;
  });
}
