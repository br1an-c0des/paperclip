# Step 5, phase 2 Implementation Plan: the system prompt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Each agent implements only the tasks its brief names.

**Goal:** A sealed `claude_local` CLI run's system prompt opens with who the agent is and "Working
in Paperclip", is sent on every run (bug 90), and points to `paperclip_skills` (bug 92). The first
message loses the identity line and the tools note, and its instructions line becomes one short
agent-directory line (bug 88). The fast-response note is sent only when the feature is on, and the
`paperclip` skill matches the new rules.

**Architecture:**
- **The adapter owns the new texts** in `standing-texts.ts`.
- **`planClaudeRunSkillsAndInstructions` builds the sealed system prompt** from those texts. The
  run and the preview share it, so they agree.
- **`execute.ts` passes the file on resumed sealed runs too,** and records the system prompt there.
- **The server tells the adapter what kind of instructions copy the run has**
  (`context.paperclipInstructionCopy`). It stops appending the long working-copy notes for CLI
  runs, and decides the fast-response note from the instance flag.
- **The builder and preview label the shorter first message** (`matchedPlan`).

**Tech Stack:** TypeScript, vitest, SolidJS (one ui-new text file), Markdown (the skill).

**Spec:** [fork/step-5-system-prompt.md](step-5-system-prompt.md), approved 2026-11-25. Read "The
design" first. It builds on [step-5-light.md](step-5-light.md) and its plan.

## Decisions this plan makes

1. **Sealed only.** Every new system-prompt behaviour (texts, the flag on resume, the record on
   resume) applies when the run is sealed (`sealed` in `execute.ts`, always true in the preview).
   - **Unsealed runs** (the dormant remote paths) keep today's system prompt byte for byte:
     `AGENTS.md`, `INSTRUCTIONS_LOCATION_NOTE`, `buildSkillLibraryManifestMarkdown`, `fresh_only`.
   - **They also keep** the fresh-only flag and the identity line in the first message.
2. **The sealed system prompt** is these parts, joined with `"\n\n"` and present in this order:
   1. `identity`;
   2. `working_in_paperclip`;
   3. `agent_instructions` (only when the file was read; its parts: the file, then
      `CLAUDE_INSTRUCTIONS_RELATIVE_NOTE`);
   4. `skill_library` (always).

   A sealed run therefore always has a system prompt file, even without `AGENTS.md`.
3. **New section ids** in `RunPromptSectionId` (`packages/shared/src/run-prompt.ts`): `identity` and
   `working_in_paperclip`.
   - **Labels:** "Who you are", "Working in Paperclip", "Agent instructions" and "Skills".
   - **Delivery** of the four sealed system sections is `every_run`. Each one's `reason` ends with
     "; a resumed session uses it only after a compaction".
4. **The instructions copy reaches the adapter** as `context.paperclipInstructionCopy`, typed
   `ClaudeInstructionCopy` (below). It's set by `server/src/services/heartbeat/instruction-working-copy.ts`
   and read with `readClaudeInstructionCopy`. Absent means no registered copy.
5. **The long working-copy notes are not appended** to `paperclipTaskMarkdown` or
   `paperclipTaskMarkdownCompact` when the agent is `claude_local` with
   `resolveClaudeExecutionEngine(config).engine === "cli"`. This covers both the agent-directory
   and registered-copy note and the 403 path's note. ACP and the other adapters still get them.
6. **The first message** for a sealed run:
   - `heartbeat_template` is sent only for an agent's own `promptTemplate` (same conditions as
     today);
   - `mcp_note` is never produced.

   `claudeToolsNote` and `claudeToolsNoteEndsRun` are deleted. Their ids and
   `heartbeatPromptChars` stay.
7. **The skill and the system prompt stay in step through a test:** `WORKING_IN_PAPERCLIP_ENDING`
   appears verbatim in `skills/paperclip/SKILL.md`.

## Global Constraints

