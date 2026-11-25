# Step 5 bugs 96–98 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `claude_local` runs record their compactions (and the next run's message resends the task
after one), the documents line has one bracket, and a run's result reaches the task and the next
run's message once.

**Architecture:** both engines emit one `context.compacted` run event through the adapter's
`onEvent` hook, in the Runner's event envelope so the existing readers take it; the server's task
facts read it. The run message's history learns which comments the last run posted and drops the
run's summary when one of them is quoted; the ending rule tells the agent the ending tool's summary
is its comment.

**Tech Stack:** TypeScript, vitest, pnpm patches (`patches/`), Drizzle (Postgres).

**Spec:** [fork/step-5-bugs-96-98.md](step-5-bugs-96-98.md) (approved 2026-11-25).

## Global Constraints

- Event type `context.compacted`; envelope `payload.prpEvent` with `schema: "paperclip.prp.event.v1"`,
  `eventType: "context.compacted"`, `sourceKind: "claude_local"`, `normalizedSessionId`,
  `emittedAt`, and `payload: { schema: "paperclip.context.compacted.v1", compactionId, reason,
  preTokens, postTokens: null, sameSession: true }`.
- ACP marker: `usage_update._meta.paperclip.compacted = { trigger, preTokens, compactionId }`.
- Ending sentence, verbatim: `Each one posts its summary on the task as a comment, so put the run's result there, not in a separate comment as well.`
- Documents line outputs, verbatim: `plan ("Compact mode plan", quoted under "The task" below)`,
  `plan (quoted under "The task" below)`, `plan ("Compact mode plan", in the brief below)`,
  `plan (in the brief below)`.
- Last-run short lines, verbatim:
  `Your last run on {{taskRef}} ({{time}}) {{ended}} its comment, quoted below.`,
  `Your last run on {{taskRef}} {{ended}} its comment, quoted below.`,
  `{{whose}} last run on {{taskRef}} ({{time}}) {{ended}} its comment, quoted below.`,
  `{{whose}} last run on {{taskRef}} {{ended}} its comment, quoted below.`
- Don't extend dormant code (the Runner, other adapters). The ACPX engine in `adapter-utils` is
  shared: the new branch acts only on the `paperclip.compacted` marker, which only our patched
  `claude-agent-acp` sends.

## Review Focus

1. **One compaction reported twice** (a retried notice, or the CLI and a later replay): one event
   per `compactionId` in what readers count. Task 2 and Task 3 tests.
2. **`/compact` with nothing to compact:** the SDK sends no `compact_boundary`, so no event. Task 3
   test (status `compacting` then `compact_result: "success"` with no boundary: no marker).
3. **A compaction in another task's run, or an older run of this session:** doesn't set
   `compactedSinceLastRun`; only the previous run (`previousRunId`) counts. Task 4 test.
4. **The last run's comment deleted, or cut out of the comments' budget:** the summary stays. Task 7
   tests.
5. **A handed-over task whose previous assignee's run commented:** the other-agent short line, with
   that agent's name. Task 7 test.

---

## Agent A: compactions (bug 96)

Branch `step5-bugs/compactions`. Owns: `packages/adapters/claude-local/src/server/{parse.ts,execute.ts,compaction-event.ts}`
and their tests and fixtures, `packages/adapter-utils/src/{context-compaction-event.ts,acpx-engine/execute.ts}`
(the usage-update branch only) and tests, `patches/@agentclientprotocol__claude-agent-acp@0.73.0.patch`,
`server/src/services/heartbeat/run-task-facts.ts` and its test, `ui-new/src/tasks/thread-compactions.ts`
and its test.

### Task 1: The shared event builder, from a real CLI boundary

**Files:**
- Create: `packages/adapter-utils/src/context-compaction-event.ts` (export from the package index)
- Create: `packages/adapters/claude-local/src/server/__fixtures__/compact-boundary.jsonl`
- Test: `packages/adapter-utils/src/context-compaction-event.test.ts`

