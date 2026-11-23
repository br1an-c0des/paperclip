#!/usr/bin/env node
// The fork's pre-push checks, run by .githooks/pre-push. Turn them on in a clone with
// `corepack pnpm hooks:install` (sets core.hooksPath to .githooks; every worktree of the clone
// shares that setting, and each uses the hook in its own checkout).
//
// Before a push it runs, in order, stopping at the first failure:
//   1. A typecheck of the packages the pushed range changes and the packages that depend on them:
//      `corepack pnpm -r --filter "...[<base>]" typecheck`. The whole workspace (`corepack pnpm
//      typecheck`, ~6.5 GB and the Runner's `cargo check`) only when a root file every package
//      reads changes (package.json, pnpm-lock.yaml, pnpm-workspace.yaml, tsconfig*.json) or a range
//      has no base. CI typechecks the whole workspace on every push either way.
//   2. `node scripts/test.mjs --tier quick --changed <base>`: the tests the pushed range touches.
// The base is where the pushed range starts, worked out per ref from git's pre-push input:
//   - a deletion is skipped;
//   - a new remote ref starts at its merge base with `main` (else `origin/main`);
//   - an existing remote ref starts at the remote sha (its merge base with the pushed commit, so a
//     force push counts from where the two histories split). A remote sha this clone doesn't have
//     falls back to the merge base with main.
//   So pushing `main` after a merge tests the merged range, where `test:quick` alone would see
//   nothing changed since main.
// When every file changed in every pushed range is Markdown (*.md), it runs nothing.
//
// What it tests: the checks run on the working tree, not on the pushed commits. So:
//   - A pushed commit that isn't HEAD (`git push origin other-branch`, `git push origin HEAD~1:x`)
//     is not checked: the hook says so and lets that ref through. Testing the working tree for it
//     would test the wrong code; check that commit out and push from there to have it checked.
//   - Uncommitted changes to tracked files are tested along with the commit, and the hook warns
//     that the result covers the working tree as it is, not exactly what is pushed.
//
// The machine lock: the checks hold /tmp/paperclip-test-bench.lock, the lock every full local test
// run here takes (`flock /tmp/paperclip-test-bench.lock …`), from the first check until the last
// finishes. Several agents pushing at once would otherwise each start a workspace typecheck
// (~6.5 GB) and test:quick together and run the machine out of memory. A hook that has to wait
// says so, and says how long it waited.
//   - PAPERCLIP_PREPUSH_LOCK=<path> takes another lock file; PAPERCLIP_PREPUSH_LOCK=off takes none.
//   - Without `flock` on PATH it warns and runs the checks unlocked.
//   - A push with nothing to check (Markdown only, a bypass, deletions, a ref that isn't HEAD)
//     never touches the lock.
//   How: a small holder process, `sh` taking the lock on a file descriptor with `flock` and then
//   waiting on its stdin, holds the lock while this script runs the checks as before; closing its
//   stdin releases it. Running the checks under `flock <lock> <child>` instead would hand the lock's
//   descriptor to every process the checks start, so anything they leave running (a stray Vitest
//   worker, an embedded Postgres) would keep the lock held after the hook ended. The holder is the
//   only process with the descriptor, and it exits when this script does, however that happens.
//   The lock is released before the hook returns, so it isn't held while git sends the push.
//
// Bypass: `git push --no-verify`, or PAPERCLIP_SKIP_PREPUSH=1.
// For the hook's own tests, PAPERCLIP_PREPUSH_CHECK_COMMAND names a program run in place of each
// check, as `<program> <check name> <command> <args...>`.
//
// The decisions (parsing git's input, the ranges, the Markdown rule, what to run, which lock) are
// the pure functions exported below; the git calls and processes are at the end.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const prefix = "[pre-push]";
export const bypassHint = "To push anyway: git push --no-verify, or PAPERCLIP_SKIP_PREPUSH=1 git push.";

export function isZeroSha(sha) {
  return /^0+$/.test(sha);
}

