#!/usr/bin/env node
// The fork's pre-push checks, run by .githooks/pre-push. Turn them on in a clone with
// `corepack pnpm hooks:install` (sets core.hooksPath to .githooks; every worktree of the clone
// shares that setting, and each uses the hook in its own checkout).
//
// Before a push it runs, in order, stopping at the first failure:
//   1. `corepack pnpm typecheck`: the whole workspace, dormant packages included.
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
// Bypass: `git push --no-verify`, or PAPERCLIP_SKIP_PREPUSH=1.
// For the hook's own tests, PAPERCLIP_PREPUSH_CHECK_COMMAND names a program run in place of each
// check, as `<program> <check name> <command> <args...>`.
//
// The decisions (parsing git's input, the ranges, the Markdown rule, what to run) are the pure
// functions exported below; the git calls and processes are at the end.
import { spawnSync } from "node:child_process";
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
    else needChecks.push(range);
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
  plan.checks.push({ name: "typecheck", command: "corepack", args: ["pnpm", "typecheck"] });
  const bases = [...new Set(atHead.map((range) => range.base).filter(Boolean))];
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then((code) => process.exit(code), (error) => {
    console.error(`${prefix} ${error?.stack ?? error}`);
    console.error(`${prefix} ${bypassHint}`);
    process.exit(1);
  });
}
