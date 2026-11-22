import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  bypassRequested,
  childEnv,
  defaultLockFile,
  formatDuration,
  isMarkdown,
  lockDecision,
  parsePushLines,
  planPush,
  pushRanges,
  runChecks,
} from "../pre-push.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const zero = "0".repeat(40);
const sha = (char) => char.repeat(40);
const [A, B, C, D, M, T] = ["a", "b", "c", "d", "e", "f"].map(sha);

// A fake repository: commits A (on main) -> B -> C (HEAD), and D, a commit off to the side.
function fakeRepo(overrides = {}) {
  const known = new Set([A, B, C, D]);
  const changed = {
    [`${A} ${C}`]: ["server/src/app.ts", "README.md"],
    [`${B} ${C}`]: ["doc/notes.md"],
    [`${A} ${D}`]: ["packages/db/src/x.ts"],
    [`${C} ${C}`]: [],
  };
  return {
    head: C,
    peel: (value) => (value === T ? C : known.has(value) ? value : null),
    mergeBase: (left, right) => {
      if (left === "main" || left === "origin/main") return A;
      if (left === right) return left;
      if ([left, right].includes(D)) return A;
      return [left, right].includes(A) ? A : B;
    },
    changedFiles: (base, local) => {
      const files = changed[`${base} ${local}`];
      if (!files) throw new Error(`unexpected diff ${base} ${local}`);
      return files;
    },
    dirtyFiles: () => [],
    ...overrides,
  };
}

const update = (localRef, localSha, remoteRef, remoteSha) => ({ localRef, localSha, remoteRef, remoteSha });

test("parsePushLines reads git's pre-push lines and ignores blank ones", () => {
  const text = `refs/heads/feat ${C} refs/heads/feat ${B}\n\n(delete) ${zero} refs/heads/old ${A}\n`;
  assert.deepEqual(parsePushLines(text), [
    update("refs/heads/feat", C, "refs/heads/feat", B),
    update("(delete)", zero, "refs/heads/old", A),
  ]);
  assert.deepEqual(parsePushLines(""), []);
  assert.throws(() => parsePushLines("refs/heads/feat abc"), /pre-push line/);
});

test("pushRanges skips deletions", () => {
  assert.deepEqual(pushRanges([update("(delete)", zero, "refs/heads/old", A)], fakeRepo()), []);
});

test("pushRanges compares a new remote ref against its merge base with main", () => {
  const [range] = pushRanges([update("refs/heads/feat", C, "refs/heads/feat", zero)], fakeRepo());
  assert.deepEqual(range, { ref: "feat", local: C, base: A, baseFrom: "main" });
});

test("pushRanges falls back to origin/main when there is no local main", () => {
  const repo = fakeRepo({ mergeBase: (left) => (left === "origin/main" ? A : null) });
  const [range] = pushRanges([update("refs/heads/feat", C, "refs/heads/feat", zero)], repo);
  assert.equal(range.base, A);
  assert.equal(range.baseFrom, "origin/main");
});

test("pushRanges gives a null base when neither main nor origin/main is there", () => {
  const repo = fakeRepo({ mergeBase: () => null });
  const [range] = pushRanges([update("refs/heads/feat", C, "refs/heads/feat", zero)], repo);
  assert.equal(range.base, null);
});

test("pushRanges uses remote sha..local sha for an update of an existing ref", () => {
  const [range] = pushRanges([update("refs/heads/feat", C, "refs/heads/feat", B)], fakeRepo());
  assert.deepEqual(range, { ref: "feat", local: C, base: B, baseFrom: "remote" });
});

test("pushRanges uses the main base when the remote sha isn't in this repository", () => {
  const [range] = pushRanges([update("refs/heads/feat", C, "refs/heads/feat", sha("9"))], fakeRepo());
  assert.equal(range.base, A);
  assert.equal(range.baseFrom, "main");
});

