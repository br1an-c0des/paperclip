# Step 3a round 2, agent G: slow core tests

Branch `test/slow`. Work list: [area-review.md, "Slow core tests"](area-review.md#slow-core-tests),
plus bug 40 ([upstream-fixes.md](../upstream-fixes.md#40-find-why-11-server-tests-fail-on-main-one-file-is-core)).

## How it was measured

Both timings are one Vitest run of the whole set (the 32 files below, one file at a time as
`server/vitest.config.ts` sets it), taken under the benchmark lock on the desktop (16 cores, 22 GB),
2026-11-18. Times are each file's own duration from the JSON report (without its ~4 s import).

- Before (`dfca080da0`): 2,528 s wall, 912 passed, 0 failed, 1 skipped.
- After (`52549253ed`, then `fe37c3bb4a` for one file): 1,548 s wall for the same 32 files plus 4 more fixture users (below),
  924 passed (912 + 12), 0 failed, 1 skipped. The 32 files alone: 2,317 s -> 1,322 s of file time.
- Same tests and assertions throughout: no test was renamed, removed or sampled.
- Each changed file then ran 3 more times outside the lock (2 workers): see "Repeat runs".

## Before and after

| File | Tests | Before s | After s | What changed |
| --- | --- | --- | --- | --- |
| `deferred-execution-receipt-work` | 50 | 268.3 | 142.2 * | `waitForWake`: while no pass is in flight and no run is queued or running, a failed attempt steps the fake clock to `coordinator.nextWakeAt()` (30 s reconstruction interval, 30 s delayed resume), then back to wall time. The literal 31 s sleep is a fake 31 s advance; that case's first idle wait stays on wall time (see "Clocks") |
| `live-recovery-work` | 51 | 228.0 | 132.6 | `start(true)` uses a fake clock with `shouldAdvanceTime` (wall time for leases, fake for quiet()'s 31 s step) instead of Node's timers. The native execution-lease case keeps unfaked timers (`start("unfaked")`): dormant, see below |
| `issue-recovery-assignments` | 7 | 201.5 | 18.7 | Fixture (below); its drain case keeps the fixture's clock after its 90 s check |
| `issue-recovery-dependencies` | 5 | 164.6 | 11.6 | Fixture |
| `issue-recovery-deadlines` | 20 | 156.7 | 21.0 | Fixture |
| `issue-recovery-conversations` | 3 | 65.0 | 4.1 | Fixture |
| `issue-recovery-work-debug-attribution` | 3 | 33.2 | 1.5 | Fixture |
| `issue-recovery-idle-backstop` | 4 | 220.1 | 215.0 | Left: simulated hours, see below |
| `issue-recovery-live-run-agent-census` | 4 | 166.7 | 149.1 | Left: simulated hours |
| `issue-recovery-company-reload-census` | 8 | 62.6 | 58.8 | Left: simulated hours |
| `issue-recovery-activity-hints` | 1 (+1 skipped) | 55.0 | 43.5 | Left: simulated hours |
| `issue-recovery-agent-row-write-census` | 6 | 39.8 | 37.4 | Left: simulated hours |
| `issue-recovery-recorded-decision-idle` | 2 | 11.7 | 9.3 | Unchanged (own clock) |
| other `issue-recovery-*` (pass-reads, review-wait-pass, saved-deferrals, signal-fanout, terminal-run-settling, work-lifecycle) | 32 | 11.8 | 11.1 | Unchanged |
| `ownership-reconciliation-report` | 47 | 58.6 | 24.1 | The follow-up case runs on a fake wall-following clock and its poll steps to the worker's next pass (one full pass per 30 s) |
| `attention-service` | 45 | 59.4 | 44.2 | The two bind-limit cases seed their 16,400 runs and events with one `insert … select from unnest()` per table (same rows, same order) instead of 17 chunks each |
| `controller-instance-lease` | 26 | 20.8 | 8.9 | `pg_cancel_backend` on the `pg_sleep(12)` once the saturated-pool assertion passed |
| `legacy-controller-lease` | 44 | 21.8 | 7.1 | Same for its five `pg_sleep(5)` (one on a 1-connection pool, four on the 2-connection liveness pool) |
| `satisfied-connection-intents` | 56 | 31.1 | 27.6 | The setup-card case's worker `retryMs` 5 s -> 1 s (test-sized; the passive pass still finds the unsignalled change) |
| `isolated-repository-rehome` | 28 | 74.8 | 62.6 | The clone-file-budget case creates and removes its 1,001 folders concurrently |
| `failed-continuation-continues-again` | 32 | 34.6 | 35.6 | Left: see below |
| `nested-clone-migration` | 21 | 57.2 | 50.3 | Left: see below |
| `agent-directory-working-copies` | 121 | 55.6 | 51.1 | Left: see below |
| `workspace-runtime` | 179 | 82.4 | 73.0 | Left: see below |
| `attention-retention-work` | 58 | 55.1 | 47.1 | Left: volume by design (area review: keep) |
| `status-card-evaluation-work` | 37 | 38.0 | 34.4 | Left: see below |
| `issue-tree-pause-resume-run` | 22 | 42.9 | 38.3 | Left: see below |

\* Timed alone under the lock after a follow-up fix (`fe37c3bb4a`); the batch run had 104.4 s
for the earlier version, which failed 1 repeat in 4.

The files marked "left" or "unchanged" moved by a few seconds between the two runs; that is noise
(the machine was shared with three other agents), not a change.

**Other users of the issue-recovery fixture** (not in the list, checked because the fixture changed),
before -> after under the lock: `assigned-work-recheck-idle` 20.3 -> 19.0 s (3),
`continuation-delivery-unwakeable-agent-idle` 2.7 -> 2.5 s (5),
`native-failed-run-owner-release-idle` 2.3 -> 2.1 s (2), `resolved-dependency-candidates`
2.4 -> 1.6 s (2). All pass. `issue-recovery-actions` (a step 4a file) doesn't use the fixture.

## The fixture change (`issue-recovery.test-fixture.ts`)

- `start()` installs `vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"],
  shouldAdvanceTime: true })` unless the case already installed a clock (the census files do).
  Child processes and PostgreSQL leases still see wall time.
- `stepToWake(deadlines)`: when no delivery pass is in flight and no run is `queued` or `running`,
  advance the fake clock to the earliest worker deadline, let the passes settle, then
  `vi.setSystemTime(vi.getRealSystemTime())`. That last step matters: a run claimed later gets a
  lease that PostgreSQL stamps (`clock_timestamp() + 60 s`) and the controller times against
  `Date.now()`; without it a clock 60 s ahead fails the run with `controller_lease_lost`.
  Pending timers keep their remaining delays across `setSystemTime`.
- `settled()` steps while its wake is pending; `finish()` steps while scheduled retries remain.
- `quiet()` keeps the workers' clock after its 20-minute no-SQL check (and sets it back to wall
  time) instead of `useRealTimers()`, which would drop every armed worker timer. Its check now
  covers the workers' own timers too, which it didn't when they were real.

## Clocks: what to watch for

Stepping a fake clock ahead of PostgreSQL is safe only while nothing compares the two.
Two things do: a legacy run's controller lease is stamped by PostgreSQL
(`clock_timestamp() + 60 s`) and timed against `Date.now()`, so a run claimed while the fake
clock is 60 s or more ahead loses its lease at once (`controller_lease_lost`); and some deadlines
are stamped with `Date.now()` into rows (a saved input's 30 s resume delay), so setting the clock
back after a step can push them into the future. The helpers step only while nothing executes and
set the clock back to wall time afterwards; the one case that needs both (saved conversation input,
then a resumed run) keeps its first idle wait on wall time.

## Left, and why (design decisions or by design)

- **Census files** (`idle-backstop`, `live-run-agent-census`, `company-reload-census`,
  `activity-hints`, `agent-row-write-census`; ~500 s together): they already run on fake timers.
  Each simulates 10-70 minutes of a staging-shaped company (800+ tasks) in 1 s steps and counts
  checks and statements. The cost is the real recovery work plus thousands of steps. Options:
  (a) step to the next worker deadline instead of every second (fewer steps; needs checking
  that the statement and check counts still hold, since work started by one timer would no longer
  settle before the next fires within a step); (b) move them to opt-in as soak tests; (c) keep.
- **`failed-continuation-continues-again`**: no timers. "no entry point continues a person-owned
  or permanent cause" loops over ~40 failure codes through the real entry points; "six automatic
  attempts…" is small but runs after it and its sweep reads every company's rows: the file never
  truncates between tests, so later tests pay for earlier data. Options: truncate in `beforeEach`
  (changes what data each test sees: a decision), or keep.
- **`nested-clone-migration`**: the 3 s wait proves two migrations don't reach `beforeVerify` while
  the base lock is held. A shorter wait weakens that negative check; a real fix needs a signal
  that a migration is waiting on the lock (a small hook in `nested-repository-worktrees.ts`). The
  rest is real git work.
- **`agent-directory-working-copies`**: the slow cases hash 256 MiB sparse files and walk
  100,001 directory entries, and assert those limits' values (`MAX_AGENT_FILE_BYTES`, the
  "100,000-entry limit" message). Lowering them would change the assertions.
- **`workspace-runtime`**: "does not accept an occupied allocated port…" starts and stops all 32
  candidate processes and asserts `attemptedPortCount === WORKSPACE_RUNTIME_PORT_ALLOCATION_ATTEMPTS`.
  By design.
- **`status-card-evaluation-work`**: "twenty cards" is the bound under test; fewer cards would be
  a different test.
- **`issue-tree-pause-resume-run`**: "keeps an uncertain mid-turn Stop held…" spends ~8.7 s in the
  drain right after the pause (the run's adapter resolves on abort at once; the next server log
  line is ~10 s later). Likely the executor noticing the cancellation at its next legacy-lease
  renewal (`LEGACY_CONTROLLER_RENEW_MS` = 10 s), not confirmed. Needs a look in the source.
- **`controller-instance-lease`** row-lock case: waits the real 8 s server
  `RENEW_STATEMENT_TIMEOUT_MS` it measures.
- **`attention-service`** "checks more failed runs for a newer run than one statement can bind":
  still ~25 s of `attentionService.list` over 16,400 runs, production code, not seeding. Possibly
  worth a look as a performance bug.

**Dormant cases in shared files, candidates for opt-in** (not sped up, per the brief):
`live-recovery-work` › "renews a native execution lease without scheduling recovery…" (38 s,
native runtime), `heartbeat-observed-workspace-preservation`'s native case,
`connection-management.integration`'s Slack cases, `heartbeat-workspace-busy`'s sandbox case,
`heartbeat/recovery`'s remote lease, `managed-skill-content`'s Cloud cases.

## Bug 40

**Cause (a real source bug).** On Linux `readLinuxProcessStartedAt` computes a process's start as
`/proc/stat` btime plus its start ticks. btime is whole seconds and is re-derived on every read as
wall clock minus time since boot. When the wall clock moves against the boot clock (NTP, a VM or
WSL syncing its clock), every later reading of the same live process moves by whole seconds while
the sub-second part (from the ticks) stays the same. On this WSL desktop btime grew by one second
about every 33 s (logged for 3 minutes on 2026-11-18). The test's controller stamp uses
`currentProcessStartedAtMs()`, read once and cached; the reaper reads the PID again later. Once the
gap reaches 1 s the owner prover (`owner-proof.ts`, `compareStarts`) sees a live PID that "started
at least 1 s after the stamp", proves it reused (`pid_reused`) and the run fails
`process_lost`. Rounding and tick resolution are not the cause: the tick part is identical.
In production the same thing can fail a live `claude_local` run, or release a live owner's
record, whenever a stamp and a later check straddle a clock change, for controller stamps and for
child-process stamps (`persistHeartbeatRunProcessMetadata` also reads `/proc`).

**Proposed fix, on the side branch `test/slow-bug40` (`a7fbdbdd1b`, one commit on top of
`test/slow`), not merged into `test/slow`:** the real probe says its start times come from btime (`startClock: "linux_btime"`),
and for such readings a gap of a whole number of seconds is ambiguous (same process, fail closed).
A reused PID lands on the same sub-second part only by chance (1 in 100 at 100 ticks/s); that
record then stays held until the PID exits. Its tests (in `legacy-controller-lease.test.ts`)
reproduce the bug deterministically: without the fix "keeps the run and lease of a live
earlier-boot controller whose start reads 1000/3000 ms off after a wall-clock step" and the two
unit cases fail; with it the file passes (50 tests). The original two cases failed in the same
run without the fix.

**Why it isn't merged:** under the rule, 4 existing tests that model PID reuse with a live
process and a whole-second offset fail (`controller-process-identity` "keeps a live recovered
runner…", `sandbox-creation-operations` "treats a restarted server that reused the creator PID…",
`native-local-process-stop` "is stopped when a later process reused its PID…",
`run-cost-accounting` "normal accounting Retry reconstructs…"), out of 11 files checked; the
native and `heartbeat-process-recovery` files weren't run. Options:

1. Take the rule and give those tests' offsets a sub-second part (e.g. `-5_010` ms), files outside
   G's ownership.
2. Store the boot-relative start ticks in stamps and compare ticks within one PID space: exact,
   but a new field in every stamp kind (controller JSON, owner stamps, and a column for child
   processes).
3. Keep the source; make the test immune (stamp it from a fresh read just before the reaper).
   Hides a real production risk, so not recommended.

`test/slow` keeps the source and test as they were, so the two cases stay intermittent there
(they passed in the locked after-run, failed in one of the correctness runs).

## Repeat runs

Outside the lock, 2 workers, 3 rounds of three batches (8 + 10 + 6 files: every changed file, the
small `issue-recovery-*` files and the other fixture users), 2026-11-18, with three other agents
running:

- The fixture family and the other fixture users: 3 of 3 rounds pass.
- `legacy-controller-lease`: bug 40's two cases failed in 2 of 3 rounds (unchanged source).
- `deferred-execution-receipt-work`: "resumes saved conversation input…" failed once with
  `controller_lease_lost`; fixed in `fe37c3bb4a` (see "Clocks"); the file then passed 3 of 3
  runs alone.
- `live-recovery-work`: the native lease case (left on unfaked timers, unchanged) failed once in
  a loaded 2-worker round: it checks recovery's deadline 500 ms after the old lease expiry in
  PostgreSQL time. It passed 3 of 3 on the base version alone, and the whole file passed 3 of 3
  alone with the changes. Timing-sensitive under load; another reason to move it to opt-in.

Bug 40, `legacy-controller-lease.test.ts` alone, 10 runs each: without the fix 10 of 10 pass
(alone the stamp and the second read are rarely more than a second apart; the failures came in
longer multi-file runs); with the fix (`test/slow-bug40`) 10 of 10 pass, 50 tests each.

## Checks

- `corepack pnpm typecheck` in `server/` (includes the test files): passes on `test/slow` and on `test/slow-bug40`.
- The locked before and after runs above; the repeats above.
