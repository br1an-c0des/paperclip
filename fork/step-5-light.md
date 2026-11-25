# Step 5, phase 2: the light sections

**Approved by the user, 2026-11-25.** The fourth piece of phase 2 of step 5, after the wake
([step-5-wake.md](step-5-wake.md)), the handoff ([step-5-handoff.md](step-5-handoff.md)) and the
task brief ([step-5-brief.md](step-5-brief.md)). The user chose "trim in place" (below) on
2026-11-25 and agreed to cut the heartbeat template down to the identity line.

## Contents

- [Intent](#intent)
- [The sections today](#the-sections-today)
- [Goals, non-goals, anti-goals](#goals-non-goals-anti-goals)
- [Constraints](#constraints)
- [Approaches](#approaches)
- [The design](#the-design)
  - [The first message's shape](#the-first-messages-shape)
  - [Who you are (M8)](#who-you-are-m8)
  - [The instructions location (M1)](#the-instructions-location-m1)
  - [The Paperclip tools note (M7)](#the-paperclip-tools-note-m7)
  - [The bootstrap template (M2) and the rotation note (M5)](#the-bootstrap-template-m2-and-the-rotation-note-m5)
  - [The server1 check](#the-server1-check)
  - [Sections in the record and the preview](#sections-in-the-record-and-the-preview)
  - [How it's checked](#how-its-checked)
- [Left to the builder](#left-to-the-builder)
- [Calls made in this design](#calls-made-in-this-design)

## Intent

The wake's four sections now carry each run's situation. Around them sit five older pieces of the
first message, which say the same thing on every run, much of it written for the Paperclip Runner
or for upstream's early prompt. The aim is that **everything left outside the wake earns its
place**: what's dead goes, what's wrong is corrected, what's long is shortened, and "What to do
now" stays near the end, where the agent reads it last.

This is the trim. Moving standing text into the system prompt is the next batch, with bug 90
(the system prompt lost after a compaction) fixed first, and the `paperclip` skill's re-evaluation
(bugs 90 and 92, [step-5-prompt-builder.md](step-5-prompt-builder.md#later-changing-the-prompt-to-be-decided)).

## The sections today

Measured on a fresh assignment run for "M7 test sealed runner" (the Run Prompt Map, 2026-11-24).
Order as `composeClaudeCliPrompt` joins them
(`packages/adapters/claude-local/src/server/legacy-prompt.ts`):

| # | Section (id) | Size | Sent | What's wrong |
| --- | --- | --- | --- | --- |
| M1 | Instructions location (`instructions_directive`) | 638 | every run with an instructions file | The long path twice; names `./HEARTBEAT.md`, `./SOUL.md`, `./TOOLS.md`, which most agents don't have, inviting it to look. From `readClaudeInstructionsFile` (`run-plan.ts`). |
| M2 | Bootstrap template (`bootstrap_template`) | 0 | fresh, if the agent sets one | A legacy agent setting (`adapterConfig.bootstrapPromptTemplate`). The server refuses it on new agents and strips it when an instructions bundle is set (`routes/agents.ts`, `assertNoNewAgentLegacyPromptTemplate`). |
| — | Communication guidance and handoff (`communication_guidance`) | | chat tasks | Not in this batch: the handoff (replaced for non-chat tasks) and the chat directive (step 6). |
| M4 | The wake's four sections | | every run | Done. |
| M5 | Session rotation note (`session_rotation_note`) | 0 | never here | `claude_local`'s rotation thresholds are all 0; Claude's compaction does that job. |
| M6 | Task brief (`task_brief`) | | chat tasks | Done (replaced for non-chat tasks). |
| M7 | Paperclip MCP note (`mcp_note`) | 333 | fresh sealed sessions | "Start with `paperclip_task_context`" now contradicts the wake, which gives the task. Its end-of-run line is the only one most fresh runs get. Shared with ACP (`renderPaperclipMcpNote`, `packages/adapter-utils/src/server-utils.ts`). |
| M8 | Heartbeat template (`heartbeat_template`) | 2,698 | fresh, or resumed with no wake; not recovery | Upstream's original whole-run prompt (`promptTemplate`). Since 2026-10-03 the default is an identity line ("You are agent <uuid> (<name>).", 75) plus `CONNECTION_INTENT_AGENT_GUIDANCE` (2,623), which teaches `connections_search` and `connection_request`: tools of the Runner's runtime-tools server (`/mcp/runtime-tools`), not in the run's Paperclip MCP catalog. Last in the message. The chat default is the same text. |

## Goals, non-goals, anti-goals

- **Goals:**
  - M8 becomes one short identity line, sent first.
  - M1 becomes one line.
  - M7 stops contradicting the wake and keeps the one end-of-run rule.
  - M2 and M5 stop being read by `claude_local`, once server1 confirms no agent uses M2.
  - The record, the builder and the preview keep matching the sent text (`matchedPlan`).
- **Non-goals:**
  - Moving anything into the system prompt (the next batch).
  - The `paperclip` skill, bugs 90 and 92.
  - The chat directive (bug 86, step 6) and chat's handoff and brief.
  - Bug 88 (the instruction working-copy guidance): its text names Runner tools
    (`read_agent_instructions` and others) and has never reached a `claude_local` task run; it's
    decided with the system prompt batch.
  - ACP and the dormant adapters: they keep the shared texts (`renderPaperclipMcpNote`,
    `DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE`) unchanged. "`claude_local`" in this design means
    its CLI engine (`claude --print`), the engine the code picks when `engine` is unset
    (`normalizeEngine` in `acp.ts`), as in the wake, handoff and brief batches; the record and
    preview are CLI-only too (`attach-claude-run-prompt.ts`). The server1 check shows whether any
    agent there sets `engine: "acp"`.
  - The `paperclip` skill's "Every run" step 2 ("Load the task: `paperclip_task_context` gives the
    task…"), which now disagrees with the tools note. Skills are part of the system prompt's
    bundle, so it changes with the skill's re-evaluation in the system prompt batch.
- **Anti-goals:**
  - An agent that stops ending its runs properly (`paperclip_finish`, `paperclip_block`,
    `paperclip_report_progress`).
  - An agent whose own `promptTemplate` silently stops being sent.
  - A system prompt change in this batch: it would reset every agent's session.

## Constraints

- **The first message only.** The system prompt's bundle key must not change, so nothing in
  `planClaudeRunSkillsAndInstructions`'s system-prompt sections changes, including
  `INSTRUCTIONS_LOCATION_NOTE` ("Use the agent instruction file location supplied in the current
  run prompt…"), which the new M1 line still satisfies.
- **CLI, builder and preview agree:** `composeClaudeCliPrompt`, `build-claude-run-prompt.ts` and
  `run-preview-prompt.ts`.
- **server1 facts come from read-only queries,** shown to the user first ([below](#the-server1-check)).
- **The usual real-run rules:** the desktop dev instance, "M7 test sealed runner" (paused between
  runs), "M7 test" tasks; never Bob, never server1.

## Approaches

- **A. Trim in place (chosen, 2026-11-25).** Each piece is cut, corrected or dropped where it is,
  in the first message. Small, no session resets, and the system prompt batch then moves what's
  standing in one deliberate step.
- **B. Move the standing text now.** The identity line and the Paperclip tools note go into the
  system prompt, which needs bug 90 fixed in the same batch (otherwise they vanish after a
  compaction) and resets every agent's session once at the next deploy. Larger, and it would
  decide the system prompt's shape before the skill's re-evaluation.

## The design

### The first message's shape

A fresh assignment run on a non-chat task:

```
You are M7 test sealed runner, QA engineer.                        (heartbeat_template)
Your instructions file this run is <path>/AGENTS.md; resolve        (instructions_directive)
relative paths in it from <path>/.
Work with Paperclip through the `paperclip_*` tools …                (mcp_note)
## What happened                                                    (what_happened)
## Where things stand                                               (where_things_stand)
## The task                                                         (the_task)
## What to do now                                                   (to_do)
```

The order changes: the identity line, the instructions location and the tools note come first, so
the wake ends the message and "What to do now" is the last thing the agent reads. The chat
sections (communication guidance, task brief) keep their place relative to the wake.

### Who you are (M8)

- **No `promptTemplate` set:** one line, built in code, not from a template string:
  `You are <name>, <title>.`, or `You are <name>.` when the agent has no title. No UUID (the
  agent can get it from `paperclip_me`).
- **The connection guidance is not sent** by `claude_local`'s CLI engine, in task runs or chat.
- **The agent's title** reaches the adapter: the server adds `title` to the agent object it passes
  (`AdapterAgent` gains an optional `title`).
- **An agent's own `promptTemplate`** is still rendered and sent as today, in the same slot (now
  first). The server1 check shows whether any agent has one.
- **When it's sent** stays as today: fresh sessions, and resumed ones with no wake; not on recovery
  wakes.

### The instructions location (M1)

One line, sent when it is today (every run that read an instructions file, since a managed
bundle's working copy can move between runs):

```
Your instructions file this run is /…/instructions/AGENTS.md; resolve relative paths in it from /…/instructions/.
```

It drops the three example file names and "do not resolve those from the parent agent directory".
"This location replaces any instruction file location from earlier turns" is implied by "this
run". The exact form (both paths, or the folder once) is [left to the builder](#left-to-the-builder).

### The Paperclip tools note (M7)

A `claude_local` text of its own (ACP keeps `renderPaperclipMcpNote`), sent as today (fresh sealed
sessions with API access, not external chat turns):

```
Work with Paperclip through the `paperclip` MCP server's `paperclip_*` tools, not HTTP requests. This message has what's new and the task; `paperclip_read_task` and `paperclip_task_context` read more when you need it.
End the run with `paperclip_finish`, `paperclip_block` (if you're waiting on someone) or `paperclip_report_progress` with `continue: true`.
PAPERCLIP_API_KEY is there for scripts that need the REST API.
```

- **"Start with `paperclip_task_context`" goes.** The wake gives the task; the tools are for more.
- **The end-of-run line stays** for runs on a non-chat task. Only the `continue` and
  `run_unfinished` wakes carry one of their own; every other fresh run relies on this one. Its
  wording matches the `continue` wake's.
- **No end-of-run line on a chat task** (`conversationMode`), which ends with its reply, **or on a
  recovery wake**, whose own rules (hand the task back, resolve the recovery action) would conflict
  with "`paperclip_finish`". Those runs get the first and last lines only. Today's note sends it to
  both.
- **The heading** "Paperclip API access note:" goes.

### The bootstrap template (M2) and the rotation note (M5)

- **M5:** `claude_local` stops reading `paperclipSessionHandoffMarkdown`. It's set only when the
  server rotates a session, and `claude_local`'s default thresholds are all 0; an agent could turn
  rotation on with a `runtimeConfig` override (`heartbeat.sessionCompaction`,
  `heartbeat.sessionRotation` or `sessionCompaction`; `resolveSessionCompactionPolicy`), which the
  server1 check looks for. If one has it, the design comes back to the user. ACP still reads the
  note.
- **M2:** if the server1 check finds no `claude_local` agent with a `bootstrapPromptTemplate`,
  `claude_local` stops reading it. If it finds one, the design comes back to the user with its
  text, to move into that agent's `AGENTS.md` or keep.
- **The section ids stay** in `RunPromptSectionId`, for older records.

### The server1 check

Before building, one read-only query against server1's `paperclip-db-1`, in a read-only
transaction, over `ssh server1`. It lists every agent that still sets either template, with the
first 200 characters of each, its engine, and any session-rotation override:

```sql
BEGIN READ ONLY;
SELECT a.name,
       a.adapter_type,
       a.status,
       length(a.adapter_config->>'promptTemplate')          AS prompt_template_chars,
       left(a.adapter_config->>'promptTemplate', 200)       AS prompt_template_start,
       length(a.adapter_config->>'bootstrapPromptTemplate') AS bootstrap_chars,
       left(a.adapter_config->>'bootstrapPromptTemplate', 200) AS bootstrap_start,
       a.adapter_config->>'engine'                           AS engine,
       a.runtime_config->'heartbeat'->'sessionCompaction'    AS heartbeat_session_compaction,
       a.runtime_config->'heartbeat'->'sessionRotation'      AS heartbeat_session_rotation,
       a.runtime_config->'sessionCompaction'                 AS session_compaction
FROM agents a
WHERE a.adapter_config ? 'promptTemplate'
   OR a.adapter_config ? 'bootstrapPromptTemplate'
   OR a.adapter_config ? 'engine'
   OR a.runtime_config->'heartbeat' ? 'sessionCompaction'
   OR a.runtime_config->'heartbeat' ? 'sessionRotation'
   OR a.runtime_config ? 'sessionCompaction'
ORDER BY a.adapter_type, a.name;
ROLLBACK;
```

**Ran 2026-11-25: no rows.** server1's five agents are all `claude_local`, none sets a template, an
engine or a rotation override, so the design stands as written.

- **No rows, or only `engine` set to `cli`/`auto`:** the design stands as written.
- **A template:** shown to the user, who decides per agent (move into `AGENTS.md`, or keep the
  template as an override).
- **`engine: "acp"` or a rotation override:** shown to the user before building; the first means
  this batch doesn't reach that agent, the second that dropping M5 would lose its rotation note.

### Sections in the record and the preview

- **Labels:** `heartbeat_template` shows as "Who you are" with the default line, and as "Prompt
  template (agent setting)" when the agent sets its own. `mcp_note` shows as "Paperclip tools".
  The ids don't change.
- **Parts:** the `heartbeat_template.connection_guidance` part goes; `heartbeat_template.identity`
  remains for the default line.
- **The preview** drafts the same text (it already reads the agent).
- **ui-new:** no change needed beyond the labels, which come from the server.

### How it's checked

- **Tests:**
  - the composer and builder for a fresh assignment, a comment (resumed), a chat turn, a recovery
    wake and a no-task run: the new order, the identity line with and without a title, an agent
    with its own `promptTemplate`, no connection guidance, no rotation note;
  - `matchedPlan` stays true on each;
  - the preview's draft matches a real run's sections (the existing comparison test).
- **The local checks** on the branch's final commit.
- **Real runs** on the desktop dev instance with "M7 test sealed runner": one fresh assignment on
  a small "M7 test" task, then a comment on it (resumed). They pass if the agent works the task
  and ends each run with one of the three closing calls. Whether it still calls
  `paperclip_task_context` first is recorded, not judged: the skill still tells it to.

## Left to the builder

- Whether the identity line is a template string rendered with `renderTemplate` or composed in
  code; either way it must not print an empty title.
- The M1 line's exact form: both absolute paths, or the folder once and the file relative to it.
  It must keep saying that relative paths resolve from that folder.
- How the agent's `title` reaches the adapter's template data (`AdapterAgent`, or the run context).
- How to split the work into branches (likely one: the adapter's composer and texts, the server's
  builder, preview and agent `title`, and their tests).

## Calls made in this design

Made in drafting, not discussed. Correct any of these:

- **The order changes:** the identity line, the instructions location and the tools note move
  before the wake, so "What to do now" is last.
- **The identity line has the name and job title, not the UUID.**
- **The tools note keeps its end-of-run line,** since most fresh runs have no other.
- **ACP keeps the shared texts unchanged;** the new texts are `claude_local`'s own.
- **The chat template loses the connection guidance too** (it's the same text, and the same tools
  are missing).
- **Bug 88 waits** for the system prompt batch.
- **No end-of-run line on chat tasks and recovery wakes** (after the builder check).
- **The skill's "Load the task" step stays** until the system prompt batch, so the real runs
  don't judge whether the agent calls `paperclip_task_context` (after the builder check).
- **The server1 check also reads each agent's engine and any session-rotation override** (after
  the builder check).
- **Labels:** "Who you are" and "Paperclip tools".