- **Exact copy, from the spec** (the agent may not reword it). The texts below are TypeScript
  string values; a line break inside a paragraph here is a space in the value.
  - **`WORKING_IN_PAPERCLIP`:** the four parts below, in order, joined with `"\n\n"`:
    `"## Working in Paperclip"`, then the intro, then `WORKING_IN_PAPERCLIP_ENDING`, then the rest.
    - **The intro:**

      ```
      Paperclip wakes you in runs, each about one task (a task and an issue are the same thing). A run's first message says what happened and what to do now. Work with Paperclip through the `paperclip` MCP server's `paperclip_*` tools, not HTTP requests; `paperclip_read_task` and `paperclip_task_context` read more when you need it.
      ```

    - **`WORKING_IN_PAPERCLIP_ENDING`** (its own export):

      ```
      ### Ending a run

      End every task run with exactly one of:

      - `paperclip_finish` with a summary: the task goes to `done`, or to `in_review` (`status: "in_review"`) when someone has a real way to review it: a question or approval you created, a human reviewer, or a review stage. "Please review" in a comment isn't one.
      - `paperclip_block` when work can't go on until a named owner does a concrete thing, or other tasks finish (`blockedByTaskIds`). Always give the `owner` and the exact `unblockAction`.
      - `paperclip_report_progress` with `continue: true` when the work carries on in a later run.

      A final message alone doesn't end a run. A chat turn ends with your reply instead. When the run message gives other closing steps (a recovery, say), follow those.
      ```

    - **The rest:**

      ```
      ### While you work

      - Work on the run's task, not others you come across. Start concrete work in this run unless the task asks only for a plan or a review.
      - Don't poll other agents, subtasks or processes: Paperclip wakes you when something changes.
      - Ask a person (`paperclip_ask_board`) only when something stops the next useful step; carry on with independent work meanwhile.

      ### Comments and commits

      - Comments are short markdown: a status line, then bullets. Say what happened and what's next, not which tools you called.
      - Link tickets as `[PAP-224](/PAP/issues/PAP-224)`: relative, with the company prefix. Never a bare identifier or a raw UUID.
      - End every commit message with `Co-Authored-By: Paperclip <noreply@paperclip.ing>`.

      The `paperclip` skill has the rest: asking and approvals, delegating and handing off, documents, plans and files, review stages, the REST API. Open it before doing any of those.
      ```

  - **`CLAUDE_INSTRUCTIONS_RELATIVE_NOTE`:**
    `"\nRelative paths in these instructions resolve from the directory the run message names."`
  - **`claudeSkillsSection`:** the lines below, joined with `"\n"`:
    - `## Skills`, a blank line;
    - if any are enabled: `These skills are enabled for you:`, a blank line, then one `- <key>`
      per enabled skill, sorted by key (`- <key> — enabled but unavailable: <detail>` for a
      missing source, as today), then a blank line;
    - then always: ``The company's skill library may hold others that aren't enabled for you: `paperclip_skills` lists them. Say a skill is installed but not enabled rather than missing, and ask for it to be added to you.``

    Keys and details go through the same sanitizing as `buildSkillLibraryManifestMarkdown`.
  - **The first message's instructions line, `claudeInstructionsLocation`:**
    - `agent_directory`: ``Your agent directory this run is {root} (AGENT_HOME): your instructions are {entryFile} there, and changes you make in it are kept after the run. Task files go in the task's working directory.``, then `"\n" + storageWarning` when there is one;
    - `instruction_file`: `Your instructions file is {path}; relative paths in it resolve from {dir}/. Changes to it are saved after the run.`
    - `unavailable`: `Your instructions file is {path}; relative paths in it resolve from {dir}/. Changes to it aren't saved.`
    - no copy: `Your instructions file is {path}; relative paths in it resolve from {dir}/.`
    - `{path}` is the run's `instructionsFilePath` and `{dir}` is `path.dirname({path})`.
- **No per-run values in the sealed system prompt:** no paths, run ids, dates or task facts.
- **Leave alone:** `renderPaperclipMcpNote`, `instructionWorkingCopyGuidance`, the shared renderer
  and the ACP engine (`acp.ts`, `acpx-engine`).
