# Step 5 ("One prompt builder"): research baseline

Read-only research on `main` at `d30fde59f5` (2026-11-23), desktop (`BrianDesktop`). Paths are
relative to `/home/brian/coding/paperclip`.

**Labels.** **[V]** = verified: I read the code (or ran a pure function in a scratch script).
**[I]** = inferred: from names, comments, docs or a partial read. Explore subagents swept the wake
renderer, the `ui/` leftovers and the consumers. I re-read the load-bearing parts myself. Claims
resting only on a subagent's read are marked [I].

**Limits.**
- The desktop's dev instance wasn't running (`curl localhost:3100/api/health` failed, and nothing
  listened on Postgres), so I read no stored `adapter.invoke` prompts.
- The run logs on disk (`~/.paperclip/instances/default/data/run-logs/`) hold Claude's stream
  output, not the prompt.
- Sizes come from the constants, measured with `tsx` against the source (throwaway scratch
  scripts, not kept), and from rendering the shared test fixture.

---

## 1. Summary

**Pieces.** A `claude_local` CLI run's first message is joined in
`packages/adapters/claude-local/src/server/execute.ts:945-954` from **8 sections** (it was 7 at the
freeze; 4b added the MCP note). The system prompt holds the agent's `AGENTS.md` plus a company
skill-library manifest. The text comes from about a dozen sources in four packages:
- adapter: the directive, the MCP note and the templates;
- `adapter-utils`: the wake renderer and the selectors;
- server: the payload builder, the task brief, the handoff, the communication guidance, the working
  copy, connector and app text, chat directives, cases and voice;
- `shared`: the fast-response text and the connection guidance.

The server assembles the context across at least six heartbeat stages
(`server/src/services/heartbeat.ts:2253-3404`).

**What a run gets, by kind.**
- **Typical sizes.**
  - A minimal fresh assignment is about 7–8k characters before Claude Code's own system prompt.
  - A chat turn adds the 28.6k-character `AGENT_CHAT_DIRECTIVE` to the task brief. It is sent
    again on **every resumed chat turn**, because the compact brief keeps it.
  - On comment-heavy tasks, the wake's "continuation context" holds **every comment on the task as
    JSON, uncapped**.
- **No-task runs** (timer, or an approval with no linked task) get a task-brief section that is the
  literal string `"null"`. This comes from string concatenation with `null` in
  `task-context.ts:335` [V, reproduced].
- **Approval wakes** render only `- reason: approval_approved`. Which approval it was, and the
  decision note, never reach the prompt [V].

**Sessions.**
- A session is one per agent per task key (`taskKey ?? taskId ?? issueId`) per adapter type.
- `--resume` is refused when:
  - the prompt bundle key changes: the instructions content, the skill set, **or any change to the
    company's skill library**, since the manifest lists the whole library;
  - the cwd changes;
  - the target changes.
- The server also resets on:
  - a config-fingerprint change, which covers `adapterConfig` and so `promptTemplate`;
  - `issue_assigned` and three other wake reasons;
  - `forceFreshSession`;
  - a workspace change;
  - a credential change.
- On a resumed session the CLI does **not** pass `--append-system-prompt-file`. The code assumes
  the appended system prompt carries over with `--resume`. **That assumption is unverified and
  high-impact** for putting COMPANY.md or a project brief in the system prompt (section 3.2.6).

**The wake renderer.**
- It handles about 33 sections in roughly 970 lines (`server-utils.ts:2343-3312`), plus 3 appended
  by a wrapper.
- About 10 can't fire here:
  - external chat (3 variants);
  - external interaction continuation;
  - GitHub review instructions;
  - plan annotation deltas, which have no production producer;
  - connector skills, connection instructions and MCP-app context;
  - plugin agent messages.
- The live heavy sections overlap:
  - execution continuation;
  - continuation summary;
  - new comments;
  - plan and document review;
  - the fresh-session handoff.

**The task brief.**
- It overlaps heavily with `paperclip_task_context`, which runs are told to call first.
- Several texts still teach REST and curl, or name Runner-only tools.
- The instruction working-copy guidance ("Your persistent agent directory is…") is appended only to
  the variants `claude_local` **doesn't read**, so it never reaches the CLI prompt [V by reading].

**Preview.**
- `prepareHeartbeatTaskContext` itself writes nothing to the database. Its only side effect is
  mutating the in-memory `context` [V].
- But the prompt depends on fields patched in by later stages:
  - the checkout flag;
  - the branch guard;
  - connector and app text;
  - the fresh handoff;
  - the working copy;
  - `questionResponse`, added at dispatch.
- Stored past prompts are cut at **16,384 characters** (`run-log.ts:7`), so the "past run" view
  is incomplete for any chat turn.

**Leftovers.**
- 5 route-check tests are skipped, and 7 route assertions were deleted from running tests.
- `ui-new` kept the old URL shapes and redirects most of them, so most links still land.
- The real gaps:
  - `board-chat`;
  - `design-guide`;
  - `dev/task-chat-lab`;
  - `ux-lab/*`;
  - `?triggerSetup=` (dropped);
  - `/settings/access` (goes to the wrong section);
  - `/decisions?decisionId=` (loses the id).
- `skills/paperclip-board/SKILL.md` is a 633-line curl manual. Its only server reader is the
  Conference Room endpoint, which has no UI.

---

## 2. The current architecture

```text
 wake request ──► heartbeat.executeRun (server/src/services/heartbeat.ts)
   2253 prepareChatCompletionTurn ─► context.chatCompletionUpdates
   2262 prepareConversationTurn    ─► context.conversationMode, generation
   2390/2436 issue checkout        ─► context.paperclipHarnessCheckedOut (2405, 2442-2445)
   2875 prepareHeartbeatTaskContext (heartbeat/task-context.ts:53)
        ├─ buildExecutionContinuation  ─► context.executionContinuation
        ├─ buildPaperclipWakePayload   ─► context.paperclipWake   (run-preparation.ts:2355)
        ├─ buildPaperclipTaskMarkdown ×4 ─► paperclipTaskMarkdown{,Compact,Assignment,AssignmentCompact}
        │     (+ live-voice prefix + case markdown + chatCompletionInstruction)
        ├─ communication guidance (chat guidance + FAST_RESPONSE) ─► paperclipTaskCommunicationGuidance
        └─ redactForIssue (registered secrets) on all of the above
   2908 prepareHeartbeatExecutionConfiguration ─► paperclipWake.{connectorSkillInstructions,
        connectionInstructions, mcpAppContext} (execution-configuration.ts:444-455)
   2934 prepareHeartbeatSession ─► fresh handoff (session-preparation.ts:237-240), resets
   2949 prepareHeartbeatWorkspace ─► instruction working copy: appends guidance to
        paperclipTaskMarkdown{,Compact} only (heartbeat/instruction-working-copy.ts:221-224)
   ~3397-3407 paperclipWake.executionWorkspace.branchName patched in
   runtime-execution.ts:805-834 ─► paperclipWake.questionResponse (dispatch-time, not saved)
        │
        ▼
 claude_local execute.ts  (CLI engine, default since 4b)
   run-plan.ts:508-568  instructions file + skill manifest ─► prompt bundle (prompt-cache.ts)
        └─ <bundle>/agent-instructions.md ─► --append-system-prompt-file (fresh only, :843-847)
   runAttempt (:925-962)
        hydrateFreshSessionHandoff ─► selectPaperclipPromptSections (server-utils.ts:2303)
           ├─ selectPaperclipTaskMarkdown (2268) ─► taskContextNote
           └─ renderPaperclipWakePrompt (2329) ─► wakePrompt
        joinPromptSections([directive, bootstrap, guidance+handoff, wake,
                            rotationNote, taskBrief, mcpNote, heartbeatTemplate])
        onMeta(adapter.invoke {prompt, promptMetrics, context, runManifest})
        stdin ◄── prompt  (:1020)
```

ACP (`engine: "acp"`, dormant here) builds its own prompt in
`packages/adapter-utils/src/acpx-engine/execute.ts:3154-3242` from the same selectors (section 6).

---

## 3. Findings

### 3.1 The prompt today, end to end (CLI engine)

**The join** (`execute.ts:925-954`) [V]:

| # | Section | Source | Included when |
|---|---|---|---|
| 1 | Instructions path directive ("Agent instructions for this run were loaded from …; resolve … ./HEARTBEAT.md, ./SOUL.md, ./TOOLS.md …") | `run-plan.ts:520-530` | Whenever the instructions file was read: **every turn, resumed ones too** |
| 2 | Bootstrap template | `config.bootstrapPromptTemplate` rendered with `renderTemplate` (`execute.ts:812, 927-930`) | Fresh session and non-blank. New agents can't set it (`routes/agents.ts:2497-2507`) |
| 3 | Communication guidance + fresh-session handoff | `selectInitialCommunicationGuidance` (`server-utils.ts:2252-2260`), joining `paperclipTaskCommunicationGuidance` and `paperclipFreshSessionHandoffMarkdown` | Fresh session only |
| 4 | Wake section | `renderPaperclipWakePrompt(context.paperclipWake)` | Whenever a wake payload exists. The "Resume Delta" header is used on resumed sessions |
| 5 | Session rotation note | `context.paperclipSessionHandoffMarkdown` | Only when rotation fires. **Never for `claude_local`**: all thresholds are 0 (`adapter-utils/src/session-compaction.ts`) |
| 6 | Task brief | `selectPaperclipTaskMarkdown`: the **Assignment** variants first (`server-utils.ts:2275-2294`) | Fresh, assignment-shaped and recovery wakes get the full brief; other resumes get the compact one |
| 7 | MCP note (333 chars) | `renderPaperclipMcpNote(env, true)` (`execute.ts:941-944`) | Sealed, fresh, and not an external chat turn |
| 8 | Heartbeat template | `config.promptTemplate`, or the default `DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE` (2,667 chars: "You are agent {{id}} ({{name}})." + `CONNECTION_INTENT_AGENT_GUIDANCE`) | Dropped on a resumed session that has a wake, and on recovery wakes (`execute.ts:933-935`). Kept on resumed sessions **without** a wake |

