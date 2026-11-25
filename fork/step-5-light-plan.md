# Step 5, phase 2 Implementation Plan: the light sections

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Each agent implements only the tasks its brief names.

**Goal:** On a `claude_local` CLI run, the first message opens with a one-line "You are <name>,
<title>.", a one-line instructions location and a corrected Paperclip tools note, then the wake;
the connection guidance, the bootstrap template and the rotation note are no longer sent.

**Architecture:**
- **The adapter owns three short texts** in a new module, `standing-texts.ts`: the identity line,
  the instructions location and the tools note. `composeClaudeCliPrompt` uses them, in the new
  order, and stops reading `bootstrapPromptTemplate` and `paperclipSessionHandoffMarkdown`.
- **The server's builder and preview** label the same texts in the same order (`matchedPlan`), and
  the preview passes the agent's `title`.
- **ACP and the other adapters keep the shared texts** (`renderPaperclipMcpNote`,
  `DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE`).

**Tech Stack:** TypeScript, vitest, SolidJS (one ui-new text file).

**Spec:** [fork/step-5-light.md](step-5-light.md), approved 2026-11-25 (server1 check: no rows).
Read "The design" first. It builds on [step-5-brief.md](step-5-brief.md) (its Built section).

## Decisions this plan makes

1. **The first message's order** (`composeClaudeCliPrompt`'s join, and the builder's sections):
   `heartbeat_template`, `instructions_directive`, `mcp_note`, `communication_guidance`, the wake
   (four sections, or `wake` on an external chat turn), `task_brief`. `bootstrap_template` and
   `session_rotation_note` are no longer produced; their ids stay in `RunPromptSectionId`.
2. **The identity line is composed in code**, never through `renderTemplate`, so a name with `{{`
   is printed as is. A blank or missing title gives `You are <name>.`; a blank name falls back to
   `You are agent <id>.`
3. **A blank `promptTemplate` (empty or whitespace) counts as not set.**
4. **`promptMetrics` keeps its keys:** `bootstrapPromptChars` and `sessionHandoffChars` are `0`.
5. **The end-of-run line** is left out when `context.conversationMode === true` or the wake is a
   recovery wake (`isPaperclipRecoveryWakePayload`).
6. **`AdapterAgent` gains `title?: string | null`.** The server already passes the whole agent row
   to `execute`; the preview passes `title` explicitly.

## Global Constraints

- The system prompt doesn't change: `planClaudeRunSkillsAndInstructions`'s sections and
  `INSTRUCTIONS_LOCATION_NOTE` stay byte for byte (the bundle key must not move).
- `composeClaudeCliPrompt`, `buildClaudeRunPromptPlan` and the preview agree: `matchedPlan` true.
- Don't change `renderPaperclipMcpNote`, `DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE`,
  `DEFAULT_PAPERCLIP_CONVERSATION_PROMPT_TEMPLATE` or the ACP engine (`acp.ts`, `acpx-engine`).
- Exact copy, from the spec:
  - identity: `You are {name}, {title}.` / `You are {name}.`
  - instructions: `Your instructions file this run is {file}; resolve relative paths in it from {dir}/.`
    (`{dir}` is `path.dirname(file)`; one line, no other sentence)
  - tools note, three lines joined by `\n`:
    1. ``Work with Paperclip through the `paperclip` MCP server's `paperclip_*` tools, not HTTP requests. This message has what's new and the task; `paperclip_read_task` and `paperclip_task_context` read more when you need it.``
    2. ``End the run with `paperclip_finish`, `paperclip_block` (if you're waiting on someone) or `paperclip_report_progress` with `continue: true`.`` (left out per decision 5)
    3. `PAPERCLIP_API_KEY is there for scripts that need the REST API.`
- Labels: `heartbeat_template` is "Who you are" (default line) or "Prompt template (agent
  setting)" (own template); `mcp_note` is "Paperclip tools"; `instructions_directive` keeps
  "Instructions file location".
- Help text in ui-new goes behind the "i" tip (CLAUDE.md "UI text").

## Review Focus

1. **A title that's empty or only spaces** prints `You are <name>.`, never `You are <name>, .`
   (Task 1, `claudeIdentityLine` tests).
2. **An agent whose `promptTemplate` is whitespace** gets the identity line, not a blank first
   section (Task 1, composer test; Task 2, builder label test).
3. **A recovery wake** gets no identity line (as today) and a tools note without the end-of-run
   line (Task 1 and Task 2 tests).
4. **A resumed session with a wake** gets neither the identity line nor the tools note, and its
   first section is the instructions line (Task 1 composer test; Task 2 `matchedPlan` test).
5. **A name containing `{{…}}`** is printed verbatim (Task 1, `claudeIdentityLine` test).

---

### Task 1: The adapter's texts and the CLI composer

**Files:**
- Create: `packages/adapters/claude-local/src/server/standing-texts.ts`,
  `packages/adapters/claude-local/src/server/standing-texts.test.ts`
