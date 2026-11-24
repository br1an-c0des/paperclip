# Step 5 Implementation Plan: see the prompt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Each agent implements only the tasks its brief names.

**Goal:**
- A `claude_local` CLI run records its whole prompt as labelled sections, and the run view shows
  them.
- The agent's "What runs get" card shows a draft of the next run's prompt for a chosen task and
  kind of run.
- No agent receives anything different from today.

**Architecture:**
- **A server builder,** `server/src/services/run-prompt/`, turns a run's context into the
  first-message sections for a fresh and for a resumed session, each section with display parts.
  The heartbeat calls it just before `adapter.execute`, and the run preview calls the same function
  with facts it gathers read-only.
- **The CLI adapter** picks the set for the session it actually starts, checks that it joins to
  exactly the prompt it would have sent, and records it.
- **The system prompt's parts** come from the adapter's existing run plan.
- **Storage:** a new `adapter.prompt` run event holds the record, without the 16k string cut.
- **`ui-new`** shows the sections in a past run's Input and in the run preview card.

**Tech Stack:** TypeScript, vitest, Express, Drizzle/Postgres (read-only here), SolidJS (`ui-new`).

**Spec:** [fork/step-5-prompt-builder.md](step-5-prompt-builder.md), approved 2026-11-23. Read it
first; this plan argues from it. The baseline, with file references, is
[step-5-research.md](step-5-research.md). Section 3.1 lists the kinds of run, and section 3.7
covers the preview's side effects.

## Decisions this plan makes

**1. The adapter keeps today's join and uses it as the check** (refines the design's "the adapter
only carries it"). Three of today's sections depend on what only the launch knows:
- the instructions-path directive (was the file read?);
- the MCP note (is the run sealed, and does it have a token?);
- the fresh-session handoff, which is loaded at each attempt.

The builder computes all three the same way the launch does, but a difference in production
inputs can't be caught by a test. So in this step the adapter still composes the prompt with
today's code, extracted into one pure function (Task 1), and sends that text. It then joins the
builder's chosen set and compares:
- **Equal:** the record holds the builder's labelled sections.
- **Not equal:** the record holds the sent text as one unsplit section, marked
  `matchedPlan: false`, and the run log says so.

What agents receive can't change, and any drift between the builder and the launch shows up in
the run's record. A later step that changes the prompt drops the check and sends the builder's
text.

**2. Sections are today's 8, and finer splits are display parts.** The first message is
`joinPromptSections` of the 8 section texts, as today. A section may carry `parts`: the wake's
comments, continuation and review threads, or the task brief's header, description and plan. The
UI shows the parts. A section keeps its parts only when they join back to its text exactly;
otherwise it has none. Parts never change the sent text.

**3. The record is its own run event.** `adapter.invoke` keeps its shape: four places read it
(research section 4). The adapter passes a `promptRecord` on its meta, and the server stores it as
an `adapter.prompt` event, with section and part text allowed up to 256 KiB each instead of
16 KiB. It goes through the same secret and current-user redaction as other run events.

