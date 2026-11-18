import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildPlan,
  defaultWorkers,
  exitCodeFor,
  parseArgs,
  removeRunRoot,
  runPhases,
  selectChangedTests,
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

test("the worker count defaults to defaultWorkers", () => {
  const [server] = buildPlan("thorough", emptyTiers, { root, inventory });
  assert.ok(server.args.includes(`--maxWorkers=${defaultWorkers}`));
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
    tier: "thorough", workers: null, changed: null, filesList: null, dryRun: false, skipPreflight: false, vitestArgs: [],
  });
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
