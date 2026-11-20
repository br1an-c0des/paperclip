# Upstream watch ledger

The record the [`upstream-watch` skill](../.claude/skills/upstream-watch/SKILL.md) keeps: the last
upstream commit reviewed, and the decision on each candidate, so nothing is reviewed twice. Since the
hard fork ([hard-fork-plan.md](hard-fork-plan.md#watching-upstream)), upstream comes into `main` only
by cherry-pick from these reviews.

- **Freeze point:** `79c8cf8b6` (tag `upstream-freeze`, 2026-11-17)
- **Last reviewed:** `25b5cad7f9` (2026-11-19)
- **Last checked:** 2026-11-19

Decisions: **taken** (with our commit), **skipped** (with the reason), **port later** (a good idea
whose code doesn't fit; becomes a task or a build plan entry), **deferred** (noted, not taken now; re-evaluate in a later review), **pending** (reported, not decided).

"Last reviewed" tracks upstream `master` commits only. Open upstream pull requests aren't on
`master`, so they're tracked by number in the review entries below; each one taken comes in as a
single squashed commit of the pull request's own diff.

## Reviews

### 2026-11-19: upstream `master` since the freeze

Range `79c8cf8b6..25b5cad7f9` (2026-11-17 to 2026-11-19): 153 commits. 118 dropped by the filter:
42 Runner, native, remote or sandbox execution; 33 connectors, connections, plugins, GitHub reviews
or the tool gateway; 17 docs, CI, releases, lockfiles or tests; 15 Cloud, analytics or telemetry;
11 old `ui/` only. None of the 35 candidates carries a migration. Taken on branch
`upstream-watch/2026-11-19`: 6. The other 29 are deferred, to look at again later. "Clean" means
`git merge-tree` against `main` reported no conflicts.

| Commit | PR | Title | Applies | Decision | Notes |
| --- | --- | --- | --- | --- | --- |
| `d702f567bc` | [#22248](https://github.com/paperclipai/paperclip/pull/22248) | fix(recovery): keep a task's lock while its run's executor still settles it | clean | taken `d633392e83` | Provider usage-limit waits resume at the reset instead of stopping on Retry |
| `7eaf38130b` | [#22306](https://github.com/paperclipai/paperclip/pull/22306) | fix(tasks): keep a due automatic retry working while it is dispatched | clean | taken `51101261e5` | No Retry button during the few seconds a due retry is promoted |
| `397f163c7f` | [#22215](https://github.com/paperclipai/paperclip/pull/22215) | fix(issues): show tasks held by a resolved no-replay hold as Blocked | clean | taken `cda857479e` | Pairs with #22245 |
| `6be53f0831` | [#22245](https://github.com/paperclipai/paperclip/pull/22245) | fix(issues): keep a held task blocked when its agent tries to resume it | 1 conflict (`execution-blocker.ts`, 3 lines) | taken `08f775d20c` | Conflict resolved: our tree keeps the freeze-time name `getConversationOwnershipBlocker`, which upstream later renamed; the new `recoveryHoldOnly` switch skips it. |
| `eaac8ed0f7` | [#22222](https://github.com/paperclipai/paperclip/pull/22222) | feat(adapters): add Claude Fable 5.2 and GPT-6.2 with CLI floors | clean | taken `032eab92d4` | claude_local model list, effort levels, CLI floor 2.1.321 |
| `e2cee049f9` | [#19515](https://github.com/paperclipai/paperclip/pull/19515) | fix: show instruction saves in history, credit the real writer, speed up the agent tool-rule list | 1 conflict (a test file) | taken `7d8105ac99` | Test conflict resolved with our `setWriterConfigure` helper. Tests fitted to 4a access levels in `bbca0def57` (the save-history writer gets `agents:configure`; `tool-policy-list-authz` skipped as dormant). |
| `bf55063567` | [#22102](https://github.com/paperclipai/paperclip/pull/22102) | fix(server): keep chat titles current and space verification retries | conflict only in an e2e spec deleted on `main` | deferred | Chat titles follow an agent rename; the retry half is native-runtime |
| `da306ac2da` | [#22177](https://github.com/paperclipai/paperclip/pull/22177) | fix(routines): preserve the manual caller during execution dispatch | clean | deferred | Only matters with several people |
| `84a529df4f` | [#22212](https://github.com/paperclipai/paperclip/pull/22212) | fix(monitors): let low-trust reviewers schedule a self-wake on their own task | clean | deferred | Only if we use `low_trust_review` agents |
| `d668eeb660` | [#22206](https://github.com/paperclipai/paperclip/pull/22206) | fix(runner): keep Claude MCP bearer tokens out of process arguments | clean | deferred | Runner only. claude_local's CLI engine writes MCP config to a 0600 file and passes only its path, so it isn't affected |
| `875e4d375e` | | fix(auth): preserve identity across connection request handoffs | clean | deferred | Connection requests between people; dormant here |
| `78cf5aa81a` | [#22011](https://github.com/paperclipai/paperclip/pull/22011) | feat(public-mcp): let paperclip_create_task assign a person or no one | conflicts with 4a's `capabilities.ts` | deferred | Port by hand if wanted |
| `75ae377438` | [#22228](https://github.com/paperclipai/paperclip/pull/22228) | feat(ui): offer to cancel active subtasks | server part merges, `ui/` part gone | deferred | Idea for ui-new |
| `19a7381398` | [#22358](https://github.com/paperclipai/paperclip/pull/22358) | feat: restore personal archiving in task views | conflicts (`issues.ts`) | deferred | |
| `33fac97cad` | [#22205](https://github.com/paperclipai/paperclip/pull/22205) | feat(routines): ship the redesigned routine page and let live webhooks be tested again | server part merges, `ui/` part gone | deferred | Idea for ui-new's routines |
| `43b2d8be22`, `ffcd49f6aa`, `c0aa7751f8`, `b7319eb581`, `575ef12575` | #22069, #22253, #22261, #22274, #22275 | Areas and responsibilities (dashboard, agent read/write, routines in plain terms, skills under responsibilities) | large | deferred | New multi-person product area |
| `ce27dde855` | [#22077](https://github.com/paperclipai/paperclip/pull/22077) | Start onboarding in chat and defer execution until the user chooses work | large | deferred | |
| `f324238f73` … `87ef7097b6` (13 commits) | #22266–#22332 | wake-queue: move issue admission, locks and steering into `server/src/modules/wake-queue`, plus perf follow-ups | the later ones conflict | deferred | A chain; all or none |
| `f05b90508a` | [#22055](https://github.com/paperclipai/paperclip/pull/22055) | refactor(core): remove retired compatibility paths | 112 files | deferred | |


### 2026-11-17: open pull requests (from the survey in upstream-open-prs.md)

The 25 "take now" pull requests from [upstream-open-prs.md](upstream-open-prs.md), taken on branch
`upstream-watch/2026-11-17` in the survey's order (security first, then by number); that order
applied without conflicts other than #9883's test. 24 taken, 1 skipped. None carries a migration.
All of it is server code: it reaches server1 only once the deployment builds from source
(hard-fork step 2).

| PR | Title | Decision | Commit | Notes |
| --- | --- | --- | --- | --- |
| [#9733](https://github.com/paperclipai/paperclip/pull/9733) | fix(auth): forbid board-key fallback on run-scoped agent requests | taken | `08f14b4fb` | Tests adapted: UUID run IDs (#21523 drops non-UUID headers), `createDbState` for the JWT cases |
| [#14310](https://github.com/paperclipai/paperclip/pull/14310) | fix(server): enforce issue-level read authorization on accepted-plan-decompositions | taken | `9cabf378e` | Test adapted: our tree answers a denied read with 404, not 403 |
| [#13652](https://github.com/paperclipai/paperclip/pull/13652) | fix: prevent path traversal in agent instructions path | **skipped** | | Not needed, and would loosen our tree: `PATCH /agents/:id/instructions-path` is already board-only (since upstream #9206). The PR's net diff removes that check so the agent can set its own path, then confines it to the managed folder. |
| [#17503](https://github.com/paperclipai/paperclip/pull/17503) | fix(issues): refuse execution policy stage removal by non-board actors | taken | `746df1498` | |
| [#21669](https://github.com/paperclipai/paperclip/pull/21669) | fix(secrets): mask secret-named environment values in run output | taken | `8d0fd6e5d` | |
| [#20475](https://github.com/paperclipai/paperclip/pull/20475) | fix(adapter-utils): redact space-separated quoted values of secret CLI options | taken | `cb9d917bf` | |
| [#18115](https://github.com/paperclipai/paperclip/pull/18115) | fix(adapter-utils): make the escaped-JSON secret match atomic | taken | `4bff40426` | |
| [#16532](https://github.com/paperclipai/paperclip/pull/16532) | fix(shared): make issue-reference extraction linear on long runs | taken | `0f50b416e` | |
| [#9883](https://github.com/paperclipai/paperclip/pull/9883) | fix(projects): allow clearing env bindings | taken | `ecce070df` | Test file merged by hand; fixes bug list entry 7 |
| [#14119](https://github.com/paperclipai/paperclip/pull/14119) | fix(issues): guard recursive issue-tree walks against parent cycles | taken | `9893d5c98` | Tests adapted: `allow_nested` policy for the reparent cases, the `issue-privacy-tree` lock name, net-of-cache input tokens |
| [#15212](https://github.com/paperclipai/paperclip/pull/15212) | fix(heartbeat): cancel active runs via compare-and-set, not a blind write | taken | `e8d1f54c6` | |
| [#16706](https://github.com/paperclipai/paperclip/pull/16706) | fix(server): detach open conversations before deleting an agent | taken | `ac63767c6` | |
| [#17584](https://github.com/paperclipai/paperclip/pull/17584) | fix(acpx): skip runtime, API access and skill notes on resumed sessions | taken | `810740e3a` | |
| [#17982](https://github.com/paperclipai/paperclip/pull/17982) | fix(acpx): start a new session after /new and board session reset | taken | `6cd072425` | Test adapted: `conversationState` typed as a literal |
| [#18110](https://github.com/paperclipai/paperclip/pull/18110) | fix(claude-local): recognise hyphenated 5-hour limit wording as provider quota | taken | `85f334a6e` | |
| [#18277](https://github.com/paperclipai/paperclip/pull/18277) | fix: Lock the document row during issue document upsert and restore | taken | `ca40f98b1` | |
| [#18519](https://github.com/paperclipai/paperclip/pull/18519) | fix(heartbeat): cap inlined task plan in wake prompt | taken | `0edb940aa` | |
| [#18578](https://github.com/paperclipai/paperclip/pull/18578) | fix(heartbeat): bound stdout/stderr in persisted result_json | taken | `47c4570af` | |
| [#19969](https://github.com/paperclipai/paperclip/pull/19969) | fix(heartbeat): keep the newest comments when a wake window is cut | taken | `7683d0606` | |
| [#21523](https://github.com/paperclipai/paperclip/pull/21523) | fix(server): normalize duplicated X-Paperclip-Run-Id header to prevent 500 | taken | `ddada3261` | |
| [#21547](https://github.com/paperclipai/paperclip/pull/21547) | fix(acpx): start a fresh conversation when a run has nothing to resume | taken | `0568491e7` | |
| [#21656](https://github.com/paperclipai/paperclip/pull/21656) | fix(routines): stop routine dispatch deadlocking the database pool | taken | `7984a4ccb` | |
| [#21814](https://github.com/paperclipai/paperclip/pull/21814) | fix(claude): keep ACP safeguard retry notices out of replies | taken | `426060573` | |
| [#21923](https://github.com/paperclipai/paperclip/pull/21923) | fix(agents): unassign and pause routines when deleting their agent | taken | `efdd900f6` | |
| [#22104](https://github.com/paperclipai/paperclip/pull/22104) | fix(issues): retry an issue checkout that loses a deadlock instead of failing run setup | taken | `8395033fe` | |

The survey's "port by hand" list (#20040, #10057, #16386, #17013, #21733's server part, #18487) and
its optional groups are still open; nothing from them was taken here.
