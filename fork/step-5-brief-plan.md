# Step 5, phase 2 Implementation Plan: the task brief

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Each agent implements only the tasks its brief names.

**Goal:** On a `claude_local` CLI run of a non-chat task there is no separate task brief: the
task's content is under "The task", its rules under "What to do now", each of the four headings is
its own section in the record and the preview, the renderer is split by heading, and every rule
names a tool the run can call (`paperclip_file_download` for runs, a new
`paperclip_request_plan_review`).

**Architecture:**
- **The server gathers the task's facts** into a new context field, `paperclipRunTask`, beside
  the brief and from the same inputs, and environment selection sets
  `paperclipSharedWorkspaceNote` when another run holds a shared workspace.
- **The adapter's renderer**, split into one module per heading, writes "The task" and the brief's
  rules from those facts, and returns the four headings as four sections. The CLI, the builder and
  the preview use those sections; the brief is left out on non-chat tasks.
- **Two MCP tool changes** make the rules callable.

**Tech Stack:** TypeScript, vitest, Drizzle/Postgres (reads), Express, SolidJS (one ui-new file).

**Spec:** [fork/step-5-brief.md](step-5-brief.md), approved 2026-11-24. Read it first: "The task",
"What to do now" (the rules table), "Data", "Sections in the record and the preview", "Two tool
changes". It builds on [step-5-wake.md](step-5-wake.md) and [step-5-handoff.md](step-5-handoff.md)
(both with Built sections).

## Decisions this plan makes

1. **`paperclipRunTask` is present exactly when the brief should be left out:** a non-chat task
   (no `conversationAgentId`) on a run that isn't an external chat turn. The CLI and the builder
   use that one test, like the handoff's `wakeHistoryReplacesHandoff`.
2. **The plan-state logic moves into one exported function** in `task-markdown.ts`,
   `briefPlanState`, used by the brief and by `paperclipRunTask`, so the two can't disagree. No
   brief text changes.
3. **Section ids and order:** `what_happened`, `where_things_stand`, `the_task`, `to_do`, in that
   order where the `wake` section was. Delivery: `every_run`, `fresh_only`, `every_run`,
   `every_run`. Part ids stay `wake.*`; new ones: `wake.task.parents`, `wake.task.description`,
   `wake.task.plan`, `wake.task.case`, `wake.task.live_voice`, `wake.to_do.task_rules`,
   `wake.to_do.shared_workspace`.
4. **Chat tasks:** the four sections, then the rotation note and `task_brief` as today. External
   chat (`usesSharedWake`): the single `wake` section as today.
5. **"Since the last run"** is the start of the task session's previous run
   (`taskSession.lastRunId`). The plan's revision is compared by its `createdAt`; a description
   edit by the task's activity record (`issue.updated` with `description` among the changes). If
   either can't be read, its flag is false and the agent says so in its report.
6. **A compaction** counts when the session's runs since the description and plan were last sent
   recorded Claude's compaction (the run log's compaction event, as the transcript's compaction
   divider reads it). If Paperclip records no such event for CLI runs, `compactedSinceLastRun` is
   always false and the agent reports it.
7. **Three agents and one integration branch,** `feat/step-5-brief`.

## Global Constraints

- Every new template string names only `paperclip_*` tools from
  `server/src/mcp/catalog/tool-names.ts` (which gains `paperclip_request_plan_review`), or plain
  words. The renderer's no-REST test covers the new templates.
- Context and payload fields are added, never removed or renamed. The brief's four variants are
  still built and set, for chat, ACP and the others.
- `paperclipRunTask` goes through the same `redactForIssue` call as the brief (`task-context.ts`).
- Records with `wake` and `task_brief` sections still display in ui-new.
- From the spec: the plan is cut at 12,000 characters; parents up to 6; the task rules go to the
  task's assignee only (`agentId === issue.assigneeAgentId`); the mode rule on every run; the
  question guidance only when the task has requests (`history.answered` or `history.open` non-empty,
  or a `questions_answered` event); no "withdraw" sentence.
