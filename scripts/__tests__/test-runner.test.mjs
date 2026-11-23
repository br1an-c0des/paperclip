import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assignShards,
  buildPlan,
  buildShards,
  checkTiers,
  defaultWorkerCount,
  exitCodeFor,
  loadExpectedSeconds,
  loadTiers,
  maxDefaultWorkers,
  mergeExpectedSeconds,
  parseArgs,
  parseExtendedList,
  parseExpectedSeconds,
  parseShardWeights,
  removeRunRoot,
  runPhases,
  genericNames,
  selectChangedTests,
  shardCoverageProblems,
} from "../test.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const root = "/repo";
const abs = (file) => `${root}/${file}`;

const inventory = [
  { file: "server/src/__tests__/a.test.ts", project: "@paperclipai/server" },
  { file: "server/src/__tests__/b-routes.test.ts", project: "@paperclipai/server" },
  { file: "server/src/services/native-runtime/n.test.ts", project: "@paperclipai/server" },
  { file: "server/src/services/c.test.ts", project: "@paperclipai/server-isolated" },
  { file: "packages/db/src/d.test.ts", project: "@paperclipai/db" },
  { file: "packages/adapters/codex-local/src/e.test.ts", project: "@paperclipai/adapter-codex-local" },
  { file: "cli/src/f.test.ts", project: "paperclipai" },
];

const tiers = {
  serialServer: ["server/src/__tests__/b-routes.test.ts"],
  optIn: [
    { glob: "server/src/services/native-runtime/**", reason: "dormant" },
    { glob: "packages/adapters/codex-local/**", reason: "dormant adapter" },
  ],
};

const emptyTiers = { serialServer: [], optIn: [] };

function plan(tier, overrides = {}) {
  return buildPlan(tier, overrides.tiers ?? tiers, { root, workers: 6, inventory, ...overrides });
}

function excludes(args) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--exclude") values.push(args[i + 1]);
  }
  return values;
}

test("thorough: parallel server, then serial server, then one run for every other project", () => {
  const phases = plan("thorough");
  assert.deepEqual(phases.map((phase) => phase.name), ["server", "server-serial", "packages"]);

  const [server, serial, packages] = phases;
  assert.ok(server.args.includes("--fileParallelism"));
  assert.ok(server.args.includes("--maxWorkers=6"));
  assert.deepEqual(server.args.slice(0, 2), ["--project", "@paperclipai/server*"]);
  assert.equal(server.files, null);
  // Every serialServer path and every optIn glob is excluded, as absolute paths.
  for (const excluded of [abs("server/src/__tests__/b-routes.test.ts"),
    abs("server/src/services/native-runtime/**"), abs("packages/adapters/codex-local/**")]) {
    assert.ok(excludes(server.args).includes(excluded), `server phase excludes ${excluded}`);
  }
  assert.ok(excludes(server.args).includes("**/dist/**"));

  assert.ok(serial.args.includes("--maxWorkers=1"));
  assert.ok(serial.args.includes("--no-file-parallelism"));
  assert.ok(!serial.args.includes("--fileParallelism"));
  assert.deepEqual(serial.args.slice(0, 2), ["--project", "@paperclipai/server*"]);
  assert.deepEqual(serial.files, [abs("server/src/__tests__/b-routes.test.ts")]);

  // A single vitest run: one negated project filter, not one --project per package.
  assert.equal(packages.args.filter((arg) => arg === "--project").length, 1);
  assert.deepEqual(packages.args.slice(0, 2), ["--project", "!@paperclipai/server*"]);
  assert.ok(packages.args.includes("--maxWorkers=6"));
  assert.ok(excludes(packages.args).includes("**/dist/**"));
  assert.ok(excludes(packages.args).includes(abs("packages/adapters/codex-local/**")));
  assert.equal(packages.files, null);
});

test("thorough without serial files has no serial phase", () => {
  const phases = plan("thorough", { tiers: emptyTiers });
  assert.deepEqual(phases.map((phase) => phase.name), ["server", "packages"]);
  assert.deepEqual(excludes(phases[0].args), ["**/dist/**"]);
});

test("buildPlan falls back to maxDefaultWorkers when given no worker count", () => {
  const [server] = buildPlan("thorough", emptyTiers, { root, inventory });
  assert.ok(server.args.includes(`--maxWorkers=${maxDefaultWorkers}`));
});

test("every phase passes --fsModuleCache, which package configs don't inherit from the root", () => {
  for (const tier of ["thorough", "optin", "all"]) {
    for (const phase of plan(tier)) assert.ok(phase.args.includes("--fsModuleCache"), `${tier} ${phase.name}`);
  }
});

const GB = 1024 ** 3;

