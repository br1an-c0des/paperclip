# Step 5, phase 2: the system prompt

**Approved by the user, 2026-11-25** (after the builder check); built the same day ([Built](#built)). The fifth piece of phase 2 of step 5, after the wake
([step-5-wake.md](step-5-wake.md)), the handoff ([step-5-handoff.md](step-5-handoff.md)), the task
brief ([step-5-brief.md](step-5-brief.md)) and the light sections ([step-5-light.md](step-5-light.md)).
On 2026-11-25 the user chose option B below: a short "Working in Paperclip" section in the system
prompt, with the `paperclip` skill kept for the rest.

## Contents

- [Intent](#intent)
- [What's there today](#whats-there-today)
- [Goals, non-goals, anti-goals](#goals-non-goals-anti-goals)
- [Constraints](#constraints)
- [Approaches](#approaches)
- [The design](#the-design)
  - [The system prompt's shape](#the-system-prompts-shape)
  - [Working in Paperclip](#working-in-paperclip)
  - [Sent on every run (bug 90)](#sent-on-every-run-bug-90)
  - [The skill library (bug 92)](#the-skill-library-bug-92)
  - [The agent directory line (bug 88)](#the-agent-directory-line-bug-88)
  - [The first message afterwards](#the-first-message-afterwards)
  - [The fast-response note](#the-fast-response-note)
  - [The `paperclip` skill](#the-paperclip-skill)
  - [Record, manifest and preview](#record-manifest-and-preview)
  - [The deploy](#the-deploy)
  - [How it's checked](#how-its-checked)
- [Left to the builder](#left-to-the-builder)
- [Calls made in this design](#calls-made-in-this-design)
- [Built](#built)

## Intent

Today the rules an agent needs on every run are in the `paperclip` skill. Claude Code loads only a
skill's name and description, and the 12 KB body only if the agent opens the skill, which it
hasn't done in any real run so far. So agents never see:

- which ending to use (done, in review or blocked);
- the required comment style (ticket links, no raw IDs);
- the commit trailer.

Their only end-of-run rule is the first message's tools note, and that is lost after a compaction.

The aim: **what every run needs is in the system prompt, where it's always seen and survives a
compaction; the skill is the reference for the rest.** Every change that alters the system prompt
lands together: bugs 88, 90 and 92, the skill, and the standing texts. That way each agent's
Claude session resets once, at one deploy.

## What's there today

**System prompt** (`planClaudeRunSkillsAndInstructions`, `packages/adapters/claude-local/src/server/run-plan.ts`),
written to `<bundle>/agent-instructions.md` and passed with `--append-system-prompt-file` on
fresh sessions only (`execute.ts:833`):

1. the agent's `AGENTS.md`;
2. `INSTRUCTIONS_LOCATION_NOTE` ("Use the agent instruction file location supplied in the current
   run prompt…");
3. the "Company skill library" list (`buildSkillLibraryManifestMarkdown`,
   `packages/adapter-utils/src/skill-library-manifest.ts`).

The bundle key (`buildClaudePromptBundleKey`, `prompt-cache.ts`) hashes the skills and this text.
A session saved under another key isn't resumed.

**First message, standing texts** (after the light sections):

| Text | Size | Sent | Problem |
| --- | --- | --- | --- |
| Identity line ("You are M7 test sealed runner, Step 4b real-run check.") | ~60 | fresh, or resumed with no wake; not on recovery wakes | Standing; lost after a compaction. |
| Instructions location | 459 | every run | The per-run copy's path (`…/file-sync/runs/<run>/live/AGENTS.md`) is printed twice. |
| Paperclip tools note | ~400 | fresh sealed sessions | Standing; the only end-of-run rule; lost after a compaction. |
| Fast-response note (`FAST_RESPONSE_AGENT_GUIDANCE`) | 305 | fresh | Added to every run (`server/src/services/heartbeat/task-context.ts:487`), although `enableFastResponses` is an experimental instance flag, off by default. |

**The bugs:**

- **90:** Claude rebuilds a compacted session's system prompt from that call's flags, and resumed
  runs don't pass the file, so after a compaction the agent's instructions are gone.
- **92:** the heartbeat hands the adapter only the agent's own skills, so the "installed, not
  enabled for you" lines never appear.
- **88:** the working-copy note is appended only to the brief variants that task runs don't use.
  `claude_local` runs get the agent-directory variant ("Your persistent agent directory is …
  (AGENT_HOME)"): about 1,200 characters, which mention Codex sessions and storage limits
  (`instructionWorkingCopyGuidance`, `server/src/services/agent-instruction-working-copies.ts`).

**The skill** (`skills/paperclip/SKILL.md`):

- its "Every run" step 1 names wake headings that no longer exist ("Paperclip Wake Payload",
  "Resume Delta");
- step 2 says to load the task with `paperclip_task_context` first;
- the "Connections" bullet names `connections_search` and `connection_request`, the Runner's
  tools (bug 89).

## Goals, non-goals, anti-goals

- **Goals:**
  - The system prompt opens with who the agent is and a short "Working in Paperclip" section with
    the rules every run needs.
  - The system prompt survives a compaction (bug 90).
  - The agent can tell a skill that exists in the company library from one that doesn't (bug 92).
  - The agent-directory line is one short line and reaches every run (bug 88).
  - The identity line and the tools note leave the first message.
  - The fast-response note goes out only when fast responses are on.
  - The skill drops what the system prompt now says, and loses its stale parts.
  - The record, the manifest and the preview show the new system prompt, and `matchedPlan` stays
    true.
- **Non-goals:**
  - ACP and the dormant adapters' prompts. They keep the shared texts. As in the earlier batches,
    "`claude_local`" means its CLI engine (`claude --print`), the one the code picks when `engine`
    is unset. They do get the edited skill, which is shared.
  - The chat directive (bug 86, step 6), chat's handoff and brief.
  - Bugs 96, 97 and 98; COMPANY.md; moving the system prompt into the server's builder.
- **Anti-goals:**
  - **Agents that stop ending their runs properly.**
  - **A system prompt that differs between two runs of the same agent with nothing changed.** That
    would reset its session every run, so nothing per-run goes in: no paths, run ids, dates or
    task facts.
  - **More than one reset at this deploy,** or a reset of every agent whenever a company skill is
    installed.
  - **Instructions missing after a compaction.**

## Constraints

- **Everything that changes the bundle key lands in this batch**, at one deploy.
- **Run, builder and preview agree:** the system prompt stays built by
  `planClaudeRunSkillsAndInstructions`, which the run and the preview share. The first message
  stays `composeClaudeCliPrompt`, `build-claude-run-prompt.ts` and `run-preview-prompt.ts`.
- **Local runs only.** Every local `claude_local` run is sealed (`execute.ts:408-426`); the dormant
  remote paths keep their launch.
- **The usual real-run rules:**
  - the desktop dev instance, never server1;
  - "M7 test sealed runner" (paused between runs) on "M7 test" tasks;
  - never Bob.

## Approaches

- **A. A one-line pointer.** The system prompt says "Read the `paperclip` skill before you start."
  Cheapest, but it relies on the agent doing it every session.
- **B. A short "Working in Paperclip" section in the system prompt; the skill keeps the rest
  (chosen, 2026-11-25).** The rules every run needs are always seen and survive a compaction. The
  cost is two places to keep in step.
- **C. The whole skill in the system prompt.** Always seen, but about 12K characters of mostly
  unneeded detail in every session.

## The design

### The system prompt's shape

In this order, joined with blank lines:

1. **Who you are:** `You are <name>, <title>.` (or `You are <name>.`), from `claudeIdentityLine`,
   moved from the first message.
2. **Working in Paperclip** ([below](#working-in-paperclip)).
3. **The agent's instructions:** `AGENTS.md`, then the location note ("relative paths in these
   instructions resolve from the agent directory named in the run message"; the wording is the
   builder's).
4. **Skills** ([below](#the-skill-library-bug-92)).

The agent's own instructions come after Paperclip's rules, so they can refine them.

A renamed agent, or one whose title changes, gets a new bundle key, so its session starts fresh
once. That's accepted.

An agent's own `promptTemplate` (legacy; none on server1) can carry run data, so it stays in the
first message, in the identity line's old slot, and the identity line is in the system prompt as
well.

### Working in Paperclip

This is the draft text. The builder may tighten the wording but keeps every rule. Its exact text is
fixed in a template file and tested.

```markdown
## Working in Paperclip

Paperclip wakes you in runs, each about one task (a task and an issue are the same thing). A run's
first message says what happened and what to do now. Work with Paperclip through the `paperclip`
MCP server's `paperclip_*` tools, not HTTP requests; `paperclip_read_task` and
`paperclip_task_context` read more when you need it.

### Ending a run

End every task run with exactly one of:

- `paperclip_finish` with a summary: the task goes to `done`, or to `in_review`
  (`status: "in_review"`) when someone has a real way to review it: a question or approval you
  created, a human reviewer, or a review stage. "Please review" in a comment isn't one.
- `paperclip_block` when work can't go on until a named owner does a concrete thing, or other
  tasks finish (`blockedByTaskIds`). Always give the `owner` and the exact `unblockAction`.
- `paperclip_report_progress` with `continue: true` when the work carries on in a later run.

A final message alone doesn't end a run. A chat turn ends with your reply instead. When the run
message gives other closing steps (a recovery, say), follow those.

### While you work

- Work on the run's task, not others you come across. Start concrete work in this run unless the
  task asks only for a plan or a review.
- Don't poll other agents, subtasks or processes: Paperclip wakes you when something changes.
- Ask a person (`paperclip_ask_board`) only when something stops the next useful step; carry on
  with independent work meanwhile.

### Comments and commits

- Comments are short markdown: a status line, then bullets. Say what happened and what's next,
  not which tools you called.
- Link tickets as `[PAP-224](/PAP/issues/PAP-224)`: relative, with the company prefix. Never a
  bare identifier or a raw UUID.
- End every commit message with `Co-Authored-By: Paperclip <noreply@paperclip.ing>`.

The `paperclip` skill has the rest: asking and approvals, delegating and handing off, documents,
plans and files, review stages, the REST API. Open it before doing any of those.
```

About 2,300 characters. This replaces the first message's tools note, including its
`PAPERCLIP_API_KEY` line: the skill covers scripts.

The ending rules no longer vary by run (the light sections dropped them on chat tasks and recovery
wakes). Instead they say when not to apply: on a chat turn, and when the run message gives other
closing steps. The recovery wake does give other steps: `wake/templates.ts`'s `recovery` text has
the agent resolve a recovery action.

### Sent on every run (bug 90)

- **The flag:** `execute.ts` passes `--append-system-prompt-file` on resumed runs too, not only
  fresh ones.
- **Why that's safe:** checked by hand on 2026-11-23 (Claude Code 2.1.325). On a resume, Claude
  ignores the flag until the session is compacted; after a compaction, it rebuilds the system
  prompt from the flag. The file is the bundle's, and a session is resumed only under the same
  bundle key, so the text is always the one the session started with.
- **Saved sessions without a key:** a session saved before bundle keys has no
  `promptBundleKey` and counts as matching (`execute.ts:721-722`), so it resumes under the new key
  and, after a compaction, picks up the new file. That's the file it should have, so it's harmless.
- **The old comment goes:** "the Claude CLI may reject the combination outright" isn't true of
  2.1.325.
- **The image's CLI moves:** the image installs `@anthropic-ai/claude-code@latest`
  (`Dockerfile:381`), so the hand check below runs again with the CLI the deploy will install,
  just before the deploy. A CLI that rejected the flag would fail resumed runs at once, visibly;
  one that applied it before a compaction would send the session's own text again, which is the
  same text. No version gate (a call).
- **Sealed runs only:** the flag on resume and the new system prompt are gated on `sealed`, so the
  dormant remote paths keep their launch and their bundle keys.

### The skill library (bug 92)

The bug's own fix would list the whole library ("enabled" and "installed, not enabled for you").
The list sits in the system prompt, so installing or removing any company skill would then change
every agent's bundle key and reset every session.

Instead (a call, [below](#calls-made-in-this-design)):

- **The list:** "Company skill library" becomes "Skills" and keeps listing the agent's own skills
  (as now, stable).
- **Plus one line:** "The company's skill library may hold others that aren't enabled for you:
  `paperclip_skills` lists them. Say a skill is installed but not enabled rather than missing,
  and ask for it to be added to you."
- **`paperclip_skills` reading is open** to every agent (`server/src/mcp/catalog/skills.ts`; only
  its writes need `agents:configure`). The builder confirms a plain agent can list.
- **The heartbeat's skill selection doesn't change.**

### The agent directory line (bug 88)

- **Replaces** the first message's instructions-location line and the working-copy note.
- **Sent on every run,** since the path is per run:

  > Your agent directory this run is `<dir>` (AGENT_HOME): your instructions are `<entry>` there,
  > and changes you make in it are kept after the run. Task files go in the task's working
  > directory.

- **How the facts reach the adapter:** the server puts the copy's facts (directory, entry file,
  any `storageWarning`) on the run context. The field name is the builder's.
- **A storage warning,** when there is one, follows the line.
- **Dropped from the long note:** the Codex sentence, the storage limits and the sync rules. The
  run's save receipt already reports a warning.
- **Without an agent-directory copy** (an instructions file only): `Your instructions file is
  <path>; relative paths in it resolve from <dir>/.`, the path printed once.
- **If a run can get the other copy kind** (the "registered private copy"), it gets the same
  one-line form, without the Runner tool names.
- **The shared note isn't touched:** `instructionWorkingCopyGuidance` keeps appending to the brief
  variants, for the other adapters.
- **Neither long note reaches a `claude_local` CLI run.** On a run with no task, the brief variants
  are otherwise empty, so today the whole note goes out as `task_brief`
  (`instruction-working-copy.ts:221-224`, `server-utils.ts:2753-2756`). The same goes for the
  403 path's text ("No editable agent instruction working copy is registered…",
  `instruction-working-copy.ts:194-198`). How it's kept out is the builder's: the server records
  the brief without it, or the adapter and builder strip it. The 403 case gets the
  instructions-file form, plus "Changes to it aren't saved." The tests cover a no-task run and the
  403 case, with `matchedPlan`.

### The first message afterwards

A fresh assignment run on a non-chat task:

```
Your agent directory this run is <dir> (AGENT_HOME): …           (instructions_directive)
## What happened                                                  (what_happened)
## Where things stand                                             (where_things_stand)
## The task                                                       (the_task)
## What to do now                                                 (to_do)
```

- **Gone from the first message:** the identity line and the tools note (`heartbeat_template` is
  now sent only for an agent's own `promptTemplate`, and `mcp_note` is never sent).
- **Kept for old records:** their ids stay in `RunPromptSectionId`, and `heartbeatPromptChars`
  keeps its key.
- **Chat tasks** keep `communication_guidance` and `task_brief` where they are.

### The fast-response note

- **Where it's decided:** `task-context.ts` appends `FAST_RESPONSE_AGENT_GUIDANCE` only when the
  instance's `enableFastResponses` is on.
- **Applies to every adapter,** since the server decides it.
- **Stays in the first message:** a flag change shouldn't reset sessions.

### The `paperclip` skill

- **"Every run"** becomes a short section that matches the system prompt's text, for engines
  without it (ACP and the others read the same skill):
  - no wake headings;
  - no "load the task first" step;
  - the same ending rules.

  The two must not drift. Either one source file feeds both, or a test checks that the system
  prompt's ending rules appear in the skill (the builder's choice).
- **"Comment Style"** keeps its detail (anchors, agent and project links). The system prompt has
  the short form.
- **The "Connections" bullet** is removed: these runs don't have the tools.
- **The description** is updated to say what to open the skill for: asking, approvals,
  delegating, documents and files, review stages, the REST API.
- **The other sections and `references/`** stay as they are.

### Record, manifest and preview

- **System-prompt sections in the record:** "Who you are", "Working in Paperclip", "Agent
  instructions" and "Skills", each with `placement: system`.
- **Their delivery becomes `every_run`,** since the file now goes with every run. The reason says
  that a resumed session uses it only after a compaction.
- **A resumed run's record lists them too.** `RunPromptRecord.systemPrompt` stops being `[]` on
  resume (`packages/shared/src/run-prompt.ts:83`, `execute.ts:932`): its comment, ui-new's Input
  tab and the fixtures follow. The Input tab shows the caveat in the section's tip.
- **The manifest's "instructions sent" row** is true whenever the file was passed. Its wording says
  the same as the record's reason.
- **The preview** gets the system prompt from the shared function, so it shows the new sections
  without its own change, apart from passing the agent's name and title in.
- **ui-new's section tips** (`ui-new/src/runs/prompt-sections.ts`) get entries for the new ids.

### The deploy

- **Every agent's Claude session starts fresh once** at the next deploy, chat sessions included,
  because the bundle key changes. (A session saved before bundle keys existed resumes instead;
  see [above](#sent-on-every-run-bug-90).)
- **Before the deploy,** the bug 90 hand check runs again with the CLI version the image installs.
- **The deploy notes and the hard-fork plan's step 5 row** say so.
- **No migration.**

### How it's checked

- **Tests:**
  - the system prompt's order and text, for an agent with and without a title, and with and
    without instructions;
  - the bundle key is the same for two runs of one agent with nothing changed (different run ids,
    paths and tasks), and different after a rename;
  - the resumed run's args include `--append-system-prompt-file`;
  - the first message has no identity line or tools note, and the agent-directory line has the
    path once;
  - the fast-response note only with the flag on;
  - the skill and the system prompt don't drift;
  - `matchedPlan` stays true; the preview's draft matches a real run (the existing comparison test).
- **The local checks** on the branch's final commit. This branch changes the run lifecycle's
  prompt, so it also runs the extended files that cover the prompt bundle and the instruction
  working copy once (CLAUDE.md).
- **Real runs** on the desktop dev instance with "M7 test sealed runner":
  - one fresh assignment on a small "M7 test" task, then a comment on it (resumed);
  - they pass if the system prompt in the record has the four sections, the agent ends each run
    with a closing call, and its comment links the ticket;
  - the second run's args include the flag.
- **Bug 90 by hand:** repeat the 2026-11-23 check with the bundle's file. That is: fresh with it,
  `/compact`, resume with it; then ask the agent its name.
  - It runs on Haiku, in a throwaway folder, with no Paperclip involved.

## Left to the builder

- The final wording of "Working in Paperclip", the location note, the skills line and the
  agent-directory line, within the rules above.
- How the agent-directory facts reach the adapter (a context field, or `AGENT_HOME` and the
  entry).
- Whether the skill and the system prompt share one source file, or a test keeps them in step.
- Where the template files live (beside `standing-texts.ts` is the obvious place).
- How to split the work into branches. Likely two:
  - the adapter (system prompt, args, first message, record) with the server's context field and
    fast-response condition;
  - the skill's edit.

## Calls made in this design

Made in drafting, not discussed. Correct any of these:

- **Bug 92 is fixed with a pointer to `paperclip_skills`, not the whole library listed,** so
  installing a company skill doesn't reset every agent's session.
- **The identity line moves into the system prompt;** a rename resets that agent's session once.
- **The agent's `AGENTS.md` comes after "Working in Paperclip",** so it can refine Paperclip's
  rules.
- **The tools note is removed from the first message,** including its `PAPERCLIP_API_KEY` line.
- **The ending rules say when they don't apply** (chat, and the run message's own closing steps),
  rather than varying by run.
- **Bug 88's note becomes one line in the first message,** without the storage and sync detail.
- **The fast-response note stays in the first message,** only when the flag is on.
- **The skill keeps a matching "Every run",** for ACP and the other engines.
- **The extended files for the prompt bundle and the working copy** run once on the branch.
- **No CLI version gate** for the flag on resume; the hand check is repeated before the deploy
  instead (after the builder check).
- **A resumed run's record lists the system prompt,** marked as used only after a compaction
  (after the builder check).
- **The new system prompt and the flag are for sealed runs only** (after the builder check).
- **No-task runs and the 403 case get only the one-line form,** never the long notes (after the
  builder check).

## Built

Built on `step5-sp/build` by one agent (Tasks 1–3, then three small follow-ups from review),
integrated on `feat/step-5-system-prompt` and merged into `main` as `41427fffda` on 2026-11-25.

- **Checks:** the local checks passed on the first run on `d83219e86c`:
  - typecheck, `test:runner`;
  - ui-new test, build and e2e;
  - core: 6,484 tests.

  The extended files for the working copy, the task context and comment-wake batching passed
  (60 tests). One of them, `heartbeat-comment-wake-batching.test.ts`, was updated: it expected the
  fast-response note by default.
- **Bug 90 by hand** (Claude Code 2.1.325, Haiku, a throwaway folder):
  - fresh with a system prompt file naming a codename, `/compact`, then a resume with the file:
    it answered with the codename;
  - the same without the file after `/compact`: "UNKNOWN".

  Repeat it with the image's CLI before the deploy.
- **Real runs** (desktop dev instance, "M7 test sealed runner", task TES-50), both `matchedPlan`
  true and both with `--append-system-prompt-file` in the args:

  | Run | Session | System prompt | First message | What the agent did |
  | --- | --- | --- | --- | --- |
  | `477cb398` (assigned) | fresh | who you are 54, Working in Paperclip 2,032, agent instructions 128, skills 469 | 1,045 characters: the agent directory line, What happened, The task, What to do now | Posted a comment listing the three endings, worded as in "Working in Paperclip", and called `paperclip_finish`. No ToolSearch beyond the two tools, no `paperclip_task_context`, no skill opened. |
  | `8cef0222` (reopened by a comment) | resumed | the same four, recorded | 1,085 characters | Posted a comment opening with `[TES-50](/TES/issues/TES-50)`, said it would block with `blockedByTaskIds`, the `owner` and the `unblockAction` and wouldn't poll, then called `paperclip_finish`. |

- **Calls made while building:**
  - the fast-response flag is read from the experimental settings the heartbeat and the preview
    already pass in (`experimentalInstanceSettings.enableFastResponses`);
  - the CLI check for leaving out the long notes is `runTakesInstructionCopyFacts` (adapter type
    and engine, from the run's config);
  - `paperclipApiReachable` and `attachClaudeRunPromptPlan`'s `authToken` are removed (they only
    fed the tools note);
  - the skills section copies the key sanitizer, rather than exporting it from adapter-utils;
  - the run manifest (`ui-new/src/runs/run-manifest.ts`) says a resumed sealed run was sent the
    file and uses it only after a compaction. Older resumed records keep "not sent".
- **Seen in the runs, for later:**
  - the agent-directory line is still 372 characters, most of it the per-run path;
  - `paperclip_finish` posts its summary as a second comment after the agent's own (related to
    bug 98).
- **The deploy:** every agent's Claude session starts fresh once (the bundle key changes),
  chat sessions included.