**Interfaces:**
- Produces: `contextCompactedRunEvent(input: { compactionId: string; trigger: string | null; preTokens: number | null; sessionId: string | null; emittedAt: string; sourceKind: "claude_local" }): AdapterRuntimeEvent`
  — `eventType: "context.compacted"`, `stream: "system"`, `level: "info"`, `message: "Context compacted"`,
  `payload: { prpEvent: <the envelope in Global Constraints> }`, `reason` = `trigger ?? "provider"`.

- [ ] **Step 1: Capture a real boundary.** In a scratch directory (not the repo), with your own
  Claude login: `claude -p --output-format stream-json --verbose "Say OK"`, take `session_id` from
  its output, then `claude -p --output-format stream-json --verbose --resume <id> "/compact"`. Save
  the `compact_boundary` line (and the `init` line before it) to the fixture. Note the CLI version
  in the commit message. If no boundary appears, report it and stop.
- [ ] **Step 2: Failing test** `contextCompactedRunEvent` builds the envelope: assert
  `payload.prpEvent.schema === "paperclip.prp.event.v1"`, `.eventType === "context.compacted"`,
  `.normalizedSessionId === "s-1"`, `.payload` deep-equals `{ schema: "paperclip.context.compacted.v1", compactionId: "c-1", reason: "auto", preTokens: 118000, postTokens: null, sameSession: true }`;
  and `reason: "provider"` when `trigger` is null.
- [ ] **Step 3: Run** `corepack pnpm --filter @paperclipai/adapter-utils exec vitest run src/context-compaction-event.test.ts`: FAIL.
- [ ] **Step 4: Implement**, run again: PASS. Commit.

### Task 2: CLI runs record the boundary

**Files:**
- Create: `packages/adapters/claude-local/src/server/compaction-event.ts`
- Modify: `packages/adapters/claude-local/src/server/execute.ts` (where stream lines are read)
- Test: `packages/adapters/claude-local/src/server/compaction-event.test.ts`, an `execute` test with the fixture

**Interfaces:**
- Consumes: `contextCompactedRunEvent` (Task 1).
- Produces: `claudeCompactionEvent(line: Record<string, unknown>, sessionId: string | null, now: () => Date): AdapterRuntimeEvent | null`
  — non-null only for `type: "system"`, `subtype: "compact_boundary"`; `compactionId` from the
  line's `uuid` (else `${sessionId}:${now().toISOString()}`), `trigger` and `preTokens` from
  `compact_metadata.trigger` / `.pre_tokens`; `sessionId` from the line's `session_id`, else the argument.

- [ ] **Step 1: Failing tests:** the fixture's boundary line gives one event with the fixture's
  `pre_tokens`; an `init` line, an assistant line and a `result` line give null.
- [ ] **Step 2: Run** `corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run src/server/compaction-event.test.ts`: FAIL.
- [ ] **Step 3: Implement**, and call `ctx.onEvent?.(…)` from `execute.ts` as each stdout line is
  parsed, at most once per `compactionId` per run. An execute test feeding the fixture asserts one
  `onEvent` call with `eventType: "context.compacted"` (two with the boundary line repeated → still one).
- [ ] **Step 4: Run** both test files: PASS. Commit.

### Task 3: ACP runs record the boundary

**Files:**
- Modify: `patches/@agentclientprotocol__claude-agent-acp@0.73.0.patch` (regenerate with
  `corepack pnpm patch @agentclientprotocol/claude-agent-acp@0.73.0` → edit `dist/acp-agent.js` →
  `corepack pnpm patch-commit <dir>`; keep the existing hunks)
- Modify: `packages/adapter-utils/src/acpx-engine/execute.ts` (the `usage_update` branch, ~line 5335)
- Test: the ACPX engine's existing test for usage updates (find it with `grep -l usage_update packages/adapter-utils/src/acpx-engine/*.test.ts`)

**Interfaces:**
- Consumes: `contextCompactedRunEvent` (Task 1).
- Produces: in the patched `case "compact_boundary"`, the `usage_update` carries
  `_meta: { paperclip: { compacted: { trigger: message.compact_metadata?.trigger ?? null, preTokens: message.compact_metadata?.pre_tokens ?? null, compactionId: message.uuid } } }`.
  acpx already passes `_meta` through (`runtime.js` `usageUpdateEvent`).