/** git's pre-push input, one `<local ref> <local sha> <remote ref> <remote sha>` per line. */
export function parsePushLines(text) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const fields = line.split(/\s+/);
    if (fields.length !== 4) throw new Error(`Unexpected pre-push line from git: "${line}"`);
    const [localRef, localSha, remoteRef, remoteSha] = fields;
    return { localRef, localSha, remoteRef, remoteSha };
  });
}

export function isMarkdown(file) {
  return /\.md$/i.test(file);
}

/** Root files every package's typecheck reads: a change to one typechecks the whole workspace. */
const wholeWorkspaceFiles = /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json)$/;
export function needsWholeTypecheck(files) {
  return files.some((file) => wholeWorkspaceFiles.test(file));
}

export function bypassRequested(env) {
  return ["1", "true"].includes(String(env.PAPERCLIP_SKIP_PREPUSH ?? "").trim().toLowerCase());
}

function shortRef(ref) {
  return ref.replace(/^refs\/(?:heads|tags)\//, "");
}

function short(sha) {
  return sha.slice(0, 10);
}

/**
 * The range each pushed ref sends: `{ ref, local, base, baseFrom }`, deletions left out. `base` is
 * null when there's nothing to compare against (no main or origin/main). `repo` provides:
 *   peel(sha): the commit an object names, or null when it isn't a commit this clone has;
 *   mergeBase(a, b): the merge base of two commits or refs, or null.
 */
export function pushRanges(updates, repo) {
  const ranges = [];
  for (const { localSha, remoteRef, remoteSha } of updates) {
    if (isZeroSha(localSha)) continue;
    const local = repo.peel(localSha) ?? localSha;
    const remote = isZeroSha(remoteSha) ? null : repo.peel(remoteSha);
    const fromRemote = remote ? repo.mergeBase(remote, local) : null;
    let base = fromRemote;
    let baseFrom = fromRemote ? "remote" : null;
    if (!base) {
      for (const candidate of ["main", "origin/main"]) {
        base = repo.mergeBase(candidate, local);
        if (base) {
          baseFrom = candidate;
          break;
        }
      }
    }
    ranges.push({ ref: shortRef(remoteRef), local, base: base ?? null, baseFrom });
  }
  return ranges;
}

/**
 * What to do for a push: `{ notes, warnings, checks }`, where each check is `{ name, command, args }`
 * to run in order. `repo` is pushRanges' plus:
 *   head: the HEAD commit;
 *   changedFiles(base, local): the files that differ between two commits;
 *   dirtyFiles(): tracked files with uncommitted changes.
 */
export function planPush(updates, repo, env) {
  const plan = { notes: [], warnings: [], checks: [] };
  if (bypassRequested(env)) {
    plan.notes.push("PAPERCLIP_SKIP_PREPUSH is set: skipping the pre-push checks.");
    return plan;
  }
  const ranges = pushRanges(updates, repo);
  if (ranges.length === 0) {
    plan.notes.push("Nothing to check (only deletions).");
    return plan;
  }
  const needChecks = [];
  let markdownFiles = 0;
  for (const range of ranges) {
    const changed = range.base ? repo.changedFiles(range.base, range.local) : null;
    if (changed && changed.every(isMarkdown)) markdownFiles += changed.length;
    else needChecks.push({ ...range, changed });
  }
  if (needChecks.length === 0 && markdownFiles === 0) {
    plan.notes.push("No files change in the pushed range: nothing to check.");
    return plan;
  }
  if (needChecks.length === 0) {
    plan.notes.push(`Only Markdown changed (${markdownFiles} file${markdownFiles === 1 ? "" : "s"}): skipping the typecheck and tests.`);
    return plan;
  }
  const head = repo.head;
  const atHead = needChecks.filter((range) => range.local === head);
  for (const range of needChecks.filter((item) => item.local !== head)) {
    plan.warnings.push(`Not checked: ${range.ref} is pushed at ${short(range.local)}, which isn't HEAD (${short(head)}). `
      + "The checks run on the working tree, so they'd test the wrong code. Check that commit out and push from there to check it.");
  }
  if (atHead.length === 0) return plan;

  const dirty = repo.dirtyFiles();
  if (dirty.length > 0) {
    const listed = dirty.slice(0, 5).join(", ") + (dirty.length > 5 ? `, and ${dirty.length - 5} more` : "");
    plan.warnings.push(`The working tree has uncommitted changes to tracked files (${listed}). `
      + `The checks test the working tree as it is, those changes included, not exactly the pushed commit ${short(head)}.`);
  }
  const bases = [...new Set(atHead.map((range) => range.base).filter(Boolean))];
  const whole = atHead.some((range) => !range.base || needsWholeTypecheck(range.changed ?? []));
  plan.checks.push({ name: "typecheck", command: "corepack", args: whole ? ["pnpm", "typecheck"]
    : ["pnpm", "-r", ...bases.flatMap((base) => ["--filter", `...[${base}]`]), "typecheck"] });
  for (const range of atHead.filter((item) => !item.base)) {
    plan.warnings.push(`No base for ${range.ref}: neither main nor origin/main shares history with it, `
      + "so test:quick can't tell what changed. Running the typecheck only.");
  }
  for (const base of bases) {
    plan.checks.push({ name: "test:quick", command: process.execPath, args: ["scripts/test.mjs", "--tier", "quick", "--changed", base] });
  }
  return plan;
}

/** The environment for the checks: without git's repository variables (GIT_DIR, GIT_INDEX_FILE…),
 *  which a hook inherits and which would point tests' own temporary repositories at this one. */
export function childEnv(env, localVars) {
  const drop = new Set(localVars);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !drop.has(key)));
}