**4. The text stays where it is; template files wait for the step that changes it** (defers the
design's goal 3, "with its text in template files"). Today's text lives in TypeScript constants in
about a dozen files across four packages, and the ACP engine and the dormant adapters share most
of it. Moving it into `.md` templates byte for byte would touch all of that, and show nothing new.
So in this step the builder labels the text where it is: each section's `source` names the
constant or field it came from. The templates arrive with the first change to what the prompt says,
when that text is being rewritten anyway. The builder's README records the section order now.

## Global Constraints

- **Only `claude_local` on the CLI engine, local targets.** ACP (`engine: "acp"`), remote targets,
  the Runner and other adapters keep today's path, and their tests pass unchanged.
- **The text Claude receives is byte-identical to today** for every kind of run, on fresh and
  resumed sessions.
- **The system prompt and the prompt bundle key don't change,** so no session resets.
- **The preview writes nothing:**
  - no files;
  - no run token or MCP bearer;
  - no checkout;
  - no database writes;
  - no run row.

  It may decrypt the issue's registered secrets to redact task text, on the server only.
- **No migration.**
- **`ui-new`:**
  - help text goes behind an "i" tip (`InfoTip`, decision 52);
  - imports from `@paperclipai/shared` use `import type`;
  - follow `ui-new/docs/design/`;
  - load the `solidjs` skill first.
- **Tests:**
  - the named files while building;
  - `corepack pnpm test:quick` before finishing;
  - single files: `corepack pnpm exec vitest run <path>`;
  - new test files land in core.
- **No real runs, and no agent wakes,** without the user's go-ahead. Never against server1's real
  instance.

## Review Focus

1. **A run whose resume fails and retries fresh** (`execute.ts` fresh retry, ~1421–1468): its
   record must describe the fresh attempt that ran, not the failed resume. Test in Task 7.
2. **A chat turn's prompt** (about 30k characters) must be stored whole: the record's `wake` and
   `task_brief` text is longer than 16,384 characters and arrives untruncated, still redacted.
   Test in Task 5.
3. **A no-task run** (unscoped timer): the plan reproduces today's `"null"` task brief (bug 84)
   rather than dropping it, so the comparison matches. Test in Task 4.
4. **A secret on a task.** A registered secret in a task's description must be redacted in both
   the record and the preview, never shown in clear text. Test in Task 8.
5. **A run recorded before step 5** (no `adapter.prompt` event) still shows its prompt in Input,
   as one section labelled as recorded before sections existed. Test in Task 6.

## How the work is split

| Wave | Agent | Tasks | Branch |
| --- | --- | --- | --- |
| 0 | Contracts | 0 | `step5/contracts` |
| 1 | Builder | 1–4 | `step5/builder` |
| 1 | Record and run view | 5–6 | `step5/record` |
| 2 | Wiring | 7 | `step5/builder` (same agent, after wave 1 review) |
| 2 | Preview | 8–9 | `step5/preview` |
| 3 | Check (manager, with the user) | 10–11 | `feat/step-5` |

- **The integration branch** is `feat/step-5`, cut from `main`.
- **Agent branches** are cut from it after Task 0 merges, and merged back with `--no-ff` after
  review.
- **The preview** starts after the builder's Tasks 1–4 merge.
- **Worktrees may start from `master`:** reset onto `feat/step-5` first (CLAUDE.md, "Gotchas").

---

### Task 0: Contracts

**Files:**
- Create: `packages/shared/src/run-prompt.ts`, and export it from the package index like
  `claude-run-manifest.ts`.
- Modify: `packages/adapter-utils/src/types.ts`: `AdapterInvocationMeta` (line 189) and
  `AdapterRunPreview` (~line 557).
- Modify: `packages/shared/src/claude-run-manifest.ts`: `ClaudeRunPreview` (line 186).
- Test: `packages/shared/src/run-prompt.test.ts`.

**Interfaces (produces), in `@paperclipai/shared`:**

```ts
export type RunPromptPlacement = "system" | "first_message";
export type RunPromptDelivery = "every_run" | "fresh_only" | "resumed_only";
export type RunPromptSectionId =
  | "agent_instructions" | "skill_library"                       // system prompt
  | "instructions_directive" | "bootstrap_template" | "communication_guidance" | "wake"
  | "session_rotation_note" | "task_brief" | "mcp_note" | "heartbeat_template"
  | "unsplit";                                                   // sent text, not split
export interface RunPromptPart {
  id: string;            // e.g. "wake.comments", "task_brief.description"
  label: string;         // short, for the UI
  source: string;        // e.g. "task description", "template: default heartbeat"
  text: string;
  chars: number;
  pending?: string;      // preview only: why the value is filled in at launch
}
export interface RunPromptSection {
  id: RunPromptSectionId;
  label: string;
  placement: RunPromptPlacement;
  delivery: RunPromptDelivery;
  reason: string;        // why it was included, e.g. "woken by a comment"
  source: string;
  text: string;
  chars: number;
  parts?: RunPromptPart[];   // present only when they join to `text` exactly
  pending?: string;
}
export interface RunPromptPlan {
  version: 1;
  fresh: RunPromptSection[];     // first-message sections a fresh session gets, in order
  resumed: RunPromptSection[];   // those a resumed session gets, in order
}
export interface RunPromptRecord {
  version: 1;
  session: "fresh" | "resumed";
  /** Fresh: the system prompt's parts as sent. Resumed: [] (Claude keeps the session's own). */
  systemPrompt: RunPromptSection[];
  firstMessage: RunPromptSection[];
  firstMessageChars: number;
  /** false: the builder's sections didn't join to the sent text; firstMessage is one "unsplit" section. */
  matchedPlan: boolean;
}
export type RunPromptPreviewKind = "assignment" | "comment" | "chat_turn" | "no_task";
export interface RunPromptPreview {
  kind: RunPromptPreviewKind;
  issueId: string | null;
  systemPrompt: RunPromptSection[];
  firstMessage: RunPromptSection[];   // the fresh set
  firstMessageChars: number;
}
export function isRunPromptRecord(value: unknown): value is RunPromptRecord; // version === 1, arrays present
export function joinRunPromptSections(sections: RunPromptSection[]): string;   // same rule as joinPromptSections
```

**Interfaces (produces), elsewhere:**
- In `@paperclipai/adapter-utils`: `AdapterInvocationMeta.promptRecord?: RunPromptRecord`.
- `AdapterRunPreview` (supported) gains `systemPrompt: RunPromptSection[]` and
  `instructionsPathDirective: string`.
- `ClaudeRunPreview` (supported) gains `prompt: RunPromptPreview | null`.

`joinRunPromptSections` must equal `joinPromptSections(sections.map(s => s.text))`
(`packages/adapter-utils/src/server-utils.ts:517`). The shared package can't import
`adapter-utils`, so copy the rule and pin it with a test.

- [ ] **Step 1:** Write tests for `isRunPromptRecord` and `joinRunPromptSections`:
  - a minimal record is accepted;
  - `{ version: 2 }` and `null` are rejected;
  - join matches the rule on `["a", "", "  ", "b"]`. Read `joinPromptSections` for the exact rule
    and copy its cases.
- [ ] **Step 2:** Run `corepack pnpm exec vitest run packages/shared/src/run-prompt.test.ts`;
  expect FAIL.
- [ ] **Step 3:** Write the module and the three type changes.
- [ ] **Step 4:** Run the test; expect PASS.
- [ ] **Step 5:** Run `corepack pnpm --filter @paperclipai/shared typecheck`, the same for
  `@paperclipai/adapter-utils`, and `corepack pnpm --filter @paperclipai/ui-new typecheck`.
- [ ] **Step 6:** Commit: `Step 5: run prompt contracts`.

### Task 1: Today's CLI join as one pure function

**Files:**
- Create: `packages/adapters/claude-local/src/server/legacy-prompt.ts`.
- Modify: `packages/adapters/claude-local/src/server/execute.ts:925-962` to call it.
- Test: `packages/adapters/claude-local/src/server/legacy-prompt.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export interface ClaudeCliPromptInput {
    context: Record<string, unknown>;      // after hydrateFreshSessionHandoff for this attempt
    resumed: boolean;
    instructionsPathDirective: string;
    bootstrapPromptTemplate: string;
    promptTemplate: string;
    templateData: Record<string, unknown>;
    sealed: boolean;
    env: Record<string, string>;           // for renderPaperclipMcpNote
  }
  export function composeClaudeCliPrompt(input: ClaudeCliPromptInput):
    { prompt: string; promptMetrics: Record<string, number> };
  ```
  The body is today's lines 927–962, moved unchanged. The `promptTemplate` default (lines
  363–368) moves into an exported `resolveClaudePromptTemplate(config, context): string`.

