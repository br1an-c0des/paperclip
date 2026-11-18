# Per-file overhead (step 3a, agent B)

Branch `test/overhead`, 2026-11-18. Tasks B1–B3 of [step-3a-plan.md](../step-3a-plan.md). Every
timing here ran under the machine-wide benchmark lock. Bench-set numbers come from `bench.sh`; the
per-file floor used the same lock around a small script of its own.

## Result

**Committed:** `fsModuleCache` on, and the server split into two projects:

| Project (from the repo root) | Files | `isolate` | Which files |
| --- | --- | --- | --- |
| `@paperclipai/server (shared)` | 1,763 | `false` | every server test file not in `isolated` |
| `@paperclipai/server (isolated)` | 497 | `true` | files that call `vi.mock`, `vi.doMock`, `vi.unmock`, `vi.doUnmock`, `vi.resetModules`, `vi.importActual`, `vi.importMock` or `vi.hoisted`, found by scanning the files when the config loads, plus a by-name list (empty today) |

On the bench set, against the 695.0 s baseline: **538.8 s at one worker (−22%)** and
**116.1–120.0 s at 6 workers** (three runs), with 1,623 passed, 0 failed and 2 skipped every time.
At 6 workers the same settings with isolation everywhere took 126.7 s.

## B1: the per-file floor

20 copies of a file with one trivial test, and 20 copies of a file that only imports the services
barrel (`src/services/index.ts`, which loads most of the server), run one at a time. Wall time is
for the whole `vitest run`. The per-file figure for the heavy file leaves out the first file, which
also pays the cold compile.

| Setting | Trivial ×20 | Per file | Services import ×20 | Per extra file |
| --- | --- | --- | --- | --- |
| Current config (forks, `isolate: true`) | 12.7 s, 14.2 s | 0.60 s | 109.8 s | 4.67 s |
| without `setupFiles` | 2.9 s | 0.11 s | 98.5 s | 4.07 s |
| `pool: "threads"` | 11.3 s | 0.52 s | 98.5 s | 4.08 s |
| `pool: "vmForks"` | 2.3 s | 0.08 s | 59.5 s | 2.02 s |
| `isolate: false` | 1.5 s | 0.04 s | 22.0 s | 0.05 s |
| one file alone | 1.3 s | | 21.1 s (cold), 8.4 s (warm `fsModuleCache`) | |
| split config, warm cache (these files land in `shared`) | | | 8.3 s | ~0 |

Where a file's time goes under the current config, from Vitest's per-file diagnostics and
controller-side timestamps (median of files 2–20):

| Part | Trivial file | Services-importing file |
| --- | --- | --- |
| Previous worker's teardown and the next one's start (end of one file to the next being queued) | 0.09 s | 0.09 s |
| Environment (`node`) | 0 | 0 |
| Runner prepare | 0.003 s | 0.003 s |
| Setup file (`setup-supertest.ts`) | 0.06–0.09 s | 0.06 s |
| Import (collect) | 0.007 s | **4.24 s** |
| Tests and hooks | 0.39–0.44 s, nearly all the setup file's `beforeEach` loading `instance-settings-cache` (drizzle-orm and `@paperclipai/db/work-signals`) on the first test | 0.003 s |

Ten real small bench files told the same story. The gap from one file's end to the next file's
queueing was 0.09–0.10 s every time. What came before each file's tests was 0.06 s of setup plus
0.5–4.5 s of import. Wall time was 55.3 s with isolation and 26.4 s without.

**What the "4.2 s gap between files" is.** It isn't process setup and teardown, which take about
0.1 s. Vitest marks a file as started (the runner task's `startTime`, which the profile reporter
records) *after* the file's imports are collected. So the gap from one file's end to the next
file's start already contains the next file's import. The audit's 3.6 s of import and 4.2 s of gap
count the same seconds twice. The real per-file overhead is about 4.3 s, nearly all of it
evaluating the server's module graph again in each new process. That's why the fix is not
re-evaluating it (`isolate: false`). Faster process start (threads) doesn't help. The audit's "~8 s
per file" and "~4.4 hours" should come down by about half. That's the PM's to correct.

The cold compile (about 20 s for the services graph in a fresh `vitest run`, 8.4 s warm with
`fsModuleCache`) is paid once per run, not per file.

## B2: module cache

`fsModuleCache: true` in `server/vitest.config.ts` and the root `vitest.config.ts`. Its default
path is `node_modules/.vitest-cache` at the workspace root. Each worktree has its own
`node_modules`, so each has its own cache.

| Run | Wall | Passed | Failed | Skipped |
| --- | --- | --- | --- | --- |
| `fsmc-cold` (cache deleted first) | 710.5 s | 1,623 | 0 | 2 |
| `fsmc-warm` | 647.5 s | 1,623 | 0 | 2 |

A cold run costs about 15 s more than the baseline (writing about 3,300 cache files). A warm one
saves about 48 s (−7%) at one file at a time.