- [ ] **Step 1: Failing test:** an event `{ type: "status", tag: "usage_update", used: 0, size: 200000, _meta: { paperclip: { compacted: { trigger: "auto", preTokens: 150000, compactionId: "c-9" } } } }`
  makes the engine call `onEvent` once with `eventType: "context.compacted"` and
  `normalizedSessionId` = the run's backend session id; a `usage_update` without the marker makes
  no such call; the same marker twice → one call.
- [ ] **Step 2: Run** it: FAIL.
- [ ] **Step 3: Implement** the patch hunk and the engine branch; `corepack pnpm install` to apply
  the patch; check the hunk is in `node_modules/.pnpm/@agentclientprotocol+claude-agent-acp@0.73.0*/…/dist/acp-agent.js`.
- [ ] **Step 4: Run** the test: PASS. Commit (patch, `pnpm-lock.yaml` if its patch hash changed, engine, test).

### Task 4: The fact and the readers

**Files:**
- Modify: `server/src/services/heartbeat/run-task-facts.ts:121` (and the type comment at 40–44)
- Modify: `ui-new/src/tasks/thread-compactions.ts:35-36,82`
- Test: `server/src/services/heartbeat/run-task-facts.test.ts` (or the file that covers `buildRunTaskFacts`), `ui-new/src/tasks/thread-compactions.test.ts`

**Interfaces:**
- Produces: `compactedSinceLastRun` = a `heartbeat_run_events` row exists with
  `run_id = input.previousRunId`, the company, and `event_type = 'context.compacted'`; false when
  `previousRunId` is null.

- [ ] **Step 1: Failing tests:** previous run with a `context.compacted` event → true; previous run
  without → false; a compaction on another run of the same agent (not `previousRunId`) → false;
  `previousRunId: null` → false. ui-new: a finished `claude_local` run in the list is read for
  compactions the same way a `paperclip_runner` run is.
- [ ] **Step 2: Run** `corepack pnpm --filter @paperclipai/server exec vitest run <file>` and
  `corepack pnpm --filter @paperclipai/ui-new exec vitest run src/tasks/thread-compactions.test.ts`: FAIL.
- [ ] **Step 3: Implement.** In ui-new, replace `RUNNER_ADAPTER` with a set of the two adapter types
  and fix its comment. Read `server/src/services/heartbeat/conversation-events.ts` and
  `issue-context-usage.ts`: if either filters compactions on the Runner (`sourceKind` or adapter
  type), widen it the same way and add a case; if not, say so in your report.
- [ ] **Step 4: Run** the tests: PASS. Commit.

---

## Agent B: the run message (bugs 97, 98)

Branch `step5-bugs/message`. Owns: `packages/adapters/claude-local/src/server/wake/{templates.ts,where-things-stand.ts,render.test.ts,__fixtures__/*}`,
`packages/adapters/claude-local/src/server/standing-texts.ts` and its test, `skills/paperclip/SKILL.md`,
`server/src/services/task-request-history.ts` and its test, `packages/adapter-utils/src/server-utils.ts`
(`PaperclipWakeLastRun`, `normalizePaperclipWakeLastRun` only), and tests that pin the standing
text's length or the system prompt's bytes (the preview, run-plan and run-prompt tests) where
the new sentence changes them.

### Task 5: One bracket on the documents line (97)

**Files:**
- Modify: `packages/adapters/claude-local/src/server/wake/templates.ts:86-88`, `wake/where-things-stand.ts:230-243`
- Test: `wake/render.test.ts`

- [ ] **Step 1: Failing tests** for the four outputs in Global Constraints (task facts and brief,
  with and without a title that differs from the key), and an unquoted titled document still
  `notes ("Meeting notes")`.
- [ ] **Step 2: Run** `corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run src/server/wake/render.test.ts`: FAIL.
- [ ] **Step 3: Implement:** build the quoted name as key plus one bracket holding the title (when
  it differs) and the pointer; the templates carry the pointer text (`quoted under "The task" below`,
  `in the brief below`). Update fixtures' expected text.