test("defaultWorkerCount: the smallest of the cap, half the cores and free memory per worker", () => {
  const perWorkerBytes = 1.5 * GB;
  // This desktop: 16 cores, ~17 GB free: the cap.
  const desktop = defaultWorkerCount({ cores: 16, availableBytes: 17 * GB, perWorkerBytes });
  assert.equal(desktop.workers, 8);
  assert.equal(desktop.limitedBy, "cap");
  // server1: 20 cores, memory shared with the real instance: memory.
  const server1 = defaultWorkerCount({ cores: 20, availableBytes: 6.5 * GB, perWorkerBytes });
  assert.equal(server1.workers, 4);
  assert.equal(server1.limitedBy, "memory");
  // GitHub's standard runner: 4 cores, 16 GB: cores.
  const github = defaultWorkerCount({ cores: 4, availableBytes: 14.5 * GB, perWorkerBytes });
  assert.equal(github.workers, 2);
  assert.equal(github.limitedBy, "cores");
  // Never below one.
  assert.equal(defaultWorkerCount({ cores: 1, availableBytes: 0.2 * GB, perWorkerBytes }).workers, 1);
  // The reason names every term.
  assert.match(server1.reason, /20 cores/);
  assert.match(server1.reason, /6\.5 GB free/);
  assert.match(server1.reason, /1\.5 GB per worker/);
});

test("parseExpectedSeconds: local_s, else ci_s, from the classification CSV with quoted fields", () => {
  const csv = [
    "file,project,area,label,proposed_tier,reason,postgres,lines,ci_s,local_s",
    "a.test.ts,p,x,shared,thorough,plain,no,10,12.5,30.1",
    'b.test.ts,p,x,shared,thorough,"has, commas and ""quotes""",yes,10,7,',
    "c.test.ts,p,x,shared,thorough,none,no,10,,",
  ].join("\n");
  const seconds = parseExpectedSeconds(csv);
  assert.equal(seconds.get("a.test.ts"), 30.1);
  assert.equal(seconds.get("b.test.ts"), 7);
  assert.equal(seconds.has("c.test.ts"), false);
});

test("parseShardWeights reads test-weights.json's seconds and refuses a malformed file", () => {
  const seconds = parseShardWeights(JSON.stringify({
    source: [{ run: 1, commit: "abc", date: "2026-11-21T00:00:00Z" }],
    seconds: { "a.test.ts": 12.5, "b.test.ts": 0 },
  }));
  assert.deepEqual([...seconds], [["a.test.ts", 12.5], ["b.test.ts", 0]]);
  assert.throws(() => parseShardWeights("{}"), /seconds/);
  assert.throws(() => parseShardWeights(JSON.stringify({ seconds: { "a.test.ts": "slow" } })), /a\.test\.ts/);
  assert.throws(() => parseShardWeights(JSON.stringify({ seconds: { "a.test.ts": -1 } })), /a\.test\.ts/);
});

test("mergeExpectedSeconds: per file, the first source that has it wins", () => {
  const { seconds, sourceOf } = mergeExpectedSeconds([
    { name: "weights", seconds: new Map([["a.test.ts", 40], ["b.test.ts", 0]]) },
    { name: "csv", seconds: new Map([["a.test.ts", 5], ["b.test.ts", 9], ["c.test.ts", 7]]) },
  ]);
  assert.deepEqual(Object.fromEntries(seconds), { "a.test.ts": 40, "b.test.ts": 0, "c.test.ts": 7 });
  assert.deepEqual(Object.fromEntries(sourceOf), { "a.test.ts": "weights", "b.test.ts": "weights", "c.test.ts": "csv" });
});

function writeWeightSources(dir, { weights, csv }) {
  const weightsFile = path.join(dir, "test-weights.json");
  const csvFile = path.join(dir, "classification.csv");
  if (weights) writeFileSync(weightsFile, JSON.stringify({ source: [], seconds: weights }));
  if (csv) writeFileSync(csvFile, ["file,ci_s,local_s", ...Object.entries(csv).map(([file, s]) => `${file},,${s}`)].join("\n"));
  return { weightsFile, csvFile };
}

test("loadExpectedSeconds: test-weights.json wins over the CSV per file; without it, the CSV alone", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-runner-weights-"));
  const csv = { "server/src/__tests__/a.test.ts": 5, "packages/db/src/d.test.ts": 3 };
  const both = loadExpectedSeconds(writeWeightSources(dir, { weights: { "server/src/__tests__/a.test.ts": 80 }, csv }));
  assert.equal(both.seconds.get("server/src/__tests__/a.test.ts"), 80);
  assert.equal(both.seconds.get("packages/db/src/d.test.ts"), 3);
  assert.deepEqual(both.sources, ["test-weights.json", "classification.csv"]);
  assert.equal(both.sourceOf.get("server/src/__tests__/a.test.ts"), "test-weights.json");

  const empty = mkdtempSync(path.join(os.tmpdir(), "test-runner-weights-"));
  const csvOnly = loadExpectedSeconds(writeWeightSources(empty, { csv }));
  assert.deepEqual(Object.fromEntries(csvOnly.seconds), csv);
  assert.deepEqual(csvOnly.sources, ["classification.csv"]);

  const none = loadExpectedSeconds(writeWeightSources(mkdtempSync(path.join(os.tmpdir(), "test-runner-weights-")), {}));
  assert.equal(none.seconds.size, 0);
  assert.deepEqual(none.sources, []);
});