export const defaultLockFile = "/tmp/paperclip-test-bench.lock";

/**
 * Which lock the checks hold: `{ file, notes, warnings }`, `file` null for none. PAPERCLIP_PREPUSH_LOCK
 * names the file, or is `off`; `flockAvailable` says whether `flock` is on PATH.
 */
export function lockDecision(env, { flockAvailable }) {
  const setting = String(env.PAPERCLIP_PREPUSH_LOCK ?? "").trim();
  if (setting.toLowerCase() === "off") {
    return { file: null, notes: ["PAPERCLIP_PREPUSH_LOCK=off: running the checks without the machine lock."], warnings: [] };
  }
  const file = setting || defaultLockFile;
  if (!flockAvailable) {
    return { file: null, notes: [], warnings: [`flock isn't installed, so the checks run without the machine lock (${file}), `
      + "alongside any other test run on this machine."] };
  }
  return { file, notes: [], warnings: [] };
}

export function formatDuration(ms) {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

/** Runs the checks in order through `exec(check)` (an exit code), stopping at the first failure. */
export async function runChecks(checks, { exec, now = () => performance.now(), log = (line) => console.error(`${prefix} ${line}`) }) {
  for (const check of checks) {
    log(`${check.name}: ${[check.command, ...(check.args ?? [])].filter(Boolean).join(" ")}`);
    const started = now();
    const exitCode = await exec(check);
    const elapsed = formatDuration(now() - started);
    if (exitCode !== 0) {
      log(`${check.name} failed after ${elapsed}. Push blocked.`);
      log(bypassHint);
      return 1;
    }
    log(`${check.name} passed in ${elapsed}.`);
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Everything below runs git and the checks.

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
}

function gitRepo(root) {
  const lines = (args) => {
    const result = git(root, args);
    if (!result.ok) throw new Error(`git ${args.join(" ")} failed`);
    return result.out.split("\n").filter(Boolean);
  };
  return {
    head: git(root, ["rev-parse", "HEAD"]).out,
    peel: (sha) => {
      const result = git(root, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]);
      return result.ok ? result.out : null;
    },
    mergeBase: (left, right) => {
      const result = git(root, ["merge-base", left, right]);
      return result.ok && result.out ? result.out : null;
    },
    changedFiles: (base, local) => lines(["diff", "--name-only", "--no-renames", base, local]),
    dirtyFiles: () => lines(["status", "--porcelain", "--untracked-files=no"]).map((line) => line.slice(3)),
  };
}

function flockAvailable() {
  return !spawnSync("flock", ["--version"], { stdio: "ignore" }).error;
}

// Opens the lock file on descriptor 9, takes the lock (trying first without waiting, to know
// whether to say it's waiting), reports on stdout, then becomes `cat`, which holds the descriptor
// until its stdin closes.
const holderScript = 'exec 9>>"$1" || exit 3\n'
  + "if ! flock -n 9; then echo waiting; flock 9 || exit 4; fi\n"
  + "echo locked\n"
  + "exec cat >/dev/null\n";

/**
 * Takes the lock in a holder process. Resolves to `release()` (an async function) once it's held,
 * or to null, with a warning, when it couldn't be taken.
 */
function takeLock(file, log) {
  const holder = spawn("sh", ["-c", holderScript, "sh", file], { stdio: ["pipe", "pipe", "inherit"] });
  const started = performance.now();
  const exited = new Promise((resolve) => holder.once("close", resolve));
  return new Promise((resolve) => {
    let buffered = "";
    let waited = false;
    let settled = false;
    const settle = (value) => {
      if (!settled) resolve(value);
      settled = true;
    };
    holder.once("error", (error) => {
      if (!settled) log(`warning: couldn't take the machine lock (${file}): ${error.message}. Running the checks without it.`);
      settle(null);
    });
    exited.then((code) => {
      if (!settled) log(`warning: couldn't take the machine lock (${file}; exit ${code}). Running the checks without it.`);
      settle(null);
    });
    holder.stdout.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop();
      for (const line of lines) {
        if (line === "waiting") {
          waited = true;
          log(`waiting for the machine lock (${file}), held by another test run…`);
        } else if (line === "locked") {
          if (waited) log(`Got the machine lock after ${formatDuration(performance.now() - started)}.`);
          settle(async () => {
            holder.stdin.end();
            await exited;
          });
        }
      }
    });
  });
}

