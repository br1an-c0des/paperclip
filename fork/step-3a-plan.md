# Step 3a Implementation Plan: renovate the test suite, round 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement your part of this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking. Each agent implements only the tasks its brief
> names.

**Goal:** Cut the full suite from ~7.6 hours toward the 10–20 minute target. Round 1 fixes how the
suite runs (parallel files, per-file overhead, Postgres) and prepares the per-area review that
decides what the thorough tier contains.

**Architecture:** A new runner, `scripts/test.mjs`, runs tiers (quick, thorough, opt-in) from a tier
file, with server files in parallel and every phase reported. Vitest and Postgres settings cut the ~8 s
each file costs before and after its tests. Upstream's `scripts/run-vitest-stable.mjs` stays as it
is until round 2 replaces upstream's CI. A classification of every test file feeds the review with
the user.

**Tech Stack:** Vitest 5.0.3 (projects, forks pool), Node 24, embedded-postgres 18.1.0-beta.16,
pnpm via `corepack pnpm`, bash + `flock` for the benchmark.

**Spec:** [hard-fork-plan.md, step 3a](hard-fork-plan.md#3a-renovate-the-test-suite) and
[test-suite-audit.md](test-suite-audit.md) (the findings and the ranked fixes).

## Global Constraints

- **Base check first:** `git merge-base --is-ancestor main HEAD || git reset --hard main` while the
  tree is clean. Then `corepack pnpm install --frozen-lockfile` and
  `corepack pnpm --filter @paperclipai/plugin-sdk build`.
- **Rules:** read `CLAUDE.md`. Don't extend or fix dormant code. Never touch server1, never wake an
  agent or start a real run.
- **One machine, four agents** (16 cores, 22 GB):
  - **Timing only through the benchmark:** `fork/test-suite-audit/bench.sh <label> [vitest args]`.
    It takes a machine-wide lock (`/tmp/paperclip-test-bench.lock`), so only one timing run happens
    at a time. It waits for the lock rather than failing. A number measured outside it doesn't
    count.
  - **Correctness runs outside the lock:** at most `--maxWorkers=2` and about 10 files at a time.
    Never run the whole suite.
  - Stop anything you start by its PID. Leave no dev servers, Vitest or Postgres processes behind.
- **Same tests, faster:** every benchmark reports passed, failed and skipped counts. A change that
  runs fewer tests than the baseline isn't a speedup. Report it as a finding instead.
- **Don't change test files to make them pass,** except an agent's own new tests. A file that fails
  under a new setting is a result: name it and report it.
- **Bugs found:** report them. Don't fix them.
- **Finish:** commit on your branch with clear messages. Don't push, don't merge, and don't edit the
  shared docs: this plan, the audit, `hard-fork-plan.md`, `CLAUDE.md` and `upstream-fixes.md`. Each
  agent writes its numbers to its own `fork/test-suite-audit/results-<agent>.md`.
- **Report back:** what changed, the benchmark lines (from
  `/tmp/paperclip-bench/results.tsv`), the files that failed under each setting, what you left
  out and why, the files you touched, and the checks you ran with their results.

## Review Focus

1. **Fewer tests run than before:** a glob, project filter or exclusion silently drops files. The
   runner prints per-phase file and test counts, and every benchmark is compared with the baseline's
   passed + skipped count.
2. **Flakes that appear only in parallel:** a file passes once and fails one time in three. The
   chosen worker count is benchmarked at least 3 times (task A1).
3. **A stale module cache:** with `fsModuleCache` on, an edited source file must change the test
   result on the next run, including after a branch switch (task B2).
4. **Leftover Postgres processes and data directories** after a failed or interrupted run, which on
   `/dev/shm` take RAM. Interrupt a run with Ctrl-C and check (task C2).
5. **An early failure hiding later phases:** every phase runs, and the summary lists every failure
   (task A2's tests).

## Before the round (PM)

- [x] Commit this plan, `fork/test-suite-audit/bench.sh`, `bench-set.txt` and bug-list entry 40.
- [x] Run the baseline: `fork/test-suite-audit/bench.sh baseline` (current config, one file at a
  time), written to `fork/test-suite-audit/results-baseline.md`.
- [x] Re-run the 4 failing files from entry 40 one at a time. Record whether each fails alone.
- [ ] Spawn the agents the user approved.

---

## Agent A: test runner and parallel server files

**Branch:** `test/runner` · **Owns:** `scripts/test.mjs`, `scripts/test-tiers.json`,
`scripts/__tests__/test-runner.test.mjs`, the `test*` entries of the root `package.json` (not
`test:run*`), `fork/test-suite-audit/results-runner.md`. It leaves `scripts/run-vitest-stable.mjs`
and the Vitest configs alone.

**Interfaces:**
- Produces: `node scripts/test.mjs [--tier quick|thorough|optin|all] [--workers N] [--changed <ref>] [--files <listfile>] [--dry-run] [-- <vitest args>]`.
- Produces: `scripts/test-tiers.json`, shaped
  `{ "serialServer": string[], "optIn": { "glob": string, "reason": string }[] }`. Paths are
  repo-relative. Round 1 fills `serialServer` from task A1 and leaves `optIn` empty. Round 2 fills
  `optIn` after the user's area review.
- Consumes: server projects by the filter `--project '@paperclipai/server*'`, so agent B can split
  the server project without changing the runner.

### Task A1: Find the worker count

- [ ] Run `bench.sh workers-N --fileParallelism --maxWorkers=N` for N = 2, 4, 6, 8. Note
  `free -g` and the load during each.
- [ ] Re-run every file that failed in parallel but passes in the baseline, alone and then at the
  same N, to confirm it fails only in parallel. Confirmed files go in `serialServer`.
- [ ] Run the best N 3 times. Pick the default: the fastest N with no failures that appear only in
  parallel, and at most cores ÷ 2. Record all of it in `results-runner.md`.

### Task A2: The runner

- [ ] Write the failing tests in `scripts/__tests__/test-runner.test.mjs` (`node:test`, like the
  other `scripts/__tests__` files) against a pure `buildPlan(tier, tiers, options)` that returns
  phases (`{ name, args: string[], files: string[] | null }`), and a `runPhases(phases, exec)`
  that takes an injected executor:
  - `thorough` has a parallel server phase with `--fileParallelism --maxWorkers=<N>` that excludes
    every `serialServer` and `optIn` path, then a serial phase with `--maxWorkers=1` for
    `serialServer`, then one phase that runs all the non-server projects from the root
    `vitest.config.ts` in a single `vitest run` (not one run per project).
  - `optin` runs only the files matching `optIn` globs. `all` is `thorough` followed by `optin`.
  - `--files <list>` restricts every phase to the files in the list.
  - `runPhases` runs every phase when an earlier one fails, and returns
    `{ phase, exitCode, wallMs }[]`. The process exits 1 if any phase failed.
- [ ] Run them and see them fail: `node --test scripts/__tests__/test-runner.test.mjs`.
- [ ] Implement `scripts/test.mjs`. It runs `pnpm run preflight:workspace-links` and the plugin-SDK
  `ensure-build-deps` first, as `test:run` does. Each phase is one `vitest run` from the repo root.
  The summary table shows phase, files, tests passed, failed and skipped, wall time, and the failed
  files.
- [ ] **`quick`:** try `--changed <ref>` (default `main`) for a typical one-file change in
  `server/src/services/`. If it selects more than about 300 files, because the server's module graph
  links everything, fall back to the test files under the changed file's directory plus those whose
  name contains the changed module's basename. Write down the choice and the file counts.
- [ ] Root `package.json`: `"test": "node scripts/test.mjs --tier thorough"`, `"test:quick"`,
  `"test:optin"`, `"test:all"`. Leave `test:run`, `test:run:general` and `test:run:serialized`
  unchanged; upstream's workflows call them.
- [ ] Tests pass, and `node scripts/test.mjs --dry-run --tier thorough` lists the phases with their
  file counts. Commit.

**Done when:** the unit tests pass; `bench.sh` and `node scripts/test.mjs --files
fork/test-suite-audit/bench-set.txt` give the same passed count; `results-runner.md` has the worker
table and the `quick` decision.

---

## Agent B: per-file overhead

**Branch:** `test/overhead` · **Owns:** `server/vitest.config.ts`, the root `vitest.config.ts`,
`server/src/__tests__/setup-supertest.ts`, any new `server/vitest.*.ts`,
`fork/test-suite-audit/results-overhead.md`.

**Interfaces:**
- Produces: server projects whose names all match `@paperclipai/server*` (for example
  `@paperclipai/server` and `@paperclipai/server-isolated`), with every server test file in exactly
  one of them.

### Task B1: Find what the ~4.2 s between files is

- [ ] Make 20 copies of a trivial test file in a scratch folder under `server/src/__tests__/` (not
  committed). Time them serially under `bench.sh`'s lock: run `flock
  /tmp/paperclip-test-bench.lock` around the command yourself, since they aren't the bench set.
  Wall time ÷ 20 is the per-file floor.
- [ ] Repeat the floor without `setupFiles`, with `pool: "threads"`, with `pool: "vmForks"`, and
  with `isolate: false`. Report the breakdown: process start, setup file, environment, teardown.
- [ ] Delete the scratch copies.

### Task B2: Module cache

- [ ] Turn on `fsModuleCache` (default path `node_modules/.vitest-cache`) in the root and server
  configs. Run `bench.sh fsmc-cold`, then `bench.sh fsmc-warm`.
- [ ] Prove it doesn't go stale: change a source file one bench test depends on so the test fails,
  run it (fails), revert, run it (passes). Then check out another branch and back, and run it again.
  Record the outcome.

### Task B3: Isolation

- [ ] Set `isolate: false` and run `bench.sh noiso-1`, then `bench.sh noiso-6 --fileParallelism
  --maxWorkers=6`. List the files that fail only without isolation, then re-run each alone to
  confirm.
- [ ] If those files are a small set: split the server config into a non-isolated default project
  and an isolated project listing them (`@paperclipai/server-isolated`). If many fail, try `vmForks`
  instead and pick by the numbers.
- [ ] Commit the winning settings.

**Done when:** `results-overhead.md` has the floor breakdown, the cache cold and warm numbers, the
staleness check, and wall times at 1 and 6 workers for each isolation setting; the passed count
matches the baseline; nothing fails that passes in the baseline.

---

## Agent C: Postgres for tests

**Branch:** `test/postgres` · **Owns:** `packages/db/src/test-embedded-postgres.ts`,
`test-postgres-admin.ts`, `test-postgres-command.ts` and their tests in `packages/db/src/`,
`fork/test-suite-audit/results-postgres.md`.

**Interfaces:**
- Produces: tuned test clusters by default. `PAPERCLIP_TEST_POSTGRES_DATA_ROOT` chooses where
  cluster data lives. The measured comparison with one shared server
  (`test-postgres-command.ts`) is for the PM to wire in after the round.

### Task C1: Tuned flags

- [ ] Write a failing test with `__setEmbeddedPostgresCtorProviderForTests`: test clusters (template
  build and per-suite start) are created with `fsync=off`, `synchronous_commit=off` and
  `full_page_writes=off`. Check how the installed embedded-postgres passes server flags
  (`postgresFlags`) before writing it.
- [ ] Implement it, then run the db tests with at most 2 workers:
  `corepack pnpm exec vitest run --project @paperclipai/db --maxWorkers=2`.
- [ ] If the flags change the template's data directory, add them to
  `computeEmbeddedPostgresTemplateKey`. Other worktrees share `/tmp`'s template cache, so a changed
  template must not reuse the old key.
- [ ] `bench.sh pg-tuned`. Commit.

### Task C2: Data on tmpfs

- [ ] Write a failing test: cluster data goes under `PAPERCLIP_TEST_POSTGRES_DATA_ROOT` when it's
  set; by default under `/dev/shm` on Linux when it exists and has at least 1 GB free; otherwise
  `os.tmpdir()`.
- [ ] Implement it, and decide whether the template root moves with it (copy speed against RAM).
- [ ] `bench.sh pg-shm`. Afterwards, nothing of ours is left in `/dev/shm`. Interrupt a bench run with
  Ctrl-C partway, then check for leftover `postgres` processes and directories. Commit.

### Task C3: One shared server

- [ ] Benchmark under `node cli/node_modules/tsx/dist/cli.mjs packages/db/src/test-postgres-command.ts -- fork/test-suite-audit/bench.sh pg-shared`,
  then again with `--fileParallelism --maxWorkers=6`, against per-suite clusters at the same
  settings. Report only; don't wire it in.

**Done when:** the db tests pass; `results-postgres.md` has tuned, shm and shared numbers against
the baseline; no processes or data directories are left behind.

---

## Agent D: classification and area review (no test runs)

**Branch:** `test/classify` · **Owns:** `fork/test-suite-audit/classification.csv`,
`fork/test-suite-audit/area-review.md`.

**Interfaces:**
- Produces: `classification.csv`, with columns
  `file,project,area,label,proposed_tier,reason,postgres,lines,ci_s,local_s`. `label` is
  `ours|shared|dormant`. `proposed_tier` is `thorough|optin|remove|split`. `ci_s` comes from
  `scripts/*-shard-durations.json` and `local_s` from `profile-2026-11-18.csv` (blank when
  missing). Round 2 turns the user's decisions into `scripts/test-tiers.json`.

### Task D1: Classify every file

- [ ] List every test file in the default run: each project in the root `vitest.config.ts`, by its
  include patterns. The count is the total to match.
- [ ] For each, record the project and area (folder and name groups, as in
  [repo-map.md](repo-map.md#5-tests)), plus Postgres use, line count and the times. The label rests
  on evidence: what the file imports (`native-runtime`, `chat-channels`, `paperclip-runner`, cloud,
  managed, remote, sandbox, other adapters) and what it exercises. A file that mostly tests dormant
  paths through shared code gets `shared`, with a reason.

### Task D2: Proposals

- [ ] Proposed tiers: `dormant` → `optin` (`remove` only where the subsystem is slated for removal);
  core and `ours` → `thorough`; `shared` files mostly about dormant paths → `split`. Give a reason
  for each.
- [ ] `area-review.md`, written for the user to decide area by area. One table row per area: files,
  recorded time, label, proposal, and the question to answer. Totals should match the audit within
  about 5%.
- [ ] Slow core tests (over 5 s in the profile): the likely cause, from reading the code (real
  timers, poll intervals, deadlines), and a suggested fix. This is the input for round 2's slow-test
  work.
- [ ] Core files over 5,000 lines: whether splitting would help parallel balance.
- [ ] Commit.

**Done when:** the CSV covers every file in the default run, with the count checked against the
include patterns; `area-review.md` totals match the audit within about 5%.

---

## After round 1 (PM)

- Review and merge C, then B, then A (A's default worker count may move with B's isolation
  setting). Benchmark the combination, then run the whole thorough tier once with `pnpm test` and
  put the real number in the audit.
- Take `area-review.md` to the user, area by area. **Done 2026-11-18** (its Decisions section).
- Step 4a: run its regression set with the new runner, and merge `feat/step-4a` before round 2
  starts editing test files. Its branches change many route-test fixtures.

### Round 1 progress

- **D merged** 2026-11-18 (`5c99f4f7cd`): `classification.csv`, `area-review.md`.
- **A merged** 2026-11-18 (`c99cc73640`): `scripts/test.mjs`, 8 workers by default, `serialServer`
  empty (no file failed only in parallel, including upstream's 178 serialized suites). Bench set at 8
  workers: 128.8 s mean against 695.0 s. `quick` picks tests by name and direct import instead of
  the plan's directory fallback (Vitest's `--changed` picked ~1,370 files); kept pending the user's
  OK. [results-runner.md](test-suite-audit/results-runner.md).
- **C merged** 2026-11-18 (`cda8495e8e`): durability off, cluster data on `/dev/shm`, cleanup on
  interrupt and a sweep of leftovers. The shared server isn't wired in (no gain in parallel).
  [results-postgres.md](test-suite-audit/results-postgres.md).
- **B merged** 2026-11-18 (`4df9b0a59e`): `fsModuleCache` on; the server project split into
  `@paperclipai/server (shared)` (`isolate: false`, 1,723 files) and `@paperclipai/server (isolated)`
  (497 files that replace modules with `vi.mock` and the like). Bench set: 538.8 s at 1 worker,
  116–120 s at 6 workers. [results-overhead.md](test-suite-audit/results-overhead.md).

**Full runs after round 1** (2026-11-18, `pnpm test`, 8 workers, every file since `optIn` is empty):

| Run | Wall | Server | Packages | Failed files |
| --- | --- | --- | --- | --- |
| As merged (shared project without isolation), with the chat suite | 51m27s | 48m (47,434 passed, 204 failed) | 3m30s | 47 |
| Isolation forced everywhere, without the chat suite | 55m22s | 51m52s (45,660 passed, 12 failed) | 3m30s | 8 |

- About 39 files failed only without isolation, from state left by earlier files in the same worker
  ("Cloud runtime configuration has not been initialized", `PAPERCLIP_MANAGED_CONFIG` blank,
  counters). The shared project is isolated again (`4473fad4dc`) until round 2 finds them. The 8
  that remain are bug 42.
- The time is total work, not one long file: the files' own durations add up to ~280
  worker-minutes, plus ~4 s of import per isolated file (~150 worker-minutes). With the user's tiers
  (~55% of server work stays), the thorough tier should take about 30–35 minutes isolated, or 20–25
  once the shared project works.

Follow-ups reported by the agents, for round 2:

- Update `doc/test-infrastructure.md` ("Embedded Postgres template cache") for C's changes: flags,
  data root, cleanup on interrupt (C's report, in `results-postgres.md`).
- `packages/db/src/prepared-queries-postgres.test.ts` › "retries a pooled statement unprepared…"
  failed once in a 2-worker run and passed 6 times alone: probably timing-sensitive.
- Some tests leave read-only (0555) folders in `TMPDIR`; the runner now copes with them.
- Upstream's runner (`test:run`, used only by upstream's workflows) now stops at its chat phase:
  `scripts/test-line-shard.mjs` expects the project name `@paperclipai/server`. Retire it with
  upstream's CI, or accept names starting with `@paperclipai/server (`.
- `fsModuleCache` in the root config doesn't reach package projects with their own config; the
  runner can pass `--fsModuleCache` to every phase.
- Test homes are never removed: `setup-supertest.ts`'s `exit` cleanup doesn't fire in fork workers.
  About 2,500 `paperclip-vitest-home-*` directories (1.9 GB) are in `/tmp`, plus
  `paperclip-vitest-codex-home-*` and 545 `/tmp/pv-*` folders from upstream's runner.
- The setup file's `beforeEach` costs ~0.4 s in isolated files that don't otherwise load drizzle
  (`services/instance-settings-cache.ts`).
- **The default worker count is a fixed 8** (`defaultWorkers` in `scripts/test.mjs`), measured on
  the desktop (16 cores, 22 GB). server1 has 14 GB shared with the real instance: until the default
  scales with the machine's cores and free memory, run it there with `--workers 4` inside
  `systemd-run --user --scope -p MemoryMax=…` (CLAUDE.md, "Dev work on server1"). Memory with
  B's shared (non-isolated) workers hasn't been measured.
- A SIGKILLed worker can still orphan a running Postgres (the sweep removes its directory only once
  the postmaster is dead).

## Round 2

Approved by the user on 2026-11-18, with these decisions:

- `test:quick` keeps agent A's selection (tests named after the changed file, plus tests that import
  or mock it).
- Upstream's 38 workflows in `.github/workflows/` are deleted; they stay readable at
  `upstream-freeze`. Our CI runs on **every push to any branch** and on pull requests, on GitHub's
  standard runners (the repo is public, so they're free).
- Bug 42's `shipped-catalog` fix and a longer `github-launcher` timeout go to agent E; bug 40's
  intermittent core lease test goes to agent G.
- Approving agent G signs off D's slow-test list as a whole; each file's before-and-after is
  reported at merge.
- The old `/tmp` leftovers were deleted (2026-11-18: 2,502 test homes, 2,109 codex homes, 565
  `pv-*` folders, ~4.2 GB).

**Rules for every round 2 agent,** on top of round 1's Global Constraints: don't edit a file that
another round 2 agent owns, and don't edit the 30 test files step 4a changes (`git diff --name-only
$(git merge-base main origin/feat/step-4a) origin/feat/step-4a`). Report instead.

| Agent | Branch | Owns | Goal |
| --- | --- | --- | --- |
| E. Tiers and splits | `test/tiers` | `scripts/test-tiers.json`, the 10 split files and their new opt-in siblings, `classification.csv`, `packages/skills-catalog/src/shipped-catalog.test.ts`, `packages/adapter-utils/src/github-launcher.test.ts` | Fill `optIn` from the [decisions](test-suite-audit/area-review.md#decisions-2026-11-18); split the 9 files and `heartbeat-process-recovery`; bug 42's two fixes |
| F. Leaking files | `test/leaks` | `server/vitest.config.ts`, `server/src/__tests__/setup-supertest.ts`, new helpers in `server/src/__tests__/helpers/`, leaking files no one else owns | Find what the [39 suspects](test-suite-audit/leak-suspects.txt) were broken by; fix with resets or isolate the leakers; shared project back to `isolate: false`; test homes removed after each run |
| G. Slow core tests | `test/slow` | The core files in D's [slow-test table](test-suite-audit/area-review.md#slow-core-tests), `issue-recovery.test-fixture.ts`, `legacy-controller-lease.test.ts`, small injection points in the source they test | Fake timers or test-sized intervals instead of real waits, shorter `pg_sleep`, single-statement seeding; bug 40 |
| H. CI and runner | `test/ci` | `scripts/test.mjs`, `scripts/__tests__/test-runner.test.mjs`, the root `package.json` test scripts, `.github/workflows/` | `--shard i/n` balanced by recorded time; default workers from cores and free memory; `--fsModuleCache` on every phase; one workflow (typecheck + thorough, sharded, ~20 min) |

**Round 2 progress:**

- **E merged** 2026-11-18 (`b6e7076fae`): `optIn` has 256 entries; thorough 1,412 files (server
  1,189, packages 223), opt-in 1,333. 9 files split into live and `.dormant.test.ts` halves, with
  shared setup in `.fixture.ts` files; `agent-instructions-service` stays whole (its "managed" tests
  are Paperclip-managed instruction bundles, which `claude_local` uses). Bug 42 fixed. The hermes
  adapter's `vitest.config.ts` no longer sets `exclude`, which made Vitest ignore the runner's.
  Notes for H: a project-relative `--exclude` never matches a leading `**/`, and one that matches a
  directory drops everything under it; plain `vitest` in a built tree also runs packages' `dist/`
  test copies (the runner excludes them).

- **G merged** 2026-11-18 (`88e1b5bb6b`): the slow core files went from 2,317 s to 1,322 s of file
  time with the same tests and assertions (the `issue-recovery-*` family 621 s → 57 s,
  `deferred-execution-receipt-work` 268 → 142 s, `live-recovery-work` 228 → 133 s): wall-following
  fake clocks stepped over idle deadlines, `pg_cancel_backend` on `pg_sleep` waits, single-statement
  seeding. [results-slow.md](test-suite-audit/results-slow.md). Decided with the user: the five
  census files (idle-backstop, live-run-agent-census and others, ~500 s, which simulate a large
  company over 10–70 minutes) stay in thorough; `failed-continuation-continues-again` is left as is.
- **Bug 40 is a real production bug** (G): Linux start times are `btime` (whole seconds, recomputed
  from the wall clock on every read, drifting ~1 s per 30 s on WSL) plus start ticks, so two readings
  of a live process can differ by whole seconds and recovery fails a live run as `process_lost`. The
  user chose G's option 1: a whole-second gap counts as the same process for `btime`-based readings
  (a reused PID matches by chance 1 time in 100, and its record is held until the PID exits). G is
  finishing it on `test/bug40`. Exact boot-relative start ticks in every stamp (option 2, a new field
  and a migration) are worth revisiting in step 4b.
- **Upstream's 38 workflows disabled on GitHub** 2026-11-18 (`gh workflow disable`, reversible), so
  pushing the `master` mirror no longer starts them. Our `test.yml` comes with agent H's merge.

Merge order: E and G, then F (its final full run includes G's changes), then H. Then the PM writes
the workflow (quick before pushing, thorough in CI and before merging into `main`, opt-in on demand)
into `CLAUDE.md`, the `/pm` briefs and `doc/test-infrastructure.md`.