test("without test-weights.json the shards are exactly what the CSV alone gives", () => {
  const csv = { "server/src/__tests__/a.test.ts": 100, "server/src/services/c.test.ts": 1, "packages/db/src/d.test.ts": 3 };
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-runner-weights-"));
  const { seconds } = loadExpectedSeconds(writeWeightSources(dir, { csv }));
  const options = { root, workers: 2, inventory, shardCount: 2 };
  assert.deepEqual(buildShards("thorough", emptyTiers, { ...options, expectedSeconds: (file) => seconds.get(file) }),
    buildShards("thorough", emptyTiers, { ...options, expectedSeconds: (file) => csv[file] }));
});

test("--shard with CI weights: the weights move a file the CSV calls light; unknown files at the median; same split every time", () => {
  const csv = { "server/src/__tests__/a.test.ts": 100, "server/src/__tests__/b-routes.test.ts": 1, "server/src/services/c.test.ts": 1 };
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-runner-weights-"));
  // CI says b-routes is the slow one and a is quick; c keeps the CSV's 1 s; n, d, e and f have neither (median).
  const weights = { "server/src/__tests__/a.test.ts": 2, "server/src/__tests__/b-routes.test.ts": 90 };
  const sources = writeWeightSources(dir, { weights, csv });
  const split = () => {
    const { seconds } = loadExpectedSeconds(sources);
    return buildShards("thorough", emptyTiers, { root, workers: 2, inventory, shardCount: 2, expectedSeconds: (file) => seconds.get(file) });
  };
  const shards = split();
  const serverOf = (shard) => shard.find((item) => item.name === "server")?.files ?? [];
  const heavy = shards.find((shard) => serverOf(shard).includes(abs("server/src/__tests__/b-routes.test.ts")));
  assert.deepEqual(serverOf(heavy), [abs("server/src/__tests__/b-routes.test.ts")]);
  // The median of the known weights (1, 2, 90) is 2: the three packages files count 2 s each and split 2 and 1.
  const packagesOf = (shard) => shard.find((item) => item.name === "packages")?.files ?? [];
  assert.deepEqual(shards.map((shard) => packagesOf(shard).length).sort(), [1, 2]);
  assert.deepEqual(split(), shards);
});

function phase(name, files, args = ["--maxWorkers=4"]) {
  return { name, args, files };
}

function shardFiles(shard) {
  return shard.flatMap((item) => item.files);
}

test("assignShards: every file in exactly one shard, balanced by expected time", () => {
  const weights = { a: 100, b: 60, c: 50, d: 40, e: 10, f: 10, g: 10, h: 5 };
  const phases = [phase("server", ["a", "b", "c", "d", "e", "f"]), phase("packages", ["g", "h"])];
  const shards = assignShards(phases, 3, (file) => weights[file]);
  assert.equal(shards.length, 3);
  const all = shards.flatMap(shardFiles).sort();
  assert.deepEqual(all, ["a", "b", "c", "d", "e", "f", "g", "h"]);
  // Longest first onto the least loaded shard: {a}, {b, e, f}, {c, d} in the server phase.
  const load = (shard) => shardFiles(shard).reduce((sum, file) => sum + weights[file], 0);
  const loads = shards.map(load);
  assert.ok(Math.max(...loads) - Math.min(...loads) <= 20, `loads ${loads}`);
  // Each shard keeps the phase's name and args; a shard with no files in a phase leaves it out.
  for (const shard of shards) {
    for (const item of shard) assert.deepEqual(item.args, ["--maxWorkers=4"]);
    assert.ok(shard.every((item) => item.files.length > 0));
  }
});

test("assignShards is deterministic and ignores the order files come in", () => {
  const weights = new Map(Array.from({ length: 40 }, (_, i) => [`f${i}`, (i * 37) % 11 + 1]));
  const files = [...weights.keys()];
  const one = assignShards([phase("server", files)], 4, (file) => weights.get(file));
  const two = assignShards([phase("server", [...files].reverse())], 4, (file) => weights.get(file));
  assert.deepEqual(one, two);
});

test("assignShards: more shards than files leaves some shards empty", () => {
  const shards = assignShards([phase("server", ["a", "b"])], 3, () => 1);
  assert.deepEqual(shards.map((shard) => shardFiles(shard)), [["a"], ["b"], []]);
});

test("assignShards needs explicit file lists", () => {
  assert.throws(() => assignShards([phase("server", null)], 2, () => 1), /explicit file list/);
});