**Notes on the join.**
- `promptMetrics` (`execute.ts:955-962`) records totals for bootstrap, wake, handoff note, task
  context and heartbeat. It does **not** separate the directive, the guidance/handoff or the MCP
  note. `sessionHandoffChars` measures section 5 (rotation), not the fresh handoff [V].
- System prompt (fresh only): Claude Code's own, then `<bundle>/agent-instructions.md` [V]. That
  file holds:
  - the `AGENTS.md` entry file;
  - "Use the agent instruction file location supplied in the current run prompt…";
  - "## Company skill library", listing **every** library skill as enabled, "installed, not enabled
    for you" or unavailable (`run-plan.ts:531-549`, `skill-library-manifest.ts:30-58`).

  Skills load through `--plugin-dir <bundle>/plugins` and the run's `project` plugin. The repo's
  `CLAUDE.md` is added through `--add-dir` behind the project switch (`execute.ts:849-856`).

**Fixed text sizes** (measured with tsx) [V]:

| Text | Chars |
|---|---|
| `AGENT_CHAT_DIRECTIVE` (chat brief) | 28,579 |
| `DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE` (= conversation template) | 2,667 |
| `CONNECTION_INTENT_AGENT_GUIDANCE` (inside the above) | 2,621 |
| `WATCHDOG_DEFAULT_MANDATE` | 2,858 |
| `STATUS_CARDS_CHAT_DIRECTIVE` / `COORDINATOR_…` / `CASES_…` / `CONFERENCE_ROOM_…` | 1,945 / 1,371 / 1,177 / 876 |
| `TASK_QUESTION_GUIDANCE` (in every task brief) | 998 |
| Working-copy guidance (agent-directory variant) | 678 |
| MCP note | 333 |
| `FAST_RESPONSE_AGENT_GUIDANCE` (every fresh run) | 305 |
| Instructions path directive | ~420 + 2 paths |
| Fresh-session handoff | ≤ 24,000 bytes (`native-session-handoff.ts:8`) |
| Wake: minimal fresh assignment (issue only) | 457 (rendered) |
| Wake: fixture with 3 short comments + continuation | 2,993 (rendered from `test-fixtures/prompt-context.ts`) |

#### Per kind of run

Each row lists the sections in join order. "Wake: X" names what the wake section carries.

**Task runs and comment wakes**

| Kind | Trigger / wake reason | Sections (CLI) |
|---|---|---|
| **Fresh task run** (assignment, routine) | `issue_assigned`. Routines create an issue and queue `issue_assigned` (`services/routines.ts:2013-2023`). Always fresh (`run-state.ts:813-832`) | 1, 2?, 3 (fast-response + handoff if the issue has history), 4 (wake header, reason/issue lines, status/priority/work mode, execution continuation if assigned to this agent, continuation summary if one exists, comments), 6 (full Assignment brief: task header, `TASK_QUESTION_GUIDANCE`, issue, title, mode directive, description, plan doc ≤12k, ancestors ≤6, "Use this task context…"), 7, 8. **Typically 7–8k characters** with a short description and no history [I: sum of measured parts] |
| **Resumed task run** ("resume delta") | e.g. `issue_commented` on an existing session | 1, 4 ("Paperclip Resume Delta"; continuation context carries the `resumeDelta` messages), 6 (**compact** brief: no description; with an issue, the Assignment-Compact variant, which also has no comment bodies). No 3, 7, 8 |
| **Comment / mention wake** | `issue_commented`, `issue_comment_mentioned`, `issue_reopened_via_comment` (assignment-shaped, so the full brief) | As fresh or resumed. Comments ≤8, ≤4,000 each, ≤12,000 total (`run-preparation.ts:139-149`), but **deduplicated against the continuation messages**, which have no cap (`server-utils.ts:3282-3289`). With an open plan or document review: "Open plan comments" (≤12k) and "Open document annotations" |

**Chat turns**

| Kind | Trigger / wake reason | Sections (CLI) |
|---|---|---|
| **Agent chat turn** (hidden-task chat, `conversationMode`) | Comment on the chat issue (`issue_commented`). `prepareConversationTurn` sets `conversationMode: true` (`agent-conversations.ts:207`) | 1, 3 (chat guidance + fast-response + handoff, fresh only), 4 (no execution continuation, deleted for conversations at `heartbeat.ts:2813-2817` [I]; no continuation summary; no planning directive; no description, `run-preparation.ts:2438-2444` [I]), 6 ("Chat mode directive" = **28.6k** `AGENT_CHAT_DIRECTIVE` + composer mode + time zone + optional Conference Room, Status Cards and Cases directives + pending confirmation cards). **On resume the compact brief still holds the whole chat directive**, so every chat message re-sends about 29k [V: `task-markdown.ts:261-266` doesn't depend on `includeDescription`]. 7 and 8 on fresh only. `chat_task_completed` wakes add `chatCompletionInstruction` (JSON of completed tasks, `chat-completion-delivery.ts:276-279`) |
| **External chat turn** (Slack, GitHub, …) | `source: "chat:<provider>"` | **Dormant**: needs a configured chat endpoint (`run-preparation.ts:2015-2060` [I]). The wake carries the "External chat response contract" (3.8–4.6k) and the brief carries provider text. CLI drops the MCP note; ACP also drops the heartbeat template |

**Recovery, routines, no-task runs**

| Kind | Trigger / wake reason | Sections (CLI) |
|---|---|---|
| **Recovery / continuation wake** | `recovery` payload, or `source_scoped_recovery_action` (never assigned outside tests [I]); `issue_continuation_needed`, `issue_recovery_action_restored`, `issue_review_path_lost`, liveness continuations, `issue_blocker_stalled` | 1, 3?, 4 (recovery contract 600–1,100 + per-cause text; disposition repair; liveness continuation; stalled dependency ~800), 6 (full brief for recovery wakes). **Heartbeat template dropped** (`isPaperclipRecoveryWakePayload`). The MCP note stays if fresh |
| **Routine-triggered run** | Same as a fresh task run. The routine's env reaches the run through env bindings, not the prompt | Same as the fresh task run |
| **Run with no task** | Unscoped `heartbeat_timer` (always fresh), `on_demand` without an issue, an approval with no linked issue | 1, 3 (fast-response only), **6 = the literal string `null`**, 7, 8. The wake payload is null when there's no issue, comments, stage or agent message (`run-preparation.ts:2418-2424`) [V]. Why: `buildPaperclipTaskMarkdown` returns `null` when there's no issue (`task-markdown.ts:130`), and `task-context.ts:335-351` concatenates `assignmentPrefix + null + chatCompletionInstruction(...)` into `"null"`, which is truthy, so it's stored as all four variants [V: reproduced with tsx: `"" + null + ""` → `"null"`]. The working-copy guidance is appended to the non-Assignment variants only, so the Assignment `"null"` is what `claude_local` sends |

**Approvals and inbox requests**

| Kind | Trigger / wake reason | Sections (CLI) |
|---|---|---|
| **Approval wake** | `approval_approved` / `approval_cancelled` (`routes/approvals.ts:235-253, 541-562`), with `approvalId` and `approvalStatus` on the context | Wake shows only `- reason: approval_approved` and the issue. **No approval section**: `approvalId`, the type and the decision note aren't rendered [V: no approval handling in `server-utils.ts:2343-3312`]. Without a linked issue it's a no-task run (above). Rejected permission requests wake no one (bug 78) |
| **Inbox request answered** (interactions) | `interactionKind` / `interactionStatus`; `ask_user_questions` answered → `questionResponse` | "## Answered questions" (~350 + ≤12k), added at dispatch (`runtime-execution.ts:805-834`) and not saved to the snapshot. Other kinds: checkbox selection (`server-utils.ts:2711-2732`); planning "Implement the accepted plan…" / rejected-plan directive in the brief; `agentMessage` with the rejection reason ("## Agent Session Message", `routes/issues.ts:2759-2773`); `humanResponses` inside the continuation JSON |

**Other kinds**

| Kind | Trigger / wake reason | Sections (CLI) |
|---|---|---|
| **Execution-policy stage** (review / approval) | `execution_review_requested`, `execution_approval_requested` (resets the session), `execution_changes_requested` | Wake: execution stage block (250–1,200). Its reviewer text names "the Paperclip Runner" (`server-utils.ts:3056`) [I] |
| **Children completed** | `issue_children_completed` | Wake: "Direct child issue summaries" |
| **Watchdog** | `task_watchdog_stopped_subtree` | Wake: "## Task Watchdog Mandate" (~3.3k + leaves). Live but opt-in (`/issues/:id/watchdog`) |
| **Tree hold / dependency-blocked** | Queue-produced | Small wake blocks (`server-utils.ts:2776-2806`) |
| **Skill test** | `workMode: skill_test` | Brief: skill-test directive; context: `paperclipSkillTest` (pinned inventory). Not rendered in the wake itself |
| **Status change / monitor / unblock** | `issue_status_changed`, `issue_monitor_*`, `issue_blockers_resolved` | Only the `reason:` line plus whatever else the payload carries [I] |

### 3.2 The system prompt and sessions

1. **`--append-system-prompt-file` and the bundle** [V].
   - `prepareClaudePromptBundle` (`prompt-cache.ts:191-243`) writes the bundle under
     `<instance>/companies/<c>/claude-prompt-cache/<bundleKey>/`. It contains:
     - `agent-instructions.md`: the combined instructions and manifest, written only if missing;
     - `.claude/skills/*`: symlinks;
     - `plugins/{paperclip,company}/…`: plugin folders with symlinked skills.
   - The flag passes `agent-instructions.md` on fresh sessions only (`execute.ts:843-847`).
   - The directive keeps the per-run working-copy path out of the bundle (`run-plan.ts:515-518`).
2. **The bundle key** (`buildClaudePromptBundleKey`, `prompt-cache.ts:146-170`) [V]. It is a sha256
   over:
   - the layout (3);
   - the combined instructions **content**;
   - each mounted skill's key, runtime name and file tree.

   The combined content includes the skill-library manifest, so installing, removing or
   enabling/disabling **any** company skill changes every `claude_local` agent's key in that
   company. Each one's next run then refuses `--resume` (`execute.ts:731-732, 742-749`) and starts
   fresh with the handoff.
3. **What resets a session.**
   - **Adapter, at launch** (`execute.ts:725-805`) [V]. It refuses `--resume` when:
     - the saved id isn't a UUID;
     - the target changed;
     - the cwd changed;
     - the bundle key changed.

     A changed MCP set doesn't block resume; it's only logged (`execute.ts:801-805`). A failed
     resume (unknown, poisoned or bad image) retries fresh once (`execute.ts:1421-1468`).
     Max-turns and poisoned ids drop the session (`execute.ts:1191-1210`).
   - **Server, before dispatch** (`session-preparation.ts:193-213`) [V]:
     - **Wake:** `forceFreshSession`; `issue_assigned`; `execution_review_participant_recovery`;
       `execution_approval_requested`; an unscoped `heartbeat_timer` (`run-state.ts:813-832`).
     - **Workspace:** `workspaceSelectionChanged`.
     - **Config fingerprint change** (`workspaces.ts:2827-2988, 3278-3353`), over: adapter type;
       **the effective adapterConfig** (so `promptTemplate`, `bootstrapPromptTemplate` and the
       model); the runtime config; the managed instructions content hash; issue overrides; the
       workspace config (minus issue and project `updatedAt`, `workspaces.ts:2847-2852`); the
       environment; env bindings (environment, project, routine); secrets; runtime skills.
     - **Credential:** a managed AI credential change (`session-preparation.ts:208-213`).
     - `refreshTools` when the adapter can't refresh (`session-preparation.ts:188-192`).
   - **Chat** `/new` bumps `conversationSessionGeneration` (`agent-conversations.ts:183-215`) [I].
4. **How sessions are keyed** [V].
   - `agent_task_sessions` holds one row per company, agent, adapter type and task key.
   - The task key is `taskKey ?? taskId ?? issueId` (`run-preparation.ts:1626-1640`).
   - Unscoped timer wakes use `__heartbeat__` and always start fresh (`run-state.ts:786-832`).
   - The CLI saves `{sessionId, cwd, promptBundleKey, mcpServerIdentity, workspaceId?, repoUrl?,
     repoRef?}` (`execute.ts:1210-1225`).
   - Claude's transcript lives in the agent's lasting sealed config folder, under
     `projects/<cwd>` (4b).
   - Since 4b part 3, a project with a git checkout gives each task its own worktree. That makes the
     cwd per task, which matches the per-task key.
5. **Stable vs varying parts.**
   - **Stable per agent:** Claude Code's base prompt; tool definitions (the `paperclip` MCP plus
     plugins); the appended instructions and manifest (while the library and `AGENTS.md` stay
     unchanged).
   - **Varies per cwd:** Claude Code's environment block (cwd, git status) sits in the system
     prompt. Per-task worktrees therefore give each task a different system prompt, so the
     prompt cache isn't shared between tasks [I: from Claude Code behaviour as described in
     upstream #21945].
   - **Varies per run:** the whole first message. The directive embeds the per-run working-copy
     path, so even its first line changes every run.
