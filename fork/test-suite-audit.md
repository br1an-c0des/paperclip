# Test suite audit

**2026-11-18. First audit for [hard-fork step 3a](hard-fork-plan.md#3a-renovate-the-test-suite).**
What `pnpm test` costs today, where the time goes, and the fixes to try, each with how to measure it.
Nothing here has been changed yet.

## Summary

- **A full `pnpm test` takes about 7.6 hours** on this machine (16 cores, WSL). That's 34 minutes
  measured for the chat suite, 143 minutes measured for the first 304 general server files, and the
  rest estimated from those measurements and upstream's recorded CI times.
- **More than half of it is per-file overhead, not testing.** Each server file costs about 8 seconds
  before and after its tests: 3.6 s to import the server's modules and 4.2 s of Vitest setup between
  files. Across ~2,000 server files that's about 4.4 hours.
- **It uses one core.** Server files run one at a time (`--maxWorkers=1`), because upstream gets its
  parallelism from many CI machines.
- **About a quarter is dormant code**, plus the 34-minute chat-channel suite.
- **Embedded Postgres isn't the main cost.** A cluster starts in 0.46 s and cleans up in 0.17 s.
  Durability settings add about 20% to the tests' own database work.
- **A few slow tests add up.** In the first 304 files, 95 tests took over 5 seconds each: 25
  minutes, mostly recovery and lease scenarios that wait on real time.
- **11 tests failed in 4 files** during the run. One file, `legacy-controller-lease.test.ts`, covers
  core code.

The goal, 10–20 minutes for the thorough set, looks reachable. Parallel workers and less per-file
overhead together should get most of the way, and the rest comes from leaving dormant suites out
and fixing the slowest tests.

## How it was measured

- The real `corepack pnpm test` (`scripts/run-vitest-stable.mjs`, mode `all`) with the repo's own
  profiling reporter on (`PAPERCLIP_CI_PROFILE=true`). It records each file's start, duration and
  import (collect) time, and each test's duration.
- Started 2026-11-18 04:35 UTC, stopped at 07:33 after the 6 chat shards and 304 general server files
  (21,911 tests). Nothing else was running tests at the time.
- Per-file results for those 304 files: [test-suite-audit/profile-2026-11-18.csv](test-suite-audit/profile-2026-11-18.csv).
- Separate experiments, using private template and cache directories so they didn't affect the run:
  - a Postgres fixture benchmark (5 start and cleanup cycles);
  - `issues-service.test.ts` run with fsync on and off, twice each;
  - the same file with `fsModuleCache` on, three times.
- Upstream's recorded CI times per file come from `scripts/*-shard-durations.json`.

**Caveats.**
- Vitest runs the biggest files first, so the 304 files measured are the heavy end. The other ~1,700
  are estimated: their recorded CI times, scaled by how this machine compared on the measured files
  (local 121 minutes against 171.5 recorded), plus the measured gap between files.
- The packages (db, CLI, adapters, plugin SDK) weren't reached. They're estimated at about 15 minutes
  from upstream's notes in the runner.
- `ui-new`'s tests (vitest and Playwright) aren't part of `pnpm test` and weren't measured.

## Where the time goes

| Phase | Files | Time | Source |
| --- | --- | --- | --- |
| Chat shards (one file, 6 slices) | 1 | 34 min | measured |
| General server, first 304 files | 304 | 143 min | measured |
| General server, the rest | ~1,550 | ~228 min | estimated |
| Serialized route and authz suites | 173 | ~35 min | estimated |
| Packages: db, CLI, adapters, SDK | ~380 | ~15 min | estimated |
| **Total** | | **~7.6 h** | |

Inside the 304 measured files (143 minutes of wall time):

| Part | Time | Share |
| --- | --- | --- |
| Tests and their hooks | ~104 min | 73% |
| Gaps between files (Vitest process setup and teardown) | 22 min | 15% |
| Importing modules (collect) | 17 min | 12% |

For the remaining, smaller files the overhead dominates. Their tests average about a second per
file against roughly 8 seconds of overhead.

## Findings

### 1. The runner was built for upstream's CI

`scripts/run-vitest-stable.mjs` exists to split the suite across many CI machines: duration-balanced
shards, a 6-way split of a single file, retry and stalled-file reporters. Run without shard
arguments, as `pnpm test` does, it does everything one piece at a time:

- the server project runs with `--no-file-parallelism --maxWorkers=1`, so one file at a time on a
  16-core machine;
- 27 separate Vitest runs go one after another: 6 chat shards (each also runs `vitest list` over the
  whole chat file first), 1 general server, 1 serialized, and 19 package projects in 3 groups;
- the first failure stops the run. Each phase is awaited in turn and a non-zero exit skips every
  later phase, so a failure in the general server phase means the packages and route suites never
  run.

`server/vitest.config.ts` explains the one-at-a-time setting: tests were flaky on loaded CI
machines. Separately, `run-vitest-stable.mjs` already runs 3–4 isolated files at once in its
sharded CI groups. So parallel files work on the server project in principle.

### 2. Per-file overhead is the biggest cost

- **Import:** a median 3.6 s per file (90th percentile 4.1 s) to load the server's module graph.
  `isolate: true` with `pool: "forks"` gives each file a fresh process that imports everything
  again.
- **Between files:** a median 4.4 s from one file's end to the next file's start, 4.0 s after files
  that don't use Postgres. That points at Vitest's per-file process setup and teardown, not the
  database.
- **Cold compile:** each Vitest process compiles the TypeScript from scratch. In a single-file run
  that took ~12.5 s. With `fsModuleCache` on and warm it took ~2.6 s, and wall time went from 39 s to
  29 s. The repo doesn't enable it.

### 3. Dormant code

By file name, about 25% of the measured server time (79 of 304 files, 30 of 121 minutes) is in
dormant areas: the native runtime and Runner, cloud, managed, remote and sandbox execution, and other
adapters. Across all of upstream's recorded server times the share is 26%. On top of that:

- **Chat channels:** `chat-channels.integration.test.ts` is 86,288 lines and 1,970 tests, run as 6
  shards of about 5.5 minutes each. 34 minutes measured, for the chat-channel connectors (dormant per
  [repo-map.md](repo-map.md)).
- **The Runner build:** `plugin-runner-probe.test.ts` and three other native-runtime suites run
  `cargo build --release` for the Runner in `beforeAll`. Cargo is installed here, so they build.
- **Real-time waits:** the longest literal waits in tests (25–50 s `setTimeout`s) are almost all in
  `native-runtime`.

Name matching undercounts. Shared areas like recovery, workspaces and heartbeat also test native and
remote paths, so the area review (step 3a, part 2) will find more.

### 4. Slow tests

Of the 21,911 tests that ran, 20,648 took under a second each (53 minutes in total). The long tail
is 1,168 tests at 1–5 s (33 minutes), 62 at 5–15 s (8 minutes) and 33 over 15 s (17 minutes).

The slowest are recovery and lease scenarios:

| File | Measured | Longest tests |
| --- | --- | --- |
| `deferred-execution-receipt-work.test.ts` | 4.5 min | 65 s, 36 s, 35 s, 35 s |
| `live-recovery-work.test.ts` | 3.9 min | 66 s, 65 s, 38 s |
| `workspace-recovery-warm-handoff.test.ts` | 3.0 min | 32 s, 21 s, 4 × 16 s |
| `issue-recovery-deadlines.test.ts` | 2.6 min | 38 s, 36 s, 33 s, 32 s |
| `heartbeat-native-restart-suspension.test.ts` | 2.4 min | 60 s, 30 s, 20 s |

Tests that take 30–66 s are usually waiting on real deadlines, lease renewals or polling. They can
often use fake timers, or shorter intervals set for tests. Some of these files test dormant paths
(native, remote, managed). Others test recovery the legacy path uses too, so each needs a look
before anything changes.

### 5. Postgres

- 845 of the 2,212 server test files start an embedded Postgres, from a migrated template cached in
  `/tmp` (87 MB, built once in ~11 s).
- A suite's cluster: 0.46 s to start, 0.17 s to stop and clean up. That's ~9 minutes across all of
  them.
- The clusters run with default durability (fsync on) on the ext4 disk. Test cleanup deletes tables
  one statement at a time (`issues-service.test.ts` has 120 `db.delete` calls), and every statement
  waits on a disk flush. With fsync, `synchronous_commit` and `full_page_writes` off, that file's
  test time fell from ~22 s to ~17 s.
- `run-vitest-stable.mjs` has a ready-made alternative it doesn't use locally:
  `packages/db/src/test-postgres-command.ts` starts one server and gives each suite its own database
  from the template (`PAPERCLIP_TEST_POSTGRES_ADMIN_URL`).

### 6. Size and shape

- Server: 717k lines of source, 982k lines of tests (ratio 1.37), 2,212 test files, about 27,000
  `it`/`test` calls.
- 11 test files are over 5,000 lines. The largest: `chat-channels.integration.test.ts` (86,288),
  `native-session-executor.test.ts` (24,001), `tool-access-service.test.ts` (21,476),
  `heartbeat-process-recovery.test.ts` (17,661), `workspace-runtime.test.ts` (10,226).
- About half of upstream's 8,194 commits carry an AI co-author or "generated with" line. The suite
  grew a regression test at a time, appended to existing files.

### 7. CI on the fork

`.github/workflows/` holds upstream's 38 workflows. Actions is enabled on `br1an-c0des/paperclip`.
They last ran on 2026-10-25 (scheduled, on `master`) and have never run on `main`, so nothing checks
pushes today.

### 8. Failures seen

11 tests failed in 4 files. The run was stopped before Vitest printed its failure summary, so the
reasons weren't captured:

| File | Failed | Area |
| --- | --- | --- |
| `server/src/services/native-runtime/retained-provider-pack-source.test.ts` | 6 | dormant (native) |
| `server/src/__tests__/heartbeat-native-restart-suspension.test.ts` | 2 | dormant (native); also failed in step 4a's overloaded run |
| `server/src/services/legacy-controller-lease.test.ts` | 2 | **core**: the lease that keeps a `claude_local` run owned by this server ([claude-local-run.md](claude-local-run.md)) |
| `server/src/services/native-runtime/native-session-resume.test.ts` | 1 | dormant (native) |

## Fixes to test

Ranked by expected saving. Each one gets a before-and-after measurement on the same files, on this
machine, with nothing else running.

| # | Fix | Expected saving | How to measure | Risk |
| --- | --- | --- | --- | --- |
| 1 | **Parallel server files** locally: `--fileParallelism --maxWorkers=N` with N around 6–8 | The largest. Wall time divides by about N if CPU and disk keep up: 7.6 h → ~1–1.5 h on its own | Run the 304 profiled files at N = 1, 4, 6, 8 and compare wall time and failures | Flakes from shared state (ports, home directories, timing). The CI groups already run 3–4 at once, so most files cope. The ones that don't go in a serial group |
| 2 | **Leave dormant suites out** of the default run: an opt-in project or group, decided per area | ~25–30% of server time plus the 34-minute chat suite | Count and time what the default run drops | None to the code we run, as long as the area labels are right. Shared files need a per-file look |
| 3 | **Cut per-file overhead:** try `isolate: false` (one process per worker, modules loaded once), Vitest's `vmForks` pool, and `fsModuleCache` | Up to ~8 s per file, most of ~4.4 h serial | Same 304 files and a sample of small files, with each setting | `isolate: false` breaks files that rely on `vi.mock` or global state (439 files use `vi.mock`). Likely only for files that pass a check, or for unit-only groups |
| 4 | **Shared Postgres server** via `test-postgres-command.ts`, one database per suite | ~0.6 s per Postgres file, ~9 min serial | Time the Postgres-using files with and without it | Low. It's upstream's own path, used in CI |
| 5 | **Test-tuned Postgres**: fsync, `synchronous_commit` and `full_page_writes` off; data directory on tmpfs | ~20% of Postgres files' test time | `issues-service` plus 20 Postgres-heavy files, before and after | None for throwaway databases. A tmpfs data directory needs RAM: 87 MB per running cluster |
| 6 | **Fix the slowest tests**: fake timers or test-sized intervals for the recovery, lease and deadline scenarios | ~25 min in the first 304 files; more across the suite | Per-test timings from the profile reporter | Medium. These test timing behaviour, so each change needs care. Dormant ones go with fix 2 instead |
| 7 | **One Vitest process per tier** instead of 27 serial ones, so compiled modules and workers are shared | Minutes (cold compiles, 6 `vitest list` passes) | Wall time of the whole run | Low |
| 8 | **Don't stop at the first failure**: run every phase and report all failures together | No time saved, but one run shows every problem | | None |

Fixes 1 and 3 interact: with N workers the overhead is spread across cores, so its share of wall time
stays similar. Both together are what could reach the 10–20 minute target.

### Rough projection

Without dormant suites (~1.8 h of server time and 34 min of chat), the serial run is about
5.3 hours. Cutting per-file overhead from ~8 s to ~2 s across the ~1,500 remaining server files
brings it to about 2.8 hours, and 8 workers to about 20 minutes. Faster slow tests and Postgres tuning give some margin. All of these are estimates
until each fix is measured.

## Next

Step 3a's parts, in order: finish the profile (part 1); review each area with the user and sort its
tests into quick local, thorough CI, opt-in or removal (part 2); then try the fixes above, measured
(parts 3–5), set up CI (part 6), and write down the workflow (part 7).