test("--shard splits the thorough tier's files: each shard runs its slice of every phase", () => {
  const options = { tiers: emptyTiers, expectedSeconds: () => 1 };
  const shards = buildShards("thorough", emptyTiers, { root, workers: 6, inventory, shardCount: 2, ...options });
  assert.equal(shards.length, 2);
  const everyFile = shards.flatMap((shard) => shard.flatMap((item) => item.files)).sort();
  assert.deepEqual(everyFile, inventory.map((entry) => abs(entry.file)).sort());
  for (const shard of shards) {
    for (const item of shard) assert.ok(Array.isArray(item.files) && item.files.length > 0);
    assert.ok(shard.every((item) => item.args.includes("--maxWorkers=6")));
  }
  // buildPlan with a shard returns that shard's phases.
  assert.deepEqual(plan("thorough", { ...options, shard: { index: 2, count: 2 } }), shards[1]);
  // optIn files stay out of every shard of thorough.
  const withOptIn = buildShards("thorough", tiers, { root, workers: 6, inventory, shardCount: 3, expectedSeconds: () => 1 });
  const sharded = withOptIn.flatMap((shard) => shard.flatMap((item) => item.files));
  assert.ok(!sharded.includes(abs("server/src/services/native-runtime/n.test.ts")));
  assert.ok(!sharded.includes(abs("packages/adapters/codex-local/src/e.test.ts")));
  assert.equal(sharded.length, inventory.length - 2);
});

test("--shard weighs files by expected seconds, with unknown files at the median", () => {
  const known = { "server/src/__tests__/a.test.ts": 100, "server/src/services/c.test.ts": 1, "packages/db/src/d.test.ts": 3 };
  const shards = buildShards("thorough", emptyTiers, {
    root, workers: 2, inventory, shardCount: 2, expectedSeconds: (file) => known[file],
  });
  // The 100 s file is alone in its shard's server phase; the rest (1 s, and three at the median 3 s) go to the other.
  const serverOf = (shard) => shard.find((item) => item.name === "server")?.files ?? [];
  const heavy = shards.find((shard) => serverOf(shard).includes(abs("server/src/__tests__/a.test.ts")));
  assert.deepEqual(serverOf(heavy), [abs("server/src/__tests__/a.test.ts")]);
});

test("shardCoverageProblems names files that are missing, unexpected or in more than one shard", () => {
  const shards = [[phase("server", ["/repo/a", "/repo/b"])], [phase("server", ["/repo/b"]), phase("packages", ["/repo/x"])]];
  const problems = shardCoverageProblems(shards, new Set(["/repo/a", "/repo/b", "/repo/c"]));
  assert.deepEqual(problems.sort(), [
    "in more than one shard: /repo/b (1, 2)",
    "in no shard: /repo/c",
    "not expected in this tier: /repo/x",
  ]);
  assert.deepEqual(shardCoverageProblems([[phase("server", ["/repo/a"])], []], new Set(["/repo/a"])), []);
});

test("the worker count comes from the options", () => {
  const [server, packages] = plan("thorough", { tiers: emptyTiers, workers: 3 });
  assert.ok(server.args.includes("--maxWorkers=3"));
  assert.ok(packages.args.includes("--maxWorkers=3"));
});

test("a shared test database runs the server files one at a time", () => {
  const [server] = plan("thorough", { tiers: emptyTiers, sharedDatabase: true });
  assert.ok(server.args.includes("--maxWorkers=1"));
  assert.ok(server.args.includes("--no-file-parallelism"));
  assert.ok(!server.args.includes("--fileParallelism"));
});

test("optin runs only the files matching optIn globs", () => {
  const phases = plan("optin");
  assert.deepEqual(phases.map((phase) => phase.name), ["optin-server", "optin-packages"]);
  assert.deepEqual(phases[0].files, [abs("server/src/services/native-runtime/n.test.ts")]);
  assert.deepEqual(phases[1].files, [abs("packages/adapters/codex-local/src/e.test.ts")]);
  assert.ok(phases[0].args.includes("--fileParallelism"));
});

test("optin with no globs has no phases", () => {
  assert.deepEqual(plan("optin", { tiers: emptyTiers }), []);
});

test("an opt-in file that is also serial runs in the opt-in serial phase", () => {
  const phases = plan("optin", {
    tiers: { ...tiers, serialServer: ["server/src/services/native-runtime/n.test.ts"] },
  });
  assert.deepEqual(phases.map((phase) => phase.name), ["optin-server-serial", "optin-packages"]);
  assert.deepEqual(phases[0].files, [abs("server/src/services/native-runtime/n.test.ts")]);
});

test("all is thorough followed by optin", () => {
  const names = plan("all").map((phase) => phase.name);
  assert.deepEqual(names, ["server", "server-serial", "packages", "optin-server", "optin-packages"]);
});

test("--files restricts every phase to the listed files and drops empty phases", () => {
  const files = [
    "server/src/__tests__/a.test.ts",
    "server/src/__tests__/b-routes.test.ts",
    "server/src/services/c.test.ts",
  ];
  const phases = plan("thorough", { files });
  assert.deepEqual(phases.map((phase) => phase.name), ["server", "server-serial"]);
  assert.deepEqual(phases[0].files, [abs("server/src/__tests__/a.test.ts"), abs("server/src/services/c.test.ts")]);
  assert.deepEqual(phases[1].files, [abs("server/src/__tests__/b-routes.test.ts")]);

  const packagesOnly = plan("thorough", { files: ["packages/db/src/d.test.ts"] });
  assert.deepEqual(packagesOnly.map((phase) => phase.name), ["packages"]);
  assert.deepEqual(packagesOnly[0].files, [abs("packages/db/src/d.test.ts")]);
});