- The skill change costs each agent one fresh session (the skills are in the prompt bundle's key):
  expected, no workaround.

## Review Focus

1. **A reviewer, a mentioned agent or a recovery agent on a planning task** gets no "make the
   plan" or "implement the accepted plan" rule. Test in Task 5.
2. **A resumed session where nothing changed** gets "The task" as one line, with no description,
   plan or parents. Test in Task 5.
3. **A plan longer than 12,000 characters** is cut with the `paperclip_read_document` line, and
   the record still matches. Test in Task 5.
4. **A run for an agent that can't read the attachment's task** gets a refusal from
   `paperclip_file_download`, not a link. Test in Task 2.
5. **`paperclip_request_plan_review` on a task with no plan document** is refused with a clear
   message, and a second call for the same revision doesn't create a second card. Test in Task 3.

---

## Agents and files

| Agent | Branch | Tasks | Owns |
| --- | --- | --- | --- |
| **Data** | `step5-brief/data` | 1 | `server/src/services/heartbeat/task-context.ts` (the new field only); `task-markdown.ts` (only extracting `briefPlanState`); `environment-selection.ts` (the note field only); a new `server/src/services/heartbeat/run-task-facts.ts` and its test; tests of those files |
| **Tools** | `step5-brief/tools` | 2, 3 | `server/src/mcp/catalog/files.ts`, `requests.ts`, `tool-names.ts`, `catalog-deps.ts` or wherever the run catalog's `files` is wired (`server/src/app.ts:796`, `server/src/routes/paperclip-mcp.ts`), the transfers service's run-scoped download, `skills/paperclip/SKILL.md` (the "Plans:" line only), their tests |
| **Renderer** | `step5-brief/renderer` | 4, 5, 6 | `packages/adapters/claude-local/src/server/wake/` (all), `legacy-prompt.ts`, `index.ts` (exports), `packages/adapter-utils/src/server-utils.ts` (normalizers for the two new fields only), `packages/shared/src/run-prompt.ts` (section ids), `server/src/services/run-prompt/build-claude-run-prompt.ts`, `server/src/services/run-preview-prompt.ts`, `ui-new/src/runs/prompt-sections.ts`, their tests |
| **PM** | `feat/step-5-brief` | 7 | merging, the local checks, the real run, the docs |

All three start together from `main`, against the contract below.

## The contract

```ts
// context.paperclipRunTask: set by task-context.ts on a non-chat task; absent otherwise.
type PaperclipRunTask = {
  issueId: string;
  ancestors: Array<{ identifier: string | null; title: string | null; status: string | null }>; // up to 6
  ancestorsOmitted: number;
  description: string | null;                 // trimmed; null when empty
  descriptionChangedSinceLastRun: boolean;
  plan: {
    revisionNumber: number;
    body: string;                             // cut at 12,000 characters
    truncatedFrom: number | null;             // the full length when cut
    changedSinceLastRun: boolean;
  } | null;
  workMode: string | null;                    // "standard" | "ask" | "planning" | "skill_test" | …
  titleNeedsGeneration: boolean;
  rejectedPlan: { reason: string | null } | null;             // from briefPlanState
  acceptedPlan: { revisionNumber: number | null } | null;     // when briefPlanState says implement
  wakeCommentAttachments: Array<{ commentId: string; id: string; filename: string; contentType: string; byteSize: number }>;
  attachmentOmissions: Array<{ commentId: string; notice: string }>;
  prefixParts: Array<{ id: "wake.task.case" | "wake.task.live_voice"; text: string }>;
  compactedSinceLastRun: boolean;
};

// context.paperclipSharedWorkspaceNote: set by environment selection; absent otherwise.
type PaperclipSharedWorkspaceNote = { heldByRunId: string; heldByIssue: string | null };

// packages/shared/src/run-prompt.ts
type RunPromptSectionId = /* existing */ | "what_happened" | "where_things_stand" | "the_task" | "to_do";

// task-markdown.ts
export function briefPlanState(input: PaperclipTaskMarkdownInput): {
  rejectedPlan: boolean;
  acceptedPlanContinuation: boolean;
  acceptedChatPlan: boolean;
};
```

The new tool: `paperclip_request_plan_review` `{ taskId: uuid, note?: string (max 2,000) }` →
`{ interactionId, revisionNumber, status: "pending" }`.

---

### Task 1: The task's facts and the shared-workspace note (agent: Data)

**Files:**
- Create: `server/src/services/heartbeat/run-task-facts.ts`, `run-task-facts.test.ts` (core, under 15 s)
- Modify: `task-context.ts` (set `context.paperclipRunTask`, inside the existing redaction call),
  `task-markdown.ts` (extract `briefPlanState`; the brief's text unchanged),
  `environment-selection.ts` (set `context.paperclipSharedWorkspaceNote` beside today's appended note)

**Interfaces:**
- Produces: `buildRunTaskFacts(db: Db, input: { companyId: string; issueId: string; taskMarkdownInput: PaperclipTaskMarkdownInput; taskPlan: TaskPlanContext | null; previousRunId: string | null; prefix: { caseMarkdown: string; liveVoice: string } }): Promise<PaperclipRunTask>`, and the two context fields.

- [ ] **Step 1: Write the failing tests** (`run-task-facts.test.ts`, embedded Postgres):
  - `carries the description, the plan and the parents` (3 ancestors with status);
  - `cuts the plan at 12,000 characters` (`truncatedFrom` the full length);
  - `a plan revision saved after the previous run started is changed; one before isn't`;
  - `a description edit after the previous run started is changed` (or the agent's report says why it can't be read);
  - `no previous run: nothing is "changed"`;
  - `rejectedPlan and acceptedPlan follow briefPlanState` (a rejected review with a reason; an accepted planning-mode review);
  - `lists the wake comments' attachments and omissions`;
  - `no paperclipRunTask on a chat task` (`task-context` level, in `heartbeat-task-context` style);
  - `a registered secret in the description is redacted`;
  - environment selection: `sets paperclipSharedWorkspaceNote when another run holds the shared workspace` and still appends today's note to the brief.
- [ ] **Step 2: Run, expect failures:** `cd server && corepack pnpm exec vitest run src/services/heartbeat/run-task-facts.test.ts`
- [ ] **Step 3: Implement.** `briefPlanState` is today's `rejectedPlan` / `acceptedPlanContinuation`
  / `acceptedChatPlan` expressions, moved; the brief calls it. `compactedSinceLastRun` per decision 6.
- [ ] **Step 4: Run the new file, the brief's tests, `environment-selection` tests,
  `src/__tests__/heartbeat-task-context.test.ts`, and `corepack pnpm test:quick`.** Expected: pass.
- [ ] **Step 5: Commit** on `step5-brief/data`: "Run context: the task's facts and the shared-workspace note".

### Task 2: `paperclip_file_download` for runs (agent: Tools)

**Files:**
- Modify: `server/src/mcp/catalog/files.ts` (the download tool no longer `needsGrant`; upload keeps it)
- Modify: the run catalog's wiring (`server/src/app.ts:796`, `server/src/routes/paperclip-mcp.ts`)
  and the transfers service, to issue a ten-minute download link for a run's caller
- Test: `server/src/mcp/catalog/files.test.ts` (new) and the transfers service's test

**Interfaces:**
- Produces: `paperclip_file_download` visible to run callers; same input `{ attachmentId }`, same result shape as today's.

- [ ] **Step 1: Write the failing tests:** `a run gets a download link for an attachment on a task
  it can read`; `a run is refused for another company's or an unreadable task's attachment`
  (Review Focus 4); `the upload tool stays hidden from runs`; `an outside connection still gets
  both` (unchanged).
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.** The link's ticket is tied to the run's agent and company instead of an
  OAuth grant, and checks task read access the way `GET /issues/:id` does for that agent.
- [ ] **Step 4: Run the new tests, `catalog.test.ts`, `public-mcp-catalog.test.ts`,
  `public-mcp.test.ts`, and `corepack pnpm test:quick`.** Expected: pass.
- [ ] **Step 5: Commit** on `step5-brief/tools`: "paperclip_file_download for runs".

### Task 3: `paperclip_request_plan_review` (agent: Tools)

**Files:**
- Modify: `server/src/mcp/catalog/requests.ts` (the tool), `tool-names.ts` (its name)
- Modify: `skills/paperclip/SKILL.md`, the "Plans:" line: write the `plan` document, then ask for
  its review with `paperclip_request_plan_review` and end in review
- Test: `server/src/mcp/catalog/requests.test.ts` (new or extended) and one route-level test

**Interfaces:**
- Produces: the tool per the contract. It creates, through `POST /issues/:id/interactions`, a
  `request_confirmation` whose target is `{ type: "issue_document", key: "plan", issueId,
  documentId, revisionId, revisionNumber }` for the plan's latest revision (the target
  `plan-review-context.ts` `readPlanTarget` reads), with an idempotency key from the task and
  revision, and puts the task in review as `paperclip_ask_board` does.

- [ ] **Step 1: Write the failing tests:** `creates a plan review for the latest revision`;
  `the same revision twice gives one card` and `no plan document is refused` (Review Focus 5);
  `accepting the card wakes the assignee with plan_accepted` (route-level, like the existing plan
  review tests); `the skill's Plans line names the tool`.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.** Read the plan with `GET /issues/:id/documents/plan` for its ids.
  Description: "Ask for a review of the task's plan document (its latest revision), as a card in
  the thread, and put the task in review to wait for it."
- [ ] **Step 4: Run the tests, `catalog.test.ts`, `public-mcp-catalog.test.ts`, the skill's tests
  if any, and `corepack pnpm test:quick`.** Expected: pass.
- [ ] **Step 5: Commit** on `step5-brief/tools`: "paperclip_request_plan_review".

### Task 4: Split the renderer by heading, no change in output (agent: Renderer)

**Files:**
- Create in `packages/adapters/claude-local/src/server/wake/`: `context.ts`, `what-happened.ts`,
  `where-things-stand.ts`, `the-task.ts`, `to-do.ts`
- Modify: `render.ts` (entry points only)

**Interfaces:**
- Produces: `renderClaudeWake` and `renderClaudeWakeParts` unchanged in signature and output;
  each module exports `render<Heading>(ctx): PaperclipPromptPart[]`.

- [ ] **Step 1:** Run `render.test.ts` and the adapter's tests; record the counts.
- [ ] **Step 2: Move the code.** No test changes; no text changes.
- [ ] **Step 3: Run the same tests.** Expected: the same counts, all passing.
- [ ] **Step 4: Commit** on `step5-brief/renderer`: "Wake renderer: one module per heading".

### Task 5: "The task" and the brief's rules (agent: Renderer)

**Files:**
- Modify: `the-task.ts`, `to-do.ts`, `templates.ts`, `words.ts`, `__fixtures__/payloads.ts`;
  `server-utils.ts` (normalizers `normalizePaperclipRunTask`, `normalizePaperclipSharedWorkspaceNote`)
- Test: `render.test.ts`

**Interfaces:**
- Consumes: the contract's two fields, passed to the renderer as options (`runTask`, `sharedWorkspaceNote`).

- [ ] **Step 1: Write the failing golden tests:**
  - `a fresh session's task: line, parents, description, plan (revision 2)`;
  - `a resumed session with nothing changed: one line` (Review Focus 2);
  - `a resumed session with a revised plan: "The plan changed since your last run (revision 3):"`;
  - `an edited description: "The description changed since your last run:"`;
  - `after a compaction: the description and plan again`;
  - `a cut plan ends with the paperclip_read_document line` (Review Focus 3);
  - one test per rule in the spec's table (ask, planning, planning with a plan accepted, accepted
    plan in standard mode, skill test, plan rejected with the reason quoted, provisional title,
    attachments listed in "What happened" with the `paperclip_file_download` rule, question
    guidance with requests and without);
  - `planning mode names paperclip_request_plan_review`;
  - `a reviewer on a planning task gets no task rules` (Review Focus 1);
  - `the shared-workspace rule`;
  - `a case's context and live-voice guidance are kept as parts`;
  - `no task facts: "The task" as today`.
  - `a comment wake's rule says later direction replaces conflicting scope` (the brief's follow-up
    directive, folded into the comment event's rule).
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `render.test.ts` and the adapter's tests.** Expected: pass.
- [ ] **Step 5: Commit** on `step5-brief/renderer`: "The task and its rules in the run message".

### Task 6: Four sections, and no brief on non-chat tasks (agent: Renderer)

**Files:**
- Modify: `packages/shared/src/run-prompt.ts`, `legacy-prompt.ts`, `build-claude-run-prompt.ts`,
  `run-preview-prompt.ts` (marks that name `wake` or `task_brief` parts), `ui-new/src/runs/prompt-sections.ts`
- Test: `legacy-prompt.test.ts`, `build-claude-run-prompt.test.ts`, `run-preview-prompt.test.ts`,
  ui-new's prompt-sections test

**Interfaces:**
- Produces: `renderClaudeRunMessageSections(payload, options): Array<{ id: "what_happened" | "where_things_stand" | "the_task" | "to_do"; parts: PaperclipPromptPart[] }>`, used by the CLI and the builder.

- [ ] **Step 1: Write the failing tests:** the CLI's text for a non-chat fresh run has no "Paperclip
  task context"; the builder records the four sections in order with `matchedPlan` true on
  fresh, resumed, recovery and chat runs; a chat run records the four plus `task_brief`; an
  external chat turn records `wake`; the preview shows the four; ui-new shows a tip for each new id
  and still shows an old record's `wake` and `task_brief`.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.** Section labels: "What happened", "Where things stand", "The task",
  "What to do now"; tips in `prompt-sections.ts` behind the "i" (CLAUDE.md "UI text").
- [ ] **Step 4: Run the four test files, the adapter's tests, ui-new's `test` and `typecheck`, and
  `corepack pnpm test:quick`.** Expected: pass.
- [ ] **Step 5: Commit** on `step5-brief/renderer`: "Run message: four sections; no brief on non-chat tasks".

### Task 7: Integrate, check with a real run, record (PM)

- [ ] **Step 1:** Create `feat/step-5-brief` from `main` in its own worktree. Merge
  `step5-brief/data`, `step5-brief/tools`, then `step5-brief/renderer`, each `--no-ff`.
- [ ] **Step 2: The local checks** (CLAUDE.md "Tests"), plus once, under the lock, the four
  extended files covering the payload and task context.
- [ ] **Step 3: One real run** on the desktop dev instance from the integration worktree (agent
  "M7 test sealed runner", "M7 test" tasks, never Bob, never server1, paused afterwards): a
  planning-mode task with a description. The agent writes the plan and asks for a review with
  `paperclip_request_plan_review`; send it back with a change; the resumed run sees the rejected
  plan's rule and the reason, revises and asks again; accept it; the next run implements revision
  2. Check each run's Input tab: four sections, no brief, `matchedPlan` true.
- [ ] **Step 4:** Merge `feat/step-5-brief` into `main` with `--no-ff` once steps 2 and 3 pass.
- [ ] **Step 5: Record** in one docs commit: a "Built" section in `fork/step-5-brief.md`; bug 89
  (the brief's REST recipes no longer reach these runs); step 5's progress row. Don't push until
  the user asks.
