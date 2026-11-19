# Round 2, agent H: CI and the runner

Branch `test/ci`, 2026-11-18. Agent H's row of the [step 3a plan](../step-3a-plan.md#round-2): shards
in `scripts/test.mjs`, a default worker count from the machine, `--fsModuleCache` on every phase,
and one GitHub workflow in place of upstream's 38.

## The runner

`node scripts/test.mjs [--tier …] [--workers N] [--shard i/n] [--report-dir <dir>] [--dry-run] …`

### `--shard i/n`

- **How files are split.** The tier's phases are built as usual, with explicit file lists from the
  inventory (`vitest list`). Each phase's files are then dealt out longest first, each onto the
  shard with the least expected time so far in that phase; ties go to the shard with the least time
  in earlier phases, then the lower number. Each shard runs its slice of every phase (`server`,
  `server-serial`, `packages`), with the same arguments as an unsharded run. A shard with no files
  in a phase skips it.
- **Expected time** per file: `classification.csv`'s `local_s` (this machine's profile), else
  `ci_s` (upstream's recorded CI durations), else the median of the files that have one. Of today's
  2,736 files, 304 have `local_s`, 1,720 `ci_s` and 712 neither (mostly packages, at the median of
  4.9 s). A missing CSV falls back to equal weights.
- **Deterministic.** The split depends only on the file list and the CSV: files are sorted by
  weight, then path, and nothing machine-specific (worker count, memory) enters it. Every CI job
  computes all n shards from the same commit and runs its own.
- **Phases are balanced one at a time** rather than in one pool: they run one after another, and a
  serial phase's time isn't divided by the workers, so balancing the totals could pile a serial
  file onto one shard.
- **Coverage check, extended.** A sharded run checks that the n shards together hold every file of
  the tier exactly once (`shardCoverageProblems`), then lists its own shard's phases with
  `vitest list` and checks they hold exactly its files, as before. It stops before running if
  either fails. `--dry-run --shard i/n` prints every shard's size and expected worker-minutes.
- **`--report-dir`** copies each phase's Vitest JSON report out of the run directory (which is
  deleted at the end), as `shard-<i>-of-<n>-<phase>.json`. CI uploads them: they hold per-file
  durations to refresh the weights from, once CI has run.

### Default workers

`min(8, cores ÷ 2, free memory ÷ 1.5 GB)`, at least 1, printed with the reason:

```
[test] workers: 8, min(cap 8, 16 cores / 2 = 8, 18.5 GB free / 1.5 GB per worker = 12); --workers overrides
```

Cores are `os.availableParallelism()`; free memory is `process.availableMemory()`, which is
`MemAvailable` and respects a cgroup limit (`systemd-run -p MemoryMax=…`). `--workers N` overrides
and prints `workers: N (--workers)`.