test("--files keeps opt-in files out of thorough and restricts optin", () => {
  const files = ["server/src/services/native-runtime/n.test.ts", "server/src/__tests__/a.test.ts"];
  assert.deepEqual(plan("thorough", { files }).map((phase) => phase.files), [[abs("server/src/__tests__/a.test.ts")]]);
  assert.deepEqual(plan("optin", { files }).map((phase) => phase.files), [[abs("server/src/services/native-runtime/n.test.ts")]]);
});

test("quick is thorough restricted to the selected files", () => {
  const phases = plan("quick", { files: ["server/src/__tests__/a.test.ts", "packages/db/src/d.test.ts"] });
  assert.deepEqual(phases.map((phase) => phase.name), ["server", "packages"]);
  assert.deepEqual(plan("quick", { files: [] }), []);
});

// Extended: a listed file per tier. a.test.ts and d.test.ts stay core; c.test.ts (isolated project)
// and b-routes (serial) are extended.
const withExtended = {
  ...tiers,
  extended: ["server/src/services/c.test.ts", "server/src/__tests__/b-routes.test.ts", "cli/src/f.test.ts"],
};

test("core leaves out opt-in and extended files, and lists its files when it has the inventory", () => {
  const phases = plan("core", { tiers: withExtended });
  assert.deepEqual(phases.map((phase) => phase.name), ["server", "packages"]);
  assert.deepEqual(phases[0].files, [abs("server/src/__tests__/a.test.ts")]);
  assert.deepEqual(phases[1].files, [abs("packages/db/src/d.test.ts")]);
  assert.ok(phases[0].args.includes("--fileParallelism"));
});

test("core without an inventory excludes the extended files in its args", () => {
  const phases = buildPlan("core", withExtended, { root, workers: 6 });
  assert.deepEqual(phases.map((phase) => phase.name), ["server", "packages"]);
  assert.equal(phases[0].files, null);
  for (const file of withExtended.extended) assert.ok(excludes(phases[0].args).includes(abs(file)), file);
  assert.ok(excludes(phases[1].args).includes(abs("cli/src/f.test.ts")));
});

test("core with no extended list is thorough with explicit files", () => {
  const core = plan("core").map((phase) => [phase.name, phase.files]);
  assert.deepEqual(core, [
    ["server", [abs("server/src/__tests__/a.test.ts"), abs("server/src/services/c.test.ts")]],
    ["server-serial", [abs("server/src/__tests__/b-routes.test.ts")]],
    ["packages", [abs("packages/db/src/d.test.ts"), abs("cli/src/f.test.ts")]],
  ]);
});

test("extended runs only its listed files, serial ones in its serial phase", () => {
  const phases = plan("extended", { tiers: withExtended });
  assert.deepEqual(phases.map((phase) => [phase.name, phase.files]), [
    ["extended-server", [abs("server/src/services/c.test.ts")]],
    ["extended-server-serial", [abs("server/src/__tests__/b-routes.test.ts")]],
    ["extended-packages", [abs("cli/src/f.test.ts")]],
  ]);
  assert.deepEqual(plan("extended"), []);
  assert.deepEqual(plan("extended", { tiers: withExtended, files: ["server/src/__tests__/a.test.ts"] }), []);
});

test("thorough is core and extended together; quick restricts core and never runs extended", () => {
  const all = (tier, extra = {}) => plan(tier, { tiers: withExtended, ...extra }).flatMap((phase) => phase.files ?? []);
  const thoroughFiles = plan("thorough", { tiers: withExtended, files: inventory.map((entry) => entry.file) })
    .flatMap((phase) => phase.files);
  assert.deepEqual(new Set(thoroughFiles), new Set([...all("core"), ...all("extended")]));
  const quick = plan("quick", { tiers: withExtended, files: ["server/src/__tests__/a.test.ts", "server/src/services/c.test.ts"] });
  assert.deepEqual(quick.map((phase) => phase.files), [[abs("server/src/__tests__/a.test.ts")]]);
});

test("parseExtendedList skips blank lines and comments", () => {
  assert.deepEqual(parseExtendedList("# header\n\nserver/a.test.ts\n  packages/b.test.ts  # why\n"), ["server/a.test.ts", "packages/b.test.ts"]);
});

test("loadTiers reads extendedList relative to the tiers file, and an empty list without it", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-tiers-extended-"));
  writeFileSync(path.join(dir, "ext.txt"), "# made by hand\nserver/src/services/c.test.ts\n");
  writeFileSync(path.join(dir, "with.json"), JSON.stringify({ ...emptyTiers, extendedList: "ext.txt" }));
  writeFileSync(path.join(dir, "without.json"), JSON.stringify(emptyTiers));
  writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ ...emptyTiers, extendedList: 3 }));
  assert.deepEqual(loadTiers(path.join(dir, "with.json")).extended, ["server/src/services/c.test.ts"]);
  assert.deepEqual(loadTiers(path.join(dir, "without.json")).extended, []);
  assert.throws(() => loadTiers(path.join(dir, "bad.json")), /extendedList must be a path/);
});