test("pushRanges peels an annotated tag to its commit", () => {
  const [range] = pushRanges([update("refs/tags/v1", T, "refs/tags/v1", zero)], fakeRepo());
  assert.equal(range.local, C);
  assert.equal(range.ref, "v1");
});

test("isMarkdown matches .md files only", () => {
  assert.ok(isMarkdown("README.md"));
  assert.ok(isMarkdown("fork/NOTES.MD"));
  assert.ok(!isMarkdown("docs/page.mdx"));
  assert.ok(!isMarkdown("scripts/md.mjs"));
});

test("planPush: a push of Markdown only runs nothing", () => {
  const plan = planPush([update("refs/heads/feat", C, "refs/heads/feat", B)], fakeRepo(), {});
  assert.deepEqual(plan.checks, []);
  assert.match(plan.notes.join("\n"), /only Markdown/i);
  assert.deepEqual(plan.warnings, []);
});

test("planPush: a code change runs the workspace typecheck, then quick since the range's base", () => {
  const plan = planPush([update("refs/heads/feat", C, "refs/heads/feat", zero)], fakeRepo(), {});
  assert.deepEqual(plan.checks.map((check) => [check.command, ...check.args]), [
    ["corepack", "pnpm", "typecheck"],
    [process.execPath, "scripts/test.mjs", "--tier", "quick", "--changed", A],
  ]);
  assert.deepEqual(plan.warnings, []);
});

test("planPush: pushing main after a merge tests the merged range", () => {
  // main's remote is at A; the merge commit C is HEAD. The range is A..C, not "since main" (empty).
  const plan = planPush([update("refs/heads/main", C, "refs/heads/main", A)], fakeRepo(), {});
  assert.deepEqual(plan.checks.at(-1).args, ["scripts/test.mjs", "--tier", "quick", "--changed", A]);
});

