# A small core that gates, the rest reports

**2026-11-23. Status: adopted 2026-11-23, built on `test/core-tier`.** The user's choices:

- **Extended** runs nightly and on demand. The schedule may be lengthened if it gets annoying: one
  cron line in `extended-nightly.yml`.
- **Opt-in** runs on demand only, with no schedule.
- **`deploy.sh`** warns when `main`'s latest nightly extended run is red, without blocking.

Step 6 below (skipping CI for Markdown-only pushes) was left out; the note there says why. Follows
step 3a
([hard-fork-plan.md](hard-fork-plan.md#3a-renovate-the-test-suite)). Step 3a made the suite fast
enough to run. This proposal is about how much of it should be able to stop work.

## Why

Most of the time the suite costs now isn't CI minutes. It's red runs that weren't bugs, and the
work of chasing them.

- **Commits:** in the week to 2026-11-22, 142 of `main`'s 541 commits were about tests, flakes or
  CI.
- **Red runs:** since 2026-11-16 the `Test` workflow has run 57 times; 10 were red. Nine of the ten
  failed only in the thorough shards, on these files:

  | Failing file | Red runs | What it was |
  | --- | --- | --- |
  | `run-start-handover` | 3 | Flake (bug 62) |
  | `heartbeat-worktree-suppression` | 3 | Flake (bug 62) |
  | `openapi-routes` | 2 | A new route without its OpenAPI entry: a real omission, fixed in a minute |
  | `issue-detail-statements` | 2 | Golden file out of date after a new field: regenerated in a minute |
  | `run-preview` | 1 | Flake: another file's temp folders (bug 79) |
  | `legacy-finalization-regression` | 1 | Timeout on a commit that predated its fix |

  None of the ten was a product bug.
- **What the tests did catch:** three real problems, none from a red CI run:
  - **Bug 40:** Linux process start times, found while profiling slow tests.
  - **Bug 61:** an access check that took a database lock, caught by
    `agent-file-checkpoint-locking` during the step 4a regression.
  - **Storage-outage stop:** a stopped run that didn't stop until the next lease renewal, found
    while steadying `heartbeat-run-output` (bug 72).
- **CI wall time is about 11 minutes.** The thorough shards take 9–11 minutes; typecheck and
  `ui-new` take about 7. A smaller gate saves 3–4 minutes a run. The real saving is fewer red runs
  to investigate.
- **The opt-in weekly run** was red on 9 of 10 shards on 2026-11-23. It's report-only, but
  bugs 69 and 71 show that fixing its drift still pulls work in.

## The proposal

Three tiers instead of today's two, and the merge gate is the smallest one.

| Tier | Contents | Runs | Blocks |
| --- | --- | --- | --- |
| **core** | ~365 files (below) | Every push; pre-push (the files a change touches) | Merging into `main`, deploys |
| **extended** | The rest of today's thorough tier, ~1,100 files | Nightly on `main`, and on demand on any branch | Nothing: it reports |
| **opt-in** | Unchanged (dormant halves, Runner, other adapters, CLI, plugins, channels) | On demand only | Nothing |

**Measured:** the candidate core ran green locally in 3m17s (8 workers) under the test lock: 365
files and 6,082 tests, 10.3 minutes of CI time run one at a time (see [the runs](#the-local-runs)).
That's against about 21 minutes for today's thorough tier. In CI, split
into 3 shards, it would finish within the 7 minutes typecheck and `ui-new` already take. A run would
then take about 7 minutes, not 11.

**Against last week's red runs:** 5 of the 10 would have stayed green: the three flake runs, plus
two whose only failures were flakes. The other 5 would still be red, on `openapi-routes`,
`issue-detail-statements` and `run-preview`. The first two are real "you changed the API, update
its record" checks, and `run-preview`'s flake is fixed.

### What's in core

The list is [test-suite-audit/core-candidates.tsv](test-suite-audit/core-candidates.tsv), each file
with its CI time and why it's in. It was chosen by rule, then trimmed by hand:

1. **The package tests in today's thorough tier (231 files):** `packages/shared`, `db`,
   `adapter-utils` (the ACP engine included) and `adapters/claude-local`. They're unit-level, take
   about 5 minutes of CI time in all, and haven't failed a CI run. Left out: `db`'s three tests of the test
   Postgres helpers themselves, and `execution-target-stdin-race` (73 s): they test test
   tooling or a sandbox path, and one timed out under load locally.
2. **Server tests written in this fork (34 files):** steps 4a and 4b. They cover access levels,
   sealed runs, the run preview, MCP, worktrees and permission requests: under a minute in all.
3. **Server tests this fork has had to edit since the freeze (97 files):** a file we had to change
   covers code we changed. Only files that take 15 s or less on CI and appear nowhere in the bug
   list's flake entries (40–83).
4. **Guards and proven catches (3 files, plus `openapi-routes` from rule 3):**
   - **`openapi-routes`:** the MCP catalog (`server/src/mcp/catalog/api.ts`) reads the OpenAPI
     record, so an undocumented route is one agents can't find.
   - **`authz-existence-oracle-guard`:** an access check must come before an existence check.
   - **`issue-detail-statements`:** query count; regenerate it with
     `PAPERCLIP_WRITE_ISSUE_DETAIL_GOLDEN=1`.
   - **`agent-file-checkpoint-locking`:** it caught bug 61.

**Deliberately left out of core** (they go to extended):

- **19 slow files we've edited.** They take 15 s to 5 min each, 22 minutes in all.
  `heartbeat-process-recovery` alone is 5 minutes, and with it go `live-recovery-work`,
  `deferred-execution-receipt-work`, `nested-clone-migration` and others.
- **20 files with a flake history.** These include `run-start-handover`, `workspace-runtime`,
  `controller-instance-lease` and `fresh-continuation-*`.
- **`chat-project-tools`.** It tests a service kept for the dormant Runner. Run alone on this
  machine, its `afterAll` hangs closing the test server: 29 tests pass, then the hook times out at
  30 s. It passes in CI. That's a new finding, not looked into.

**The gap this leaves:** the core has little coverage of restart recovery, leases and continuations.
Every file there is either slow or has a flake history. Nightly runs of extended cover it, and so
does the before-merge rule below.

**New test files land in core.** Extended is a closed list of files from upstream, and it only
shrinks: a file leaves it when it's promoted to core, demoted to opt-in or deleted. That reverses
today's default, where a new file lands in thorough.

### Working rules

- **Merging into `main`:** the branch's latest push is green: typecheck, `ui-new` and core. For a
  branch that changes the run lifecycle, heartbeat, workspaces or recovery (a step-4b-sized
  branch), also dispatch extended on the branch once before merging. Read its result; don't chase it.
- **A red nightly extended run:** spend about ten minutes on it.
  - **A product bug:** fix it, and promote that file to core.
  - **A test problem** (timing, load, a leak, drift): move the file to opt-in with a one-line
    reason, or delete it. Don't investigate it unless it covers code you're changing that week.
  - **No bug-list entry** for test-only problems in extended or opt-in.
- **A core flake** gets fixed the same day or moves to extended. Core has to stay deterministic: a
  file that flakes twice is out.
- **The core's budget:** a core file over 15 s on CI needs a reason in the list, and the whole
  core stays under about 5 minutes locally.
- **Opt-in tests** get fixed only when that subsystem is being woken up. The weekly workflow already
  says so; this makes it the rule, so work like bugs 69 and 71 stops.

## How I'd implement it

One branch, `test/core-tier`, merged `--no-ff` once its CI is green. About half a day for one
agent. The runner already has the parts: tiers, `--files`, shards and weights.

1. **Runner (`scripts/test.mjs`, `scripts/test-tiers.json`):**
   - A new `extended` entry pointing at `scripts/test-extended.txt`, one path per line.
   - Tiers: `core` (every test file not in extended or opt-in), `extended`, `optin`, `quick` and
     `all`. `thorough` stays as an alias for core plus extended until the docs stop using it.
   - `quick` becomes the touched files within core, plus `alwaysQuick`.
   - `checkTiers` checks that every extended path exists and isn't also opt-in.
   - Tests go in `scripts/__tests__/test-runner.test.mjs`.
   - `package.json`: `test` runs core, plus `test:extended`.
2. **Generate `scripts/test-extended.txt`:** today's thorough files minus `core-candidates.tsv`,
   once, with a header line saying how it was made.
3. **`.github/workflows/test.yml`:** the shard job runs `--tier core` with 3 shards instead of 10.
   Refresh the shard weights from the first run (`refresh-shard-weights` already does this).
4. **A new `.github/workflows/extended-nightly.yml`:** a copy of `optin-weekly.yml`, with a daily
   cron and `workflow_dispatch` (so `gh workflow run extended-nightly.yml --ref <branch>` works for
   the before-merge rule). `optin-weekly.yml` becomes `optin.yml`, with no schedule. `deploy.sh` reads only
   `test.yml`, so neither can block a deploy.
5. **The pre-push hook (`scripts/pre-push.mjs`):** typecheck only the packages the push changed
   and the packages that depend on them (`corepack pnpm -r --filter "...[<base>]" typecheck`), not
   the whole workspace (~6.5 GB, the Runner's `cargo check` included). CI still typechecks
   everything. Then `quick`, as now.
6. **Not done: Markdown-only pushes.** add `paths-ignore: ["**/*.md"]` to `test.yml`'s push trigger. Then
   teach `deploy.sh`'s CI lookup to accept the newest green run on an ancestor when every commit
   since touches only `*.md`. Today a bug-list commit like `82d6d1e8fa` runs the whole suite.
   - **Why it was left out:** doing it safely means `deploy.sh` walking back to the newest run that
     ran the tests, and checking that only Markdown changed since. Otherwise a docs push on top of a
     red one would read as green. With core, a run takes about 7 minutes of free CI time and nobody
     waits on a docs push, so the saving isn't worth that logic.
7. **Docs:**
   - `CLAUDE.md`'s Tests section.
   - `doc/test-infrastructure.md`.
   - The note under step 3a in `hard-fork-plan.md`.
   - A line at the top of `fork/upstream-fixes.md` saying test-only problems in extended or opt-in
     don't get entries.
8. **Check:**
   - `node scripts/test.mjs --tier core` three times locally under the lock: same counts each time.
   - `--dry-run --shard i/3` covers every core file exactly once.
   - One CI run on the branch.
   - One dispatched extended run, to see the baseline it starts from.

**Later, separately:** upstream's own CI tooling is still in the tree and isn't used:
`scripts/ci/test-selection*`, `scripts/run-vitest-stable.mjs`, and about 30 `test:*` scripts in
`package.json` for releases, the Runner and canaries. Removing it is a cleanup worth asking about
on its own.

## Questions, answered 2026-11-23

1. **When extended runs:** nightly, and on demand.
2. **The opt-in schedule:** none; on demand only.
3. **`deploy.sh` and a red extended run:** it warns, and the deploy goes on.

## The local runs

Desktop (16 cores, 8 workers), 2026-11-23, `flock /tmp/paperclip-test-bench.lock node
scripts/test.mjs --tier thorough --files <list>`:

- **First candidate list (370 files):** 4m44s. 6,213 tests passed, and 2 files failed on timeouts:
  - **`chat-project-tools`:** the `afterAll` hang above. It fails alone too.
  - **`packages/db/src/test-postgres-command`:** the SIGINT drain timed out at 90 s. It passes
    alone.

  Both were taken out.
- **Trimmed list (365 files):** 3m17s, green: 6,082 tests passed, 8 skipped. Server took 1m57s,
  packages 1m20s.