**Memory per worker, measured.** The 60-file bench set at 4 workers under the lock
(`bench.sh h-mem-4 --fileParallelism --maxWorkers=4`): 234.8 s, 1,623 passed, 0 failed, 2 skipped
(agent A's `workers-4` was 231.4 s). Every 3 s a sampler summed the memory of the run's whole
process tree: Vitest's main process, its 4 fork workers and every embedded Postgres they started
(up to 64 Postgres processes at once). PSS counts shared pages once, so it's the honest figure;
RSS counts each Postgres backend's shared buffers again.

| Process tree, 60 samples over 229 s | Max | 90th percentile | Median |
| --- | --- | --- | --- |
| PSS | 5.85 GB | 4.84 GB | 3.19 GB |
| RSS | 7.29 GB | 6.04 GB | 3.50 GB |
| PSS per worker | **1.46 GB** | 1.21 GB | 0.80 GB |

So the peak is ~1.5 GB per worker, and the formula keeps 1.5 GB (`bytesPerWorker`). It's measured
with today's config, where both server projects isolate each file. Once agent F's fix lets the
shared project run without isolation, a worker keeps its module graph between files; measure again
then (run the sampler on `bench.sh` with F's config). Machine-wide used memory went from 3.1 GB to
11.4 GB during the run, but that includes the other agents' work.

| Machine | Cores | Free memory | Default |
| --- | --- | --- | --- |
| This desktop | 16 | ~17–18 GB | 8 (the cap) |
| server1 | 20 | what the real instance leaves of 14 GB, say 6–8 GB | 4–5 (memory) |
| GitHub's standard runner | 4 | ~14–15 GB of 16 | 2 (cores) |

On server1 a `systemd-run --user --scope -p MemoryMax=6G` around the run makes the memory term use
the cap (6 GB ÷ 1.5 = 4). `CPUQuota=` isn't seen by `availableParallelism()`, so pass `--workers`
with a CPU quota.

### `--fsModuleCache`

Every phase passes it, so the package projects (own configs, which don't inherit the root's
setting) write and read the cache too. The `vitest list` calls get it as well; they only load
configs.

### Tests

`pnpm test:runner` (new root script, `node --test scripts/__tests__/test-runner.test.mjs`): **31
passed, 0 failed** (16 before). New: `--shard` parsing and its errors, `assignShards` (exactly
once, balance, order independence, empty shards, needs explicit files), `buildShards` (covers the
tier, keeps opt-in out, unknown files at the median), `shardCoverageProblems`, CSV parsing with
quoted fields, `defaultWorkerCount` (desktop, server1, GitHub, at least 1), `--fsModuleCache` on
every phase, a `--dry-run --shard 2/3` that runs the real coverage check, and `--files` with a
path that isn't a test file (warned about and left out; before, a sharded run failed its coverage
check on it).

A real sharded run, outside the lock at 2 workers: a 4-line `--files` list (one path not a test
file) as `--shard 1/2` and `--shard 2/2` with `--report-dir`. Shard 1 ran `server` (1 file, 77
passed) and `packages` (1 file, 7 passed); shard 2 ran `packages` only (1 file, 23 passed); the
three JSON reports were copied out.

## Shards in CI

The thorough tier as D's classification and the user's decisions define it (opt-in rows, CLI and
plugins out) is **1,400 files and ~205 expected worker-minutes**, close to the PM's ~240 (which
counts every file isolated). Splitting it with the runner's own functions:

| Shards | Files per shard | Expected worker-minutes per shard |
| --- | --- | --- |
| 6 | 232–236 | 34.1–34.2 |
| 8 | 173–179 | 25.6–25.7 |
| **10** | **137–145** | **20.5–20.6** |
| 12 | 113–122 | 17.1–17.2 |

The longest single file in that tier is `heartbeat-process-recovery.test.ts` (344 s; agent E splits
it), well under a shard's time, so no file sets a shard's floor.

**10 shards.** A GitHub runner has 4 cores, so 2 workers; on the desktop 2 workers ran the bench
set 1.71× faster than one. 20.5 worker-minutes ÷ 1.71 ≈ **12 minutes of tests per shard**, plus
about 3–4 minutes of setup (checkout, Node, install from the cached store, the plugin SDK build,
the preflight, the inventory). That's **~15–16 minutes per shard**, or ~19 with the PM's 240
worker-minutes. `ci_s` was recorded on upstream's CI runners, so it's roughly CI speed already;
`local_s` (304 files) is desktop speed, so those are underestimates. 8 shards would be ~17–20
minutes; 10 leaves room. Once agent F's fix lets the shared project skip isolation, a shard should
drop toward 10 minutes, and 8 shards may be enough.

Today, before agent E fills `optIn`, the tier is all 2,736 files (`node scripts/test.mjs --dry-run
--tier thorough --shard 3/10 --workers 2`):

```
[test] coverage: the 10 shards hold every one of 2736 test files exactly once
  shard 1/10     271 files    38.9 expected worker-minutes (199 files recorded)  server 219, packages 52
  shard 2/10     272 files    38.9 expected worker-minutes (202 files recorded)  server 220, packages 52
  shard 3/10     271 files    38.8 expected worker-minutes (199 files recorded)  server 220, packages 51
  shard 4/10     271 files    38.8 expected worker-minutes (202 files recorded)  server 220, packages 51
  shard 5/10     273 files    38.9 expected worker-minutes (202 files recorded)  server 221, packages 52
  shard 6/10     273 files    38.8 expected worker-minutes (203 files recorded)  server 222, packages 51
  shard 7/10     273 files    38.9 expected worker-minutes (200 files recorded)  server 221, packages 52
  shard 8/10     273 files    38.9 expected worker-minutes (199 files recorded)  server 221, packages 52
  shard 9/10     272 files    38.8 expected worker-minutes (205 files recorded)  server 221, packages 51
  shard 10/10    287 files    38.9 expected worker-minutes (213 files recorded)  server 235, packages 52
[test] tier thorough, shard 3/10, 2 workers:
  server                   220 files  --fileParallelism --maxWorkers=2
  packages                  51 files  --maxWorkers=2
[test] coverage: shard 3/10's 271 files are exactly what its phases list
```