- [ ] **Step 4: Run**: PASS. Commit.

### Task 6: The ending rule (98)

**Files:**
- Modify: `packages/adapters/claude-local/src/server/standing-texts.ts:14-23`, `skills/paperclip/SKILL.md:17-25`
- Test: `standing-texts.test.ts`

- [ ] **Step 1: Failing test:** `WORKING_IN_PAPERCLIP_ENDING` contains the ending sentence as its
  own paragraph, right after the three endings and before "A final message alone…"; the existing
  drift test (the skill contains the ending verbatim) still runs.
- [ ] **Step 2: Run** the file: FAIL.
- [ ] **Step 3: Implement** in both places; update tests that pin the standing text's length or
  the system prompt bytes.
- [ ] **Step 4: Run** `corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run src/server/standing-texts.test.ts` and the updated files: PASS. Commit.

### Task 7: The last run's summary once (98)

**Files:**
- Modify: `server/src/services/task-request-history.ts:34-45,297-339`
- Modify: `packages/adapter-utils/src/server-utils.ts:1188-1203` (and the `PaperclipWakeLastRun` type it uses)
- Modify: `wake/templates.ts:62-69`, `wake/where-things-stand.ts:103-129,141-152`
- Test: `server/src/services/task-request-history.test.ts` (or the file covering `readTaskLastRun`), `wake/render.test.ts`

**Interfaces:**
- Produces: `PaperclipWakeLastRun.commentIds: string[]` — ids of `issue_comments` on the task with
  `created_by_run_id = runId` and not deleted, oldest first, at most 20. The normalizer keeps a
  string array (default `[]`), so older payloads still render.
- Templates: `lastRunOwnCommented`, `lastRunOwnCommentedNoTime`, `lastRunOtherCommented`,
  `lastRunOtherCommentedNoTime` with the copy in Global Constraints.

- [ ] **Step 1: Failing tests (server):** a run that posted two comments → their ids; a run whose
  only comment is deleted → `[]`; a run with no comments → `[]`.
- [ ] **Step 2: Failing tests (render):** last run with a comment that is quoted → the short line,
  no summary quote, no "(The summary was cut short.)"; the same with the comment cut out of the
  budget (many long newer comments) → the summary as today; `commentIds: []` → the summary;
  another agent's run that commented → `The agent Coder's last run on … its comment, quoted below.`;
  a failed run → `failed, and ended with its comment, quoted below.`
- [ ] **Step 3: Run** both: FAIL.
- [ ] **Step 4: Implement.** In `renderTaskHistory`: build the blocks with the short last-run line,
  render the comments with what's left of the cap, and keep the short line only if one of
  `lastRun.commentIds` is among the quoted comments; otherwise rebuild with the summary and render
  the comments again. `renderHistory` may return the quoted ids alongside its text for this.
- [ ] **Step 5: Run** both: PASS. Commit.

---

## Finishing (each agent)

- `corepack pnpm typecheck` for the packages touched, `corepack pnpm test:quick`, and the files above.
  Agent A also runs `corepack pnpm --filter @paperclipai/ui-new test`.
- Commit on its branch; don't push, merge or edit `fork/` docs (Agent B's `skills/paperclip/SKILL.md` is code here).
- Report: what was built, what was left out, the CLI version captured (A), whether the readers
  needed widening (A), files touched, checks run with results.

## The PM, after both

- Merge both into `feat/step-5-bugs`; the local checks (`scratchpad/local-ci.sh`); the extended
  files for run lifecycle only if Agent A touched `run-lifecycle.ts` or recovery (not planned).
- Real runs on the desktop dev instance ("M7 test sealed runner", an M7 test task): a fresh run
  (one comment from finish, the ending rule seen), a resumed run (the short last-run line, the
  documents line). A compaction can't be ordered from a run: try the throwaway agent with a low
  auto-compact threshold (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, if the sealed env passes it) on a run
  that reads a few large files; if it compacts, the transcript shows the divider and the next
  resumed run resends the description. If the threshold can't be set, the captured CLI fixture and
  the tests are the check, and the design says so.
