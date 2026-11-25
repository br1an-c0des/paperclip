# Step 5: bugs 96–98

Status: **approved 2026-11-25**. The leftovers of step 5 phase 2's run message
([step-5-prompt-builder.md](step-5-prompt-builder.md)), from [upstream-fixes.md](upstream-fixes.md)
entries 96, 97 and 98.

## Why

- **96:** a `claude_local` run that compacts its session leaves no record, so the next run's
  message doesn't know to resend the task's description and plan, and the transcript shows no
  compaction divider. With bug 90 fixed the system prompt survives a compaction; the task facts in
  the first message still don't.
- **97:** the documents line reads `plan ("Compact mode plan") (under "The task" below)`: two
  brackets in a row.
- **98:** one run's result reaches the next run's message up to three times: the agent's own
  comment, `paperclip_finish`'s summary (which it posts as a comment too), and the run's summary
  (Claude's final message), which "Where things stand" quotes again above the comments. That wastes
  the history's 12,000-character budget and clutters the task for the user.

## Goals and non-goals

- **Goals:** a compaction in a CLI or ACP run is recorded as a run event and turns on the
  description/plan resend; one bracket on the documents line; a run's result shows once on the task
  and once in the next run's message.
- **Non-goals:** a context meter for `claude_local` runs (it also needs usage readings, which these
  runs don't record); changing what `paperclip_finish`, `paperclip_block` or
  `paperclip_report_progress` do; the Runner's own compaction events.
- **Anti-goals:** guessing a compaction from the agent's text ("Compacting…"); dropping the last
  run's summary when its comment isn't actually quoted in the message.

## Approaches

- **98** (the user picked **B**, 2026-11-25):
  - A. Only the history: leave out the last run's summary when that run posted a comment. Agents
    still post their result twice.
  - **B. The history plus the ending rule:** A, and "Ending a run" says the ending tool's summary
    is the run's result comment, so the agent doesn't post it separately as well.
  - C. `paperclip_finish` skips its comment when the run already commented: no reliance on the
    agent, but the tool's effect would depend on what happened earlier in the run.
- **96, the ACP engine** (my call): `claude-agent-acp` passes no compaction event on, only
  "Compacting…" as agent text and a usage drop. We already patch it
  (`patches/@agentclientprotocol__claude-agent-acp@0.73.0.patch`), so the patch adds an explicit
  marker. Matching the text was the other way, and it breaks on any wording change.

## The design

### 96. Record compactions

- **CLI engine:** the stream's `{"type":"system","subtype":"compact_boundary",
  "compact_metadata":{"trigger","pre_tokens"}}` message makes the adapter call `onEvent` with a
  `context.compacted` event.
- **ACP engine:** the patch's `compact_boundary` case adds
  `_meta: { paperclip: { compacted: { trigger, preTokens, compactionId } } }` to the `usage_update`
  it already sends; acpx passes `_meta` through, and the ACPX engine's usage-update branch
  (`packages/adapter-utils/src/acpx-engine/execute.ts`) turns it into the same `onEvent` call.
- **The event's shape** (my call): the envelope the existing readers already take, so the
  transcript divider, `issue-context-usage.ts` and the `heartbeat_run_events_compaction_session_idx`
  index work unchanged: `payload.prpEvent` with `schema: "paperclip.prp.event.v1"`,
  `eventType: "context.compacted"`, `normalizedSessionId` (Claude's session id), `emittedAt`, and
  `payload: { schema: "paperclip.context.compacted.v1", compactionId, reason: trigger, preTokens,
  postTokens: null, sameSession: true }`. `compactionId` is the boundary message's `uuid`. The
  builder checks each reader accepts a non-Runner `sourceKind` and says where one doesn't.
- **The fact:** `compactedSinceLastRun` (`server/src/services/heartbeat/run-task-facts.ts`) is
  true when the run whose session this run resumes recorded a `context.compacted` event. Then
  `the-task.ts` already resends the description and plan.

### 97. One bracket

- `documentInTask` becomes `{{document}}, quoted under "The task" below` inside the title's
  bracket when there is one: `plan ("Compact mode plan", quoted under "The task" below)`, and
  `plan (quoted under "The task" below)` without a title. `documentInBrief` gets the same
  treatment (`plan ("…", in the brief below)`). `renderDocuments` in `wake/where-things-stand.ts`,
  `wake/templates.ts`, cases in `wake/render.test.ts`.

### 98. The result once

- **The ending rule:** after the three endings in `WORKING_IN_PAPERCLIP_ENDING`
  (`standing-texts.ts`), add: "Each one posts its summary on the task as a comment, so put the
  run's result there, not in a separate comment as well." The `paperclip` skill's "Ending a run"
  gets the same sentence (its drift test checks the two match).
- **The history:** `readTaskLastRun` (`server/src/services/task-request-history.ts`) adds
  `commentIds`: the ids of the task's comments that run created (`issue_comments.created_by_run_id`,
  not deleted). `PaperclipWakeLastRun` and the adapter's `TaskHistory` type gain the field.
- **The message:** when one of those comments is quoted in this message's comments,
  `renderLastRun` gives one line and no summary: "Your last run on TES-50 (Nov 24, 17:45) ended
  with its comment, quoted below." (and the other-agent and no-time forms). Otherwise the summary
  stays as today. The comments' budget then gets the space the summary used.

## Left to the builder

- The exact `onEvent` plumbing in `parse.ts`/`execute.ts`/`acp.ts`, and de-duplicating a boundary
  reported twice.
- How `renderLastRun` learns which comments are quoted (the comments are cut to the budget after
  the last-run block today, so the order of the work may need to change).
- Tests: a CLI stream fixture and an ACP update with the marker each record one event; the fact
  true after a compacted run and false otherwise; the documents line with and without a title, in
  both forms; a last run that commented (quoted, and cut out of the budget) and one that didn't.

## Build

Two agents, no shared files:

1. **Compactions (96):** the ACP patch, the CLI's `execute.ts`, the ACPX engine's usage-update
   branch, `run-task-facts.ts`, ui-new's `thread-compactions.ts` (it reads only Runner runs today),
   their tests. Plan: [step-5-bugs-96-98-plan.md](step-5-bugs-96-98-plan.md).
2. **The message (97, 98):** `wake/templates.ts`, `wake/where-things-stand.ts`,
   `standing-texts.ts`, `skills/paperclip/SKILL.md`, `task-request-history.ts`, the wake payload
   types, their tests and fixtures.

Then the usual: integrate on `feat/step-5-bugs`, the local checks, real runs on the desktop dev
instance (one that compacts: a CLI run with `/compact` in a resumed session, or a small context),
merge, record.