test("checkTiers refuses an extended path that's missing, listed twice or opt-in, and an alwaysQuick file in extended", () => {
  assert.doesNotThrow(() => checkTiers(withExtended, inventory));
  const check = (extended, extra = {}) => () => checkTiers({ ...tiers, extended, ...extra }, inventory);
  assert.throws(check(["server/src/__tests__/gone.test.ts"]), /extended path is not a test file .*gone\.test\.ts/);
  assert.throws(check(["server/src/services/c.test.ts", "server/src/services/c.test.ts"]), /extended path is listed twice/);
  assert.throws(check(["server/src/services/native-runtime/n.test.ts"]), /extended path is also opt-in/);
  assert.throws(check(["server/src/__tests__/a.test.ts"], { alwaysQuick: [{ file: "server/src/__tests__/a.test.ts", reason: "x" }] }),
    /alwaysQuick path is in extended/);
});

test("the real extended list holds only test files that aren't opt-in", () => {
  const real = loadTiers();
  assert.ok(real.extended.length > 0);
  for (const file of real.extended) assert.match(file, /\.test\.[cm]?[jt]sx?$/, file);
});

test("an unknown tier is an error", () => {
  assert.throws(() => plan("everything"), /Unknown tier/);
});

test("runPhases runs every phase when an earlier one fails", async () => {
  const phases = [{ name: "one", args: [], files: null }, { name: "two", args: [], files: null },
    { name: "three", args: [], files: null }];
  const ran = [];
  const results = await runPhases(phases, async (phase) => {
    ran.push(phase.name);
    if (phase.name === "one") return { exitCode: 1, failedFiles: ["x.test.ts"] };
    if (phase.name === "two") throw new Error("spawn failed");
    return 0;
  });
  assert.deepEqual(ran, ["one", "two", "three"]);
  assert.deepEqual(results.map((result) => [result.phase, result.exitCode]), [["one", 1], ["two", 1], ["three", 0]]);
  assert.deepEqual(results[0].failedFiles, ["x.test.ts"]);
  assert.match(results[1].error, /spawn failed/);
  for (const result of results) assert.equal(typeof result.wallMs, "number");
  assert.equal(exitCodeFor(results), 1);
  assert.equal(exitCodeFor(results.slice(2)), 0);
});

test("runPhases starts no new phase once interrupted", async () => {
  const controller = new AbortController();
  const phases = [{ name: "one", args: [], files: null }, { name: "two", args: [], files: null }];
  const results = await runPhases(phases, async () => {
    controller.abort();
    return 0;
  }, { signal: controller.signal });
  assert.deepEqual(results.map((result) => [result.phase, result.exitCode, result.skipped ?? false]),
    [["one", 0, false], ["two", null, true]]);
  assert.equal(exitCodeFor(results), 1);
});