6. **Unverified, high-impact.** Resumed CLI sessions don't pass `--append-system-prompt-file`. The
   comment (`execute.ts:842-845`) says the instructions are "already in the session cache".
   - I found no test or doc confirming that `claude --print --resume` keeps a system prompt
     appended in an earlier invocation.
   - If Claude Code rebuilds the system prompt from the current flags, which is my understanding
     [I], then **every resumed CLI turn runs without `AGENTS.md` and the skill manifest**.
   - ACP doesn't have this problem: it puts the instructions in the first user message, which stays
     in the transcript.

   Step 5 should check this with one cheap manual test before deciding where COMPANY.md goes.
7. **Upstream #21945** (open; `gh pr view`) [V].
   - It adds an opt-in `stableOpeningPrompt`: on fresh sessions, write the run prompt to
     `<state>/runs/<runId>/prompt/run-prompt.md`, set `PAPERCLIP_RUN_PROMPT_FILE`, and send one
     constant stdin line telling Claude to `cat` it.
   - Why: Claude Code caches the request prefix at the end of the first user turn, so the varying
     task text forces a full cache write (about 45–64k tokens) on every fresh session.
   - Measured: zero cache writes on fresh runs 2–4 in the same cwd.
   - Costs:
     - it needs Bash;
     - it needs `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1`;
     - it adds one extra tool call;
     - the prompt arrives as tool output;
     - per-task worktrees defeat it, since the cwd differs per task.
8. **Consequence for COMPANY.md and a project brief in the system prompt.**
   - They reach **fresh sessions only**. Edits won't reach a running session unless they also reset
     it.
   - **To reset on edit:** include them in the bundle key. One COMPANY.md edit then resets every
     agent's session company-wide, the same blast radius as a skill-library change. A project
     brief edit resets every session on that project's tasks.
   - **To keep sessions:** leave them out of the key. Resumed sessions then keep stale text, or
     none at all if item 6 holds.
   - **Caching:** in the system prompt they become part of the cached prefix, but only within one
     cwd. In the first message they cost tokens on every fresh session, and on every turn if
     repeated, and nothing about them is cached across sessions.

### 3.3 The wake payload and renderer

- `buildPaperclipWakePayload` (`server/src/services/heartbeat/run-preparation.ts:2355-3008`) builds
  the payload [V].
  - Its only live caller is `prepareHeartbeatTaskContext` (`task-context.ts:150-181`).
  - It stores `context.paperclipWake`.
- `normalizePaperclipWakePayload` (`server-utils.ts:1754-1966`) keeps about 30 fields.
- `renderPaperclipWakePromptBody` (`server-utils.ts:2343-3312`) renders the body.
- The wrapper `renderPaperclipWakePrompt` (`server-utils.ts:2329-2341`) appends three server-made
  texts.

The normalizer drops builder output that never reaches the prompt [I, subagent read]:
- `chatCompletionUpdates`;
- `attachmentOmissions`;
- comment `attachments`, `presentation`, `metadata` and `sourceTrust`;
- the continuation summary's key, title and date.

Comment attachments are queried (`run-preparation.ts:2531-2612`) but only the Runner reads them.

**Inventory.** For each section: where it's produced, whether it's live here, its size and a
suggestion. **Suggestions are input, not decisions.** Producer paths are under `server/src/`; `rp` =
`services/heartbeat/run-preparation.ts`. Render lines are in `server-utils.ts`. Rows marked [V] I
read; the rest come from the subagent's sweep, with my spot checks.

**Header, recovery and external chat (rows 1–7)**

| # | Section (render lines) | Producer | Live here? | ~Size | Suggestion |
|---|---|---|---|---|---|
| 1 | Fresh header "## Paperclip Wake Payload" (2602-2631) [V] | always | yes | 350–650 | **Keep, rewrite.** Fold in the "acknowledge the latest comment" rule; drop "refetch the issue thread", which is REST-era |
| 2 | Resume-delta header (2585-2601) [V] | resumed | yes | ~450 | Keep, shorter |
| 3 | Summary lines: reason, issue, pending x/y, latest id, fallback fetch (2538-2569) [V] | rp:2787 | yes | 120–400 | **Merge** into one "What happened" event line. "fallback fetch needed" is REST-era |
| 3a–c | Retried wake, cut comments and attachments, omitted count | `execution-continuation.ts:219`; rp:2455-2521 | yes | ~300 | Keep. The cut-comment hint names `GET /api/issues/{id}/comments`; it should name the MCP tool |
| 4 | Recovery contract + summary (2407-2423, 2504-2516, 2552-2563) | `recoveryActionId` / `recoveryCause`: `routes/issues.ts`, `recovery/service.ts`, `heartbeat.ts:1235-1259` | yes | 600–1,100 | **Keep** as one "recovery" event kind. Drop the `source_scoped_recovery_action` branch (never set outside tests) and the `codex_output_inactivity_monitor` cause (Codex) |
| 4a | "Don't narrate recovery" (2564-2568) | `issue_recovery_action_restored` | yes | ~110 | Merge into 4 |
| 5 | External chat response contract, 3 variants (2462-2503) | `source=chat:<provider>`, `heartbeat.ts:2478` | **no**: needs a chat endpoint (core-wired, `app.ts:571-587, 636, 839`; tiers call it dormant) | 3.8–4.6k | **Drop** from the `claude_local` builder (leave it in the shared renderer) |
| 6 | External interaction continuation (2570-2584) | `question-response-delivery.ts:1196`, `chat-channels/…/continuations.ts:349` | no | ~750 | Drop |
| 7 | GitHub review instructions (2633-2635) | `chat-channels/github/review-instructions.ts` | no | 40 + policy | Drop |

**Continuation, task state and directives (rows 8–17)**