- Modify: `packages/adapters/claude-local/src/server/legacy-prompt.ts` (`composeClaudeCliPrompt`,
  `ClaudeCliPromptInput`, `ClaudeCliPromptSectionTexts`, `resolveClaudePromptTemplate`)
- Modify: `packages/adapters/claude-local/src/server/run-plan.ts` (`readClaudeInstructionsFile`'s
  directive only)
- Modify: `packages/adapters/claude-local/src/server/execute.ts` (the `composeClaudeCliPrompt`
  call, ~line 916, and line 356)
- Modify: `packages/adapters/claude-local/src/server/index.ts` (exports)
- Modify: `packages/adapter-utils/src/types.ts` (`AdapterAgent.title`)
- Test: `packages/adapters/claude-local/src/server/legacy-prompt.test.ts`,
  `server/src/__tests__/claude-local-execute.test.ts` (its directive expectations, ~lines 724 and
  1436)

**Interfaces:**
- Produces (exported from `@paperclipai/adapter-claude-local/server`):
  - `claudeIdentityLine(agent: { id: string; name?: unknown; title?: unknown }): string`
  - `claudeInstructionsLocation(instructionsFilePath: string): string`
  - `claudeToolsNote(input: { env: Record<string, string>; endOfRunLine: boolean }): string` —
    `""` when `env.PAPERCLIP_API_URL` or `env.PAPERCLIP_API_KEY` is unset, as
    `renderPaperclipMcpNote` does
  - `claudeToolsNoteEndsRun(context: Record<string, unknown>): boolean` (decision 5)
  - `resolveClaudePromptTemplate(config: Record<string, unknown>): string | null` — the agent's own
    non-blank template, else `null`
  - `ClaudeCliPromptInput` loses `bootstrapPromptTemplate`; `promptTemplate` becomes
    `string | null`; `templateData.agent` carries `id`, `name`, `title`
  - `ClaudeCliPromptSectionTexts` loses `bootstrapTemplate` and `sessionRotationNote`

- [ ] **Step 1: Write the failing tests in `standing-texts.test.ts`**

```ts
expect(claudeIdentityLine({ id: "a1", name: "M7 test sealed runner", title: "QA engineer" }))
  .toBe("You are M7 test sealed runner, QA engineer.");
expect(claudeIdentityLine({ id: "a1", name: "Ada", title: "  " })).toBe("You are Ada.");
expect(claudeIdentityLine({ id: "a1", name: "Ada", title: null })).toBe("You are Ada.");
expect(claudeIdentityLine({ id: "a1", name: "A {{agent.id}}" })).toBe("You are A {{agent.id}}.");
expect(claudeIdentityLine({ id: "a1", name: "" })).toBe("You are agent a1.");
expect(claudeInstructionsLocation("/x/instructions/AGENTS.md"))
  .toBe("Your instructions file this run is /x/instructions/AGENTS.md; resolve relative paths in it from /x/instructions/.");
const env = { PAPERCLIP_API_URL: "u", PAPERCLIP_API_KEY: "k" };
expect(claudeToolsNote({ env, endOfRunLine: true }).split("\n")).toHaveLength(3);
expect(claudeToolsNote({ env, endOfRunLine: false })).not.toContain("paperclip_finish");
expect(claudeToolsNote({ env: {}, endOfRunLine: true })).toBe("");
expect(claudeToolsNoteEndsRun({ conversationMode: true })).toBe(false);
expect(claudeToolsNoteEndsRun({ paperclipWake: { reason: "source_scoped_recovery_action" } })).toBe(false);
// (any payload isPaperclipRecoveryWakePayload accepts; build it the way legacy-prompt.test.ts does if normalization needs more fields)
expect(claudeToolsNoteEndsRun({})).toBe(true);
```

Each exact string from Global Constraints gets one `toBe` on the whole note.

- [ ] **Step 2: Run it to make sure it fails**

Run: `corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run src/server/standing-texts.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the four functions in `standing-texts.ts`**

- [ ] **Step 4: Update `legacy-prompt.test.ts` to the new composer** (failing first)
  - a fresh assignment: the prompt starts with the identity line, then the instructions line, then
    the tools note (3 lines), then `## What happened`; no "Connection tools:", no
    "Paperclip API access note:";
  - an agent with `promptTemplate: "Mine {{agent.name}}."` gets it rendered, first;
    `promptTemplate: "  "` gets the identity line;
  - a chat task (`conversationMode: true`): identity line, tools note without the end-of-run line;
  - a recovery wake: no identity line, tools note without the end-of-run line;
  - a resumed comment wake: starts with the instructions line; no identity line, no tools note;
  - a context with `paperclipSessionHandoffMarkdown` and a config with `bootstrapPromptTemplate`:
    neither text appears; `promptMetrics.bootstrapPromptChars` and `sessionHandoffChars` are `0`;
  - `resolveClaudePromptTemplate`: `"Mine."` → `"Mine."`; `{}`, `"  "`, `42` → `null`.