## The workflow: `.github/workflows/test.yml`

- **Triggers:** every push to any branch (`branches: ["**"]`, so not tags), pull requests, and by
  hand (`workflow_dispatch`). Jobs run on a pull request only when it comes from another
  repository: a branch in this one was already tested by its push, and running both would double
  every run.
- **Concurrency:** `test-${{ github.ref }}`, cancel in progress, so a newer push to a branch
  cancels its older run (a pull request's ref is `refs/pull/<n>/merge`, its own group).
- **Permissions:** `contents: read`. No secrets are used; `persist-credentials: false` on checkout.
- **Setup** (both jobs): checkout, `actions/setup-node` with `node-version-file: .nvmrc` and
  `package-manager-cache: false`, `corepack enable` (pnpm 9.15.4 from `packageManager`), the pnpm
  store cached by `pnpm-lock.yaml`'s hash (with a prefix fallback), `pnpm install
  --frozen-lockfile`, `pnpm --filter @paperclipai/plugin-sdk build`.
- **Job `typecheck`** (30 min limit): `corepack pnpm typecheck`, then ui-new's tests, then
  `pnpm test:runner`. `pnpm -r typecheck` already includes ui-new's `typecheck` (it's a workspace
  package), so there is no separate ui-new typecheck step. Here, under the lock, `corepack pnpm
  typecheck` passed in 2m55s wall on 16 cores (16.4 CPU-minutes, its largest process 6.5 GB, the
  Runner's `cargo check` included). On 4 slower cores expect ~8–10 minutes, plus setup.
- **Job `thorough`**, matrix `count: [10]` × `shard: [1..10]`, `fail-fast: false` so every shard
  finishes (45 min limit): restore the Vitest module cache, `node scripts/test.mjs --tier thorough
  --shard i/10 --report-dir test-reports`, save the cache (pushes to `main` only), upload the JSON
  reports (14 days).
- **Module cache:** one entry per shard and commit, keyed by OS, lockfile hash, shard and SHA.
  Every run restores the newest entry for its shard (branches can read `main`'s); only pushes to
  `main` save, so branches don't fill the 10 GB repository cache. Vitest keys each entry by the
  module's source and config, so a restored cache can't serve stale code (agent B's check).
- **Actions**, pinned to the full SHAs upstream used, tag in a comment: `actions/checkout` v7.0.1
  (`3d3c42e5…`), `actions/setup-node` v7.0.0 (`82076278…`), `actions/cache` (and `/restore`,
  `/save`) v6.1.0 (`55cc8345…`), `actions/upload-artifact` v7.0.1 (`043fb46d…`). Each tag was
  checked against the GitHub API.
- **Retries:** none. `scripts/ci/vitest-retry.mjs` turns on one retry only for a workflow named
  `PR`; this one is `Test`. In CI the runner adds upstream's oversized-file reporter (warnings for a
  file over 180 s) and the stalled-file reporter (fails a file that makes no progress for 8
  minutes, naming it).

**Checks run here** (no `actionlint` on this machine, and Actions can't run here): the YAML parsed
strictly with the repo's `yaml` 2.9.1, plus a structural check (triggers, `contents: read`, no
`secrets.`, every step one of `uses`/`run`, every action on a 40-character SHA with a tag comment,
every `steps.<id>` and `matrix.<key>` reference defined, `shard` = 1..`count`). It passed, and it
caught each of three planted mistakes (a misspelt matrix key, an unknown step id, a tag instead of
a SHA).

## What was deleted from `.github/`

The user approved deleting upstream's workflows; everything stays readable at `upstream-freeze`.

- **`workflows/`:** all 38 (`agent-runtime-images` … `sentry-contract`).
- **Used only by those workflows:** `actions/run-ci-task/`, `actions/setup-ci-dependencies/`,
  `tests/runner-controller-artifact-transport.test.mjs`, `infra/runner-e2e-private-history.yml`,
  `storybook-deploy/` and `cloud-migrator-deploy/` (AWS policies for upstream's deploys),
  `ci-duration-pr.md`, `docker-context-checks.Dockerfile`, `scripts/tests/` (31 tests and fixtures
  of the scripts), and 15 of the 19 `scripts/`: `check-lockfile-release-age`, `check-pr-coauthors`,
  `check-pr-dedup-search`, `check-pr-dependencies`, `check-pr-linked-issue`, `check-pr-lockfile`,
  `check-pr-migration-order`, `check-pr-release-bootstrap`, `check-pr-template`,
  `check-pr-test-coverage`, `fetch-pr-files`, `get-bot-token`, `lockfile-trust`,
  `notify-pr-merge-review`, `run-quality-gates`.
- **Kept, because something outside `.github/` imports them:** `scripts/ci-inputs.mjs`,
  `scripts/ci-plan.mjs`, `scripts/ci-diff.mjs` and `ci-task-matrix.json` (`pnpm verify`, through
  `scripts/local-verify/`; its modules still load), and `scripts/runner-loss-rerun.mjs`
  (`scripts/cloud-readiness-runner-loss.mjs`). They go when those do.
- **Left, not CI:** `CODEOWNERS` (upstream's maintainers), `dependabot.yml` (upstream's update
  policy; Dependabot version updates are off by default on a fork), `ISSUE_TEMPLATE/` and
  `PULL_REQUEST_TEMPLATE.md` (CLAUDE.md: upstream's, don't apply). Candidates to delete; the user's
  call.

### Tests that read the deleted workflows

Seven server test files read `.github/workflows/*.yml` at load and now fail with `ENOENT`
(checked: `node scripts/test.mjs --files … --workers 2`):

| File | Reads | D's tier |
| --- | --- | --- |
| `server/src/__tests__/cloud-image-bundled-plugins.test.ts` | `docker.yml` | opt-in |
| `server/src/__tests__/cloud-image-sentry.test.ts` | `release.yml` | opt-in |
| `server/src/__tests__/container-init-reaping.test.ts` | `docker.yml` | opt-in |
| `server/src/__tests__/docker-runner-workflows.test.ts` | several | opt-in |
| `server/src/__tests__/runner-image-workflow.test.ts` | `runner-image.yml`, `pr-merge-review.yml` | opt-in |
| `server/src/__tests__/runner-lockfile-guards.test.ts` | `release.yml` and others | opt-in |
| `server/src/__tests__/docker-build-stamp.test.ts` | `docker.yml`, `release.yml`, `docker-merge-group.yml`, `docker-app-check.yml` | **thorough** |

They test the workflows that are gone, so they're results of the deletion, not bugs. The six
dormant ones are opt-in in agent E's tiers and weren't changed. `docker-build-stamp` is in thorough
and guards the root `Dockerfile` that `deploy/deploy.sh` builds, so (at the PM's request) its
workflow assertions were removed and every Dockerfile assertion kept: 18 tests before, **17 after,
all passing**. Removed: the test "passes PAPERCLIP_BUILD_COMMIT as a build-arg for standard and
explicit preview builds" (workflows only; `deploy.sh` deliberately passes no build commit), the
workflow loop of "gives an inline Runner the build commit as its revision and no publication
argument" (kept as "gives an inline Runner the build commit as its revision", its Dockerfile half),
and one workflow line each from the two provider-pack tests (`target: production` in `docker.yml`,
`target: cloud` in `release.yml`). `runner-image-resolve.test.ts` only names workflow paths in
fixtures and still passes.

Tests outside the Vitest projects that read deleted files (not run by our CI): in `scripts/`,
`__tests__/release-verify-workflow.test.mjs`, `__tests__/e2e-shard.test.mjs`,
`__tests__/local-verify.test.mjs`, `__tests__/run-vitest-stable-shard.test.mjs`,
`__tests__/runner-release-crate-cache.test.mjs`, `ci/test-selection-workflow.test.mjs`,
`ci/test-selection-pr-timings.test.mjs`, `cloud-migrator-artifacts.test.mjs`; in
`tests/runner-e2e/`, `workflow-security.test.ts`, `private-trust-workflow-security.test.ts`,
`daytona-image.test.ts`; and `packages/paperclip-runner/scripts/runner-protocol-eval-workflow-security.test.mjs`.

## Upstream CI scripts left in `scripts/`

Not edited (not this agent's). Used only by upstream's workflows, or by tests of them, so they can
go in a later cleanup:

- `scripts/run-vitest-stable.mjs` and its helpers (`test-line-shard.mjs`, `general-server-shard.mjs`
  and the `*-shard-durations.json` files): still run by `pnpm test:run*` and `pnpm verify`
  (`scripts/local-verify.mjs`), so they go together with those. `test:run*` stays in the root
  `package.json` for that reason.
- `scripts/ci/`: `execution-plan`, `gh-api`, `pr-run-durations`, `refresh-chat-shard-durations`,
  `refresh-test-durations` (read the deleted `ci-duration-pr.md`), `repository-file-inputs`,
  `reviewed-test-dependencies`, `run-selected-vitest`, `run-task`, `select-projects`,
  `select-tests`, `test-selection-*`, `vitest-impact-*`, `vitest-selection-graph`,
  `oversized-test-files-playwright`, `test-timing-reporter` (still in the root `vitest.config.ts`'s
  reporters, a no-op since the server project was renamed). Still used by our runner:
  `vitest-retry.mjs`, `retry-reporter.mjs`, `stalled-file-reporter.mjs`, `oversized-test-files.mjs`.
- `scripts/ci-profile/` (Honeycomb profiling of upstream's CI; the runner still honours
  `PAPERCLIP_CI_PROFILE`), `scripts/ci-dependency-cache.mjs`, `scripts/ci-typecheck-lane.mjs`,
  `scripts/check-node-version-policy.mjs` (reads `.github/workflows`), `scripts/merge-group-image.mjs`,
  `scripts/cloud-readiness-runner-loss.mjs`, `scripts/cloud-source-verification.mjs`,
  `scripts/cloud-release-admission.mjs`, `scripts/eval-schedule-monitor.mjs`,
  `scripts/prepare-runner-release-image.mjs`, `scripts/runner-release-crate-cache.mjs`,
  `scripts/runner-debug-crate-cache.mjs`, and the root `test:release-registry` list (node tests of
  upstream's release and CI scripts).

## What to watch on the first real run

- **Merge order matters.** Before agent E's `optIn` lands, the tier holds every file, including
  `chat-channels.integration.test.ts` (34 minutes alone): its shard would take over 35 minutes,
  near the 45-minute limit. After E, the chat suite is opt-in.
- **Failures expected:** the known bug-42 files. The six workflow-reading files are opt-in in E's
  tiers, and `docker-build-stamp.test.ts` no longer reads workflows.
- **Wall time per shard** against the ~15–16 minute estimate, and how even the shards are. The
  uploaded JSON reports hold each file's duration; if shards are uneven, refresh the weights from
  them (a `ci_s`-style column) and revisit the count (`count` and the `shard` list in the matrix).
- **Two workers on 4 cores:** watch for timing-sensitive tests (bug 40's lease test,
  `prepared-queries-postgres` "retries a pooled statement unprepared…") and for memory. If the
  runner looks idle, try `--workers 3` in the workflow on one run.
- **Embedded Postgres on GitHub's runner:** agent C's data root on `/dev/shm` (a tmpfs of half the
  RAM there) and the binaries from `@embedded-postgres/linux-x64`; upstream ran it on the same
  runners, but not with C's flags.
- **The typecheck job's `cargo check`:** the Paperclip Runner's `typecheck:rust` installs Rust
  1.97.1 from its `rust-toolchain.toml` and compiles its crates cold each run (upstream measured
  ~3m40s), uncached. It's dormant code; if it's slow or flaky, drop it from CI rather than cache it.
- **Cache behaviour:** the first run restores nothing; the first push to `main` saves the module
  cache. Check the "Restore the Vitest module cache" step hits on the run after.
- **Upstream's workflows still run on `master`** (it mirrors upstream, workflows and all): they're
  active in the repository's Actions settings, and scheduled ones ran there until 2026-10-25. To
  stop them, disable them in the Actions tab or with `gh workflow disable <name>`. Not done here
  (no changes to the remote).
- **Duplicate runs:** a pull request from a branch in this repository shows its jobs as skipped;
  the push run is the check.
