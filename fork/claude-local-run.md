# One `claude_local` run, end to end

A trace of a single run of a `claude_local` agent, from the event that wakes it to the run's end,
written as the map for [hard-fork plan](hard-fork-plan.md) steps 4 ("Make runs Claude-native")
and 5 ("One prompt builder"). Traced from the code at `955c81d2f` (2026-11-17, the freeze). All
paths are repo-relative and line numbers are for that commit. For where things live in the repo
generally, see [repo-map.md](repo-map.md).

It covers the legacy path (the server spawns the agent's harness itself). Where the Paperclip
Runner diverges it says so, without tracing it.

## Contents

- [Three ways a Claude agent runs](#three-ways-a-claude-agent-runs)
- [The run in brief](#the-run-in-brief)
- [1. Wake and admission](#1-wake-and-admission)
- [2. Workspace and working folder](#2-workspace-and-working-folder)
- [3. Session](#3-session)
- [4. Prompt assembly](#4-prompt-assembly)
- [5. The exact command](#5-the-exact-command)
- [6. What Claude loads and doesn't](#6-what-claude-loads-and-doesnt)
- [7. How the agent talks to Paperclip](#7-how-the-agent-talks-to-paperclip)
- [8. Live output](#8-live-output)
- [9. Finish](#9-finish)
- [10. Change points for steps 4 and 5](#10-change-points-for-steps-4-and-5)
- [Corrections to other docs](#corrections-to-other-docs)

## Three ways a Claude agent runs

The hard-fork plan describes `claude_local` as `claude --print`. That is only one of three paths a
Claude agent can take, and **not the default one**:

| Path | How it's chosen | What runs |
| --- | --- | --- |
| **Paperclip Runner** | The agent's `adapterType` is `paperclip_runner` (`provider: "acpx"`, `acpxAgent: "claude"`). Decided when the agent is hired or switched, not per run. | The Rust runner daemon and `claude-agent-acp`. Not traced here. |
| **Legacy, ACP engine** (the default) | `adapterType: "claude_local"` and `adapterConfig.engine` unset, `"auto"` or `"acp"` (`packages/adapters/claude-local/src/server/acp.ts:91-96`) | `claude-agent-acp` (the Claude Agent SDK over ACP), driven in-process by the shared ACP engine `packages/adapter-utils/src/acpx-engine/execute.ts` |
| **Legacy, CLI engine** | `adapterType: "claude_local"` and `adapterConfig.engine: "cli"` | `claude --print --output-format stream-json …`, `packages/adapters/claude-local/src/server/execute.ts` |

- The branch is the first thing `execute()` does: `resolveClaudeExecutionEngineForRun`
  (`acp.ts:102-120`), then `if (engineSelection.engine === "acp") return executeClaudeAcp(ctx)`
  (`execute.ts:415-430`). There is no fallback between engines: a missing ACP prerequisite (Node
  ≥24.11.0, the `@agentclientprotocol/claude-agent-acp` package) fails the run with
  `adapter_engine_unavailable` (`execute.ts:416-427`). `filesystemScope`/`networkScope`
  confinement requires `engine: "cli"` (`acp.ts:112-116`).
- The adapter's own doc says so: "engine … defaults to ACP, including legacy unset/"auto" values"
  (`packages/adapters/claude-local/src/index.ts:64`). The hire form only stores `engine` when you
  pick one explicitly (`packages/adapters/claude-local/src/ui/build-config.ts:24-26`).
- **Which path a given agent uses** is visible in each run's `adapter.invoke` event (run modal →
  Input): the CLI engine logs `command: claude` with `--print` args; the ACP engine logs
  `acpx.session` events and a `claude-agent-acp` command.

This document traces the **CLI engine** step by step, since that is the path the plan names, and
marks at each step where the **ACP engine** does something different. Steps 1–3 and 7–9 (server
side) are the same for both engines.

## The run in brief

1. Something calls `enqueueWakeup` (assignment, comment, timer, approval, recovery…). A row goes
   into `agent_wakeup_requests` and a `queued` row into `heartbeat_runs`, or the wake coalesces into
   a running run or is deferred behind the issue's execution lock.
2. The dispatcher claims the run if the agent is invokable, under its `maxConcurrentRuns` (default
   20), within budget and daily caps, and the issue's execution lock is free.
3. `executeRun` resolves the runtime mode (`legacy` for any `claude_local` agent), the session
   (`agent_task_sessions` per agent per issue), the workspace (project checkout, git worktree,
   isolated task folder or agent home) and the task context (task brief, wake payload, handoff).
4. It mints a 48-hour run JWT, builds up to three Paperclip MCP servers, and calls
   `adapter.execute(ctx)`.
5. The adapter builds a content-addressed prompt bundle (agent instructions + company skills),
   decides whether to `--resume`, joins seven prompt sections into the first message, and spawns
   `claude --print --output-format stream-json --verbose --dangerously-skip-permissions
   [--resume <id>] --model … [--append-system-prompt-file …] [--mcp-config … --strict-mcp-config]
   --add-dir <bundle>` in the workspace, with the prompt on stdin.
6. Claude loads user, project and local settings (so the repo's `CLAUDE.md` and `.claude/skills`),
   but only Paperclip's MCP servers when the run is bound to a task. It talks to Paperclip with
   `curl` and `PAPERCLIP_API_KEY`, taught by the `paperclip` skill.
7. Every stdout chunk is appended to the run log file and published as a `heartbeat.run.log` live
   event; the board parses stream-json into a transcript in the browser.
8. When Claude exits (no wall-clock timeout by default), the adapter parses the `result` line and
   returns exit code, usage, session id and summary.
9. The server marks the run succeeded/failed/timed out, saves the session, posts the result text as
   an issue comment if the agent didn't comment itself, releases the issue lock and promotes queued
   wakes.
10. If the issue is still open and assigned with nothing pending, it schedules up to two
    "disposition repair" wakes, then blocks the issue for the board. Nothing requires a finish or
    block call.

## 1. Wake and admission

### What can wake an agent

All wakes go through `enqueueWakeup` (`server/src/services/heartbeat/queue.ts`, public entry
`heartbeat.wakeup` → `trackWakeup`, `queue.ts:2743`, `server/src/services/heartbeat.ts:4586`).
Options are `WakeupOptions` (`server/src/services/heartbeat/run-preparation.ts:795-845`):
`source` (`timer` | `assignment` | `on_demand` | `automation`), `triggerDetail`, a free-form
`reason`, `payload`, `contextSnapshot`, `idempotencyKey`, `allowRunCoalescing`, `manualUserWake`.

| Wake | `reason` / source | Where it's enqueued |
| --- | --- | --- |
| Task assigned (create, child create, PATCH assignee, accepted plan, routine run) | `issue_assigned` / `assignment` | `queueIssueAssignmentWakeup` (`server/src/services/issue-assignment-wakeup.ts:26`, skipped for `backlog`, :49); PATCH at `server/src/routes/issues.ts:17046-17090` |
| Status moved back to `todo` | `issue_status_changed` / `automation` | `routes/issues.ts:17092-17120` |
| Comment | `issue_commented`, `issue_reopened_via_comment` | `routes/issues.ts:20842`, :20873; comments by the assignee don't wake it (`shouldWakeAssigneeForIssueComment`, :20829) |
| @-mention | `issue_comment_mentioned` | **Dropped**: "Mentions only annotate comments" (`queue.ts:2857-2859`) |
| Blockers resolved, children done | `issue_blockers_resolved`, `issue_children_completed` | `routes/issues.ts:17023-17044`, :17329, :20776, :20959 |
| Checkout | `issue_checked_out` | `routes/issues.ts:17615` |
| Timer heartbeat | `heartbeat_timer` / `timer` | `tickAgentTimers` (`server/src/services/heartbeat/scheduling.ts:1353`, enqueue :1364); only when `runtimeConfig.heartbeat.enabled` and `intervalSec > 0` |
| Issue monitors | `issue_monitor_due` etc. | `scheduling.ts:789`, :354, :421 |
| Routine | none of its own: the routine creates a task and wakes its assignee with `issue_assigned` | `server/src/services/routines.ts:2013-2023` |
| Approval decided | `approval_approved`, `approval_cancelled`, `approval_<status>` | `server/src/routes/approvals.ts:500`, :227, :92-97 |
| Run now / retry | body `source`, `retry_failed_run` | `POST /agents/:id/wakeup`, `/heartbeat/invoke` (`server/src/routes/agents.ts:6422`, :6580) |
| Chat (in-app) | `issue_commented` on a conversation issue; dropped unless `enableAgentChat` | `queue.ts:2870` |
| External chat | "External chat message received" | `server/src/services/chat-channels/inbound/wakeups.ts:369`, :547 |
| Recovery | `issue_continuation_needed`, `assignment_recovery`, `issue_disposition_repair`, `issue_blocker_stalled`, … | `server/src/services/recovery/assigned-work-sweep.ts:697`, :775; `recovery/service.ts:3392-3430`; `recovery/blocker-stall-wakeups.ts:386` |
| Others | `interaction_pending`, `case_handoff`, `email_received`, `decision_<outcome>`, `skill_test_run_created`, plugin wakes, deferred-wake promotion | see `grep -rn "reason: \"" server/src` |

### How it's queued

- **Tables:** `agent_wakeup_requests` (`packages/db/src/schema/agent_wakeup_requests.ts:15`) and
  `heartbeat_runs` (`packages/db/src/schema/heartbeat_runs.ts:31`, `contextSnapshot` jsonb :137).
- **Context snapshot:** `enrichWakeContextSnapshot` (`run-preparation.ts:1667-1735`) fills
  `wakeReason`, `issueId`, `taskId`, `taskKey`, `wakeCommentId(s)`, `wakeSource`. It deletes any
  caller-supplied `paperclipWake` (:1709): the wake payload is rebuilt at run time, not stored.
- **With an issue** (`queue.ts:3502`): the issue row is locked `for update`. If another run holds the
  issue's execution lock, `decideWakeAdmission`
  (`server/src/modules/wake-queue/domain/policy.ts:47-64`) either coalesces the wake into the
  running run (same agent, coalescing allowed) or defers it as `deferred_issue_execution`.
  Otherwise a `queued` wake and run are inserted (`queue.ts:5053-5075`, :5150-5186).
- **Without an issue** (`queue.ts:5302-5390`): coalesces into a same-scope queued or running run,
  else inserts.
- After commit: live event `heartbeat.run.queued`, then `startNextQueuedRunForAgent`.

### Admission

At enqueue (`queue.ts`), a wake is skipped or deferred when: scheduling is suppressed (worktree
instance, DB restore, task drain; `heartbeat.ts:859-883`); the company isn't active (:3195);
a budget hard stop applies (`budgets.getInvocationBlock`, :3377; `server/src/services/budgets.ts:805-834`);
the agent is `paused`, `terminated` or `pending_approval` (:3399-3418;
`server/src/services/agent-invokability.ts:50-55`); the heartbeat policy refuses it
(`parseHeartbeatPolicy`, `server/src/services/heartbeat/timer-policy.ts:54-83`: timers need
`heartbeat.enabled`, default false; other wakes need `wakeOnDemand`, default true); an issue-tree
pause holds it (:3446); or a daily cap (`maxDailyRuns`, `maxDailyCostCents`) is reached (:4972, :5403).

At claim (`claimQueuedRunsForAgent`, `queue.ts:2588`; `claimQueuedRun`, :1017):

- **Concurrency:** `availableSlots = policy.maxConcurrentRuns - runningCount` (:2604-2606).
  Default 20 (`AGENT_DEFAULT_MAX_CONCURRENT_RUNS`, `packages/shared/src/constants.ts:84`), from
  `runtimeConfig.heartbeat.maxConcurrentRuns`. No instance-wide numeric cap; a company-level
  automatic-run brake (`server/src/services/recovery/automatic-run-brake.ts:591`) pauses automatic
  work after repeated failures.
- Budget and daily caps are rechecked (:1166-1235); unresolved blockers cancel the run (:1324).
- **Issue execution lock:** `lockIssueExecutionClaim` (:1400-1471) declines if another run holds the
  checkout; `bindClaimedIssueExecution` sets `issues.executionRunId` (:1473-1490).
- In `executeRun` (`heartbeat.ts:1954`), the harness may check the issue out for the agent
  (`shouldAutoCheckoutIssueForWake`, :2420-2444).

### Where legacy vs Runner is decided

- **Per run:** `resolveHeartbeatNativeRuntimeMode` (`heartbeat.ts:3585-3605`, defined in
  `server/src/services/native-runtime/runtime-mode.ts:287-372`). A run that already has a mode keeps
  it. Otherwise `resolveNativeRuntimeMode` (:101) returns `legacy` / `direct_adapter` for **any
  adapter type other than `paperclip_runner`** (:113-124). The mode is persisted on the run
  (`heartbeat_runs.runtimeMode`, written at `server/src/services/heartbeat/runtime-selection.ts:1171-1188`).
- **`enableNativeRunner` doesn't decide it for Claude.** At run time, `paperclip_runner` agents
  with `acpxAgent: "claude"` are exempt from the flag (`runtime-mode.ts:141-150`). At hire time,
  `runner: "auto" | "paperclip" | "legacy"` is a request field (`packages/shared/src/agent-runner.ts:1`),
  resolved by `resolveAgentRunner` (`server/src/services/agent-runner-selection.ts:189-197`):
  `auto` picks the Runner whenever `agentRunnerAvailability` says it's supported (:57-81), which
  depends on the platform and on the `claude_local` and `paperclip_runner` adapter types not being
  disabled, not on the feature flag. A supported hire is rewritten to
  `adapterType: "paperclip_runner"` (`resolveClaudeRunnerConfig`, :150-178).
- So the reliable ways to keep a Claude agent on the legacy path are: choose the legacy runner when
  hiring or in the agent's runtime settings, or disable the `paperclip_runner` adapter type. The
  App settings → Features switch (feature catalog text: "Allow explicitly configured local Codex,
  OpenCode, and qualified ACPX agents…", `packages/shared/src/feature-catalog.ts:58-68`) does not.

### Handoff to the adapter

`executeHeartbeatRuntime` (`server/src/services/heartbeat/runtime-execution.ts:248`, called from
`heartbeat.ts:3688`) splits: `if (nativeRuntimeResolution.kind === "native")` → the Runner (:551);
else `adapter.execute({...})` (:890-971). The adapter is `claudeLocalAdapter`
(`server/src/adapters/registry.ts:287-309`), whose `execute` is wrapped by
`stampClaudeAgentIdHeader` (`server/src/adapters/claude-agent-id-header.ts`), which adds
`X-Anthropic-Agent-Id: <agentId>` to `ANTHROPIC_CUSTOM_HEADERS` in `config.env`.

`AdapterExecutionContext` (`packages/adapter-utils/src/types.ts:237-296`):

| Field | What it is | Built at |
| --- | --- | --- |
| `runtime` | `{sessionId, sessionParams, sessionDisplayId, taskKey}` | `server/src/services/heartbeat/session-preparation.ts:352-357` |
| `config` | The agent's adapter config with secrets resolved, plus `instructionsFilePath`, `paperclipRuntimeSkills`, managed-AI env | `server/src/services/heartbeat/execution-configuration.ts:205-452`; instructions path set in `instruction-working-copy.ts:212` |
| `context` | The run's `contextSnapshot` plus `paperclipWorkspace` (`heartbeat.ts:3351`), `paperclipWorkspaces` (:3369), `paperclipWake` (`task-context.ts:178`), `paperclipTaskMarkdown*` (:369-386), `paperclipTaskCommunicationGuidance` (:229, :388), `paperclipFreshSessionHandoffMarkdown` (`session-preparation.ts:238-243`), `paperclipSessionHandoffMarkdown` (`session-preparation.ts:323-341`), `conversationMode` (`agent-conversations.ts:207`) | `runtime-execution.ts:825-834` |
| `authToken` | The run JWT, legacy runs only | `runtime-execution.ts:275-286` |
| `runtimeMcp` | Paperclip MCP servers for this run | `runtime-execution.ts:852-871` |
| `getFreshSessionHandoff` | Lazy loader for the fresh-session history packet | `session-preparation.ts:218-221` |
| `onLog`, `onMeta`, `onEvent`, `onUsage`, `onSpawn` | Output and process callbacks | `run-output.ts:258`, :309; `runtime-execution.ts:953-966` |

## 2. Workspace and working folder

Order in `executeRun`: workspace mode and policy (`heartbeat.ts:2836`, :2679-2689, :2884) →
environment (:2896) → session (:2936-2950, before the workspace, so a saved session `cwd` can steer
it) → workspace (`prepareHeartbeatWorkspace`, :2951-3000) → `context.paperclipWorkspace` (:3351-3368).

**Mode** (`resolveExecutionWorkspaceMode`, `server/src/services/execution-workspace-policy.ts:381-399`):
the issue's own setting, else the project's execution-workspace policy (`isolated_workspace` →
git worktree, `shared_workspace`, `operator_branch`, `adapter_default`), else shared. Project
policies only apply when the instance setting `enableIsolatedWorkspaces` is on
(`gateProjectExecutionWorkspacePolicy`, :164-170).

**Base folder** (`resolveAnchorWorkspaceForRun`, `server/src/services/heartbeat/workspaces.ts:3469-3734`),
first match wins:

| Case | `cwd` | `source` |
| --- | --- | --- |
| The issue's project has a workspace | The workspace row's `cwd`, or a managed clone at `<instanceRoot>/projects/<companyId>/<projectId>/<repo>` (`workspaces.ts:449-468`, :587-605). A project with workspaces but no usable folder fails the run (:3651-3670). | `project_primary` |
| A saved session `cwd` still exists | That folder (:3673-3693) | `task_session` |
| Agent has `adapterConfig.cwd` | That folder | `task_session` |
| Task without a project | A private folder `<instanceRoot>/isolated-workspaces/<companyId>/<issueId>` (`server/src/services/isolated-task-directory.ts:26-66`) | `task_session` |
| No task, no `cwd` | `<instanceRoot>/workspaces/<agentId>` (`server/src/home-paths.ts:50-56`) | `agent_home` |

`<instanceRoot>` is `$PAPERCLIP_HOME|~/.paperclip` + `/instances/<PAPERCLIP_INSTANCE_ID|default>`
(`packages/shared/src/home-paths.ts:16-35`).

**Per-task worktree:** with a `git_worktree` strategy, `realizeExecutionWorkspace`
(`server/src/services/workspace-runtime.ts:3455`) creates `<repoRoot>/.paperclip/worktrees/<branch>`
(parent overridable with `worktreeParentDir`, branch template default
`{{issue.identifier}}-{{slug}}`, :3528-3542) and binds the issue to an `execution_workspaces` row with
`reuse_existing`, so later runs reuse it (`workspace-preparation.ts:1084-1125`).

**Agent side:** `cwd = effectiveWorkspaceCwd || config.cwd || process.cwd()`, where an
`agent_home` source yields to `config.cwd` (`execute.ts:212-215`, :463-465); the folder is created
if missing (:225).

**What's on disk for a local run:**

| Path | What |
| --- | --- |
| The `cwd` above | The repo, worktree or private folder. Paperclip writes nothing into it on the CLI engine. |
| `<cwd>/.claude/settings.local.json` | **ACP engine only:** written every run (`acpx-engine/execute.ts:1659-1738`, called :2175-2184): allow rules for `curl`, `env` and the paperclip scripts, `additionalDirectories`, and `defaultMode: "dontAsk"` replaced by `"default"`. It edits the repo's own local settings file. |
| `<instanceRoot>/companies/<c>/claude-prompt-cache/<bundleKey>/` | The prompt bundle: `agent-instructions.md` and `.claude/skills/<name>` symlinks (`packages/adapters/claude-local/src/server/prompt-cache.ts:134-174`) |
| `<instanceRoot>/companies/<c>/agents/<a>/claude-runtime/runs/<runId>/mcp/mcp-config.json` | The run's MCP config, mode 0600, bearer tokens inside (`claude-config.ts:156-195`) |
| `<instanceRoot>/companies/<c>/agents/<a>/file-sync/runs/<runId>/live/` | The run's working copy of the agent's instructions folder, exported as `AGENT_HOME` (`server/src/services/agent-directory-working-copies.ts:166-174`; `instruction-working-copy.ts:212-218`). Older sessions use `<cwd>/.paperclip-runtime/instruction-edits-<runId>/instructions` (`agent-instruction-working-copies.ts:157-162`). |
| `<instanceRoot>/workspaces/<agentId>` | Always created (`heartbeat.ts:3363-3367`) and passed as `paperclipWorkspace.agentHome` unless the working copy replaces it |
| `$TMPDIR/paperclip-run-<issue>-<run>-XXXX` | Per-run scratch folder (`heartbeat.ts:3200-3240`; `server/src/services/run-scratch.ts:81-104`) |
| `<instanceRoot>/data/run-logs/<c>/<a>/<runId>.ndjson` | The run log (`server/src/services/run-log-store.ts:334-373`) |

## 3. Session

**Where state lives.**

- `agent_task_sessions` (`packages/db/src/schema/agent_task_sessions.ts:40-45`): one row per
  company, agent, adapter type and **task key**. The task key is `taskKey ?? taskId ?? issueId`
  (`run-preparation.ts:1556-1569`), so a session is per agent per issue; unscoped timer wakes use
  `__heartbeat__` (`server/src/services/heartbeat/run-state.ts:800-811`).
- `agent_runtime_state.sessionId`: one per agent, used only when a run has no task key
  (`session-preparation.ts:281-286`).
- Claude's own transcript: `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<cwd with non-alphanumerics
  as "-">/<sessionId>.jsonl` (encoding mirrored at `execute.ts:1436-1438`).

**What the CLI engine saves** (`execute.ts:1196-1213`): `sessionParams = {sessionId, cwd,
promptBundleKey, mcpServerIdentity, workspaceId?, repoUrl?, repoRef?}`. The server wraps it with a
config fingerprint (`attachPaperclipSessionMetadataToSessionParams`) and upserts it
(`persistSessionState`, `server/src/services/heartbeat/run-completion.ts:521-560`).

**Fresh or resumed.** The server drops the saved session before dispatch when
(`session-preparation.ts:205-206`):

- the wake is `issue_assigned`, `execution_approval_requested`, an execution-review recovery, or an
  unscoped timer, or carries `forceFreshSession` (`shouldResetTaskSessionForWake`,
  `run-state.ts:813-831`). **Every new assignment starts a fresh session.**
- the workspace selection changed (`heartbeat.ts:2346-2361`);
- the effective config fingerprint changed: model, adapter config, runtime config, instructions,
  issue overrides, workspace config, environment, env bindings, secrets or runtime skills
  (`resolveTaskSessionConfigFreshness`, `workspaces.ts:3237-3315`, inputs `session-preparation.ts:88-155`);
- the managed AI credential changed (`session-preparation.ts:210-214`).

`forceFreshSession` comes from run-now with "fresh session", board retry of a failed run (Claude is
a "conversation adapter", `server/src/services/heartbeat/queue.ts:2908-2911`), task retry,
accepted-plan routing and several recovery paths. Manual reset is
`POST /agents/:id/runtime-state/reset-session` (`routes/agents.ts:4449-4460`); chat `/new` resets
a conversation (`server/src/services/agent-conversations.ts:228-278`).

The adapter then refuses `--resume` (`execute.ts:796-824`) when the saved id isn't a UUID, the
**prompt bundle key differs** (any change to instructions or the skill set), the saved `cwd`
differs from this run's, or the execution target differs. A changed MCP server set doesn't block
resume (:819-821). If a resume fails because the session is unknown, poisoned or holds a bad
image, it retries once fresh and clears the saved session (:1408-1455), deleting a poisoned JSONL
(:1434-1453). Max-turns exhaustion also clears it (:1178, :1324-1330).

Session rotation by size or age (`evaluateSessionCompaction`, `run-state.ts:1363-1480`) is off for
`claude_local`: its policy has all thresholds at 0 (`packages/adapter-utils/src/session-compaction.ts:32-37`, :53-57).

**Handoff notes.** Two different context fields:

| Field | What | When |
| --- | --- | --- |
| `paperclipFreshSessionHandoffMarkdown` | "## Fresh session handoff" plus a JSON packet (`paperclip.native-session-handoff.v1`): the original request, up to 10 recent comments, 8 resolved interactions, 4 final agent replies, 3 issue documents, 2 run summaries; ≤24,000 bytes, ≤4,000 chars per entry (`server/src/services/native-runtime/native-session-handoff.ts:8-181`) | **Every fresh session on an issue**, loaded at each attempt (`hydrateFreshSessionHandoff`, `packages/adapter-utils/src/server-utils.ts:2212-2220`), so a failed resume that retries fresh gets it too. This is already the Runner's "recovery handoff", shared with legacy runs. |
| `paperclipSessionHandoffMarkdown` | "Paperclip session handoff:" with the previous session id, rotation reason, last summary and a 1,500-char continuation summary (`run-state.ts:1463-1478`) | Only when rotation fires, which it never does for `claude_local` by default |

**Managed AI connection.** With `runtimeConfig.aiConnection`, `prepareManagedAiRuntime` gives the
run a temporary `HOME` and `CLAUDE_CONFIG_DIR=<home>/provider`
(`server/src/services/ai-connection-runtime.ts:311-326`; `packages/adapter-utils/src/managed-ai-runtime-env.ts:3-14`),
deleted after the run (`heartbeat.ts:4120`). The transcript doesn't survive, so the next
`--resume` fails as unknown and falls back to a fresh session plus the handoff packet (inferred;
no code copies `projects/` back for local runs).

**ACP engine:** sessions are ACP sessions in `stateDir`
(`<instanceRoot>/companies/<c>/acp-engine/agents/<a>`, `acpx-engine/execute.ts:842-844`, :2034),
resumed with `session/load` by `previousParams.acpSessionId` (:4548) when a 17-field fingerprint
matches (:2301-2365), fresh otherwise (:4762-4790).

## 4. Prompt assembly

### Sources

| Source | Where it's built | Carrier (CLI engine) | Fresh only? |
| --- | --- | --- | --- |
| Agent instructions: the bundle's entry file (`AGENTS.md`), plus a skill-library manifest | Per-run working copy (`instruction-working-copy.ts:212`); read and combined at `execute.ts:518-553`; written to the bundle by `prepareClaudePromptBundle` | **System prompt**: `--append-system-prompt-file <bundle>/agent-instructions.md` (`execute.ts:901-903`) | Yes (:898-903) |
| Instructions location note ("Agent instructions for this run were loaded from …; siblings `./HEARTBEAT.md`, `./SOUL.md`, `./TOOLS.md` resolve from …") | `execute.ts:523-528` | First message | No, every turn |
| Bootstrap template | `adapterConfig.bootstrapPromptTemplate`, no default (`execute.ts:863`, :930-933) | First message | Yes |
| Communication guidance | `paperclipTaskCommunicationGuidance`: chat guidance for chat issues plus `FAST_RESPONSE_AGENT_GUIDANCE`, always (`server/src/services/heartbeat/task-context.ts:229`, :388; `packages/shared/src/fast-response.ts:55`) | First message, via `selectInitialCommunicationGuidance` (`server-utils.ts:2222-2230`) | Yes |
| Fresh-session handoff | §3 | Joined into the guidance section | Yes |
| Wake section | `paperclipWake` from `buildPaperclipWakePayload` (`run-preparation.ts:2285`), rendered by `renderPaperclipWakePrompt` (`server-utils.ts:2299-3262`) | First message | No; resumed sessions get a "Paperclip Resume Delta" header instead of "Paperclip Wake Payload" (:2534-2577) |
| Session rotation note | §3 | First message | No |
| Task brief | `buildPaperclipTaskMarkdown` (`server/src/services/heartbeat/task-markdown.ts`), four variants: full, assignment, compact, assignment-compact (`task-context.ts:335-386`), plus the instruction working-copy guidance appended (`instruction-working-copy.ts:220-222`) | First message, via `selectPaperclipTaskMarkdown` (`server-utils.ts:2238-2271`) | Full on fresh, assignment-shaped and recovery wakes; compact (no description) on other resumes |
| Heartbeat template | `adapterConfig.promptTemplate`, default `DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE`: "You are agent {{agent.id}} ({{agent.name}})." plus the connection-tools guidance (`server-utils.ts:214-223`; `packages/shared/src/connection-intent-guidance.ts:8`) | First message | Dropped on resumed sessions that have a wake delta, and on recovery wakes (`execute.ts:938-941`) |
| Company skills | Prompt bundle `.claude/skills/<name>` symlinks (`prompt-cache.ts:146-158`) | `--add-dir <bundle>` (Claude Code lists them as skills) | n/a |

The wake payload has about 30 normalized fields (`normalizePaperclipWakePayload`,
`server-utils.ts:1750-1956`): reason, issue, comments window (ids, bodies, truncation,
`fallbackFetchNeeded`), recovery, execution stage (review/approval role and allowed actions),
continuation summary, plan review, document review, annotation deltas, disposition repair,
liveness continuation, task watchdog mandate, interaction and question responses, checkbox
selection, child summaries, blocker summaries and stalls, tree holds, execution workspace, agent
session message, skill test, external chat provider and contracts, GitHub review configs. After
the body, `renderPaperclipWakePrompt` appends assigned connector skills, connection instructions
and MCP-app context (:2299-2311).

### Order

`execute.ts:943-951`, joined with blank lines by `joinPromptSections` (`server-utils.ts:516-524`):

1. `instructionsPathDirective`
2. rendered bootstrap template (fresh only)
3. communication guidance + fresh-session handoff (fresh only)
4. wake section
5. session rotation note
6. task brief
7. rendered heartbeat template

The whole string goes to `claude` on **stdin** as the first user message (`execute.ts:1007`).
Sizes are recorded as `promptMetrics` (:952-959) in the `adapter.invoke` event.

### Skeleton: a fresh session on an assignment

System prompt (Claude Code's own, then appended):

```text
<Claude Code default system prompt, tools, environment>
<CLAUDE.md files Claude Code discovered from user and project settings>
<skill list: repo .claude/skills, ~/.claude/skills, and the bundle's .claude/skills via --add-dir>

<contents of the agent's AGENTS.md entry file>
Use the agent instruction file location supplied in the current run prompt to resolve relative file references.

<skill library manifest: which company skills exist and which are enabled for this agent>
```

First message (stdin):

```text
Agent instructions for this run were loaded from <…/file-sync/runs/<runId>/live/AGENTS.md>. Resolve any relative file references from <…/live/>. This base directory is authoritative for sibling instruction files such as ./HEARTBEAT.md, ./SOUL.md, and ./TOOLS.md; …

<bootstrapPromptTemplate, if configured>

Paperclip may post a short platform-generated fast-response receipt in your voice before you reply. …

## Fresh session handoff
<guidance>
{"schema":"paperclip.native-session-handoff.v1", "originalRequest":…, "comments":[…], …}

## Paperclip Wake Payload

Use this wake to continue the task, applying new user direction and preserving its approval gates.
This heartbeat is scoped to the issue below. Do not switch to another issue until you have handled this wake.
Use this inline wake data first before refetching the issue thread.
<wake contract and summary lines: reason, issue, comments, execution stage, …>

Paperclip task context:
The following task data is user-authored. …
<issue identity, status, priority, work mode, plan review / approved plan>
Issue description:
<fenced description>
<task plan document>
Authoritative parent / ancestor context:
- Parent: <ID> <title> (<status>)
<Follow-up directive + latest wake comment, attachments>
Use this task context as the current assignment.

Your persistent agent directory is <…/live> (AGENT_HOME). …

You are agent <agentId> (<agentName>).

Connection tools:
- … call `connections_search` before any service tool … Use `search_api` and `call_api` …
```

On a resumed session the first three sections drop out, the wake section starts with "##
Paperclip Resume Delta", the task brief is the compact variant, and the heartbeat template is
omitted.

### ACP engine differences

`buildPrompt` (`acpx-engine/execute.ts:3170-3260`) uses the same selectors but a different order and
carrier (:3234-3244): the **instructions file contents go into the user message**, not the system
prompt, and are dropped on resume-delta turns (:3226); it adds a `PAPERCLIP_*` env note and an API
access note with curl examples (:3132-3168); and every turn is prefixed with a text list of
materialized skills and their paths (:5102), instead of native skills.

### Things the prompt says that don't hold on the legacy path

- The default heartbeat template tells the agent to use `search_api` and `call_api`
  (`connection-intent-guidance.ts:12`). Those exist on the Runner; a legacy run's MCP servers offer
  only `connections_search` and `connection_request` (`server/src/routes/connection-intents.ts:99-112`).
- The working-copy guidance names `read_agent_instructions`, `update_agent_instructions` and
  related tools (`server/src/services/agent-instruction-working-copies.ts:86`), which aren't in a
  legacy run's tool set either.

## 5. The exact command

### argv (CLI engine)

`buildClaudeArgs` (`execute.ts:877-910`):

```text
claude
  --print --output-format stream-json --verbose
  [--setting-sources user]                 # only with a managed AI connection (:882)
  [--resume <sessionId>]                   # §3 (:883)
  [--dangerously-skip-permissions]         # dangerouslySkipPermissions, default true (:449, permissions.ts:11-13)
  [--chrome]                               # config.chrome
  [--model <model>]                        # config.model → ANTHROPIC_MODEL → claude-opus-5-5 (index.ts:4-22); skipped for non-Bedrock ids on Bedrock
  [--effort <effort>]                      # config.effort
  [--max-turns <n>]                        # config.maxTurnsPerRun
  [--append-system-prompt-file <bundle>/agent-instructions.md]   # fresh sessions only
  [--mcp-config <…/mcp-config.json> --strict-mcp-config]         # only when the run has Paperclip MCP servers
  --add-dir <instanceRoot>/companies/<c>/claude-prompt-cache/<bundleKey>
  [...extraArgs]                           # config.extraArgs (or config.args)
```

There is no `--permission-mode`, `--allowedTools` or `--disallowedTools`; permissions are all or
nothing through `--dangerously-skip-permissions`. With `filesystemScope`/`networkScope` the process
is wrapped in Bubblewrap (`execute.ts:588-621`). A model that needs a newer CLI is checked first
(:1334-1387).

### Environment

Built in `buildClaudeRuntimeConfig` (`execute.ts:181-374`) and passed as
`{...process.env, ...env}` (the whole server environment is inherited):

| Variable | Value | Where |
| --- | --- | --- |
| `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_URL` | API URL from `PAPERCLIP_API_URL` / `PAPERCLIP_RUNTIME_API_URL` / listen host:port | `buildPaperclipEnv`, `server-utils.ts:3320-3350` |
| `PAPERCLIP_AGENT_KEY_ID`, `…_PUBLIC_KEY`, `…_PRIVATE_KEY` | Agent identity keys, when issued | `server-utils.ts:3308-3318` |
| `PAPERCLIP_RUN_ID`, `PAPERCLIP_TASK_ID`, `PAPERCLIP_ISSUE_WORK_MODE`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`, `PAPERCLIP_APPROVAL_ID`, `PAPERCLIP_APPROVAL_STATUS`, `PAPERCLIP_LINKED_ISSUE_IDS` | From the context | `execute.ts:229-276` |
| `PAPERCLIP_WORKSPACE_*`, `AGENT_HOME`, `PAPERCLIP_WORKSPACES_JSON`, `PAPERCLIP_RUNTIME_*` | Workspace and runtime services | `applyPaperclipWorkspaceEnv`, `server-utils.ts:3352`; `execute.ts:277-299` |
| `PAPERCLIP_API_KEY` | The run JWT; never accepted from config (`isForbiddenConfigEnvKey`, `server-utils.ts:173-176`) | `execute.ts:319-321` |
| `config.env` entries | Agent env and resolved secrets; runtime `PAPERCLIP_*` keys win | `execute.ts:300-314` |
| `ANTHROPIC_CUSTOM_HEADERS` | `X-Anthropic-Agent-Id: <agentId>` (+ OpenRouter headers) | `claude-agent-id-header.ts`; `execute.ts:316-318` |
| `HOME`, `CLAUDE_CONFIG_DIR` | **Not set**: inherited from the server, unless a managed AI connection, `filesystemScope` or `config.env` sets them | §3; `execute.ts:587`, :613 |
| `IS_SANDBOX=1` | Only for sandbox targets | `permissions.ts:18-23` |
| Removed | `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION`, `CLAUDE_CODE_PARENT_SESSION`, `NOTIFY_SOCKET`, `LISTEN_*` (only these; other `CLAUDE_CODE_*` pass through) | `runChildProcess`, `server-utils.ts:4836-4866` |

On server1, `deploy/docker-compose.yml:80` sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` for the server,
which the CLI engine inherits.

**ACP engine:** inherits only an allowlist from the server (`HOME`, `PATH`, locale, XDG dirs and
Claude provider keys including `CLAUDE_CONFIG_DIR`; `acpx-engine/execute.ts:590-697`), then
`config.env`. So `CLAUDE_CODE_DISABLE_AUTO_MEMORY` and other server-level `CLAUDE_CODE_*` settings
**don't reach ACP runs**.

### Spawn and supervision

- `runAdapterExecutionTargetProcess` (`packages/adapter-utils/src/execution-target.ts:917`) →
  `runChildProcess` for local targets (:980; `server-utils.ts:4805-5124`).
- `spawn(command, args, {cwd, env, detached: true, shell: false})` (:4882-4888): its own process
  group. `onSpawn` records pid and group (:4892-4903; persisted by
  `run-lifecycle.ts:618`). The child is registered in the in-memory `runningProcesses` map (:150).
- The prompt is written to stdin after `onSpawn` settles, then stdin closes (:5052-5066).
- **Timeout:** `config.timeoutSec`, default 0 = none for local runs (`execution-target.ts:623-631`).
  On timeout: SIGTERM to the group, SIGKILL after `graceSec` (default 20) (:4989-5002).
- **After the result line:** once a `result` event is seen, the process gets 5 s
  (`terminalResultCleanupGraceMs`) to exit before it's killed, so background tasks Claude left
  running can't hold the run open (:4931-4987).
- stdout is captured up to 4 MB for parsing (`MAX_CAPTURE_BYTES`, :151).
- Board cancel kills the group through `runningProcesses` (`server/src/services/heartbeat/run-control.ts:1483-1631`).
  A 60 s legacy controller lease, renewed every 10 s, aborts the run if this server loses ownership
  (`server/src/services/legacy-controller-lease.ts:17-18`, :354).

## 6. What Claude loads and doesn't

For the CLI engine on a local target, no managed AI connection, task-bound run (the usual case):

| Thing | Loaded today? | Why |
| --- | --- | --- |
| User settings (`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR`) | Yes | No `--setting-sources`; `HOME`/`CLAUDE_CONFIG_DIR` inherited from the server |
| Project and local settings (`<cwd>/.claude/settings*.json`) | Yes | Same |
| Repo `CLAUDE.md` (and parents up from `cwd`) | Yes, **if `cwd` is the repo** | Depends on the workspace (§2): only `project_primary` or a worktree is inside the repo; isolated task folders and the agent home have none |
| User `~/.claude/CLAUDE.md` | Yes | User source |
| Repo `.claude/skills`, `.claude/agents`, `.claude/commands` | Yes, same condition | Project source |
| User `~/.claude/skills`, plugins | Yes | User source |
| Company skills assigned in Paperclip | Yes | `--add-dir <bundle>` with `.claude/skills` symlinks; always includes `paperclip`, `complain`, `suggestion-box` (`resolveLegacyPaperclipDesiredSkillNames`, `server-utils.ts:4401-4420`) |
| Agent instructions (`AGENTS.md` entry) | Yes, fresh sessions | `--append-system-prompt-file`; siblings (`HEARTBEAT.md`, `SOUL.md`, `TOOLS.md`) only if the agent reads them |
| Paperclip MCP servers | Yes | `--mcp-config` (§7) |
| Repo `.mcp.json`, user MCP servers | **No**, when the run has any Paperclip MCP server | `--strict-mcp-config` (`execute.ts:904-906`). A run with no Paperclip server (no task, no responsible user, no assigned connections) gets neither flag, so they would load. |
| Hooks, permissions, env from settings | Hooks and env yes; permission prompts are bypassed | `--dangerously-skip-permissions` |
| Auto memory | Yes, unless `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` is in the environment; **off on server1** (`deploy/docker-compose.yml:80`) | Inherited env. Memory is keyed by project path, so it differs between the repo, each worktree and private folders. |
| `para-memory-files` | Only if assigned (core skill for CEO hires, `server/src/services/company-skills.ts:687-693`) | A Paperclip skill writing to `$AGENT_HOME` |

How the variants change it:

| Variant | Difference |
| --- | --- |
| Managed AI connection | `--setting-sources user` (`execute.ts:882`) and an empty temporary `CLAUDE_CONFIG_DIR`: no project or local settings, so no repo `CLAUDE.md`, repo skills, user skills or memory; the `--add-dir` skills don't load either (per the earlier CLI test in [repo-instructions-and-skills.md](../ui-new/docs/guides/repo-instructions-and-skills.md)) |
| ACP engine (default) | All three sources even with a managed connection (`PAPERCLIP_ACPX_ISOLATED_CONTEXT` is never set outside the Runner; patch `patches/@agentclientprotocol__claude-agent-acp@0.73.0.patch:213-219`); **no strict MCP**, so repo and user MCP servers load next to Paperclip's; company skills as prompt text, not native skills; writes `<cwd>/.claude/settings.local.json`; auto memory on even on server1 (env allowlist) |
| Paperclip Runner | Empty per-session config folder, user source only, no repo files ([guide](../ui-new/docs/guides/repo-instructions-and-skills.md#paperclip-runner)) |

## 7. How the agent talks to Paperclip

### REST with `curl`

- `PAPERCLIP_API_KEY` is a JWT from `createLocalAgentJwt` (`server/src/agent-auth-jwt.ts:123-164`):
  `sub` agent, `company_id`, `adapter_type`, `run_id`, `responsible_user_id`, optional
  `key_scope` (`skill_test`), `iss`/`aud`/`instance_id`; HS256 with a per-company key derived from
  `PAPERCLIP_AGENT_JWT_SECRET || BETTER_AUTH_SECRET` (:41); TTL `PAPERCLIP_AGENT_JWT_TTL_SECONDS`,
  default 48 h (:52). Without a secret the run gets no key and only a warning
  (`runtime-execution.ts:287-301`).
- `actorMiddleware` (`server/src/middleware/auth.ts:374-526`) verifies it, checks the agent isn't
  terminated or pending, requires `X-Paperclip-Run-Id` to match the token if sent (:439-457), and
  rejects writes from cancelled or superseded runs (:464-474).
- Authority: `assertCompanyAccess` (`server/src/routes/authz.ts:211-239`, including the responsible
  user's membership); issue writes through `assertAgentIssueMutationAllowed`
  (`routes/issues.ts:5941-6092`: another agent's issue needs `tasks:manage_active_checkouts`; the
  agent's own `in_progress` issue needs the run to own the checkout) and comments through
  `assertAgentIssueCommentAllowed` (:5805-5867); checkout only as itself (:17509-17515). Legacy runs
  may PATCH their own status; the Runner-only guard returns early for them (:14829-14858).
- The `paperclip` skill (`skills/paperclip/SKILL.md`, 809 lines; ~4,100 with references) teaches
  the procedure: `GET /api/agents/me`, inbox, `POST /api/issues/{id}/checkout`, heartbeat context,
  work, then comment and status update, every write with `Authorization: Bearer $PAPERCLIP_API_KEY`
  and `X-Paperclip-Run-Id`.

### MCP servers in a legacy run

Built at `runtime-execution.ts:852-871`, written as HTTP servers with a bearer header
(`claude-config.ts:169-195`). In final order:

| Server | When | Auth | Tools |
| --- | --- | --- | --- |
| "Paperclip projects" `<api>/api/mcp/project-tools` | Run token exists, `PAPERCLIP_API_URL` set (always at boot, `server/src/index.ts:1076`), run bound to an issue | The run JWT; requires `source === "agent_jwt"` and a task-bound run (`server/src/services/project-tool-context.ts:12-23`) | `create_project`, `list_project_repositories`, `list_projects`, `create_task`, `set_task_title`, filtered by work mode (`server/src/services/project-tools.ts:6-16`); each re-enters the REST API |
| "Paperclip connections" `<api>/mcp/runtime-tools` | The run has a `responsibleUserId` and a JWT secret (`run-preparation.ts:1237-1269`) | A separate 1 h token, scope `connection_intents` (`server/src/runtime-tools-token.ts:15-67`) | `connections_search`, `connection_request` (`routes/connection-intents.ts:99-112`) |
| "paperclip-assigned" `<api>/mcp/gateways/<id>` | The agent has assigned, healthy tool connections (`run-preparation.ts:905-1225`) | Per-run gateway token, 1 h, revoked at run end | Whatever the connections expose, deny by default |

So a task-bound run nearly always has at least "Paperclip projects", which is enough to trigger
`--strict-mcp-config`. **No legacy run has task tools for comment, status, finish or block**; those
are `curl`. The `paperclip_finish_task`/`paperclip_block_task` tools in the public MCP
(`server/src/services/public-mcp/expanded-capabilities.ts:64-75`) act as a connected person and
aren't given to runs.

## 8. Live output

- **Parsing in the adapter:** `parseClaudeStreamJson` / `createClaudeStreamParser`
  (`packages/adapters/claude-local/src/server/parse.ts:69-200`) read the stream for the `result`
  event, session id, model, usage and cost. Usage checkpoints go to `onUsage` as the run goes
  (`execute.ts:995-1002`). The CLI engine never calls `onEvent`.
- **`onMeta`** (`execute.ts:981-993`) → `onAdapterMeta` (`server/src/services/heartbeat/run-output.ts:309-323`):
  command, args, cwd, env (secrets redacted), the full prompt, prompt metrics and context, stored as
  an `adapter.invoke` row in `heartbeat_run_events` and published as `heartbeat.run.event`
  (`run-lifecycle.ts:2246-2330`). This is the run modal's Input tab (`ui-new/src/runs/invocation.ts:39`).
- **`onLog`** (`run-output.ts:166-257`): each chunk is redacted, sequenced and appended to the run
  log (`<instanceRoot>/data/run-logs/…/<runId>.ndjson`, or S3 segments when configured;
  `run-log-store.ts:576-637`), progress columns on `heartbeat_runs` are flushed every 60 s, and a
  `heartbeat.run.log` live event carries the last 8 KB of the chunk (:238-253).
- **Transcript:** built in the browser, not the server: `parseClaudeStdoutLine`
  (`packages/adapters/claude-local/src/ui/parse-stdout.ts:38`, which also handles ACP lines) is
  registered in `ui-new/src/runs/parsers.ts:44`. History: `GET /heartbeat-runs/:runId/log` and
  `/events` (`routes/agents.ts:7862`, :7831).
- **ACP engine:** emits structured `acpx.*` lines on stdout through the same `onLog`, and runtime
  progress events.

## 9. Finish

### When the run has ended

The run ends when the `claude` process exits (or is killed after the result line, a timeout or a
cancel). The adapter (`toAdapterResult`, `execute.ts:1028-1332`) maps it:

- The `result` event decides success: `subtype === "success"` and not `is_error` is success even
  with a non-zero exit (:1184-1187).
- Error codes in order: transport code, `claude_auth_required`, `model_not_found`,
  `max_turns_exhausted`, `claude_poisoned_previous_message_id`, `provider_quota`,
  `claude_transient_upstream`, `claude_refusal` (:1248-1279), with `errorFamily` and
  `retryNotBefore` for quota and transient errors.
- `summary` is the result text, or the assistant text when there is none (:1323; `parse.ts`).

### What the server does

`completeRun` (`run-completion.ts:440-1117`, called from `heartbeat.ts:3852`):

1. **Outcome** (:450-478): already terminal → keep; aborted → `cancelled`; timed out →
   `timed_out`; exit 0 with no error → `succeeded`; else `failed`.
2. **Session** saved or cleared (`resolveNextSessionState`, `run-state.ts:928-994`;
   `persistSessionState`).
3. Log finalized, usage and cost recorded, terminal status written with excerpts (:577-719),
   liveness classified (`classifyAndPersistRunLiveness`, `server/src/services/run-liveness.ts:300`).
4. **A comment is posted for the agent** when it didn't post one itself:
   `resolveHeartbeatRunResponse` (`server/src/services/heartbeat-run-summary.ts:488-749`) reuses a
   comment created by this run, else takes `resultJson.summary ?? result ?? message` (:613-624),
   unless it starts like narration ("Let me…", "I'll…"); `addComment` posts it as a completion reply
   (`run-completion.ts:905-955`). This happens whatever the outcome.
5. **Missing comment:** for `issue_assigned` and review/approval wakes with no comment at all, one
   `missing_issue_comment` retry run (`finalizeIssueCommentPolicy`, `run-lifecycle.ts:2711-2901`;
   `queue.ts:303-315`).
6. **No automatic status change.** The agent must PATCH the status itself.
7. **Lock release:** `releaseIssueExecutionAndPromote` clears `executionRunId` and `checkoutRunId`
   and promotes deferred wakes (`server/src/modules/wake-queue/application/use-cases.ts:1050-1080`,
   :138-353); for a failed, timed-out or cancelled run on an open issue still assigned to the agent,
   the release tail queues a recovery wake or, for Claude, a `conversation_retry_requested` bounded
   retry (:568-800; `heartbeat.ts:1620-1640`).
8. **Disposition repair** (legacy only): `recovery.reconcileLegacyContinuation`
   (`run-completion.ts:1038-1039`; `server/src/services/recovery/service.ts:4067-4078`). If a
   succeeded run leaves its issue `todo`/`in_progress`, assigned to the same agent, with no active
   run, wait, blocker, approval, pause or budget block, it schedules an `issue_disposition_repair`
   wake whose prompt says "ended without a recorded disposition … A final message alone does not
   record disposition" (`server/src/services/recovery/legacy-continuation.ts:25-30`). At most 2
   attempts; then the issue is set `blocked` with a board-owned recovery action and an "Agent needs
   attention" comment (`service.ts:3854-3960`).

### Failures, timeouts, stalls, restarts

| Case | What happens | Path |
| --- | --- | --- |
| Transient upstream or quota error | Bounded retry, 30 s then 60 s, pushed past `retryNotBefore` (`server/src/services/heartbeat/retries.ts:148-189`, :530+); quota also defers new wakes until the reset (`provider-limit-wait.ts:40-115`) | Both |
| Other failure after work started | No blind retry (`legacy-execution-recovery.ts:61-112`); Claude's conversation-continuation policy and the release tail decide | Legacy |
| Max turns | Bounded continuation only if `runtimeConfig.heartbeat.maxTurnContinuation` (`run-completion.ts:985-1006`) | Both |
| Timeout | Only the adapter's `timeoutSec` (none by default); outcome `timed_out` | Legacy |
| Silent run | Watchdog suspects at 5 min, critical at 15 min, but only kills when the issue is already done/cancelled by this run (`server/src/modules/active-run-watchdog/application/use-cases.ts:332-374`) | Both |
| Lost process | `recoverActiveExecutions` (`server/src/services/heartbeat/recovery.ts:2534-3071`): a live pid with no handle stays `process_detached` (never killed); a dead one becomes `failed`/`process_lost` with one retry (:2956-3039) | Legacy |
| Graceful shutdown | Children killed, run `interrupted`, retry queued (`recovery.ts:1329-1540`) | Legacy (Runner runs are suspended instead) |
| Server crash | First recovery pass after start finds the orphan; the detached `claude` may still be running → `process_detached` | Legacy |
| Hot restart adoption | Detached (CLI engine) runs are left alive and adopted by the new server. An active ACP run is bound to the server's stdio, so it blocks adoption: the server drains and retries instead (`isServerStdioBoundHotRestartRun`, `prepareHotRestartShutdown`, `recovery.ts:481-663`). In Docker a container restart kills every run either way | CLI |
| `semantic_result_missing`, `paperclip_finish`/`paperclip_block`, `finalizeNativeRun`, restart resume, liveness continuation, successful-run handoff | — | **Runner only** (`run-completion.ts:1040-1049`; `heartbeat.ts:3903-3945`; `packages/paperclip-runner/src/contracts/completion-result.ts:2-8`) |

## 10. Change points for steps 4 and 5

"CLI" means `packages/adapters/claude-local/src/server/execute.ts`; "ACP" means
`packages/adapter-utils/src/acpx-engine/execute.ts`. A first decision underlies all of them: **pick
one engine.** The plan assumes the CLI; agents are on ACP unless `engine: "cli"` is set. Either
make `cli` the default (`acp.ts:91-96`, `index.ts:64`, `ui/build-config.ts`) and set it on
server1's agents, or move the plan to ACP. Changing both doubles the work.

| Goal | Where it changes | Risk and what else touches it |
| --- | --- | --- |
| **Run in the project's repo** | `resolveAnchorWorkspaceForRun` (`server/src/services/heartbeat/workspaces.ts:3469-3734`) and its fallbacks (isolated task folder for project-less tasks, agent home); `resolveExecutionWorkspaceMode` and `gateProjectExecutionWorkspacePolicy` (`execution-workspace-policy.ts:164-209`, :381-399) for worktrees by default; `realizeExecutionWorkspace` (`workspace-runtime.ts:3455`) for the worktree location (`<repo>/.paperclip/worktrees`, inside the repo) | A task without a project still has no repo: needs a rule (agent default repo, or a project required). Session resume is keyed on `cwd` (`execute.ts:809-813`), so moving cwd resets sessions once. Shared by every adapter and the Runner. |
| **All setting sources** | Remove `--setting-sources user` (`execute.ts:882`); managed connections also need their own `CLAUDE_CONFIG_DIR` rethought (`ai-connection-runtime.ts:311-326`, the `--setting-sources` ban at :118) | Upstream added it so repo settings can't override managed credentials; if managed connections stay unused, simplest is to not use them. ACP already loads all sources. |
| **Repo `.mcp.json` and the user's MCP servers** | Drop `--strict-mcp-config` (`execute.ts:904-906`) | Project servers need trust: `.mcp.json` servers prompt for approval unless `enableAllProjectMcpServers`/`enabledMcpjsonServers` is set; `--print` can't answer a prompt. Name clashes with Paperclip's servers (`writePaperclipClaudeMcpConfig` dedups only among its own). Resume ignores MCP changes already (:819-821). |
| **Repo skills first; company library optional** | `resolveLegacyPaperclipDesiredSkillNames` (`server-utils.ts:4401-4420`, forces `paperclip`, `complain`, `suggestion-box`); `prepareClaudePromptBundle` and `--add-dir` (`prompt-cache.ts:134-174`; `execute.ts:907`); the manifest appended to instructions (`execute.ts:545-553`) | The bundle key covers skills, so changing the set resets sessions (:802-803). Repo skills already load when cwd is the repo; the work is making the library opt-in and avoiding duplicates by name. ACP uses a separate skill path (`acpx-engine/execute.ts:1158-1250`). |
| **Keep the agent's Claude memory** | Nothing in code disables it; it's `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in `deploy/docker-compose.yml:80`, and memory is keyed by `cwd`. Decide one memory: Claude auto memory (remove the env, keep a stable cwd per agent+repo) vs `para-memory-files` in `$AGENT_HOME` ([decision 5](../ui-new/docs/decisions.md#5-agents-can-have-three-memory-systems-that-dont-know-about-each-other), [upstream-fixes 39](upstream-fixes.md#39-turn-off-claude-codes-auto-memory-when-an-agent-has-para-memory-files)) | Per-task worktrees give each task its own memory folder unless Claude Code groups worktrees by repo; check before relying on it. Managed connections lose memory with their temporary config dir. On ACP, auto memory is on today regardless of the compose setting. |
| **One Paperclip MCP endpoint** | Replace the three servers at `runtime-execution.ts:852-871` with one in-process route modelled on `server/src/routes/project-tools.ts` (already JWT-authenticated, re-enters REST with the same token); tools borrowed from `packages/mcp-server/src/tools.ts` and the Runner catalog (`CAPABILITY_SEMANTIC_TOOL_CATALOG`, used by `project-tools.ts:3`); shrink `skills/paperclip/SKILL.md` and the curl note in ACP (`acpx-engine/execute.ts:3149-3168`) | Authority stays in the REST routes (`assertAgentIssueMutationAllowed` etc.), so the endpoint is a thin layer. Connection tools use a separate token type and route mounted before `actorMiddleware` (`app.ts:605`); folding them in means one auth model. The default heartbeat template's `search_api`/`call_api` lines become true once added. |
| **Finish-or-block** | Add `finish`/`block` tools to that endpoint; enforce in `completeRun` next to `reconcileLegacyContinuation` (`run-completion.ts:1037-1050`), replacing the after-the-fact disposition repair (`recovery/legacy-continuation.ts`, `recovery/service.ts:3392-3430`, :3854-3960) and the auto-comment fallback (`heartbeat-run-summary.ts:613-624`) | Chat turns (`conversationMode`) must stay exempt: they finish with a reply, not a status. The Runner's version is in `run-completion.ts:1040-1049` and `native-session-executor.ts`; borrow the schema, not the code. Recovery sweeps (`reconcileStrandedAssignedIssues`) reuse disposition repair and need to agree with the new rule. |
| **Recovery handoff** | Mostly exists: the fresh-session handoff packet (`native-session-handoff.ts`) already reaches legacy fresh sessions through `hydrateFreshSessionHandoff` (`execute.ts:929`). The gap is the content (no summary of what the previous session did beyond final replies and run summaries) and `paperclipSessionHandoffMarkdown`, which never fires for Claude | Fires on every fresh session, including every new assignment (`run-state.ts:813-831`), so size matters (24 KB cap). Shared with the Runner. |
| **Structured live events** | Already there: stream-json reaches the board as raw log chunks and is parsed in the browser. Server-side events (for search, the transcript API or finish detection) would go in `onLog` handling or a new `onEvent` call from the CLI adapter (`run-output.ts:325-339` already accepts adapter events) | Low risk; the run log format is shared by all adapters. |
| **One prompt builder** | Today's pieces: `execute.ts:928-951` (CLI order), `acpx-engine/execute.ts:3170-3260` (ACP order), `selectPaperclipPromptSections` and the wake renderer (`server-utils.ts:2212-3262`, ~1,050 lines), task brief (`server/src/services/heartbeat/task-markdown.ts`, `task-context.ts`), templates (`server-utils.ts:214-223`, `bootstrapPromptTemplate`, `promptTemplate`), fresh handoff (`native-session-handoff.ts`), instruction working-copy guidance (`instruction-working-copy.ts:220`, `agent-instruction-working-copies.ts:84-87`), skill manifest (`packages/adapter-utils/src/skill-library-manifest.ts`). System prompt = `agent-instructions.md` in the bundle (`prompt-cache.ts:161-166`) | The bundle is content-addressed and its key gates `--resume` (`execute.ts:802-803`), so anything moved into the system prompt (COMPANY.md, project brief) resets sessions when it changes. Per-run paths must stay out of it (comment at `execute.ts:516-517`). The wake renderer is shared with every adapter and the Runner; a new builder can live beside it for `claude_local` only. Many wake kinds come from features this setup doesn't use (external chat, watchdogs, GitHub reviews). |
| **Prompt preview** | Past runs: already stored (`adapter.invoke` event with `prompt` and `promptMetrics`, shown in the run modal Input). Next run: needs a server endpoint that runs task-context preparation (`prepareHeartbeatTaskContext`, `task-context.ts:53`) and the builder without claiming a run or minting a token | Task context preparation has side effects (checkout, working copies, redaction registries); the preview must call a pure subset. |

## Corrections to other docs

**[fork/hard-fork-plan.md](hard-fork-plan.md)**

- "Agents run on the `claude_local` adapter (`claude --print`)": only with `engine: "cli"`; the
  default engine is ACP (`claude-agent-acp`).
- "With `enableNativeRunner` on (the default), an ordinary `claude_local` hire runs on the Runner",
  and step 0 item 2 ("turn off Paperclip Runner in App settings → Features so new hires don't use
  it"): the flag doesn't govern Claude. Hiring with `runner: "auto"` picks the Runner whenever it's
  supported on the platform, flag on or off; Claude Runner runs are exempt from the flag at run
  time. Use the legacy runner choice per agent, or disable the `paperclip_runner` adapter type.
- "`--strict-mcp-config` loads only Paperclip's MCP servers": true, but only when the run has
  Paperclip MCP servers (almost every task-bound run). The ACP engine has no strict mode.
- "Without a project workspace that's the agent's own folder": a task without a project runs in a
  private `isolated-workspaces/<company>/<issue>` folder; the agent home is for runs without a task.
- Agent instructions "fresh sessions only" via `--append-system-prompt-file`: CLI only. ACP puts
  them in the user message.
- The Runner's "recovery handoff" (up to 24 KB) already reaches legacy fresh sessions.
- Run MCP servers are "Paperclip projects", plus "Paperclip connections" when the run has a
  responsible user, plus assigned connections: three, not two.

**[ui-new/docs/guides/repo-instructions-and-skills.md](../ui-new/docs/guides/repo-instructions-and-skills.md)**

- "Legacy login … the adapter runs `claude --print …`" and "Assigned Paperclip skills come in
  through `--add-dir`. The instructions bundle comes in through `--append-system-prompt-file`":
  true for `engine: "cli"` only. On the default ACP engine, skills are copied to
  `<stateDir>/runtime-skills/…` and listed in the prompt text, and instructions go in the user
  message.
- The managed-connection column (❌ for repo `CLAUDE.md` and skills) holds for the CLI engine. On
  ACP no `--setting-sources user` is passed, so project sources load (not tested in a real run).
- "When the task has no project workspace, it starts in the agent's home folder": it starts in
  `adapterConfig.cwd` if set, else a private `isolated-workspaces/<company>/<issue>` folder; the agent
  home only applies to runs without a task.
- The table doesn't say that the ACP engine writes `<cwd>/.claude/settings.local.json` into the repo
  on every run.

**[deploy/README.md](../deploy/README.md)**

- "`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` … reaches `claude_local` agent runs": only on the CLI
  engine; ACP runs inherit an allowlist that excludes it.
