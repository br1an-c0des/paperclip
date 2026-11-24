# Run prompt builder

`buildClaudeRunPromptPlan` (`build-claude-run-prompt.ts`) describes the first message of a
`claude_local` run on the CLI engine as labelled sections, for a fresh session and for a resumed
one (step 5, [fork/step-5-plan.md](../../../../fork/step-5-plan.md)). It doesn't change the
prompt: each set is the eight texts of today's join (`composeClaudeCliPrompt` in
`packages/adapters/claude-local/src/server/legacy-prompt.ts`), with a label, a reason, a source
and display parts added. `build-claude-run-prompt.test.ts` checks, for every kind of run, fresh
and resumed, that `joinRunPromptSections(plan[set])` is exactly the prompt the adapter sends.

The builder reads the agent's instructions file (for the directive) and nothing else. It writes
nothing and doesn't change the context it's given.

## The first message, in order

The sections are joined by `joinRunPromptSections`: each text trimmed, empty ones left out, the
rest separated by a blank line.

| # | Section id | What it is | Delivery |
|---|---|---|---|
| 1 | `instructions_directive` | Where the agent's instructions file was loaded from, so relative references resolve. Only when the file was read. | every run |
| 2 | `bootstrap_template` | The agent's `bootstrapPromptTemplate`, rendered. Only when the agent sets one; there's no default. | fresh only |
| 3 | `communication_guidance` | `paperclipTaskCommunicationGuidance` (a chat's guidance, then the fast-response guidance), then the fresh-session handoff from earlier runs on the task. Parts: `guidance`, `handoff`. | fresh only |
| 4 | `wake` | `renderPaperclipWakePrompt(context.paperclipWake)`: what woke the run. A resumed session gets the "Resume Delta" header. Parts: the renderer's blocks (`wake.header`, `wake.summary`, `wake.continuation`, `wake.comments`, `wake.plan_review`, …; see `PAPERCLIP_WAKE_PROMPT_PART_META` in `adapter-utils`). | every run |
| 5 | `session_rotation_note` | `paperclipSessionHandoffMarkdown`. Never set for `claude_local` today (its rotation thresholds are 0). | when rotation fires |
| 6 | `task_brief` | `selectPaperclipTaskMarkdown`: the Assignment brief, or the Assignment-Compact one on an ordinary resume. A run without a task sends the literal `null` (bug 84, reproduced). Parts: the brief's blocks (`task_brief.header`, `task_brief.issue`, `task_brief.chat_directive` or `task_brief.mode_directive`, `task_brief.description`, `task_brief.plan`, …). | every run |
| 7 | `mcp_note` | Points a sealed run at the `paperclip_*` MCP tools. Fresh sessions with Paperclip API access, except external chat turns. | fresh only |
| 8 | `heartbeat_template` | The agent's `promptTemplate`, or the default heartbeat template (`DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE`, the same text for chat turns). Left out on a resumed session that has a wake, and on recovery wakes. The default's parts: `identity`, `connection_guidance`. | fresh, and resumed without a wake |

"Delivery" in the table is the usual case; the plan sets each section's `delivery` from the sets
it actually appears in: `every_run` when it's in both, otherwise `fresh_only` or `resumed_only`.

## The system prompt

The system prompt isn't built here. `planClaudeRunSkillsAndInstructions` (`run-plan.ts` in the
adapter) returns it as `systemPromptSections`, with `placement: "system"`:

1. `agent_instructions`: the agent's `AGENTS.md` (or its configured instructions file), then a line
   telling the agent to resolve relative references from the location in the run prompt.
2. `skill_library`: the company skill library list, each skill marked enabled or not.

Their texts joined with a blank line are the bundle's `agent-instructions.md`. A fresh session gets
it through `--append-system-prompt-file`; a resumed session keeps the one it started with.

## Parts

A section's `parts` are for display only. They concatenate, with no separator, to exactly the
section's text; a part may start with the blank line that separates it from the one before. A
section has parts only when they describe its text exactly. When a later heartbeat stage appended
to the brief after its parts were made (the shared-workspace note does), the rest is one more
part, `task_brief.added`. Otherwise the section has no parts.

The brief's parts come from the context: `prepareHeartbeatTaskContext` stores them as
`paperclipTaskMarkdownAssignmentParts` and `paperclipTaskMarkdownAssignmentCompactParts`,
redacted like the text. They are non-enumerable, so the run's saved context snapshot never holds
them; `copyTaskMarkdownParts` carries them onto a copied context.

## Where the text lives

The text stays where it was before step 5; each section's `source` names it. The template files
the design describes arrive with the first change to what the prompt says.