- [ ] **Step 1:** Write tests that pin today's output on the shared fixture
  (`test-fixtures/prompt-context.ts`) for:
  - a fresh session;
  - a resumed session with a wake;
  - a resumed session without one;
  - a recovery wake;
  - an external chat turn;
  - `sealed: false`.

  Use inline snapshots, so the text is visible in review.
- [ ] **Step 2:** Run them; expect FAIL (module missing).
- [ ] **Step 3:** Move the code, and make `execute.ts` call `composeClaudeCliPrompt`.
- [ ] **Step 4:** Run the new tests and `server/src/__tests__/claude-local-execute.test.ts` and
  `claude-local-sealed-run.test.ts`; expect PASS with no snapshot changes.
- [ ] **Step 5:** Commit: `claude_local: today's CLI prompt join as one function`.

### Task 2: Display parts for the wake

**Files:**
- Modify: `packages/adapter-utils/src/server-utils.ts`: `renderPaperclipWakePromptBody`
  (2343–3312) and `renderPaperclipWakePrompt` (2329).
- Test: `packages/adapter-utils/src/server-utils.test.ts` (or `prompt-sections.test.ts`, whichever
  holds the renderer's fixtures).

**Interfaces:**
- Produces:
  ```ts
  export interface PaperclipPromptPart { id: string; label: string; source: string; text: string }
  export function renderPaperclipWakePromptParts(value: unknown,
    options: Parameters<typeof renderPaperclipWakePrompt>[1]): PaperclipPromptPart[];
  ```
  The invariant: joining the parts by the body's own rule, followed by the wrapper's three appended
  parts (connector skills, connection instructions, MCP-app context), equals
  `renderPaperclipWakePrompt(value, options)`.
- Approach: the body builds one `lines` array. Record the line index where each `## …` block or
  named block starts (header, reason lines, continuation, comments, plan review, document
  annotations, recovery, execution stage, watchdog, stalled dependency, answered questions, agent
  message, children summaries, external chat), then slice. Don't change any pushed text. The
  research's section 3.3 table names the blocks and their lines.

- [ ] **Step 1:** Write a test that runs every existing renderer fixture through both functions
  and asserts the join invariant. Add one fixture that hits at least 6 blocks, and assert its part
  ids in order.
- [ ] **Step 2:** Run it; expect FAIL.
- [ ] **Step 3:** Implement. `renderPaperclipWakePrompt` keeps returning exactly what it returns
  today.
- [ ] **Step 4:** Run the renderer's test files and
  `packages/adapter-utils/src/acpx-engine/execute.test.ts`; expect PASS, unchanged.
- [ ] **Step 5:** Commit: `adapter-utils: the wake prompt as named parts, same text`.

### Task 3: Display parts for the task brief

**Files:**
- Modify: `server/src/services/heartbeat/task-markdown.ts` (`buildPaperclipTaskMarkdown`, :130).
- Modify: `server/src/services/heartbeat/task-context.ts:335-387`.
- Test: `server/src/services/heartbeat/task-markdown.test.ts`.

**Interfaces:**
- Produces: `buildPaperclipTaskMarkdownParts(input): PaperclipPromptPart[] | null`, where
  `buildPaperclipTaskMarkdown(input) === join(parts)` (or both null). The parts are:
  - the header;
  - the question guidance;
  - the issue lines;
  - the work-mode or chat directive;
  - the description;
  - the plan document;
  - the ancestors;
  - the closing line.
- Produces, on the in-memory context: `paperclipTaskMarkdownAssignmentParts` and
  `paperclipTaskMarkdownAssignmentCompactParts`. These are the variants `claude_local` reads. They
  include the `assignmentPrefix` and `chatCompletionInstruction` as their own parts, and are
  redacted with the same `redactForIssue` as the strings.
  - **Don't persist them** in the run's saved context snapshot. If `context` is persisted as it
    stands, delete the keys before it's saved.
  - **Drop them** when a redacted part list no longer joins to the redacted string.

- [ ] **Step 1:** Test that the join invariant holds for the file's existing cases, plus a chat
  brief and a planning brief.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. `buildPaperclipTaskMarkdown` becomes the join.
- [ ] **Step 4:** Run `task-markdown.test.ts`, `agent-conversations.test.ts` and
  `issue-comment-redaction.test.ts`; expect PASS.
- [ ] **Step 5:** Commit: `Heartbeat: the task brief as named parts, same text`.

### Task 4: The builder

**Files:**
- Create: `server/src/services/run-prompt/build-claude-run-prompt.ts` and `README.md`. The README
  gives the section order and what each section is.
- Test: `server/src/services/run-prompt/build-claude-run-prompt.test.ts`.
- Modify: `packages/adapters/claude-local/src/server/run-plan.ts:508-568`. Export
  `planClaudeInstructionsDirective(config): Promise<{ directive: string; readError: string | null }>`,
  used by `planClaudeRunSkillsAndInstructions`. Also add
  `systemPromptSections: RunPromptSection[]` (`agent_instructions`, `skill_library`) to its result,
  whose join equals `combinedInstructionsContents`.

**Interfaces:**
- Consumes:
  - `composeClaudeCliPrompt` and `resolveClaudePromptTemplate` (Task 1);
  - the wake parts (Task 2);
  - the brief parts (Task 3);
  - the contracts (Task 0).
- Produces:
  ```ts
  export interface ClaudeRunPromptInput {
    agent: { id: string; companyId: string } & Record<string, unknown>;
    runId: string;
    config: Record<string, unknown>;          // the runtime config the adapter gets
    context: Record<string, unknown>;          // the adapter context, before handoff hydration
    sealed: boolean;                           // local target
    paperclipApiReachable: boolean;            // run token and PAPERCLIP_API_URL present
    loadFreshSessionHandoff: () => Promise<string | null>;
  }
  export async function buildClaudeRunPromptPlan(input: ClaudeRunPromptInput): Promise<RunPromptPlan>;
  ```
- Rules:
  - Each set is built from the same selectors today's join uses, with `resumed` false and true.
  - The fresh set includes the handoff from `loadFreshSessionHandoff`.
  - Sections with empty text are left out, matching `joinPromptSections`.
  - Every section gets a `reason`, `source` and `delivery`. A section in both sets is `every_run`;
    one in only one set is `fresh_only` or `resumed_only`.
  - The `communication_guidance` section's parts are the guidance and the handoff.
  - The `bootstrap_template` and `heartbeat_template` sections say whether they're the agent's own
    setting or the default.

- [ ] **Step 1:** Write the golden test. For each kind of run in research section 3.1, and for
  each of fresh and resumed:

  ```ts
  joinRunPromptSections(plan[set]) === composeClaudeCliPrompt({ ...sameInputs, resumed }).prompt
  ```

  The kinds:
  - fresh assignment;
  - resumed comment wake;
  - comment with an open plan review;
  - chat turn (`conversationMode`);
  - external chat turn;
  - recovery;
  - routine (an `issue_assigned` from a routine);
  - no task (the `"null"` brief, bug 84);
  - approval wake;
  - an answered question (`questionResponse`);
  - an execution review stage.

  Build each context through `prepareHeartbeatTaskContext`'s output shape, reusing the existing
  fixtures and test helpers.
- [ ] **Step 2:** Assert labels on two of those cases: the fresh assignment's section ids in order,
  and the chat turn's `task_brief` parts including the chat directive.
- [ ] **Step 3:** Run; expect FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run the test, `preview.test.ts` and `prompt-cache.test.ts`; expect PASS.
- [ ] **Step 6:** Commit: `Server: the claude_local run prompt builder (reproduces today's prompt)`.

### Task 5: Storing the record

**Files:**
- Modify: `server/src/services/heartbeat/run-log.ts`.
  `boundHeartbeatRunEventPayloadForStorage(payload, options?: { maxStringChars?: number })`, with
  the default unchanged.
- Modify: `server/src/services/heartbeat/run-lifecycle.ts`.
  - `onAdapterMeta` (~2263) takes `promptRecord` off the meta, appends `adapter.invoke` as today,
    then appends `adapter.prompt` with the record as the payload.
  - `appendRunEvent` (~2265) bounds `adapter.prompt` with `maxStringChars: 256 * 1024`.
- Test: `server/src/services/heartbeat/run-log.test.ts`, plus a test beside `run-lifecycle`'s meta
  handling.

**Interfaces:**
- Produces: run events of type `adapter.prompt`, with payload `RunPromptRecord`, readable through
  the existing run events API. The `adapter.invoke` payload no longer carries `promptRecord`.

- [ ] **Step 1:** Write the tests:
  - a 40,000-character section text is stored whole in `adapter.prompt`, while `adapter.invoke`'s
    `prompt` is still cut at 16,384;
  - a 300 KiB section is cut at 256 KiB with the usual `[truncated N chars]` note;
  - a secret-shaped key inside the record is redacted;
  - the current user's name in a section's text is redacted.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the two files; expect PASS.
- [ ] **Step 5:** Commit: `Runs: store the prompt record whole, as adapter.prompt (bug 87)`.

### Task 6: The run view's Input, in sections

**Files:**
- Create: `ui-new/src/runs/prompt-sections.ts` (the model) and `ui-new/src/runs/PromptSections.tsx`
  (a view the preview card reuses).
- Modify: `ui-new/src/runs/invocation.ts` (find `adapter.prompt` beside `adapter.invoke`) and
  `ui-new/src/runs/RunInput.tsx`.
- Test: `ui-new/src/runs/prompt-sections.test.ts`, `ui-new/src/runs/PromptSections.test.tsx`.

**Interfaces:**
- Consumes: `RunPromptRecord`, `RunPromptSection`, `isRunPromptRecord` (Task 0), with
  `import type` for the types.
- Produces:
  - `promptViewFromRecord(record: RunPromptRecord): PromptView`;
  - `promptViewFromLegacyPrompt(prompt: string): PromptView`, one section labelled "Recorded before
    sections".
  - `<PromptSections view={PromptView} />` shows:
    - two groups, "System prompt" and "First message", the first marked "kept from the session's
      start" on a resumed run;
    - each section folded by default, with its label, reason, source, size and delivery;
    - its parts inside it;
    - a Copy button for the whole first message;
    - a note when `matchedPlan` is false.

  Pending markers are for Task 9.

- [ ] **Step 1:** Model tests:
  - a record gives the groups and order;
  - a resumed record's empty system prompt shows the "kept" note;
  - a legacy prompt gives one section;
  - sizes are formatted like the rest of the run view.
- [ ] **Step 2:** Component tests: folding, Copy, and the `matchedPlan: false` note.
- [ ] **Step 3:** Run `corepack pnpm --filter @paperclipai/ui-new test -- prompt-sections
  PromptSections`; expect FAIL.
- [ ] **Step 4:** Implement, following `ui-new/docs/design/` and the run view's existing styles.
  The descriptions of what a section *is* go in `InfoTip`s.
- [ ] **Step 5:** Run `ui-new`'s `typecheck` and `test`; expect PASS.
- [ ] **Step 6:** Commit: `ui-new: a run's prompt in labelled sections`.

### Task 7: Wiring the run

**Files:**
- Modify: `server/src/services/heartbeat/runtime-execution.ts`. Just before the legacy
  `adapter.execute` call (~887), for a `claude_local` agent whose engine resolves to CLI
  (`resolveClaudeExecutionEngine`), call `buildClaudeRunPromptPlan` on `adapterContext`. Put the
  plan on `adapterContext.paperclipRunPromptPlan`.
  - It's never saved to the run's context snapshot.
  - A builder error is logged as a run warning and leaves the key unset. The run goes ahead.
- Modify: `packages/adapters/claude-local/src/server/execute.ts`. In `runAttempt`, after
  `composeClaudeCliPrompt`:
  - pick `plan.fresh` or `plan.resumed` for this attempt and compare its join to `prompt`;
  - build the `RunPromptRecord`: the system sections from the run plan on fresh, `[]` on resumed,
    and `matchedPlan`;
  - pass it as `promptRecord` in `onMeta`;
  - on a mismatch, log `[paperclip] prompt sections didn't match the sent prompt; recorded it
    unsplit.`
  - Without a plan, record one `unsplit` section with `matchedPlan: false`.
- Test: `server/src/__tests__/claude-local-execute.test.ts` (or a new
  `claude-local-prompt-record.test.ts`), and `runtime-execution.test.ts`.

**Interfaces:**
- Consumes: Tasks 1, 4 and 5.
- Produces: every local CLI run emits `adapter.prompt`.

- [ ] **Step 1:** Write the tests:
  - a fresh run records `session: "fresh"`, `matchedPlan: true` and the system sections;
  - a resumed run records `session: "resumed"` and an empty `systemPrompt`;
  - **a resume that fails and retries fresh records the fresh attempt** (Review Focus 1);
  - a plan altered by the test to differ records `unsplit` and `matchedPlan: false`;
  - the text sent to stdin is the same in all cases;
  - an ACP-engine agent gets no plan.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, `claude-local-sealed-run.test.ts` and `runtime-execution.test.ts`;
  expect PASS.
- [ ] **Step 5:** Commit: `claude_local: record each run's prompt sections`.

### Task 8: The next-run preview (server)

**Files:**
- Create: `server/src/services/run-preview-prompt.ts`.
- Modify: `server/src/services/run-preview.ts`, adding `issueId` and `kind` to `previewAgentRun`
  and putting `prompt` on the result.
- Modify: `server/src/routes/agents.ts:4270`, reading the query parameters
  `issueId` and `kind`, and `server/src/routes/openapi.ts`, to document them.
- Modify: `packages/adapters/claude-local/src/server/preview.ts`, which returns `systemPrompt` and
  `instructionsPathDirective` from the run plan.
- Test: `server/src/services/run-preview-prompt.test.ts`, and extend
  `server/src/__tests__/run-preview.test.ts`.

**Interfaces:**
- Consumes: `buildClaudeRunPromptPlan` (Task 4).
- Produces: `GET /api/agents/:id/run-preview?projectId=&issueId=&kind=` returns `prompt`:
  - **no kind or issue:** the `no_task` kind;
  - **`issueId` without a kind:** `assignment`;
  - **`chat_turn`:** needs an issue that is one of the agent's chats; otherwise answer 422,
    `not_a_chat`;
  - **`comment`:** uses the task's latest comment as the waking comment; without one, answer 422,
    `no_comment`.
- Approach:
  - Build the context the heartbeat would build for that wake: the wake reason, the issue and
    comment ids, and `conversationMode` for a chat. Go through `prepareHeartbeatTaskContext` and
    `buildPaperclipWakePayload` with a synthetic run object (id `"preview"`).
  - Then call the builder with `loadFreshSessionHandoff` from the same loader the heartbeat uses
    (`createNativeSessionHandoffLoader`).
  - Fields that later heartbeat stages patch in become a part or section with `pending` set:
    - the checkout flag;
    - the branch name;
    - connector and connection text when the agent has connectors;
    - MCP-app context.
  - The research's section 3.7 lists them.
  - Read `prepareHeartbeatTaskContext` and its callees for anything that writes, and route around
    it rather than calling it.
  - Update `run-preview.ts`'s "no secret decrypted" comment: the preview decrypts registered
    secrets to redact, on the server only.

- [ ] **Step 1:** Write the tests:
  - a fresh-assignment preview's `firstMessage` equals the builder's fresh set for the same task;
  - a chat-turn preview has the chat directive part;
  - `comment` on a task without comments answers 422;
  - **a task with a registered secret in its description shows it redacted** (Review Focus 4);
  - extend run-preview's "writes no files, mints no tokens and writes nothing to the database"
    test to call each kind.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the two files, `preview.test.ts` and `agent-routes` tests that cover
  run-preview; expect PASS.
- [ ] **Step 5:** Commit: `Run preview: the next run's prompt, for a task and kind of run`.

### Task 9: The preview card's prompt

**Files:**
- Modify: `ui-new/src/agents/settings/RunPreviewCard.tsx` and `.css`, and the agents API client
  (`ui-new/src/api/agents.ts`: preview query parameters and query key).
- Test: `ui-new/src/agents/settings/RunPreviewCard.test.tsx`.

**Interfaces:**
- Consumes: `PromptSections` (Task 6) and `ClaudeRunPreview.prompt` (Task 0).
- Produces: a Prompt part in the card:
  - a task picker (the agent's assigned tasks first, with search);
  - a kind picker (Fresh assignment, Comment, Chat turn; "No task" when no task is picked);
  - the section view of the draft, with pending values marked ("filled in at launch", with the
    reason in a tip).

  The 422 answers show as a short note beside the picker.

- [ ] **Step 1:** Tests:
  - picking a task and a kind refetches with those parameters;
  - pending parts show their marker;
  - `not_a_chat` shows its note.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `ui-new`'s `typecheck`, `test` and `test:e2e`; expect PASS.
- [ ] **Step 5:** Commit: `ui-new: the next run's prompt in What runs get`.

### Task 10: The check (manager, with the user)

- [ ] **Step 1:** Run extended once on `feat/step-5`, since it touches the run path:
  `gh workflow run extended-nightly.yml -R br1an-c0des/paperclip --ref feat/step-5`. Read the
  result; send back only failures about this change.
- [ ] **Step 2:** With the user's go-ahead, make one or two real runs on the desktop's dev instance
  with a paused "M7 test" agent, never Bob:
  - a fresh assignment, then a comment that resumes it;
  - expect `matchedPlan: true` on both;
  - expect the stored prompt to equal the old `adapter.invoke` prompt where it's under 16k;
  - expect the run view and the preview card to show the same sections for the fresh run.
- [ ] **Step 3:** Record the results in the design doc.

### Task 11: Docs, then merge

- [ ] **Step 1:** The manager updates:
  - the hard-fork plan's progress row;
  - `claude-local-run.md`'s prompt rows (the builder, the record);
  - bug 87 marked fixed;
  - the capabilities and decisions docs, where the run view and agent settings rows change.
- [ ] **Step 2:** Push `feat/step-5`, wait for CI to be green, then merge into `main` with
  `--no-ff`: `Merge step 5: see the prompt`.
