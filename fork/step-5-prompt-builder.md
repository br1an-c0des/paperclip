# Step 5: one prompt builder

**Status: phase 1 built and merged into `main` 2026-11-24** (`5c3cea6c21`; [plan](step-5-plan.md); results [below](#built-2026-11-24)). **Scope: phase 1 only** (seeing the prompt). Phase 2 (changing it) is
to be decided once the current prompts can be seen. Hard-fork plan [step 5](hard-fork-plan.md#5-one-prompt-builder).
The baseline it's built on is [step-5-research.md](step-5-research.md) (how the prompt is built
today, with file references). Bugs found on the way are 84–90 in [upstream-fixes.md](upstream-fixes.md).

## Contents

- [Intent](#intent)
- [What changed from the plan's step 5](#what-changed-from-the-plans-step-5)
- [Goals, non-goals, anti-goals](#goals-non-goals-anti-goals)
- [Constraints](#constraints)
- [What Claude does with a session's prompt](#what-claude-does-with-a-sessions-prompt)
- [Approaches](#approaches)
- [The design](#the-design)
- [Phase 1: see the prompt](#phase-1-see-the-prompt)
- [Later: changing the prompt (to be decided)](#later-changing-the-prompt-to-be-decided)
- [Left to the builder](#left-to-the-builder)
- [Calls made in this design](#calls-made-in-this-design)

## Intent

**First, you want to see what a run's prompt is:** what a past run received, and what an agent's
next run *will* receive, as a draft, before anything runs. Today nobody can tell. The prompt is put
together from about a dozen sources in four packages, half in the server and half in the Claude
adapter, and stored runs keep only its first 16,384 characters.

**Changing the prompt comes after, and isn't decided.** The discussion leaned towards a leaner
prompt that orients the agent (what woke it, what kind of run this is, how to get going) and lets
it pull context through the `paperclip_*` MCP tools, since today the same description, comments
and history arrive two or three times on a fresh run. But the user wants to see what the current
prompts look like and what they're made of before deciding how far to go (decided 2026-11-23). So
this step builds the visibility, and the notes on changing the prompt are kept
[below](#later-changing-the-prompt-to-be-decided) as options, not a plan.

## What changed from the plan's step 5

The plan's step 5 (written 2026-11-16) listed COMPANY.md and a project brief in the system
prompt, and project docs in the prompt. In the design discussion (2026-11-23):

- **A general "dynamic engine" that routes text from many sources into the prompt was considered
  and dropped.** It would be more than this needs. The few things that change with the kind of run
  (chat, task, review, no task) are a handful of conditions in plain code.
- **Pull, not push, for context** (the direction discussed, not decided). Project descriptions, the Summarizer's project summaries and
  later things like agent inboxes ([build plan 3.21](../ui-new/docs/build-plan.md#321-agent-inboxes-a-recent-changes-feed-for-agents))
  are read through the MCP tools, so they're never stale in a long session. So:
  - **The project brief** becomes "`paperclip_task_context` returns the project's and goal's
    descriptions and the project summary" (F6). It's not a prompt section.
  - **COMPANY.md** ([3.14](../ui-new/docs/build-plan.md#314-company-instructions-companymd)) stays
    a later, small addition to the system prompt. Not step 5 work, but the builder leaves a place
    for it.
- **Visibility first, and only visibility for now.** The prompt doesn't change in this step.

## Goals, non-goals, anti-goals

**Goals**

1. A past run shows its **whole prompt**, split into **labelled sections**: what each is, why it
   was included, where its text came from, its size, and whether it went in the system prompt or
   the first message.
2. An agent's settings show a **draft of its next run's prompt** for a chosen task and kind of run,
   from the same code a real run uses, without starting or writing anything.
3. **One builder in the server** owns the first message of every `claude_local` CLI run, with its
   text in template files in a fixed, documented order.
4. **Every agent receives exactly what it receives today.** The builder reproduces today's prompt
   byte for byte; only how it's built, recorded and shown changes.

**Non-goals**

- Changing what the prompt says: slimming, orientations, moving context into the tools, and the
  prompt bugs 84–86, 88 and 89. Decided later
  ([below](#later-changing-the-prompt-to-be-decided)).
- Bug 90 (instructions lost after a compaction). It changes what agents receive, so it's its own
  fix, on its own branch, once the user signs off on it.
- COMPANY.md, project documents (3.4) and agent inboxes (3.21). The builder has places for them;
  they're built later.
- The ACP engine, the Paperclip Runner and the other adapters. They keep today's prompt path,
  untouched (hard-fork step 3).
- Chat as its own concept and live sessions (step 6). Step 5 shouldn't box them in (see
  [The design](#the-design)).
- Editing prompt text in the UI. There is no "prompt items" page: you see the prompt, you don't
  compose it.
- The leftovers from removing `ui/` (board links in agent guidance, the `paperclip-board` skill).
  They stay a separate piece of work.

**Anti-goals** (a failure even if it works)

- A preview that differs from what the run actually gets, because it was computed by different code.
- A preview that writes files, mints tokens, checks out a task or changes the database.
- This step changing what agents receive. It only shows the prompt.
- A deploy that resets every agent's Claude session. Changing the system prompt does that, because
  the prompt bundle's key gates `--resume`.
- A framework for sections (plugins, a registry with its own configuration language, sections
  stored in the database). Sections are plain code and template files.

## Constraints

- **Only `claude_local` on the CLI engine** (the default since 4b), on sealed runs.
- **Same code for the run and the preview** (as in 4b part 2,
  [step-4b-parts-2-3.md](step-4b-parts-2-3.md#approaches-considered-part-2)).
- **Redaction stays as strict as today.** Task text is redacted for the issue's registered secrets
  (`redactForIssue`) before it reaches a prompt. Stored run events go through key-name and
  current-user redaction.
- **The system prompt is content-addressed.** A change to `<bundle>/agent-instructions.md` changes
  the bundle key, and every agent's next run starts a fresh session.
- **Tests land in core** (CLAUDE.md). The shared renderer's tests, and ACP's, keep passing
  unchanged.
- **No migration is expected.** If one turns out to be needed, it continues the numbered sequence,
  and its deploy backs up server1's database first.

## What Claude does with a session's prompt

Tested by hand on 2026-11-23, Claude Code 2.1.325, with the sealed run's flags (bug 90 has the
details):

- **System prompt:** saved with the session when it starts, and restored on every `--resume`.
  A different `--append-system-prompt-file` passed on resume is **ignored**. After a
  **compaction**, the saved copy is rebuilt on the next call from that call's own flags. Sealed
  runs pass the file only on fresh sessions, so after a compaction the agent's instructions are
  gone (bug 90).
- **First message:** after a compaction, it survives only as Claude's summary of it.

So, for every section, the design has to say how it's delivered:

| Delivery | Fits | Lost when |
| --- | --- | --- |
| **System prompt** | Who the agent is: `AGENTS.md`, the skill list, later COMPANY.md | Never, once bug 90 is fixed. Fixed for the session: an edit reaches it only in a fresh session. |
| **First message, every run** | What woke this run, and the pull instruction | Not lost: it's sent again each run |
| **First message, fresh sessions only** | Today's guidance, handoff and heartbeat template | A compaction (only the summary is left) |

Behaviour that has to last a whole session, like the chat orientation, can't rely on "fresh
sessions only". If the prompt is changed later, such text goes in the system prompt
([below](#later-changing-the-prompt-to-be-decided)). For this step, the preview and the record show
each section's delivery, so this is visible.

## Approaches

| | Approach | Trade-off | |
| --- | --- | --- | --- |
| **A** | **One builder in the server.** It takes the run's facts and returns the finished first message as labelled sections. The adapter only carries it to Claude. | The preview is the same call, and labels are built in. The adapter's pieces (the instructions directive, the MCP note, the heartbeat template) move into the server. The ACP engine and the dormant adapters keep reading today's context fields, so the server still produces those for them. | **Chosen** (2026-11-23) |
| B | The builder inside the Claude adapter, still reading today's server fields | A smaller first change, but slimming needs server changes anyway, since the duplication is in what the server produces. A preview needs the server's pieces and the adapter's. Labels across that boundary are harder. | |
| C | One shared builder in `adapter-utils` replacing the renderer for every adapter | Drags in ACP, the Runner and the dormant adapters, with their tests. Against "leave unused code alone". | Dropped |

## The design

### The builder

A new server module, `server/src/services/run-prompt/`.

- **Input:** the run's facts:
  - the kind of run;
  - the wake event;
  - the task;
  - the agent;
  - the project;
  - the settings;
  - whether a session may resume.

  In this step the facts are today's context fields (the wake payload, the brief variants, the
  guidance and handoff text, the agent's templates), so the output matches today exactly. If the
  prompt is changed later, the facts can become the builder's own typed object.
- **Output:** an ordered list of sections. Each section has:
  - `id`, a stable name, for example `wake.comment` or `orientation.chat`;
  - `placement`: `system` or `first_message`;
  - `delivery`: `every_run`, `fresh_only` or `resumed_only`;
  - `reason`: why it was included, in a short phrase ("woken by a comment", "a chat turn");
  - `source`: where its text came from (a template file, a stored field, the agent's
    `AGENTS.md`);
  - `text`;
  - `chars`;
  - `pending`: optional, for a value filled in only at launch (see [the preview](#the-next-run-preview)).
- **Templates:** Markdown files with `{{placeholders}}`, one per section, beside the builder, in a
  fixed order written down in the module's README. A section that needs logic (a list of comments,
  say) uses a small typed function that fills its template.
- **Conditions** are plain code in the builder: which kind of run, what woke it, whether it's a
  chat. No configuration language.
- **Fresh or resumed is settled at launch.** The server can't always know: the adapter may still
  refuse a resume, for example over a bundle key or cwd change, and fall back to a fresh session.
  So the builder returns sections for both cases, tagged by `delivery`. The adapter picks the set
  for what actually happens, and the record says which went out.

### The system prompt

The system prompt stays built where it is today: the adapter's
`planClaudeRunSkillsAndInstructions` (`packages/adapters/claude-local/src/server/run-plan.ts:508`),
which already writes nothing and is shared by the run and the preview. The builder doesn't build
it in step 5, but it **lists** it: the adapter reports the system prompt's parts (the agent's
`AGENTS.md`, the skill-library list) as sections with `placement: system`, so the record and the
preview show the whole prompt in one place.

COMPANY.md, when it comes, is one more part there. Moving the system prompt into the builder is
left for that point, since anything added there changes the bundle key and resets sessions once.

### Where it runs

The heartbeat calls the builder once the run's context is complete: after the workspace stage, the
branch patch and dispatch's `questionResponse` (the last changes the research found:
`heartbeat.ts` ~3397–3407, `runtime-execution.ts:805-834`). It puts the result on the run's
context for the adapter. The `claude_local` CLI path joins the sections it's given, in place of
today's join (`execute.ts:925-962`). The ACP engine and the other adapters read today's fields as
before.

### The record

Each run records its prompt sections in full: the ids, labels, delivery and text actually sent. The
16,384-character cut in run event storage (`heartbeat/run-log.ts:7`) doesn't apply to them (bug
87). They go through the same key-name and current-user redaction as other run events. The
`adapter.invoke` event keeps its current shape, since four places read it (research section 4).
How the sections are stored is the builder's call; see [Left to the builder](#left-to-the-builder).

### The next-run preview

The run preview read (`GET /api/agents/:id/run-preview`,
[`run-preview.ts`](../server/src/services/run-preview.ts)) gains a prompt.

- **What you choose:** a task (optional) and a kind of run:
  - **fresh assignment** (the default);
  - **comment on the task**;
  - **chat turn**;
  - **no task**, when no task is chosen.

  The preview builds the facts for that situation without side effects and calls the same builder.
- **Values known only at launch,** such as the checkout, the branch name and the working-copy path,
  come back as `pending` placeholders with a note, the way 4b's preview shows secret names but not
  their values.
- **Why it's more than an extension of today's read:** today's preview has no task or wake in its
  context at all. And `prepareHeartbeatTaskContext` writes nothing to the database, but the prompt
  depends on fields that later heartbeat stages patch in (research section 3.7). Phase 1 has to
  split those stages into a part that plans and a part that acts, as 4b part 2 did for the launch.

### In `ui-new`

- **A past run's Input** (`ui-new/src/runs/RunInput.tsx`) shows the prompt as sections: system
  prompt, then first message. Each section shows its id, reason, source and size, and can be
  folded. The whole text can still be copied.
- **The agent's "What runs get" card** (`ui-new/src/agents/settings/RunPreviewCard.tsx`) gains a
  Prompt part: pick a task and a kind of run, and see the draft in the same section view, with
  pending values marked.
- Help text goes behind "i" tips (decision 52). The design follows `ui-new/docs/design/`.

### Room for later

- **Step 6 (first-class chat):** "a chat turn" is a kind of run with its own sections. When chat
  gets its own tables, only the facts the builder reads change, not the builder.
- **COMPANY.md:** a system-prompt part.
- **Memory recall** (3.5, the Hindsight proposal): a first-message section with
  `delivery: every_run`, which the proposal already places beside the wake.

## Phase 1: see the prompt

Nothing agents receive changes.

1. **The builder, reproducing today's prompt exactly.**
   - Today's 8 first-message sections become builder sections, split further where one of
     today's sections joins several sources (the wake, for example, shows its parts: the comments,
     the continuation, the review threads), so you can see what each is made of.
   - Golden tests check the builder's output against today's join (`execute.ts:925-962`), byte for
     byte, on the same inputs, for each kind of run in research section 3.1: fresh, resumed,
     comment, chat turn, recovery, routine, no task, approval, inbox answer and execution stage.
     The known bugs (the `"null"` brief, bug 84, for one) are reproduced, not fixed, and the
     section view makes them visible.
   - The CLI path switches to the builder's output.
2. **The record:** sections stored in full and labelled (bug 87).
3. **The next-run preview:** the read-only facts and the prompt in the run-preview read, plus the
   shared type in `packages/shared`.
4. **`ui-new`:** the section view in a past run's Input and in the "What runs get" card.

## Later: changing the prompt (to be decided)

**Not approved; to be decided** once the current prompts can be seen in the UI (2026-11-23). Kept
here as the options discussed, so the decision starts from them.

**Started 2026-11-24 as phase 2,** one section at a time: the wake is designed and built
([step-5-wake.md](step-5-wake.md)), then the handoff ([step-5-handoff.md](step-5-handoff.md)), then the task brief ([step-5-brief.md](step-5-brief.md)), then the light sections ([step-5-light.md](step-5-light.md)), then the system prompt with the `paperclip` skill ([step-5-system-prompt.md](step-5-system-prompt.md)).

- **Ideas discussed:**
  - drop text for features this setup doesn't use (about 10 of the renderer's 33 sections can't
    fire here, research section 3.3; connections are live since 4b, so their text is checked, not
    assumed dead);
  - pull, not push: a shorter task brief, with the description, history and plan body read through
    `paperclip_task_context`, which would gain the project's and goal's descriptions and the
    project summary (F6);
  - short orientations by kind of run (chat, review, recovery, no task), and the 28.6k chat
    directive cut down and sent once per session (bug 86);
  - the prompt bugs 84, 85, 88 and 89;
  - `promptTemplate` and `bootstrapPromptTemplate` no longer applying to `claude_local` CLI runs,
    with any non-default value moved into the agent's `AGENTS.md`;
  - `promptMetrics` fixed or retired in favour of the sections' own sizes;
  - **the core `paperclip` skill re-evaluated and perhaps reorganized** (the user, 2026-11-24).
    It's listed in every run but never injected: Claude Code shows only its name and description,
    and the body (the "Every run" steps, `in_review` vs `done`, how to block, delegating, asking
    the user, governance) loads only if the agent calls its Skill tool. Nothing in Paperclip's
    prompt tells it to; the nearest is the MCP note ("Start with `paperclip_task_context`; end the
    run with…"). In both real-run-check runs (`7eb33da7`, `65fe29b9`, a trivial task) the agent
    didn't open the skill, and didn't call `paperclip_task_context` either. Options: leave it to
    the agent; one line telling it to read the skill first; or move the short "Every run" core into
    the system prompt and keep the detail in the skill. A read-only look at server1's run logs
    would show how often real agents open it on harder tasks.
- **Already decided, if it goes ahead:**
  - **Long-lived orientation goes in the system prompt,** so it survives a compaction (with bug
    90 fixed). The deploy that does this starts every ongoing chat session fresh once, and any
    agent whose template moves into `AGENTS.md` too. Note it in the deploy notes.
  - **Facts from server1** come from read-only queries against its database. Show the user the
    `SELECT` statements first, then run them over `ssh server1` against `paperclip-db-1`. No
    writes, and no API calls that change anything. The queries find which agents set a
    non-default template, whether any agent sets `engine: "acp"`, and which optional prompt
    features are on (watchdogs, fast responses, the instance's experimental flags, connections
    with instructions). A section counts as unable to apply only when its feature is switched off
    there, not merely unused today.
- **Open:** how a change is checked before it merges. The preview shows the text, but only real
  runs on a dev instance show whether agents still do the right thing (fetch the context, notice
  the comment, end properly). The suggestion was real runs for the changes that take context out
  or change orientation, and the preview alone for dropping dead text.

## Left to the builder

- How the sections are stored:
  - a new run event kind;
  - a larger cap for the `prompt` string;
  - or a run artifact.

  It must keep the full text, redact as other run events do, and leave `adapter.invoke` readable by
  its current readers.
- Whether templates ship as `.md` files the server reads at runtime, or are inlined at build time.
  Check how the server's build and the Docker image carry non-TypeScript files (the `skills/`
  folder already ships).
- How to split the heartbeat stages the preview needs into plan and act halves, and which stages'
  fields come back as `pending`.
- Whether phase 1's sections keep today's `selectPaperclipPromptSections` as a helper underneath
  or copy its logic. The output must match either way, and the shared function stays for ACP.
- How to split the work into agent-sized branches. The builder and the record, the preview read
  and the `ui-new` views are separable once the section and preview types in `packages/shared`
  are settled.

## Built (2026-11-24)

Built on `feat/step-5` by four agents (contracts; builder and wiring; record and run view; preview)
and merged into `main` as `5c3cea6c21`, after the local checks passed (GitHub Actions went off that
day; CLAUDE.md "Tests").

**Real-run check** (desktop dev instance, agent "M7 test sealed runner", task TES-43):

| Run | Session | Record | Matched the sent prompt |
| --- | --- | --- | --- |
| `7eb33da7` (assignment) | fresh | 6 first-message sections, 2 system-prompt sections, 7,959 characters | yes, byte for byte |
| `65fe29b9` (comment, reopened) | resumed | 3 sections, no system prompt, 8,791 characters | yes, byte for byte |

**Found and fixed during the check:** the preview's system prompt listed the whole company skill
library, while a real run lists only the agent's own skills. The preview now selects skills the way
the run does, and a test compares its system prompt with a real run's. The run's narrower list is
itself bug 92 (left as is: fixing it changes every agent's system prompt).

**Decided while building:**
- **Deleting a connection's content keeps a run's `adapter.prompt` record,** like `adapter.invoke`
  (the user, 2026-11-24).
- **The task brief's parts and the builder's plan live on the context as non-enumerable
  properties,** so the run's saved context snapshot and the `adapter.invoke` context never carry
  them.
- **A resume that fails and retries fresh records both attempts.** The run view shows the last one,
  the attempt that ran.
- **Template files wait** for the first change to what the prompt says (plan decision 4).

**Known gaps in the preview:**
- skills a task's text mentions, which a run adds;
- the shared-workspace "concurrently held" note, which depends on live runs;
- connection instructions, marked "filled in at launch".

**Follow-ups:** bugs 84–86 and 88–92 in the bug list; changing the prompt is to be decided
([below](#later-changing-the-prompt-to-be-decided)).

## Calls made in this design

Made in drafting, not discussed. Correct any of these:

- **The system prompt stays in the adapter's run plan.** The builder lists it but doesn't build
  it, so this step can't change the bundle key or reset sessions.
- **The next-run preview offers four kinds of run** (fresh assignment, comment, chat turn, no task),
  not every wake kind.
- **Bug 87 (the 16k cut) is fixed in this step,** since the whole prompt can't be seen without it.
  It changes only what's stored, not what agents receive.
- **Sections are split finer than today's 8** where one joins several sources, so the view shows
  what each part is made of.
- **The agent's `promptTemplate` and `bootstrapPromptTemplate`** show as their own sections, labelled
  as the agent's settings, so it's visible when an agent overrides the default.
- **The preview may decrypt the issue's registered secrets to redact task text,** as the issue read
  routes already do (`routes/issues.ts:17956`, `run-secret-redaction.ts:157-209`). The secret
  values never leave the server. `run-preview.ts`'s "no secret decrypted" comment is updated to
  say so.
- **A chat-turn preview picks one of the agent's chats** (today, its hidden-task chat issues).
- **The ACP engine stays on today's path.** It's still selectable per agent (`engine: "acp"`), but
  it's not the default and step 5 doesn't change it.
