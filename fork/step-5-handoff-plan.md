# Step 5, phase 2 Implementation Plan: the handoff

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Each agent implements only the tasks its brief names.

**Goal:** On a fresh session of the agent's own (non-chat) task, a `claude_local` CLI run gets one
readable history under the wake's "Where things stand" (its last run's summary, the task's
requests and answers, its documents, its comments) and no handoff block; `paperclip_read_task`
can read back the requests and the authors' names.

**Architecture:**
- **One server read, two users.** A new service reads a task's request history (questions,
  confirmations, connection requests, linked approvals), its last run summary and its documents,
  with the handoff's exclusions and the trust rule. The wake payload builder puts its result on
  the payload as `history`; a new read-only route returns the requests to `paperclip_read_task`.
- **The wake renderer** renders `history` under "Where things stand" on fresh sessions, in place
  of the continuation summary.
- **The CLI and the builder** leave out `communication_guidance.handoff` whenever the payload has
  `history`. Chat tasks get no `history`, so they keep the handoff.

**Tech Stack:** TypeScript, vitest, Drizzle/Postgres (reads only), Express.

**Spec:** [fork/step-5-handoff.md](step-5-handoff.md), approved 2026-11-24. Read it first, "What a
fresh session gets" above all. It builds on the wake ([step-5-wake.md](step-5-wake.md), Built
section) and its plan ([step-5-wake-plan.md](step-5-wake-plan.md)).

## Decisions this plan makes

1. **`history` is filled on every run of the assignee's own non-chat task,** fresh or resumed: the
   payload is built before the run knows whether its resume will work, and a failed resume retries
   fresh with the same payload. The renderer uses it only on fresh sessions. Cost: three small
   reads per run.
2. **`history` present is the switch.** The CLI and the builder drop the handoff part exactly when
   the normalized payload has `history`. No other flag.
3. **The plan is "in the brief" when its key is `plan`:** the brief carries the plan document on
   every non-chat task that has one (`getTaskPlanContext`, `task-context.ts`).
4. **The tool's route:** `GET /issues/:id/request-history`, new and read-only, returning
   `{ requests, names }`; `names` also covers the task's comment authors, so `paperclip_read_task`
   needs one extra call for both. It records nothing (no `recordDeclinedInteractionRead`).
5. **Approval statuses:** `approved`, `rejected` and `revision_requested` count as answered;
   `pending` as open; `cancelled` is left out of the history (the tool returns it, marked).
6. **One integration branch,** `feat/step-5-handoff`, as for the wake.

## Global Constraints

- Every new template string names only `paperclip_*` tools from
  `server/src/mcp/catalog/tool-names.ts`, or plain words (the wake renderer's test checks this).
- Payload fields are added as optional, never removed or renamed.
- The handoff (`native-session-handoff.ts`, `session-preparation.ts`, `hydrateFreshSessionHandoff`)
  is not changed: it still runs and still sets its context field, for chat, ACP and the others.
- Requests whose payload has `toolAction`, `secretProposal` or `connectionAuthorization` are left
  out everywhere (history and route), as the handoff's query does.
- Low-trust runs and callers (`trustPreset.kind === "low_trust_review"`, the same test
  `task-context.ts` uses for `exposeLowTrustRaw`) get only their own agent's requests and no
  approvals.
- Run summaries from runs with a non-standard trust preset are quarantined the way the handoff does
  (`resolveCoreTrustPreset`, `buildLowTrustSourceTrust`, `sanitizeQuarantinedCommentForHigherTrust`).
- Everything in `history` goes through the payload's existing `redactForIssue`.
- Caps, from the spec: whole section 12,000 characters; the run summary 2,000; each request 1,000;
  up to 8 answered requests, most recent first; documents as one line.
- Times use the wake's format (`Nov 24, 10:20`, the payload's `timeZone`, else UTC); names come
  from the payload's `names` map.

## Review Focus

1. **A resume that fails and retries fresh:** the retry's prompt has the history and no handoff
   (the payload already has `history`; the handoff is hydrated afterwards). Test in Task 3.