test("planPush: a pushed sha that isn't HEAD is skipped with a warning", () => {
  const plan = planPush([update("refs/heads/side", D, "refs/heads/side", zero)], fakeRepo(), {});
  assert.deepEqual(plan.checks, []);
  const warning = plan.warnings.join("\n");
  assert.match(warning, /side/);
  assert.match(warning, /isn't HEAD/);
  assert.match(warning, /not checked/i);
});

test("planPush: of two refs, only the one at HEAD is checked, and the other is named", () => {
  const plan = planPush([
    update("refs/heads/feat", C, "refs/heads/feat", zero),
    update("refs/heads/side", D, "refs/heads/side", zero),
  ], fakeRepo(), {});
  assert.equal(plan.checks.length, 2);
  assert.match(plan.warnings.join("\n"), /side/);
});

test("planPush: a pushed sha that isn't HEAD but changes only Markdown needs no warning", () => {
  const repo = fakeRepo({ head: D });
  const plan = planPush([update("refs/heads/feat", C, "refs/heads/feat", B)], repo, {});
  assert.deepEqual(plan.checks, []);
  assert.deepEqual(plan.warnings, []);
});

test("planPush: uncommitted changes to tracked files are warned about, and the checks still run", () => {
  const repo = fakeRepo({ dirtyFiles: () => ["server/src/app.ts"] });
  const plan = planPush([update("refs/heads/feat", C, "refs/heads/feat", zero)], repo, {});
  assert.equal(plan.checks.length, 2);
  assert.match(plan.warnings.join("\n"), /uncommitted/);
  assert.match(plan.warnings.join("\n"), /server\/src\/app\.ts/);
});

test("planPush: with no base to compare against, it runs the typecheck only and says so", () => {
  const repo = fakeRepo({ mergeBase: () => null });
  const plan = planPush([update("refs/heads/feat", C, "refs/heads/feat", zero)], repo, {});
  assert.deepEqual(plan.checks.map((check) => check.name), ["typecheck"]);
  assert.match(plan.warnings.join("\n"), /main/);
});

test("planPush: two refs with the same base run quick once", () => {
  const plan = planPush([
    update("refs/heads/feat", C, "refs/heads/feat", zero),
    update("refs/heads/feat", C, "refs/heads/copy", zero),
  ], fakeRepo(), {});
  assert.deepEqual(plan.checks.map((check) => check.name), ["typecheck", "test:quick"]);
});

test("planPush: only deletions run nothing", () => {
  const plan = planPush([update("(delete)", zero, "refs/heads/old", A)], fakeRepo(), {});
  assert.deepEqual(plan.checks, []);
  assert.deepEqual(plan.warnings, []);
});

test("planPush: PAPERCLIP_SKIP_PREPUSH=1 skips everything without looking at the repository", () => {
  const repo = { get head() { throw new Error("should not be read"); } };
  const plan = planPush([update("refs/heads/feat", C, "refs/heads/feat", zero)], repo, { PAPERCLIP_SKIP_PREPUSH: "1" });
  assert.deepEqual(plan.checks, []);
  assert.match(plan.notes.join("\n"), /PAPERCLIP_SKIP_PREPUSH/);
});

test("bypassRequested accepts 1 and true only", () => {
  assert.ok(bypassRequested({ PAPERCLIP_SKIP_PREPUSH: "1" }));
  assert.ok(bypassRequested({ PAPERCLIP_SKIP_PREPUSH: "true" }));
  assert.ok(!bypassRequested({ PAPERCLIP_SKIP_PREPUSH: "0" }));
  assert.ok(!bypassRequested({ PAPERCLIP_SKIP_PREPUSH: "" }));
  assert.ok(!bypassRequested({}));
});

test("childEnv drops git's repository variables and keeps the rest", () => {
  const env = childEnv({ GIT_DIR: "/x/.git", GIT_INDEX_FILE: "/x/index", GIT_SSH_COMMAND: "ssh", PATH: "/bin" },
    ["GIT_DIR", "GIT_INDEX_FILE"]);
  assert.deepEqual(env, { GIT_SSH_COMMAND: "ssh", PATH: "/bin" });
});

test("planPush: a range with no file changes runs nothing", () => {
  const plan = planPush([update("refs/heads/feat", C, "refs/heads/copy", C)], fakeRepo(), {});
  assert.deepEqual(plan.checks, []);
  assert.match(plan.notes.join("\n"), /No files change/);
});

test("runChecks runs in order, stops at the first failure, and says how to bypass", async () => {
  const ran = [];
  const lines = [];
  let clock = 0;
  const checks = [{ name: "one" }, { name: "two" }, { name: "three" }];
  const exitCode = await runChecks(checks, {
    exec: (check) => {
      ran.push(check.name);
      clock += 1500;
      return check.name === "two" ? 2 : 0;
    },
    now: () => clock,
    log: (line) => lines.push(line),
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(ran, ["one", "two"]);
  const output = lines.join("\n");
  assert.match(output, /one passed in 1\.5 s/);
  assert.match(output, /two failed/);
  assert.match(output, /--no-verify/);
  assert.match(output, /PAPERCLIP_SKIP_PREPUSH=1/);
});

test("runChecks returns 0 when every check passes", async () => {
  const exitCode = await runChecks([{ name: "one" }], { exec: () => 0, now: () => 0, log: () => {} });
  assert.equal(exitCode, 0);
});

test("formatDuration shows seconds, then minutes", () => {
  assert.equal(formatDuration(1500), "1.5 s");
  assert.equal(formatDuration(65_000), "1 min 5 s");
});

test("lockDecision: the machine lock by default, the path PAPERCLIP_PREPUSH_LOCK names otherwise", () => {
  assert.equal(defaultLockFile, "/tmp/paperclip-test-bench.lock");
  assert.deepEqual(lockDecision({}, { flockAvailable: true }), { file: defaultLockFile, notes: [], warnings: [] });
  assert.deepEqual(lockDecision({ PAPERCLIP_PREPUSH_LOCK: "  " }, { flockAvailable: true }).file, defaultLockFile);
  assert.deepEqual(lockDecision({ PAPERCLIP_PREPUSH_LOCK: "/tmp/x.lock" }, { flockAvailable: true }),
    { file: "/tmp/x.lock", notes: [], warnings: [] });
});

test("lockDecision: PAPERCLIP_PREPUSH_LOCK=off runs without the lock, and says so", () => {
  for (const value of ["off", "OFF", " Off "]) {
    const decision = lockDecision({ PAPERCLIP_PREPUSH_LOCK: value }, { flockAvailable: true });
    assert.equal(decision.file, null);
    assert.match(decision.notes.join("\n"), /PAPERCLIP_PREPUSH_LOCK=off/);
    assert.deepEqual(decision.warnings, []);
  }
  // Off doesn't need flock, so there's nothing to warn about without it.
  assert.deepEqual(lockDecision({ PAPERCLIP_PREPUSH_LOCK: "off" }, { flockAvailable: false }).warnings, []);
});

test("lockDecision: without flock it warns and runs without the lock", () => {
  const decision = lockDecision({}, { flockAvailable: false });
  assert.equal(decision.file, null);
  assert.match(decision.warnings.join("\n"), /flock/);
  assert.match(decision.warnings.join("\n"), /without the machine lock/);
  assert.match(decision.warnings.join("\n"), /paperclip-test-bench\.lock/);
});

// ---------------------------------------------------------------------------------------------
// The hook in a real push: a throwaway repository and bare remote, with core.hooksPath set in that
// repository only, and the checks stubbed through PAPERCLIP_PREPUSH_CHECK_COMMAND. Each repository
// gets its own lock file: these tests may run under `flock /tmp/paperclip-test-bench.lock`, and a
// hook waiting on that lock would wait for its own test run.

function testEnv(env) {
  const base = childEnv(process.env, ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX",
    "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "PAPERCLIP_PREPUSH_LOCK", "PAPERCLIP_SKIP_PREPUSH"]);
  return { ...base, ...env };
}

function gitIn(cwd, args, env = {}) {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: testEnv({ PAPERCLIP_PREPUSH_LOCK: path.join(cwd, "..", "test.lock"), ...env }) });
}

/** git, without waiting: `done` resolves to `{ status, stderr }` when it exits; `stderr()` is so far. */
function gitAsync(cwd, args, env) {
  const child = spawn("git", args, { cwd, env: testEnv(env), stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => child.on("close", (status) => resolve({ status, stderr })));
  return { done, stderr: () => stderr };
}

async function waitFor(condition, what) {
  for (let i = 0; i < 400; i++) {
    if (condition()) return;
    await delay(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}

function makeRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pre-push-test-"));
  const work = path.join(dir, "work");
  const remote = path.join(dir, "remote.git");
  const must = (cwd, args) => {
    const result = gitIn(cwd, args);
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  };
  must(dir, ["init", "--quiet", "--bare", remote]);
  must(dir, ["init", "--quiet", "-b", "main", work]);
  must(work, ["config", "user.email", "test@example.invalid"]);
  must(work, ["config", "user.name", "Test"]);
  must(work, ["config", "core.hooksPath", path.join(repoRoot, ".githooks")]);
  must(work, ["remote", "add", "origin", remote]);
  writeFileSync(path.join(work, "app.ts"), "export const a = 1;\n");
  must(work, ["add", "."]);
  must(work, ["commit", "--quiet", "-m", "first"]);
  must(work, ["push", "--quiet", "--no-verify", "origin", "main"]);
  must(work, ["switch", "--quiet", "-c", "feat"]);
  const commit = (file, text) => {
    writeFileSync(path.join(work, file), text);
    must(work, ["add", "."]);
    must(work, ["commit", "--quiet", "-m", `change ${file}`]);
  };
  return { dir, work, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function stubCommand(dir, exitCode) {
  const log = path.join(dir, "checks.log");
  const stub = path.join(dir, "stub.sh");
  writeFileSync(stub, `#!/bin/sh\necho "$*" >> "${log}"\nexit ${exitCode}\n`);
  chmodSync(stub, 0o755);
  return { command: stub, log, ran: () => { try { return readFileSync(log, "utf8"); } catch { return ""; } } };
}

test("hook: a push of Markdown only goes through without running the checks", { timeout: 30_000 }, () => {
  const repo = makeRepo();
  try {
    const stub = stubCommand(repo.dir, 1);
    repo.commit("NOTES.md", "notes\n");
    const result = gitIn(repo.work, ["push", "origin", "feat"], { PAPERCLIP_PREPUSH_CHECK_COMMAND: stub.command });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /only Markdown/i);
    assert.equal(stub.ran(), "");
  } finally {
    repo.cleanup();
  }
});

test("hook: a push whose check fails is blocked, and the env bypass lets it through", { timeout: 30_000 }, () => {
  const repo = makeRepo();
  try {
    const stub = stubCommand(repo.dir, 1);
    repo.commit("app.ts", "export const a = 2;\n");
    const blocked = gitIn(repo.work, ["push", "origin", "feat"], { PAPERCLIP_PREPUSH_CHECK_COMMAND: stub.command });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /typecheck failed/);
    assert.match(blocked.stderr, /--no-verify/);
    // Stopped at the first failure: only the typecheck ran.
    assert.equal(stub.ran().trim().split("\n").length, 1);
    assert.match(stub.ran(), /typecheck/);
    assert.equal(gitIn(repo.work, ["ls-remote", "origin", "refs/heads/feat"]).stdout, "");

    const bypassed = gitIn(repo.work, ["push", "origin", "feat"],
      { PAPERCLIP_PREPUSH_CHECK_COMMAND: stub.command, PAPERCLIP_SKIP_PREPUSH: "1" });
    assert.equal(bypassed.status, 0, bypassed.stderr);
    assert.notEqual(gitIn(repo.work, ["ls-remote", "origin", "refs/heads/feat"]).stdout, "");
  } finally {
    repo.cleanup();
  }
});

test("hook: a passing push runs both checks, quick since the merge base with main", { timeout: 30_000 }, () => {
  const repo = makeRepo();
  try {
    const stub = stubCommand(repo.dir, 0);
    const mainSha = gitIn(repo.work, ["rev-parse", "main"]).stdout.trim();
    repo.commit("app.ts", "export const a = 3;\n");
    const result = gitIn(repo.work, ["push", "origin", "feat"], { PAPERCLIP_PREPUSH_CHECK_COMMAND: stub.command });
    assert.equal(result.status, 0, result.stderr);
    const lines = stub.ran().trim().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^typecheck corepack pnpm typecheck$/);
    assert.match(lines[1], new RegExp(`^test:quick .*scripts/test\\.mjs --tier quick --changed ${mainSha}$`));
  } finally {
    repo.cleanup();
  }
});

test("hook: pushing a sha other than HEAD skips the checks with a warning", { timeout: 30_000 }, () => {
  const repo = makeRepo();
  try {
    const stub = stubCommand(repo.dir, 1);
    repo.commit("app.ts", "export const a = 4;\n");
    repo.commit("other.ts", "export const b = 1;\n");
    const result = gitIn(repo.work, ["push", "origin", "HEAD~1:refs/heads/feat"], { PAPERCLIP_PREPUSH_CHECK_COMMAND: stub.command });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /isn't HEAD/);
    assert.equal(stub.ran(), "");
  } finally {
    repo.cleanup();
  }
});

/** Holds `lock` from another process, as another test run would; resolves once it's held. */
async function holdLock(lock) {
  // One process, so that killing it releases the lock.
  const holder = spawn("sh", ["-c", 'exec 9>>"$1" && flock 9 && echo held && exec sleep 60', "sh", lock],
    { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise((resolve, reject) => {
    holder.stdout.once("data", resolve);
    holder.once("error", reject);
  });
  return holder;
}

test("hook: a second push waits for the machine lock while a first one's checks hold it", { timeout: 60_000 }, async () => {
  const first = makeRepo();
  const second = makeRepo();
  try {
    // Both hooks share one lock file and one log. The first push's typecheck lasts until the test
    // creates the `go` file, which it does once the second push says it's waiting.
    const lock = path.join(first.dir, "machine.lock");
    const log = path.join(first.dir, "order.log");
    const go = path.join(first.dir, "go");
    const stub = path.join(first.dir, "slow-stub.sh");
    writeFileSync(stub, `#!/bin/sh\necho "start $PUSH_TAG $1" >> "${log}"\n`
      + `if [ "$PUSH_TAG" = one ] && [ "$1" = typecheck ]; then while [ ! -f "${go}" ]; do sleep 0.05; done; fi\n`
      + `echo "end $PUSH_TAG $1" >> "${log}"\n`);
    chmodSync(stub, 0o755);
    const env = (tag) => ({ PAPERCLIP_PREPUSH_LOCK: lock, PAPERCLIP_PREPUSH_CHECK_COMMAND: stub, PUSH_TAG: tag });
    const ran = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
    first.commit("app.ts", "export const a = 5;\n");
    second.commit("app.ts", "export const a = 6;\n");

    const one = gitAsync(first.work, ["push", "origin", "feat"], env("one"));
    // The first hook's check has started, so it holds the lock.
    await waitFor(() => ran().length > 0, "the first push's typecheck");
    const two = gitAsync(second.work, ["push", "origin", "feat"], env("two"));
    await waitFor(() => two.stderr().includes("waiting for the machine lock"), "the second push to wait");
    await delay(300);
    assert.deepEqual(ran(), ["start one typecheck"]);
    writeFileSync(go, "");
    const [oneResult, twoResult] = await Promise.all([one.done, two.done]);

    assert.equal(oneResult.status, 0, oneResult.stderr);
    assert.equal(twoResult.status, 0, twoResult.stderr);
    assert.doesNotMatch(oneResult.stderr, /waiting for the machine lock/);
    assert.ok(twoResult.stderr.includes(`waiting for the machine lock (${lock}), held by another test run`), twoResult.stderr);
    assert.match(twoResult.stderr, /got the machine lock after \d+(?:\.\d)? s/i);
    // The second hook's checks ran only after both of the first's had finished.
    assert.deepEqual(ran(), [
      "start one typecheck", "end one typecheck", "start one test:quick", "end one test:quick",
      "start two typecheck", "end two typecheck", "start two test:quick", "end two test:quick",
    ]);
  } finally {
    first.cleanup();
    second.cleanup();
  }
});

test("hook: a push with nothing to check doesn't wait for the lock", { timeout: 30_000 }, async () => {
  const repo = makeRepo();
  const lock = path.join(repo.dir, "machine.lock");
  const holder = await holdLock(lock);
  try {
    const stub = stubCommand(repo.dir, 0);
    repo.commit("NOTES.md", "notes\n");
    const result = await gitAsync(repo.work, ["push", "origin", "feat"],
      { PAPERCLIP_PREPUSH_LOCK: lock, PAPERCLIP_PREPUSH_CHECK_COMMAND: stub.command }).done;
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /only Markdown/i);
    assert.doesNotMatch(result.stderr, /machine lock/);
  } finally {
    holder.kill();
    repo.cleanup();
  }
});

test("hook: PAPERCLIP_PREPUSH_LOCK=off runs the checks while another run holds the lock", { timeout: 30_000 }, async () => {
  const repo = makeRepo();
  const lock = path.join(repo.dir, "machine.lock");
  const holder = await holdLock(lock);
  try {
    const stub = stubCommand(repo.dir, 0);
    repo.commit("app.ts", "export const a = 7;\n");
    const result = await gitAsync(repo.work, ["push", "origin", "feat"],
      { PAPERCLIP_PREPUSH_LOCK: "off", PAPERCLIP_PREPUSH_CHECK_COMMAND: stub.command }).done;
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /PAPERCLIP_PREPUSH_LOCK=off/);
    assert.equal(stub.ran().trim().split("\n").length, 2);
  } finally {
    holder.kill();
    repo.cleanup();
  }
});
