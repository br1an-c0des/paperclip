# Test suite: area review

**2026-11-18. Step 3a, round 1, agent D.** Every test file in the default run, sorted into areas,
with a proposal for each area for you to accept or change. The per-file list is
[classification.csv](classification.csv). The numbers come from the
[audit](../test-suite-audit.md): upstream's recorded CI times and this machine's profile. No tests
were run for this review.

## How to read it

**Tiers** (from [hard-fork step 3a](../hard-fork-plan.md#3a-renovate-the-test-suite)):

| Tier | Meaning |
| --- | --- |
| **thorough** | Runs in CI on every push and before merging into `main`. The target is 10–20 minutes for the whole tier, once files run in parallel. |
| **opt-in** | Runs only on demand (agent A's `test:optin`). For dormant areas, and for slow suites worth keeping but not on every push. |
| **split** | A shared file whose tests are mostly about dormant paths. Proposal: move the dormant tests into an opt-in file and keep the rest in thorough. |
| **remove** | Delete the tests. Proposed only where the subsystem itself is being removed. Nothing is, so nothing is proposed for removal. |

The **quick** local tier isn't decided per area: it's "the tests for what you changed" (agent A's
runner picks them).

**Labels** follow [repo-map.md](../repo-map.md#labels): **ours** (code this fork uses and changes
freely), **shared** (core code the live `claude_local` path runs through, tangled with dormant
features), **dormant** (code this setup doesn't use).

**Columns in the area table:**

- **Files**: test files in the default run.
- **Recorded**: minutes of upstream's recorded CI time for those files (`scripts/*-shard-durations.json`),
  added up as if run one at a time. Only server files have recorded times.
- **Measured**: minutes on this machine, for the 304 heaviest server files the profile reached
  (`profile-2026-11-18.csv`). Blank areas weren't reached.
- **Proposal**: the tier for the area's files. Exceptions are in the CSV.

## Totals

The default run is every project in the root `vitest.config.ts`, with each project's own include
patterns. That's **2,736 files**: 2,220 in the server and 516 in 19 packages. Each file is in
exactly one project, and the CSV has one row per file.

| | Files | With recorded time | Recorded min | Measured files | Measured min |
| --- | --- | --- | --- | --- | --- |
| Server | 2,220 | 2,009 | 380.7 | 304 | 120.9 |
| Packages (19 projects) | 516 | 0 | — | 0 | — |
| **Total** | **2,736** | 2,009 | 380.7 | 304 | 120.9 |

**Against the audit:** the audit has ~2,012 server files with ~381 minutes of recorded time. Here
2,009 files have a recorded time, 380.7 minutes in all (0.2% apart). The durations files list 3 more
files that no longer exist (`app-vite-dev-routing`, `heartbeat-start-lock` and `vite-html-renderer`,
gone with the old UI). The audit's "2,212 server test files" leaves out the 8 `server/scripts/*.test.mjs`
files the server project also runs; with them it's 2,220. 211 server files are newer than upstream's
durations snapshot and have no recorded time. The packages have none either; the audit estimated
them at ~15 minutes.

**By label:**

| Label | Files | Server files | Recorded min | Measured min |
| --- | --- | --- | --- | --- |
| ours | 264 | 246 | 34.0 | 5.3 |
| shared | 1,174 | 960 | 174.3 | 58.5 |
| dormant | 1,298 | 1,014 | 172.5 | 57.1 |

**By proposed tier:**

| Tier | Files | Server files | Recorded min | Measured min |
| --- | --- | --- | --- | --- |
| thorough | 1,429 | 1,198 | 204.6 | 62.3 |
| split | 9 | 8 | 3.6 | 1.5 |
| opt-in | 1,298 | 1,014 | 172.5 | 57.1 |
| remove | 0 | 0 | 0 | 0 |

If every proposal is accepted, the thorough tier's server part is 1,206 files and about 208 recorded
minutes (55% of today's server time), plus 231 package files. Opt-in holds the rest, including the
chat-channel suite.

**Why the dormant share is 45%, not the audit's 26%.** The audit matched file names only, and said
that undercounts. This review also reads imports and test names, and puts these in dormant:

- Cloud idle sleep (`idle-*`, `sleep-*`, 8.6 min) and Cloud hosting (`maintenance-*`, `ephemeral-*`,
  `cloud-*`, 8.4 min). Idle sleep is the protocol that lets Paperclip Cloud stop an idle instance
  ([doc/idle-sleep-safety.md](../../doc/idle-sleep-safety.md)).
- Retained-workspace recovery (`workspace-recovery-*`, 16.8 min). Its code lives in `services/`, but it
  only acts on Runner runs (`runtimeMode = 'native'`, remote workspaces, `paperclip_runner`
  preparation; see `services/workspace-recovery.ts`).
- External chat by name outside the chat-channels folder (`chat-*`, `durable-chat-wakeup`, email
  channels, 12.5 min on top of the big suite).
- Remote workspaces (14.3 min) and sandbox environment drivers, leases and probes (4.7 min).

**The chat-channel suite** (`chat-channels.integration.test.ts`) has 7.1 recorded minutes, but it
took **34 minutes measured** here, as 6 shards. It isn't in the profile CSV, so its `local_s` is
blank. Counting the measured time, dormant suites are about 50% of the server's time.

## Decisions (2026-11-18)

Gone through with the user on 2026-11-18. These override the proposals in the table below where they
differ.

| Question | Decision |
| --- | --- |
| Dormant areas (native runtime, chat channels, Cloud, remote, sandbox, managed, other adapters, voice, connectors, and the rest proposed opt-in) | **Opt-in, files kept.** Nothing is removed; tests go when their subsystem does (hard-fork step 3). |
| Tool access (69 files) | **Thorough.** Step 4a reworks this area. |
| Cases (13 files) | **Thorough.** The user uses cases. |
| CLI (66 files) | **Opt-in.** Not used. |
| Plugins (38 files: the plugin host's server tests and the plugin SDK) | **Opt-in.** No plugin is used. |
| The 9 split files | **Split:** dormant tests move to an opt-in file next to each, and the live-path tests stay in thorough. |
| `heartbeat-process-recovery.test.ts` | **Split** along its `describe` blocks; the native and sandbox blocks go to opt-in. |
| Slow core tests | **Stay in thorough**, and are fixed in round 2 (fake timers, test-sized intervals), each fix signed off. |
| When the opt-in tier runs | **Only on demand,** never on a schedule. |
| Everything else in the table | As proposed. |

## Areas

Biggest recorded time first. Areas with no recorded time (the packages) are at the end.

| Area | Files | Recorded | Measured | Label | Proposal | Question for you |
| --- | --- | --- | --- | --- | --- | --- |
| native-runtime | 382 | 74.9 | 25.0 | dormant | opt-in | The Paperclip Runner's server side and Runner-named files elsewhere. Opt-in until the Runner is removed? (When it is, these go with it.) |
| heartbeat | 243 | 54.4 | 19.6 | shared | thorough (2 split) | Wakes, queue, dispatch, run lifecycle: every run passes through. Keep it all in thorough? Several files mix in native cases (`workspace-preparation`, `run-completion`, `runtime-selection`). |
| recovery | 140 | 41.4 | 17.5 | shared | thorough | Restart recovery, leases, continuations, issue recovery sweeps. Legacy and native paths share files. Keep in thorough and fix the slow tests (below), or move the slowest to opt-in until they're fixed? |
| chat-channels | 160 | 19.6 (+34 measured for the suite) | 3.0 | dormant | opt-in | Slack, Teams, Discord, Telegram, GitHub review bots, email. Opt-in, including the 86,288-line suite? |
| workspace | 90 | 18.6 | 7.2 | shared | thorough | Local worktrees, restore points, re-homing, runtime services. Keep in thorough? |
| workspace-recovery | 17 | 16.8 | 10.4 | dormant | opt-in | Retained-workspace recovery acts only on Runner runs. Agree it's dormant? |
| tools | 69 | 15.8 | 6.4 | shared | thorough | Tool connections, gateways, OAuth grants. Called on every run, but they do nothing without assigned connections, and this setup has none. Thorough, or opt-in until step 4 settles MCP? |
| remote | 62 | 14.3 | 7.2 | dormant | opt-in | Remote workspaces, SSH, runtime exposure. Opt-in? |
| requests | 51 | 12.7 | 2.9 | ours | thorough | Approvals, decisions, questions, attention feed, inbox. Keep in thorough? |
| issues | 87 | 11.0 | 0.5 | shared | thorough | Tasks, comments, thread interactions, tree control. Keep in thorough? |
| agents | 82 | 9.7 | 1.3 | shared | thorough (4 split) | Agent routes, instructions, directories, the adapter registry, hiring. Split the four files whose tests are mostly about Runner choice and other adapters? |
| idle-sleep | 41 | 8.6 | 3.9 | dormant | opt-in | Cloud idle sleep. The request-tracking middleware runs everywhere, but these tests check sleep-safety reports. Agree? |
| cloud | 57 | 8.4 | 0.0 | dormant | opt-in | Paperclip Cloud hosting, maintenance and ephemeral servers. `maintenance-server-routes` alone is 4.6 min. Opt-in? |
| auth-access | 90 | 7.6 | 0.4 | ours | thorough | Board sessions, run JWTs, invites, permissions. Keep in thorough? |
| skills | 37 | 7.5 | 2.9 | shared | thorough | Company skills and skill sources. Step 4 slims this; keep in thorough until then? |
| environments | 47 | 6.7 | 1.7 | dormant (6 shared) | opt-in (5 thorough, 1 split) | Only the local driver path is live (orchestrator, runtime, selection, execution target). Agree the other 41 (sandbox drivers, leases, probes, plugin environments) are opt-in? |
| external-agents | 31 | 4.7 | 1.6 | dormant | opt-in | Muse, Dot, Grok, Antigravity, browser-use. Opt-in? |
| catalogs-telemetry | 59 | 4.1 | 0.5 | dormant | opt-in | Import/export, team and skill catalogs, telemetry, Sentry, feedback, announcements. Some tests check that core routes emit telemetry events. Opt-in? |
| platform | 85 | 3.8 | 0.5 | shared | thorough | Startup, HTTP, errors, logging, database plumbing, backups, health. Keep in thorough? |
| connectors | 69 | 3.6 | 0.8 | dormant | opt-in | App connectors and connection providers. Opt-in? |
| managed | 28 | 3.5 | 0.7 | dormant | opt-in | Claude Managed and managed AI connections. Opt-in? |
| git-github | 28 | 3.2 | 1.2 | shared | thorough | Git restore points, GitHub skill sources and credentials. Keep? |
| plugins | 38 | 3.0 | 0.3 | shared | thorough | The plugin host (threaded through core routes) and the plugin SDK. No plugin is used. Thorough, or opt-in? |
| agent-chat | 10 | 2.9 | 0.5 | ours | thorough | Agent chat (conversation mode), which step 6 replaces. One Conference Room file is opt-in. Keep the rest? |
| goals-activity | 16 | 2.8 | 0.9 | ours | thorough | Goals, activity, live events, status cards. Keep? |
| documents | 31 | 2.6 | 0.2 | ours | thorough | Documents, artifacts, attachments, storage. Keep? |
| sandbox | 99 | 2.4 | 1.0 | dormant | opt-in | Sandbox providers, the Daytona plugin, sandbox helpers in adapter-utils and the plugin SDK's environment protocol. Opt-in? |
| voice | 12 | 2.1 | 0.5 | dormant | opt-in | Voice sessions (Speko). Opt-in? |
| routines | 11 | 2.1 | 0.2 | ours | thorough | Keep? |
| company | 26 | 2.0 | 0.2 | shared | thorough | Companies, instance settings, search. Keep? |
| cases | 13 | 2.0 | 0.4 | dormant | opt-in | Cases are behind `enableCases` (off), but ui-new has a cases folder. Do you use cases? If so, these move to thorough. |
| public-mcp | 26 | 1.8 | 1.2 | dormant | opt-in | Public MCP (off). Step 4 may borrow from it. Opt-in for now? |
| costs-budgets | 20 | 1.8 | 0.0 | ours | thorough | Keep? |
| secrets | 21 | 1.0 | 0.1 | shared (1 dormant) | thorough | Local secrets and redaction; the AWS provider file is opt-in. Keep? |
| other-adapters | 125 | 0.9 | 0.1 | dormant | opt-in | The 11 other adapter packages and their server tests. Opt-in? |
| projects | 10 | 0.9 | 0.0 | ours | thorough | Keep? |
| claude-local | 32 | 0.6 | 0.2 | ours (6 dormant) | thorough (6 opt-in) | The `claude_local` adapter. Its setup-token, remote and sandbox tests are opt-in. Agree? |
| dev-tooling | 11 | 0.4 | 0.0 | shared (1 dormant) | thorough | The `pnpm dev` runner and test helpers (not the Paperclip Runner). Keep? |
| openapi | 2 | 0.2 | 0.0 | shared | thorough | Keep? |
| server-scripts | 8 | 0.1 | 0.1 | shared | thorough | `server/scripts/*.test.mjs` (build and bundle scripts). Keep? |
| shared-pkg | 84 | — | — | shared | thorough | `packages/shared`, minus 25 dormant-named files spread over other areas. Keep? |
| db | 69 | — | — | shared | thorough | Schema, migrations, clients, embedded-Postgres helpers. 16 migration tests for dormant tables are opt-in. Keep the rest? |
| acp-engine | 20 | — | — | shared | thorough | The ACP engine in adapter-utils. repo-map calls it dormant, but `claude_local` runs on it by default ([claude-local-run.md](../claude-local-run.md#three-ways-a-claude-agent-runs)). Keep in thorough until you pick one engine (step 4)? |
| adapter-utils | 30 | — | — | shared | thorough (1 split) | Wake-prompt rendering and the child-process runner. 43 sandbox, SSH and Runner helpers from this package are under sandbox. Keep? |
| cli | 66 | — | — | dormant | opt-in | The `paperclipai` CLI isn't used by the deploy or `pnpm dev` (repo-map: "dormant?"). Do you use any CLI command? If so, those files move to thorough. |
| plugins-dormant | 1 | — | — | dormant | opt-in | Plugin scaffolding (`create-paperclip-plugin`). Opt-in? |

## Judgment calls

These are the calls most likely to be wrong. Each is a reason in the CSV.

- **Idle sleep is dormant.** The idle-admission middleware is mounted on every request, and graceful
  shutdown shares the "tracked work" counter. But the test files check the sleep-safety reports and
  proofs that Cloud uses before stopping an instance. `idle-admission.test.ts` itself stays in
  heartbeat (thorough).
- **Retained-workspace recovery is dormant** although it sits in `services/`. The code's own queries
  require a native run or a `paperclip_runner` preparation.
- **The ACP engine is shared, not dormant.** repo-map marks `acpx-engine/` dormant, but
  claude-local-run.md shows ACP is the default engine for a `claude_local` agent. If you settle on the
  CLI engine in step 4, these 20 files become dormant.
- **Tool access stays shared.** `buildPaperclipRuntimeMcpServers` runs on every run, so the code is
  live, but almost all of the 69 files test connections this setup doesn't have. It's the biggest
  "used but idle" area (15.8 min).
- **External chat versus agent chat.** Files named `chat-*` are external chat channels (they import
  `chat-channels/`, `chat-run-publications` or native chat code). Agent chat is `agent-chat*`,
  `agent-conversation*`, `conversation-*`, `issue-chat-bootstrap`, `issue-recovery-conversations` and
  `chat-project-tools` (the project-tools MCP).
- **Mixed files stay thorough.** `heartbeat-process-recovery`, `live-recovery-work`, `run-completion`,
  `workspace-preparation`, `recovery.test.ts` and `heartbeat-execution-configuration` have a quarter to
  a third of their tests on native or sandbox runs. The rest is the live path, so they stay in
  thorough rather than split.
- **Split is picked from test names.** A shared file is proposed for split when at least half of its
  test names mention dormant terms (native, Runner, remote, sandbox, cloud, managed, other harnesses)
  and it has at least 400 lines. Smaller files like that keep their tier, and the reason says so. The
  9 split files: `environment-runtime`, `agent-adapter-validation-routes`, `runtime-selection`,
  `agent-runner-selection`, `adapter-auth-signal-routes`, `agent-instructions-service`,
  `adapters/registry`, `run-evidence-migration` and adapter-utils' `execution-target`.
- **Telemetry route tests are dormant.** `issue-telemetry-routes`, `routine-run-telemetry` and the like
  call core routes, but what they check is the PostHog events.
- **Unclear, kept core:** `ownership-reconciliation-report` (native and legacy controllers),
  `fast-responses` (behind a flag that's off), the `provider-trace-*` files, and `external-object*`
  (behind `enableExternalObjects`, off). Each says "unclear" or names the flag in its reason.

## Slow core tests

Every non-dormant test that took over 5 seconds in the profile: **52 tests in 25 files, 15.0
minutes**. The profile had 95 tests over 5 s in all (24.8 minutes); the other 43 are in dormant files.
Only the 304 measured files are covered. Files in the same family that the profile didn't reach
probably share the same causes: `issue-recovery-dependencies` (178 s recorded), `-assignments` (134 s)
and `-conversations` (74 s) use the same fixture as `issue-recovery-deadlines`.

Two patterns cause most of it:

1. **Waiting on real deadlines.** Recovery workers have 30-second reconstruction intervals, lease
   expiries and grace periods. Many tests keep a real clock so that leases and child processes behave,
   then wait in `vi.waitFor` for those deadlines in wall time. 75 server test files use
   `vi.useFakeTimers({ shouldAdvanceTime: true })`, which makes fake timers advance at wall speed, so a
   `setTimeout(…, 31_000)` in those files really waits 31 s.
2. **Deliberate load.** Tests that saturate a connection pool with `pg_sleep`, insert tens of
   thousands of rows to pass Postgres's 65,535-parameter limit, or write big files. Those are slow by
   design. They gain from agent C's Postgres tuning, not from timer changes.

| File | Tests over 5 s (s) | Likely cause | Suggested fix |
| --- | --- | --- | --- |
| `deferred-execution-receipt-work` | 8: 65, 36, 35, 35, 12, 5, 5, 5 | Fake timers with `shouldAdvanceTime: true`. Line 894 is a literal `await new Promise(resolve => setTimeout(resolve, 31_000))`. The paused-agent and subtree-hold cases wait (up to 40 s) for the worker's 30 s reconstruction interval and 30 s delayed-resume deadline (`heartbeat/deferred-receipt-work.ts:43`, :112–140) on wall time | Replace line 894 with `vi.advanceTimersByTimeAsync(31_000)`. After releasing the gate, step the fake clock to `coordinator.nextWakeAt()` instead of waiting. Or let the test pass a short `reconstructionIntervalMs` |
| `live-recovery-work` | 5: 66, 65, 38, 16, 8 | `start(true)` keeps a real clock for lease expiry; `quiet()` then does `realDelay(31_000)` when not on fake timers (line 125), 31 s per test. The process-lost retry is awaited in real time (`vi.waitFor` up to 45 s) | Switch to fake timers once the real child process has exited, then advance 31 s, as the other `quiet()` helpers do. Give the retry a test-sized delay |
| `issue-recovery-deadlines` (fixture `issue-recovery.test-fixture.ts`) | 4: 38, 36, 33, 32 | Workers run on the real clock until `quiet()`. Tests wait for a stored controller lease (5 s), a first-run grace (15 s), 30 s passes and scheduled retries (`finish()` allows +30 s) | Install fake timers in the fixture's `start()` and drive them with `advanceTimersByTimeAsync(nextWakeAt - now)`. Keep real time only around the child processes. Fixes the whole `issue-recovery-*` family |
| `managed-skill-content` | 3: 28, 19, 14 | Each test runs `node --import tsx` on a maintenance script (line ~182), which compiles the server's module graph from cold in a child process. The tests are about Cloud maintenance | Move the three Cloud-maintenance cases to opt-in (dormant). Otherwise call the maintenance entry point in-process |
| `ownership-reconciliation-report` | 2: 31, 7 | After `worker.wake()` the test polls up to 60 s for a second report (line 1293); the worker probably has a minimum interval between passes, on wall time. The other inserts 2,000 runs | Fake timers and advance to `nextWakeAt()`, or an injectable interval. Seed with one `insert … select generate_series` |
| `attention-service` | 2: 25, 6 | Volume: 16,390 failed runs inserted in 1,000-row chunks, to exceed the bind-parameter limit | Seed with one `generate_series` statement. Keep the test |
| `heartbeat-observed-workspace-preservation` | 1: 31 | A native workspace-preservation case. It waits for a retry up to ~36 s away (`nextAttemptAt`), up to 40 s | Dormant path in a shared file: move to opt-in, or advance a fake clock to `nextAttemptAt` |
| `failed-continuation-continues-again` | 2: 17, 12 | No timers. Many sequential seeds and recovery passes, one per failure code | Fewer failure codes per test (`it.each` over a sample) and tuned Postgres |
| `controller-instance-lease` | 2: 11, 8 | Deliberate `pg_sleep(12)` to saturate the pool (line 238) and a held row lock. Cleanup waits for the sleep to end | Cancel the sleeping backend (`pg_cancel_backend`) once the assertion passes, or sleep 2–3 s |
| `legacy-controller-lease` (services) | 2: 10, 5 | Same pattern: four `pg_sleep(5)` transactions (line 282) and one `pg_sleep(5)` (line 247) | Cancel the backends after the assertion, or shorter sleeps. This file also failed 2 tests in the audit run (bug list entry 40) |
| `nested-clone-migration` | 3: 7, 6, 5 | Real git work, plus a literal 3 s wait (line 398) | Replace the 3 s wait with a signal or a poll. The git cost stays |
| `agent-directory-working-copies` | 2: 8, 8 | Many files to pass the entry-count limit; `vi.waitFor` with 1 s fake steps | Make the entry limit injectable and lower it in the test |
| `workspace-runtime` | 1: 15 | Port allocation with a fake `lsof` that always fails; it probably tries a whole port range, each with a timeout. Not confirmed | A test-sized port range or probe timeout |
| `isolated-repository-rehome` | 2: 8, 5 | A 65 MB file and 1,000 directories (volume) | Lower the restore-point and cleanup limits for the test |
| `connection-management.integration` | 2: 6, 6 | Delegated Slack sends: a dormant connector inside a shared file | Move those two cases to opt-in |
| `attention-retention-work` | 2: 6, 6 | Volume (225 issues; trees over 65,535 nodes) | Keep. Tuned Postgres helps |
| `status-card-evaluation-work` | 1: 11 | Twenty cards and their time conversions, stepped on a fake clock | Fewer cards. Keep the bound |
| `issue-tree-pause-resume-run` | 1: 10 | Unclear from the code: a gated adapter, pause and release, then reconciliation | Needs a look with a per-step timer |
| `github-skill-source` | 1: 10 | Audits a 1 MB script in a child process, by design | Keep |
| `heartbeat-comment-wake-batching`, `satisfied-connection-intents`, `heartbeat-workspace-busy`, `approval-queue-seeding-work`, `heartbeat-stale-queue-invalidation`, `heartbeat/recovery` | 1 each: 7, 6, 6, 6, 6, 5 | `satisfied-connection-intents` uses a 5 s worker `retryMs`; `heartbeat-workspace-busy` is a sandbox case; `heartbeat/recovery` waits out a real 4 s remote lease; the rest are multi-step dispatch on a real clock | Test-sized `retryMs`; move the sandbox and remote cases to opt-in; leave the rest |

## Core files over 5,000 lines

| File | Lines | Recorded | Measured | Split for parallel balance? |
| --- | --- | --- | --- | --- |
| `tool-access-service.test.ts` | 21,476 | 95 s | 52 s | No: not slow. Splitting would only help reading it |
| `heartbeat-process-recovery.test.ts` | 17,661 | 344 s | — | Maybe. At 5.7 min it's the longest core file. See below |
| `workspace-runtime.test.ts` | 10,226 | 89 s | 73 s | No |
| `acpx-engine/execute.test.ts` (adapter-utils) | 9,344 | — | — | No time recorded. Check once the runner measures packages |
| `issues-service.test.ts` | 7,217 | 40 s | — | No |
| `environment-runtime.test.ts` | 6,887 | 94 s | 44 s | Yes, but for the tier: it's proposed for split (sandbox lease matching out) |
| `tool-gateway.test.ts` | 6,716 | 93 s | 46 s | No |
| `execution-workspaces-service.test.ts` | 5,285 | 58 s | 23 s | No |

**How this matters for a parallel run.** Vitest runs the tests inside one file one at a time here
(`maxConcurrency: 1`), so a file is the smallest unit a worker can take. The run can't finish before
its longest file. The thorough server tier is about 208 recorded minutes one file at a time. Spread
over 8 workers that's ~26 minutes, so a 5.7-minute file fits well inside it today. It starts to hold
the run up only once the overhead fixes bring the whole tier near 6–8 minutes per worker. Vitest
starts the longest files first, which helps. Splitting `heartbeat-process-recovery` along its
existing `describe` blocks (server restart, owning server still serving, sandbox refusal, paused
maintenance…) would also make its native and sandbox blocks easy to move to opt-in. The others are
large but not slow; length alone isn't a reason to split them.

## Other findings

- **1,774 test-looking files are outside the default run.** By design: `tests/` (833: `runner-e2e`
  749, `restart-chaos` 71, and others), the Runner package (456), `ui-new` (289, its own runner),
  root `scripts/` (89, run with `node --test` by `test:release-registry`), plugins other than the
  SDK, scaffolding and Daytona (48), `.github/` (32), the MCP and auxiliary packages (25), and one file
  each in `packages/db/scripts` and `server/test-baselines`. None of them is in the CSV. If any should be in a tier (root `scripts/__tests__` is tooling we run), round 2 adds them as a
  phase.
- **No duplicates.** Each file is in exactly one project.
- **Skipped tests.** 6 files have a hard `describe.skip`, `it.skip` or `todo`: `cli/.../worktree`,
  `company-model-service-settings-guidance`, `person-only-page-guidance` (2),
  `plugin-managed-routine-guidance`, `vitest-chat-shards` and `agent-invented-host-links`. About 880
  files skip only when embedded Postgres is unsupported on the platform, which isn't the case here.
- **16 files show no `it`/`test` call to a text scan.** They build tests through wrappers
  (`it.extend` in `maintenance-server-routes`, `describeIssueRecovery`, generated cases in native
  integration suites). Not broken, but the CSV can't count their tests.
- **Postgres:** 846 server files start an embedded Postgres directly (the audit says 845), and 76 more
  start one through a shared fixture (for example `issue-recovery.test-fixture.ts`). The CSV marks
  both `yes`; the reason notes the fixture ones. 986 files in all, packages included.
- **A server test imports the Runner's end-to-end helpers:** `chat-completion-proof.test.ts` imports
  from `tests/runner-e2e/`. It's dormant (external chat) and opt-in, but removing `tests/runner-e2e`
  would break it.
- **The audit's failing files** are labelled: three are dormant (native) and opt-in;
  `services/legacy-controller-lease.test.ts` is core and thorough.

## How the CSV was made

- The file list: `git ls-files` matched against each project's include and exclude patterns. Four
  projects (adapter-utils, cursor-cloud, cursor-local, grok-local) have no `vitest.config.ts`, and
  the other adapter configs and the CLI's set no `include`, so Vitest's defaults apply to them (`**/*.{test,spec}.?(c|m)[jt]s?(x)`,
  excluding `node_modules` and `.git`).
- Areas and labels: path rules first (`services/native-runtime/`, `services/chat-channels/`…), then
  file-name rules, then overrides for about 30 files read by hand, mostly the slowest. Package files
  use their package's label, with name rules for the dormant parts (sandbox helpers, migrations for
  dormant tables).
- Evidence in the reasons: how many test names mention dormant terms, how many dormant modules the
  file imports, and how many `native`/`paperclip_runner` literals it has against `legacy`/`claude_local`.
  Many core tests use `codex_local` or `process` as a stand-in adapter, so the counts are a guide, not
  proof.
- `ci_s` is the recorded milliseconds ÷ 1,000 (general and serialized shards; the chat durations file
  is per test, so it isn't used). `local_s` is the profile's `local_s` column.
- No test was run, and no `vitest list`.