| # | Section (render lines) | Producer | Live here? | ~Size | Suggestion |
|---|---|---|---|---|---|
| 8 | Current request + continuation context, with fenced JSON (2636-2676) [V, rendered] | `buildExecutionContinuation` (`execution-continuation.ts:227-625`) when the issue is assigned to this agent and isn't a chat | yes | ~1k fixed + **every task comment as JSON (~230 chars of metadata each)** + `completedWork` ≤32k | **Rework.** The biggest live section, overlapping the handoff, the comments, the continuation summary and `paperclip_task_context`. Keep the authority rules (`humanResponses`, objective) and send recent messages as prose, capped |
| 9 | Issue status, work mode, priority (2677-2685) | rp | yes | ~80 | Merge into the task brief |
| 10 | Issue description (2686-2710) | rp:2438-2444 | **suppressed** for `claude_local` (`suppressIssueDescription` when a brief exists, `server-utils.ts:2321`) | ≤12.1k | Drop (the brief owns it) |
| 11 | Checkbox selection (2711-2732) | `routes/issues.ts:2733, 2810, 2836` | yes | 100–400 | Keep, as part of an "interaction answered" event |
| 12 | Planning directive / accepted plan (2733-2762) | issue `workMode`, interactions | yes | 90–400 | **Merge** with the brief's identical "Planning mode directive" (`task-markdown.ts:269-284`), which is duplicated |
| 13 | Harness checkout line (2763-2765, 3219-3226) | `heartbeat.ts:2405, 2442-2445` | yes | ~230 | Keep, short ("the task is already checked out to you") |
| 14 | Execution-workspace branch guard (2766-2770) | `heartbeat.ts:3397-3407` | yes | ~170 | Keep, in the workspace part of the brief |
| 15 | Simplified English directive (2771-2775) | experimental setting | only if the flag is on | ~470 | Keep behind its flag, or drop |
| 16 | Dependency-blocked interaction (2776-2794) | `heartbeat/queue.ts:4494-4518` | yes | 170+ | Keep |
| 17 | Tree hold (2795-2806) | `queue.ts:3487-3495` | yes | ~250 | Keep |

**Messages, reviews and stages (rows 18–22)**

| # | Section (render lines) | Producer | Live here? | ~Size | Suggestion |
|---|---|---|---|---|---|
| 18 | Agent Session Message + untrusted tool results (2811-2839) | rejection reason (`routes/issues.ts:2759-2773`) **live**; `plugin_invoke` (plugins) and `tool_action_review` (connections) dormant | partly | 330+ | Keep for rejection reasons; drop the plugin and tool parts |
| 19 | Plan annotation deltas (2841-2872) | `annotationCommentId`, set only in tests | **no producer** | — | **Drop** (dead) |
| 20 | Plan review context (2874-2961) | `plan-review-context.ts:142-330` | yes | header ~250; threads ≤12k | Keep, capped. Check whether it renders "0/0" with no open threads [I] |
| 21 | Document annotations (2963-3024) | `plan-review-context.ts:347-565` | yes | ~420 + threads ≤12k | Keep, or merge with 20 into one "open review comments" event |
| 22 | Execution-policy stage (3026-3068) | `routes/issues.ts:2156-3083` | yes, when a policy is set | 250–1,200 | Keep. Remove the Runner sentence (3056) and the PATCH recipe in favour of MCP tools |

**Watchdog, continuation and comments (rows 23–30)**

| # | Section (render lines) | Producer | Live here? | ~Size | Suggestion |
|---|---|---|---|---|---|
| 23 | Task Watchdog mandate (3070-3140) | `task-watchdogs.ts:698-730` | live, opt-in per issue | ~3.3k + leaves | Keep as its own template file, or drop if watchdogs aren't used (ask) |
| 24 | Issue continuation summary (3142-3151) | `issue-continuation-summary.ts` (written after each run, `run-lifecycle.ts:2498`) | yes | ≤4k | **Merge** with 8 and the handoff: one "where things stand" section |
| 25 | Task disposition repair (3153-3159) | `recovery/review-path-recovery.ts`, `recovery/service.ts:3410-3430` | yes | ~60–800 | Keep (recovery kind). Check its overlap with 4a's finish-or-block |
| 26 | Run liveness continuation (3161-3181) | `recovery/run-liveness-continuations.ts:175-189` | yes (the Runner producers are dormant) | 60–400 | Merge into recovery |
| 27 | Stalled dependency (3183-3201) | `recovery/blocker-stall-wakeups.ts:384-392` | yes | ~800 | Keep |
| 28 | Direct child summaries (3203-3217) | `routes/issues.ts:17480-17507` | yes | 30 + ~100/child | Keep |
| 29 | Answered questions (3228-3247) | `runtime-execution.ts:805-834` (dispatch-time) [V] | yes | ~350 + ≤12k | Keep. Build it before the preview, not at dispatch |
| 30 | New comments (3255-3307) [V] | rp:2426-2516 | yes | ~100/comment + bodies (≤12k) | **Keep** as the core "what just happened" event |

**Appended by the wrapper (rows 31–33)**

| # | Section | Producer | Live here? | ~Size | Suggestion |
|---|---|---|---|---|---|
| 31 | "## Assigned connector skills" | `execution-configuration.ts:444-451` | dormant (connectors) [I] | varies | Drop, or move to the system prompt if connectors wake up |
| 32 | Connection instructions | `connection-instructions.ts:17-47` | dormant unless tool connections with instructions are assigned [I] | ~200+ | Same as 31 |
| 33 | MCP-app context | `mcp-app-views.ts:133` | dormant [I] | varies | Drop |

**No section at all** [V by grep of 2343-3312]: approvals, mentions, routines, monitors, status
changes and the reason for a manual run. Only the `reason:` line carries them. A builder that wants
"what just happened" for these needs new event templates. Approval wakes most of all: they carry
`approvalId` and `approvalStatus` on the context.

### 3.4 The task brief vs the MCP tools

**The task brief.** `buildPaperclipTaskMarkdown` (`server/src/services/heartbeat/task-markdown.ts:10-409`)
[V] is called 4 times per run (`task-context.ts:335-351`).

| Variant | Description | Wake comment bodies | Used by `claude_local` when |
|---|---|---|---|
| `paperclipTaskMarkdown` | yes | yes | never (fallback only) |
| `…Compact` | no | yes | resume fallback when AssignmentCompact equals Assignment |
| `…Assignment` | yes | **headers only, no bodies** | fresh, assignment-shaped and recovery wakes |
| `…AssignmentCompact` | no | headers only | other resumes |

**Contents, in order** (`task-markdown.ts`):
- the "Paperclip task context" + user-authored-data warning;
- external chat link, file delivery, GitHub notes (dormant);
- `TASK_QUESTION_GUIDANCE` (998, every issue);
- Runner-only directives (`nativeRunner`, dormant);
- `- Issue: "…"`, `- Title: "…"`;
- the provisional-title directive (`paperclip_update_task … onlyIfProvisional`, so bug 51 looks
  fixed in code);
- the mode directive: chat (28.6k), ask, planning, skill_test or accepted plan;
- the rejected-plan directive (with `GET/PUT /api/issues/{id}/documents/plan` REST steps);
- the approved plan revision;
- "Issue description" (fenced);
- the task plan document (≤12,000, truncation note with a REST `GET`);
- "Authoritative parent / ancestor context" (≤6);
- "Follow-up directive" + "Latest wake comment:" / "Pending wake comments", each with bodies
  **omitted in the Assignment variants**;
- attachments;
- attachment notices;
- the "Attachment directive", which tells legacy runs to download with `PAPERCLIP_API_KEY` over
  REST;
- "Use this task context as the current assignment."

**Bits that look wrong for this setup:**
- In the Assignment variants the brief prints `Latest wake comment:` with no body; the body is in
  the wake section [V: `task-markdown.ts:358-367`]. A dangling header.
- The working-copy guidance goes only into `paperclipTaskMarkdown` and `…Compact`
  (`heartbeat/instruction-working-copy.ts:198-199, 221-224`). `claude_local` reads the Assignment
  variants first (`server-utils.ts:2275-2278`), so the "AGENT_HOME / editable instruction file"
  guidance doesn't reach fresh CLI runs [V by reading; the only test, extended-tier
  `heartbeat-instruction-working-copy.test.ts:115`, checks the non-Assignment key].
  `claude-local-run.md`'s skeleton shows it in the prompt.
- The text names curl and REST in places where 4a moved runs to MCP: the rejected-plan steps,
  the plan-truncation note, the attachment directive, the chat directive's "direct HTTP equivalent"
  paragraphs, and the wake's `GET /api/issues/{id}/comments`.
- The fresh handoff tells the agent to use `get_task_history`, `get_task_context`,
  `list_documents` and `read_document` (`native-session-handoff.ts:28`). These are Runner tool
  names; the run has `paperclip_*`.

**`paperclip_task_context`** (`server/src/mcp/catalog/run.ts:76-95`) [V] returns:
- `GET /issues/:id/heartbeat-context?wakeCommentId=…`;
- the last 10 comments;
- the documents index (no bodies).

**`heartbeat-context`** (`routes/issues.ts:9938-10120`) [V] returns:
- the issue (with description, status, priority, blockers, blocks, review and blocker attention,
  scheduled retry, active recovery action);
- ancestors;
- **project `{id, name, status, targetDate}`** and **goal `{id, title, status, level, parentId}`**;
- the comment cursor;
- the wake comment;
- attachments;
- the continuation summary;
- `planReviewContext`;
- `documentReviewContext`;
- `taskQuestionContext`;
- the current execution workspace.

It's redacted for the issue's registered secrets. There is **no project description, goal
description or project document index**; that gap is F6.

**Duplication on a fresh run** [V for presence; I for real-world sizes]:

| Content | Prompt task brief | Prompt wake | Fresh handoff | `paperclip_task_context` |
|---|---|---|---|---|
| Description | ✓ | suppressed (and as the continuation `objective` unless de-duplicated by hash) | — | ✓ |
| Ancestors | ✓ (≤6) | — | — | ✓ |
| Comments | headers only | ✓ continuation JSON (all) + new comments (≤8) | ✓ original + ≤10 recent | ✓ last 10 |
| Continuation summary | — | ✓ (≤4k) | ✓ run summaries | ✓ |
| Plan document body | ✓ (≤12k) | — | ✓ (up to 3 docs, plan first) | index only |
| Plan / document review threads | — | ✓ | — | ✓ |
| Status, priority, work mode | partly | ✓ | — | ✓ |