2. **A fresh session with no comments,** only an open question or only a last run: "Where things
   stand" still renders, with no empty "comments" heading. Test in Task 2.
3. **An "Other" answer** shows the typed text, never `paperclip_custom_answer` (bug 94 is about the
   same id elsewhere). Test in Task 2.
4. **An answer whose option id isn't in the question's options** (edited or removed) shows "(an
   option no longer listed)" rather than the raw id. Test in Task 2.
5. **A registered secret in an answer, a reason or a run summary** is redacted. Test in Task 1.

---

## Agents and files

| Agent | Branch | Tasks | Owns |
| --- | --- | --- | --- |
| **Server** | `step5-handoff/server` | 1, 4 | `server/src/services/task-request-history.ts` (new) and its test; `server/src/services/heartbeat/run-preparation.ts` (the `history` field only) and `run-preparation.wake-fields.test.ts`; `task-context.ts` only to pass the run's low-trust flag into the payload input; the new route in `server/src/routes/issues.ts`; `server/src/mcp/catalog/tasks.ts` and `tasks.test.ts` (new) |
| **Renderer** | `step5-handoff/renderer` | 2, 3 | `packages/adapter-utils/src/server-utils.ts` (the payload type and normalizer for `history` only); `packages/adapters/claude-local/src/server/wake/` (`render.ts`, `templates.ts`, `events.ts`, `words.ts`, fixtures, tests); `legacy-prompt.ts`; `server/src/services/run-prompt/build-claude-run-prompt.ts`; `server/src/services/run-preview-prompt.ts` if its marks need it; their tests |
| **PM** | `feat/step-5-handoff` | 5 | merging, the local checks, the real run, the docs |

Both agents start together from `main`, against the contract below. Neither touches the other's
files.

## The contract: the `history` payload field

Optional on the payload `buildPaperclipWakePayload` returns and on the normalized
`PaperclipWakePayload` (`packages/adapter-utils/src/server-utils.ts`). Absent and `null` mean the
same: not the assignee's own non-chat task.

```ts
type PaperclipWakeLastRun = {
  runId: string;
  agentId: string;
  ownRun: boolean;               // false: the previous assignee's run on a handed-over task
  status: string;                // heartbeat_runs.status
  finishedAt: string;            // ISO
  body: string;                  // cut to 2,000 characters
  bodyTruncated: boolean;
};

type PaperclipWakeRequest = {
  id: string;
  kind: "ask_user_questions" | "request_confirmation" | "request_checkbox_confirmation"
      | "connection_intent" | "approval";
  status: string;                // the interaction's or approval's status
  title: string | null;          // interaction title; approval: the wake's approval summary rule
  aboutPlan: boolean;            // a confirmation aimed at the plan document (a plan review)
  questions?: Array<{ id: string; prompt: string; options: Array<{ id: string; label: string }> }>;
  answers?: Array<{ questionId: string; optionIds: string[]; otherText: string | null }>;
  outcome?: string | null;       // confirmations: accepted / rejected; approvals: the decision
  note?: string | null;          // confirmation reason, or approval decision note
  summary?: string | null;       // result.summaryMarkdown ?? summary, when nothing above applies
  askedBy: { type: "user" | "agent"; id: string } | null;
  decidedBy: { type: "user" | "agent"; id: string } | null;
  askedAt: string;               // ISO
  decidedAt: string | null;      // ISO; null when open
};

type PaperclipWakeTaskDocument = { key: string; title: string | null; inBrief: boolean };

// added to PaperclipWakePayload
history?: {
  lastRun: PaperclipWakeLastRun | null;
  answered: PaperclipWakeRequest[];   // most recent first, at most 8
  answeredOmitted: number;            // answered requests beyond the 8
  open: PaperclipWakeRequest[];       // oldest first
  documents: PaperclipWakeTaskDocument[];  // without the continuation summary document
} | null;
```

