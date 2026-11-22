# Bugs

The fork's bug list: things the code or docs get wrong, found while building and using Paperclip.
Since the hard fork (2026-11-17) they're fixed in our own tree, on a branch merged into `main`. The
file kept its old name, `upstream-fixes.md`, so links still work. Until then it listed fixes to send
to `paperclipai/paperclip`; entries from that time keep their history (branches, pull requests).

**Only bugs belong here:** something that's wrong. New behaviour, new API fields or filters and
other additions are feature ideas in the build plan
([3.17](../ui-new/docs/build-plan.md#317-smaller-feature-ideas) and the other stage 3 entries).
Entries 8 and 10–13 were moved there on 2026-11-16; their numbers are kept.

## How to use this list

- **Add one when you find it:** the next number, a one-line title, status `candidate`, and a section
  below saying what's wrong, where, the likely fix, and anything in `ui-new` that works around it.
- **Statuses:**

  | Status | Meaning |
  | --- | --- |
  | `candidate` | Found and described; not fixed yet |
  | `fixed` | Fixed in `main`; say the commit, and remove any workaround it names |
  | `submitted` | From the soft fork: a pull request still open upstream. Its change comes into `main` in hard-fork step 2. |
  | `closed` | Dropped, or closed without merging; say why |
  | `moved` | A feature, not a bug: moved to the build plan's feature ideas |

- **Fix one only once the user has signed off on it.** Many are in code this setup doesn't use (the
  Paperclip Runner, other adapters, Windows): those stay `candidate` unless they get in the way
  ([hard-fork plan step 3](hard-fork-plan.md#3-leave-unused-code-until-it-gets-in-the-way)).
- **A server fix reaches server1** only once the deployment builds from source (hard-fork step 2).
- **An upstream fix for one of these** may turn up in the upstream watch; take it by cherry-pick
  and mark the entry `fixed`.

## The list

| # | Bug | Status | Branch | Pull request | Found | Submitted | Merged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [Clear the compact issue-list cache when an issue changes](#1-clear-the-compact-issue-list-cache-when-an-issue-changes) | fixed | `fix/issue-list-cache-invalidation` | [#17828](https://github.com/paperclipai/paperclip/pull/17828) | 2026-10-26 | 2026-10-26 | `0b7ce6b3a` (2026-11-17) |
| 2 | [Don't crash on Windows when an agent directory path is longer than 260 characters](#2-dont-crash-on-windows-when-an-agent-directory-path-is-longer-than-260-characters) | closed | `fix/agent-directory-probe-long-cwd` | [#17691](https://github.com/paperclipai/paperclip/pull/17691) | | 2026-10-26 | |
| 3 | [Let a pause finish after a restart stopped a legacy run during preparation](#3-let-a-pause-finish-after-a-restart-stopped-a-legacy-run-during-preparation) | closed | `fix/pause-after-restart-during-preparation` | [#17692](https://github.com/paperclipai/paperclip/pull/17692) | | 2026-10-26 | |
| 4 | [Link the plugin SDK on Windows without symlink rights](#4-link-the-plugin-sdk-on-windows-without-symlink-rights) | closed | | | 2026-10-24 | | |
| 5 | [Start `pnpm dev` on Windows when the native runner is enabled](#5-start-pnpm-dev-on-windows-when-the-native-runner-is-enabled) | closed | | | 2026-10-26 | | |
| 6 | [Detect glibc reliably at server startup so Paperclip Runner is offered on Linux](#6-detect-glibc-reliably-at-server-startup-so-paperclip-runner-is-offered-on-linux) | fixed | `fix/runner-libc-probe-startup` | [#17905](https://github.com/paperclipai/paperclip/pull/17905) | 2026-10-26 | 2026-10-27 | in `main` before the freeze |
| 7 | [Accept `env: null` when updating a project](#7-accept-env-null-when-updating-a-project) | fixed | | [#9883](https://github.com/paperclipai/paperclip/pull/9883) (upstream's) | 2026-10-27 | | `ecce070df` (2026-11-17) |
| 8 | [Let company search take several assignees, projects or labels](#8-let-company-search-take-several-assignees-projects-or-labels) | moved to [F8](../ui-new/docs/build-plan.md#317-smaller-feature-ideas) | | | 2026-10-28 | | |
| 9 | [Mark agent chats in company search results](#9-mark-agent-chats-in-company-search-results) | candidate | | | 2026-10-28 | | |
| 10 | [Filter cost breakdowns by agent](#10-filter-cost-breakdowns-by-agent) | moved to [F9](../ui-new/docs/build-plan.md#317-smaller-feature-ideas) | | | 2026-10-28 | | |
| 11 | [Filter run summaries by date range and project](#11-filter-run-summaries-by-date-range-and-project) | moved to [F10](../ui-new/docs/build-plan.md#317-smaller-feature-ideas) | | | 2026-10-28 | | |
| 12 | [Say in `/api/health` whether sign-up is allowed](#12-say-in-apihealth-whether-sign-up-is-allowed) | moved to [F11](../ui-new/docs/build-plan.md#317-smaller-feature-ideas) | | | 2026-10-28 | | |
| 13 | [Include `executionBlocker` on compact issues](#13-include-executionblocker-on-compact-issues) | moved to [F12](../ui-new/docs/build-plan.md#317-smaller-feature-ideas) | | | 2026-10-28 | | |
| 14 | [Let Keep take an item off the attention feed's aging shelf](#14-let-keep-take-an-item-off-the-attention-feeds-aging-shelf) | candidate | | | 2026-10-28 | | |
| 15 | [Don't return agent credentials in plain text from the join request list](#15-dont-return-agent-credentials-in-plain-text-from-the-join-request-list) | candidate | | | 2026-10-28 | | |
| 16 | [Don't merge keyless cases of the same type](#16-dont-merge-keyless-cases-of-the-same-type) | candidate | | | 2026-10-29 | | |
| 17 | [Log activity when a case is created, edited or linked](#17-log-activity-when-a-case-is-created-edited-or-linked) | candidate | | | 2026-10-29 | | |
| 18 | [Let a stalled status card setup be retried](#18-let-a-stalled-status-card-setup-be-retried) | candidate | | | 2026-10-29 | | |
| 19 | [Return `lastExternalCommentAt` on chats as an ISO date](#19-return-lastexternalcommentat-on-chats-as-an-iso-date) | candidate | | | 2026-11-02 | | |
| 20 | [Offer the Google Sheets robot account in the tools gallery](#20-offer-the-google-sheets-robot-account-in-the-tools-gallery) | candidate | | | 2026-11-02 | | |
| 21 | [Let a Paperclip Runner run finish after it writes a status card](#21-let-a-paperclip-runner-run-finish-after-it-writes-a-status-card) | candidate | | | 2026-11-02 | | |
| 22 | [Record a run's usage in the status card ledger](#22-record-a-runs-usage-in-the-status-card-ledger) | candidate | | | 2026-11-02 | | |
| 23 | [Close a status card's setup task when a legacy run finishes the card](#23-close-a-status-cards-setup-task-when-a-legacy-run-finishes-the-card) | candidate | | | 2026-11-02 | | |
| 24 | [Keep `displayStatus` in compact issue lists](#24-keep-displaystatus-in-compact-issue-lists) | candidate | | | 2026-11-05 | | |
| 25 | [Use one effort key for Grok on the Paperclip Runner](#25-use-one-effort-key-for-grok-on-the-paperclip-runner) | candidate | | | 2026-11-05 | | |
| 26 | [Don't mark a blocker `attention_required` with nothing to attend to](#26-dont-mark-a-blocker-attention_required-with-nothing-to-attend-to) | candidate | | | 2026-11-05 | | |
| 27 | [Kitchen Sink example: hide config-gated items until the config loads](#27-kitchen-sink-example-hide-config-gated-items-until-the-config-loads) | candidate | | | 2026-11-09 | | |
| 28 | [Let Claude Runner agents pass verification in the Docker image](#28-let-claude-runner-agents-pass-verification-in-the-docker-image) | fixed | `fix/runner-docker-provider-authority` | [#20710](https://github.com/paperclipai/paperclip/pull/20710) | 2026-11-10 | 2026-11-10 | `6b25a4fe5` (2026-11-17) |
| 29 | [Don't report the agent JWT secret missing when `BETTER_AUTH_SECRET` covers it](#29-dont-report-the-agent-jwt-secret-missing-when-better_auth_secret-covers-it) | candidate | | | 2026-11-12 | | |
| 30 | [Run a project workspace's setup command, or drop the field](#30-run-a-project-workspaces-setup-command-or-drop-the-field) | candidate | | | 2026-11-14 | | |
| 31 | [Enforce an agent's "Create skills" permission, or drop it](#31-enforce-an-agents-create-skills-permission-or-drop-it) | candidate | | | 2026-11-14 | | |
| 32 | [Honour an agent's heartbeat cooldown, or drop it](#32-honour-an-agents-heartbeat-cooldown-or-drop-it) | candidate | | | 2026-11-14 | | |
| 33 | [Let a Claude planning task resume after the board replies](#33-let-a-claude-planning-task-resume-after-the-board-replies) | candidate | | | 2026-11-16 | | |
| 34 | [Refuse approve and reject on budget-override approvals](#34-refuse-approve-and-reject-on-budget-override-approvals) | candidate | | | 2026-10-24 | | |
| 35 | [Document how an agent reads a Decision's outcome](#35-document-how-an-agent-reads-a-decisions-outcome) | candidate | | | 2026-10-24 | | |
| 36 | [Stop the skill promising an unenforced CEO-strategy gate](#36-stop-the-skill-promising-an-unenforced-ceo-strategy-gate) | candidate | | | 2026-10-24 | | |
| 37 | [Log participant changes for every review stage (optional)](#37-log-participant-changes-for-every-review-stage-optional) | candidate | | | 2026-10-24 | | |
| 38 | [Report the review-stage bypass, with failing tests](#38-report-the-review-stage-bypass-with-failing-tests) | candidate | | | 2026-10-24 | | |
| 39 | [Turn off Claude Code's auto memory when an agent has `para-memory-files`](#39-turn-off-claude-codes-auto-memory-when-an-agent-has-para-memory-files) | candidate | | | 2026-10-24 | | |
| 40 | [Find why 11 server tests fail on `main` (one file is core)](#40-find-why-11-server-tests-fail-on-main-one-file-is-core) | fixed | `test/bug40` | | 2026-11-18 | | `741e8c5231` (2026-11-18) |
| 41 | [Give `para-memory-files` a recall tool that exists](#41-give-para-memory-files-a-recall-tool-that-exists) | fixed (`08749b9df`) | `fix/para-memory-recall` | | 2026-11-18 | | `f484c486b` (2026-11-20) |
| 42 | [Fix or move the 8 test files that fail in a full run on `main`](#42-fix-or-move-the-8-test-files-that-fail-in-a-full-run-on-main) | fixed | `test/tiers` | | 2026-11-18 | | `b6e7076fae` (2026-11-18) |
| 43 | [Stop a company import from setting an existing agent's access level](#43-stop-a-company-import-from-setting-an-existing-agents-access-level) | fixed on `feat/step-4a` (`fd0acf010`) | | | 2026-11-18 | | |
| 44 | [Return 409, not 500, when a new label's name is taken](#44-return-409-not-500-when-a-new-labels-name-is-taken) | candidate | | | 2026-11-18 | | |
| 45 | [Stop enforcing the four interaction switches that became access actions](#45-stop-enforcing-the-four-interaction-switches-that-became-access-actions) | fixed on `feat/step-4a` (`eedeba3ca`) | | | 2026-11-18 | | |
| 46 | [Stop the Advanced YAML editor overwriting an agent's hiring access](#46-stop-the-advanced-yaml-editor-overwriting-an-agents-hiring-access) | fixed on `feat/step-4a` (`a17d98cb6`) | | | 2026-11-18 | | |
| 47 | [Drop the legacy assignment fields from the agent access state](#47-drop-the-legacy-assignment-fields-from-the-agent-access-state) | fixed on `feat/step-4a` (`6706dab30`) | | | 2026-11-18 | | |
| 48 | [Cover every write of an approved multi-write tool call](#48-cover-every-write-of-an-approved-multi-write-tool-call) | fixed on `feat/step-4a` (`70b8d7198`) | | | 2026-11-18 | | |
| 49 | [Check the act-as agent's level on outside-connection file uploads](#49-check-the-act-as-agents-level-on-outside-connection-file-uploads) | fixed on `feat/step-4a` (`867374de7`) | | | 2026-11-18 | | |
| 50 | [Check access on plugin-origin agent configure and edit calls](#50-check-access-on-plugin-origin-agent-configure-and-edit-calls) | fixed on `feat/step-4a` (`5c499f719`) | | | 2026-11-18 | | |
| 51 | [Give runs a title tool now that project-tools is gone](#51-give-runs-a-title-tool-now-that-project-tools-is-gone) | fixed on `feat/step-4a` (`846bc008d`) | | | 2026-11-18 | | |
| 52 | [Use the MCP tool names in the chat directive](#52-use-the-mcp-tool-names-in-the-chat-directive) | fixed on `feat/step-4a` (`1137643cc`) | | | 2026-11-18 | | |
| 53 | [Stop the ACP engine tests writing settings into the repo](#53-stop-the-acp-engine-tests-writing-settings-into-the-repo) | candidate | | | 2026-11-18 | | |
| 54 | [Check access on the other plugin-origin agent writes](#54-check-access-on-the-other-plugin-origin-agent-writes) | candidate | | | 2026-11-18 | | |
| 55 | [Make the title route's access refusal requestable](#55-make-the-title-routes-access-refusal-requestable) | candidate | | | 2026-11-18 | | |
| 56 | [Decide whether catalog task creation needs a retry key](#56-decide-whether-catalog-task-creation-needs-a-retry-key) | candidate | | | 2026-11-18 | | |
| 57 | [Make `attentionService.list` fast over many failed runs](#57-make-attentionservicelist-fast-over-many-failed-runs) | candidate | | | 2026-11-18 | | |
| 58 | [Check the scope of a scoped `agents:configure` override](#58-check-the-scope-of-a-scoped-agentsconfigure-override) | fixed on `feat/step-4a` (`1c870f14d`) | | | 2026-11-19 | | |
| 59 | [Keep provider `access_denied` errors apart from agent access refusals](#59-keep-provider-access_denied-errors-apart-from-agent-access-refusals) | fixed on `feat/step-4a` (`d162c3255`) | | | 2026-11-19 | | |
| 60 | [Let a worker pick a workspace for its own subtask](#60-let-a-worker-pick-a-workspace-for-its-own-subtask) | fixed on `feat/step-4a` (`1c870f14d`) | | | 2026-11-19 | | |
| 61 | [Don't write or lock on an access check with no temporary grant](#61-dont-write-or-lock-on-an-access-check-with-no-temporary-grant) | fixed on `feat/step-4a` (`0a1c2721d`) | | | 2026-11-19 | | |
| 62 | [Steady two server tests that flaked in CI](#62-steady-two-server-tests-that-flaked-in-ci) | fixed (`d5435c29b`, `3a668926a`) | | | 2026-11-19 | | |
| 63 | [Find what adds 11 close listeners to the HTTP server](#63-find-what-adds-11-close-listeners-to-the-http-server) | candidate | | | 2026-11-19 | | |
| 64 | [Find the file that leaves a heartbeat run behind for heartbeat-task-drain](#64-find-the-file-that-leaves-a-heartbeat-run-behind-for-heartbeat-task-drain) | fixed (`877fe4dd7`, `ec3d65627`) | | | 2026-11-20 | | |
| 65 | [Tag the running image as previous before Compose builds the new one](#65-tag-the-running-image-as-previous-before-compose-builds-the-new-one) | fixed (`49b1c703d`) | | | 2026-11-20 | | |
| 66 | [Let the database decide a lease that looks expired on the server's clock](#66-let-the-database-decide-a-lease-that-looks-expired-on-the-servers-clock) | fixed (`c67fff236`) | | | 2026-11-20 | | |
| 67 | [Make `agent-commentary-skills` pass in a worktree under `.claude/`](#67-make-agent-commentary-skills-pass-in-a-worktree-under-claude) | candidate | | | 2026-11-20 | | |
| 68 | [Steady `fresh-continuation-fallback`'s recycled-PID test](#68-steady-fresh-continuation-fallbacks-recycled-pid-test) | candidate | | | 2026-11-20 | | |
| 69 | [Bring the opt-in hiring and portability tests up to step 4a's access levels](#69-bring-the-opt-in-hiring-and-portability-tests-up-to-step-4as-access-levels) | candidate | | | 2026-11-21 | | |
| 70 | [Find the bundled skills folder from a nested worktree](#70-find-the-bundled-skills-folder-from-a-nested-worktree) | candidate | | | 2026-11-21 | | |
| 71 | [Fix the opt-in chat and email channel failures on `main`](#71-fix-the-opt-in-chat-and-email-channel-failures-on-main) | candidate | | | 2026-11-21 | | |
| 72 | [Steady the server tests that fail only under a full local run's load](#72-steady-the-server-tests-that-fail-only-under-a-full-local-runs-load) | candidate | | | 2026-11-21 | | |
| 73 | [Share the worktree folder and base-ref rules between a run and its preview](#73-share-the-worktree-folder-and-base-ref-rules-between-a-run-and-its-preview) | candidate | | | 2026-11-21 | | |
| 74 | [Loosen `controller-instance-lease`'s wall-clock bound on a blocked renewal](#74-loosen-controller-instance-leases-wall-clock-bound-on-a-blocked-renewal) | candidate | | | 2026-11-21 | | |

Entries 34–39 were the build plan's stage 2a list until Nov 16, 2026 (2a-1 to 2a-6). Its 2a-7, the
plugin SDK link on Windows, is entry 4.

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
- **Fork workaround to revisit once merged:** `LIST_CACHE_HOLD_MS` (2.5 seconds) in
  `ui-new/src/lib/live-events.tsx`, used twice:
  - `ui-new/src/tasks/task-updates.ts` holds the user's own changed values that long, then refetches
    the lists;
  - live events refetch the task lists once more that long after a burst of task events
    (`createTrailingRefetch`). Without it, an agent's status change made just after its comment came
    back from the cache unchanged and stayed stale.

  Both can be shortened or removed.

### 2. Don't crash on Windows when an agent directory path is longer than 260 characters

- **Problem:** before a local run, the server observes the agent directory in a child Node
  process whose working directory is that directory. On Windows a process can't start in a working
  directory longer than about 260 characters, and Node then throws an uncaught `read ENOTCONN` that
  stops the server.
- **Fix:** start the child process from the drive root and pass the directory as an argument.
- **Files:** `server/src/services/agent-directory-probe.ts`, its test, and `doc/agent-files.md`.

- **Closed 2026-10-27** without merging: Windows isn't a supported server platform, so the fix
  isn't worth a slot in upstream's review queue.

### 3. Let a pause finish after a restart stopped a legacy run during preparation

- **Problem:** if the server stops while a legacy run is preparing, the run keeps the `preparing`
  stage, an expired lease and no process ID. Pausing the agent cancels the run, but
  `agentExecutionsHaveStopped` finds no stop proof for it, so the agent stays in `pausing`.
- **Fix:** accept the proof restart recovery already uses (setup stopped before provider work, with
  no launch, session or provider evidence) in the stop check.
- **Files:** `server/src/services/agent-execution-stop.ts`,
  `server/src/services/cancelled-native-startup.ts`, the lifecycle test, and
  `doc/execution-semantics.md`.

- **Closed 2026-11-10** without merging, by the user, in favour of upstream's
  [#20384](https://github.com/paperclipai/paperclip/pull/20384) ("align stop proof for pre-dispatch
  resource waits", `2550f399d`, in the Nov 10 sync). It reworked the same stop-proof path in
  `cancelled-native-startup.ts`, reviewed #17692 as an alternative, and left the PR conflicting.
  #20384 covers only cancelled legacy runs with a `workspace_wait` or `ai_connection_wait` receipt;
  it doesn't certify a run with no such receipt, which was #17692's case. If an agent still sticks
  in `pausing` after a restart during preparation, open an upstream issue describing that case
  instead of reviving the branch.

### 4. Link the plugin SDK on Windows without symlink rights

- **Problem:** the root `postinstall` (`scripts/link-plugin-dev-sdk.mjs`) symlinks the plugin SDK
  into plugins outside the pnpm workspace. Windows refuses to create symlinks (`EPERM`) unless
  Developer Mode is on or the shell runs as administrator, so `pnpm install` fails at the end.
  Found in the [2026-10-24 sync](sync-reports/2026-10-24.md); build plan item 2a-7.
- **Likely fix:** on Windows, create a directory junction (`fs.symlinkSync(target, path, "junction")`),
  which needs no special rights, or fall back to one when the symlink fails with `EPERM`.
- **Fork workaround to revisit once merged:** none in the code. This machine has Developer Mode on.

- **Closed 2026-10-27** without building: Windows isn't a supported server platform, so the fix
  isn't worth a slot in upstream's review queue.

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

- **Closed 2026-10-27** without building: Windows isn't a supported server platform, so the fix
  isn't worth a slot in upstream's review queue.

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
- **Fixed in `main`:** carried as a fork patch from 2026-10-27 (in source) and 2026-11-15 (in the
  deployment image, where 1 of 3 cold starts cached `libc: "unknown"` without it). Since hard-fork
  step 2 the change is plain source and the image is built from it.
- **Built 2026-10-27:** `execFileSync` with the same timeout, kill signal and output limit, and no
  top-level await; a test that blocks the event loop for 1.2 s after a real probe; `doc/DEVELOPING.md`
  updated. Targeted tests pass (16, plus 221 in the probe's consumers) and the server typechecks.
- **Updated 2026-11-14:** upstream's #21670 moved the doc section it edited from `doc/DEVELOPING.md`
  to `doc/runner-internals.md`, which made the PR conflict. Merged upstream master into the branch
  (`3a08309e7`, no force-push), took upstream's `DEVELOPING.md` and moved the wording change to
  `doc/runner-internals.md`. The targeted test (16) and the server typecheck pass; the PR is
  mergeable again. An outside user confirmed the bug on a Raspberry Pi 5 on 2026-11-07.

### 7. Accept `env: null` when updating a project

- **Problem:** `PATCH /api/projects/:id` with `{ "env": null }` answers 422 "env must be an object".
  `updateProjectSchema` allows `env` to be null, but the route (`server/src/routes/projects.ts`,
  around line 517) passes any value other than `undefined` to
  `secretsSvc.normalizeEnvBindingsForPersistence`, and `normalizeEnvConfig`
  (`server/src/services/secrets.ts`, around line 1897) rejects anything that isn't an object. The
  old UI's project properties send `env: null` when the variables are cleared
  (`ui/src/components/ProjectProperties.tsx`, around line 530), so clearing them fails there too.
  The create path (around line 402) has the same check.
- **Likely fix:** skip normalization when `env` is null and store null (or `{}`), in both the
  create and update paths; add a route test for clearing with null. Check first how agents' `env`
  handles null, to match.
- **Files:** `server/src/routes/projects.ts` and its test.
- **Fork workaround to revisit once merged:** `ui-new`'s project settings send `{}` to clear.
- **Fixed** 2026-11-17 by taking upstream's open pull request #9883 (`ecce070df`, upstream watch
  of open pull requests): create and update skip normalization for `env: null`. The `ui-new`
  workaround (`ui-new/src/projects/settings/settings-model.ts`) stays until server1 runs a build
  from source (hard-fork step 2).

### 8. Let company search take several assignees, projects or labels

Moved to the build plan as feature idea [F8](../ui-new/docs/build-plan.md#317-smaller-feature-ideas) (Nov 16, 2026): it adds to the API rather than fixing it.

### 9. Mark agent chats in company search results

Found by the M7 parity audit (2026-10-28).

- **Problem:** agent chats are hidden tasks underneath. Search results don't carry their
  `conversationAgentId`, so a chat shows as an ordinary task, and facet counts include chats.
- **Likely fix:** return `conversationAgentId` on task results, or leave chats out unless asked for.
- **Fork workaround to revisit once merged:** search can't show chats as a section
  ([decision 31](../ui-new/docs/decisions.md#31-gaps-found-building-agent-chat)).

### 10. Filter cost breakdowns by agent

Moved to the build plan as feature idea [F9](../ui-new/docs/build-plan.md#317-smaller-feature-ideas) (Nov 16, 2026): it adds to the API rather than fixing it.

### 11. Filter run summaries by date range and project

Moved to the build plan as feature idea [F10](../ui-new/docs/build-plan.md#317-smaller-feature-ideas) (Nov 16, 2026): it adds to the API rather than fixing it.

### 12. Say in `/api/health` whether sign-up is allowed

Moved to the build plan as feature idea [F11](../ui-new/docs/build-plan.md#317-smaller-feature-ideas) (Nov 16, 2026): it adds to the API rather than fixing it.

### 13. Include `executionBlocker` on compact issues

Moved to the build plan as feature idea [F12](../ui-new/docs/build-plan.md#317-smaller-feature-ideas) (Nov 16, 2026): it adds to the API rather than fixing it.

### 14. Let Keep take an item off the attention feed's aging shelf

Found building `ui-new`'s Inbox (M7 slice B, 2026-10-28).

- **Problem:** `server/src/services/attention.ts` (around line 642) sets each item's `shelf` from its
  idle time alone, ignoring `keep` from `decision_retention`. The old UI's Decisions page sorts items
  by `shelf` (`attentionIsAging` in `ui/src/lib/attention.ts`), and its DecisionShelf comment says Keep
  "clears the shelf flag server-side", so pressing Keep there changes nothing on screen.
- **Likely fix:** `shelf: !keep && idle past retentionDays`, with a service test that keeps an aged
  item and expects `shelf: false`. Check first whether upstream means `shelf` to stay raw and the UI
  to combine them; if so, fix the old UI's filter instead.
- **Fork workaround to revisit once merged:** `ui-new` treats `shelf && !keep` as on the shelf
  ([decision 40](../ui-new/docs/decisions.md#40-gaps-found-building-requests-and-the-inbox)).

### 15. Don't return agent credentials in plain text from the join request list

Found building `ui-new`'s join request cards (M7 slice B, 2026-10-28).

- **Problem:** `GET /api/companies/:companyId/join-requests` returns each agent request's
  `agentDefaultsPayload` as submitted, so header credentials such as `headers.x-openclaw-token` come
  back in plain text, while a Hermes `apiKey` is stored and returned as a secret reference.
- **Likely fix:** store header credentials as secret references too, or redact them in the list
  response, matching how the Hermes key is handled; with a route test. Check upstream's
  `docs/specs` and OpenClaw onboarding docs first for whether the list is meant to carry them.
- **Fork workaround:** none needed; `ui-new` only says that credentials were sent.

### 16. Don't merge keyless cases of the same type

Found building cases into `ui-new`'s task views (M7, 2026-10-29).

- **Problem:** `POST /api/companies/:companyId/cases` upserts on (company, case type, key), and with
  no `key` it matches `key IS NULL` (`server/src/routes/cases.ts`, around line 668). So creating a
  second keyless case of a type overwrites the first one's title, summary and fields instead of
  creating a new case. On that update path `parentCaseId` isn't checked against the case itself, so a
  case can become its own parent; `PATCH /cases/:id` does check.
- **Likely fix:** only upsert when a `key` is given (keyless creates always insert), and pass the
  existing case's id to `assertParentCaseBelongsToCompany` on the upsert path; with route tests. Check
  first whether a keyless case is meant to be a singleton per type (docs, `cases-schemas.ts`, tests).
- **Fork workaround:** none; `ui-new` doesn't create cases directly (Start a case goes through the
  task description, decision F).

### 17. Log activity when a case is created, edited or linked

Found building cases into `ui-new`'s task views (M7, 2026-10-29).

- **Problem:** creating a case, `PATCH /api/cases/:id` and `POST /api/cases/:id/links` write case
  events but no activity entries, so no live event goes out and other open boards don't refresh.
  Hand-offs and case document changes do log activity (entity type `case`).
- **Likely fix:** a `logActivity` call (entity type `case`) in those three routes, matching the
  document routes; with route tests. Check upstream's activity conventions for cases first, since the
  case event history was removed on Oct 22.
- **Fork workaround:** `ui-new` refreshes after its own changes and on case activity
  ([decision 43](../ui-new/docs/decisions.md#43-gaps-found-building-cases-into-the-task-views)).

### 18. Let a stalled status card setup be retried

Found porting status cards to `ui-new` (M7, 2026-10-29). Not yet confirmed in the server code.

- **Problem:** retrying a failed setup (`POST /status-cards/:id/recompile`) reopens the same setup task
  (same idempotency key). If no run starts, for example because the agent is in `error`, the card stays
  `compiling` with `generatingIssueId` set, and every later recompile answers `alreadyGenerating`
  unless the prompt changes. Nothing in the card says the setup stalled.
- **Likely fix:** treat a setup task that's closed, or has no active run after a timeout, as not
  generating; or expose that state so a client can offer a real retry. With a service test. Read the
  status card service first to confirm.
- **Confirmed live (M7 round 3, 2026-11-02):** with the old setup task still in progress and
  assigned to a paused agent, Run setup again answers `alreadyGenerating: true`, and changing the
  card's agent doesn't move the task; only editing the prompt made a new setup task.
- **Fork workaround:** none; the page shows "setting up" with a link to the task
  ([decision 44](../ui-new/docs/decisions.md#44-status-cards-need-an-agent-that-can-write-them)).

### 19. Return `lastExternalCommentAt` on chats as an ISO date

Found building chat read state into `ui-new` (M7 round 3, 2026-11-02). Not yet confirmed beyond one
response.

- **Problem:** `GET /api/companies/:id/chats` returns `lastExternalCommentAt` as Postgres text
  (`"2026-10-27 22:09:08.561415-06"`) instead of an ISO timestamp like the other date fields.
  `withConversationReadState` selects a raw `sql<Date>` max that isn't mapped to a `Date`.
- **Likely fix:** map the column (`.mapWith(...)` or convert in the service) so it serializes as ISO,
  with a service or route test.
- **Fork workaround:** none needed; `ui-new` doesn't read the field.

### 20. Offer the Google Sheets robot account in the tools gallery

Found porting Apps leftovers to `ui-new` (M7 round 3, 2026-11-02). Not yet confirmed beyond reading
the route.

- **Problem:** the Google Sheets robot method needs the robot's email to show in setup, but
  `GET /api/companies/:id/tools/gallery` never sets `availability.robotEmail`. Only
  `googleSheetsRobotEmailFromEnv()` knows it, and it's called only at connect time
  (`server/src/routes/tool-access.ts`, around line 879). Both UIs therefore say the robot isn't
  available, even when it's configured.
- **Likely fix:** set `availability.robotEmail` from `googleSheetsRobotEmailFromEnv()` when building
  the Sheets gallery entry, with a route test.
- **Fork workaround:** none; `ui-new`'s setup shows the robot once the field is there.

### 21. Let a Paperclip Runner run finish after it writes a status card

Found in the status cards live test (M7 round 3, 2026-11-02). Seen once.

- **Problem:** a Summarizer update run on the Paperclip Runner wrote the card's summary, then hung
  about 6 minutes in `paperclip_finish` and ended failed (`native_finalization_missing`, then
  `native_session_cleanup_quarantined`, "requires operator recovery"). The agent was left in
  `error` and the hidden update task blocked (run 43ef710c on TES).
- **Likely fix:** unknown; read the native finalization path for hidden status-card tasks first and
  try to reproduce.
- **Fork workaround:** none; the tile says the agent's last run failed.

### 22. Record a run's usage in the status card ledger

Found in the status cards live test (M7 round 3, 2026-11-02).

- **Problem:** the card's ledger copies tokens and cost when the agent writes the card, before the
  run reports usage, so Runner runs show 0 tokens and $0.00. The daily token cap counts these rows,
  so it never trips for those runs, and the guide says each generation's cost is copied into update
  history.
- **Likely fix:** fill the ledger row's usage when the run finishes (or read it from the run), with a
  service test.
- **Fork workaround:** `ui-new`'s History shows the run's own usage when the ledger row has none.

### 23. Close a status card's setup task when a legacy run finishes the card

Found in the status cards live test (M7 round 3, 2026-11-02).

- **Problem:** a legacy run that wrote the card's query and summary left its hidden setup task in
  progress, which set off an automatic `issue_disposition_repair` wake that spends again.
- **Likely fix:** close the hidden task when the card's write completes the setup, as the Runner
  path does; with a service test.
- **Fork workaround:** none; pause the agent after setup.

### 24. Keep `displayStatus` in compact issue lists

Found in the Nov 5 integration round (U1, Monitoring status).

- **Problem:** `toCompactIssue` in `server/src/routes/issues.ts` doesn't copy `displayStatus`, although
  `CompactIssue` declares it. Every `?view=compact` list therefore shows a monitored task as In
  progress; the full task read and search carry it.
- **Likely fix:** copy `displayStatus` in `toCompactIssue`, with a route test. The old UI's list
  grouping probably has the same bug (not verified).
- **Fork workaround:** `ui-new/src/api/issues.ts` (`withMonitoring`) reads the same scope's in-progress
  tasks in full (`?status=in_progress`, no `view`) when a list has tasks in progress without the
  field, and stops once the server sends it. Since the Nov 7 sync (#19453) every in-progress task
  without a run projects to another status, so this extra read now carries more weight: it runs on
  every list refetch and returns full rows.

### 25. Use one effort key for Grok on the Paperclip Runner

Found in the Nov 5 integration round (U37, effort tables).

- **Problem:** the composer writes `modelReasoningEffort` for `paperclip_runner`, while native Grok
  translation prefers `reasoningEffort`. It works only because the translation also reads
  `modelReasoningEffort`. Low priority: nothing is broken today.
- **Likely fix:** settle on one key, with a test.
- **Fork workaround:** none needed.

### 26. Don't mark a blocker `attention_required` with nothing to attend to

Found in integration round 2 (U44, Nov 5).

- **Problem:** issue summaries and lists can return `blockerAttention.state: "attention_required"`
  with every count at 0, so the old UI reads "Blocked · 0 blockers need attention". TES-5 shows it.
- **Likely fix:** derive the state from the counts (or return no attention) when nothing needs it,
  with a service test.
- **Fork workaround:** `ui-new` shows plain "Blocked" when the counts are all 0.

### 27. Kitchen Sink example: hide config-gated items until the config loads

Found while fixing the projects-nav flash (Nov 9).

- **Problem:** `packages/plugins/examples/plugin-kitchen-sink-example/src/ui/index.tsx` checks
  `if (config.data && config.data.showX === false) return null`, so each sidebar entry, sidebar
  panel, project sidebar item and comment annotation or menu item renders until its
  `plugin-config` read answers, then disappears when the config turns it off. With
  `showProjectSidebarItem: false`, a "Kitchen Sink" line shows under each project for about 125ms
  on every page load. As the example plugin authors copy, it teaches the pattern.
- **Likely fix:** return null while the config is loading (`if (!config.data || config.data.showX
  === false) return null`).
- **Fork workaround:** none. `ui-new` keys the nav's project rows by id, so the items mount only once
  per page load instead of on every refetch; the one flash on first load remains.

### 28. Let Claude Runner agents pass verification in the Docker image

Found setting up the fork's deployment (Nov 10). Reported upstream as
[#18557](https://github.com/paperclipai/paperclip/issues/18557) (open, "ready for review", no pull
request yet); [#20630](https://github.com/paperclipai/paperclip/issues/20630) is the same error and
was closed by an automated pipeline as already fixed, which it isn't.

- **Problem:** in upstream's Docker image, a Claude agent on the Paperclip Runner fails its
  environment test with "ACPX provider package @agentclientprotocol/claude-agent-acp resolves
  outside the selected provider root", stays in `verifying` and never runs. In the server process
  `PAPERCLIP_ACPX_PROVIDER_PACKAGE_ROOT` is unset, so `verifyQualifiedAcpxInstallation`
  (`packages/paperclip-runner/src/drivers/acpx/installation-integrity.ts`) takes its authority from
  `resolveInstalledProviderAuthority` (`installed-provider-authority.ts`), which returns the server
  package (`/app/server`). The image is a pnpm workspace, so `/app/server/node_modules/@agentclientprotocol/claude-agent-acp`
  is a symlink into `/app/node_modules/.pnpm/...`, outside that root. Runs launched through runnerd
  don't fail: `acpxProviderPackageAuthority` (`live/runnerd-codex-transport.ts`) already widens the
  root to the workspace for source and Docker builds (#15912). `codex-acp` has the same layout.
- **Likely fix:** give the server-side authority the same workspace rule as
  `acpxProviderPackageAuthority` (or share one helper), keeping the rest of the admission checks,
  with a test on a vendored server inside a pnpm workspace layout.
- **Evidence:** reproduced in the deployed fork image (upstream `sha-d0057ee`): in the container,
  `createAcpxPackageJsonResolver("/app/server", "/app/server/package.json")("@agentclientprotocol/claude-agent-acp")`
  throws this error, and with root `/app` it resolves. A commenter on #18557 confirms it on `master`
  at `358977454b` (2026-11-10).
- **Fixed in `main`** (`6b25a4fe5`, 2026-11-17). From 2026-11-15 until hard-fork step 2 the
  deployment image carried it as a patch to the compiled function.
- **Built 2026-11-10:** commit `96f6f4fd4` off `master` at `69c69e4c2`. The rule from #15912 moves
  into `sourceWorkspaceProviderRoot` in `installed-provider-authority.ts`;
  `resolveInstalledProviderAuthority` uses it, and runnerd's `acpxProviderPackageAuthority` calls
  the same function (native asset agents still excluded). The regression came from #15994, which
  added the server-side authority without the rule. Tests: `installed-provider-authority.test.ts`
  fails without the fix (1 of 10) and passes with it; runnerd's seven authority tests (22 passed)
  and `installation-integrity.test.ts` (80 passed); `tsc --noEmit` clean. In the deployed
  `sha-d0057ee` container, the full `verifyQualifiedAcpxInstallation` passes for Claude and Codex
  with the new root and fails with the old one. No fixed image was built. The PR draft is
  `PR_DESCRIPTION.md` in `~/coding/paperclip-fixes/runner-docker-provider-authority`.
- **Submitted 2026-11-10** as [#20710](https://github.com/paperclipai/paperclip/pull/20710), left open after the hard fork.

### 29. Don't report the agent JWT secret missing when `BETTER_AUTH_SECRET` covers it

Found redeploying the fork's Docker deployment (Nov 12).

- **Problem:** the startup banner (`server/src/startup-banner.ts`, the "Agent JWT" row) checks only
  `PAPERCLIP_AGENT_JWT_SECRET`, in the environment or the instance's `.env`, and otherwise prints
  "missing (run `npx paperclipai onboard`)" in yellow. But agent keys
  (`server/src/agent-auth-jwt.ts`) and runtime tool tokens (`server/src/runtime-tools-token.ts`)
  fall back to `BETTER_AUTH_SECRET`, which every authenticated deployment sets, including
  upstream's own `docker/docker-compose.yml`. So a working Docker deployment warns that agent runs
  will get no key, and suggests a command that doesn't apply in a container.
- **Likely fix:** pass when `BETTER_AUTH_SECRET` is set too, with a message such as "set (from
  BETTER_AUTH_SECRET)", and keep the warning for the case with neither. A small test beside the
  banner's existing ones.
- **Related:** #13816 (open) is the opposite case, a genuinely missing secret degrading runs
  silently; this fix shouldn't weaken that warning. Search for duplicates again before building.
- **Fork workaround:** none needed; the warning is cosmetic.

### 30. Run a project workspace's setup command, or drop the field

Found in the info-tip sweep (Nov 14, [audit](../ui-new/docs/audit/info-tip-sweep.md), J9).

- **Problem:** a project workspace stores `setupCommand` (`projectWorkspaces.setupCommand`), and the
  old UI offers it, but nothing reads it when a workspace is prepared. The only setup that runs is
  the execution workspace policy's provision command (worktree setup). A person who fills it in
  expects it to run.
- **Likely fix:** ask upstream which is intended: run it when the shared workspace is first
  prepared (beside the cleanup command, which does run), or remove the field and point to the
  checkout policy's provision command. An issue first, not a PR.
- **Fork workaround:** `ui-new` keeps the field with "Not used by the server yet."

### 31. Enforce an agent's "Create skills" permission, or drop it

Found in the info-tip sweep (Nov 14, J18).

- **Problem:** `permissions.canCreateSkills` on an agent is stored and logged
  (`server/src/lib/agent-permissions.ts:122`, `routes/agents.ts:5142`) but skill routes decide by the
  company skill policy and `skills:create` grants (`routes/company-skills.ts:232-274`,
  `company-skill-policy.ts:143-149`), so the switch changes nothing.
- **Likely fix:** an issue asking whether the per-agent switch should gate skill creation or be
  removed in favour of the skill policy.
- **Fork workaround:** `ui-new` keeps the switch with "Not used by the server yet."

### 32. Honour an agent's heartbeat cooldown, or drop it

Found in the info-tip sweep (Nov 14, J9).

- **Problem:** `runtimeConfig.heartbeat.cooldownSec` is offered in agent settings, but the server only
  writes it as a default in `company-portability.ts` and never reads it when scheduling or admitting
  runs.
- **Likely fix:** an issue asking whether a minimum gap between runs is still planned; if not,
  remove it from the shared config and the old UI.
- **Fork workaround:** `ui-new` keeps the control with "Not used by the server yet."

### 33. Let a Claude planning task resume after the board replies

Found on the server1 deployment (BRA-2, 2026-11-16). Reproduced on the dev instance: TES-34 and
TES-36 failed, and the standard-mode control TES-35 resumed.

- **Problem:** a Claude agent on Paperclip Runner (ACPX) with an effort set runs a planning-mode task
  and asks the board a question. When a board comment wakes it, every resume attempt fails with
  `native_session_recovery_failed: ... ACPX sidecar command session.open was rejected
  (retryable=false, classification=admission_runtime)`. The run then ends failed and the task goes
  to `blocked`.
- **Cause:** the sidecar's hidden message is "Failed to spawn agent command: …claude-agent-acp",
  caused by "ACPX provider spawned after ownership admission was sealed". In
  `packages/paperclip-runner/src/drivers/acpx/acpx-runtime-adapter.ts`, a restored session isn't
  connected. The effort admission's `setConfigOption("effort")` opens a cold connection, and
  `verifyLifetimeOwnership()` then seals the spawn set. The read-only Claude plan-mode call that
  follows (`setConfigOption({ key: "mode", value: "plan" })`, added in #19291) opens another cold
  connection without an ownership admission, so `SpawnedChildSet.add` refuses it. A fresh session
  stays connected and never spawns, and standard tasks skip the call. The error is non-retryable
  and not "state unavailable", so `governedWaitFollowUpMayStartFresh` never replaces the session.
  This looks like #17676 but has a different cause.
- **Likely fix:** wrap the plan-mode call in `children.beginLifetimeOwnershipAdmission()` /
  `finishOwnershipAdmission()` the way `setModel` does, or apply plan mode inside the handshake
  before the seal. Add a test that restores a session with an effort set and `readOnly`. A separate
  small fix would carry the sidecar's redacted message, or at least its code, across
  `acpx_sidecar_transport.rs` so this kind of failure isn't opaque (see #19918).
- **Fork workaround:** none in code. Reset the task's session in the agent's Runtime settings before
  replying on a planning task that's waiting on the board.

### 34. Refuse approve and reject on budget-override approvals

From the [requests proposal](../ui-new/docs/proposals/unifying-requests.md#small-upstream-contributions),
item 1 (was build plan 2a-1).

- **Problem:** `POST /api/approvals/:id/approve` and `/reject` on a `budget_override_required`
  approval mark it approved or rejected, and leave the budget incident open and the scope paused.
  Plugins reach the same code through the plugin host.
- **Likely fix:** a check in the approvals service's `decide` that refuses these approvals with an
  error pointing to the budget-incident resolve endpoint, plus a test. Refusing is simpler than
  resolving, because an approval carries no new limit amount.
- **Fork workaround:** `ui-new` shows budget resolution instead of approve and reject.

### 35. Document how an agent reads a Decision's outcome

From the requests proposal, item 2 (was build plan 2a-2). Docs.

- **Problem:** the skill's Standalone Decisions section (`skills/paperclip/SKILL.md`) covers creating
  a Decision but not what happens afterwards.
- **Likely fix:** a few lines: with `wake_origin_agent` the proposer is woken with reason
  `decision_<outcome>` and a payload naming the `decisionId`; `GET /api/decisions/:id` returns the
  status, the chosen option and each effect's result; an effect with `staleness: "strict"` is
  skipped if its target task changed; only people can decide a Decision.

### 36. Stop the skill promising an unenforced CEO-strategy gate

From the requests proposal, item 3 (was build plan 2a-3). Docs, or an issue.

- **Problem:** `skills/paperclip/references/api-reference.md` says a CEO's first strategic plan must
  be approved before the CEO can move tasks to `in_progress`; nothing on the server checks this.
- **Likely fix:** reword the line so it doesn't promise enforcement, or open a short issue asking
  which is intended. The issue is the safer start, since the answer is a product decision.
- **Fork workaround:** `ui-new` shows `approve_ceo_strategy` as an ordinary formal approval.

### 37. Log participant changes for every review stage (optional)

From the requests proposal, item 4 (was build plan 2a-4).

- **Problem:** `summarizeExecutionParticipants` in `server/src/routes/issues.ts` uses `stages.find`,
  so `issue.reviewers_updated` and `issue.approvers_updated` miss changes to every stage after the
  first of its type.
- **Likely fix:** a few lines and a test. The file is upstream's busiest, and no interface creates a
  second stage of one type yet, so send it only as an easy first contribution.

### 38. Report the review-stage bypass, with failing tests

From the requests proposal, item 5 (was build plan 2a-5). A bug report, not a pull request.

- **Problem:** a Runner agent finishing a task with configured but unstarted review stages, or
  someone accepting a Runner completion-review card on such a task, may skip the stages
  ([review-stage bypass](../ui-new/docs/proposals/unifying-requests.md#review-stage-bypass)).
- **Likely fix:** write tests for the two Runner paths. If they fail, file a bug with upstream's
  template, attach the tests, link #13744 and #13001, and let upstream own the fix.

### 39. Turn off Claude Code's auto memory when an agent has `para-memory-files`

**Fixed 2026-11-20** in step 4b (`feat/step-4b`): every sealed `claude_local` run gets
`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` from the adapter, and the run manifest shows `autoMemory: false`.

From [decision 5](../ui-new/docs/decisions.md#5-agents-can-have-three-memory-systems-that-dont-know-about-each-other),
option 3 (was build plan 2a-6). Revives #2700.

- **Problem:** an agent with the `para-memory-files` skill also gets Claude Code's own auto memory,
  so two memory systems that don't know about each other write to different places.
- **Likely fix:** `claude_local`, and the Runner's isolated Claude settings, set
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` whenever `para-memory-files` is among the agent's skills. The
  environment variable, unlike #2700's settings files, also works with `--setting-sources user`.
- **Fork workaround:** `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in `deploy/docker-compose.yml`, and in the
  adapter `env` of each Runner agent.
- **Planned fix (2026-11-18):** wider than this entry. Step 4b turns auto memory off for **every**
  `claude_local` run, not only those with `para-memory-files`, and Paperclip sets the variable itself
  ([step-4b-sealed-runs.md](step-4b-sealed-runs.md), section 6). This closes when 4b part 1 merges.

### 40. Find why 11 server tests fail on `main` (one file is core)

**Fixed 2026-11-18** (`741e8c5231`, option 1 below).

Found in step 3a's profiled run of `pnpm test` on `main` at `93c3289557`, 2026-11-18
([test-suite-audit.md](test-suite-audit.md#8-failures-seen)). The run was stopped before Vitest
printed its failure summary, so the reasons weren't captured.

- **Core:** `server/src/services/legacy-controller-lease.test.ts`, 2 tests ("durable legacy controller
  ownership > keeps the run and lease of a live earlier-boot controller…", "…keeps an expired lease of
  a live earlier-boot controller…"). The lease keeps a `claude_local` run owned by this server
  ([claude-local-run.md](claude-local-run.md)).
- **Dormant (native runtime):** `retained-provider-pack-source.test.ts` (6),
  `heartbeat-native-restart-suspension.test.ts` (2; also failed in step 4a's overloaded run),
  `native-session-resume.test.ts` (1).
- **Re-run alone (2026-11-18):** all four fail the same way on their own, so it isn't interference
  from other files.
  - `legacy-controller-lease.test.ts`: in "keeps the run and lease of a live earlier-boot
    controller", the controller is the test process itself (its PID, its process-space hash and
    `currentProcessStartedAtMs()`), so it really is alive. Recovery still marks the run
    `failed` / `process_lost`. The expired-lease case fails the same way. **Likely cause:** the
    liveness check's process-start-time comparison disagrees on this host (WSL), so a live
    controller looks dead. If the same thing can happen in production, recovery fails live
    `claude_local` runs. Check how `currentProcessStartedAtMs` is computed and compared before
    deciding.
  - The three native-runtime files fail on Runner transport (`runner_remote_provider_archive_transport_unavailable`,
    `current_directory_fallback_forbidden`), a missing `authority-epochs` directory and native
    finalization: environment and dormant code.
- **Intermittent, not deterministic (later on 2026-11-18):** after step 3a round 1 the core file
  passed in a full parallel run, and alone it failed 1 time in 3. That fits a timing-sensitive
  start-time comparison. The dormant `heartbeat-native-restart-suspension` also passed in the full
  run.
- **Cause found (2026-11-18, step 3a agent G): a real production bug.** On Linux a process's start
  time is `btime` from `/proc/stat` plus its start ticks. `btime` is whole seconds and is recomputed
  from the wall clock on every read; on this WSL desktop it grew by 1 s every ~31–33 s (375 s over
  ~3 h). Two readings of the same live process then differ by whole seconds with the same sub-second
  part, the owner check concludes the PID was reused, and recovery fails a live `claude_local` run
  as `process_lost` (or releases a live owner's record). It affects child-process stamps too.
- **Fix chosen by the user: option 1.** For `btime`-based readings a whole-second gap counts as the
  same process (`controller-process-identity.ts`, `owner-proof.ts`). A reused PID matches by chance 1
  time in 100, and its record is then held until the PID exits. Four tests that modelled PID reuse
  with a whole-second offset get a sub-second one. Option 2, exact boot-relative start ticks in every
  stamp (a new field and a migration), is worth revisiting in step 4b.
- **Done (2026-11-18, `741e8c5231`):** `processStartsDefinitelyDiffer` takes the reading's clock and
  `owner-proof.ts` passes `linux_btime` from its process probe. Seven test files modelled PID reuse
  with a whole-second gap; each gap now has a 10 ms part, with no assertion changed. G ran the 189
  server files that touch process start times: every failure left also fails the same way without
  the fix.
- **Left alone (dormant Runner):** `evaluateNativeProviderProcesses` in
  `native-runtime/native-restart-recovery.ts` still compares provider-process starts without a
  clock, so it keeps the whole-second rule. Pass the clock there if the Runner comes back.

### 41. Give `para-memory-files` a recall tool that exists

Found 2026-11-18 while comparing the memory systems
([decision 5](../ui-new/docs/decisions.md#5-agents-can-have-three-memory-systems-that-dont-know-about-each-other)).

- **Problem:** the skill's "Memory Recall -- Use qmd" section
  ([skills/para-memory-files/SKILL.md](../skills/para-memory-files/SKILL.md)) tells agents to search
  their memory with `qmd query`, `qmd search` and `qmd vsearch` "rather than grepping files", and to
  index with `qmd index $AGENT_HOME`. Nothing installs `qmd`: it isn't in the root `Dockerfile`,
  `deploy/`, the adapters or the dev machine. An agent that follows the skill gets "command not
  found", then has to work out a fallback, costing a turn or two, and may conclude it has no memory.
- **Likely fix:** either rewrite the section around what's there (`rg`/`grep` over `$AGENT_HOME`,
  reading `summary.md` files first, which the layout is designed for), or install `qmd` in the
  image and say in the skill that it's optional and to fall back to `rg` when it's missing. The
  first is simpler; the memory files are small. If memory moves to a memory service
  ([build plan 3.5](../ui-new/docs/build-plan.md#35-memory-service)), this section goes anyway.
- **Fork workaround:** none.
- **Fixed** (`08749b9df`, merged `f484c486b`, 2026-11-20), the first option: the section is now
  "Memory Recall -- Summaries First, Then Search": `life/index.md`, the entity's `summary.md`,
  `MEMORY.md`, then `rg` over `$AGENT_HOME` (`grep -r` without it; the image installs `ripgrep`).
  The "Planning" section's `qmd` line went the same way. Done ahead of step 4b, which turns
  Claude Code's auto memory off for every run.

### 42. Fix or move the 8 test files that fail in a full run on `main`

Found in step 3a's full runs after round 1 (2026-11-18,
[step-3a-plan.md](step-3a-plan.md#round-1-progress)). With every server file isolated, the whole
suite (all 2,735 files but the chat suite) has 14 failing tests in these 8 files. None is caused by
round 1: each fails the same way when re-run on its own, except `github-launcher`.

| File | Failure | Likely cause | Area |
| --- | --- | --- | --- |
| `packages/skills-catalog/src/shipped-catalog.test.ts` | `ENOENT … scandir '.agents'` | `ea326e0202` removed `.agents/` (upstream's maintainer skills); the test still lists it. Drop that path from the test | ours (easy fix) |
| `server/scripts/reporting-lock-policy.test.mjs` | "Reporting lock changed; review the dependency correction before install" | A lockfile proof for upstream's Runner end-to-end CI reporting (`tests/runner-e2e/prepare-report-lock.mjs`), stale since our lockfile changed | dormant (upstream CI) |
| `packages/adapter-utils/src/github-launcher.test.ts` | 5 s test timeout | Passed when re-run; times out under full-run load. A longer timeout or less work | shared (flaky) |
| `server/src/__tests__/cursor-local-execute.test.ts` | exit code 127 | The Cursor CLI isn't installed | dormant (other adapter) |
| `server/src/__tests__/cursor-local-adapter-environment.test.ts` | `'fail'` instead of `'pass'` | Same | dormant (other adapter) |
| `server/src/services/native-runtime/native-runner-restart-preparation.integration.test.ts` | a preparation record doesn't match | Native runtime | dormant |
| `server/src/services/native-runtime/native-session-resume.test.ts` | missing `authority-epochs` directory | Native runtime (entry 40) | dormant |
| `server/src/services/native-runtime/retained-provider-pack-source.test.ts` | Runner transport unavailable | Native runtime (entry 40) | dormant |

- **Likely fix:** the dormant ones leave the default run when step 3a round 2 fills the opt-in tier
  (hard-fork step 3: they're not fixed). `shipped-catalog` gets the one-line fix; `github-launcher`
  gets a test-sized timeout or less work.
- **Fixed 2026-11-18** (`b6e7076fae`, step 3a agent E): `shipped-catalog` no longer scans `.agents/`;
  `github-launcher`'s process-heavy test (18 launcher processes in a row, ~4.6 s alone) has a 20 s
  timeout. The other six files are in the opt-in tier, so `pnpm test` no longer runs them.
- **Also found:** 6 tests in `server/src/services/heartbeat/runtime-selection.test.ts` failed on `main`
  because they read `.claude/skills/slack/SKILL.md`, which `ea326e0202` removed. They're connector-skill
  (dormant) tests and moved to the opt-in `runtime-selection.dormant.test.ts`.

### 43. Stop a company import from setting an existing agent's access level

Found by the step 4a follow-ups agent (2026-11-18, on `feat/step-4a`).

- **What's wrong:** importing a company package over an existing agent can set that agent's access
  level, because the package's `permissions`, including `access`, are copied straight onto it.
  `company-portability.ts` (around line 5754) passes `manifestAgent.permissions` to
  `updateImportedAgent`, and `agent-configuration.ts:93-101` replaces the agent's permissions with
  them. An agent that may import could raise another agent, or itself, to `admin`.
- **Not affected:** creating new agents. Since the follow-ups, an agent creator's `access` is
  dropped.
- **Likely fix:** on the update path, keep the existing agent's `access` and never take it from the
  package. Only a person can change a level, through `PATCH /agents/:id/permissions`. Part of step
  4a; fix it on `feat/step-4a` before it merges.

### 44. Return 409, not 500, when a new label's name is taken

Found by the step 4a follow-ups agent (2026-11-18).

- **What's wrong:** creating a label with a name the company already uses probably fails as a 500.
  `createLabel` in `server/src/services/issues.ts` (around line 13436) doesn't check for a clash,
  so the unique index `labels_company_name_idx` refuses the insert. Renaming already returns 409
  `label_name_taken`.
- **Likely fix:** make the same check as rename, or catch the unique violation, and return 409
  `label_name_taken`. The MCP tool `paperclip_manage_labels` then gives the same clear error for
  create as for rename.

### 45. Stop enforcing the four interaction switches that became access actions

Found by step 4a agent 5 (2026-11-18, on `feat/step-4a`).

- **What's wrong:** four switches still block an agent even after its access level allows the
  action: `canAssignTasksToAgents`, `canAssignTasksToHumans`, `canEditOtherTasks` and
  `canConfigureOtherAgents`. `server/src/services/agent-interaction-policy.ts:103-116` still reads
  them. Migration 0491 copied a `false` into the matching override but left the switch stored. The
  Access card can turn the action on while the old switch keeps refusing it.
- **In `ui-new`:** the Interactions card lists a retired switch still stored as off, with a Clear
  button.
- **Likely fix:**
  - remove those four checks from the policy (the actions cover them now);
  - clear the stored switches, either in a migration or on read;
  - then drop the Clear workaround.

  This is the cleanup the plan already lists ("agent-side interaction checks are redundant after
  0491"). It's now a correctness bug, so fix it on `feat/step-4a` before it merges.

### 46. Stop the Advanced YAML editor overwriting an agent's hiring access

Found by step 4a agent 5 (2026-11-18).

- **What's wrong:** saving permissions from the Advanced tab's YAML editor can undo the Access
  card's hiring choice. The editor still sends `canCreateAgents`/`canAssignTasks`
  (`ui-new/src/agents/configuration-model.ts:617`). `PATCH /agents/:id/permissions` then rewrites
  the `agents:create` override from `canCreateAgents` (`server/src/routes/agents.ts:5114`).
- **Likely fix:**
  - the YAML editor edits `access` and stops sending the retired flags;
  - or the route ignores `canCreateAgents` when the body or the stored permissions carry `access`.

  Fix before `feat/step-4a` merges.

### 47. Drop the legacy assignment fields from the agent access state

Found by step 4a agent 5 (2026-11-18).

- **What's wrong:** `buildAgentAccessState` (`server/src/routes/agents.ts:1280`) still reports
  `canAssignTasks` and `taskAssignSource` from the old grants. Since step 4a, `tasks:assign` is an
  access action, so these can disagree with the agent's real access. `ui-new` no longer shows them.
- **Likely fix:** derive them from `access`, or remove them along with the retired grant keys.

### 48. Cover every write of an approved multi-write tool call

Found by step 4a agent 4 (2026-11-18, on `feat/step-4a`).

- **What's wrong:** approving a request for a tool call that makes several writes only lets the
  first one through. The replay gets a one-use temporary grant, so in `paperclip_manage_labels`
  with three labels, the second write is refused again.
- **Likely fix:** give the replay grant one use per write the tool makes, or a short-lived grant
  scoped to the replay's request.

### 49. Check the act-as agent's level on outside-connection file uploads

Found by step 4a agent 4 (2026-11-18).

- **What's wrong:** an upload through a connection that acts as an agent is checked against the
  connection's level only, not the agent's own level as capped by the connection. Every other
  route checks the capped level. The check is in `server/src/services/public-mcp/file-transfers.ts`.
- **Likely fix:** check `capAgentAccess(agent's access, connection's access)`, as the route policy
  does.

### 50. Check access on plugin-origin agent configure and edit calls

Found by the step 4a bug-fix agent (2026-11-18, after bug 45's fix).

- **What's wrong:** plugin-origin calls that configure an agent or edit a task may no longer check
  the acting agent's access. In `server/src/services/plugin-host-services.ts` (around `:3412` and
  `:3435`), the authorization-policy updates call `assertAgentInteraction` with `configure` and
  `edit`. Those calls used to be limited by the actor's `canConfigureOtherAgents` and
  `canEditOtherTasks`. Since bug 45's fix, only the target's consent switch is checked. Whether
  the plugin path checks `agents:configure` and `tasks:update_any` anywhere else isn't verified.
- **Who it affects:** only setups with plugins installed (opt-in here).
- **Likely fix:** check the matching access action there (`decide` with the actor), or confirm the
  plugin host checks it already.
- **Also left from that fix:**
  - `doc/agent-interaction-permissions.md:18-23` still lists the four retired switches;
  - the OpenAPI entry for `PATCH /agents/{id}/interaction-permissions` (`openapi.ts:3963`) lacks
    the new 410;
  - `agent-interaction-mutations.test.ts:150` fails on a dormant Runner fixture with no access
    level (the regression's fixture work).

### 51. Give runs a title tool now that project-tools is gone

Found by the step 4a run-MCP agent (2026-11-18, on `feat/step-4a`).

- **What's wrong:** `server/src/services/heartbeat/task-markdown.ts:230` tells runs to "use
  set_task_title". That was a project-tools tool, and `/api/mcp/project-tools` is retired. The
  `paperclip` catalog has no tool that only sets the title while it's provisional
  (`onlyIfProvisional`). The directive's REST fallback (`PUT /api/issues/:id/title`) works only
  through curl with `PAPERCLIP_API_KEY`, because `paperclip_call_api` is admin-only.
- **Likely fix:**
  - add a provisional-title option to `paperclip_update_task` (or a small `paperclip_set_task_title`)
    that calls `PUT /issues/:id/title`;
  - point the directive at it.

  This is a capability runs lost in step 4a, so fix it before `main`.

### 52. Use the MCP tool names in the chat directive

Found by the step 4a run-MCP agent (2026-11-18).

- **What's wrong:** `server/src/services/agent-conversations.ts:117` names `create_project` and
  `create_task`. The run's tools are `paperclip_create_project` and `paperclip_create_task`.
- **Likely fix:** rename them in the directive, and check the other prompt texts for project-tools
  names. Fix before `main`.

### 53. Stop the ACP engine tests writing settings into the repo

Found by the step 4a run-MCP agent (2026-11-18).

- **What's wrong:** running `packages/adapter-utils/src/acpx-engine/execute.test.ts` leaves
  `packages/adapter-utils/.claude/settings.local.json` in the package folder. Some claude-agent
  tests run without a temporary `cwd`, and `acpx-engine/execute.ts:1674` writes
  `<cwd>/.claude/settings.local.json`. It can slip into a commit.
- **Likely fix:** give those tests a temporary `cwd`, or add the path to `.gitignore` as a guard.

### 54. Check access on the other plugin-origin agent writes

Found by the step 4a bug-fix agent (2026-11-18), while fixing bug 50.

- **What's wrong:** bug 50's fix covers `plugin-host-services.ts` only. Other places use the plugin
  origin as the acting agent but check only the target's consent:
  - `server/src/services/agent-configuration.ts:28-38` (`lockAgentConfigurationInteractions`);
  - probably the plugin-origin writes in `issues.ts` (create at `:10620`, and `:13733`);
  - probably `routines.ts:983` and `:1818`.

  The `issues.ts` and `routines.ts` cases aren't verified.
- **Who it affects:** only setups with plugins installed (opt-in here).
- **Likely fix:** one central check. In `agentInteractionDenial` (`agent-interaction-policy.ts`),
  when the actor comes from a plugin origin, also check the matching access action. Then the
  per-call checks from bug 50 can go.

### 55. Make the title route's access refusal requestable

Found by the step 4a bug-fix agent (2026-11-18).

- **What's wrong:** when the access level is what refuses `PUT /issues/:id/title`, the route
  answers `issue_write_not_visible` (`denyIssueWrite`, `server/src/routes/issues.ts:14903-14907`).
  `PATCH /issues/:id` answers `denyAgentAccess(res, decision, "tasks:update_any")`, which can be
  requested. In practice the title route also requires the assigned agent's own run, so a worker
  rarely reaches this.
- **Likely fix:** use `denyAgentAccess` there, as `PATCH /issues/:id` does.

### 56. Decide whether catalog task creation needs a retry key

Found by the step 4a bug-fix agent (2026-11-18).

- **What's wrong:** `paperclip_create_task` takes no idempotency key, so a retried call can create a
  duplicate task. The chat directive's REST sentences still mention one. The old project-tools
  server prefixed the key per conversation (`chat-handoff:<issueId>:<key>`). A plain key on the
  catalog tool could collide across tasks in a company.
- **Likely fix (to decide):** a `requestId` scoped to the caller and the parent or conversation
  task, like the public MCP's write receipts. Or leave creation without one, and drop the mention
  from the directive.

### 57. Make `attentionService.list` fast over many failed runs

Found by step 3a agent G (2026-11-18). In `server/src/__tests__/attention-service.test.ts`, "checks
more failed runs for a newer run than one statement can bind" still takes ~25 s after its seeding was
made a single statement: the time is inside `attentionService.list` itself, over 16,400 failed runs.

- **Problem:** the attention feed's failed-run check scales badly with the number of failed runs; a
  company with many failures could see a slow inbox.
- **Likely fix:** profile the query or queries `list` makes for that case (probably one per chunk of
  runs, or an unindexed lookup of newer runs) and replace them with one set-based query.

### 58. Check the scope of a scoped `agents:configure` override

Found by the step 4a regression agent A (2026-11-19), on `feat/step-4a` only; not on `main` or
server1. 10 tests in `agent-instruction-revisions` and `connection-management.integration` show it.

- **What's wrong:** `isAllowed` in `packages/shared/src/agent-access.ts` counts any `{scope}` override
  as allowed, and `hasAgentAccess` uses it, so `decideAgentAccess`
  (`server/src/services/authorization.ts`, ~1871) and the `agent_config:read` check (~2975) never
  look at the scope. Migration 0491 turns scoped configure grants into `{scope}` overrides, so after
  deploying, an agent limited to configuring agent X could configure every agent. **Security; fix
  before `feat/step-4a` merges.**
- **Likely fix:** check the target against the scope for `agents:configure`, as `tasks:assign` does
  with `scopeAllows` (~2890–2902), and decide whether any other action takes a scope.
- **Fixed** by regression agent B (`1c870f14d`): `decideAgentAccess` takes the requested scope and
  checks a scoped override with `scopeAllows`; outside it the refusal is `deny_scope` (an explicit
  restriction, not requestable); with no requested scope a scoped override fails closed, as a
  scoped grant did on `main`. The same gap in `agent_config:read` and the `tasks:assign` fallback is
  closed too. `isAllowed`/`hasAgentAccess` stay a coarse gate (route policy, MCP tool filtering).

### 59. Keep provider `access_denied` errors apart from agent access refusals

Found by the step 4a regression agent A (2026-11-19), on `feat/step-4a`. 3 tests in
`secrets-routes`.

- **What's wrong:** `server/src/middleware/error-handler.ts` treats any `details.code ===
  "access_denied"` as an agent access refusal. AWS Secrets Manager errors use the same code, so their
  sanitized details (region, required capability, actionable message) are dropped and
  `requestable: false` is added.
- **Likely fix:** recognise an agent refusal by `details.missingAction`, or give agent refusals
  their own code.
- **Fixed** by regression agent B (`d162c3255`): an agent refusal is `access_denied` with a string
  `missingAction`; other `access_denied` errors keep their details. The plugin origin check
  (`plugin-host-services.ts`) now always names its `missingAction`, the one producer that didn't.

### 60. Let a worker pick a workspace for its own subtask

Found by the step 4a regression agent A (2026-11-19), on `feat/step-4a`. 1 test in
`task-workspace-api`.

- **What's wrong:** `assertSelectedWorkspaceTrust` (`server/src/services/task-repository-acquisition.ts`,
  creation branch) probes `issue:mutate` with no `issueId`, so `decideAgentIssueWriteAccess` treats
  the write as not the agent's own and asks for `tasks:update_any`. By design a worker's
  `tasks:create` covers subtasks of its own tasks, so a worker can't create a subtask with an
  explicit workspace selection.
- **Likely fix:** for creation, check against the parent task (own parent: `tasks:create`), not a
  missing issue.
- **Fixed** by regression agent B (`1c870f14d`): `decideAgentIssueWriteAccess` judges ownership by
  `issueId ?? parentIssueId`, as the visible-issue write rule does for a new child.

### 61. Don't write or lock on an access check with no temporary grant

Found and fixed by the step 4a regression agent B (2026-11-19, `0a1c2721d`), on `feat/step-4a`.
`agent-file-checkpoint-locking` caught it.

- **What was wrong:** `consumeTemporaryAccess` (`server/src/services/agent-access.ts`) ran
  `UPDATE temporary_access_grants … FOR UPDATE SKIP LOCKED` on every check the access level refused,
  even with no grant, so read paths (the warm instruction checkpoint) issued a write.
- **Fix:** one read first, preferring a standing grant; the UPDATE runs only when a one-use grant
  exists, and spending it stays atomic.

### 62. Steady two server tests that flaked in CI

Found 2026-11-19. CI run 44544972878 on `main` (`282b37631`, a docs-only commit after the green run
44542707607) failed one test in each of two shards, on CI's 4-core runners with 2 workers:

- `server/src/__tests__/heartbeat-worktree-suppression.test.ts`: "suppresses new assignment wakes in
  worktree instances without creating heartbeat runs" (shard 5/10).
- `server/src/__tests__/run-start-handover.test.ts`: "the old server stops starting runs once the new
  one starts them, and the new one starts the queued run" (shard 1/10).

- **Problem:** both passed the run before with no code change, so they're timing-sensitive under
  CI's load. A red run blocks a merge into `main` under the step 3a workflow.
- **Since then:** `heartbeat-worktree-suppression` failed the same way in shard 5 on the next two
  runs too (`main` `a0542e318`, run 44565887434; `feat/step-4a` `4bd93bce3`, run 44565891427): its
  `afterEach` (line 75), which waits for in-flight heartbeat runs to settle, times out at 30 s. Alone
  it passes every time (3 of 3 locally, ~9 s). So it's a leak: an earlier file in its shared worker
  leaves heartbeat work running or module state behind. `run-start-handover` hasn't recurred.
- **Likely fix:** find the file before it in shard 5's worker that leaves the work behind (the step
  3a method in [results-leaks.md](test-suite-audit/results-leaks.md)) and fix or isolate that file;
  as a stopgap, add `heartbeat-worktree-suppression` to `ISOLATED_BY_NAME` in
  `server/vitest.config.ts`.
- **Fixed** by agent C (`d5435c29b`), tests only. The leakers were
  `interaction-resolution-cross-issue-cap-postgres` and `interrupted-preparation-hold-settle`: each
  starts a real background heartbeat run (a wake, a replay or Retry) and ends its database without
  awaiting it. The run sits ~60 s in teardown on the ended pool, stays in the module-level
  `activeRunExecutionPromises` (`services/heartbeat.ts:643`), and the victim's
  `drainActiveRunExecutions()` waits on it past 30 s. Both files now drain in `afterEach`
  (hold-settle then truncates with CASCADE, since finished runs write rows that reference them);
  `interrupted-preparation-restore-retry` drains in `afterAll` too. The leak-report probe
  (`PAPERCLIP_TEST_LEAK_REPORT`, `helpers/shared-worker-state.ts`) now records in-flight heartbeat
  runs and wakes per file, so other files with this pattern will show up. Shard 5 passed twice
  locally with 2 workers.
- **Still open:** `run-start-handover` (shard 1, once) looks like a timing flake under load (1.5 s
  lease, 200 ms renew, statement timeouts just before the failing assertion at line 134). If it
  recurs, loosen that test's timings.
- **It recurred** on 2026-11-19, the same test in shard 1: `main` `5bde9aec2` (run 44592759528,
  the commit deployed to server1) and `deploy/safer-deploys` `a1e26349e` (run 44629241078, a
  deploy-files-only branch). That's 3 of the last 5 runs, so it now blocks merges and, with the new
  CI gate in `deploy.sh`, deploys (unless `--skip-ci`). Loosen its timings next.
- **Fixed** (`3a668926a`): not timings but a dropped hint. When the old server skips a run start
  during the hand-over it hints the new server to dispatch, at most one hint per `skipHintMinMs`; a
  skip inside that window returned without one (`skipHint()` in
  `server/src/services/run-start-handover.ts`). The test queues its run ~40–50 ms after the first
  hint, inside its 50 ms window, so no hint ever came (`expected 1 to be greater than 1` after the
  full 10 s wait, in all three failing jobs; the statement-timeout warnings were later tests'). Now
  such a skip owes one trailing hint, sent by the hand-over worker when the window ends, shared by a
  burst. In production (1 s window) the bug only delayed a run until another wake or the new server's
  60 s redrive: claims are atomic, so nothing started twice or was lost. Under CPU load the test failed
  12 of 30 before and passed 30 of 30 after; a new test pins the trailing hint.

### 63. Find what adds 11 close listeners to the HTTP server

Seen on server1 at the step 4a deploy (2026-11-19, `5bde9aec2`), once at startup:
`MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 close listeners added
to [Server]. MaxListeners is 10.` Not known whether it predates the fork's changes (the previous
container's logs are gone).

- **Problem:** probably harmless (one listener per subsystem that stops on close), but if it grows
  with use it's a leak.
- **Likely fix:** run with `--trace-warnings` to see who adds them; if it's a fixed set, raise the
  limit for that server; if it grows over time, fix the subsystem that adds one per use.

### 64. Find the file that leaves a heartbeat run behind for heartbeat-task-drain

Found 2026-11-20. CI run 44645544091 (`fix/run-start-handover-flake`, `3a668926a`, a change that
doesn't reach this shard) failed `server/src/__tests__/heartbeat-task-drain.test.ts` >
"status_reports_quiescent_when_both_promise_sets_are_empty" in shard 9/10: `expected 1 to be +0` at
line 60, `getTaskDrainStatus().activeRuns`. The rerun of that shard passed.

- **Problem:** the same pattern as bug 62: the test reads the module-level heartbeat run set
  (`activeRunExecutionPromises`, `services/heartbeat.ts`), and an earlier file in its shared worker
  left a background heartbeat run in it. A red shard blocks merges and, through the CI gate, deploys.
- **Likely fix:** run shard 9 with `PAPERCLIP_TEST_LEAK_REPORT` (bug 62 added in-flight heartbeat runs
  and wakes to the probe) to find the file that ends with a run in flight, and make it drain
  (`heartbeatService(db).drainActiveRunExecutions()`) in `afterEach`, as bug 62's fix did.
- **Fixed** (`877fe4dd7`, `ec3d65627`), tests only; CI run 44660284099 green first time. The leak
  report alone missed it (shard 9 locally: all probes 0; the leak is timing-dependent), so the fix
  traced each heartbeat run's start and settle per file with temporary instrumentation over the full
  thorough tier. Two files' runs outlived them by ~60 s: `fresh-continuation-retry-delivery` (CI's
  shard 9; a delivered continuation or Retry starts a real run, and `afterAll` ended the pool without
  awaiting it) and `completed-turn-cleanup-hold-settle`. Each reproduced the CI error when run before
  `heartbeat-task-drain` in one worker; the first also explains bug 62's
  `heartbeat-worktree-suppression` failure. Both now drain in `afterEach`. Twenty more files, and
  `helpers/runner-api-server.ts`'s `close()` (28 users), started real runs that settled only
  milliseconds to seconds before teardown; they drain too. After: full thorough tier, 913 heartbeat
  probes, all 0.
- **Left open:** `heartbeatService()` registers module-level resumers bound to its db
  (`registerCompletedTurnCleanupResumer`, `registerHeldPreparationResumer`); in a shared worker a
  later file can call an earlier file's resumer on an ended pool (caught, logged as
  `CONNECTION_ENDED`, harmless). A per-run start/settle probe in `helpers/shared-worker-state.ts`
  would catch timing-hidden leaks like this one, but it needs a hook in `services/heartbeat.ts`.

### 65. Tag the running image as previous before Compose builds the new one

Found 2026-11-20, at the first deploy through the new `deploy.sh` (`18b6f3e1e` over `5bde9aec2`). CI
passed, the core image built and `docker compose build server` built the new `paperclip-fork:local`;
then `docker tag <running image id> paperclip-fork:previous` failed with `No such image:
sha256:cb3d2c34…`, and the script stopped before `compose up`. Production kept running
`5bde9aec2`, healthy, and no `last-deploy.env` was written.

- **Problem:** server1's Docker (29.9.3) uses the containerd image store. When Compose moves the
  `paperclip-fork:local` tag to the new build, the old image, now untagged, is removed even though
  the running container was created from it. So the image ID read from the container before the
  build no longer exists by the time the script tags it, after the build. Every deploy fails at this
  step. The stub harness didn't catch it because its `docker` stub keeps untagged images.
- **Likely fix:** in `deploy/deploy.sh`, tag the running image as `paperclip-fork:previous` before
  `docker compose build server`, so the old image keeps a name, and make the stub drop an image when
  its last tag moves, so the harness covers it. This time there is no image for `5bde9aec2` to roll
  back to, but `paperclip-core:5bde9aec2` still exists, so one could be rebuilt from it if needed.
- **Fixed** (`49b1c703d`, docs `4a70da3da`; CI run 44668408567 green). Before the build the running
  image is held as `paperclip-fork:outgoing`, which becomes `paperclip-fork:previous` just before the
  restart, so a deploy that stops partway leaves the last good rollback image and `last-deploy.env`
  alone. The deployed commit is read from the server container's environment, which outlives its
  image. When the running image is already gone (as at this deploy), it is rebuilt from
  `paperclip-core:<commit>` and that commit's tree (`git archive | docker build -f deploy/Dockerfile`,
  not Compose); if it can't be, the deploy warns and goes on without one, and `--rollback` refuses.
  `--rollback` also refuses when `paperclip-fork:previous` isn't the image the record names. The
  docker stub now deletes an image when its last tag moves (the old script fails 30 of its 49
  cases); harness 49/49.

### 66. Let the database decide a lease that looks expired on the server's clock

Found 2026-11-20, when CI on `upstream-watch/2026-11-19` failed shard 10 (run 44674823660):
`issue-recovery-activity-hints` ("re-checks only the tasks seven runs a minute touch") counted 8
failed runs against a limit of 6. A rerun passed. It reproduces on `main` with the test capped to
two CPUs, and even passing runs had 2–4 failed runs out of 60, all `controller_lease_lost` with no
exit code or output.

- **Problem:** `watchLegacyControllerLease` (`server/src/services/legacy-controller-lease.ts`) arms
  its first deadline from `controller_lease_expires_at`, which the database writes with its own
  clock (`clock_timestamp() + 60 s`), minus this process's `Date.now()`. When the server's clock is
  ahead of the database's by more than a lease, a lease the database still holds looks expired:
  the deadline is armed at 0 ms and fires before the immediate renewal answers, so the run fails
  before dispatch. The test fakes `Date` and fast-forwards about 10 minutes before measuring, so
  every run started 8½–9½ minutes "late"; whether the renewal won the race depended on load. In
  production the same would hit every run on a server whose clock runs a minute ahead of
  Postgres's.
- **Likely fix:** the database decides. The renewal already refuses a lease that lapsed, and no
  dispatch happens before a renewal succeeds, so a lease that looks expired locally can wait for the
  database's answer, bounded by one renewal statement for a hung database.
- **Fixed** (`c67fff236`). A lease that looks expired locally arms its first deadline at
  `LEGACY_CONTROLLER_RENEWAL_STATEMENT_TIMEOUT_MS` (10 s) instead of 0. Two new tests in
  `legacy-controller-lease.test.ts`: a held lease 10 minutes "expired" on the local clock renews and
  dispatches, and the same lease with a database that never answers is still lost at the deadline
  (`renewal_deadline`). With two CPUs, `issue-recovery-activity-hints` now has 0 failed runs out of
  60 (three runs; before, 2–4 in every run). The test's 10% allowance for failed runs is left as
  upstream wrote it.

### 67. Make `agent-commentary-skills` pass in a worktree under `.claude/`

Found 2026-11-20 by step 4b's agent A.

- **Problem:** `server/src/__tests__/agent-commentary-skills.test.ts`, "mounts both skills and their
  shared helper for Codex, Claude and the Codex sandbox home", fails with `ENOENT` on
  `<tmp>/codex/skills/complain/SKILL.md` when run from an agent worktree
  (`.claude/worktrees/agent-*`), with or without the branch's changes. It passes from the main
  checkout at the same commit, and CI is green. So it depends on where the checkout lives: likely
  the Codex skill discovery skips, or resolves differently, a source path under a `.claude/` folder.
  Dormant code (Codex), but it puts a red test in every agent's `test:quick` report.
- **Likely fix:** find which path rule the Codex half applies to the skill source; make the test
  independent of the checkout's location, or fix the rule if it's wrong for real installs.
- **Fork workaround:** none; reviewers re-run it from the main checkout.

### 68. Steady `fresh-continuation-fallback`'s recycled-PID test

Found 2026-11-20 in CI on `feat/step-4b` (run 44797032206, shard 5).

- **Problem:** `server/src/services/fresh-continuation-fallback.test.ts`, "does not mistake a
  recycled PID for the old writer", expected `kind: "continued"` and got
  `kind: "exact_recovery_pending"` (line 805). The same shard passed on the previous run of the
  branch, and on the re-run of the failed job, and step 4b doesn't touch that code: a flake, likely
  timing-sensitive around the process-start-time check.
- **Likely fix:** find what the test races against (the recorded start time versus the probe), and
  make it deterministic.
- **Fork workaround:** re-run the failed CI job.

### 69. Bring the opt-in hiring and portability tests up to step 4a's access levels

Found 2026-11-20 by step 4b's agent E; confirmed on `feat/step-4b` before E's merge.

- **Problem:** two opt-in test files fail since step 4a and CI never saw it, because the thorough tier
  skips them (`server/**/*ai-connection*.test.*` and `server/**/*portability*.test.*` in
  `scripts/test-tiers.json`, both marked dormant).
  - `server/src/__tests__/agent-hire-ai-connections.test.ts`: 60 of 84 tests get 403 "This agent's
    access level does not let it hire agents (needs agents:create)". Its fixture inserts a CEO
    agent with no `access`, so it gets the default `worker` level, and grants the old
    `principalPermissionGrants` keys, which 4a no longer reads for hiring.
  - `server/src/__tests__/company-portability.test.ts`, "restores a CEO's recorded hiring denial":
    the call it checks now carries an extra `access` field.
- **Likely fix:** give the fixture's hiring agent an access level that allows `agents:create`, and
  update the portability expectation to the 4a shape. Then decide whether managed AI connections
  still belong in the opt-in tier: the `claude_local` agents here bind one (`aiConnection`), so
  part of that area isn't dormant.
- **Fork workaround:** none; the files only run with `corepack pnpm test:optin`.

### 70. Find the bundled skills folder from a nested worktree

Found 2026-11-21 by step 4b part 3's agent I.

- **Problem:** `resolvePaperclipSkillsDir` (`server/src/services/connector-runtime.ts:200-205`)
  walks up from the module and takes the first `.claude/skills` it meets. From a worktree nested
  under the main checkout's `.claude/worktrees/`, that's the main checkout's
  `/home/brian/coding/paperclip/.claude/skills`, not the repo's `skills/`, so the bundled connector
  skills (agentmail, slack) read as missing there. Part of the `email-channels.integration` and
  `chat-channels.integration` failures in agent worktrees comes from this. A deployment isn't
  nested, so it's a dev and test problem.
- **Likely fix:** look for the repo's own `skills/` (next to the package root) before any
  `.claude/skills`, or stop at the first `pnpm-workspace.yaml`.

### 71. Fix the opt-in chat and email channel failures on `main`

Found 2026-11-21 by step 4b part 3's agent I; identical on `main` at `3535df8071`.

- **Problem:** two opt-in files fail on `main`, and CI doesn't run them:
  `chat-channels.integration.test.ts` (10 of 1970, among them "keeps one exact chat delivery
  owner…", "does not resolve or mint a substitute owner…", "binds Slack tools to the admitted
  linked request…", plus lock contention on `chat_endpoints`), and
  `email-channels.integration.test.ts` (3). Some, maybe all, come from bug 70 when run in a
  worktree; it's unchecked whether they also fail from the main checkout.
- **Likely fix:** run both from the main checkout first; fix what remains, or skip it with a note
  (chat channels are dormant here).

### 72. Steady the server tests that fail only under a full local run's load

Found 2026-11-21 by step 4b part 2's and part 3's agents G and I, in local `test:quick` runs.

- **Problem:** these each failed once in a full local quick run and pass alone and in CI:
  `heartbeat-run-output.test.ts` (`write CONNECTION_ENDED` on a `heartbeat_runs` select),
  `connection-management.integration.test.ts` (Arcade discovery) and
  `legacy-finalization-regression.test.ts` (a 30 s timeout). Related to bugs 62 and 68.
- **Likely fix:** look for a shared cause (the embedded database's connection limit, or a slow
  machine) before steadying each test.

### 73. Share the worktree folder and base-ref rules between a run and its preview

Found 2026-11-21 by step 4b part 2's agent G, while making the run preview match a worktree run.

- **Problem:** `server/src/services/run-preview-worktree.ts` copies three rules from
  `workspace-runtime.ts` (`resolveGitOwnerRepoRoot`, the worktree folder rule and
  `resolveAuthoritativeBaseRef`, minus fetches), because they aren't exported. If the run's rules
  change and the copy doesn't, the "What runs get" card stops matching real runs, and nothing fails.
- **Likely fix:** export no-fetch versions from `workspace-runtime.ts`, use them in both places, and
  delete the copy. Also noted in the preview code: a symlinked skill folder in the base commit isn't
  followed, and a managed AI connection's project-auth check still reads the main checkout.

### 74. Loosen `controller-instance-lease`'s wall-clock bound on a blocked renewal

Found 2026-11-21 by step 4b part 2's agent G.

- **Problem:** `controller-instance-lease.test.ts`, "has the server cancel a renewal blocked on a row
  lock…", took about 10.1 s against its 9.5 s limit on the desktop, including when run alone. It
  failed in agent I's quick run too. The file imports nothing step 4b changed. Related to bug 72.
- **Likely fix:** check it on `main` first; if it fails there too, measure what the renewal waits
  on and set the bound from that rather than from the wall clock.
