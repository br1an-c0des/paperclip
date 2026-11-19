# State leaking between test files (step 3a round 2, agent F)

Branch `test/leaks`, 2026-11-18. The [plan's row F](../step-3a-plan.md#round-2): make the server's
`shared` Vitest project safe to run with `isolate: false` again. Round 1's full run without
isolation failed [39 extra files](leak-suspects.txt) that pass when every file is isolated.

## Result

`@paperclipai/server (shared)` is back to `isolate: false`. Three things make that safe:

1. **The setup file puts the process back between files**
   ([`helpers/shared-worker-state.ts`](../../server/src/__tests__/helpers/shared-worker-state.ts),
   called at the top of `setup-supertest.ts`). The first time the setup file runs in a worker it
   records a baseline; before every later file it restores it.
2. **It resets server modules' process-wide state** through the `…ForTests` resets those modules
   already export, but only for modules the worker has loaded.
3. **64 more files run isolated**, named in `ISOLATED_BY_NAME` in
   [`server/vitest.config.ts`](../../server/vitest.config.ts) with the reason for each group. They
   leak, or depend on, module state nothing can reset from a test (no reset function). The config
   now throws if a name in that list isn't a test file, so a rename can't drop one silently.

Projects: `shared` 1,659 files, `isolated` 561 (was 1,723 and 497).

Full server runs (`flock /tmp/paperclip-test-bench.lock node scripts/test.mjs --files <every server
test file but chat-channels.integration> --skip-preflight`, 2,219 files, 8 workers), against
round 1's isolated run (server phase 51m52s, 45,660 passed, 12 failed):

| Run | Setting | Wall | Passed | Failed | Skipped | Failed files |
| --- | --- | --- | --- | --- | --- | --- |
| round 1 | every file isolated | 51m52s | 45,660 | 12 | | 8 (bug 42) |
| round 1 | `shared` without isolation, as merged | 48m | 47,434 (with chat) | 204 | | 47 |
| `full1` | env/global/timer reset only, leak report on | 71m46s | 45,471 | 195 | 344 | 48 |
| `full2` | + module resets, 45 files isolated, leak report on | 41m48s | 45,600 | 66 | 344 | 20 |
| `full3` | 60 isolated, no report | 37m39s | 45,619 | 47 | 344 | 11 + 3 shared-only (now isolated) |
| `full4` | 63 isolated, no report | 40m46s | 45,574 | 48 | 388 | 13 + 1 shared-only (now isolated) |
| `full5` | final (64 isolated), no report | 41m47s | 45,626 | 40 | 344 | 9 + 3 shared timeouts in one 30 s window |
| `full6` | final, no report | 39m58s | 45,629 | 37 | 344 | 9 |
| `full7` | final, no report | 38m35s | 45,627 | 39 | 344 | 9 + 2 shared (`case-handoff-legacy.integration` 30 s timeout, `native-retention-blocker-batch` 59 of 60) |

**The 9 files that fail in every final run fail with isolation too, or are bug 42:**

- Bug 42 (`fork/upstream-fixes.md`): `cursor-local-execute`, `cursor-local-adapter-environment`,
  `scripts/reporting-lock-policy`, `native-runtime/retained-provider-pack-source`
  (`native-runner-restart-preparation.integration`, also bug 42, failed in `full1` to `full3` and
  passed from `full4` on).
- Fail in an agent worktree with `--isolate` as well: `email-channels.integration`,
  `heartbeat/runtime-selection`, `agent-commentary-skills` (a skills-root path that escapes the
  worktree, below). They pass from the main checkout.
- In the `isolated` project, failing in this worktree with the old setup file too:
  `native-warm-checkpoint-ownership.integration`, `native-warm-successor-runner-release.integration`
  (`runner_remote_artifact_unavailable`).

Isolated-project files that failed in one run and not the next, not related to sharing (they
already run isolated): `heartbeat-native-restart-suspension` (`full1` to `full4`, also fails alone
in this worktree with the old setup file), `legacy-controller-lease` (bug 40),
`native-runner-restart-recovery.integration`, `workspace-recovery-warm-handoff` (a 30 s
`beforeAll` timeout under load).

`full5`'s 3 shared timeouts (`heartbeat-slack-invitation`, `heartbeat-direct-adapter-native-isolation`,
`retained-native-session-cleanup-work`) finished within 30 seconds of each other in three different
workers, near the run's end, while other agents ran tests outside the lock (load average about 14
on 16 cores). Re-run in one shared worker, in that order, all three pass; `full6` and `full7`
passed them too. `full7`'s 2 (`case-handoff-legacy.integration`, a legacy process tree that didn't
settle within 30 s, and `native-retention-blocker-batch`'s two-servers race, 59 of 60 checkpoints
expired) passed in every other run; the race test passed 5 times out of 5 alone.