test("parseArgs reads tiers, workers, files, changed and passthrough args", () => {
  assert.deepEqual(parseArgs([]), {
    tier: "core", workers: null, changed: null, filesList: null, shard: null, reportDir: null, dryRun: false,
    skipPreflight: false, vitestArgs: [],
  });
  assert.deepEqual(parseArgs(["--shard", "2/8"]).shard, { index: 2, count: 8 });
  assert.deepEqual(parseArgs(["--shard=1/1"]).shard, { index: 1, count: 1 });
  for (const bad of ["0/8", "9/8", "2", "a/b", "2/0", "1.5/4"]) {
    assert.throws(() => parseArgs(["--shard", bad]), /--shard must be i\/n/, bad);
  }
  assert.equal(parseArgs(["--report-dir", "out"]).reportDir, "out");
  const parsed = parseArgs(["--tier", "quick", "--workers=4", "--files", "list.txt", "--dry-run", "--", "-t", "name"]);
  assert.equal(parsed.tier, "quick");
  assert.equal(parsed.workers, 4);
  assert.equal(parsed.changed, "main");
  assert.equal(parsed.filesList, "list.txt");
  assert.equal(parsed.dryRun, true);
  assert.deepEqual(parsed.vitestArgs, ["-t", "name"]);
  assert.equal(parseArgs(["--tier=quick", "--changed", "HEAD~1"]).changed, "HEAD~1");
  assert.throws(() => parseArgs(["--tier", "nope"]), /Unknown tier/);
  assert.throws(() => parseArgs(["--workers", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--changed", "main"]), /only with --tier quick/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
});

test("selectChangedTests: changed tests, name matches, direct importers and small directories", () => {
  const testFiles = [
    "server/src/services/run-liveness.test.ts",
    "server/src/__tests__/run-liveness-backfill.test.ts",
    "server/src/__tests__/imports-it.test.ts",
    "server/src/__tests__/mocks-it.test.ts",
    "server/src/__tests__/unrelated.test.ts",
    "server/src/services/other.test.ts",
    "server/src/services/__tests__/svc.test.ts",
    "server/src/routes/issues.test.ts",
    "server/src/routes/__tests__/routes-helper.test.ts",
  ];
  const sources = {
    "server/src/__tests__/imports-it.test.ts": 'import { x } from "../services/run-liveness.js";',
    "server/src/__tests__/mocks-it.test.ts": 'vi.mock("../services/run-liveness.js", () => ({}));',
    "server/src/__tests__/unrelated.test.ts": 'import { y } from "../services/run-liveness-backfill-query.js";',
  };
  const read = (file) => sources[file] ?? "";

  // A big directory (more than maxDirectoryFiles test files) contributes no directory files.
  const big = selectChangedTests(["server/src/services/run-liveness.ts"], testFiles, read, { maxDirectoryFiles: 2 });
  assert.deepEqual(big.files, [
    "server/src/__tests__/imports-it.test.ts",
    "server/src/__tests__/mocks-it.test.ts",
    "server/src/__tests__/run-liveness-backfill.test.ts",
    "server/src/services/run-liveness.test.ts",
  ]);

  // A small directory adds its own test files and its __tests__ folder.
  const small = selectChangedTests(["server/src/routes/issues.ts"], testFiles, read, { maxDirectoryFiles: 2 });
  assert.deepEqual(small.files, ["server/src/routes/__tests__/routes-helper.test.ts", "server/src/routes/issues.test.ts"]);

  // A changed test file selects itself; files that aren't tests or sources select nothing.
  const changedTest = selectChangedTests(["server/src/services/other.test.ts", "README.md"], testFiles, read);
  assert.deepEqual(changedTest.files, ["server/src/services/other.test.ts"]);

  // The .test.ts suffix isn't part of the name: a change to scripts/test.mjs selects nothing here.
  assert.deepEqual(selectChangedTests(["scripts/test.mjs"], testFiles, read).files, []);
});

test("selectChangedTests: a generic basename (test, index, config…) doesn't select by name", () => {
  const testFiles = [
    "packages/db/src/test-postgres-admin.test.ts",
    "packages/db/src/test-postgres-owner.test.ts",
    "packages/db/src/test-embedded-postgres.test.ts",
    "packages/adapters/claude-local/src/server/test.probe.test.ts",
    "bar/index-cache.test.ts",
    "bar/config-store.test.ts",
    "foo/__tests__/foo.test.ts",
    "baz/imports-foo.test.ts",
  ];
  const sources = { "baz/imports-foo.test.ts": 'import { foo } from "../foo";' };
  const read = (file) => sources[file] ?? "";
  for (const name of ["test", "index", "types", "utils", "config", "schema", "server", "client", "api", "run"]) {
    assert.ok(genericNames.has(name), `${name} should be generic`);
  }

  // scripts/test.mjs: basename "test", which every test-postgres-* file contains.
  assert.deepEqual(selectChangedTests(["scripts/test.mjs"], testFiles, read).files, []);

  // foo/index.ts: not bar/index-cache by name, but still its importer and its small directory.
  assert.deepEqual(selectChangedTests(["foo/index.ts"], testFiles, read).files, ["baz/imports-foo.test.ts", "foo/__tests__/foo.test.ts"]);

  // An adapter's server/test.ts still selects the tests beside it, by the directory rule.
  assert.deepEqual(selectChangedTests(["packages/adapters/claude-local/src/server/test.ts"], testFiles, read).files,
    ["packages/adapters/claude-local/src/server/test.probe.test.ts"]);
  // Without that rule (a big directory), nothing.
  assert.deepEqual(selectChangedTests(["packages/adapters/claude-local/src/server/test.ts"], testFiles, read, { maxDirectoryFiles: 0 }).files, []);

  // A specific name that contains a generic one still matches.
  assert.deepEqual(selectChangedTests(["lib/config-store.ts"], testFiles, read).files, ["bar/config-store.test.ts"]);
});

test("selectChangedTests: the always files join any change that isn't only Markdown", () => {
  const testFiles = [
    "server/src/routes/issues.test.ts",
    "server/src/__tests__/openapi-routes.test.ts",
    "server/src/__tests__/golden.test.ts",
  ];
  const always = ["server/src/__tests__/openapi-routes.test.ts", "server/src/__tests__/golden.test.ts"];
  const read = () => "";

  // A source change far from the always files still brings them in.
  assert.deepEqual(selectChangedTests(["packages/shared/src/types/project.ts"], testFiles, read, { always }).files, [
    "server/src/__tests__/golden.test.ts",
    "server/src/__tests__/openapi-routes.test.ts",
  ]);

  // So does a change to a file that is neither a source nor Markdown, such as a migration.
  assert.deepEqual(
    selectChangedTests(["packages/db/src/migrations/0493_x.sql"], testFiles, read, { always }).files,
    ["server/src/__tests__/golden.test.ts", "server/src/__tests__/openapi-routes.test.ts"],
  );

  // A change to Markdown only, or no change at all, runs nothing.
  assert.deepEqual(selectChangedTests(["fork/green-push.md", "README.md"], testFiles, read, { always }).files, []);
  assert.deepEqual(selectChangedTests([], testFiles, read, { always }).files, []);
});

test("loadTiers reads alwaysQuick, which may be left out, and wants a reason for each file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-tiers-"));
  const write = (name, value) => {
    const file = path.join(dir, name);
    writeFileSync(file, JSON.stringify(value));
    return file;
  };

  assert.deepEqual(loadTiers(write("none.json", emptyTiers)).alwaysQuick, []);
  const entry = { file: "server/src/__tests__/a.test.ts", reason: "checks every route" };
  assert.deepEqual(loadTiers(write("one.json", { ...emptyTiers, alwaysQuick: [entry] })).alwaysQuick, [entry]);
  assert.throws(
    () => loadTiers(write("bad.json", { ...emptyTiers, alwaysQuick: [{ file: "server/src/__tests__/a.test.ts" }] })),
    /alwaysQuick must be an array of \{ file, reason \}/,
  );
});

