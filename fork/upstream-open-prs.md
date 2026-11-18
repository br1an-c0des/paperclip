# Open upstream pull requests worth taking

Settles hard-fork decision 2, "which open upstream pull requests to take"
([hard-fork plan](hard-fork-plan.md#decisions), step 0 item 4 and step 2). Nothing here has been
taken yet: each one still goes through the [upstream-watch](../.claude/skills/upstream-watch/SKILL.md)
take stage (cherry-pick on a branch, check, approve).

- **Surveyed:** 2026-11-17, against `main` at `2967a1e6d` (upstream `master` at `323504e41`).
- **Open pull requests:** 2,959 (GraphQL listing; `gh pr list` counted 2,960 a few minutes earlier).
- **Shortlist:** 25 pull requests to take now, 4 optional groups, 7 to port by hand, 6 ideas for
  hard-fork steps 4 and 5.

## How they were filtered

| Step | Dropped | Left |
| --- | --- | --- |
| Our own (#17828, #17905, #20710), already in `main` | 3 | 2,956 |
| Drafts | 246 | 2,710 |
| Not updated since 2026-08-19 (90 days). Titles checked for our bug list: only #9588, noted below | 491 | 2,219 |
| Every file in a dormant area: old `ui/` 195, other adapters 105, tests only 104, Runner 77, docs 36, plugins 34, CI 14, lockfile 11, CLI 11, aux packages 10, release 6, Docker 6, cloud/sandbox/chat 3, integrations 2, Claude Managed 1 | 615 | 1,604 |
| Dependency bumps (dependabot) | 25 | 1,579 |
| No source file in code we run (root config, scripts only) | 62 | 1,517 |
| Already in `main` (the merge changes nothing) | 2 | 1,515 |
| Server files only in dormant subsystems (tool access and connections, plugin host, integrations, remote and cloud) | 92 | 1,423 |
| Dormant by title scope or subject (Runner, native, Codex, Hermes, OpenCode, Windows, sandbox, connections, OAuth, GitHub, Slack and similar) | 307 | 1,116 |
| Triaged by title; about 95 read in full (description and diff) | | 1,116 |

Every remaining head was fetched and merged against `main` with `git merge-tree` (merge base: the
pull request's base on upstream `master`): 564 apply cleanly, 1,015 conflict. "Applies" below
means a clean three-way merge. It was not typechecked or tested; that's the take stage's job. The 25
"take now" pull requests were also merged one after another, in number order, to check they apply
together. None of the shortlist carries a migration.

Most of what's left after the filter is small fixes to upstream's recovery, watchdog and heartbeat
machinery: edge cases in states such as review stages, monitors, holds and handoffs, often by
contributors working with agents, and often conflicting. They're skipped unless one of them fixes
something we see.

## Security

| PR | Title | What it fixes | Area | Applies | Migration | Bug list | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#9733](https://github.com/paperclipai/paperclip/pull/9733) | fix(auth): forbid board-key fallback on run-scoped agent requests | A request carrying `x-paperclip-run-id` and a board API key is treated as the board, with board authority and no mutation guard. Run-scoped requests should only authenticate as the agent. | `server/src/middleware/auth.ts` | yes | no | | **Take now**: small privilege-boundary fix |
| [#14310](https://github.com/paperclipai/paperclip/pull/14310) | fix(server): enforce issue-level read authorization on accepted-plan-decompositions | `GET /issues/:id/accepted-plan-decompositions` checks only company membership, not issue read access (confirmed in `main`). | `routes/issues.ts` | yes | no | | **Take now**: 32 lines |
| [#13652](https://github.com/paperclipai/paperclip/pull/13652) | fix: prevent path traversal in agent instructions path | An agent can set its own instructions path to `../…` (or through a symlink it planted) and escape the managed instructions folder. | `routes/agents.ts` | yes | no | | **Take now** |
| [#17503](https://github.com/paperclipai/paperclip/pull/17503) | fix(issues): refuse execution policy stage removal by non-board actors | The assigned agent can `PATCH` its task's execution policy to `stages: []` and so skip its own review. | `routes/issues.ts` | yes | no | related to 38 | **Take now**: closes the agent-side gap |
| [#21669](https://github.com/paperclipai/paperclip/pull/21669) | fix(secrets): mask secret-named environment values in run output | Run logs, excerpts and live events mask secret-bound values but not plain bindings or inherited server env vars whose names say they're secrets. | `server/src/redaction.ts`, heartbeat | yes | no | | **Take now** |
| [#20475](https://github.com/paperclipai/paperclip/pull/20475) + [#18115](https://github.com/paperclipai/paperclip/pull/18115) | command-redaction fixes | `--token "two words"` isn't redacted in logged commands; the escaped-JSON secret regex backtracks catastrophically (26 backslash pairs block the event loop for 19 s). | `adapter-utils/src/command-redaction.ts` | yes | no | | **Take now**: 33 lines together |
| [#16532](https://github.com/paperclipai/paperclip/pull/16532) | fix(shared): make issue-reference extraction linear on long runs | Issue-reference scanning is quadratic on long alphanumeric runs: one 350 KB base64 body held the server for 70 s. Any comment or document can trigger it. | `shared/src/issue-references.ts` | yes | no | | **Take now**; #18284 is a duplicate (skip) |
| [#20040](https://github.com/paperclipai/paperclip/pull/20040) (also #14505, #11797) | fix(adapter-utils): strip server-only secrets from local adapter child env | Local adapters spread `process.env` into the agent's environment, so the agent process inherits `BETTER_AUTH_SECRET` (which also signs agent JWTs), `DATABASE_URL` and similar. In `main` the `claude_local` CLI engine does this (`execute.ts` line 783); the ACP engine uses an allowlist. | `adapter-utils/src/server-utils.ts` | conflicts: `server-utils.ts` | no | | **Port by hand**: worth doing before agents run untrusted code; matters most if decision 0 picks the CLI engine |
| [#10057](https://github.com/paperclipai/paperclip/pull/10057) | fix(auth): reject JWTs after agent runs finish | A run's JWT keeps working after the run ends, until it expires. Checks that the run is still `running`. | `middleware/auth.ts` | conflicts: `auth.ts`, a test, an e2e spec | no | | **Port by hand** after #9733 |
| [#16386](https://github.com/paperclipai/paperclip/pull/16386) | fix(server): redact the run's own API key in the run log | A run that prints its own `PAPERCLIP_API_KEY` (env dump, verbose curl) stores it in the run log. | `agent-identity-redaction.ts`, heartbeat | conflicts: `agent-identity-redaction.ts` | no | | **Port by hand**: 55 lines |
| [#9588](https://github.com/paperclipai/paperclip/pull/9588) | fix: prevent project environment values from leaking through API responses | Project and issue reads return plain env binding values. Stale (July) and conflicting. | projects routes, shared | conflicts | no | near 7 | **Port later**: low risk with one board user |

## Bug fixes in code we run

| PR | Title | What it fixes | Area | Applies | Migration | Bug list | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#9883](https://github.com/paperclipai/paperclip/pull/9883) | fix(projects): allow clearing env bindings | `PATCH /api/projects/:id` with `env: null` answers 422; the fix skips normalization for null in create and update. | `routes/projects.ts` | source yes; test file conflicts (`project-routes-env.test.ts`) | no | **7** | **Take now**: fixes entry 7; merge the test by hand |
| [#21547](https://github.com/paperclipai/paperclip/pull/21547) | fix(acpx): start a fresh conversation when a run has nothing to resume | After session rotation the ACP engine says "starting a fresh session" but loads the stored record anyway, so context grows on every run. | `acpx-engine/` | yes | no | | **Take now**: default engine, token cost |
| [#17982](https://github.com/paperclipai/paperclip/pull/17982) | fix(acpx): start a new session after /new and board session reset | `/new` in chat and the board's "reset session" don't start a new ACP session; the session key ignores the conversation generation. | `acpx-engine/`, `heartbeat/run-state.ts` | yes | no | | **Take now** |
| [#17584](https://github.com/paperclipai/paperclip/pull/17584) | fix(acpx): skip runtime, API access and skill notes on resumed sessions | Every resumed ACP turn repeats the runtime note, API note and skill instructions already in the transcript. | `acpx-engine/execute.ts` | yes | no | | **Take now**: small; step 5 will own this later |
| [#21814](https://github.com/paperclipai/paperclip/pull/21814) | fix(claude): keep ACP safeguard retry notices out of replies | The Claude ACP bridge's safeguard retry notice ends up in the agent's reply text. | `acpx-engine/` | yes | no | | **Take now** |
| [#18110](https://github.com/paperclipai/paperclip/pull/18110) | fix(claude-local): recognise hyphenated 5-hour limit wording as provider quota | "You've hit your 5-hour limit" isn't classed as quota, so the run burns its retries and the task ends blocked instead of waiting for the reset. | `claude-local/src/server/parse.ts` | yes | no | | **Take now**: 13 lines |
| [#19969](https://github.com/paperclipai/paperclip/pull/19969) | fix(heartbeat): keep the newest comments when a wake window is cut | The wake payload keeps the oldest 8 comments, so the comment that woke the agent can be cut. | `heartbeat/run-preparation.ts`, `server-utils.ts` | yes | no | | **Take now** |
| [#18519](https://github.com/paperclipai/paperclip/pull/18519) | fix(heartbeat): cap inlined task plan in wake prompt | The plan document is inlined without a cap; a large plan makes every wake fail with "Prompt is too long". | `heartbeat/task-markdown.ts` | yes | no | | **Take now**; #19474 is a duplicate |
| [#18578](https://github.com/paperclipai/paperclip/pull/18578) | fix(heartbeat): bound stdout/stderr in persisted result_json | Up to 4 MB per stream is copied into `heartbeat_runs.result_json`; bulk reads can exhaust the heap. | heartbeat run completion | yes | no | | **Take now** |
| [#14119](https://github.com/paperclipai/paperclip/pull/14119) | fix(issues): guard recursive issue-tree walks against parent cycles | Five recursive CTEs have no cycle guard, and `update` doesn't check the parent chain: a parent cycle makes the query run forever and fill temp disk. | `services/issues.ts`, `costs.ts`, `execution-workspaces.ts` | yes | no | | **Take now** |
| [#15212](https://github.com/paperclipai/paperclip/pull/15212) | fix(heartbeat): cancel active runs via compare-and-set, not a blind write | Pausing an agent can overwrite a run that was just finishing, which then loses its saved session. | `heartbeat/run-control.ts` | yes | no | | **Take now** |
| [#22104](https://github.com/paperclipai/paperclip/pull/22104) | fix(issues): retry an issue checkout that loses a deadlock | A Postgres deadlock on checkout fails run setup instead of retrying. | `services/issues.ts` | yes | no | | **Take now** |
| [#21656](https://github.com/paperclipai/paperclip/pull/21656) | fix(routines): stop routine dispatch deadlocking the database pool | Routine dispatch holds row locks while waiting on other pool connections; the server can hang (the `lock: true` call is in `main`). | `services/routines.ts` | yes | no | | **Take now**: 29 lines; #21208 is a fuller rewrite of the same path |
| [#21523](https://github.com/paperclipai/paperclip/pull/21523) | fix(server): normalize duplicated X-Paperclip-Run-Id header to prevent 500 | A duplicated or non-UUID run-id header reaches SQL and returns 500 (a comment can be lost). | `middleware/auth.ts` | yes | no | | **Take now**; covers #15914 too |
| [#16706](https://github.com/paperclipai/paperclip/pull/16706) + [#21923](https://github.com/paperclipai/paperclip/pull/21923) | agent deletion fixes | Deleting an agent fails with 500 if it has an open chat or owns a routine. | `agent-deletion.ts`, `routines.ts` | yes | no | | **Take now** |
| [#18277](https://github.com/paperclipai/paperclip/pull/18277) | fix: lock the document row during issue document upsert and restore | Two concurrent document writes both pass the revision check; the loser gets a 500 instead of 409. | `services/documents.ts` | yes | no | | **Take now** |
| [#18487](https://github.com/paperclipai/paperclip/pull/18487) | fix(issues): exclude conversations from task inboxes and search | Chats appear in Inbox → Blocked and task search, and in their counts. | `services/issues.ts` | conflicts: `services/issues.ts` | no | **9** (one of its two options) | **Port by hand** (34 lines), or leave for step 6 (first-class chat) |
| [#17013](https://github.com/paperclipai/paperclip/pull/17013) | fix: classify untyped Claude quota turn errors as provider_quota | On the ACP engine, "you've hit your session limit" thrown as an untyped error isn't classed as quota; dated resets ("Oct 14, 5pm") aren't parsed. | `acpx-engine/`, `claude-local/acp.ts`, `parse.ts` | yes alone; conflicts with #18110 in `parse.ts` | no | | **Port by hand** after #18110 |
| [#21733](https://github.com/paperclipai/paperclip/pull/21733) | fix(heartbeat): keep a saved local session after an empty interrupted result | A failed or cancelled legacy run that saved a checkpoint then deletes it when the adapter returns no session. | `heartbeat/run-completion.ts` | source yes; bundles unrelated Runner test fixtures that conflict | no | | **Port by hand**: take only `run-completion.ts` |

### Optional

- **Claude CLI engine fixes**, worth taking if decision 0 picks the CLI engine: #17766 (a
  `UserPromptSubmit` hook that blocks the prompt is reported as success and its echo posted as the
  reply; matters once runs load repo hooks), #18807 (keep background tasks off in `--print`), #17229
  and #14089 (stop reading `unauthorized` in tool output as "Claude needs login"), #16368 (retry a
  dropped connection). All apply cleanly. #13028 and #16177 (instructions file on resumed sessions)
  conflict in `execute.ts`.
- **Backups:** #20744 (keep JSON values exact) and #16252 (keep CHECK constraints) fix the server's
  JavaScript backup engine, which it uses only when `pg_dump` isn't available. They overlap in
  `backup-lib.ts` (take #20744 first; #16252 then conflicts only in its test); #17080 and #17180
  conflict with them. Check whether the deployed image has `pg_dump` first; the documented manual
  backup (`pg_dump` in the `db` container) isn't affected.
- **#17311** rejects malformed numeric cron fields (`*/2.5` is accepted as `*/2`). Applies.
- **Features:** #21820 adds a `canAskHumans` agent permission (45 lines, applies; `ui-new` would need
  a control). #14584 adds an active-hours window for timer heartbeats (applies; its `ui/` part can be
  dropped).

## Ideas for hard-fork steps 4 and 5

Not to cherry-pick: our own run design will replace this code, but they show what people hit.

- [#14471](https://github.com/paperclipai/paperclip/pull/14471) `inheritHostMcpServers`: drop
  `--strict-mcp-config` so host and repo MCP servers stay (step 4). Conflicts.
- [#16654](https://github.com/paperclipai/paperclip/pull/16654) and
  [#19216](https://github.com/paperclipai/paperclip/pull/19216): load project setting sources so
  skills in `.claude/skills` are found; #19216 adds per-workspace consent for project settings (it
  carries a migration). Step 4.
- [#18762](https://github.com/paperclipai/paperclip/pull/18762): seed operator-managed hooks into
  the ACP engine's `settings.local.json`. Step 4.
- [#21945](https://github.com/paperclipai/paperclip/pull/21945): a stable opening prompt so fresh
  CLI sessions hit the prompt cache (run prompt read from a file). Step 5.
- [#16636](https://github.com/paperclipai/paperclip/pull/16636): the stdio MCP server takes the run
  ID from each tool call, not from startup. Step 4's MCP tools.
- [#13572](https://github.com/paperclipai/paperclip/pull/13572): bearer tokens out of `curl` argv
  in the paperclip skill helpers. Moot once agents use MCP instead of curl.

## Notable skips

- #11798 (don't send `effort` to Claude over ACP): written in August; check whether the current
  `claude-agent-acp` advertises `effort` before changing anything.
- #17920 (set `CLAUDE_CODE_ENTRYPOINT=paperclip` to use less of the 5-hour window): an unverified
  claim, and `main` deliberately strips that variable.
- #21648, #14081, #12222: harden `local_trusted` mode. server1 runs `authenticated`.
- #15539, #18439, #19414: invite-only sign-up and OIDC sign-in. Not needed for one person.
- #8716: serve Markdown attachments as downloads, for upstream's desktop app.
- #21036: fixes a stale `latestBody` in document write responses; `ui-new` doesn't read it.
- #16945: longer MCP gateway token lifetime, for tool connections we don't use.
- No open pull request fixes entries 15, 19, 24, 26, 29, 32, 34 or 39 of the bug list. #14213
  (blocker attention) is near 26 but fixes a different case; #18573 (auto memory) is for managed AI
  connections only.

## Recommendation

1. Take the 25 "take now" pull requests on one `upstream-watch` branch, security first: #9733,
   #14310, #13652, #17503, #21669, #20475, #18115, #16532, then the bug fixes. They merge together
   in number order; #9883 needs its test merged by hand. Run the typecheck and the tests next to each
   changed file. Mark bug list entry 7 fixed.
2. Then port by hand, in this order: #20040 (server secrets in the agent's environment; do it before
   or with step 4), #10057 and #16386 (run credentials), #17013, #21733's server part, and #18487
   unless step 6 is close.
3. Decide on the CLI-engine group together with decision 0; the backups group after checking for
   `pg_dump` in the image.
4. All of this is server code: it reaches server1 only once the deployment builds from source
   (hard-fork step 2).