**Not quite done by the plan's measure.** Of the three runs on the final config, `full6` failed only
the 9 files above; `full5` and `full7` each added 2 or 3 shared files that pass on re-run and in
the other runs. With 1,659 files sharing workers, a rare order- or load-dependent failure still
turns up about once per run, and I couldn't tell load from leak for these five without the
per-worker order (the leak report records it, but it wasn't on for these runs). Options for the PM: accept them as flakes (a retry in CI
covers them), isolate the five as well, or run with `PAPERCLIP_TEST_LEAK_REPORT` in CI so the next
one comes with its worker's file order.

**Time:** 38m35s to 41m47s for the final runs against 51m52s isolated, about 20–25% less, with the
same 46,010 tests (passed + failed + skipped, every run). The plan's 20–25 minutes was for the
thorough tier after agent E moves the opt-in files out; these runs are every server file.

`full1` was slower than isolation because leaked idle-tracked work made dozens of tests wait out
their timeouts (one file alone spent 6 × 300 s). Its count of passed + failed + skipped (46,010) is
the same in every run; `full2`'s 4 isolated `issue-recovery-*` failures were caused by the leak
report itself (below), not by sharing.

## How the leakers were found

- **The 39 suspects, grouped by error** (from the round 1 log): "Cloud runtime configuration has
  not been initialized" and "`PAPERCLIP_MANAGED_CONFIG` is set but blank" (environment), counters
  off by one or more (`idleWorkSnapshot().active`), `getTracer` called (stray work from an earlier
  file), "Object run log storage is not configured" (a cached store), timeouts.
- **A leak report:** `PAPERCLIP_TEST_LEAK_REPORT=<file>` makes the setup file append one JSON line
  per file with what the previous file in that worker left behind (environment keys, changed or new
  globals, fake timers, cwd, active handles), the state of a few module singletons, and which
  resets ran. `PAPERCLIP_TEST_NO_RESET=1` reports without restoring, to reproduce a leak. Each full
  run then gives every worker's file order, so a victim's predecessors can be replayed.
