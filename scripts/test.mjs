#!/usr/bin/env node
// The fork's test runner (hard-fork step 3a). Runs a tier of the suite as a few `vitest run`
// invocations from the repo root:
//
//   node scripts/test.mjs [--tier core|extended|thorough|quick|optin|all] [--workers N] [--changed <ref>]
//                         [--files <listfile>] [--shard i/n] [--report-dir <dir>] [--dry-run]
//                         [--skip-preflight] [-- <vitest args>]
//
// - core (the default, `pnpm test`): the files that gate a merge and a deploy. Server files in
//   parallel, then the `serialServer` files one at a time, then every non-server project in a
//   single run. `optIn` files and the files listed in `extendedList` are left out.
// - extended: only the files in `extendedList` (upstream's slower and flakier integration tests,
//   run nightly and on demand; they report, they don't gate). thorough: core and extended together.
// - optin: only the files matching `optIn` globs. all: thorough, then optin.
// - quick: core restricted to the tests a change touches (see selectChangedTests).
// - --shard i/n: only the i-th of n slices of the tier (CI runs one shard per job). Each phase's
//   files are split by expected time (assignShards), the same way on every machine.
// - --workers: by default, from the machine's cores and free memory (defaultWorkerCount).
// - --report-dir: copy each phase's Vitest JSON report there (CI uploads them).
//
// Tiers live in scripts/test-tiers.json. Every phase runs even when an earlier one fails, and the
// summary lists every phase's counts and failed files. Before running, the runner lists each phase's
// files with `vitest list --filesOnly` and checks that every test file lands in exactly one phase.
//
// Upstream's scripts/run-vitest-stable.mjs (pnpm test:run*) is no longer run by any workflow.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { invocationEnv } from "./ci-profile/record.mjs";
import { retryReporterEnabled, vitestRetryArgs } from "./ci/vitest-retry.mjs";
import { stalledFileReporterEnabled } from "./ci/stalled-file-reporter.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

export const tiersFile = path.join(scriptsDir, "test-tiers.json");
export const tierNames = ["core", "extended", "thorough", "quick", "optin", "all"];
// Server projects are selected by name, so the server config can be split into several projects.
export const serverProjectFilter = "@paperclipai/server*";
const serverProjectPattern = /^@paperclipai\/server/;
// The default worker count is the smallest of this cap (the fastest of 2, 4, 6 and 8 workers on the
// 60-file benchmark set, with no file failing only in parallel: results-runner.md), half the
// cores, and the free memory divided by what one worker takes: at most 1.46 GB (PSS of the whole
// process tree, Postgres included, at 4 isolated workers; fork/test-suite-audit/results-ci.md).
export const maxDefaultWorkers = 8;
export const bytesPerWorker = 1.5 * 1024 ** 3;
// Expected seconds per test file, for balancing shards, from the first of these that has the file:
// test-weights.json (this workflow's own CI timings, written by scripts/refresh-shard-weights.mjs),
// then classification.csv's local_s (the desktop's profile), then its ci_s (upstream's recorded
// durations). Files with none count as the median of those that have one.
export const shardWeightsFile = path.join(scriptsDir, "test-weights.json");
export const expectedSecondsFile = path.join(repoRoot, "fork", "test-suite-audit", "classification.csv");
// quick: a directory with more test files than this contributes no directory files.
export const quickMaxDirectoryFiles = 50;
const sourceOnlyArgs = ["--exclude", "**/dist/**"];
// A package project with its own config doesn't inherit the root's fsModuleCache (results-overhead.md).
const cacheArgs = ["--fsModuleCache"];

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

function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = match ? Number(match[1]) : NaN;
  const count = match ? Number(match[2]) : NaN;
  if (!match || count < 1 || index < 1 || index > count) {
    throw usageError(`--shard must be i/n with 1 <= i <= n, such as 2/8. Received "${value}".`);
  }
  return { index, count };
}

