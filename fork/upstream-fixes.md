# Bugs

The fork's bug list: things the code or docs get wrong, found while building and using Paperclip.
Since the hard fork (2026-11-17) they're fixed in our own tree, on a branch merged into `main`. The
file kept its old name, `upstream-fixes.md`, so links still work. Until then it listed fixes to send
to `paperclipai/paperclip`; entries from that time keep their history (branches, pull requests).

**Not test-only problems in the extended or opt-in tiers** (since 2026-11-23): a file there that
fails for test reasons moves to opt-in with a one-line reason in `scripts/test-tiers.json`, or is
deleted ([CLAUDE.md](../CLAUDE.md#tests)). A product bug a test finds still goes here.

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
| 51 | [Give runs a title tool now that project-tools is gone](#51-give-runs-a-title-tool-now-that-project-tools-is-gone) | fixed (`846bc008d`, in `main` with 4a) | | | 2026-11-18 | | |
| 52 | [Use the MCP tool names in the chat directive](#52-use-the-mcp-tool-names-in-the-chat-directive) | fixed (`1137643cc`, in `main` with 4a) | | | 2026-11-18 | | |
| 53 | [Stop the ACP engine tests writing settings into the repo](#53-stop-the-acp-engine-tests-writing-settings-into-the-repo) | fixed (`b30f07d57f`, `b4d5ecbe9e`) | | | 2026-11-18 | | |
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
| 67 | [Make `agent-commentary-skills` pass in a worktree under `.claude/`](#67-make-agent-commentary-skills-pass-in-a-worktree-under-claude) | fixed (`e6e1b65da8`) | | | 2026-11-20 | | |
| 68 | [Steady `fresh-continuation-fallback`'s recycled-PID test](#68-steady-fresh-continuation-fallbacks-recycled-pid-test) | fixed (`1577048c2f`, `657f0d91fb`) | | | 2026-11-20 | | |
| 69 | [Bring the opt-in hiring and portability tests up to step 4a's access levels](#69-bring-the-opt-in-hiring-and-portability-tests-up-to-step-4as-access-levels) | fixed (`b60f981236`) | | | 2026-11-20 | | |
| 70 | [Find the bundled skills folder from a nested worktree](#70-find-the-bundled-skills-folder-from-a-nested-worktree) | fixed (`e6e1b65da8`) | | | 2026-11-21 | | |
| 71 | [Fix the opt-in chat and email channel failures on `main`](#71-fix-the-opt-in-chat-and-email-channel-failures-on-main) | fixed (`5be9021f8e`) | | | 2026-11-21 | | |
| 72 | [Steady the server tests that fail only under a full local run's load](#72-steady-the-server-tests-that-fail-only-under-a-full-local-runs-load) | fixed (`7058a272a5`, `f4f04c17a9`) | | | 2026-11-21 | | |
| 73 | [Share the worktree folder and base-ref rules between a run and its preview](#73-share-the-worktree-folder-and-base-ref-rules-between-a-run-and-its-preview) | candidate | | | 2026-11-21 | | |
| 74 | [Loosen `controller-instance-lease`'s wall-clock bound on a blocked renewal](#74-loosen-controller-instance-leases-wall-clock-bound-on-a-blocked-renewal) | fixed (`400317287b`) | | | 2026-11-21 | | |
| 75 | [Stop redacting the run manifest's credential row](#75-stop-redacting-the-run-manifests-credential-row) | candidate | | | 2026-11-22 | | |
| 76 | [Record and preview a run's full environment key list](#76-record-and-preview-a-runs-full-environment-key-list) | candidate | | | 2026-11-22 | | |
| 77 | [Find the package test that failed once in a local `test:quick`](#77-find-the-package-test-that-failed-once-in-a-local-testquick) | candidate | | | 2026-11-22 | | |
| 78 | [Tell the agent when its permission request is denied](#78-tell-the-agent-when-its-permission-request-is-denied) | candidate | | | 2026-11-22 | | |
| 79 | [Make the run preview's "writes no files" test ignore other files' temp folders](#79-make-the-run-previews-writes-no-files-test-ignore-other-files-temp-folders) | fixed (`2789106d6e`) | | | 2026-11-22 | | |
| 80 | [Give `nested-clone-migration`'s expire-and-restore test room on a loaded CI runner](#80-give-nested-clone-migrations-expire-and-restore-test-room-on-a-loaded-ci-runner) | fixed (`fc9c76393b`) | | | 2026-11-22 | | |
| 81 | [Make `paperclip-skill-utils` read the skills folder from the repo, not the current directory](#81-make-paperclip-skill-utils-read-the-skills-folder-from-the-repo-not-the-current-directory) | candidate | | | 2026-11-22 | | |
| 82 | [Time test waits on the monotonic clock: the desktop's wall clock jumps](#82-time-test-waits-on-the-monotonic-clock-the-desktops-wall-clock-jumps) | candidate | | | 2026-11-22 | | |
| 83 | [Stop the runtime service `workspace-runtime`'s sibling test leaves running](#83-stop-the-runtime-service-workspace-runtimes-sibling-test-leaves-running) | candidate | | | 2026-11-23 | | |
| 84 | [Don't send the string "null" as a no-task run's task brief](#84-dont-send-the-string-null-as-a-no-task-runs-task-brief) | candidate | | | 2026-11-23 | | |
| 85 | [Say which approval an approval wake is about](#85-say-which-approval-an-approval-wake-is-about) | candidate | | | 2026-11-23 | | |
| 86 | [Send the chat directive once per chat session, not every turn](#86-send-the-chat-directive-once-per-chat-session-not-every-turn) | candidate | | | 2026-11-23 | | |
| 87 | [Store a run's whole prompt, not the first 16,384 characters](#87-store-a-runs-whole-prompt-not-the-first-16384-characters) | fixed (step 5, `5c3cea6c21`) | | | 2026-11-23 | | |
| 88 | [Give `claude_local` runs the instruction working-copy guidance](#88-give-claude_local-runs-the-instruction-working-copy-guidance) | fixed (step 5, `41427fffda`) | | | 2026-11-23 | | |
| 89 | [Stop prompt texts naming Runner tools and curl recipes runs don't use](#89-stop-prompt-texts-naming-runner-tools-and-curl-recipes-runs-dont-use) | candidate | | | 2026-11-23 | | |
| 90 | [Keep the agent's instructions after Claude compacts a session](#90-keep-the-agents-instructions-after-claude-compacts-a-session) | fixed (step 5, `41427fffda`) | | | 2026-11-23 | | |
| 91 | [Show a run's whole prompt size in the Transcript tab's prompt card](#91-show-a-runs-whole-prompt-size-in-the-transcript-tabs-prompt-card) | candidate | | | 2026-11-24 | | |
| 92 | [List the whole company skill library in a run's system prompt, as intended](#92-list-the-whole-company-skill-library-in-a-runs-system-prompt-as-intended) | fixed (step 5, `41427fffda`) | | | 2026-11-24 | | |
| 93 | [A run preview on a finished task fails with a server error](#93-a-run-preview-on-a-finished-task-fails-with-a-server-error) | candidate | | | 2026-11-24 | | |
| 94 | [An "Other" answer shows its option id in the answer summary](#94-an-other-answer-shows-its-option-id-in-the-answer-summary) | candidate | | | 2026-11-24 | | |
| 95 | [A comment an earlier run handled is sent again as new](#95-a-comment-an-earlier-run-handled-is-sent-again-as-new) | candidate | | | 2026-11-24 | | |
| 96 | [Paperclip doesn't record when Claude compacts a CLI session](#96-paperclip-doesnt-record-when-claude-compacts-a-cli-session) | fixed (step 5, `767dbbfad8`) | | | 2026-11-24 | | |
| 97 | [Drop the double brackets on the run message's documents line](#97-drop-the-double-brackets-on-the-run-messages-documents-line) | fixed (step 5, `767dbbfad8`) | | | 2026-11-25 | | |
| 98 | [Don't repeat the last run's summary when the agent's comment says the same](#98-dont-repeat-the-last-runs-summary-when-the-agents-comment-says-the-same) | fixed (step 5, `767dbbfad8`) | | | 2026-11-25 | | |

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
- **Fixed** (`b30f07d57f`, `b4d5ecbe9e`, merged as `dfd82949d6`), tests only. Seven tests in
  `acpx-engine/execute.test.ts` had no cwd, so the engine fell back to `process.cwd()` (`execute.ts`,
  ~:1900); `runExecutor` now gives such a test one private temp cwd, kept across its resumed turns.
  Worse, `claude-local`'s `acp.quota.test.ts` passed the repo root as cwd on purpose, so every run
  merged its permissions into the checkout's own root `.claude/settings.local.json`; it now uses its
  temp folder. The path was already gitignored. adapter-utils (95 files), claude-local (32) and
  `test:quick` now leave nothing behind (`git status --ignored` before and after).

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
- **Fixed** with bug 70 (`e6e1b65da8`, merged as `dfd82949d6`). Same cause: the test passes
  `server/src/__tests__` as the module folder, so in a nested worktree the shared lookup mounted the
  outer checkout's `.claude/skills` (pm, upstream-watch…) instead of the repo's `skills/`, and
  `complain/SKILL.md` was missing. Codex wasn't at fault. Passes 3 of 3 in a nested worktree now.

### 68. Steady `fresh-continuation-fallback`'s recycled-PID test

Found 2026-11-20 in CI on `feat/step-4b` (run 44797032206, shard 5).

- **Problem:** `server/src/services/fresh-continuation-fallback.test.ts`, "does not mistake a
  recycled PID for the old writer", expected `kind: "continued"` and got
  `kind: "exact_recovery_pending"` (line 805). The same shard passed on the previous run of the
  branch, and on the re-run of the failed job, and step 4b doesn't touch that code: a flake, likely
  timing-sensitive around the process-start-time check.
- **Since then:** failed again 2026-11-22 on `ci/workflow-jobs` (run 44978484878, shard 5, same
  assertion at line 805), on a branch that changes only the CI workflow; the failed job was
  re-run. Twice now, both times in shard 5: under the green-push guide's rule it gets fixed next.
  A third time 2026-11-22 on `ci/hook-lock-and-quick-names` (run 45048605767, shard 4, the new
  shard weights having moved the file), on a branch without the fix; the failed job was re-run.
- **Fixed** (`1577048c2f`, merged as `875621d3f8`), test only. The test gave the worker's live PID a
  recorded start of `2020-01-01T00:00:00Z`. On Linux a gap of a whole number of seconds between two
  starts counts as possibly the same process seen across a clock change (`ProcessStartClock`,
  fail closed), and Linux reports starts in hundredths of a second, so the test failed whenever the
  worker's own start fell on a whole second: about 1 time in 100. A child process with a `.000`
  start reproduced CI's `previous_process_running` every time. The recorded start is now 60.5 s
  before the observed one; the file passed 20 of 20 at 2 workers. Not a leak, and not a race.
- **Same flaw, also fixed** (`657f0d91fb`): `workspace-runtime-control-recovery.test.ts`
  (`reusedPidOwner`); a `.000`-start owner gave `reconciled: 0`. A search of the other tests that
  pair `process.pid` with a fixed start found none that need fixing.

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
- **Fixed** (`b60f981236`, merged as `da1e574f2a`), tests only. The hire fixture's CEO now starts the way
  `newAgentAccess` starts one, at manager with the `agents:create` override: 84 of 84. The
  portability call's extra `access` field is intended: since `b14355472a` an imported CEO's hiring
  denial also sets `agents:create` to false (`withAccessOverride`, `company-portability.ts`), and the
  expectation now includes it. Both files 203 of 203, three runs.
- **Tier question, decided 2026-11-22:** the 13 live files moved to thorough (below; done on
  `ci/ai-connection-tier`). the 17 files under the `ai-*` and `*ai-connection*` opt-in globs
  take ~90 s with one worker (485 tests, all passing). Thirteen cover what server1's `claude_local`
  runs use (credential resolution, rotation, write-back, hiring with an inherited connection,
  Claude's limits and logins: ~40 s, among them `ai-connections` and `agent-hire-ai-connections`).
  Four are dormant: `ai-connection-router` (pools, off), `antigravity-ai-connections.integration`,
  `ai-provider-routing` (Pi, OpenRouter, Hermes) and `services/local-ai-browser-login` (Codex). The
  broad globs in `scripts/test-tiers.json` became explicit entries for the first three (the fourth
  stays opt-in under the `*antigravity*` glob), so the rest are in the thorough tier: 13 files, 387
  tests, ~51 s at 2 workers. Being opt-in is why CI never caught this bug.

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
- **Fixed** (`e6e1b65da8`, merged as `dfd82949d6`). Not a walk-up: `resolvePaperclipSkillsDir` is
  the shared one in `packages/adapter-utils/src/server-utils.ts`, and it tries fixed relative
  candidates first. `../../../../../skills` was written for an adapter's `src/server`, five levels
  below the repo; from `server/src/services` it climbs out of the checkout, and from one nested under
  `.claude/worktrees/` it lands on the outer `.claude/skills`. Relative candidates must now stay
  inside the nearest folder with a `pnpm-workspace.yaml`; without one (published installs) nothing
  changes. The image (`/app`, the whole repo) resolves to `/app/skills` as before, checked on a
  mock layout for six module locations. It also fixes the CLI's lookup
  (`cli/src/commands/client/agent.ts`). A regression test in `server-utils.test.ts` pins it. In a
  nested worktree it fixes 2 of the 3 email-channel failures and 2 of the 10 chat ones (bug 71).

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
- **Fixed** (`5be9021f8e`, merged as `da1e574f2a`), tests only. Run outside a nested worktree, 9 of the
  13 failures remain; the other 4 (and the `chat_endpoints` lock contention) were bug 70.
  - **Two fixed:** "checks both linked sender and agent assignment grants for protected
    organizational defaults" (chat) and "checks sponsor and agent assignment grants for protected
    email organizational defaults" (email) gave the agent a `tasks:assign_scope` grant, which step
    4a no longer reads for an agent: a protected target needs a scoped `tasks:assign` override
    (`authorization.ts`, the restricted-policy branch of assignment). The fixtures set that override
    now; removing the person's grant still gives 403.
  - **Seven skipped:** the `reconciled chat retry delivery ownership` block. They pass alone and fail
    in a whole-file run: `deliverReconciledExecutions` sweeps every company, and by then the
    execution-disposition worker has continued earlier tests' leftover runs, so the sweep also wakes
    those. Test isolation in a dormant area. To bring them back, give the block its own file or
    database.
  - Both files after the change, two runs: 2008 passed, 7 skipped, ~28.5 min each.

### 72. Steady the server tests that fail only under a full local run's load

Found 2026-11-21 by step 4b part 2's and part 3's agents G and I, in local `test:quick` runs.

- **Problem:** these each failed once in a full local quick run and pass alone and in CI:
  `heartbeat-run-output.test.ts` (`write CONNECTION_ENDED` on a `heartbeat_runs` select),
  `connection-management.integration.test.ts` (Arcade discovery) and
  `legacy-finalization-regression.test.ts` (a 30 s timeout). Related to bugs 62 and 68.
- **Likely fix:** look for a shared cause (the embedded database's connection limit, or a slow
  machine) before steadying each test.
- **Fixed** (`7058a272a5`, merged as `ea9ee48c84`), with no shared cause: three separate findings.
  - `legacy-finalization-regression` was already fixed by `f4f04c17a9` (the test uses the shared
    checkout, not a worktree of the whole repo). The CI timeout (run 44971919760) tested a commit
    without it; it takes 1.5–2.2 s since.
  - `heartbeat-run-output`: the `CONNECTION_ENDED` line was another file's leftover native-resume
    timer (bug 64's open item), logged, not the failure. A real risk was found and fixed: "ends a run
    stopped during a storage outage as cancelled" stops the run before it registers its execution
    control, so the stop lands only when the legacy controller lease's next renewal is refused
    (~9.1 s). The test checked `Date.now()` against 10 s, which the wall-clock jumps of bug 82 can
    eat; it now uses `performance.now()` and allows one renewal (`LEGACY_CONTROLLER_RENEW_MS`) plus 2 s.
  - `connection-management.integration` (Arcade): not reproduced (5 of 5 at 2 workers under a 2-CPU
    cap; never failed in CI, no failure message kept). Reopen if it recurs.

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
- **Fixed** (`400317287b`, merged as `ea9ee48c84`), test only. The renewal waits exactly the
  server's 8 s `statement_timeout` (8.0 s here, 8025–8038 ms in 7 CI runs). The test timed it with
  `Date.now()`, which on this desktop jumps forward (bug 82): vitest timed the failing test at
  8.03 s while `Date.now()` read the renewal as 10.5 s. The file's three elapsed-time checks now use
  `performance.now()`, as the lease code does; the bound is unchanged.

### 75. Stop redacting the run manifest's credential row

Found 2026-11-22 in step 4b parts 2 and 3's real-run check (TES-42, run `0d7025ac`).

- **Problem:** a sealed CLI run records its manifest on the `adapter.invoke` event, and the event
  redaction (`server/src/redaction.ts`, `SECRET_FIELD_NAME_PATTERN`) masks any payload key named
  `credential`. The manifest's `credential` holds no secret (kind, method, connection id and name),
  but it's stored as `"***REDACTED***"`, so the run view's Credential row reads "Unknown method"
  (`credentialText` in `ui-new/src/runs/run-manifest.ts`). The agent's "What runs get" card, read
  from the preview route, shows it correctly. Since step 4b part 1.
- **Likely fix:** exempt `runManifest.credential` from key-name redaction (the value-pattern
  redaction still applies), or rename the field; add a test that the recorded manifest keeps it.

### 76. Record and preview a run's full environment key list

Found 2026-11-22 in the same real-run check.

- **Problem:** the run's recorded `envKeys` is cut off after about 30 names (`{"_truncated": true,
  "omittedItems": 22}` in the event payload). The launch also adds about 30 keys after planning
  (telemetry, git config, the GitHub broker, Runner network roots, the agent's signing keys), which
  the preview's `envKeys` doesn't list. Neither UI shows `envKeys` today, so nothing reads wrong yet.
- **Likely fix:** record the key names without the payload truncation (they're short), and either
  plan the launch-time keys in `planSealedClaudeRun` or mark the preview's list as "planned keys".

### 77. Find the package test that failed once in a local `test:quick`

Found 2026-11-22 by the CI/DevOps session, in a local pre-push check of `main` (`--changed b12b95be6f`).

- **Problem:** one test failed in quick's packages phase (73 passed, 1 failed) among six files:
  `packages/db/src/test-postgres-{owner,owner-process,admin,command}.test.ts`,
  `packages/db/src/test-embedded-postgres.test.ts` and
  `packages/adapters/claude-local/src/server/test.probe.test.ts`. The output didn't name the
  file. The next two runs that finished both passed; a machine crash cut off a loop of three more
  in between, while another session's tests were running alongside. Those files were selected only because `scripts/test.mjs` changed and
  quick matched "test" in their names (being fixed on `ci/hook-lock-and-quick-names`).
- **Likely fix:** none yet. If it recurs in CI, the shard's run summary or
  `node scripts/ci-flakes.mjs` names the test; fix it then.

### 78. Tell the agent when its permission request is denied

Found 2026-11-22 while evaluating step 4b part 4 (live sessions on the CLI).

- **Problem:** approving a step 4a permission request replays the call and posts the outcome on
  the task as a comment, which wakes the assignee (`server/src/routes/approvals.ts:498-511`).
  Denying one (`POST /approvals/:id/reject`, :620-658) records the decision and logs activity, but
  posts no comment and wakes no one, so an agent that carried on or blocked on the request never
  learns the answer. Read from the code, not reproduced.
- **Likely fix:** on reject of a `permission_request`, post the same kind of task comment as
  approve ("Denied: <tool>, <note>"), or wake the requesting agent with the decision when there's
  no task.

### 79. Make the run preview's "writes no files" test ignore other files' temp folders

Reported 2026-11-22 by the CI/DevOps session: CI run 45050025607 (`fix/fresh-continuation-recycled-pid`,
based on `main` at `804b1ccf59`), server (isolated) shard 6/10. Added in step 4b part 2.

- **Problem:** `server/src/__tests__/run-preview.test.ts`, "writes no files, mints no tokens and
  writes nothing to the database", lists the shared `tmpdir()` for `paperclip-claude-home-*` and
  `paperclip-ai-*` folders before and after the preview (`tempHomes`, :122-126; compared at :381).
  Other test files in the same shard run at the same time and create and remove their own
  `paperclip-ai-credential-*` folders there, so the two listings differ (`itW7Zd` against `slnQXT`)
  without the preview writing anything.
- **Likely fix:** give the test a private temp folder (point `TMPDIR` at a fresh folder for the
  preview call, so `tmpdir()` resolves there) and compare that, or compare only names that appear
  after and not before and check none is the preview's. The file's earlier failure (run
  44984434117, shard 10) was a different cause, `invalid reference: HEAD`, fixed before the merge.
- **Since then:** failed again on the same run's attempt 2 (shard 6, the other way round: a folder
  that was there before was gone after).
- **Fixed** (`2789106d6e`, merged as `00e44a3661`), test only. The race was with
  `plugin-task-credential-writeback.test.ts`, which ran in the same shard at the same moment on both
  attempts: its credential folders land in the run's shared `TMPDIR`. The preview call now runs with
  `TMPDIR` pointed at a private folder, and the test expects that folder to be empty. It still
  fails if the preview writes a credential folder (checked with a temporary one), and passed 20
  runs in a row at 2 workers, and 5 alongside the writeback file.

### 80. Give `nested-clone-migration`'s expire-and-restore test room on a loaded CI runner

Reported 2026-11-22 by the CI/DevOps session: CI run 45050025607, server (shared) shard 7/10.
The test is upstream's, not step 4b's (last changed in `d23dd19750`, upstream #17505).

- **Problem:** `server/src/__tests__/nested-clone-migration.test.ts`, "expires and restores a
  converted checkout and protects its unpushed work" (:467), timed out at the 15 s test timeout
  (`server/vitest.config.ts:174`) on a 2-worker CI runner under load. It does several real git
  clones, commits and an expire-and-restore cycle in one test.
- **Likely fix:** a longer timeout for this test (its own `it(..., 45_000)`), or split the
  expire and restore halves. Check `node scripts/ci-flakes.mjs` first for how often it fails.
- **Fixed** (`fc9c76393b`, merged as `ea9ee48c84`), test only. Real git work, no fixed waits: 5–7 s
  alone, 6–14 s on CI's 2-worker shards in 7 green runs, 17.1 s in the failed one. It and the two
  siblings that reach 11 s in CI (the remote-tracking expire, the two-task serialize) get their own
  45 s timeout (`HEAVY_GIT_TEST_TIMEOUT_MS`); the global timeouts are unchanged. Failed once in CI
  since 2026-11-15.

### 81. Make `paperclip-skill-utils` read the skills folder from the repo, not the current directory

Found 2026-11-22 by the CI/DevOps session's agent B (bug 70's fix).

- **Problem:** `server/src/__tests__/paperclip-skill-utils.test.ts` fails 15 tests with `ENOENT` on
  `server/skills/paperclip/SKILL.md` when vitest starts from `server/`, because it reads
  `path.resolve("skills/...")` against `process.cwd()`. It passes from the repo root, which is how
  `scripts/test.mjs` and CI run it, so only a direct `cd server && vitest run …` hits it.
- **Likely fix:** resolve the path from the test file (`import.meta.dirname`) instead of the cwd.

### 82. Time test waits on the monotonic clock: the desktop's wall clock jumps

Found 2026-11-22 by the CI/DevOps session's agent A (bugs 72 and 74).

- **Problem:** on the WSL desktop, time sync steps the wall clock forward about 0.6 s every ~33 s
  (0.8 s under load; the journal logs "Clock change detected" ~110 times an hour idle, ~220 under
  load). `performance.now()` doesn't jump, `Date.now()` does, so a test that bounds a wait with
  `Date.now()` can read it as up to ~1 s longer. That caused bug 74 and part of bug 72, and fits
  `live-recovery-work.test.ts:627` failing once in a local quick run with a deadline 439 ms off. A
  search found 63 other `expect(Date.now() - x).toBeLessThan(...)` bounds in the tests. CI's
  runners don't show it.
- **Likely fix:** move elapsed-time bounds to `performance.now()` as they come up, starting with the
  tight ones (a margin under ~2 s). Not the deadlines that compare against stored timestamps, which
  need the wall clock.

### 83. Stop the runtime service `workspace-runtime`'s sibling test leaves running

Found 2026-11-23 by the CI/DevOps session, listing background processes on the desktop.

- **Problem:** two `node -e "require('node:http').createServer(...)"` servers had been running for
  ~18 h, orphaned (parent `init`), on 127.0.0.1:39829 and :44259, their working folders under
  `/tmp/pt-*/t/paperclip-runtime-sibling-*/project-extended/service` deleted. Their environment
  (`npm_lifecycle_event=test:quick`, `VITEST_WORKER_ID` 149 and 152, `OLDPWD` an agent worktree)
  puts them in step 4b agents' quick runs on the evening of 2026-11-21. They come from
  `server/src/__tests__/workspace-runtime.test.ts`, "does not stop services in sibling directories
  when matching by workspace cwd" (~:5260): it starts a `lifecycle: "shared"` service with
  `stopPolicy: { type: "manual" }` for `execution-workspace-sibling` and ends with only
  `releaseRuntimeServicesForRun`, which doesn't stop a manual-stop shared service. The file's
  `afterEach` then calls `resetRuntimeServicesForTests()` without `terminateProcesses`, which
  clears the registry and leaves the process running. Usually it dies with the vitest worker; these
  two outlived theirs. Stopped by hand on 2026-11-23. Harmless apart from a port and ~40 MB each,
  but they pile up on a machine that runs many quick checks.
- **Likely fix:** end the test by stopping its own service
  (`stopRuntimeServicesForExecutionWorkspace` for `execution-workspace-sibling`, in a `finally`),
  and have the `afterEach` pass `{ terminateProcesses: true }` so no test in the file can leave one.
  Then check the file's other manual-stop services the same way.

### 84. Don't send the string "null" as a no-task run's task brief

Found 2026-11-23 by the step 5 research ([step-5-research.md](step-5-research.md#311-other-findings)).

- **Problem:** a run with no task (an unscoped timer heartbeat, `on_demand` without an issue, an
  approval with no linked task) gets a task-brief section that reads `null`.
  `buildPaperclipTaskMarkdown` returns `null` without an issue (`server/src/services/heartbeat/task-markdown.ts:130`),
  and `task-context.ts:335-351` concatenates it with the prefix and `chatCompletionInstruction`,
  which turns it into the truthy string `"null"`, stored as all four brief variants. Reproduced
  with `tsx`, not seen in a real run. Affects every adapter's no-task runs.
- **Likely fix:** build each variant only when `buildPaperclipTaskMarkdown` returns a string, and
  add a test for a no-task context.

### 85. Say which approval an approval wake is about

Found 2026-11-23 by the step 5 research. **Fixed** for `claude_local` in step 5's wake rework (`feat/step-5-wake`, 2026-11-24, [step-5-wake.md](step-5-wake.md#built)): the wake names the approval, its type, the decision and who made it, and quotes the note; an approval with no linked task gets a wake too. The shared renderer (ACP, dormant adapters) is unchanged.

- **Problem:** `approval_approved` and `approval_cancelled` wakes (`server/src/routes/approvals.ts:235-253, 541-562`)
  put `approvalId` and `approvalStatus` on the run context, but the wake renderer
  (`packages/adapter-utils/src/server-utils.ts:2343-3312`) has no approval section, so the prompt
  shows only `- reason: approval_approved`. The approval's id, type and decision note never reach
  the agent. With no linked task it's a no-task run (bug 84). Read from the code.
- **Likely fix:** render an approval section (id, type, decision, note) in the wake. Step 5's
  wake renderer may take it instead; bug 78 (denied permission requests wake no one) is related.

### 86. Send the chat directive once per chat session, not every turn

Found 2026-11-23 by the step 5 research.

- **Problem:** a hidden-task chat turn's brief carries the 28.6k-character `AGENT_CHAT_DIRECTIVE`
  (`server/src/services/heartbeat/task-markdown.ts:240`). The compact brief used on resumed turns
  doesn't drop it (it doesn't depend on `includeDescription`), so every chat message re-sends
  about 29k characters into a session that already has them.
- **Likely fix:** leave the directive out of the compact variants, or move it to the system prompt
  of chat sessions. Step 5 (prompt builder) or step 6 (first-class chat) may take it instead.

### 87. Store a run's whole prompt, not the first 16,384 characters

Found 2026-11-23 by the step 5 research. **Fixed** in step 5 (merged as `5c3cea6c21`, 2026-11-24): a `claude_local` CLI run's prompt is stored as its own `adapter.prompt` run event, with each section and part kept whole up to 256 KiB, and the run's Input tab reads it. `adapter.invoke`'s `prompt` is still cut at 16 KiB (bug 91 covers the Transcript card that reads it).

- **Problem:** `boundHeartbeatRunEventPayloadForStorage` (`server/src/services/heartbeat/run-log.ts:6-98`)
  cuts every string in a run event's payload at 16,384 characters, including the `adapter.invoke`
  event's `prompt`. A chat turn's prompt (30k and up) is stored cut, so the run view's Input
  (`ui-new/src/runs/RunInput.tsx`) shows only part of what the run received.
- **Likely fix:** exempt `prompt` from the string cap (or give it a larger one), or store the
  rendered prompt as its own run artifact. Decided in step 5's past-run preview.

### 88. Give `claude_local` runs the instruction working-copy guidance

Found 2026-11-23 by the step 5 research. **Fixed** for `claude_local` CLI runs in step 5's system prompt batch (merged as `41427fffda`, 2026-11-25, [step-5-system-prompt.md](step-5-system-prompt.md#built)): the server tells the adapter what kind of instructions copy the run has (`context.paperclipInstructionCopy`), and the first message's instructions line becomes one line naming the agent directory and saying changes are kept. The long note (and the 403 path's note) no longer reaches these runs, with or without a task. ACP and the other adapters still get the long note.

- **Problem:** the instruction working-copy guidance ("Your persistent agent directory is …",
  where the agent can edit its own instruction files) is appended only to `paperclipTaskMarkdown`
  and `paperclipTaskMarkdownCompact` (`server/src/services/heartbeat/instruction-working-copy.ts:221-224`).
  `selectPaperclipTaskMarkdown` prefers the Assignment variants (`server-utils.ts:2272-2275`), so
  runs on a task never get it. The only test (`heartbeat-instruction-working-copy.test.ts:115`,
  extended tier) checks the non-Assignment key. Read from the code.
- **Likely fix:** append it to all four variants, or move it into the prompt builder (step 5).

### 89. Stop prompt texts naming Runner tools and curl recipes runs don't use

Found 2026-11-23 by the step 5 research. **Partly fixed** in step 5's wake rework (`feat/step-5-wake`, 2026-11-24): `claude_local`'s new wake names no REST paths or Runner tools (a test checks), so the comments recipe, the rejected-plan steps and the Runner reviewer text are gone from its runs (the shared renderer, for ACP and the dormant adapters, still has them). The plan-truncation and attachment texts no longer reach `claude_local` CLI runs of non-chat tasks either, since step 5's task brief rework (2026-11-24, [step-5-brief.md](step-5-brief.md#built)): the rejected-plan, cut-plan and attachment rules name `paperclip_read_document`, `paperclip_write_document`, `paperclip_request_plan_review` and `paperclip_file_download`. The chat texts remain. The handoff (with the Runner's tool names) no longer reaches `claude_local` CLI runs on the agent's own task since step 5's handoff rework (2026-11-24, [step-5-handoff.md](step-5-handoff.md#built)); chat tasks still get it. The heartbeat template's connection guidance (`connections_search`, `connection_request`, the Runner's tools) no longer reaches `claude_local` CLI runs since the light sections (2026-11-25, [step-5-light.md](step-5-light.md#built)).

- **Problem:** since step 4a, runs work through the `paperclip_*` MCP tools, but several prompt
  texts still describe other tools:
  - the fresh-session handoff tells the agent to use `get_task_history`, `get_task_context`,
    `list_documents` and `read_document` (`native-session-handoff.ts:28`), the Runner's tool
    names;
  - the rejected-plan steps, the plan-truncation note, the attachment directive, the chat
    directive's "direct HTTP equivalent" paragraphs and the wake's `GET /api/issues/{id}/comments`
    teach REST and curl;
  - the execution-stage reviewer text names "the Paperclip Runner" (`server-utils.ts:3056`).
- **Likely fix:** point each at the `paperclip_*` tool that does the same thing. Mostly step 5's
  template work; the handoff text could be fixed on its own.

### 90. Keep the agent's instructions after Claude compacts a session

Found 2026-11-23 while designing step 5, by testing Claude Code 2.1.325 by hand (`claude --print`,
Haiku, the sealed run's `--strict-mcp-config --setting-sources user`, a throwaway folder). **Fixed** for sealed `claude_local` CLI runs in step 5's system prompt batch (merged as `41427fffda`, 2026-11-25, [step-5-system-prompt.md](step-5-system-prompt.md#built)): `--append-system-prompt-file` goes with resumed runs too. Checked by hand again on 2026-11-25 (2.1.325): after `/compact`, a resume with the file kept the system prompt and one without it lost it. The image installs the latest CLI, so the check is repeated before the deploy.

- **Problem:** Claude saves a session's system prompt when the session starts and restores that
  copy on every `--resume`; a different `--append-system-prompt-file` passed on resume is ignored.
  After a compaction the saved copy is rebuilt on the next call from that call's own flags. A
  sealed CLI run passes `--append-system-prompt-file` only on fresh sessions
  (`packages/adapters/claude-local/src/server/execute.ts:843-847`), so once a session is compacted
  (by Claude's auto-compact during a resumed run, or `/compact`), every later run in it goes without
  the agent's `AGENTS.md` and the company skill-library list. Checked: fresh with the file, then
  `/compact` (with or without the file), then resume without it → the instructions are gone;
  resume with the file on the first call after the compaction → they're back. Auto-compact itself
  wasn't triggered in the test, only `/compact`. Paperclip's own session rotation is off for
  `claude_local`, so long sessions (chat especially) rely on Claude's compaction.
- **Likely fix:** pass `--append-system-prompt-file` on resumed runs too. Before a compaction it's
  ignored, after one it restores the instructions. The run manifest's "instructions sent" row and
  the session's bundle-key check would need to agree with that. Step 5's builder may take it.

### 91. Show a run's whole prompt size in the Transcript tab's prompt card

Found 2026-11-24 by step 5's record agent (Task 6, `step5/record`).

- **Problem:** the run modal's Transcript tab has a "Prompt from Paperclip" card that reports the
  prompt's length from the `adapter.invoke` event's `prompt`, which run event storage cuts at
  16,384 characters. For a longer prompt (every hidden-task chat turn) it shows the cut length.
  Since step 5 the Input tab reads the whole prompt from the `adapter.prompt` record.
- **Likely fix:** have the card read `firstMessageChars` from the `adapter.prompt` record when
  there is one (`ui-new/src/runs/invocation.ts` `readPromptRecord`), falling back to today's
  length for older runs.

### 92. List the whole company skill library in a run's system prompt, as intended

**Fixed** differently for sealed `claude_local` CLI runs in step 5's system prompt batch (merged as `41427fffda`, 2026-11-25, [step-5-system-prompt.md](step-5-system-prompt.md#built)): the system prompt's "Skills" section lists the agent's own skills and says the company library may hold others, which `paperclip_skills` lists. Listing the whole library would have reset every agent's session whenever a company skill was installed. Unsealed runs keep the old list.

Found 2026-11-24 by step 5's real-run check (run `7eb33da7` on TES-43, desktop dev instance) and
traced by the preview agent.

- **Problem:** a `claude_local` run's system prompt ends with a "Company skill library" list, built
  by `buildSkillLibraryManifestMarkdown` in `planClaudeRunSkillsAndInstructions`
  (`packages/adapters/claude-local/src/server/run-plan.ts`). Its comment says it exists to "tell
  the model what the company library actually holds", so an installed skill the agent doesn't have
  isn't mistaken for a missing one; it writes "installed, not enabled for you" lines for those.
  But the heartbeat hands the adapter only the agent's own skills (`prepareSkills` in
  `server/src/services/heartbeat/execution-configuration.ts` selects with
  `resolveLegacyPaperclipDesiredSkillNames`), so every line reads "enabled" and the
  "not enabled" case never appears. The research baseline (step-5-research.md 3.2) described the
  intended behaviour, not this one.
- **Cost of fixing:** the list is in the system prompt, inside the prompt bundle's key, so a fix
  changes every agent's bundle and starts each one's sessions fresh once. Step 5 kept the run as it
  is and made the run preview match it.
- **Likely fix:** pass the whole library's entries to the manifest separately from the mounted
  skills (the mount stays the agent's own), then check the preview still matches. Decide together
  with any other system-prompt change, so sessions reset once.


### 93. A run preview on a finished task fails with a server error

Found 2026-11-24 while mapping the prompt for step 5 phase 2 (desktop dev instance). Candidate.

- **Problem:** `GET /api/agents/:id/run-preview?issueId=<task>&kind=assignment` (or `comment`) on
  a task that is `done` returns 500. `buildExecutionContinuation`
  (`server/src/services/execution-continuation.ts`) throws `StaleExecutionContinuationError`
  (`continuation_task_ownership_changed`) for a done or cancelled task, or one no longer assigned
  to the agent, and the preview doesn't catch it. Seen with TES-43 and "M7 test sealed runner".
- **Effect:** the agent settings' next-run preview shows an error for any finished task instead of
  saying why there's no preview. A real run on such a task is refused at the same point, so the
  run itself is fine.
- **Likely fix:** in `buildRunPreviewPrompt` (`server/src/services/run-preview-prompt.ts`), turn the
  error into a 422 with a code (`task_not_runnable`, say) and a plain message ("This task is done,
  so assigning it wouldn't start a run"), and show it in the preview like `no_comment`.

### 94. An "Other" answer shows its option id in the answer summary

Found 2026-11-24 in the wake's real-run check (run `da19589b`, TES-45, desktop dev instance).
Candidate.

- **Problem:** when the user answers an agent's question with "Other" and types text, the answer
  summary the agent receives reads `…: paperclip_custom_answer, Both, the header dropdown…`.
  `questionAnswerLines` (`server/src/services/question-response-delivery.ts`) maps each selected
  option id to its label, falling back to the id. The free-text option `paperclip_custom_answer`
  isn't in the map it builds, so the raw id is printed before the typed text.
- **Likely fix:** skip the custom-answer option id when the answer has custom text (or map it to
  nothing), so the line reads `…: Both, the header dropdown…`. A test in
  `question-response-delivery.test.ts`.

### 95. A comment an earlier run handled is sent again as new

Found 2026-11-24 in the wake's real-run check (runs `3cca4343` then `da19589b`, TES-45, desktop
dev instance). Candidate.

- **Problem:** `buildExecutionContinuation` (`server/src/services/execution-continuation.ts`) puts
  every origin comment into the record's `resumeDelta`, whether or not the base run already
  delivered it (`originCommentIds.includes(message.id) || !deliveredMessages.some(...)`). The
  origins include the source run's wake comments and an interaction's recorded origins. So after
  an agent asks a question in reply to a comment, the answered-question wake carries that comment
  again, with no "already read" mark.
- **Effect today:** the new `claude_local` wake shows such comments under "Earlier comments",
  marked "(you've seen this)" without a reply rule, so the agent isn't told to act on them twice.
  Other readers of the record (the Runner, ACP) still see them as new.
- **Likely fix:** keep only the current wake's own origin comments in the delta unconditionally;
  include inherited origins only when the base run didn't deliver them. A test in
  `execution-continuation.test.ts`.

### 96. Paperclip doesn't record when Claude compacts a CLI session

Found 2026-11-24 by step 5's task-brief work (the Data agent, `step5-brief/data`). **Fixed** in step 5's bugs batch (merged as `767dbbfad8`, 2026-11-25, [step-5-bugs-96-98.md](step-5-bugs-96-98.md#built)): CLI runs record a `context.compacted` run event from `compact_boundary`, ACP runs from a marker our `claude-agent-acp` patch adds; the run after a compaction resends the description and plan, and the task thread shows the divider (the runs list marks compacted runs). Checked in real runs on TES-50.

- **Problem:** the run transcript's compaction divider and `issue-context-usage.ts` read
  `context.compacted` run events, which only the Paperclip Runner writes. The `claude_local`
  adapter's parsers (`parse.ts`, `execute.ts`, `acp.ts`, `ui/parse-stdout.ts`) don't handle
  Claude's `compact_boundary` stream event, so a CLI run that auto-compacts leaves no record.
- **Effect:** the run message can't tell that a session was compacted, so it doesn't resend the
  description and plan afterwards (`compactedSinceLastRun` is always false), and the transcript
  shows no divider for CLI runs. Related to bug 90 (the system prompt lost after a compaction).
- **Likely fix:** have the `claude_local` parser record a `context.compacted` run event when the
  stream carries `compact_boundary`, then set `compactedSinceLastRun` from it
  (`server/src/services/heartbeat/run-task-facts.ts`).

### 97. Drop the double brackets on the run message's documents line

Found 2026-11-24 in the task brief's real runs (TES-48, desktop dev instance). **Fixed** in step 5's bugs batch (merged as `767dbbfad8`, 2026-11-25, [step-5-bugs-96-98.md](step-5-bugs-96-98.md#built)): `plan ("Compact mode plan", quoted under "The task" below)`, and the brief's form the same way.

- **Problem:** under "Where things stand", a document whose title differs from its key gets its
  title in brackets, and the plan, with the task's facts, gets a second bracket saying where it's
  quoted: `plan ("Compact mode plan") (under "The task" below)`.
- **Likely fix:** fold both into one bracket or move the pointer out of it, for example
  `plan ("Compact mode plan", quoted under "The task" below)`. `renderDocuments` in
  `packages/adapters/claude-local/src/server/wake/where-things-stand.ts` and the
  `documentInTask` template in `wake/templates.ts`, with a case in `wake/render.test.ts`.

### 98. Don't repeat the last run's summary when the agent's comment says the same

Found 2026-11-24 in the task brief's real runs (TES-48, desktop dev instance). **Fixed** in step 5's bugs batch (merged as `767dbbfad8`, 2026-11-25, [step-5-bugs-96-98.md](step-5-bugs-96-98.md#built)): the ending rule says the ending tool's summary is the run's comment, and the next run's message gives one line instead of the summary when that run's comment is quoted below. In real runs each run then posted one comment instead of two.

- **Problem:** "Where things stand" quotes the last run's summary (`history.lastRun`) and then the
  task's comments, which include the comment the agent posted in that run. An agent usually ends a
  run by posting its result as a comment, and the run summary is the same text, so the history
  says it twice and spends the history's 12,000-character budget on it.
- **Likely fix:** when the last run posted a comment, leave the run's summary out (or show only
  its first line) and keep the comment; otherwise keep the summary. Decided on the server, where
  the wake payload's `history` is built, so the comment ids of that run are known; a test with a
  run that commented and one that didn't.

### 99. Agent runs on server1 can't reach Paperclip's MCP server or the GitHub broker

Found 2026-11-25 in Jim's runs on BRA-46 and BRA-47 (server1, the first runs after the step 4a–5
deploy). **Fixed** the same day: `deploy/docker-compose.yml` sets `PAPERCLIP_API_URL` to
`http://localhost:3100`.

- **Problem:** every run started with the `paperclip`, `Paperclip connections` and
  `paperclip-assigned` MCP servers failed (`ECONNREFUSED`), and git printed
  `GitHub broker_transport_unavailable`, so the agent couldn't push, post through the Paperclip
  tools or end the task. The deploy didn't set `PAPERCLIP_API_URL`, so the server derived the
  run-side address from `PAPERCLIP_PUBLIC_URL` (`server/src/index.ts`,
  `choosePrimaryRuntimeApiUrl`): the Tailscale Serve URL, which resolves inside the container to
  the host's tailnet IP and refuses connections from the Docker network.
- **Fix:** runs execute inside the server container, so they use `http://localhost:3100`. Links
  people open still come from `PAPERCLIP_PUBLIC_URL` (`runtimePublicOrigin` prefers it).

### 100. A GitHub connection's shared token never reaches runs

Found 2026-11-25 in Jim's retried run on BRA-47 (server1), once bug 99 let runs reach the broker.
**Fixed** the same day on `github-shared-token`: a shared token is the fallback when nobody has
signed in.

- **Problem:** the GitHub connection on server1 holds one fine-grained token for the whole
  company (an organization grant with a `credentials.authorization` secret). The connection's
  health check uses it and passes, but runs never got it: `resolveManagedGitHubIdentitySelection`
  (`server/src/services/git-credentials.ts`) only considered the agent's own sign-in and the
  responsible person's (GitHub App OAuth grants). Since a company-wide GitHub connection counts as
  configured, the older `GITHUB_TOKEN` fallback was skipped too. So git and gh ran with no
  credential ("No managed GitHub identity is available for this run") and the connector's tools
  failed with `github_identity_unavailable`. Upstream's code, unchanged since the freeze: GitHub
  pushes from runs had never worked on server1.
- **Fix:** with no sign-in of the agent's or the person's, the selection takes the connection's
  shared token (`identitySource: "shared"`); one such token at most, else it refuses. The broker
  gives it to git and gh without the `Bearer ` scheme, and the gateway's connector tools send it as
  the health check does. A token records no GitHub account, so the managed launchers make the agent
  the committer as well as the author, and the run manifest shows "account not recorded (shared)".
  Tests: `server/src/__tests__/github-shared-token.test.ts`.