- **Confirmation:** the suspected polluter and victim in one shared worker, in that order
  (`vitest run --project shared --maxWorkers=1 --no-isolate` with a small sequencer that keeps the
  given order; Vitest's default sequencer sorts by size and duration, so the command-line order
  isn't kept).

## The leaks, their fixes

| What leaked | Polluter → victims | Fix |
| --- | --- | --- |
| Environment variables: `vi.stubEnv` never undone, direct `process.env.X =` writes. 22 files left something in the one full run that reported it (`agent-auth-identity-transfer`, `decisions-service`, `managed-loopback-auth`, `local-encrypted-cipher`, `idle-incoming-wake`, `workspace-reaper-cooldown-config`, …) | → every "Cloud runtime configuration has not been initialized" (a leftover `PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN` or `PAPERCLIP_MANAGED_CONFIG` makes the process look managed, with no snapshot loaded) and blank `PAPERCLIP_MANAGED_CONFIG` failure | Setup: `vi.unstubAllEnvs()`, then `process.env` restored to the baseline before each file. `VITEST_*` keys are left alone (Vitest sets `VITEST_WORKER_ID` per file before the setup file runs) |
| **`process.env` replaced by a plain copy.** Five files save `{ ...process.env }` and assign it back in `afterAll`: `storage-s3-failure-diagnostics`, `storage-s3-request-timeout-retry`, `storage-s3-transient-retry`, `storage-s3-credential-rotation`, `storage-outage-wait`. Vitest's `vi.stubEnv` writes through a proxy whose target is the original object and which has no `deleteProperty` trap, so afterwards a stub to `undefined`, and every `vi.unstubAllEnvs()`, deletes from the old object, and stubbed values stay for the rest of the worker | `storage-s3-failure-diagnostics` → `workspace-reaper-cooldown-config` (`expected 0.5 to be 1`, confirmed both ways with `PAPERCLIP_TEST_NO_RESET`); the likely source of the blank `PAPERCLIP_MANAGED_CONFIG` | Setup: put the real `process.env` object back first |
| Stubbed globals, fake timers, cwd | None seen in `full1` (0 fake-timer, 0 changed-global, 0 cwd reports) | Setup: `vi.unstubAllGlobals()`, every global present at the baseline restored, `vi.useRealTimers()`, `process.chdir` back. Kept as a guard. Vitest already calls `vi.restoreAllMocks()` after each file itself (`base.js`), so spies needed nothing; added globals (zod, undici, OpenTelemetry's registry) are left alone |
| **Idle-tracked work left pending** (`beginIdleTrackedWork`, a module-level counter in `services/task-admission.ts`, no reset) | `plugin-worker-manager-duplex` (5 pending), `plugin-worker-manager-daytona-close`, `plugin-idle-manager`, `plugin-loader-activation-timeout`, `native-execution-context-worker`, `live-event-delivery` → every later file that waits for `idleWorkSnapshot().active === 0`: `chat-native-progress-work`, `chat-run-milestone-*`, `approval-retention-work`, `issue-recovery-assignments`, `voice-inbound-retention`, `email-idle-work`, `skill-package-work`, `github/terminal-response-work` (300 s timeouts), … Confirmed: duplex → chat-native-progress-work | The 6 polluters isolated. `full2` and the report showed no worker with pending tracked work afterwards |
| **Log stores cached on first use** (`getWorkspaceOperationLogStore`, `getRunLogStore`): the first file's `PAPERCLIP_HOME` or env wins for the worker | Any file that writes an operation or run log → files that point the store elsewhere through the environment: `workspace-operations-reconciliation` (confirmed after `task-document-scope`), `native-log-archive.integration` ("Object run log storage is not configured"), `workspace-runtime-control-recovery`, `native-workspace-finalizer`, … | The 14 files that set `WORKSPACE_OPERATION_LOG_BASE_PATH`, `RUN_LOG_BASE_PATH` or `RUN_LOG_S3_*` isolated (the victims: the polluters are nearly every file) |
| **Idle-sleep local-work report** (`services/idle-local-work.ts`): spool directories registered by earlier files (deleted by now, so the report says `unknown`), the startup, ingress and scheduled-backup flags, the tracked-work counter. No reset | Many files register spool directories → `idle-local-work`, `idle-sleep-diagnostics-postgres`, `historical-cleanup-verification`, `skill-source-sync-work`, `heartbeat-agent-status-recovery`, `idle-domain-deadlines-postgres` (`expected 'unknown' to be 'none'`) | The 23 shared files that read the report isolated |
| **Process run admission closed** by a graceful-shutdown test, plus the reattach phase (`heartbeat/run-admission.ts`) | → `recovery-wake-herd` (6 runs never start) | Reset per file with `resetProcessRunAdmissionForTests`, `resetReattachPhaseForTests` |
| Other module state with an exported reset: controller-instance lease and its registered database (closed with the earlier file's cluster), task drain, startup-recovery phase, the Cloud runtime config snapshot, Cloud runtime identity and replay fence, workspace runtime-control state and locks, runtime services and port reservations, managed-workspace cache, continuation pacing, two native reconciler cursors, telemetry client, git-info cache, Cursor and Codex model caches | Guard; no single victim pinned on each | Reset per file, only when the worker has loaded the module (`evaluatedModules.getModulesByFile`), so a file pays nothing for modules it doesn't use |
| **This process's start time, cached** (`currentProcessStartedAtMs`), against a later `ps -o lstart` reading of the same PID that comes out one second off on WSL. The owner proof then calls a live process `pid_reused` | Not a polluter: any file running long enough before → `native-local-process-stop` ("not stopped while the same process is alive"), `quarantined-task-retry`, `environment-run-lease-ownership`, `environment-login-probe-lease-ownership`. Seen after `recovery-wake-herd`: cached 02:01:12.270, observed 02:01:13.270 | Reset per file with `resetCurrentProcessStartedAtForTests`, so the cached and observed readings are seconds apart, as in isolation. Bug below |
| **A test-support module that removes its directory in a module-level `afterAll`** (`packages/paperclip-runner/src/drivers/codex/codex-app-server-driver.test-support.ts` makes `WORKSPACE` on load) | First importer → the second: `runner-api-recovery` ("Agent working directory must exist before provider admission") after `native-procedure-measurement` | Both shared importers isolated |
| **issue-recovery fixture family**: two `issue-recovery-deadlines` tests time out after `issue-recovery-assignments` in the same worker (confirmed; each passes alone). Not pinned down further | `issue-recovery-assignments` → `issue-recovery-deadlines` | The 15 shared importers of `issue-recovery.test-fixture.ts` isolated (minutes-long files, so isolation costs them nothing noticeable) |

One more, found in `full3`: **module evaluation order**. `services/execution-recovery-attempt.ts`
builds `UNCHARGED_RETRY_LANES` at load time from `AGENT_DIRECTORY_BUSY_RETRY_REASON`, imported from
the `modules/run-dispatch/index.ts` barrel, which imports back into it. When a worker's first
contact with this graph is `run-dispatch/index.ts`, the barrel is still evaluating when
`execution-recovery-attempt.ts` runs, the constant is `undefined`, and the set holds `undefined`
instead of the agent-directory lane, for the rest of the process. Confirmed: a file that only
imports `run-dispatch/index.js`, then `execution-recovery-attempt.test.ts` (`expected 30 to be 1`:
30 directory waits charged as failures). The test is isolated; the bug is below.

The leak report itself caused one problem, now fixed: in `full2` its probe imported
`task-admission` at the top of the setup file, before an isolated file's `vi.hoisted` set
`PAPERCLIP_DEBUG_WORK_SIGNALS`, and 4 isolated `issue-recovery-*` files failed. The probe now reads
only modules already loaded.

## `ISOLATED_BY_NAME`

64 files, each group commented in the config: 6 idle-work polluters, 14 log-store victims, 23
idle-report readers, 15 issue-recovery fixture files, 2 codex test-support importers, 1
import-order victim (`execution-recovery-attempt`), `event-loop-stall-monitor` (it classifies a
deliberate stall by `process.cpuUsage()`, which counts every thread, so work an earlier file left
running reads as main-thread CPU; failed once in `full4`), and 2 files that failed once in `full3`
and pass alone (`heartbeat/upgrade-readiness`, `native-runtime/provider-pack-archive`; isolated as
a precaution, cause not pinned down). Sixteen touch agent G's work: `satisfied-connection-intents` is in G's slow-test table and the 15 import
G's `issue-recovery.test-fixture.ts`. No test file was edited; moving a file changes only the
project it runs in. If G's fixture changes (fake timers) remove the family's leak, those 15 can go
back to `shared`.

## Test homes

`setup-supertest.ts` removed each file's `paperclip-vitest-home-*` on the worker's `exit` event,
which never fires: Vitest stops fork workers with SIGTERM. Now the homes, and the Codex home, are
registered with Vitest's own worker teardown (`__vitest_worker__.onCleanup`, run on its "stop"
message after every file's hooks), with the `exit` listener kept as a fallback. They are removed at
the worker's end, not after each file: the setup file's `afterAll` runs before the test file's own
teardown (`sequence.hooks: "list"`), and with `isolate: false` stray async work of a finished file
may still write to its home.

The Codex home (`paperclip-vitest-codex-home-*`, made by the setup file whenever `CODEX_HOME` was
unset, so once per isolated file and never removed) is now one per worker and removed with the
homes.

Check: 5 files run directly with `vitest run --maxWorkers=2` (3 shared, 2 isolated, `TMPDIR=/tmp`):
`/tmp` held 438 home directories before and 438 after (agent B measured 4 left by 4 files before
the change). Under `scripts/test.mjs` the homes are in the run's own `TMPDIR` (`/tmp/pt-*/t`), which
the runner removes. Meanwhile the `/tmp` count grew from 434 to 1,023 over `full2` to `full6`: other
agents' runs outside the runner, on branches that still have the old setup file. Once this merges
and `/tmp` is cleared again, it should stay flat.

## Found, not fixed

- **Import cycle drops the agent-directory retry lane** (above). Whether a production server is
  affected depends on which of the two modules its entry graph reaches first; if
  `run-dispatch/index.ts` comes first, every agent-directory wait is charged to the run's failure
  budget, and a run can fail after 30 busy-directory waits that should cost nothing. Likely fix:
  move `AGENT_DIRECTORY_BUSY_RETRY_REASON` (and the other reason strings) into a leaf module with no
  imports, and import it from there in both places.
- **WSL: a live process judged `pid_reused`.** `ps -o lstart` for the same PID can read one second
  apart over a process's life on WSL (the boot time it derives from moves), and
  `currentProcessStartedAtMs` caches the first reading. `owner-proof.ts`'s `compareStarts` then
  finds the starts definitely different and the proof says `gone`. In a long-running server on the
  desktop's WSL this could judge a live local run's process gone. Likely fix: treat a 1 s difference
  as the same start (`PROCESS_START_PRECISION_MS` boundary), or read the start from
  `/proc/<pid>/stat` ticks against a fixed boot time.
- **Skills root outside the repo in nested worktrees.** `resolvePaperclipSkillsDir`
  (`packages/adapter-utils/src/server-utils.ts`) tries `../../../../../skills` from
  `server/src/services` before the repo's `skills/`. In an agent worktree under
  `.claude/worktrees/<name>/` that resolves to the main checkout's `.claude/skills`, so
  `email-channels.integration`, `heartbeat/runtime-selection` and `agent-commentary-skills` fail in
  any agent worktree (also with `--isolate`; they pass from the main checkout).
- **Fail in this worktree in isolation too, not leaks:** `heartbeat-native-restart-suspension`,
  `native-warm-checkpoint-ownership.integration` and `native-warm-successor-runner-release.integration`
  (`runner_remote_artifact_unavailable`; also fail with the old setup file), all dormant native
  runtime. `native-runner-restart-recovery.integration` failed once in `full2` and passed alone.
- **Plugin worker manager leaves idle-tracked work pending** when its tests stop workers mid-call
  (`plugin-worker-manager-duplex` left 5). If that happens outside tests too, idle sleep can never
  certify the instance quiet. Not investigated further.
- **Vitest:** the `metaEnv` proxy behind `vi.stubEnv` has `get` and `set` traps but no
  `deleteProperty`, so it misbehaves once a test replaces `process.env`. Worth an upstream issue.

## Source changes proposed (not made)

These would let isolated files move back to `shared`:

- `getWorkspaceOperationLogStore` and `getRunLogStore`: key the cached store on the resolved base
  path and S3 settings, as `getManagedInstanceConfig` keys its cache on the raw env value (14 files).
- `services/idle-local-work.ts` and `services/task-admission.ts`: a `resetIdleLocalWorkForTests()`
  (spool directories, the three flags) and a reset of the idle-work counter for tests (23 + 6 files).
- `codex-app-server-driver.test-support.ts`: make `WORKSPACE` per importing file (a function with
  its own `beforeAll`/`afterAll`) instead of at module load (2 files).

## Files touched

- `server/vitest.config.ts`: `isolate: false` for `shared`, `ISOLATED_BY_NAME` (64 files), the
  missing-file check.
- `server/src/__tests__/setup-supertest.ts`: calls the reset first, registers homes for removal at
  worker stop, one Codex home per worker, the module resets and the report probe.
- `server/src/__tests__/helpers/shared-worker-state.ts` (new).
- This file.