Every `askedBy`, `decidedBy` and `lastRun.agentId` person is added to the payload's `names` map.
The server's types are exported from `task-request-history.ts`; the adapter's normalizer keeps its
own copy in `server-utils.ts`, as the wake's fields do.

The route: `GET /issues/:id/request-history` → `{ requests: PaperclipWakeRequest[]; names:
Record<string, string> }`, all kinds and statuses (cancelled, expired, failed and superseded
included, newest first, at most 50), `names` covering the requests' people and the task's comment
authors.

---

### Task 1: The request history read and the payload field (agent: Server)

**Files:**
- Create: `server/src/services/task-request-history.ts`
- Modify: `server/src/services/heartbeat/run-preparation.ts` (`buildPaperclipWakePayload`; extend
  `readWakeNames` for the new people)
- Modify: `server/src/services/heartbeat/task-context.ts` (pass `lowTrust: exposeLowTrustRaw` into
  the payload input)
- Test: `server/src/services/task-request-history.test.ts` (new, core, under 15 s);
  `server/src/services/heartbeat/run-preparation.wake-fields.test.ts` (extend)

**Interfaces:**
- Produces:
  - `readTaskRequests(db: Db, input: { companyId: string; issueId: string; viewerAgentId: string;
    lowTrust: boolean; statuses: "history" | "all"; limit: number }): Promise<PaperclipWakeRequest[]>`
  - `readTaskLastRun(db: Db, input: { companyId: string; issueId: string; agentId: string;
    previousAssigneeAgentId: string | null }): Promise<PaperclipWakeLastRun | null>`
  - `readTaskDocuments(db: Db, input: { companyId: string; issueId: string }):
    Promise<PaperclipWakeTaskDocument[]>`
  - `history` on `context.paperclipWake`, per the contract.
