# Benchmark baseline

The [benchmark set](bench-set.txt) (60 server files) on `main` at `c85d103eb4`, with
`server/vitest.config.ts` unchanged: one file at a time, `isolate: true`, forks.

| Date (UTC) | Label | Wall | Passed | Failed | Skipped |
| --- | --- | --- | --- | --- | --- |
| 2026-11-18 17:34 | `baseline` | 695.0 s | 1,623 | 0 | 2 |

Every round-1 result is compared with this run: the same passed + skipped count (1,625), and no
failures. Agent D was running at the same time but runs no tests.