The MCP note tells the run to "Start with `paperclip_task_context`". So on a fresh run the agent
reads description, ancestors, comments, summary and review threads twice or three times.

### 3.5 Templates and agent config

**Templates** [V].
- `promptTemplate`:
  - The default is `DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE` (`server-utils.ts:215-219`).
  - The conversation default is the same constant (`server-utils.ts:223-224`).
  - CLI: `asString(config.promptTemplate, default)`, so a whitespace-only value is kept
    (`execute.ts:361-367`). ACP treats blank as default.
- `bootstrapPromptTemplate`: no default (`execute.ts:812`).
- Template variables (`execute.ts:813-821`, `renderTemplate` at `server-utils.ts:508-515`):
  - `agentId`, `companyId`, `runId`;
  - `company.id`;
  - `agent.*`: the whole agent row;
  - `run.id`, `run.source` (always `"on_demand"`);
  - `context.*`: the whole run context.
- Templates are legacy:
  - New agents with an instructions bundle **can't set either**
    (`assertNoNewAgentLegacyPromptTemplate`, `routes/agents.ts:2497-2507`).
  - `materializeDefaultInstructionsBundleForNewAgent` deletes both (`:2423-2474`).
  - The managed bundle exposes the old one as a `promptTemplate.legacy.md` pseudo-file
    (`agent-instructions.ts:16-19`).
  - Company export strips both (`company-portability.ts:2300-2301, 3711-3712`). Import uses
    `promptTemplate` as `AGENTS.md` when there's no markdown (`:5714-5717`).
  - Built-in agents strip them (`built-in-agents.ts:1125-1126`).
- In `ui-new`: Runtime → Advanced → "Prompt template" is editable (`RuntimeSection.tsx:474-477`),
  and "Bootstrap prompt" is shown read-only as "Legacy". The info tip says "Sent at the start of
  every run", which is wrong: it's dropped on resume deltas and recovery wakes. "Not set" hides
  that the 2,667-char default is sent. `promptTemplate` and `bootstrapPromptTemplate` are in
  `ADAPTER_AGNOSTIC_KEYS` (`packages/shared/src/constants.ts:89-98`).

**Communication guidance** [V]:
- the chat endpoint's guidance when the issue is a chat assigned to this agent
  (`task-context.ts:229-231`);
- plus `FAST_RESPONSE_AGENT_GUIDANCE`, always (`:388`);
- redacted at `:404`.

Fresh only. The fast-response receipt only matters if fast responses are on (a company setting).

**MCP note:** `renderPaperclipMcpNote` (`server-utils.ts:2188-2196`), shared with ACP [V].

**Instructions directive:** `run-plan.ts:520-530`, rebuilt every turn [V].

**Skill manifest:** `buildSkillLibraryManifestMarkdown` (`adapter-utils/src/skill-library-manifest.ts:30-58`),
appended in `run-plan.ts:541-549` [V]. Its only consumer is claude-local [I].

**Instruction working copy** [V]:
- `heartbeat/instruction-working-copy.ts:150-225` replaces `instructionsFilePath` with
  `<localRoot>/<entry>` per run (`:211`).
- It sets `paperclipWorkspace.agentHome`.
- It appends the guidance (`agent-instruction-working-copies.ts:84-87`) to the non-Assignment
  brief variants only.
- The non-agent-directory variant names `read_agent_instructions`, `update_agent_instructions` and
  related tools, which legacy runs don't have.

**Connector skills, connection instructions, `mcpAppContext`:**
`execution-configuration.ts:395-402, 444-455` → `paperclipWake.*` → wrapper (`server-utils.ts:2333-2339`).
Dormant here [I].

**Session handoff** [V]:
- **`native-session-handoff.ts`** (server, in the `native-runtime/` folder):
  - "## Fresh session handoff" + JSON `paperclip.native-session-handoff.v1`;
  - entries: the original request (first comment), ≤10 recent comments, ≤8 resolved interactions,
    ≤4 agent replies, ≤3 documents (plan first), ≤2 run summaries;
  - ≤24,000 bytes; ≤4,000 chars per entry.
  - Loaded at dispatch when there's no previous session (`session-preparation.ts:237-240`).
- **`hydrateFreshSessionHandoff`** (`server-utils.ts:2242-2250`) reloads it at each attempt, so a
  failed resume that retries fresh gets it.
- **`paperclipSessionHandoffMarkdown`** is the rotation note (`session-preparation.ts:322-332`),
  never set for `claude_local`.
- The handoff's own test, `server/src/services/native-runtime/native-session-handoff.test.ts`, is
  **opt-in** (the `native-runtime/**` glob), though the code is live for `claude_local`.

### 3.6 The ACP engine and the other consumers

**ACP `buildPrompt`** (`acpx-engine/execute.ts:3154-3242`) [V]. The join order is:
1. instructions **content** (in the user message, not the system prompt, dropped on resume-delta
   turns);
2. bootstrap;
3. initial guidance + handoff;
4. wake;
5. rotation note;
6. task brief;
7. `PAPERCLIP_*` env note;
8. MCP note;
9. heartbeat template (dropped on resume delta, and on external chat without a custom template).

**How ACP differs from the CLI:**
- no recovery rule;
- no instructions directive on resumed turns;
- skills go in as a text prefix (`:5088`).

ACP is dormant here: CLI is the default (`acp.ts:91-97`); only an explicit `engine: "acp"` selects
ACP. `AcpxEngineExecutorOptions` has no prompt hook [I, subagent].

**Who else consumes the shared pieces** [I, subagent sweep; spot-checked]:

| Consumer | Uses | State here |
|---|---|---|
| Other adapters: codex, cursor, cursor-cloud, gemini, grok, kimi, opencode, pi, hermes, openclaw | each has its own copy of the join with `selectPaperclipPromptSections` / `renderPaperclipWakePrompt` / `joinPromptSections` / `renderTemplate` | dormant (all tests opt-in) |
| ACP engine (claude, codex, gemini, kimi ACP modes) | all the selectors | dormant |
| Paperclip Runner, server side | `native-execution-input.ts:39, 214-221` (`selectPaperclipPromptSections` with `nativeWakeReaderAvailable`), `normalizePaperclipWakePayload` | dormant (tests opt-in) |
| Plugins (agent sessions) | indirectly: `paperclipAgentMessage` → wake `agentMessage` (`plugin-host-services.ts:3650-3667`) | dormant |
| Chat (hidden task) | `agent-conversations.ts` directives → task brief; `conversationMode` → renderer | **live** |
| Routines, recovery, watchdogs | produce context fields only | live |
| `heartbeat.ts:346` | imports `renderPaperclipWakePrompt` and never uses it | dead import |
| `workspace-runtime.ts` | `renderTemplate` for workspace commands (not prompts) | live, unrelated |

**What breaks.**
- **A `claude_local`-only builder** that stops calling the shared helpers breaks no other
  consumer. It does break claude-local's own prompt tests.
- **Changing the shared renderer or selectors** affects every adapter, ACP and the Runner input,
  though all of those are dormant and their tests are opt-in.
- Either way, the **server-side producers** (`task-context.ts`, `task-markdown.ts`,
  `run-preparation.ts`) are shared with ACP and the Runner. Changing what they put on `context`
  changes their prompts too.

**Tests and tiers** [V for tiers I checked against `scripts/test-extended.txt`; others from the
subagent, which ran the classifier]:

*Core (gating)*
- **Shared helpers and ACP:**
  - `packages/adapter-utils/src/server-utils.test.ts`: renderer, templates, MCP note;
  - `prompt-sections.test.ts`;
  - `skill-library-manifest.test.ts`;
  - `acpx-engine/execute.test.ts`.
- **claude-local:**
  - `server/src/__tests__/claude-local-execute.test.ts`: CLI prompt and argv;
  - `claude-local-sealed-run.test.ts`: MCP note;
  - `packages/adapters/claude-local/src/server/{acp,preview,prompt-cache,run-manifest}.test.ts`;
  - `server/src/__tests__/run-preview.test.ts`.
- **Server producers:**
  - `server/src/services/heartbeat/task-markdown.test.ts`;
  - `heartbeat/run-preparation.wake-window.test.ts`;
  - `server/src/__tests__/{agent-conversations,heartbeat-context-summary,issue-comment-redaction}.test.ts`;
  - `server/src/mcp/catalog/run.test.ts`;
  - the 4 route-guidance tests (section 3.9).

*Extended (nightly)*
- `heartbeat-task-context.test.ts`;
- `heartbeat-session-preparation.test.ts`;
- `heartbeat-instruction-working-copy.test.ts`;
- `run-preparation.test.ts`, `run-preparation.review-path.test.ts`;
- `execution-continuation.test.ts`;
- `document-annotations-service.test.ts`;
- `heartbeat-agent-session-message.test.ts`;
- `connection-instructions.test.ts`;
- `heartbeat-execution-configuration.test.ts`;
- `issue-recovery-actions.test.ts`;
- `task-watchdogs-scheduler.test.ts`;
- `claude-local-adapter.test.ts`.

*Opt-in*
- `native-runtime/native-session-handoff.test.ts`;
- `chat-file-delivery.test.ts`;
- `execute.remote.test.ts`;
- all the other adapters' tests;
- chat channels;
- `mcp-apps`.

### 3.7 The prompt preview

**Past runs** [V].
- `onMeta` stores `adapter.invoke` with `prompt`, `promptMetrics`, the full `context` and
  `runManifest` (`execute.ts:988-1004` → `run-output.ts:309-322`).