- **CLI, builder and preview agree:** `composeClaudeCliPrompt`, `buildClaudeRunPromptPlan` and the
  preview; `matchedPlan` true.
- **ui-new help text** goes behind the "i" tip (CLAUDE.md "UI text").

## Review Focus

1. **A sealed agent with no `AGENTS.md`** still gets a system prompt file (identity, Working in
   Paperclip, Skills) and the flag on fresh and resumed runs (Task 1 tests).
2. **An unsealed run** keeps today's system prompt byte for byte, with the flag on fresh sessions
   only (Task 1 tests).
3. **A run with no task** sends no working-copy note as `task_brief`, only the one-line form
   (Task 2 tests).
4. **The 403 case** gets the `unavailable` line and no 403 note (Task 2 tests).
5. **A storage warning** follows the agent-directory line; without one there's no trailing
   newline (Task 2, `claudeInstructionsLocation` tests).

---

### Task 1: The sealed system prompt and the flag on resume

**Files:**
- Modify:
  - `packages/adapters/claude-local/src/server/standing-texts.ts` (+ `.test.ts`);
  - `run-plan.ts` (`planClaudeRunSkillsAndInstructions`, `systemPromptSection`,
    `buildSealedRunManifest`'s caller semantics);
  - `execute.ts` (`attemptInstructionsFilePath`, `buildClaudeArgs` at :833, the record at :932,
    the manifest's `instructionsSent` at :905, the command notes at :942-952);
  - `preview.ts`;
  - `index.ts`;
  - `packages/shared/src/run-prompt.ts` (ids; `systemPrompt`'s comment: "The system prompt's
    parts as sent; sealed runs send it every run, and a resumed session uses it only after a
    compaction. Unsealed resumed runs: []").
- Test: `run-plan-prompt.test.ts`, `server/src/__tests__/claude-local-execute.test.ts`,
  `server/src/__tests__/claude-local-sealed-run.test.ts`, and `prompt-cache.test.ts` where it
  pins the manifest text.

**Interfaces:**
- **Produces** (from `standing-texts.ts`):
  - `WORKING_IN_PAPERCLIP: string`;
  - `WORKING_IN_PAPERCLIP_ENDING: string`;
  - `CLAUDE_INSTRUCTIONS_RELATIVE_NOTE: string`;
  - `claudeSkillsSection(input: { entries: readonly PaperclipSkillEntry[]; desiredSkillKeys: ReadonlySet<string> }): string`.
- **Changes** `planClaudeRunSkillsAndInstructions(input: { config; moduleDir; agent: { id: string; name?: unknown; title?: unknown }; sealed: boolean; context: Record<string, unknown> })`.
  Its return type is unchanged. `context` is for Task 2's directive; pass it through now.

- [ ] **Step 1: Write the failing tests:**
  - `sealed system prompt has identity, working, instructions and skills in order`;
  - `sealed system prompt without an instructions file still has identity, working and skills`;
  - `unsealed system prompt is unchanged` (snapshot the old text, built from today's code);
  - `sealed system prompt is identical across two runs with different instruction paths and contexts`
    (same `AGENTS.md` content at two paths, equal `combinedInstructionsContents` and equal
    `buildClaudePromptBundleKey`);
  - `bundle key changes when the agent is renamed`;
  - `sealed system sections are every_run`;
  - `resumed sealed run passes --append-system-prompt-file and records the system prompt`;
  - `resumed unsealed run passes no system prompt file`;
  - `manifest instructions.sent is true on a resumed sealed run`;
  - `claudeSkillsSection lists enabled skills and always ends with the paperclip_skills line`;
  - `claudeSkillsSection with no skills is the heading and the paperclip_skills line`.
- [ ] **Step 2:** Run them:
  `corepack pnpm vitest run packages/adapters/claude-local server/src/__tests__/claude-local-execute.test.ts server/src/__tests__/claude-local-sealed-run.test.ts`.
  Expect them to fail.
- [ ] **Step 3: Implement.**
  - Pass `agent`, `sealed` and `context` from `execute.ts` and `preview.ts`.
  - On sealed runs, `attemptInstructionsFilePath` is `effectiveInstructionsFilePath` on fresh and
    resumed attempts.
  - Delete the comment "the Claude CLI may reject the combination outright".
  - The command note says the system prompt file was passed and, on a resume, that Claude uses
    it only after a compaction.
- [ ] **Step 4:** Run the tests again, and `corepack pnpm --filter @paperclipai/adapter-claude-local typecheck`.
  Expect them to pass.
- [ ] **Step 5: Commit:** "System prompt: who you are, Working in Paperclip and skills, sent every
  run (step 5)".

### Task 2: The first message, the server's copy facts and the fast-response flag

**Files:**
- Modify:
  - `standing-texts.ts` (the new `claudeInstructionsLocation`; delete `claudeToolsNote` and
    `claudeToolsNoteEndsRun`);
  - `run-plan.ts` (`readClaudeInstructionsFile` and `planClaudeInstructionsDirective` take
    `context`);
  - `legacy-prompt.ts` (`composeClaudeCliPrompt`: Decision 6);
  - `server/src/services/heartbeat/instruction-working-copy.ts` (Decisions 4 and 5, both the
    normal and the 403 path);
  - `server/src/services/heartbeat/task-context.ts:487` (append `FAST_RESPONSE_AGENT_GUIDANCE`
    only when `(await instanceSettingsService(db).getExperimental()).enableFastResponses`);
  - `server/src/services/run-prompt/build-claude-run-prompt.ts` (no `mcp_note`;
    `heartbeat_template` only for an own template on sealed runs);
  - `run-preview-prompt.ts` and `run-preview.ts` (pass `context`);
  - `ui-new/src/runs/prompt-sections.ts` (tips).
- Test:
  - `legacy-prompt.test.ts` and `standing-texts.test.ts`;
  - `build-claude-run-prompt.test.ts`, `run-preview-prompt.test.ts` and
    `run-preview-draft.test.ts`;
  - `server/src/services/heartbeat/instruction-working-copy.test.ts` (extended tier; run it by
    path) or a new core test beside it;
  - `heartbeat-task-context.test.ts`;
  - `ui-new/src/runs/prompt-sections.test.ts`;
  - the e2e mocks that pin labels (`agent-run-preview.spec.ts`, `new-task-prompt-preview.spec.ts`).

**Interfaces:**
- **Consumes:** Task 1's `planClaudeRunSkillsAndInstructions` with `context`.
- **Produces:**
  - the copy's type:

    ```ts
    export type ClaudeInstructionCopy =
      | { kind: "agent_directory"; root: string; entryFile: string; storageWarning: string | null }
      | { kind: "instruction_file"; root: string; entryFile: string }
      | { kind: "unavailable" };
    ```

  - `readClaudeInstructionCopy(value: unknown): ClaudeInstructionCopy | null`;
  - `claudeInstructionsLocation(input: { instructionsFilePath: string; copy: ClaudeInstructionCopy | null }): string`;
  - all three exported from the adapter's `index.ts`.
- **What the server sets:** `root` is the copy's `executionRoot`; `entryFile` is its
  `entryFile`.

- [ ] **Step 1: Write the failing tests:**
  - `claudeInstructionsLocation` for each kind and for no copy:
    - the path appears once;
    - a storage warning follows on its own line;
    - there's no trailing newline without one;
  - `sealed fresh assignment's first message starts with the agent directory line and has no identity line or tools note`;
  - `sealed run with an own promptTemplate still sends it as heartbeat_template`;
  - `unsealed run still sends the identity line`;
  - `no-task claude_local CLI run gets no working-copy note in task_brief` (server: the note isn't
    appended; `paperclipInstructionCopy` is set);
  - `403 path sets kind unavailable and appends no note for CLI runs; ACP still gets the note`;
  - `fast-response guidance only when enableFastResponses is on`;
  - `matchedPlan` true for a fresh assignment, a comment (resumed), a chat turn, a recovery wake
    and a no-task run;
  - ui-new tips exist for `identity` and `working_in_paperclip`.
- [ ] **Step 2:** Run them (the touched files by path, plus
  `corepack pnpm --filter @paperclipai/ui-new test`). Expect them to fail.
- [ ] **Step 3: Implement.**
  - **ui-new tips:**
    - `identity`: "Who the agent is: its name and job title."
    - `working_in_paperclip`: "Paperclip's rules for every run: how to end it, comments and
      commits, and when to open the paperclip skill."
    - `skill_library`: "The skills enabled for this agent, and where to find the rest of the
      company's library."
    - Each of the four system tips ends with "Sent with every run; a resumed session keeps its
      own copy until it's compacted."
    - Update `heartbeat_template`'s tip to "The agent's own prompt template, a legacy setting.
      Older runs: who the agent is."
  - **Labels:** keep "Prompt template (agent setting)" for an own template, and "Who you are" for
    the unsealed identity line.
- [ ] **Step 4:** Run the tests again, plus `corepack pnpm test:quick`, and `corepack pnpm
  --filter @paperclipai/ui-new typecheck` and `test:e2e`. Expect them to pass.
- [ ] **Step 5: Commit:** "First message: one agent directory line, no identity line or tools note;
  fast-response note only when on (step 5)".

### Task 3: The `paperclip` skill

**Files:**
- Modify: `skills/paperclip/SKILL.md`.
- Test: `packages/adapters/claude-local/src/server/standing-texts.test.ts`.

**Interfaces:**
- **Consumes:** `WORKING_IN_PAPERCLIP_ENDING` (Task 1).

- [ ] **Step 1: Write the failing test:** `the paperclip skill carries the system prompt's ending
  rules verbatim`. It reads `skills/paperclip/SKILL.md` (resolved from the test file with
  `import.meta.url`) and expects it to contain `WORKING_IN_PAPERCLIP_ENDING`.
- [ ] **Step 2:** Run it and expect it to fail.
- [ ] **Step 3: Edit the skill.**
  - **"Every run":** replace it with
    - one line: "On Claude runs these rules are also in your system prompt.";
    - `WORKING_IN_PAPERCLIP_ENDING` verbatim;
    - the "No run, no finish" and "Chat turns" paragraphs, unchanged.

    Steps 1–3 go: no wake headings and no "load the task" step. "Choosing the ending" stays.
  - **"Connections":** delete the bullet.
  - **The `description`:** "Use for Paperclip work beyond the basics: asking the board and
    approvals, delegating and handing off, task documents, plans and files, review stages,
    governance and the REST API, all through the paperclip_* MCP tools."
  - **Leave the other sections and `references/` as they are.**
- [ ] **Step 4:** Run the test and
  `corepack pnpm vitest run server/src/__tests__/agent-commentary-skills.test.ts`. Expect both to
  pass.
- [ ] **Step 5: Commit:** "The paperclip skill: the system prompt's ending rules, no stale steps
  (step 5)".

---

## After the tasks (the PM)

1. **Integrate** on `feat/step-5-system-prompt`.
2. **Run the local checks** on the final commit, plus by path the extended files
   `server/src/__tests__/heartbeat-instruction-working-copy.test.ts` and
   `server/src/services/heartbeat/instruction-working-copy.test.ts`.
3. **Real runs** on the desktop dev instance: a fresh assignment, then a comment, on an "M7 test"
   task (see the spec's "How it's checked").
4. **Bug 90 by hand:** the compaction check, with the bundle's file.
5. **Merge** with `--no-ff`.
6. **Record it:**
   - the spec's Built section;
   - the hard-fork plan's step 5 row;
   - the deploy note that every session resets once;
   - bugs 88, 90 and 92 fixed.
