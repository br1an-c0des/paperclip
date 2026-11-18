# Round 1, agent A: test runner and parallel server files

Branch `test/runner`. Tasks A1 (worker count) and A2 (`scripts/test.mjs`) of the
[step 3a plan](../step-3a-plan.md). Compared with the [baseline](results-baseline.md): 695.0 s,
1,623 passed, 0 failed, 2 skipped, one file at a time.

## A1: worker count

Every run is `fork/test-suite-audit/bench.sh workers-N --fileParallelism --maxWorkers=N` on the
60-file benchmark set, with `server/vitest.config.ts` unchanged (forks, `isolate: true`). Memory and
load are machine-wide samples every 5 s while the run held the lock, so they include the other
agents' correctness runs (at most 2 workers each).

| Date (UTC) | Label | Wall | vs baseline | Passed | Failed | Skipped | Max used | Min available | Load mean / max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-18 17:34 | `baseline` (PM) | 695.0 s | 1.00× | 1,623 | 0 | 2 | | | |
| 17:45 | `workers-2` | 406.8 s | 1.71× | 1,623 | 0 | 2 | 9.9 GB | 13.0 GB | 4.5 / 6.2 |
| 17:50 | `workers-4` | 231.4 s | 3.00× | 1,623 | 0 | 2 | 11.3 GB | 11.6 GB | 6.3 / 8.0 |
| 18:01 | `workers-6` | 179.2 s | 3.88× | 1,623 | 0 | 2 | 15.3 GB | 7.6 GB | 6.5 / 8.3 |
| 18:26 | `workers-8` | 125.8 s | 5.52× | 1,623 | 0 | 2 | 13.3 GB | 9.6 GB | 4.9 / 7.9 |
| 18:49 | `workers-8-r1` | 139.1 s | 5.00× | 1,623 | 0 | 2 | 14.0 GB | 8.9 GB | 6.0 / 10.1 |
| 18:52 | `workers-8-r2` | 128.8 s | 5.40× | 1,623 | 0 | 2 | 16.6 GB | 6.3 GB | 7.8 / 9.3 |
| 19:12 | `workers-8-r3` | 121.5 s | 5.72× | 1,623 | 0 | 2 | 12.8 GB | 10.1 GB | 4.6 / 7.3 |
| 19:19 | `workers-6-r1` | 139.1 s | 5.00× | 1,623 | 0 | 2 | 11.2 GB | 11.7 GB | 5.2 / 6.4 |

Notes on the runs:

- `workers-2` overlapped two `vitest list --changed` probes (42 s each, about one core), and
  `workers-4` a 25-second interrupt check of the runner at 2 workers. `workers-6` overlapped this
  branch's own correctness run (`node scripts/test.mjs --files bench-set.txt --workers 2`, below),
  which is why it was slower than its rerun `workers-6-r1`.
- Memory never ran short: at most 16.6 GB used of 22, at least 6.3 GB available, no swap growth.
- **8 workers, 4 runs:** 121.5–139.1 s, mean 128.8 s, all 1,623 passed. That's 5.4× the baseline.

**Failures only in parallel: none.** No file failed at 2, 4, 6 or 8 workers, so nothing needed the
"alone, then at the same N" recheck. The bench set holds 9 files that upstream's runner serializes
(`isRouteOrAuthzTest`: 8 by the `route|routes|authz` name pattern, plus `openrouter-attribution`,
which the pattern catches by its name): `activity-routes`, `companies-route-cross-company-authz`,
`issue-watchdogs-routes`, `access-routes-hidden-floor`, `authz-secret-context`,
`environment-custom-image-routes`, `invite-list-route`, `issue-document-restore-routes` and
`openrouter-attribution`. All 9 passed in every parallel run (5 at 8 workers).

The bench set holds only 9 of the 178 suites upstream serializes, so the other 169 were run once
too, at 8 workers through the new runner, holding the benchmark lock so they disturbed no timing
(`flock /tmp/paperclip-test-bench.lock node scripts/test.mjs --files <the 169> --workers 8`):
**169 files, 4,163 passed, 0 failed, 1 skipped**, 7m38s. One run, so it shows they don't need to
run alone, not that they never flake. The PM's full `pnpm test` after the merge is the next check.

**Default: 8 workers.** The fastest N with no parallel-only failures, and at most cores ÷ 2 (16 ÷ 2).
`scripts/test-tiers.json` has an empty `serialServer`.

Why 8 isn't 8× faster on this set: the four heavy files take 59–97 s each in parallel (49–69 s
alone) and start together, so they set the floor. At 8 workers the longest file
(`tool-gateway-service.test.ts`, 84 s) is about two thirds of the wall time. The whole suite has
far more small files per heavy one, so its speedup should be closer to N. Per-file times also
grow with N (the heaviest file: 69 s alone, 97 s at 6, 84 s at 8), from CPU and disk contention.
Agent B's isolation result may move the best N: the PM re-benchmarks the combination.

## A2: the runner

`node scripts/test.mjs [--tier quick|thorough|optin|all] [--workers N] [--changed <ref>] [--files <list>] [--dry-run] [--skip-preflight] [-- <vitest args>]`

Root `package.json`: `test` (`--tier thorough`), `test:quick`, `test:optin`, `test:all`. `test:run`,
`test:run:general`, `test:run:serialized` and `scripts/run-vitest-stable.mjs` are unchanged.