- Consumes: `issueThreadInteractions`, `approvals` with `issueApprovals`, `heartbeatRuns`,
  `issueDocuments` with `documents`, `ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY`, the handoff's
  run-summary source and trust helpers (`native-session-handoff.ts`, read, don't change).

- [ ] **Step 1: Write the failing tests** in `task-request-history.test.ts` (embedded Postgres, set
  up like `run-preparation.wake-fields.test.ts`):
  - `reads an answered question with its text, labels and typed answer`: `questions[0].prompt`,
    the chosen option's label, `answers[0].otherText === "Both, please"`, `decidedBy` the user.
  - `reads a plan review as a confirmation about the plan`: `kind: "request_confirmation"`,
    `aboutPlan: true`, `outcome: "rejected"`, `note` the reason.
  - `reads a linked approval`: `kind: "approval"`, `outcome: "approved"`, `note` the decision note.
  - `leaves out tool actions, secret proposals and connection authorizations`.
  - `history statuses leave out cancelled, expired, failed and superseded; all keeps them`.
  - `a low-trust viewer gets only its own requests and no approvals`.
  - `the last run is the agent's own, not a reviewer's later run`; `falls back to the previous
    assignee's when the agent has none`, with `ownRun: false`; `skips runs with an empty summary`;
    `cuts the summary at 2,000 characters`.
  - `a lower-trust run's summary is quarantined`.
  - `documents leave out the continuation summary and mark the plan inBrief`.
- [ ] **Step 2: Extend `run-preparation.wake-fields.test.ts`:** `adds history on the assignee's own
  task` (answered, open, last run, documents, `answeredOmitted` with 10 answered); `no history on a
  chat task`; `no history when the agent isn't the assignee`; `names the history's people`;
  `redacts a registered secret in an answer and a run summary` (Review Focus 5).
- [ ] **Step 3: Run both, expect failures:**
  `cd server && corepack pnpm exec vitest run src/services/task-request-history.test.ts src/services/heartbeat/run-preparation.wake-fields.test.ts`
- [ ] **Step 4: Implement.** `previousAssigneeAgentId` is the most recent other agent with a
  finished run on the task, read in the same query; reviewer, watchdog and recovery runs don't
  count (runs whose context has an execution stage, a watchdog or a recovery owner other than the
  assignee). The payload's `lowTrust` is the run's trust preset, as `task-context.ts` computes it
  (pass it in, don't recompute).
- [ ] **Step 5: Run the two files, `run-preparation.test.ts`, and `corepack pnpm test:quick`.**
  Expected: pass.
- [ ] **Step 6: Commit** on `step5-handoff/server`: "Wake payload: the task's history (requests,
  last run, documents)".

### Task 2: Render the history (agent: Renderer)

**Files:**
- Modify: `packages/adapter-utils/src/server-utils.ts` (type and normalizer for `history`)
- Modify: `packages/adapters/claude-local/src/server/wake/render.ts`, `templates.ts`, `words.ts`
- Modify: `packages/adapters/claude-local/src/server/wake/__fixtures__/payloads.ts`
- Test: `packages/adapters/claude-local/src/server/wake/render.test.ts`

**Interfaces:**
- Consumes: the contract's `history`.
- Produces: new part ids `wake.last_run`, `wake.requests`, `wake.open_requests`,
  `wake.documents`, inside "Where things stand"; the session note for a fresh session with
  `history`.

- [ ] **Step 1: Write the failing golden tests** (fresh session unless named):
  - `the TES-45 history`: the fixture built from `e365cdbd`'s data renders the spec's sketch: "Your
    last run on TES-45 (…) ended with:" + quote; "Answered requests:" with the question line
    "Where should the switch go? → Both places"; the documents line "plan (in the brief below)";
    then the comments. No "Summary from earlier runs".
  - `another agent's last run is named`: "The agent Coder's last run on TES-45 (…) ended with:".
  - `an Other answer shows the typed text` (Review Focus 3).
  - `an unknown option id reads "(an option no longer listed)"` (Review Focus 4).
  - `an approval shows its decision and note`; `a plan review reads as a review of the plan`.
  - `open requests read "Still waiting: …"`.
  - `a workflow document says to read it`: "Read the workflow document with
    `paperclip_read_document` before choosing the next step."
  - `only an open question, no comments`: the section renders without a comments heading (Review
    Focus 2).
  - `answered requests beyond 8 are counted`: "2 more answered requests:
    `paperclip_read_task` with `requests: true` reads them."
  - `the section stays under 12,000 characters`, keeping the run summary, requests and documents,
    and cutting comments as today.
  - `a resumed session renders no history`.
  - `the session note`: a fresh session with `history` ends "What happened" with "This is a new
    session; the task's history is under "Where things stand"."
  - `the no-REST check covers the new templates` (the existing test, extended).
- [ ] **Step 2: Run, expect failures:**
  `cd packages/adapters/claude-local && corepack pnpm exec vitest run src/server/wake/render.test.ts`
- [ ] **Step 3: Implement.** Without `history` (older payloads), "Where things stand" renders as
  today, with the continuation summary.
- [ ] **Step 4: Run the file and the adapter's tests.** Expected: pass.
- [ ] **Step 5: Commit** on `step5-handoff/renderer`: "Wake: one history on fresh sessions".

### Task 3: Drop the handoff where the history replaces it (agent: Renderer)

**Files:**
- Modify: `packages/adapters/claude-local/src/server/legacy-prompt.ts` (`composeClaudeCliPrompt`)
- Modify: `server/src/services/run-prompt/build-claude-run-prompt.ts` (the
  `communication_guidance.handoff` part, around lines 140–148)
- Modify: `server/src/services/run-preview-prompt.ts` only if its marks name the handoff part
- Test: `legacy-prompt.test.ts`, `build-claude-run-prompt.test.ts`, `run-preview-prompt.test.ts`

**Interfaces:**
- Consumes: the normalized payload's `history` (Task 2).

- [ ] **Step 1: Write the failing tests:**
  - `legacy-prompt.test.ts`: `a fresh session with history sends no handoff`;
    `a chat task's fresh session keeps the handoff` (no `history`);
    `a resume that fails and retries fresh has the history and no handoff` (Review Focus 1:
    compose with `resumed: false` after the handoff field is set).
  - `build-claude-run-prompt.test.ts`: the builder's sections match `composeClaudeCliPrompt` in
    all three cases (`matchedPlan` stays true).
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.** `communication_guidance` keeps its guidance part; only the handoff part
  is left out. `handoffPresent` (the wake's session note) is false when the handoff is left out.
- [ ] **Step 4: Run the three files, the adapter's tests, and `corepack pnpm test:quick`.**
  Expected: pass.
- [ ] **Step 5: Commit** on `step5-handoff/renderer`: "CLI and builder: no handoff where the wake
  has the history".

### Task 4: `paperclip_read_task` reads requests and names (agent: Server)

**Files:**
- Modify: `server/src/routes/issues.ts` (new `GET /issues/:id/request-history`, beside
  `GET /issues/:id/interactions`)
- Modify: `server/src/mcp/catalog/tasks.ts` (`paperclip_read_task`)
- Test: `server/src/mcp/catalog/tasks.test.ts` (new, with `recordingDispatch` from
  `test-support.ts`); a route test in `task-request-history.test.ts` or beside the issues route
  tests

**Interfaces:**
- Consumes: `readTaskRequests` (Task 1) with `statuses: "all"`, `limit: 50`.
- Produces: `paperclip_read_task` input `requests: z.boolean().default(false)`; output adds
  `requests` when asked, and `authorName` on each comment (from `names`, omitted when unknown).

- [ ] **Step 1: Write the failing tests:**
  - tool: `reads requests when asked` (calls `GET /issues/:id/request-history`, returns
    `requests`); `adds authorName to comments`; `doesn't call the request history without
    requests or comments` (one call fewer when `comments: 0` and no `requests`).
  - route: `returns requests and names, records no declined read` (no row in the declined-read
    record after an agent call); `a low-trust caller gets its own requests and no approvals`;
    `another company's task is not found`.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.** The route checks access the way `GET /issues/:id/interactions` does
  (`getAccessibleResource`, `assertIssueReadAllowed`). The tool's description becomes: "Read a task
  and its latest comments (with requests: true, its questions, confirmations and approvals; with
  history: true, its activity)."
- [ ] **Step 4: Run the files, `catalog.test.ts`, `public-mcp-catalog.test.ts`, and
  `corepack pnpm test:quick`.** Expected: pass.
- [ ] **Step 5: Commit** on `step5-handoff/server`: "paperclip_read_task: requests and authors'
  names".

### Task 5: Integrate, check with a real run, record (PM)

- [ ] **Step 1:** Create `feat/step-5-handoff` from `main`, in its own worktree. Merge
  `step5-handoff/server`, then `step5-handoff/renderer`, each `--no-ff`.
- [ ] **Step 2: The local checks** (CLAUDE.md "Tests"), plus once, under the lock, the extended
  files covering the payload: `run-preparation.test.ts`, `run-preparation.review-path.test.ts`,
  `heartbeat-comment-wake-batching.test.ts`, `heartbeat-task-context.test.ts`.
- [ ] **Step 3: One real run** on the desktop dev instance from the integration worktree (approved
  2026-11-24 for these checks; "M7 test sealed runner" only, never Bob; "M7 test" tasks; never
  server1; the agent paused afterwards): a fresh session on a task with comments, an answered
  question and a plan. Check the Input tab: no handoff, "Where things stand" as the spec sketches,
  `matchedPlan` true. Check the transcript: the agent doesn't ask the answered question again.
  Compare the first message's size with `e365cdbd`'s 20,234 characters.
- [ ] **Step 4:** Merge `feat/step-5-handoff` into `main` with `--no-ff` once steps 2 and 3 pass.
- [ ] **Step 5: Record** in one docs commit: a "Built" section in `fork/step-5-handoff.md`; bug 89
  (the handoff's tool names no longer reach `claude_local` CLI runs on own tasks; chat still has
  them); step 5's progress row. Don't push until the user asks.
