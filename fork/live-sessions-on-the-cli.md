# Live sessions on the CLI: notes

Evaluated 2026-11-22 as step 4b part 4 ([decision 9](hard-fork-plan.md#decisions)), then **tabled**.
Step 4b ends with parts 1 to 3. These features move to [step 6](hard-fork-plan.md#6-first-class-chat),
first-class chat, which needs them most. Each comes behind its own switch, so it can be turned on and off.
Permission prompts are kept as an option, to build only if the need comes up.

Nothing here is designed yet. This records what exists, what the CLI offers and what would have to
change, so step 6's design can start from it. File references were read on 2026-11-22, at `b99b1b6c65`.

## Contents

- [The three features](#the-three-features)
- [How it works today](#how-it-works-today)
- [What the CLI offers](#what-the-cli-offers)
- [What would change](#what-would-change)
- [Permission prompts and Paperclip's requests](#permission-prompts-and-paperclips-requests)
- [Questions for step 6's design](#questions-for-step-6s-design)

## The three features

| Feature | What it gives | Who needs it |
| --- | --- | --- |
| **Follow-up messages** | A comment or chat message reaches a running session now, instead of waiting for the run to end or restarting it | Step 6's chat (several messages to one session); also comments on a task mid-run |
| **Streamed text** | Claude's text as it's written, not a whole message at a time | Chat's live reply; the run view |
| **Permission prompts** | Claude asks before an action, Paperclip shows the question, and the run waits for the answer | Not needed yet ([below](#permission-prompts-and-paperclips-requests)) |

## How it works today

**Follow-ups:** a comment on a task while its CLI run is going **waits until the run ends**.

- **Admission defers it.** Same-agent comment wakes on a running task are deferred
  (`shouldDeferFollowupWakeForSameIssue`, `server/src/services/heartbeat/queue.ts:348-360`;
  `decideWakeAdmission`, `server/src/modules/wake-queue/domain/policy.ts:47-64`). They sit in
  `agent_wakeup_requests` as `deferred_issue_execution`, later comments merge into the same row, and
  the row is promoted when the run releases the task (`releaseIssueExecutionAndPromote`).
- **Other wakes are coalesced.** Status changes, reassignments, timers and the like are coalesced
  into the running run. That only merges `contextSnapshot` on the `heartbeat_runs` row
  (`queue.ts:5328-5384`). The CLI process already has its prompt, so the session never sees that
  input. Follow-ups would be the way to deliver it.
- **Interrupt** (`POST /issues/:id/queued-comments/interrupt`, `server/src/routes/issues.ts`)
  cancels the run and starts the queued messages in a new run.
- **Steer exists, Runner only.** `POST /issues/:id/queued-comments/:commentId/steer` calls
  `steerNativeSession` (`server/src/services/native-runtime/native-session-executor.ts`), and
  `decideQueuedCommentQueueSteering` returns `unsupported` for every legacy run
  (`server/src/services/issue-queued-comment-queue.ts:136-171`).
- **ui-new already has the controls.** A countdown steers queued messages
  (`ui-new/src/tasks/composer/auto-steer.ts`). For `unsupported` it offers Interrupt and says "This
  agent's runner can't take messages mid-run" (`ui-new/src/tasks/composer/queue-model.ts:66-74`).
- **ACP never had it either.** The ACP engine starts one turn per run
  (`packages/adapter-utils/src/acpx-engine/execute.ts`, `runtime.startTurn`). acpx says ACP has no
  mid-turn steering, and its `steer` mode only queues behind the active turn.

**Permissions:** every run skips them.

- The CLI is launched with `--dangerously-skip-permissions`
  (`packages/adapters/claude-local/src/server/permissions.ts:12`).
- ACP runs set Claude to ask, and acpx approves everything (`permissionMode: "approve-all"`,
  `acpx-engine/constants.ts:3-4`). Paperclip's `onPermissionRequest` only records the tool call. No
  prompt has ever reached the user.

**Live output:** whole messages, no tool events from the CLI.

- Path: stdout → `onLog` (`packages/adapter-utils/src/server-utils.ts`, `run-output.ts:166-257`),
  stored in `runLogStore` and published as `heartbeat.run.log` over the company WebSocket
  (`server/src/realtime/live-events-ws.ts`).
- ui-new parses stream-json in the browser: `ui-new/src/runs/run-log-source.ts` and `parsers.ts`,
  then `parseClaudeStdoutLine` (`packages/adapters/claude-local/src/ui/parse-stdout.ts`).
- Without `--include-partial-messages`, text arrives one whole message at a time.
- The task page's live status line (`ui-new/src/tasks/LiveRunStatus.tsx`) gets its tool name and
  snippet from `heartbeat.run.event` / `heartbeat.run.progress`. The CLI adapter never calls
  `onEvent`, so for CLI runs the line only says "Last output Xs ago". This is the deferred
  "server-side structured live events" item ([claude-local-run.md §10](claude-local-run.md#10-change-points-for-steps-4-and-5)),
  and it's a small change on its own.

## What the CLI offers

Checked against Claude Code 2.1.325 (`claude --help`) and the Agent SDK's types
(`@anthropic-ai/claude-agent-sdk` 0.3.286, in the tree under ACP, `sdk.d.ts`):

- **`--input-format stream-json`:** stdin stays open for user messages. A message sent mid-turn is
  folded into the running turn. The session emits a `result` after each turn.
- **`--replay-user-messages`:** echoes each user message back, as an acknowledgment.
- **`--permission-prompts host`:** each prompt comes to the host as a `can_use_tool` control request
  on stdout, answered with allow (optionally with changed input or a lasting rule) or deny (with a
  message, optionally interrupting). `none` denies anything that would prompt, without asking.
- **`--permission-mode`:** `default`, `acceptEdits`, `auto` (a classifier approves safe actions),
  `dontAsk`, `plan`, `bypassPermissions`, `manual`.
- **`--include-partial-messages`:** text and tool input as they stream.
- **The control protocol** also has `interrupt` (stop the turn, keep the session) and
  `control_cancel_request` (withdraw a pending prompt).

**Two ways to drive it:** speak the stdio protocol from the CLI adapter, which keeps today's launch
(built as data, portable to other targets), or use the Agent SDK's `query()`, which wraps the same
protocol (`canUseTool`, `streamInput`, `interrupt`) and accepts a custom `spawnClaudeCodeProcess` and
`pathToClaudeCodeExecutable`. That's step 6's call.

## What would change

| Piece | Today | Change |
| --- | --- | --- |
| Launch | Prompt written to stdin, then stdin closed (`runChildProcess`, `server-utils.ts:5101-5127`) | Keep stdin open; send the prompt as a stream-json user message. The `runningProcesses` entry (`server-utils.ts:151`) already holds the child, keyed by run id |
| End of run | Terminal-result cleanup sends SIGTERM 5 s after the first `result` (`server-utils.ts:4984-5047`; `execute.ts:446-449`) | A result ends a turn, not the run. Close stdin at a result when nothing is queued |
| Result parsing | `parseClaudeStreamJson` / `toAdapterResult` expect one result | Sum or take the last result; usage and cost add up across turns |
| Admission | Comment wakes deferred while the run is going | Deliver into the session when the run supports it; defer otherwise |
| Steering | `decideQueuedCommentQueueSteering` returns `unsupported` for legacy runs | `supported` for CLI runs with follow-ups on; write to the child's stdin |
| Stop | SIGTERM to the process group (`run-control.ts`, `cancelRun`) | Could send `interrupt` first, so the session survives a stop |
| Live events | CLI adapter never calls `onEvent` | Emit tool and text events from the stream-json lines |
| ui-new | Steer controls already built; transcript parser handles whole messages | Turn on steering for CLI runs; render partial text |

**Unchanged:** sessions resume across runs (`--resume`), and the sealed launch (part 1) and worktrees
(part 3) stay as they are.

## Permission prompts and Paperclip's requests

The two cover **different actions**. One isn't a stricter version of the other.

| | Step 4a permission requests | Claude permission prompts |
| --- | --- | --- |
| Covers | Paperclip's own tools (`paperclip_*` over MCP), by the agent's access level | Claude's built-in tools: Bash, Edit, Write, WebFetch, and other MCP servers' tools |
| Today | On: a refused call becomes a request in the Inbox (`server/src/services/permission-requests.ts`) | Off: every action is allowed |
| The run | Carries on, or blocks itself; never held | Waits until the prompt is answered |
| On approval | The call is replayed afterwards, as the agent | The action goes ahead inside the run |

**What prompts would add:** a check on what the agent does in the repo and the shell, such as `git
push --force`, deleting files, network calls, or writes outside the worktree. Nothing checks those
today.

**Costs of holding a run:**

- A run waiting on a prompt keeps its process and its claim on the task.
- An unanswered prompt needs a timeout that denies it.
- An action denied mid-run may leave work half done.

**A cheaper step, if a need comes up first:** fixed rules in the sealed run's settings (Claude's
`permissions.deny` and `allow`) with `--permission-prompts none` or `auto` mode. Matching actions are
refused or approved without asking anyone, and no run waits. Prompts through the Inbox could follow.

**Related bug:** [78](upstream-fixes.md#78-tell-the-agent-when-its-permission-request-is-denied).
Denying a step 4a permission request tells nobody, so the agent never learns the answer.

## Questions for step 6's design

- **Switches:** per agent, per project, per chat, or for the whole instance, and what the default is.
- **When a run ends with follow-ups on:** at the first result with nothing queued, or after a short
  wait. Chat may want the session open longer than a task does.
- **Mid-run comments on tasks:** deliver them all, or only when the user chooses Steer (ui-new's
  countdown already offers both).
- **Partial text:** stored in the run log, or sent live only (it multiplies the log's size).
- **Stdio or the Agent SDK** for driving the CLI.
- **Permission prompts:** whether to build them at all, and if so which actions ask, the timeout,
  and whether fixed rules come first.