**The root setting doesn't reach the projects.** A project with its own config file doesn't
inherit it, and checking `@paperclipai/shared` from the root wrote no cache entries. The server
config sets it itself. For the packages (configs I don't own), the runner can pass
`--fsModuleCache` on the command line, which Vitest applies to every project.

**Staleness check** (`attention-excerpt.test.ts`, which tests `stripMarkdown` in
`src/services/attention.ts`, with the cache warm). It passed every time:

| Step | Result |
| --- | --- |
| 1. Clean | pass (2/2) |
| 2. Edit `stripMarkdown` so the test must fail | fail: `expected 'Stale archived…' to be 'Scott archived…'` |
| 3. Revert | pass |
| 4. Add `throw` at the top of `approval-visibility.ts`, which `attention.ts` imports (a transitive edit) | fail: `Error: stale-check transitive` |
| 5. Revert | pass |
| 6. Check out a temporary branch with a committed break in `stripMarkdown` | fail: `expected 'Branch archived…'` |
| 7. Check out `test/overhead` again | pass |
| 8. Back to the temporary branch (its entry now cached) | fail, as it should |
| 9. Detach to `main`, back to `test/overhead` (temporary branch deleted) | pass |

Why it holds: in Vitest 5.0.3 each entry's key is a SHA-1 of the module id, the module's source
text and an environment hash (Vite root, mode, `resolve` config, plugin names, the contents of the
config file and its dependencies, `NODE_ENV`). A lockfile change clears the whole cache. Branch
switches and file timestamps don't matter. Two things that aren't in the key: a plugin's options
(only plugin names are), and environment variables a transform reads, other than `NODE_ENV`.
Neither applies to the server config today. If a plugin is ever added, `rm -rf
node_modules/.vitest-cache` clears the cache.

## B3: isolation

| Setting | 1 worker | 6 workers |
| --- | --- | --- |
| `isolate: true` everywhere, cache warm | 647.5 s, 0 failed | 126.7 s, 0 failed |
| `isolate: false` everywhere | 463.1 s, **350 failed in 17 files** | 155.0 s, **79 failed in 9 files** |
| `pool: "vmForks"` | 578.3 s, **4 failed in 3 files** | 128.4 s, **4 failed in 3 files** |
| **split (committed)** | **538.8 s, 0 failed** | **116.2 s, 116.1 s, 120.0 s, 0 failed** |

All passed + skipped counts match the baseline's 1,625 except where failures are listed (noiso-1:
1,273 + 350 + 2, noiso-6: 1,544 + 79 + 2, vmForks: 1,619 + 4 + 2).

**Files that fail with `isolate: false`.** Each passed when re-run alone (also with
`--no-isolate`), so they fail only when they share a worker:

- Fail with one worker and with six: `src/adapters/http/execute.test.ts`,
  `src/__tests__/environment-run-orchestrator.test.ts`, `src/__tests__/github-health-recovery.test.ts`,
  `src/__tests__/plugin-fresh-workspaces.integration.test.ts`, `src/__tests__/railway-ssh.test.ts`,
  `src/services/adapter-settings-local.test.ts`, `src/services/execution-policy-bootstrap.test.ts`.
- One worker only: `src/__tests__/abandoned-workspace-files-hold.test.ts`,
  `src/__tests__/companies-service.test.ts`,
  `src/__tests__/environment-runtime-reusable-resume-replacement.test.ts`,
  `src/__tests__/issue-watchdogs-routes.test.ts`, `src/__tests__/login-session-runtime.test.ts`,
  `src/__tests__/plugin-environment-driver-ready-recovery.test.ts`,
  `src/services/__tests__/run-failure-report.test.ts` (221 of 290),
  `src/services/heartbeat/native-recovery-deadlines.test.ts`,
  `src/services/heartbeat/run-output.test.ts`, `src/__tests__/task-workspace-binding.test.ts`.
- Six workers only: `src/__tests__/heartbeat-blocked-question-answer.test.ts`,
  `src/__tests__/heartbeat-session-preparation.test.ts`.

17 of the 19 replace modules (`vi.mock` and friends). The errors are mocks that don't apply
(`db.select is not a function`, `No "persistActivity" export is defined on the mock`, a `vi.fn()`
never called) because an earlier file in the same worker already loaded the real module, or the
other way round. The other two, `task-workspace-binding` and `heartbeat-session-preparation`, have
no mocks. They failed because of an earlier file's mocks, and both pass in `shared` once the
mocking files are out of it. So the split rule is "replaces modules", not a hand-made list.

**Files that fail under `vmForks`:** `src/adapters/http/execute.test.ts` (an `AbortError`
`DOMException` from another realm), `src/__tests__/idle-admission.test.ts` (rolldown's native
binding rejects a `RegExp` made in the VM context: "Value is none of these types `String`,
`RegExp`"), and `src/__tests__/tool-gateway-service.test.ts` (an error doesn't match
`{ reasonCode: 'tool_timeout' }`). These are the usual cross-realm problems of VM pools. With them
and the slower times, vmForks lost to the split.

