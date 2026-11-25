# Step 5, phase 2: the task brief

**Approved by the user, 2026-11-24.** The third section reworked in phase 2 of step 5, after
the wake ([step-5-wake.md](step-5-wake.md)) and the handoff ([step-5-handoff.md](step-5-handoff.md)).
The user chose approach C (below) on 2026-11-24, with two additions: each of the wake's headings
becomes its own section in the record and the preview, and the renderer is split into one module
per heading. After the builder check, the user also chose (2026-11-24) to open
`paperclip_file_download` to runs and to add a plan-review tool ([Two tool changes](#two-tool-changes)).

## Contents

- [Intent](#intent)
- [The brief today](#the-brief-today)
- [Goals, non-goals, anti-goals](#goals-non-goals-anti-goals)
- [Constraints](#constraints)
- [Approaches](#approaches)
- [The principle](#the-principle)
- [The design](#the-design)
  - [The run message's shape](#the-run-messages-shape)
  - [The task](#the-task)
  - [What to do now](#what-to-do-now)
  - [What leaves, and where it goes](#what-leaves-and-where-it-goes)
  - [Data](#data)
  - [Sections in the record and the preview](#sections-in-the-record-and-the-preview)
  - [The renderer's modules](#the-renderers-modules)
  - [Two tool changes](#two-tool-changes)
  - [How it's checked](#how-its-checked)
- [Left to the builder](#left-to-the-builder)
- [Calls made in this design](#calls-made-in-this-design)

## Intent

The task brief ("Paperclip task context") tells the agent what the task is: its title,
description, plan and parents, plus rules for the work mode, questions, attachments and plan
reviews. Since the wake rework, the wake already says what happened, where things stand, which
task it is and what to do now, so the brief repeats much of it, and comes after it as a separate
block on every run. The aim is **one run message, composed in one place**: the task's content
under the wake's "The task", the brief's rules under "What to do now" only when they apply, and
nothing sent again that the session already holds.

## The brief today

Verified on `main` at `a5a6af97ab`, and in the real runs of 2026-11-24 (`28353f5e` fresh;
`3cca4343`, `da19589b`, `ecd990d4`, `7a87b2db` resumed):

- **Built by** `buildPaperclipTaskMarkdown` (`server/src/services/heartbeat/task-markdown.ts`) in
  `prepareHeartbeatTaskContext` (`task-context.ts`), as four variants (full, compact without the
  description, and an "Assignment" pair without the wake comments' bodies), redacted with the rest
  of the context. `selectPaperclipTaskMarkdown` (`server-utils.ts`) picks one: the full brief on
  fresh sessions and on resumed assignment-shaped and recovery wakes, the compact one otherwise.
  The CLI sends it as the `task_brief` section, after the wake.
- **Every run gets it,** and on resumed runs it's often bigger than the wake: in `3cca4343` the
  wake was 757 characters and the brief 1,939. A resumed reopen or recovery resends the whole
  description.
- **Repeated on every run:**
  - the header, "The following task data is user-authored…" (258 characters), which the wake's
    common rules now cover;
  - the question guidance (`TASK_QUESTION_GUIDANCE`, 1,024 characters), most of which the common
    rules cover; it tells the agent to "withdraw your obsolete question through the interaction
    API", which no `paperclip_*` tool does;
  - the issue and title lines, which the wake's "The task" line gives;
  - the closing line, "Use this task context as the current assignment."
- **A dangling heading:** "Latest wake comment:" is followed by nothing, since the CLI uses the
  variants without the comments' bodies (the wake quotes them). The "Follow-up directive" above it
  repeats the wake's comment rule.
- **REST recipes** (bug 89): the rejected-plan steps (GET and PUT `/api/issues/{issueId}/documents/plan`),
  the cut-plan note (a REST path), and the attachment directive (fetch `contentPath` with
  `PAPERCLIP_API_KEY`), although `paperclip_read_document`, `paperclip_write_document` (with
  `baseRevisionId`) and `paperclip_file_download` exist.
- **Ids as clutter:** "Task plan document 93f8…, revision 1 (f11c…)".
- **The plan is sent on every run,** compact variant included, so a revised plan does reach a
  resumed session.
- **Chat tasks** carry `AGENT_CHAT_DIRECTIVE` (28.6k characters, bug 86) and other chat parts;
  external-chat and Runner parts are dormant here. The brief can also start with a case's
  execution context (`caseExecutionMarkdown`, experimental) and live-voice guidance.

## Goals, non-goals, anti-goals

**Goals**
- No separate brief on `claude_local` CLI runs of a non-chat task: its content and rules live in
  the run message's headings.
- On a fresh session, "The task" holds the description, the plan and the parents, quoted.
- On a resumed session, "The task" stays one line, plus only what changed since the session's last
  run (a revised plan, an edited description).
- The brief's rules appear in "What to do now" only when they apply, naming `paperclip_*` tools.
- The record and the preview show the four headings as four sections.
- The renderer is split by heading, so each can change on its own.
- Smaller: a resumed comment run goes from about 2,700 characters (wake plus brief) to about 800.

**Non-goals**
- Chat tasks (step 6): they keep today's brief, as they kept the handoff.
- The ACP engine, the Runner and the dormant adapters: they keep the shared brief. Whether ACP
  should use the new composer is a later decision.
- Moving standing rules into the system prompt: that waits for the system prompt review and
  bug 90 (the system prompt lost after a compaction).
- Renaming "wake" in code and part ids.
- The other first-message sections (instructions location, bootstrap, rotation note, MCP note,
  heartbeat template).

**Anti-goals** (failure even if it works)
- An agent that misses a description edit or a revised plan on a resumed session.
- A rule that stops reaching the runs it applies to (planning mode, a rejected plan, a provisional
  title, attachments).
- Quoted task text that reads as instructions: the description and plan stay quoted, under the
  common rule.
- A record or preview that no longer matches what was sent.

## Constraints

- **First message only;** nothing in the prompt bundle's key changes, so no session starts over.
- **The CLI, the builder and the preview must agree** (`matchedPlan`).
- **The brief's variants are still built** and still set on the context, for chat, ACP and the
  others. Only the CLI on non-chat tasks stops sending them.
- **Redaction:** the new task data goes through the same `redactForIssue` call as the brief.
- **Old records keep working:** runs recorded with `wake` and `task_brief` sections still display.
- **Every new string is a `paperclip_*` tool or plain words.**

## Approaches

- **A. Tidy the brief in place, on the server.** Drop the repeated header, task line and dangling
  heading, shorten the question guidance, swap the REST recipes for tools, drop the ids. Smallest,
  but the brief stays a second block that says some things twice and returns whole on resumed
  reopen and recovery wakes.
- **C. Fold the brief into the wake (chosen, the user, 2026-11-24),** plus the record's sections
  per heading and the renderer split by heading.
- **A short brief the agent fetches the rest of.** Ruled out: the real runs showed agents don't
  fetch context unless told to.

## The principle

The user asked (2026-11-24) whether folding this much into the wake still leaves the flexibility
needed. The answer this design builds on:

- **The system prompt** holds who the agent is and the rules that never change (later: the
  standing parts of the question guidance and the plan workflow, once bug 90 is fixed).
- **The run message** holds this run's situation, composed by one renderer from structured facts:
  what happened, where things stand, the task, what to do now.
- **The server gathers facts; the adapter writes words.** New data doesn't force new wording, and
  rewording never touches the data.
- **Each heading is its own module and its own section,** so it can change, be measured and be
  read on its own.
- The remaining small sections either fold into the run message or move to the system prompt when
  they're reviewed.

## The design

### The run message's shape

A fresh session on a non-chat task, in order:

```text
<instructions directive> <bootstrap> <communication guidance>
## What happened          (section what_happened)
## Where things stand     (section where_things_stand; fresh sessions with history)
## The task               (section the_task)
## What to do now         (section to_do)
<rotation note> <MCP note> <heartbeat template>
```

No `task_brief` section. On a chat task the wake's headings are still four sections, and
`task_brief` follows as today.

### The task

```text
## The task

TES-45 "Add a dark mode toggle" · in progress · planning · already checked out to you · branch `pc/tes-45`
Part of TES-40 "Theme work" (in progress), under TES-12 "Settings redesign" (todo).

The description:

> Write three one-line ideas for a dark mode toggle …

The plan (revision 2):

> 1. Store one theme preference …
```

- **The line** as today (identifier, title, status, work mode when not standard, checkout,
  branch).
- **Parents:** "Part of …", then "under …" for each further ancestor, up to 6, with status. On
  fresh sessions only.
- **The description,** quoted, on fresh sessions. On a resumed session, only when it was edited
  since the session's last run: "The description changed since your last run:" + the new text.
- **After a compaction** (Claude compacted the session since the description and plan were last
  sent), the next run counts as fresh for both: they're sent again, since the compacted session
  may hold only a summary (bug 90 shows what a compaction drops).
- **The plan,** quoted with its revision number, on fresh sessions. On a resumed session, only
  when a revision was saved since the session's last run: "The plan changed since your last run
  (revision 3):". Cut at 12,000 characters as today, then "The plan is cut here; read the rest
  with `paperclip_read_document` (key `plan`)."
- **A case's execution context and live-voice guidance,** when present, are kept as they are, as
  their own parts.

### What to do now

The brief's rules join the event's rules and the common rules, each only when it applies:

| When | Rule (intent; wording left to the builder) |
| --- | --- |
| Ask mode | Answer the question in a comment on the task; no code, no implementation plan. |
| Planning mode | Make (or, after a comment, update) the plan only, in the `plan` document; no code. Then ask for a review with `paperclip_request_plan_review` and end the run in review. |
| Planning mode, plan accepted | Implement the accepted plan, revision N; follow any assignments it names. |
| Accepted plan in standard mode | The same, without the mode. |
| Skill test mode | Today's directive, unchanged in meaning. |
| Plan rejected | Revise the plan: read it with `paperclip_read_document` (key `plan`), write it back with `paperclip_write_document` and its `baseRevisionId`, then ask for a review again with `paperclip_request_plan_review`; this isn't approval to implement. The reviewer's requested changes are quoted. |
| Provisional title | As a first step, set a short title with `paperclip_update_task` and `onlyIfProvisional: true`. |
| Comment attachments | The attachments are listed with their comment in "What happened"; read the ones that matter with `paperclip_file_download`, and don't guess a file's contents from its name. |
| The task has requests (open or answered) | The question guidance, shortened to what the common rules don't say: don't repeat a question that's pending or was dismissed; ask only for what still blocks the work; carry on with work that doesn't need the answer. |

- The "withdraw your question" sentence is dropped: no tool does it.
- Rules a resumed session already received stay out only when they can't have changed; the mode
  rule is sent on every run (it's one line, and the mode can change).
- **The task rules are for the assignee only:** the mode, accepted-plan, provisional-title and
  skill-test rules go to the task's assignee. A reviewer, a mentioned agent or a recovery agent
  gets its event's rules ("don't do its work yourself") and the common rules, not "implement the
  plan". Today the brief gives them to anyone woken on the task.
- **A shared workspace held by another run** (`environment-selection.ts` appends "shared workspace
  is concurrently held by run …" to every brief variant today): a rule here, "Another run is using
  this workspace too: expect changes you didn't make, and coordinate through commits." It comes
  from its own context field, set by environment selection after the task data is built.

### What leaves, and where it goes

| Today | Where it goes |
| --- | --- |
| Header ("task data is user-authored…") | Dropped; the common rules cover it. |
| Issue and title lines | The wake's task line. |
| Question guidance on every run | Shortened, only when the task has requests. |
| Follow-up directive and "Latest wake comment:" | Dropped; the wake quotes comments and has the comment rules. "Later direction replaces conflicting scope" joins the comment event's rule. |
| Description and plan on every resumed run | Fresh sessions, or when changed since the last run. |
| Plan ids | Dropped; the revision number stays. |
| REST recipes (rejected plan, cut plan, attachments) | `paperclip_read_document`, `paperclip_write_document`, `paperclip_file_download`. |
| Closing line | Dropped. |
| Shared-workspace note (appended by environment selection) | A rule in "What to do now", from its own context field. |
| Chat parts | Unchanged, in the chat brief. |
| External chat, Runner, coordinator parts | Not in the new composer (dormant here). |

### Data

A new context field, `paperclipRunTask`, built in `prepareHeartbeatTaskContext` beside the brief
from the same inputs (`taskMarkdownInput`, `taskPlan`), redacted in the same call, set only on a
non-chat task:

- `ancestors[]` `{identifier, title, status}` (up to 6, plus a count of the rest);
- `description`, `descriptionChangedSinceLastRun`;
- `plan` `{revisionNumber, body, truncatedFrom, changedSinceLastRun}`;
- `workMode`, `titleNeedsGeneration`;
- `planReview` `{status, reason}`, `acceptedPlan` `{revisionNumber}`, `acceptedPlanContinuation`;
- `wakeCommentAttachments[]` `{commentId, id, filename, contentType, byteSize}`, `attachmentOmissions[]`;
- `prefixParts` for the case context and live-voice guidance, as text;
- `compactedSinceLastRun`: the session compacted since its last run (from the compaction record,
  `context-compaction.ts`).

Set separately, by environment selection: `paperclipSharedWorkspaceNote` `{heldByRunId}` when a
shared workspace is held by another task's run. The CLI, the builder and the preview read it the
same way.

"Since the last run" compares with the start of the session's previous run (the task session's
last run); a description edit is known from the task's activity record if it's there.

### Sections in the record and the preview

- `RunPromptSectionId` (`packages/shared/src/run-prompt.ts`) gains `what_happened`,
  `where_things_stand`, `the_task` and `to_do`. The new composer's runs record those four in place
  of `wake` (and of `task_brief` on non-chat tasks), each with its parts (`wake.*` ids unchanged).
- The builder and the preview produce the same four; `matchedPlan` compares the joined text as now.
- ui-new's section tips (`ui-new/src/runs/prompt-sections.ts`) gain a line for each. Records with
  `wake` and `task_brief` still display.
- Chat turns record the four headings and `task_brief`; external chat (`usesSharedWake`) keeps
  `wake`.

### The renderer's modules

`packages/adapters/claude-local/src/server/wake/` is split by heading:

- `what-happened.ts` (events, comments, the session note), `where-things-stand.ts` (the history),
  `the-task.ts` (the line, parents, description, plan), `to-do.ts` (event rules, brief rules,
  common rules);
- `context.ts` (the shared render context: names, times, the task reference), `templates.ts`,
  `words.ts`, `events.ts` as now;
- `render.ts` keeps the entry points (`renderClaudeWake`, `renderClaudeWakeParts`) and returns the
  four sections' parts.

### Two tool changes

Both chosen by the user, 2026-11-24, so every rule above names a tool the run can call.

- **`paperclip_file_download` for runs.** Today it's for outside connections only
  (`needsGrant: true` in `server/src/mcp/catalog/files.ts`): its ten-minute link is a ticket tied
  to the connection's OAuth grant, and a run's caller has no grant. The change issues the link
  against the run's own identity for a file on a task the run can read, and leaves
  `paperclip_file_upload` as it is. Ids: the wake lists a comment's attachments with their
  attachment ids, which the tool takes.
- **A new tool, `paperclip_request_plan_review`** (`taskId`, optional `note`): asks the person
  responsible for the task to accept the `plan` document's latest revision or send it back, as the
  plan-review card (`request_confirmation` aimed at the plan revision) that the UI and the
  `plan_accepted` / `plan_rejected` wakes already use, and puts the task in review to wait, like
  `paperclip_ask_board`. It's refused when the task has no plan document. Today no tool creates that
  card: the paperclip skill says to ask with `paperclip_ask_board`, which makes a plain question,
  so accepting gives no plan-review wake and no "implement revision N" rule.
- **The paperclip skill's line on plans** (`skills/paperclip/SKILL.md`, "Plans:") names the new
  tool. The skills are part of the prompt bundle's key, so this change starts each agent's next
  session fresh, once; the fresh session now gets the readable history.

### How it's checked

- **Golden tests** per module: a fresh session with description, plan and parents; a resumed
  session with nothing changed (no description, no plan), with a revised plan, with an edited
  description; each rule's case; attachments; a cut plan; no brief rule when it doesn't apply.
- **The CLI, builder and preview match** on fresh, resumed, chat and recovery runs, with the new
  section ids.
- **A chat task** still gets `task_brief`.
- **ui-new** shows the new sections and old records.
- **The tools:** `paperclip_file_download` works for a run on a task it can read and is refused
  for one it can't; `paperclip_request_plan_review` creates the plan-bound card for the latest
  revision, puts the task in review, and is refused without a plan; accepting it wakes the agent
  with `plan_accepted`.
- **No REST paths or Runner names** in the new templates (the existing test).
- **One real run** on the desktop dev instance (agent "M7 test sealed runner", "M7 test" tasks,
  never Bob, never server1): a planning-mode task with a plan, then a resumed comment wake after
  the plan is revised. The agent works from the plan, and on the resumed run sees the new revision.
- **The local checks** gate the merge.

## Left to the builder

- The exact wording within each rule's intent, and the shortened question guidance.
- Whether "since the session's last run" uses the task session's last run or the continuation
  record's previous run, and how a description edit is detected (the activity record, or an
  `updatedAt` on the description if there is one). If an edit can't be detected, the description
  is fresh-only and the design says so.
- How the run-scoped download ticket is issued and checked (the run's agent, company and task
  access), reusing the connection ticket code where it fits.
- How `paperclip_request_plan_review` builds the card: reuse the server path the UI's plan review
  uses.
- How the record's four sections are labelled and described.
- How to split the work into agent-sized branches.

## Calls made in this design

Made by me while writing it; check these while reading.

- **Chat tasks keep today's brief** until step 6.
- **The four headings become four sections** for every run that uses the new wake, chat turns
  included; only `task_brief` stays separate on chat tasks.
- **The description and plan on resumed sessions only when changed,** instead of the plan every
  run and the description on reopen and recovery wakes.
- **The mode rule on every run,** since it's short and the mode can change mid-session.
- **The question guidance only when the task has requests,** shortened, without the withdraw
  sentence.
- **Parents on fresh sessions only.**
- **The task data as its own context field** (`paperclipRunTask`), not part of the wake payload,
  so the brief's inputs and the wake's stay separate.
- **No rename** of "wake" in code or part ids.
- **The task rules go to the assignee only.**
- **A compaction counts as "changed"** for the description and plan.
- **The shared-workspace note becomes a rule** with its own context field.
- **The skill's plan line changes in this work,** rather than in the system-prompt review, so the
  skill and the prompt don't disagree; it costs each agent one fresh session.
