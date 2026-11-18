# Postgres for tests (agent C, round 1)

Branch `test/postgres`. Every run is the [benchmark set](bench-set.txt) (60 server files, 23 of
which reference the Postgres helpers) through `bench.sh`, under the machine-wide lock. The other agents ran
correctness tests outside the lock at the same time, so differences of a few percent are noise.

## Results

| Date (UTC) | Label | What runs | Workers | Wall | Passed | Failed | Skipped |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-18 17:34 | `baseline` (PM, `main`) | per-suite clusters, defaults, `/tmp` | 1 | 695.0 s | 1,623 | 0 | 2 |
| 2026-11-18 18:12 | `pg-tuned` | per-suite clusters, durability off, `/tmp` | 1 | 632.4 s | 1,623 | 0 | 2 |
| 2026-11-18 18:36 | `pg-shm` | per-suite clusters, durability off, `/dev/shm` | 1 | 623.9 s | 1,623 | 0 | 2 |
| 2026-11-18 19:10 | `pg-shared` | one shared server (durability off, `/dev/shm`), a database per suite | 1 | 576.6 s | 1,623 | 0 | 2 |
| 2026-11-18 19:16 | `pg-shared-w6` | same, `--fileParallelism --maxWorkers=6` | 6 | 129.2 s | 1,623 | 0 | 2 |
| 2026-11-18 19:23 | `pg-shm-w6` | per-suite clusters as `pg-shm`, `--fileParallelism --maxWorkers=6` | 6 | 130.6 s | 1,623 | 0 | 2 |
| 2026-11-18 18:50 | `pg-shm-interrupt-w6` | `pg-shm-w6`, SIGINT to the process group after 60 s | 6 | 64.1 s (exit 130) | – | – | – |

Every complete run has passed + skipped = 1,625 and no failures, the same as the baseline.

For the 6-worker comparison with untuned Postgres, agent A's runs on `test/runner` (unchanged
Postgres) are `workers-6` 179.2 s and `workers-6-r1` 139.1 s.

### Where the time went

The Postgres files' summed durations as Vitest reports them (excluding most per-file startup),
against the other 37 files:

| Run | Postgres files | Other files |
| --- | --- | --- |
| `baseline` | 318.9 s | 124.6 s |
| `pg-tuned` | 274.8 s | 122.4 s |
| `pg-shm` | 266.8 s | 124.1 s |
| `pg-shared` | 249.2 s | 117.3 s |
| `workers-6` (agent A, untuned) | 471.9 s | 161.2 s |
| `workers-6-r1` (agent A, untuned) | 339.7 s | 132.2 s |
| `pg-shm-w6` | 301.9 s | 138.7 s |
| `pg-shared-w6` | 300.8 s | 132.6 s |

- **Durability off (C1)** takes 14% off the Postgres files serially (the largest:
  `tool-gateway-service` 68.9 → 58.9 s, `agent-directory-working-copies` 64.1 → 55.9 s,
  `heartbeat-comment-wake-batching` 48.6 → 41.3 s) and 63 s (9%) off the wall time. With 6 workers
  it matters more: six clusters flushing to one disk at once is where the untuned runs lose time
  (Postgres files 340–472 s untuned against 302 s tuned).
- **`/dev/shm` (C2)** adds a little on top: 8 s of file time, 8.5 s of wall time serially. A
  template copy into `/dev/shm` takes ~145 ms against ~290 ms into `/tmp` (measured outside the
  lock, 5 copies each); with fsync off, little else touches the disk.
- **The template build** with fsync off took 4.8 s in a test (it was ~11 s), plus the sync to disk
  before publishing it.

## The template key

Unchanged. The flags are passed at every start (`postgres -c fsync=off -c synchronous_commit=off
-c full_page_writes=off`), not written to `postgresql.conf`, so a template's data directory is the
same with or without them: a template built by `main`'s code works with this branch's and the
other way round. Because the build itself now runs with fsync off, every file of a new template
is fsynced before the rename that publishes it, so a host crash right after a build can't leave a
torn template in the shared cache. No template was deleted.

## Data on tmpfs (C2)

Cluster data goes under `PAPERCLIP_TEST_POSTGRES_DATA_ROOT` when set, else `/dev/shm` on Linux
when it exists and has at least 1 GB free (checked at every start, so a full `/dev/shm` sends later
clusters to `/tmp`), else `os.tmpdir()`, inside a private `paperclip-test-postgres-<uid>`
directory. Decided:

- **The template cache stays in `/tmp`.** A copy from the warm page cache into `/dev/shm` is as
  fast as one from `/dev/shm` (both ~145 ms), and keeping it on disk saves 87 MB of RAM per
  template key, survives reboots and stays shared with every checkout.
- **The template build stays in `/tmp`** too: it's published by a rename, which can't cross
  filesystems.

RAM: each running cluster holds ~90 MB+ in `/dev/shm`. The 6-worker run had at most 6 at once
(5 seen at the interrupt).

## Interrupts and leftovers

**Before this branch** (a child process with one cluster, ended three ways): on SIGINT (exit 130),
SIGTERM (143) and an exit without cleanup (0), Postgres stopped every time, but the cluster's
directory was left behind every time. That's the documented behaviour ("retains its disposable
files for inspection"); on `/dev/shm` it would hold RAM until reboot.

**Now:**

- The owner's shutdown handler stops Postgres, then a shutdown task removes the process's cluster
  directories; the exit guard removes any that are left synchronously.
- The first start in each process removes what a killed process left (SIGKILL, OOM): directories
  whose `postmaster.pid` names a dead process, and ones without a pid file untouched for
  15 minutes. Running clusters, this checkout's or another's, are left alone.
- Tests cover all three endings with a real cluster (`cluster directories when a worker ends
  early`), the sweep, and the command test now looks in the data root.

**Benchmark interrupt** (`pg-shm-interrupt-w6`: 6 workers, SIGINT to the whole process group after
60 s, the way Ctrl-C does it): 5 clusters were running. 1 s later the bench had exited (130);
10 s later there were no postmasters with data in `/dev/shm`, `/dev/shm/paperclip-test-postgres-1000`
was empty, and no new cluster directories were in `/tmp`. Only the empty private directory itself
remains (removing it when empty would race with another worker creating a cluster in it).

**One straggler, not Postgres:** a Vitest fork worker from that run kept running for about two
minutes after the interrupt, reparented to init, with no Postgres attached and a listening socket
on 127.0.0.1, then exited by itself. Some test file in the set apparently installs its own SIGINT
handling or keeps the worker alive. Not chased further (outside this agent's files).

## One shared server (C3)

`node cli/node_modules/tsx/dist/cli.mjs packages/db/src/test-postgres-command.ts --
fork/test-suite-audit/bench.sh pg-shared [args]` starts one tuned server on `/dev/shm`, creates a
migrated template database, and every suite creates and drops its own database from it.

- **Serial:** 576.6 s against 623.9 s for per-suite clusters at the same settings: 47 s of wall
  time, 18 s of Postgres-file time (~0.8 s per Postgres file).
- **6 workers:** 129.2 s against 130.6 s. No measurable difference: with parallel workers each
  cluster's ~0.6 s start and stop runs alongside other files' tests.
- Per suite on the shared server (measured outside the lock, 5 each): `CREATE DATABASE … TEMPLATE`
  ~110 ms with the default `WAL_LOG` strategy, ~58 ms with `STRATEGY FILE_COPY`; `DROP` ~22 ms.

**Recommendation: don't wire it in for now.** If the suite runs with 6–8 workers (agent A), the
shared server saves nothing measurable here, and per-suite clusters keep suites fully apart
(server-wide state such as roles, settings and the connection limit isn't shared, and one crashed
server can't fail every suite). It's worth revisiting only for a serial tier: there it saves about
0.8 s per Postgres file, roughly 11 minutes across 845 files. If it's wired in, do it in the runner
around the server phase, and switch `startTestPostgresDatabase` to `STRATEGY FILE_COPY`
(cheap with fsync off).

## Other findings

- `packages/db/src/prepared-queries-postgres.test.ts` > "retries a pooled statement unprepared when
  its prepared statement cannot be created" failed once in a 2-worker run of the db project and
  passed in 6 runs on its own. It guesses the next prepared-statement name from
  `pg_prepared_statements`, which looks order- or timing-sensitive. Flake, not related to the flags.
- 23 files in the benchmark set reference the embedded-Postgres helpers (the brief said 22 use
  Postgres; one may only import them). The "Postgres files" sums above use these 23.