- Storage redacts in three steps (`run-lifecycle.ts:2265-2275`):
  1. `boundHeartbeatRunEventPayloadForStorage` cuts **every string at 16,384 chars**, arrays at
     50, objects at 100 keys and depth 6 (`heartbeat/run-log.ts:6-98`);
  2. key-name secret redaction (`redactEventPayload`; it also masks the manifest's `credential`,
     bug 75);
  3. current-user redaction.
- So a chat turn's prompt (≥30k) is stored cut. The stored `context` duplicates the four brief
  variants and the wake payload, each cut separately.
- `ui-new` (`ui-new/src/runs/invocation.ts`, `RunInput.tsx`) shows the stored first message, the
  character count, command, env, cwd, context JSON and manifest.
- It doesn't show:
  - the system prompt (the instructions and manifest text);
  - the `promptMetrics` breakdown;
  - the truncation;
  - which sections came from where.

  The heading says "rendered from the agent's prompt template", which isn't what the prompt is.

**Next run: `run-preview.ts`** [V].
- `previewAgentRun` resolves the config, skills, MCP servers, worktree and managed AI. Then it calls
  the adapter's `previewRun` (`claude-local/src/server/preview.ts`).
- It produces a **manifest only**: no prompt. Its context holds only `paperclipWorkspace`,
  `projectId`, `paperclipAgentAccess`, `paperclipAiConnectionName` and `paperclipGitHub`
  (`run-preview.ts:362-383`). There is no issue, wake or brief.
- It uses the agent's stored `instructionsFilePath`, not a working copy.
- The comment states it writes, mints and decrypts nothing (`run-preview.ts:48-58`).

**Side effects of the pieces a prompt preview would call:**

| Piece | Side effects |
|---|---|
| `prepareHeartbeatTaskContext` (`task-context.ts:53-457`) [V] | **No DB writes.** Mutates the passed `context` (by design: "acquires no execution resources"). It reads the continuation summary, ancestors, skill test, wake comments, execution continuation (throws `StaleExecutionContinuationError` if ownership changed), wake payload, case context, plan document, conversation confirmations and workspace preferences. `redactForIssue` **decrypts** registered secrets of earlier runs on the issue (`run-secret-redaction.ts:157-167`) to redact them: read-only, but it touches secrets. Needs a `run` with an `id` (the execution continuation and the case context take `runId`) |
| `buildPaperclipWakePayload` [V] | read-only queries. `plan-review-context` and the others are read-only (grep found no insert or update) |
| The heartbeat stages around it | **these** write: ledger scope on the run (`heartbeat.ts:2869-2871`); issue checkout (`:2390-2447`); instruction working copy (prepare/adopt, `resultJson` update, run events); managed AI runtime and temporary HOME; MCP gateway and token minting; run JWT; secret resolution and redaction registration; workspace realization (worktrees) |
| `materializeLegacyQuestionResponseWakeProjection` | read-only by name and grep [I] |
| Fresh handoff (`buildNativeSessionHandoff`) | read-only. Applies `redactForIssue`-style secret redaction [I] |

**What a side-effect-free prompt preview would need.**
1. A synthetic `run` id, or optional `runId` paths in the continuation and case context.
2. Re-create the later-stage patches without acting:
   - `paperclipHarnessCheckedOut` (predict: true for an assignee's task);
   - the branch name from `previewTaskWorktree`;
   - the working-copy guidance with a planned path;
   - connector text (dormant: skip);
   - the fresh handoff (call the loader: read-only);
   - `questionResponse`.
3. A choice of **which wake** to preview. The next run's wake doesn't exist until something queues
   it. Options: "a fresh assignment of task X", "a comment on task X", "a chat turn".
4. Run the builder's pure render on that context.
5. Decide whether the preview may decrypt secrets for redaction, or skips redaction (the preview is
   shown to the user who can see the issue anyway).

**Bugs touching the preview** (`fork/upstream-fixes.md`):
- **75:** the manifest's `credential` is redacted in storage.
- **76:** `envKeys` is cut at about 30 recorded keys, and launch-time keys are missing from the
  preview.
- **73:** the preview copies the worktree rules.
- **79:** a temp-folder test flake.

The 16k prompt truncation isn't in the bug list.

### 3.8 COMPANY.md and the project brief: inputs

- **COMPANY.md today** [V].
  - Company portability export writes `COMPANY.md` with frontmatter `{name, description, schema,
    slug}` and an **empty body** (`company-portability.ts:4150-4159`).
  - Import parses only its frontmatter (`:3145-3146`, `:3874-3875`).
  - `companies` has `description` and no instructions field (`packages/db/src/schema/companies.ts:9`).
  - No company text reaches a run.
  - Build plan 3.14 suggests the package body as the natural home.
- **Project brief inputs** [V].
  - `projects.description` and `projects.goalId` (`schema/projects.ts:15-17`).
  - `goals.description`, `level`, `parentId` (`schema/goals.ts:18-21`).
  - The `project_goals` many-to-many join.
  - Issues also carry `goalId`.
- **Project documents don't exist.** There is no `project_documents` table.
- **Precedents:** `issue_documents`, `routine_documents` and `case_documents`
  (`schema/cases.ts:132-145`), each a keyed join onto `documents`.
- **`heartbeat-context`** returns only the project's name and status and the goal's title, level
  and status (F6).
- **Memory proposal (3.5).**
  - Recall goes into `context.paperclipWake.memoryContext` as one more wake section, "Things you
    remembered…".
  - Budget ~1,500 tokens.
  - Recalled again on resumed sessions only when the wake brings something new, de-duplicated by id.
  - Built in `execution-configuration.ts` beside the MCP-app context.
  - It's per-run and varies, so it belongs in the first message, not the system prompt.
- **Size considerations** [I].
  - In the system prompt: COMPANY.md and the project brief ride on every fresh session, which is
    every new assignment.
  - In the first message: every resumed turn too, if repeated.
  - Today's fixed overhead is already about 4k (template + MCP note + question guidance + fast
    response) before any task data.
  - A cap per section (for example COMPANY.md ≤ 8k, project brief ≤ 4k plus a document index of
    titles and one-line descriptions) keeps the total bounded.

### 3.9 Leftovers from removing `ui/`

**Skipped and trimmed tests** (all from commit `d71012d336`) [V for the markers and counts]:

*Five route checks marked `it.skip`, all core files:*

| File:line | What it checked |
|---|---|
| `server/src/__tests__/plugin-managed-routine-guidance.test.ts:29-33` | the catalog's plugin settings link `company/settings/instance/plugins/:pluginId` is mounted in `ui/src/App.tsx` |
| `server/src/__tests__/person-only-page-guidance.test.ts:53-67` | the exact set of pages named by the MCP, connection and chat-endpoint catalog entries (`apps/<id>/permissions`, `apps/assistant-connection`, `apps/byo`, `company/settings/instance/experimental`, `issues/<identifier>`) is mounted |
| `person-only-page-guidance.test.ts:78-86` | `connection-intents.ts` links `/apps/byo` and `…/instance/experimental`, both mounted |
| `server/src/__tests__/company-model-service-settings-guidance.test.ts:31-41` | fast-response, decision-model and prompt-injection catalog entries name exactly `company/settings/connections` and `…/instance/experimental` |
| `server/src/services/agent-invented-host-links.test.ts:58-65` | the server's `BOARD_ROUTE_ROOTS` covers the old UI's `company-routes.ts` roots |

*Running tests whose route assertions were deleted* [I, subagent diff read]:
- `agent-conversations.test.ts:1139-1185`: runs, projects, design-guide and ux-lab, goals;
- `task-markdown.test.ts:118, 130`: status cards, cases;
- `board-skill-ui-guidance.test.ts:13`: palette, search route, sidebar;
- `packages/shared/src/adapter-agnostic-keys.test.ts:29`.

*Eight further skips are dormant CI tooling, not routes:*
- `scripts/__tests__/e2e-shard.test.mjs` ×4;
- `scripts/ci/test-selection.integration.test.mjs` ×3;
- `test-selection-regression.integration.test.mjs` ×1.

**Where the server gives agents page links** [I, subagent; spot-checked `agent-invented-host-links.ts:13-18`]:
- **Chat directives:** `server/src/services/agent-conversations.ts:93-158`, with the `/<prefix>/`
  placeholder replaced in `task-markdown.ts:94-99`.
- **The API catalog:** descriptions in `server/src/routes/openapi.ts` (about 25 entries:
  `company/settings/*`, `apps/*`, `activity/*`, `routines/<id>/triggers?triggerSetup=`,
  `projects/<id>/configuration`, `status/<id>`, `inbox/mine`), served through
  `runner-api-catalog.ts:157-164`.
- **403 remediation:** `server/src/routes/authz.ts:36-108`.
- **Real-prefix links in about 30 services:** attention, recovery, secrets, company search, the
  chat task URL, GitHub review bodies, sentry links.
- **Bundled skills:** `skills/paperclip/SKILL.md:71-77` and `skills/paperclip-create-agent/SKILL.md:156`
  (unprefixed, so it lands in the *last* company).

**`ui-new`'s routes** (`ui-new/src/App.tsx:91-228`) [V spot-check]:
- it keeps `/:companyPrefix/issues/:issueRef/*`, `agents/:agentKey/runs/:runId`, `approvals/:id`,
  `projects/:projectKey/*`, `status/:cardId?`, `company/settings/*` and `inbox/*`;
- it redirects most retired shapes through `routes/legacy-model.ts`.

**Mapping gaps** [I, subagent]:

| Old link | `ui-new` result |
|---|---|
| `/<P>/board-chat` | `/chats`; the Conference Room is gone, yet `CONFERENCE_ROOM_CHAT_DIRECTIVE` describes it |
| `/<P>/design-guide`, `/<P>/dev/task-chat-lab`, `/ux-lab/*` | not found (`/style-guide` is the nearest) |
| `/<P>/routines/<id>/triggers?triggerSetup=` | `?triggerSetup` dropped |
| `/<P>/settings/access` (join requests, `attention.ts:2061`) | App settings → Admins; should be Members |
| `/<P>/decisions?decisionId=` | the inbox, losing the id |
| `/<P>/activity/budgets`, `/<P>/company/settings/connections` | redirect to Budgets and Paperclip models; the text names old pages |
| `BOARD_ROUTE_ROOTS` | lists roots `ui-new` doesn't serve (`teams-catalog`, `tasks`, `artifacts`, `tools`, `usage`, `decisions`, `timeline`, `status-cards`, `design-guide`) and lacks new ones (`connections`, `workload`, `runs`, `budgets`, `instance`, `connectors`, `plugins`) |

Turning the skipped tests back on needs them to check `ui-new`'s route tree *and* the redirect
models (`connectionsAddress`, `parseSettingsPath`, `appSettingsRoute`), not literal
`<Route path>` strings.

**`skills/paperclip-board/SKILL.md`** (633 lines) [V for the reader; I for content].
- It is a board-assistant curl manual. "Finding Things in the Web UI" (`:563-573`) describes the
  old palette ("Search all", Cmd/Ctrl+Enter, a sidebar Search item); `ui-new` uses
  "Search everything" and Shift+Enter, and Search opens the palette.
- Readers:
  - `server/src/routes/board-chat.ts:74-97`, the Conference Room relay (`POST
    /api/board/chat/stream`, `app.ts:832`), which **has no UI consumer** now;
  - it's a core skill key (`company-skills.ts:692-698`), enabled for a seeded CEO and for hired
    leads (`onboarding-seed.ts:62`, `routes/agents.ts:2765-2766`), and listed in `ui-new`'s
    `LEAD_SKILL_KEYS`.

  So lead agents mount it as a skill.
- `server/src/__tests__/board-skill-ui-guidance.test.ts:16-44` (core) pins the old wording, so a
  rewrite must update it.

### 3.10 Related pending work

- **The recovery handoff's content (from 4b).** The fresh handoff reaches every fresh session.
  - **The gap** (`claude-local-run.md` §10): no summary of what the previous session did beyond
    final replies and run summaries. Plus the wrong tool names (section 3.4).
  - **Overlap:** the execution continuation and the continuation summary already carry history.
  - **Where it belongs:** one "where things stand" section that the builder owns.
- **Memory recall.** A per-run section in the first message (section 3.8). Leave a slot and a
  per-session "already shown" list.
- **Upstream #21945** (stable opening prompt, section 3.2.7): only pays off if fresh sessions share
  a cwd, which per-task worktrees prevent.
- **Upstream #17584**, already taken (`810740e3a`, `upstream-watch.md:75`): skip the runtime, API
  and skill notes on resumed ACP sessions. The CLI mirrors it for the MCP note.
- **Open bug-list entries touching prompts and preview:**
  - 75 and 76 (preview);
  - 78 (denied permission requests wake no one);
  - 33 (Runner, dormant);
  - 35 ("Document how an agent reads a Decision's outcome": related to the approval-wake gap);
  - 36 (a skill promises an unenforced CEO-strategy gate);
  - 39 (auto memory, settled by 4b for sealed runs).

  Entries **51** (title tool) and **52** (MCP tool names in the chat directive) look **fixed in
  code** but aren't marked fixed (`task-markdown.ts:229-236`, `agent-conversations.ts:117-119` use
  `paperclip_update_task`, `paperclip_create_project` and `paperclip_create_task`).
- **Decision 8 (chat as hidden tasks):** chat is an issue with `conversationAgentId`. Its prompt is
  the task brief's chat directive, and `conversationMode` turns off execution continuation and the
  continuation summary. Step 6 replaces it.
- **Decision 5 (agent memory):** partly decided; auto memory is off for sealed runs.
  `para-memory-files` stays until the memory service.
- **What step 6 needs from the builder:**
  - inputs not tied to an issue: a conversation, with messages and read state;
  - a "turn message" template for follow-ups delivered into a live session (`--input-format
    stream-json`), which has no wake header and no task brief;
  - a chat brief that is sent once per session, not on every turn as now;
  - sessions keyed per conversation;
  - and briefings and agent-initiated messages.

  Design the builder around *(session context, once) + (turn event, each time)* so chat and live
  follow-ups reuse it.

### 3.11 Other findings

1. **The `"null"` task brief on no-task runs** [V]. `task-context.ts:335-351` concatenates a
   possibly-`null` result. It also affects ACP and other adapters' no-task runs [I].
2. **Approval wakes carry no approval** [V] (section 3.1).
3. **Working-copy guidance lost** for `claude_local` [V by reading] (section 3.4).
4. **The chat directive is re-sent on every resumed chat turn** (28.6k) [V].
5. **Stored prompts are cut at 16k** [V], so "what a past run did receive" is incomplete exactly
   where it matters (chat, long briefs).
6. **`promptMetrics` misses three sections**: the directive, the guidance and handoff, and the
   MCP note. `sessionHandoffChars` names the wrong handoff [V].
7. **Duplication** between the brief and the wake: the planning directive is in both (wake
   2733-2762 and brief 269-284). The description is suppressed in the wake, but the continuation
   `objective` can still carry it when it's not de-duplicated by hash [V/I].
8. **Dead code paths:**
   - `source_scoped_recovery_action` and annotation deltas (no producer) [I];
   - `paperclipSessionHandoffMarkdown` (rotation off for Claude) [V];
   - the `includeExecutionContract` option (marked deprecated) [V];
   - the `renderPaperclipWakePrompt` import in `heartbeat.ts:346` [I];
   - `nativeWakeReaderAvailable` is never passed by `claude_local` [V].
9. **Texts that misdescribe the setup.** The run has `paperclip_*` MCP tools, not REST:
   - REST and curl recipes in the brief, wake, chat directive and attachment directive;
   - Runner tool names in the handoff;
   - "Paperclip Runner" in the execution-stage text;
   - the connection guidance in every heartbeat template (2.6k for a dormant feature).
10. **Template text lives in TypeScript constants across about 10 files** in 4 packages:
    `server-utils.ts`, `task-markdown.ts`, `agent-conversations.ts`,
    `connection-intent-guidance.ts`, `fast-response.ts`, `issue-question-context.ts`,
    `native-session-handoff.ts`, `agent-instruction-working-copies.ts`, `run-plan.ts`,
    `skill-library-manifest.ts`, `case-context.ts` and `chat-completion-delivery.ts`. "Template
    files" means moving these.
11. **`paperclipTurnContext`** (`task-context.ts:434-450`) records which owner (brief or wake)
    holds the description and which comments. It's metadata for de-duplication across turns. A
    new builder can reuse the idea [V].
12. **The CLI vs ACP whitespace template difference** (`asString` keeps `"  "`) [V].

---

## 4. Impact map

| Step 5 change | Also affects | Tests (tier) |
|---|---|---|
| New builder in `claude-local` replacing `execute.ts:925-962` | `onMeta` payload (the `adapter.invoke` shape is read by `conversation-continuation.ts:46-55`, `native-local-process-stop.ts:295`, `pre-dispatch-execution-evidence.ts:36`, `run-lifecycle.ts:558`); `promptMetrics` | `claude-local-execute.test.ts`, `claude-local-sealed-run.test.ts` (core) |
| Move COMPANY.md / project brief into the system prompt | bundle key (`prompt-cache.ts:146-170`) → session resets; `run-plan.ts` combined instructions; the manifest's `instructions` row; the preview | `prompt-cache.test.ts`, `run-manifest.test.ts`, `preview.test.ts` (core) |
| Stop using the shared `selectPaperclipPromptSections` / renderer for CLI | nothing else (the other consumers keep the shared one); ACP keeps the old prompt unless changed too | `prompt-sections.test.ts`, `server-utils.test.ts` stay as they are (core) |
| Change the shared renderer itself | ACP, every dormant adapter, Runner input | `server-utils.test.ts`, `prompt-sections.test.ts`, `acpx-engine/execute.test.ts`, `acp.test.ts` (core); other adapters (opt-in) |
| Change the server producers (`task-markdown.ts`, `task-context.ts`, `buildPaperclipWakePayload`) | ACP and Runner prompts; `heartbeat-context` doesn't use them; redaction on 4 variants | `task-markdown.test.ts`, `run-preparation.wake-window.test.ts`, `agent-conversations.test.ts`, `issue-comment-redaction.test.ts`, `heartbeat-context-summary.test.ts` (core); `heartbeat-task-context.test.ts`, `run-preparation*.test.ts`, `execution-continuation.test.ts` (extended) |
| Fix the `"null"` brief | every adapter's no-task runs | add to `task-markdown.test.ts` or a core task-context test |
| Fold the handoff into the builder | Runner (shares `native-session-handoff.ts`) | `native-session-handoff.test.ts` (**opt-in**: move to core if it becomes ours) |
| Prompt preview (next run) | `run-preview.ts`, the `ClaudeRunPreview` type in `packages/shared`, `ui-new` `RunPreviewCard` | `run-preview.test.ts`, `preview.test.ts` (core); `ui-new` `run-preview-model.test.ts` |
| Prompt preview (past runs) | `run-log.ts` 16k cap (raise for `adapter.invoke.prompt`, or store the prompt as its own artifact); `redaction.ts` (bug 75); `ui-new` `RunInput.tsx` | run-log tests [I]; `ui-new` `TaskRuns.actions.test.tsx` [I] |
| Remove `promptTemplate` / `bootstrapPromptTemplate` | `ui-new` RuntimeSection, harness-model, configuration YAML; `ADAPTER_AGNOSTIC_KEYS`; company portability; agent-instructions legacy pseudo-file; session fingerprint | `adapter-agnostic-keys.test.ts`, agent route tests [I], `ui-new` tests |
| Link fixes + re-enabled route tests | `openapi.ts`, `authz.ts`, `agent-conversations.ts`, `agent-invented-host-links.ts`, about 30 services | the 5 skipped (core) + `board-skill-ui-guidance.test.ts` (core) |
| Rewrite `paperclip-board` skill | `board-chat.ts` (no UI), lead skill defaults | `board-skill-ui-guidance.test.ts`, `agent-skills-routes.test.ts` [I tier], `onboarding-seed-route.test.ts` [I tier] |
| F6 project/goal descriptions in `heartbeat-context` | `paperclip_task_context` output | `mcp/catalog/run.test.ts` (core); issues route tests [I] |