test("checkTiers refuses an alwaysQuick file that isn't a test file, or that is opt-in", () => {
  const withAlways = (file) => ({ ...tiers, alwaysQuick: [{ file, reason: "whole-app check" }] });
  assert.doesNotThrow(() => checkTiers(withAlways("server/src/__tests__/a.test.ts"), inventory));
  assert.throws(() => checkTiers(withAlways("server/src/__tests__/gone.test.ts"), inventory),
    /alwaysQuick path is not a test file: server\/src\/__tests__\/gone\.test\.ts/);
  assert.throws(() => checkTiers(withAlways("server/src/services/native-runtime/n.test.ts"), inventory),
    /alwaysQuick path is opt-in, so quick would never run it: server\/src\/services\/native-runtime\/n\.test\.ts/);
});

test("--dry-run lists the thorough phases with file counts and checks coverage", () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "test.mjs"), "--dry-run", "--tier", "thorough"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /server\s+\d+ files/);
  assert.match(result.stdout, /packages\s+\d+ files/);
  assert.match(result.stdout, /coverage: every one of \d+ test files is in exactly one phase/);
});

test("--dry-run covers core and extended, which share no file", () => {
  const run = (tier) => spawnSync(process.execPath, [path.join(repoRoot, "scripts", "test.mjs"), "--dry-run", "--tier", tier, "--workers", "2"], {
    cwd: repoRoot, encoding: "utf8",
  });
  const counts = {};
  for (const tier of ["core", "extended", "thorough"]) {
    const result = run(tier);
    assert.equal(result.status, 0, `${tier}: ${result.stderr}${result.stdout}`);
    counts[tier] = Number(/coverage: every one of (\d+) test files is in exactly one phase/.exec(result.stdout)?.[1]);
  }
  assert.ok(counts.core > 0 && counts.extended > 0, JSON.stringify(counts));
  assert.equal(counts.core + counts.extended, counts.thorough, JSON.stringify(counts));
});

test("--dry-run --shard lists one shard's phases, every shard's size, and checks the shards cover the tier", () => {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "test.mjs"), "--dry-run", "--tier", "thorough",
    "--shard", "2/3", "--workers", "2"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /tier thorough, shard 2\/3, 2 workers/);
  assert.match(result.stdout, /workers: 2 \(--workers\)/);
  for (const index of [1, 2, 3]) assert.match(result.stdout, new RegExp(`shard ${index}/3\\s+\\d+ files`));
  assert.match(result.stdout, /coverage: the 3 shards hold every one of \d+ test files exactly once/);
  assert.match(result.stdout, /coverage: shard 2\/3's \d+ files are exactly what its phases list/);
});

test("--files with a path that isn't a test file warns and leaves it out, sharded or not", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-runner-files-"));
  const list = path.join(dir, "files.txt");
  writeFileSync(list, "scripts/__tests__/not-a-vitest-file.test.ts\npackages/shared/src/app-definitions-url.test.ts\n");
  for (const extra of [[], ["--shard", "1/2"]]) {
    const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "test.mjs"), "--dry-run", "--workers", "1",
      "--files", list, ...extra], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(result.status, 0, `${extra.join(" ")}: ${result.stderr}${result.stdout}`);
    assert.match(result.stdout, /warning: not a test file in any project: scripts\/__tests__\/not-a-vitest-file\.test\.ts/);
  }
});

test("removeRunRoot removes a run directory that holds read-only and unreadable directories", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "test-runner-"));
  mkdirSync(path.join(dir, "t", "bundle", "inner"), { recursive: true });
  writeFileSync(path.join(dir, "t", "bundle", "inner", "AGENTS.md"), "x");
  mkdirSync(path.join(dir, "t", "locked"));
  chmodSync(path.join(dir, "t", "bundle", "inner"), 0o555);
  chmodSync(path.join(dir, "t", "bundle"), 0o555);
  chmodSync(path.join(dir, "t", "locked"), 0o000);
  removeRunRoot(dir);
  assert.equal(existsSync(dir), false);
});
