# Upstream fixes

Small, self-contained fixes the fork sends to `paperclipai/paperclip` as pull requests instead of
carrying them as fork patches: candidates found while building `ui-new`, and what has been built,
submitted and merged. How to build and send one is in
[FORK.md](../FORK.md#contributing-fixes-upstream).

## How to use this list

- **Add a candidate when you find one:** the next number, a one-line title, status `candidate`,
  and a section below saying what's wrong, where, the likely fix, and anything in the fork that
  works around it.
- **Move it along as it changes:**

  | Status | Meaning |
  | --- | --- |
  | `candidate` | Found and described; nothing built yet |
  | `building` | Being built on its `fix/*` or `docs/*` branch off `master` |
  | `ready` | Built and tested; waiting for review before it goes upstream |
  | `submitted` | Pull request open upstream |
  | `merged` | Merged upstream; it reaches the fork through the next sync |
  | `closed` | Closed without merging, or dropped; say why |

- **Fill in the branch, the pull request and the date** of each step, and note in its section any
  fork workaround to remove once it's merged.
- Before building one, search upstream for a duplicate pull request, as upstream's PR template asks.
- Build a fix only once the user has signed off on it, with the `upstream-fix` skill
  ([.claude/skills/upstream-fix/SKILL.md](../.claude/skills/upstream-fix/SKILL.md)).

Larger ideas and features that need agreement in upstream's `#dev` channel stay in the
[build plan](../ui-new/docs/build-plan.md#stage-2-small-upstream-contributions) and the proposals
that found them, such as
[unifying requests](../ui-new/docs/proposals/unifying-requests.md#small-upstream-contributions),
until one becomes a concrete fix.

## The list

| # | Fix | Status | Branch | Pull request | Found | Submitted | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [Clear the compact issue-list cache when an issue changes](#1-clear-the-compact-issue-list-cache-when-an-issue-changes) | submitted | `fix/issue-list-cache-invalidation` | [#17828](https://github.com/paperclipai/paperclip/pull/17828) | 2026-10-26 | 2026-10-26 | |
| 2 | [Don't crash on Windows when an agent directory path is longer than 260 characters](#2-dont-crash-on-windows-when-an-agent-directory-path-is-longer-than-260-characters) | submitted | `fix/agent-directory-probe-long-cwd` | [#17691](https://github.com/paperclipai/paperclip/pull/17691) | | 2026-10-26 | |
| 3 | [Let a pause finish after a restart stopped a legacy run during preparation](#3-let-a-pause-finish-after-a-restart-stopped-a-legacy-run-during-preparation) | submitted | `fix/pause-after-restart-during-preparation` | [#17692](https://github.com/paperclipai/paperclip/pull/17692) | | 2026-10-26 | |
| 4 | [Link the plugin SDK on Windows without symlink rights](#4-link-the-plugin-sdk-on-windows-without-symlink-rights) | candidate | | | 2026-10-24 | | |
| 5 | [Start `pnpm dev` on Windows when the native runner is enabled](#5-start-pnpm-dev-on-windows-when-the-native-runner-is-enabled) | candidate | | | 2026-10-26 | | |
| 6 | [Detect glibc reliably at server startup so Paperclip Runner is offered on Linux](#6-detect-glibc-reliably-at-server-startup-so-paperclip-runner-is-offered-on-linux) | building | `fix/runner-libc-probe-startup` | | 2026-10-26 | | |

## Details

### 1. Clear the compact issue-list cache when an issue changes

- **Problem:** the server answers repeated compact issue-list requests from a cache
  (`ISSUE_LIST_SERVER_CACHE_TTL_MS = 2000` in `server/src/routes/issues.ts`, keyed by actor and
  query; responses carry `x-paperclip-request-cache`). Creating, updating or deleting an issue
  doesn't clear it, so a list fetched within 2 seconds of a change can still show the old values.
  In `ui-new` this made rapid edits from the task list snap back.
- **Likely fix:** clear the company's cached list entries on issue writes (create, `PATCH`,
  delete, and other routes that change fields the list shows), with a server test that changes an
  issue and lists it again within the cache's lifetime.
- **Fork workaround to revisit once merged:** `ui-new/src/tasks/task-updates.ts` holds changed
  values for `HOLD_MS` (2.5 seconds) and then refetches the lists. The hold can be shortened or
  removed.

### 2. Don't crash on Windows when an agent directory path is longer than 260 characters

- **Problem:** before a local run, the server observes the agent directory in a child Node
  process whose working directory is that directory. On Windows a process can't start in a working
  directory longer than about 260 characters, and Node then throws an uncaught `read ENOTCONN` that
  stops the server.
- **Fix:** start the child process from the drive root and pass the directory as an argument.
- **Files:** `server/src/services/agent-directory-probe.ts`, its test, and `doc/agent-files.md`.

### 3. Let a pause finish after a restart stopped a legacy run during preparation

- **Problem:** if the server stops while a legacy run is preparing, the run keeps the `preparing`
  stage, an expired lease and no process ID. Pausing the agent cancels the run, but
  `agentExecutionsHaveStopped` finds no stop proof for it, so the agent stays in `pausing`.
- **Fix:** accept the proof restart recovery already uses (setup stopped before provider work, with
  no launch, session or provider evidence) in the stop check.
- **Files:** `server/src/services/agent-execution-stop.ts`,
  `server/src/services/cancelled-native-startup.ts`, the lifecycle test, and
  `doc/execution-semantics.md`.

### 4. Link the plugin SDK on Windows without symlink rights

- **Problem:** the root `postinstall` (`scripts/link-plugin-dev-sdk.mjs`) symlinks the plugin SDK
  into plugins outside the pnpm workspace. Windows refuses to create symlinks (`EPERM`) unless
  Developer Mode is on or the shell runs as administrator, so `pnpm install` fails at the end.
  Found in the [2026-10-24 sync](sync-reports/2026-10-24.md); build plan item 2a-7.
- **Likely fix:** on Windows, create a directory junction (`fs.symlinkSync(target, path, "junction")`),
  which needs no special rights, or fall back to one when the symlink fails with `EPERM`.
- **Fork workaround to revisit once merged:** none in the code. This machine has Developer Mode on.

### 5. Start `pnpm dev` on Windows when the native runner is enabled

- **Problem:** with the instance setting `enableNativeRunner` on, `pnpm dev` builds the Rust runner
  (`scripts/dev-runner.ts`, `getNativeRunnerRequired`). On Windows the crate doesn't compile:
  `VerifiedProcessLaunch::spawn_stdio` in
  `packages/paperclip-runner/runner/crates/runner-core/src/process_supervisor.rs` calls
  `inherited_command()`, which exists only under `#[cfg(any(target_os = "linux", target_os = "macos"))]`
  (error E0599). The dev runner then exits, so the server never starts. Windows isn't a supported
  runner platform (`localPaperclipRunnerSupported()` is false, and verified process snapshots are
  Linux and macOS only), but the flag alone forces the build.
- **Likely fix, one of:**
  - in the dev runner, when the platform can't run the native runner, warn and start without it
    instead of building (unless `PAPERCLIP_RUNNER_BINARY` is set);
  - or give `spawn_stdio` (or `inherited_command`) a non-Unix version that returns
    `LocalRunnerError::invalid(...)`, so the crate compiles everywhere and fails only at run time.
  Check first whether upstream wants Windows dev to work with the flag on, or prefers that the flag
  be refused on Windows.
- **Fork workaround:** keep `enableNativeRunner` off in local instances on this machine
  (`PATCH /api/instance/settings/experimental`). Found when the `~/.paperclip-test` instance
  wouldn't start after the 2026-10-26 sync.

### 6. Detect glibc reliably at server startup so Paperclip Runner is offered on Linux

- **Problem:** `server/src/lib/agent-runner-platform.ts` probes libc with
  `execFile("getconf", ["GNU_LIBC_VERSION"], { timeout: 1_000, killSignal: "SIGKILL" })` from a
  top-level await, so the probe starts while the module graph is still loading. The rest of the
  server's imports then load synchronously for several seconds (about 7 s under tsx), so the 1 s
  timeout fires before the child's exit callback. Node answers with no error and empty stdout, the
  version regex doesn't match, and the target is cached as `libc: "unknown"`. `supportsLinuxLibc`
  rejects that, so `agentRunnerAvailability` reports `supportedRunners: ["legacy"]` for every
  Runner harness on glibc Linux: "Upgrade to Paperclip Runner" never appears and the Runner can't be
  chosen. It came in with #16335 ("probe libc asynchronously before serving requests"), whose test
  delays the subprocess rather than the event loop. No existing issue or pull request covers it.
- **Likely fix, one of:**
  - probe with `execFileSync` and a timeout (`getconf` answers in about 5 ms, and a synchronous
    call can't be starved by module loading);
  - or start the async probe after imports finish, during startup before the listener binds;
  - or retry once when the result is empty or unknown instead of caching it.
  Test: block the event loop for more than 1 s after the probe starts and expect `glibc`.
- **Files:** `server/src/lib/agent-runner-platform.ts` and its test.
- **Evidence:** reproduced on this machine (WSL2 Ubuntu, x64, glibc 2.39) by importing
  `server/src/app.ts` (two of two runs `unknown`) and by a minimal script: a `getconf` call blocked
  for 1.2 s or more returns `''` with no error, and under 1 s returns `glibc 2.39`.
- **Fork workaround:** none. Agents on this machine use the Legacy runner until it's fixed.