| Phase | Vitest args | Files (thorough, today) |
| --- | --- | --- |
| `server` | `--project '@paperclipai/server*' --fileParallelism --maxWorkers=8`, excluding `serialServer` paths and `optIn` globs | 2,220 |
| `server-serial` | same projects, `--no-file-parallelism --maxWorkers=1`, the `serialServer` files | 0 (left out) |
| `packages` | `--project '!@paperclipai/server*' --maxWorkers=8`, excluding `optIn` globs: all 19 other projects in one run | 516 |

What it keeps from upstream's runner: the two preflight steps (`pnpm run preflight:workspace-links`,
then the plugin SDK's `ensure-build-deps`); `--exclude **/dist/**` on every phase; per-run
`PAPERCLIP_HOME`, `PAPERCLIP_CONFIG`, `PAPERCLIP_INSTANCE_ID`, `TMPDIR` and `NODE_ENV=test`
(`isolatedTestEnv`), now in one `/tmp/pt-*` directory that's deleted when the run ends, including
after Ctrl-C (upstream's `/tmp/pv-*` directories are never deleted: 545 were left on this machine).
Some tests leave read-only directories there (runtime-context asset bundles, mode 0555), which a
plain recursive delete can't remove, so cleanup makes directories writable first;
`PAPERCLIP_VITEST_RETRY`; the CI profiling invocation; the reporters from the root
`vitest.config.ts` (a `--reporter` on the command line replaces them, so the runner repeats the list
and adds a JSON report); and server files one at a time when a `PAPERCLIP_*_TEST_DATABASE_URL`
names a shared database.

What's new:

- **Every phase runs** when an earlier one fails. The summary has each phase's files, passed,
  failed and skipped tests, wall time and exit code, then every failed file.
- **No file is dropped silently.** Before running, the runner lists each phase's files with
  `vitest list --filesOnly` (about 0.6 s a phase) and checks that every test file of the tier is in
  exactly one phase; if not, it names the files and stops. It also stops if a `serialServer` path
  isn't a server test file, and warns about an `optIn` glob that matches nothing. `--dry-run` prints
  this and exits.
- Excludes and file filters are absolute paths, which Vitest's glob (tinyglobby 0.2.17) honours, so
  they work in every project whatever its root.
- Ctrl-C lets Vitest stop the current phase (the terminal sends it SIGINT), starts no further
  phase, prints the summary and removes the run directory. Checked: no processes or `/tmp/pt-*`
  left afterwards.

`node scripts/test.mjs --dry-run --tier thorough`:

```
[test] tier thorough, 8 workers:
  server                  2220 files  --fileParallelism --maxWorkers=8
  packages                 516 files  --maxWorkers=8
[test] coverage: every one of 2736 test files is in exactly one phase
```

**Same tests as the benchmark:** `node scripts/test.mjs --files fork/test-suite-audit/bench-set.txt
--workers 2` (a correctness run, outside the lock): 60 files, 1,623 passed, 0 failed, 2 skipped,
the same as `bench.sh`.

### quick

Vitest's own `--changed` follows the module graph, and the server's graph links nearly everything:

| One-line change in | `vitest list --filesOnly --changed HEAD --project '@paperclipai/server*'` |
| --- | --- |
| `server/src/services/run-liveness.ts` | 1,369 files, 42 s to work out |
| `server/src/services/routines.ts` | 1,367 files, 43 s |

So `quick` uses the fallback. The plan's fallback (the test files under the changed file's
directory, plus those whose name contains its basename) selects 333–336 files for any change in
`server/src/services/`, because 331 test files sit directly in that directory or its `__tests__`.
That is no quicker than the threshold it replaces, so the runner narrows it:

For each file changed since the merge base with `<ref>` (default `main`), plus untracked files:
- a changed test file selects itself;
- a changed source file selects the test files whose name (without `.test.ts`) contains its
  basename, the test files that import or `vi.mock` it by a relative path, and the test files
  directly in its directory and its `__tests__` folder only when there are at most 50 of them.

| Changed file | Selected |
| --- | --- |
| `server/src/services/run-liveness.ts` | 4 |
| `server/src/services/companies.ts` | 18 |
| `server/src/services/routines.ts` | 19 |
| `server/src/services/heartbeat/run-output.ts` | 58 (10 without its directory's 50) |
| `packages/adapters/claude-local/src/server/execute.ts` | 55 |
| `packages/db/src/client.ts` | 61 |
| `server/src/routes/issues.ts` | 104 |
| `server/src/services/issues.ts` | 162 |
| `server/src/services/heartbeat.ts` | 282 (the `heartbeat-*` files) |

The selection then runs as `thorough` restricted to those files, so `optIn` files stay out. It
misses tests that reach a module only through another module or a package name (`@paperclipai/db`);
that's what `thorough` is for.

## Left out

- **The chat suite is one file in the parallel phase.** `chat-channels.integration.test.ts`
  (1,970 tests, 34 minutes serial in the audit) can't be split across workers by file, so it alone
  sets a ~30-minute floor for `thorough` while it's there. Upstream split it into 6 line-range shards
  (`vitest list` plus `file:line` filters); the runner doesn't, since round 2 may move it to
  `optIn`. If it stays, sharding it the same way is the fix.
- **`optIn` is empty**, as round 1 asks; the user decides in the area review.
- **The native-runner suites** (`cargo build` in `beforeAll`) run in the parallel phase like any
  other file; upstream gave them their own 4-worker group.
- Upstream's CI modes (duration-balanced shards, `--group`, the selection manifest) aren't carried
  over; round 2's CI decides what it needs. `PAPERCLIP_VITEST_RETRY` still works.