export function parseArgs(argv) {
  const options = {
    tier: "core", workers: null, changed: null, filesList: null, shard: null, reportDir: null, dryRun: false,
    skipPreflight: false, vitestArgs: [],
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
    else if (name === "--shard") options.shard = parseShard(take());
    else if (name === "--report-dir") options.reportDir = take();
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
  tiers.alwaysQuick ??= [];
  if (tiers.extendedList !== undefined) {
    if (typeof tiers.extendedList !== "string" || !tiers.extendedList.trim()) {
      throw new Error(`${file}: extendedList must be a path, relative to ${path.basename(file)}, of a file listing the extended tier.`);
    }
    tiers.extended = readExtendedList(path.resolve(path.dirname(file), tiers.extendedList));
  }
  tiers.extended ??= [];
  if (!Array.isArray(tiers.alwaysQuick) || !tiers.alwaysQuick.every((entry) =>
    typeof entry?.file === "string" && typeof entry?.reason === "string" && entry.reason.trim())) {
    throw new Error(`${file}: alwaysQuick must be an array of { file, reason } with a reason for each.`);
  }
  return tiers;
}

/**
 * The extended tier's files from its list: one repo-relative path per line; blank lines and
 * `#` comments are ignored.
 */
export function readExtendedList(file) {
  return parseExtendedList(readFileSync(file, "utf8"));
}

export function parseExtendedList(text) {
  return text.split("\n").map((line) => line.replace(/#.*/, "").trim()).filter(Boolean);
}

const extendedSets = new WeakMap();
function isExtended(file, tiers) {
  if (!tiers.extended?.length) return false;
  let set = extendedSets.get(tiers);
  if (!set) extendedSets.set(tiers, set = new Set(tiers.extended));
  return set.has(file);
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
 *            sharedDatabase?: boolean, shard?: { index, count }, expectedSeconds?: (file) => number }.
 * Paths in `tiers`, `inventory` and `files` are repo-relative. With `shard`, it returns that shard's
 * phases (see buildShards).
 */
export function buildPlan(tier, tiers, options) {
  if (options.shard) return buildShards(tier, tiers, { ...options, shardCount: options.shard.count })[options.shard.index - 1];
  return buildUnsharded(tier, tiers, options);
}

/**
 * The phases of every shard of a tier: an array of `shardCount` plans, each a list of phases with
 * explicit files. Each phase's files are split by assignShards, weighted by `expectedSeconds(file)`
 * (repo-relative; undefined for an unknown file, which then counts as the median of the known
 * ones). Needs `inventory` or `files`, so the split is the same for the same file list.
 */
export function buildShards(tier, tiers, options) {
  const { root, shardCount, expectedSeconds = () => undefined } = options;
  const files = options.files ?? options.inventory?.map((entry) => entry.file);
  if (!files) throw new Error("Sharding needs the inventory or a file list.");
  const phases = buildUnsharded(tier, tiers, { ...options, files });
  return assignShards(phases, shardCount, shardWeights(phases.flatMap((phase) => phase.files), root, expectedSeconds));
}

/**
 * The weight function buildShards uses for these (absolute) files: `expectedSeconds` of the
 * repo-relative path, or the median of the files that have one (1 when none has).
 */
export function shardWeights(files, root, expectedSeconds) {
  const prefix = `${root}/`;
  const secondsOf = (file) => {
    const seconds = expectedSeconds(file.startsWith(prefix) ? file.slice(prefix.length) : file);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
  };
  const known = files.map(secondsOf).filter((seconds) => seconds !== undefined).sort((a, b) => a - b);
  const median = known.length === 0 ? 1 : known.length % 2 === 1 ? known[(known.length - 1) / 2]
    : (known[known.length / 2 - 1] + known[known.length / 2]) / 2;
  return (file) => secondsOf(file) ?? median;
}

/**
 * Splits each phase's files into `count` shards: longest expected time first, each onto the shard
 * with the least expected time so far in that phase, so every shard's slice of every phase takes
 * about as long. Ties go to the shard with the least time in the earlier phases, then the lower
 * shard number. Phases are balanced on their own because they run one after another, and a serial
 * phase's time isn't divided by the workers. Files of equal weight are taken in path order, so the
 * result depends only on the files and their weights, not their order or the machine. Returns
 * `count` plans; a shard with no files in a phase leaves that phase out.
 */
export function assignShards(phases, count, weightOf) {
  const shards = Array.from({ length: count }, () => []);
  const totals = new Array(count).fill(0);
  for (const phase of phases) {
    if (!Array.isArray(phase.files)) throw new Error(`Phase ${phase.name}: sharding needs an explicit file list.`);
    const ordered = [...phase.files].map((file) => ({ file, weight: weightOf(file) }))
      .sort((a, b) => b.weight - a.weight || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    const loads = new Array(count).fill(0);
    const buckets = Array.from({ length: count }, () => []);
    for (const { file, weight } of ordered) {
      let target = 0;
      for (let index = 1; index < count; index += 1) {
        if (loads[index] < loads[target] || (loads[index] === loads[target] && totals[index] < totals[target])) target = index;
      }
      buckets[target].push(file);
      loads[target] += weight;
    }
    loads.forEach((load, index) => { totals[index] += load; });
    buckets.forEach((files, index) => {
      if (files.length > 0) shards[index].push({ ...phase, files: files.sort() });
    });
  }
  return shards;
}

/** What's wrong with a set of shards: files in no shard, in more than one, or not expected. */
export function shardCoverageProblems(shards, expected) {
  const seen = new Map();
  shards.forEach((shard, index) => {
    for (const phase of shard) for (const file of phase.files) seen.set(file, [...(seen.get(file) ?? []), index + 1]);
  });
  return [
    ...[...expected].filter((file) => !seen.has(file)).map((file) => `in no shard: ${file}`),
    ...[...seen.keys()].filter((file) => !expected.has(file)).map((file) => `not expected in this tier: ${file}`),
    ...[...seen].filter(([, indexes]) => indexes.length > 1)
      .map(([file, indexes]) => `in more than one shard: ${file} (${indexes.join(", ")})`),
  ];
}

/** Expected seconds per file from test-weights.json's text: its `seconds` object. */
export function parseShardWeights(jsonText) {
  const data = JSON.parse(jsonText);
  if (!data || typeof data.seconds !== "object" || data.seconds === null || Array.isArray(data.seconds)) {
    throw new Error("expected a `seconds` object of repo-relative test files to seconds");
  }
  const seconds = new Map();
  for (const [file, value] of Object.entries(data.seconds)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${file}: not a number of seconds (${value})`);
    seconds.set(file, value);
  }
  return seconds;
}

/**
 * Combines expected-seconds sources, `[{ name, seconds: Map }]` in order of preference: each file
 * takes its seconds from the first source that has it. Returns `{ seconds, sourceOf }`, both keyed
 * by file; `sourceOf` holds the name of the source each file's seconds came from.
 */
export function mergeExpectedSeconds(sources) {
  const seconds = new Map();
  const sourceOf = new Map();
  for (const source of sources) {
    for (const [file, value] of source.seconds) {
      if (seconds.has(file)) continue;
      seconds.set(file, value);
      sourceOf.set(file, source.name);
    }
  }
  return { seconds, sourceOf };
}

/** Expected seconds per file from classification.csv's text: local_s, else ci_s. */
export function parseExpectedSeconds(csvText) {
  const rows = parseCsv(csvText);
  const [header, ...body] = rows;
  const column = (name) => header.indexOf(name);
  const [fileColumn, localColumn, ciColumn] = [column("file"), column("local_s"), column("ci_s")];
  if (fileColumn < 0 || (localColumn < 0 && ciColumn < 0)) throw new Error("expected columns file, local_s and ci_s");
  const seconds = new Map();
  for (const row of body) {
    const value = [row[localColumn], row[ciColumn]].find((cell) => cell !== undefined && cell.trim() !== "");
    if (row[fileColumn] && value !== undefined && Number.isFinite(Number(value))) seconds.set(row[fileColumn], Number(value));
  }
  return seconds;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((items) => items.some((item) => item !== ""));
}

/**
 * The default worker count: the smallest of maxDefaultWorkers, half the cores and the free memory
 * divided by `perWorkerBytes`, and at least one. `limitedBy` names the term that set it.
 */
export function defaultWorkerCount({ cores, availableBytes, perWorkerBytes = bytesPerWorker, cap = maxDefaultWorkers }) {
  const byCores = Math.floor(cores / 2);
  const byMemory = Math.floor(availableBytes / perWorkerBytes);
  const terms = [["cap", cap], ["cores", byCores], ["memory", byMemory]];
  const [limitedBy, smallest] = terms.reduce((best, term) => term[1] < best[1] ? term : best);
  const workers = Math.max(1, smallest);
  const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  const reason = `min(cap ${cap}, ${cores} cores / 2 = ${byCores}, ${gb(availableBytes)} free / ${gb(perWorkerBytes)} per worker = ${byMemory})`
    + (smallest < 1 ? ", at least 1" : "");
  return { workers, limitedBy, reason };
}

function buildUnsharded(tier, tiers, options) {
  const { root, inventory = null, sharedDatabase = false } = options;
  const workers = options.workers ?? maxDefaultWorkers;
  const restrictTo = options.files ?? null;
  const absolute = (file) => path.posix.join(root, file);
  const projectOf = inventory && new Map(inventory.map((entry) => [entry.file, entry.project]));
  const serial = new Set(tiers.serialServer);
  // A shared external test database can't be isolated per file, as in upstream's runner.
  const parallelArgs = [...(sharedDatabase ? ["--no-file-parallelism", "--maxWorkers=1"]
    : ["--fileParallelism", `--maxWorkers=${workers}`]), ...cacheArgs];
  const serialArgs = ["--no-file-parallelism", "--maxWorkers=1", ...cacheArgs];

  function phases(prefix, files, { excludeOptIn, excludeExtended = false }) {
    // Only when the files aren't listed (no inventory): the args then select the tier's files.
    const extendedExcludes = excludeExtended && files === null ? (tiers.extended ?? []).map(absolute) : [];
    const optInExcludes = [...(excludeOptIn ? tiers.optIn.map(({ glob }) => absolute(glob)) : []), ...extendedExcludes];
    const isServer = (file) => isServerFile(file, projectOf);
    const pick = (predicate) => files === null ? null : files.filter(predicate).map(absolute);
    const serialFiles = (files ?? tiers.serialServer)
      .filter((file) => serial.has(file) && isServer(file) && !(excludeOptIn && isOptIn(file, tiers))
        && !(excludeExtended && isExtended(file, tiers)));
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
        args: ["--project", `!${serverProjectFilter}`, `--maxWorkers=${workers}`, ...cacheArgs,
          ...excludeArgs([...sourceOnlyArgs.slice(1), ...optInExcludes])],
        files: pick((file) => !isServer(file)),
      },
    ];
    return result.filter((phase) => phase.files === null || phase.files.length > 0);
  }

  function thorough(files) {
    return phases("", files === null ? null : files.filter((file) => !isOptIn(file, tiers)), { excludeOptIn: true });
  }

  function core(files) {
    const candidates = files ?? inventory?.map((entry) => entry.file) ?? null;
    return phases("", candidates === null ? null : candidates.filter((file) => !isOptIn(file, tiers) && !isExtended(file, tiers)),
      { excludeOptIn: true, excludeExtended: true });
  }

  function extended(files) {
    const candidates = files ?? (inventory ? inventory.map((entry) => entry.file) : tiers.extended ?? []);
    return phases("extended-", candidates.filter((file) => isExtended(file, tiers) && !isOptIn(file, tiers)), { excludeOptIn: false });
  }

  function optin(files) {
    if (tiers.optIn.length === 0) return [];
    const candidates = files ?? (inventory ?? []).map((entry) => entry.file);
    return phases("optin-", candidates.filter((file) => isOptIn(file, tiers)), { excludeOptIn: false });
  }

  if (tier === "core") return core(restrictTo);
  if (tier === "extended") return extended(restrictTo);
  if (tier === "thorough") return thorough(restrictTo);
  if (tier === "quick") return core(restrictTo ?? []);
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

/**
 * Basenames that say what a file does, not what it's about, so a test whose name contains one
 * isn't related to a given file of that name: the name rule skips them (the import and directory
 * rules still apply). Measured against the 4,548 test files in the tree on 2026-11-22, a change to
 * a file of each name selected by name alone: run 586, server 75, test 71, config 71, cli 67 (it's
 * in "client"), app 63, api 37, setup 29, client 27, index 16, schema 16, main 8, types 5,
 * utils/util 5, constants and helpers 0 (on the list so they never start to).
 */
export const genericNames = new Set([
  "api", "app", "cli", "client", "config", "constants", "helpers", "index", "main", "run", "schema",
  "server", "setup", "test", "types", "util", "utils",
]);

function withoutExtension(file) {
  return file.replace(/\.(?:[cm]?[jt]sx?)$/, "").replace(/\/index$/, "");
}

/**
 * quick: the test files a change touches. For each changed file:
 * - a changed test file selects itself;
 * - a changed source file selects the test files whose name contains its basename (unless the
 *   basename is one of the generic `genericNames`, such as index or test), the test files
 *   that import it (or mock it) by a relative path, and, when its directory holds at most
 *   `maxDirectoryFiles` test files (its own and its __tests__ folder's), those too.
 * And the `always` files (test-tiers.json's alwaysQuick), whenever a changed file isn't Markdown:
 * whole-app checks such as the OpenAPI route coverage, which no rule above would select.
 * Vitest's own --changed follows the server's module graph, which links nearly everything: a
 * one-line change in server/src/services/ selected ~1,370 files (results-runner.md).
 */
export function selectChangedTests(changedFiles, testFiles, readSource, { maxDirectoryFiles = quickMaxDirectoryFiles, always = [] } = {}) {
  const tests = new Set(testFiles);
  const selected = new Set();
  if (changedFiles.some((file) => !file.endsWith(".md"))) {
    for (const file of always) if (tests.has(file)) selected.add(file);
  }
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
    // Match the name without its .test.ts suffix, so a change to test.mjs doesn't select every test,
    // and not at all for a generic name such as index or test.
    if (!genericNames.has(base)) {
      for (const file of testFiles) {
        if (path.posix.basename(file).replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/, "").includes(base)) selected.add(file);
      }
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
// vitest.config.ts list and adds the JSON report the summary reads. Upstream's test-timing reporter
// is left out: it records only a project named exactly "@paperclipai/server", which no longer exists,
// and the JSON reports (--report-dir) hold the same durations.
function reporterArgs(jsonFile, vitestArgs, env) {
  const userReporter = vitestArgs.some((arg) => arg === "--reporter" || arg.startsWith("--reporter="));
  const reporters = [
    ...(userReporter ? [] : ["default"]),
    ...(env.GITHUB_ACTIONS === "true" ? ["./scripts/ci/oversized-test-files.mjs"] : []),
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

/**
 * Expected seconds per repo-relative test file: test-weights.json, then the CSV, per file (see
 * mergeExpectedSeconds). Returns `{ seconds, sourceOf, sources }`, `sources` being the base names
 * of the files that were there. Without the weights file it's the CSV alone, as before the weights
 * existed; with neither, empty (every file at weight 1).
 */
export function loadExpectedSeconds({ weightsFile = shardWeightsFile, csvFile = expectedSecondsFile } = {}) {
  const sources = [];
  if (existsSync(weightsFile)) {
    try {
      sources.push({ name: path.basename(weightsFile), seconds: parseShardWeights(readFileSync(weightsFile, "utf8")) });
    } catch (error) {
      throw new Error(`${path.relative(repoRoot, weightsFile)}: ${error.message}`);
    }
  }
  if (existsSync(csvFile)) sources.push({ name: path.basename(csvFile), seconds: parseExpectedSeconds(readFileSync(csvFile, "utf8")) });
  if (sources.length === 0) log(`warning: ${path.relative(repoRoot, csvFile)} not found: shards are balanced by file count`);
  return { ...mergeExpectedSeconds(sources), sources: sources.map((source) => source.name) };
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

export function checkTiers(tiers, inventory) {
  const byFile = new Map(inventory.map((entry) => [entry.file, entry.project]));
  const problems = tiers.serialServer
    .filter((file) => !serverProjectPattern.test(byFile.get(file) ?? ""))
    .map((file) => `serialServer path is not a server test file: ${file}`);
  for (const { file } of tiers.alwaysQuick ?? []) {
    if (!byFile.has(file)) problems.push(`alwaysQuick path is not a test file: ${file}`);
    else if (isOptIn(file, tiers)) problems.push(`alwaysQuick path is opt-in, so quick would never run it: ${file}`);
  }
  const extendedSeen = new Set();
  for (const file of tiers.extended ?? []) {
    if (extendedSeen.has(file)) problems.push(`extended path is listed twice: ${file}`);
    extendedSeen.add(file);
    if (!byFile.has(file)) problems.push(`extended path is not a test file (moved or deleted? take it off the list): ${file}`);
    else if (isOptIn(file, tiers)) problems.push(`extended path is also opt-in: ${file}`);
  }
  for (const { file } of tiers.alwaysQuick ?? []) {
    if (isExtended(file, tiers)) problems.push(`alwaysQuick path is in extended, so quick would never run it: ${file}`);
  }
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
  if (tier === "core" || tier === "quick") return new Set(pool.filter((file) => !isOptIn(file, tiers) && !isExtended(file, tiers)));
  if (tier === "extended") return new Set(pool.filter((file) => isExtended(file, tiers) && !isOptIn(file, tiers)));
  if (tier === "thorough") return new Set(pool.filter((file) => !isOptIn(file, tiers)));
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

function printSummary(label, workers, results, wallMs) {
  console.log(`\n[test] summary: ${label}, ${workers} workers, ${formatSeconds(wallMs)} in all`);
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
  let workers = options.workers;
  if (workers === null) {
    const choice = defaultWorkerCount({ cores: os.availableParallelism(), availableBytes: process.availableMemory() });
    workers = choice.workers;
    log(`workers: ${workers}, ${choice.reason}; --workers overrides`);
  } else {
    log(`workers: ${workers} (--workers)`);
  }
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
      const always = tiers.alwaysQuick.map((entry) => entry.file);
      files = selectChangedTests(changed, testFiles, (file) => readFileSync(path.join(repoRoot, file), "utf8"), { always }).files
        .filter((file) => files === null || files.includes(file));
      const left = files.filter((file) => isExtended(file, tiers) || isOptIn(file, tiers));
      log(`quick: ${changed.length} files changed since ${options.changed}, ${files.length} test files selected`
        + (left.length > 0 ? `, ${left.length} of them extended or opt-in and not run (test:extended and test:optin run them)` : ""));
    }
    if (files !== null) {
      const known = new Set(inventory.map((entry) => entry.file));
      for (const file of files.filter((item) => !known.has(item))) log(`warning: not a test file in any project: ${file}`);
      // Left out of the plan: as a Vitest filter it could only match nothing or other files.
      files = files.filter((item) => known.has(item));
    }

    const planOptions = { root: repoRoot, workers, inventory, files, sharedDatabase };
    let phases;
    let expected = expectedFiles(options.tier, tiers, inventory, files);
    const { shard } = options;
    if (shard) {
      const { seconds, sourceOf, sources } = loadExpectedSeconds();
      const shards = buildShards(options.tier, tiers, { ...planOptions, shardCount: shard.count, expectedSeconds: (file) => seconds.get(file) });
      const problems = shardCoverageProblems(shards, new Set([...expected].map((file) => path.posix.join(repoRoot, file))));
      if (problems.length > 0) {
        console.error(`[test] the shards don't cover the tier's files exactly:\n  ${problems.join("\n  ")}`);
        return 1;
      }
      log(`coverage: the ${shard.count} shards hold every one of ${expected.size} test files exactly once`);
      const weightOf = shardWeights(shards.flat().flatMap((phase) => phase.files), repoRoot, (file) => seconds.get(file));
      const sourcePaths = [shardWeightsFile, expectedSecondsFile].filter((file) => sources.includes(path.basename(file)))
        .map((file) => path.relative(repoRoot, file));
      log(`shards, balanced by expected seconds (${sourcePaths.length > 0 ? sourcePaths.join(", then ") : path.relative(repoRoot, expectedSecondsFile)}, unknown files at the median):`);
      shards.forEach((plan, index) => {
        const planFiles = plan.flatMap((phase) => phase.files);
        const recorded = planFiles.map((file) => sourceOf.get(toRepoPath(file))).filter(Boolean);
        // With more than one source, how many of the recorded files each one gave.
        const bySource = sources.length > 1
          ? `: ${sources.map((name) => `${recorded.filter((source) => source === name).length} ${name}`).join(", ")}` : "";
        const minutes = planFiles.reduce((sum, file) => sum + weightOf(file), 0) / 60;
        console.log(`  ${pad(`shard ${index + 1}/${shard.count}`, 12, true)}${pad(planFiles.length, 6)} files  `
          + `${pad(minutes.toFixed(1), 6)} expected worker-minutes (${recorded.length} files recorded${bySource})  `
          + plan.map((phase) => `${phase.name} ${phase.files.length}`).join(", "));
      });
      phases = shards[shard.index - 1];
      expected = new Set(phases.flatMap((phase) => phase.files).map(toRepoPath));
    } else {
      phases = buildPlan(options.tier, tiers, planOptions);
    }
    if (phases.length === 0) {
      log(`tier ${options.tier}${shard ? `, shard ${shard.index}/${shard.count}` : ""}: no test files to run`);
      return 0;
    }
    const listing = listPhases(phases, expected, phaseEnv(runRoot), runRoot);
    const label = `tier ${options.tier}${shard ? `, shard ${shard.index}/${shard.count}` : ""}`;
    log(`${label}, ${workers} workers:`);
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
    log(shard ? `coverage: shard ${shard.index}/${shard.count}'s ${expected.size} files are exactly what its phases list`
      : `coverage: every one of ${expected.size} test files is in exactly one phase`);
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
      if (options.reportDir && existsSync(jsonFile)) {
        const dir = path.resolve(options.reportDir);
        mkdirSync(dir, { recursive: true });
        copyFileSync(jsonFile, path.join(dir, `${shard ? `shard-${shard.index}-of-${shard.count}-` : ""}${phase.name}.json`));
      }
      return { exitCode, plannedFiles: planned.get(phase.name), ...readReport(jsonFile) };
    }, { signal: controller.signal });
    printSummary(label, workers, results, performance.now() - started);
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