---

## 5. Design questions

1. **Where does the builder live?**
   - a. In `claude-local` (beside `run-plan.ts`), reading `context`. Smallest blast radius; ACP and
     the Runner keep the shared path.
   - b. In the server (`services/prompt/`), producing finished sections the adapter only carries.
     The server can then preview it without the adapter, and own redaction. The adapter becomes a
     carrier.
   - c. In `adapter-utils` as a new module, replacing `selectPaperclipPromptSections` for everyone.
     One builder for all, but it drags the dormant adapters' tests along.
2. **Server-side producers: replace or wrap?**
   - a. Keep `buildPaperclipWakePayload` and `buildPaperclipTaskMarkdown` and add a new render
     layer.
   - b. A new, smaller payload ("run brief" + "events") built beside the old one for `claude_local`
     only, with the old one left for dormant paths.
   - c. Rewrite the old producers in place: breaks ACP and the Runner.
3. **COMPANY.md and the project brief: system prompt or first message?**
   - a. System prompt, inside the bundle key. Cached prefix, but a company-wide reset on every edit
     (like skills today).
   - b. System prompt, outside the bundle key, with a per-session "context version" and an "updated
     company instructions" delta in the next first message.
   - c. First message, fresh sessions only (like the guidance and handoff): no resets, no caching.

   This hinges on whether appended system prompts survive `--resume` (section 3.2.6).
4. **The template format.**
   - a. Markdown files with `{{…}}` placeholders (today's `renderTemplate`): readable, no logic.
   - b. TypeScript functions per section: typed, testable, but not "files we can edit".
   - c. Markdown files plus small typed section functions that fill them: a hybrid.
5. **What a wake event is.**
   - a. Keep `reason` + payload, and render per kind with one template each (about 15 kinds).
   - b. Normalize to a list of typed events (comment, interaction answered, approval decided,
     recovery, children done, review stage, …), each with its template. Chat turns and live
     follow-ups reuse them.
6. **Which history channel wins?** Execution continuation JSON, continuation summary, fresh
   handoff, new comments and `paperclip_task_context`.
   - a. The prompt carries only the triggering event plus a short state summary; the agent calls
     `paperclip_task_context` for the rest.
   - b. The prompt carries bounded history (last N messages + summary); the MCP tool stops
     returning comments.
   - c. Keep both, with explicit caps and a de-duplication record (`paperclipTurnContext`).
7. **Next-run preview scope.**
   - a. "A fresh assignment of task X" only. Simple, and covers most of the prompt.
   - b. Pick a wake kind (assignment, comment, chat turn) and a task.
   - c. The exact queued next wake if one exists, else (a).
8. **Past-run storage.**
   - a. Raise the 16k cap for `adapter.invoke.prompt`.
   - b. Store the rendered prompt and system prompt as a run artifact (file or document) and keep
     the event small.
   - c. Store the builder's inputs and template version, and re-render on view: exact only if the
     templates are versioned.
9. **Legacy templates.**
   - a. Drop `promptTemplate` and `bootstrapPromptTemplate` for `claude_local`; the default
     becomes a template file.
   - b. Keep them as an override slot at a fixed position.
   - c. Migrate any non-empty values into `AGENTS.md`.
10. **Dormant wake kinds in the shared renderer.**
    - a. Leave the shared renderer untouched (dormant consumers keep it).
    - b. Delete the dormant branches now.
    - c. Leave them, but skip them in the new builder with a test that lists the kinds it handles.
11. **Fix-now bugs found here** (`"null"` brief, lost working-copy guidance, approval wakes, chat
    directive on every turn, 16k cut):
    - a. fix in the current code first, as bug-list entries;
    - b. fold them into step 5.

---

## 6. Corrections

**`fork/claude-local-run.md`** (written at `955c81d2f`; line drift since 4a and 4b) [V]:

*Line drift*

| Doc says | Now |
|---|---|
| CLI order `execute.ts:928-951` / `943-951`, 7 sections | `execute.ts:925-954`, **8** sections (MCP note at 941-944, between the task brief and the heartbeat template) |
| `promptMetrics` `:952-959`; stdin `:1007` | `:955-962`; `:1020` |
| `--append-system-prompt-file` `:901-903` | `:843-847` |
| Instructions combined at `execute.ts:518-553`; directive `:523-528`; per-run paths comment `:516-517` | moved to `run-plan.ts:508-568`, `:520-530`, `:515-518` |
| Bootstrap `:863, 930-933` | `:812, 927-930` |
| Heartbeat template drop `:938-941` | `:933-935` |
| Resume refusal `:796-824`, bundle gate `:802-803`, MCP not blocking `:819-821` | `:725-805`, `:731-732`, `:801-805` |
| sessionParams `:1196-1213`; fresh retry `:1408-1455` | `:1210-1225`; `:1421-1468` |
| `hydrateFreshSessionHandoff` `server-utils.ts:2212-2220`; guidance `:2222-2230`; task markdown `:2238-2271` | `:2242-2250`; `:2252-2260`; `:2268-2295` |
| Renderer `server-utils.ts:2212-3262` (~1,050 lines) / `:2299-3262` | `:2329-3312` (body 2343-3312, ~970 lines) |
| `normalizePaperclipWakePayload` `:1750-1956`; templates `:214-223`; `joinPromptSections` `:516-524` | `:1754-1966`; `:215-224`; `:517-524` |
| `buildPaperclipWakePayload` `run-preparation.ts:2285` | `:2355` |
| Four variants `task-context.ts:335-386`; guidance `:229, :388` | `:335-387` (assignments at `:335-351`, stored at `:368-387`); `:229`, `:388` (unchanged) |
| `prompt-cache.ts:161-166` (`agent-instructions.md`), `:146-158` (`.claude/skills` symlinks), `:134-174` | layout 3: key `:146-170`, prepare `:191-243`; skills go to `plugins/{paperclip,company}` passed with `--plugin-dir`, not `--add-dir` (the `.claude/skills` links remain for the dormant remote path) |
| ACP `acpx-engine/execute.ts:3170-3260`, join `:3234-3244`, skills prefix `:5102` | `:3154-3242`, `:3218-3228`, `:5088` |
| `instruction-working-copy.ts:220-222` | `server/src/services/heartbeat/instruction-working-copy.ts:221-224` |
| `workspaces.ts:3237-3315` (freshness) | `:3278-3353` (category values `:2827-2888`) |

*Substantive corrections*
- **The skeleton** shows "Your persistent agent directory is …" in the first message. With an
  issue, `claude_local` reads the Assignment variant, which doesn't get that guidance (section
  3.4).
- **The skeleton** shows "Follow-up directive + latest wake comment". In the Assignment variant
  the comment body isn't there (only the header); the body is in the wake section.
- **§10 "Prompt preview":** "Task context preparation has side effects (checkout, working copies,
  redaction registries)". `prepareHeartbeatTaskContext` itself writes nothing. The checkout,
  working copies and registration are in the surrounding heartbeat stages. The preview's real
  problem is that the prompt depends on those stages' patches (section 3.7).
- **The "Prompt preview" row** says past runs are "already stored". True, but cut at 16,384
  characters per string.
- **The `paperclipFreshSessionHandoffMarkdown` row:** "Every fresh session on an issue": only when
  the handoff has entries. Its text names Runner tools.

**`fork/hard-fork-plan.md`:**
- **"It's unclear what a run loads":**
  - it calls ACP the default and cites `execute.ts` 880–907. Since 4b the CLI is the default
    (`acp.ts:91-97`);
  - "`--setting-sources user`, used with managed AI connections" is now always used on sealed
    runs.
- **"The run prompt is hard to control":**
  - "about seven sections … around line 942": now 8, at 945-954;
  - "five places": the CLI text comes from about a dozen sources (section 1);
  - the table omits the skill-library manifest (system prompt), the instructions directive, the
    MCP note and the fresh handoff as distinct pieces.
- **Step 5:**
  - "first message: the task brief, then what just happened". Today's order is the reverse (wake,
    then brief). A deliberate change, or the doc's mistake? Worth saying which.
  - "system prompt: the agent's instructions, then COMPANY.md, then the project brief". The system
    prompt also holds the skill-library manifest. Its position relative to COMPANY.md needs
    deciding.
  - "about a dozen skipped tests": 5 route-check `it.skip`s, 8 dormant-CI `it.skip`s, and 7
    running tests with deleted route assertions.

**4b docs:**
- `step-4b-sealed-runs.md` §3 says the MCP note goes to fresh CLI sessions. True. It isn't counted
  in `promptMetrics`.
- The 4b docs describe the run preview as the place step 5's prompt preview "fits beside". The
  preview's context has no issue or wake at all, so the prompt preview is a new code path, not an
  extension of the same context.

**`CLAUDE.md`:** "Agents run on the `claude_local` adapter, whose default engine is ACP
(`claude-agent-acp`), with `claude --print` as the CLI engine". Since 4b the CLI is the default
(`acp.ts:91-97`).

**`fork/upstream-fixes.md`:** entries 51 and 52 look fixed in code but aren't marked fixed.