**`pool: "threads"`** saved only process start (0.6 s to 0.5 s per trivial file, 4.7 s to 4.1 s per
services file). I didn't run it on the bench set. Five server files use `process.chdir`, which
worker threads don't support (`service-version`, `workspace-runtime`, `worktree-config`,
`health-server-info-git-probe`, `worktree-seed-server-spawn`), and several call `process.exit`
paths.

**Beyond the bench set.** 40 randomly chosen `shared` files from outside it (seed 42, including
`workspace-runtime.test.ts`, which calls `process.chdir`) ran without isolation, 10 to a worker: 1,561
passed, 1 skipped, 0 failed. Most of the 1,763 `shared` files haven't yet run together without
isolation. The PM's full thorough-tier run after the merge is the real check. A file that fails
there only in `shared` goes in `ISOLATED_BY_NAME` in `server/vitest.config.ts`.

**Why 6 workers gain less than 1 worker.** The bench set's wall time at 6 workers is held up by
its four 60–100 s files, not by overhead. Most of the suite's ~2,000 server files are small (about
1 s of tests against ~4 s of import), so the full suite should gain more than the bench set shows.

## Interfaces and side effects

- **Names.** `server/vitest.config.ts` declares two inline projects, so from the root it's a
  container (a Vitest 5 feature) and its projects are named `@paperclipai/server (shared)` and
  `@paperclipai/server (isolated)`. `--project '@paperclipai/server*'` selects both (agent A's
  filter). So does `--project @paperclipai/server`, because a container's name matches its
  children. Every server file is in exactly one of them: `vitest list` gives 1,763 + 497 = 2,260
  files from `server/` and the same from the root, with no file in both. Run from `server/` (as
  `bench.sh` does), the names are `shared` and `isolated`.
- **Upstream's `scripts/run-vitest-stable.mjs`** (not edited): its server phases pass
  `--project @paperclipai/server` and still get every server file. But its 6-way chat-suite
  sharding (`scripts/test-line-shard.mjs`, `validateTests`) asserts
  `test.projectName === "@paperclipai/server"`. The chat suite is now in
  `@paperclipai/server (isolated)`, so `pnpm test` in mode `all` (and the CI chat lanes) would stop
  with "unexpected test project" at the chat phase. It fails loudly, doesn't drop tests. The fix is
  one line in `test-line-shard.mjs`: accept `@paperclipai/server` or a name starting with
  `@paperclipai/server (`. I didn't make it, since that file isn't mine.
- **`setup-supertest.ts`**: in `shared`, the setup file runs again before every file in a worker.
  Each file still gets its own `PAPERCLIP_HOME`, but there's now one `exit` listener per worker
  instead of one per file. Before this change, `MaxListenersExceededWarning: 11 exit listeners`
  appeared in the no-isolation run.

## Found, not fixed

- **Test homes are never cleaned up.** `setup-supertest.ts` deletes the file's
  `paperclip-vitest-home-*` directory on the worker's `exit` event. With the original file, 4 test
  files left 4 directories behind, with isolation and without. Vitest's fork workers apparently
  don't emit `exit`. `/tmp` holds about 2,500 of them (1.9 GB) from today's runs. The
  `paperclip-vitest-codex-home-*` directories are never deleted at all.
- **The setup file's `beforeEach`** imports `instance-settings-cache` (drizzle-orm and
  `@paperclipai/db/work-signals`) on each file's first test. That's 0.4 s per file for files that
  don't otherwise load drizzle, under isolation. It's dynamic on purpose, so it invalidates the same
  module instance the test uses. A cheaper form would need a change in
  `services/instance-settings-cache.ts` (for example, registering its invalidator on `globalThis`).
  Under `shared` it costs nothing after a worker's first file.
- **The audit's double count** (B1 above): "3.6 s import + 4.2 s gap" is one ~4.3 s cost.

## Commands

```bash
fork/test-suite-audit/bench.sh fsmc-cold      # after rm -rf node_modules/.vitest-cache
fork/test-suite-audit/bench.sh fsmc-warm
fork/test-suite-audit/bench.sh noiso-1 --no-isolate
fork/test-suite-audit/bench.sh noiso-6 --no-isolate --fileParallelism --maxWorkers=6
fork/test-suite-audit/bench.sh fsmc-iso-6 --fileParallelism --maxWorkers=6
fork/test-suite-audit/bench.sh split-1        # the committed config
fork/test-suite-audit/bench.sh split-6 --fileParallelism --maxWorkers=6   # and -r2, -r3
fork/test-suite-audit/bench.sh vmforks-6 --pool=vmForks --fileParallelism --maxWorkers=6
fork/test-suite-audit/bench.sh vmforks-1 --pool=vmForks
```

`fsmc-*`, `noiso-*` and `fsmc-iso-6` ran before the split, on one server project with the cache on.
`split-*` and `vmforks-*` ran with the split config. A CLI `--pool` or `--isolate` applies to both
projects, so `vmforks-*` ran every file under vmForks.