- [ ] **Step 5: Change `composeClaudeCliPrompt`, `resolveClaudePromptTemplate`, the directive in
  `run-plan.ts` (now `claudeInstructionsLocation(instructionsFilePath)`), `execute.ts` and
  `AdapterAgent`**

The heartbeat slot: when it's sent (unchanged rule: not on a recovery wake, not on a resumed
session with a wake), it's `renderTemplate(promptTemplate, templateData)` if `promptTemplate` is
set, else `claudeIdentityLine(templateData.agent)`. The tools note: `claudeToolsNote({ env,
endOfRunLine: claudeToolsNoteEndsRun(context) })` under today's condition (sealed, fresh, not an
external chat turn). Join order per decision 1.

- [ ] **Step 6: Update `claude-local-execute.test.ts`'s directive expectations to the new line**

- [ ] **Step 7: Run the adapter's tests and the execute test**

Run: `corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run src/server/` and
`corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/claude-local-execute.test.ts`
Expected: PASS. Then `corepack pnpm --filter @paperclipai/adapter-claude-local typecheck`.

- [ ] **Step 8: Commit** — `Light sections: the identity line, instructions line and tools note in the CLI composer`

### Task 2: The builder, the preview and the tips

**Files:**
- Modify: `server/src/services/run-prompt/build-claude-run-prompt.ts` (`buildClaudeRunPromptPlan`,
  `describeSections`, `defaultTemplateParts`)
- Modify: `server/src/services/run-preview-prompt.ts` (the agent passed at ~line 306, and the
  agent type at ~line 166, gain `title`)
- Modify: `ui-new/src/runs/prompt-sections.ts` (the `heartbeat_template` and `mcp_note` tips)
- Test: `server/src/services/run-prompt/build-claude-run-prompt.test.ts`,
  `server/src/__tests__/run-preview.test.ts`, `run-preview-route.test.ts`,
  `run-preview-draft.test.ts`

**Interfaces:**
- Consumes: Task 1's exports and the new `composeClaudeCliPrompt` input.
- Produces: sections in decision 1's order, with the Global Constraints' labels.

- [ ] **Step 1: Update `build-claude-run-prompt.test.ts`** (failing first)
  - for each kind already covered (fresh assignment, resumed comment, chat turn, recovery, no
    task): section ids in decision 1's order, and the sections' texts joined equal
    `composeClaudeCliPrompt`'s prompt;
  - `heartbeat_template`: label "Who you are", one part `heartbeat_template.identity`, source
    naming the agent's name and title; with `promptTemplate` set: label "Prompt template (agent
    setting)", source `agent setting: promptTemplate`, no parts; with `promptTemplate: "  "`: "Who
    you are";
  - `mcp_note`: label "Paperclip tools"; on a recovery wake its text has no `paperclip_finish`;
  - no section has id `bootstrap_template` or `session_rotation_note`, even when the config and
    context carry them.

- [ ] **Step 2: Run it to make sure it fails**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/services/run-prompt/build-claude-run-prompt.test.ts`

- [ ] **Step 3: Change the builder** to Task 1's input, decision 1's order and the labels;
  `defaultTemplateParts` becomes the one identity part.

- [ ] **Step 4: Pass `title` in the preview**, and update the preview tests' expected sections
  (the agent fixtures get a title in at least one test, asserting "You are <name>, <title>.").

- [ ] **Step 5: ui-new tips:** `heartbeat_template`: "Who the agent is: its name and job title, or
  the agent's own prompt template." `mcp_note`: "How the run works with Paperclip: its
  `paperclip_*` tools, and how to end the run."

- [ ] **Step 6: Run the server's run-prompt and preview tests, ui-new's tests, and `test:quick`**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/services/run-prompt src/__tests__/run-preview.test.ts src/__tests__/run-preview-route.test.ts src/__tests__/run-preview-draft.test.ts`,
`corepack pnpm --filter @paperclipai/ui-new test`, `corepack pnpm --filter @paperclipai/server typecheck`,
`corepack pnpm test:quick`
Expected: PASS.

- [ ] **Step 7: Commit** — `Light sections: the builder and preview in the new order, with the agent's title`

## Integration (the PM)

1. Merge the agent's branch into `feat/step-5-light` (off `main`), run the local checks
   (CLAUDE.md "Tests"), then start the desktop dev server.
2. Real runs ([spec](step-5-light.md#how-its-checked)): "M7 test sealed runner" gets a title for the
   run (it's ours to change); one fresh assignment on a small "M7 test" task, then a comment on
   it. Record each run's first message (sections and size), whether the agent called
   `paperclip_task_context` first, and how it ended. Pause the agent after.
3. Merge into `main` with `--no-ff`; Built section in the spec; progress rows in
   `fork/hard-fork-plan.md` and `fork/step-5-prompt-builder.md`; bug 89's note if it changes.
