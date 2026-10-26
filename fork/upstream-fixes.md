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

Larger ideas and features that need agreement in upstream's `#dev` channel stay in the
[build plan](../ui-new/docs/build-plan.md#stage-2-small-upstream-contributions) and the proposals
that found them, such as
[unifying requests](../ui-new/docs/proposals/unifying-requests.md#small-upstream-contributions),
until one becomes a concrete fix.

## The list

| # | Fix | Status | Branch | Pull request | Found | Submitted | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [Clear the compact issue-list cache when an issue changes](#1-clear-the-compact-issue-list-cache-when-an-issue-changes) | candidate | | | 2026-10-26 | | |
| 2 | [Don't crash on Windows when an agent directory path is longer than 260 characters](#2-dont-crash-on-windows-when-an-agent-directory-path-is-longer-than-260-characters) | submitted | `fix/agent-directory-probe-long-cwd` | [#17691](https://github.com/paperclipai/paperclip/pull/17691) | | 2026-10-26 | |
| 3 | [Let a pause finish after a restart stopped a legacy run during preparation](#3-let-a-pause-finish-after-a-restart-stopped-a-legacy-run-during-preparation) | submitted | `fix/pause-after-restart-during-preparation` | [#17692](https://github.com/paperclipai/paperclip/pull/17692) | | 2026-10-26 | |

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