async function main() {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).out || process.cwd();
  const log = (line) => console.error(`${prefix} ${line}`);
  let updates;
  try {
    updates = parsePushLines(readFileSync(0, "utf8"));
  } catch (error) {
    log(error.message);
    return 1;
  }
  const plan = planPush(updates, gitRepo(root), process.env);
  for (const note of plan.notes) log(note);
  for (const warning of plan.warnings) log(`warning: ${warning}`);
  if (plan.checks.length === 0) return 0;

  const stub = process.env.PAPERCLIP_PREPUSH_CHECK_COMMAND?.trim();
  if (!stub && !existsSync(path.join(root, "node_modules"))) {
    log("No node_modules here: run `corepack pnpm install --frozen-lockfile` first.");
    log(bypassHint);
    return 1;
  }
  const env = childEnv(process.env, git(root, ["rev-parse", "--local-env-vars"]).out.split("\n").filter(Boolean));
  const lock = lockDecision(process.env, { flockAvailable: flockAvailable() });
  for (const note of lock.notes) log(note);
  for (const warning of lock.warnings) log(`warning: ${warning}`);
  const release = lock.file ? await takeLock(path.resolve(root, lock.file), log) : null;
  try {
    const totalStart = performance.now();
    const exitCode = await runChecks(plan.checks, {
      log,
      exec: (check) => {
        const [command, args] = stub ? [stub, [check.name, check.command, ...check.args]] : [check.command, check.args];
        const result = spawnSync(command, args, { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });
        if (result.error) log(`${check.name}: ${result.error.message}`);
        return result.status ?? 1;
      },
    });
    if (exitCode === 0) log(`All checks passed in ${formatDuration(performance.now() - totalStart)}.`);
    return exitCode;
  } finally {
    await release?.();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (error) => {
    console.error(`${prefix} ${error?.stack ?? error}`);
    console.error(`${prefix} ${bypassHint}`);
    process.exit(1);
  });
}
