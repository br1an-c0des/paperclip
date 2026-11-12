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
| 2 | [Don't crash on Windows when an agent directory path is longer than 260 characters](#2-dont-crash-on-windows-when-an-agent-directory-path-is-longer-than-260-characters) | closed | `fix/agent-directory-probe-long-cwd` | [#17691](https://github.com/paperclipai/paperclip/pull/17691) | | 2026-10-26 | |
| 3 | [Let a pause finish after a restart stopped a legacy run during preparation](#3-let-a-pause-finish-after-a-restart-stopped-a-legacy-run-during-preparation) | closed | `fix/pause-after-restart-during-preparation` | [#17692](https://github.com/paperclipai/paperclip/pull/17692) | | 2026-10-26 | |
| 4 | [Link the plugin SDK on Windows without symlink rights](#4-link-the-plugin-sdk-on-windows-without-symlink-rights) | closed | | | 2026-10-24 | | |
| 5 | [Start `pnpm dev` on Windows when the native runner is enabled](#5-start-pnpm-dev-on-windows-when-the-native-runner-is-enabled) | closed | | | 2026-10-26 | | |
| 6 | [Detect glibc reliably at server startup so Paperclip Runner is offered on Linux](#6-detect-glibc-reliably-at-server-startup-so-paperclip-runner-is-offered-on-linux) | submitted | `fix/runner-libc-probe-startup` | [#17905](https://github.com/paperclipai/paperclip/pull/17905) | 2026-10-26 | 2026-10-27 | |
| 7 | [Accept `env: null` when updating a project](#7-accept-env-null-when-updating-a-project) | candidate | | | 2026-10-27 | | |
| 8 | [Let company search take several assignees, projects or labels](#8-let-company-search-take-several-assignees-projects-or-labels) | candidate | | | 2026-10-28 | | |
| 9 | [Mark agent chats in company search results](#9-mark-agent-chats-in-company-search-results) | candidate | | | 2026-10-28 | | |
| 10 | [Filter cost breakdowns by agent](#10-filter-cost-breakdowns-by-agent) | candidate | | | 2026-10-28 | | |
| 11 | [Filter run summaries by date range and project](#11-filter-run-summaries-by-date-range-and-project) | candidate | | | 2026-10-28 | | |
| 12 | [Say in `/api/health` whether sign-up is allowed](#12-say-in-apihealth-whether-sign-up-is-allowed) | candidate | | | 2026-10-28 | | |
| 13 | [Include `executionBlocker` on compact issues](#13-include-executionblocker-on-compact-issues) | candidate | | | 2026-10-28 | | |
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
| 28 | [Let Claude Runner agents pass verification in the Docker image](#28-let-claude-runner-agents-pass-verification-in-the-docker-image) | submitted | `fix/runner-docker-provider-authority` | [#20710](https://github.com/paperclipai/paperclip/pull/20710) | 2026-11-10 | 2026-11-10 | |
| 29 | [Don't report the agent JWT secret missing when `BETTER_AUTH_SECRET` covers it](#29-dont-report-the-agent-jwt-secret-missing-when-better_auth_secret-covers-it) | candidate | | | 2026-11-12 | | |

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
- **Fork workaround to remove once merged:** carried as the temporary fork patch
  [`runner-libc-probe-sync`](../FORK-PATCHES.md#runner-libc-probe-sync) since 2026-10-27; with it the
  server offers Paperclip Runner here (`supportedRunners: ["paperclip", "legacy"]`).
- **Built 2026-10-27:** `execFileSync` with the same timeout, kill signal and output limit, and no
  top-level await; a test that blocks the event loop for 1.2 s after a real probe; `doc/DEVELOPING.md`
  updated. Targeted tests pass (16, plus 221 in the probe's consumers) and the server typechecks.

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

### 8. Let company search take several assignees, projects or labels

Found by the [M7 parity audit](../ui-new/docs/audit/m7-parity.md#6-api-changes-needed) (2026-10-28).

- **Problem:** `GET /api/companies/:companyId/search` (`server/src/routes/issues.ts`, around line
  8231) takes one assignee, one project and one label, so a search page can't filter by several at
  once.
- **Likely fix:** accept repeated or comma-separated values for each filter, matching how the issue
  list takes them, with a route test.
- **Fork workaround to revisit once merged:** `ui-new`'s search filters take one value each
  ([decision 17](../ui-new/docs/decisions.md#17-search-results-are-shaped-differently-from-board-s1)).

### 9. Mark agent chats in company search results

Found by the M7 parity audit (2026-10-28).

- **Problem:** agent chats are hidden tasks underneath. Search results don't carry their
  `conversationAgentId`, so a chat shows as an ordinary task, and facet counts include chats.
- **Likely fix:** return `conversationAgentId` on task results, or leave chats out unless asked for.
- **Fork workaround to revisit once merged:** search can't show chats as a section
  ([decision 31](../ui-new/docs/decisions.md#31-gaps-found-building-agent-chat)).

### 10. Filter cost breakdowns by agent

Found by the M7 parity audit (2026-10-28).

- **Problem:** `GET /api/companies/:companyId/costs/by-agent` and `/costs/by-agent-model`
  (`server/src/routes/costs.ts`, around line 250) take no agent, so one agent's page fetches the whole
  company's breakdown and filters it.
- **Likely fix:** an optional `?agentId=` on both, with a route test.
- **Fork workaround to revisit once merged:** the agent page filters the company breakdown
  ([decision 29](../ui-new/docs/decisions.md#29-gaps-found-building-the-agent-page)).

### 11. Filter run summaries by date range and project

Found by the M7 parity audit (2026-10-28).

- **Problem:** `GET /api/companies/:companyId/heartbeat-runs?summary=true&limit=1000`
  (`server/src/routes/agents.ts`, around line 6905) has no date range or project filter, so workload
  views fetch up to 1,000 runs and may still miss days.
- **Likely fix:** optional `from`, `to` and `projectId`, with a route test.
- **Fork workaround to revisit once merged:** workload marks the days it couldn't load
  ([decision 28](../ui-new/docs/decisions.md#28-gaps-found-building-agent-workload)).

### 12. Say in `/api/health` whether sign-up is allowed

Found by the M7 parity audit (2026-10-28).

- **Problem:** `PAPERCLIP_AUTH_DISABLE_SIGN_UP` (`server/src/config.ts`) isn't reported by
  `/api/health`, so a sign-in page can't tell whether to offer sign-up.
- **Likely fix:** add a boolean to the health response, next to the other auth fields, with a test.
- **Fork workaround to revisit once merged:** `ui-new` always offers sign-up
  ([decision 36](../ui-new/docs/decisions.md#36-gaps-found-building-onboarding-and-the-pages-outside-a-company)).

### 13. Include `executionBlocker` on compact issues

Found by the M7 parity audit (2026-10-28).

- **Problem:** `CompactIssue` (`packages/shared/src/types/issue.ts`, around line 961) leaves out
  `executionBlocker`, so a list row can't tell why an interrupted task is blocked before offering
  Retry.
- **Likely fix:** add the field to the compact pick and the compact list query, with a test.
- **Fork workaround to revisit once merged:** Retry on list rows reads the interruption's run.

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
- **Fork workaround:** none in code. On the deployment, put Claude agents on the legacy runner
  (with `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` as a company secret if the AI connection
  isn't enough) until a fixed upstream image is synced and deployed; then move them back.
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
- **Submitted 2026-11-10** as [#20710](https://github.com/paperclipai/paperclip/pull/20710). Once
  merged and in a published image: sync, redeploy, and move Claude agents back to the Paperclip Runner.

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

