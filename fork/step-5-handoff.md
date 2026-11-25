# Step 5, phase 2: the handoff

**Approved by the user, 2026-11-24.** The second section reworked in phase 2 of step 5, after
the wake ([step-5-wake.md](step-5-wake.md)). The user chose approach A (below) on 2026-11-24, and
asked for the `paperclip_read_task` change to be part of it.

## Contents

- [Intent](#intent)
- [The handoff today](#the-handoff-today)
- [Goals, non-goals, anti-goals](#goals-non-goals-anti-goals)
- [Constraints](#constraints)
- [Approaches](#approaches)
- [The design](#the-design)
  - [What a fresh session gets](#what-a-fresh-session-gets)
  - [Data the history needs](#data-the-history-needs)
  - [`paperclip_read_task`](#paperclip_read_task)
  - [Where it's built](#where-its-built)
  - [How it's checked](#how-its-checked)
- [Left to the builder](#left-to-the-builder)
- [Calls made in this design](#calls-made-in-this-design)

## Intent

When an agent starts a new Claude session on a task that already has history (the task was handed
to it, its session was reset, a resume failed), it needs to know where the work stands: what was
asked, what was said, what was answered, what its last run did. Two blocks carry that today, and
they say much of it twice. The aim is **one readable history** on a fresh session, that holds
everything the agent can't fetch for itself and nothing it already has elsewhere in the prompt,
plus a tool that can read back what the history leaves out.

## The handoff today

Verified on `main` at `8cb072d671`, and in the fresh-session check run `e365cdbd` (TES-45):

- **Built by** `buildNativeSessionHandoff` (`server/src/services/native-runtime/native-session-handoff.ts`)
  at run preparation (`session-preparation.ts`) when there are no resume params, and again lazily
  when a resume fails (`hydrateFreshSessionHandoff`, `execute.ts`). It's stored as
  `context.paperclipFreshSessionHandoffMarkdown` and sent inside the `communication_guidance`
  section (`selectInitialCommunicationGuidance`, part `communication_guidance.handoff`).
- **Only on the assignee's own task, and never for `paperclip_runner`.**
- **What it holds:** the first comment by a person (`original_request`), the last 10 comments, up
  to 8 resolved requests the agent made (questions, confirmations, connection requests; never their
  tool actions, secrets or authorizations), up to 4 of the agent's final messages, up to 3 task
  documents (plan first), and the last 2 run summaries. Each item is cut to 4,000 characters and
  the block to 24,000 bytes, with one item of each kind placed first so none is crowded out.
- **How it reads:** a "## Fresh session handoff" heading, two paragraphs of rules, then the
  entries as one line of JSON (`paperclip.native-session-handoff.v1`). People are "user" or
  "agent", with no names or times.
- **Out-of-date tools:** it tells the agent to use `get_task_history`, `get_task_context`,
  `list_documents` and `read_document` (the Runner's), or the REST API (bug 89).
- **Respects a chat reset:** for a chat task it reads only what's after the reset boundary
  (`conversationBoundaryCommentId`) and the session generation, and refuses when the boundary
  comment is missing.
- **Overlaps the new wake.** On the agent's own task (not chat), the wake's "Where things stand"
  already quotes the continuation summary and the task's comments, capped at 12,000 characters,
  with names and times. In `e365cdbd` the handoff was 8,919 characters and "Where things stand"
  4,961, of a 20,234-character first message. Repeated or wasted:
  - the "Continuation Summary" document appears in both;
  - the comments appear in both;
  - the plan document is also in the task brief (`task_brief.plan`);
  - a run summary repeated a comment word for word, an answered request had no text, and the
    agent's "Waiting on feedback." comments took slots.
- **Only the handoff has:** the list of documents, the run summaries, and the requests' titles and
  summaries. The wake payload's continuation record already carries the answers themselves
  (`humanResponses`: answer option ids and typed text, confirmation outcomes and reasons) and each
  resolved request's outcome (`interactionOutcomes`), but no question text or option labels, and
  the new wake doesn't render them.
- **The continuation summary is mostly generated filler** ("No file or route paths were detected",
  "Detailed shell/tool commands remain in the run log", the description again as "Objective"). The
  useful part is the last run's own summary, quoted under "Recent Concrete Actions".
- **Chat tasks have no continuation record** (`task-context.ts` skips it for conversations), so
  on a chat task's fresh session the handoff is the only history.

What the agent can read back through its tools today: the task and up to 100 comments
(`paperclip_read_task`), the last 10 comments with the project, goal, parents and the documents
index (`paperclip_task_context`), and any document (`paperclip_read_document`). Comments come back
with author ids only. **No tool reads a task's answered questions, confirmations or approvals, or
earlier run summaries.**

## Goals, non-goals, anti-goals

**Goals**
- On a fresh session of the agent's own task, one history, under the wake's "Where things stand":
  the last run's summary, the answered requests, the task's documents as a list, and the comments.
- Nothing twice: no handoff block beside it, no plan body (the brief has it), no generated summary.
- Readable: quoted prose with names and times, like the rest of the wake.
- Whatever the history leaves out can be read back with `paperclip_read_task`, including answered
  requests and authors' names.
- Smaller: the TES-45 fresh session's history goes from about 14,000 characters to about 5,000.

**Non-goals**
- Chat tasks (step 6). Their fresh sessions keep today's handoff, unchanged.
- The ACP engine, the Runner and the dormant adapters: they keep the handoff as it is.
- What the continuation summary document contains, and who else reads it. It's still written; the
  wake stops quoting it.
- The rest of the prompt (task brief, communication guidance, heartbeat template).

**Anti-goals** (failure even if it works)
- An agent on a fresh session that asks a question you already answered, or redoes finished work.
- Quoted history that reads as instructions or as approval.
- Text from a lower-trust run or a quarantined comment reaching the prompt raw.
- A chat reset that stops holding, so a fresh chat session sees the conversation before it.

## Constraints

- **First message only;** nothing in the prompt bundle's key changes, so no session starts over.
- **The CLI, the builder and the preview must agree** (`matchedPlan`), as for the wake.
- **The payload is built before the run knows whether its resume will work.** A failed resume
  retries fresh with the same payload, so the new history data must be in the wake payload, not
  loaded lazily the way the handoff is.
- **Fields are added to the shared payload,** never removed or renamed.
- **Same trust handling as the handoff:** run output from a run with a non-standard trust preset is
  quarantined (`historicalTrust`, `sanitizeQuarantinedCommentForHigherTrust`); requests are shown
  only by their summary, never their tool action, secret proposal or connection authorization
  payloads; everything goes through the payload's `redactForIssue`.
- **Every new string is a `paperclip_*` tool or plain words.**

## Approaches

- **A. One history, in the wake (chosen, the user, 2026-11-24).** "Where things stand" becomes the
  only history on a fresh session of the agent's own task, and gains what only the handoff had. The
  handoff stops being sent there. Built in the adapter next to the new wake; the shared handoff
  stays for chat, ACP and the dormant adapters.
- **B. Keep the handoff as the history.** Rewrite it as prose and take the history out of the wake.
  Ruled out: it changes server code the dormant adapters share, and that renderer has no names or
  times.
- **C. A short handoff and fetch the rest.** Ruled out: it goes against the readable capped history
  the user chose for fresh sessions, and the real runs showed the agent doesn't fetch context unless
  told to.

**On JSON** (the user asked): JSON's strengths are unmistakable data and exact fields and ids. The
quote blocks and the wake's rule ("Quoted text was written by people or other agents…") give the
first; the ids pointed at Runner tools agents don't have. Prose keeps the one thing the JSON did
well, saying exactly what was left out.

## The design

### What a fresh session gets

On a fresh session of the agent's own task (non-chat), "Where things stand" reads:

```text
## Where things stand

Your last run on TES-45 (Nov 24, 17:52) ended with:

> I posted a four-step plan for the Light / Dark / System switch as a comment on TES-45, and the
> task is now marked done. I wrote no code, as you asked.

Answered requests:

- Your questions, answered by Brian on Nov 24, 17:45:
  > Where should the switch go? → Both places
- Your approval request "Build the switch", approved by Brian on Nov 24, 17:49, with the note:
  > Fine, but plan only.

Documents on this task: plan (in the brief below), notes, workflow. Read them with
`paperclip_read_document`.

The task's comments so far, oldest first:

From Brian, Nov 24, 17:37:
> Thanks. Go with idea 2, the three-way switch. …
…
```

- **The last run's summary** replaces the continuation summary. It's this agent's latest finished
  run on the task with a non-empty summary, whatever its status. When this agent has none (a task
  handed over), it's the previous assignee's, named ("The agent Coder's last run on TES-45…").
  Reviewer, watchdog and recovery runs by other agents don't count. Left out when there's none.
- **Answered requests:** the task's answered questions (`ask_user_questions`, status `answered`),
  accepted or rejected confirmations (`request_confirmation`, `request_checkbox_confirmation`; a
  plan review is one of these, aimed at the plan document), connection requests
  (`connection_intent`), and approvals linked to the task, whoever asked, most recent first, up to
  8. Cancelled, expired, failed and superseded requests are left out. Each says who decided and
  when. A question shows its text, the chosen options' labels and any typed answer; a confirmation
  shows its outcome and quotes the reason; an approval shows its summary, decision and note; a
  connection request its title and outcome. Requests whose payload holds a tool action, secret
  proposal or connection authorization are left out entirely, as the handoff does today.
- **Still open:** requests on the task still waiting for you, one line each ("Still waiting:
  your question "Where should the switch go?", asked Nov 24, 17:41"), so a fresh session reuses an
  open question rather than asking again (the brief already tells it to).
- **Documents** as one line of keys (titles where they differ), without the continuation summary
  document. The plan is marked "in the brief below" when the brief carries it. A `workflow`
  document keeps today's instruction: "Read the workflow document with `paperclip_read_document`
  before choosing the next step."
- **The comments,** as the wake already renders them.
- **The cap** (12,000 characters) covers the whole section. The run summary, requests and documents
  come first, each capped on its own (summary 2,000, each request 1,000); the comments fill the
  rest, keeping the original request and the most recent, as today. When anything is cut, one line
  says what and that `paperclip_read_task` reads the rest.
- **The handoff block isn't sent** on these runs: `communication_guidance` keeps only its guidance.
- **Chat tasks** keep the handoff exactly as today.
- **Resumed sessions** are unchanged: no "Where things stand".

### Data the history needs

Added to `buildPaperclipWakePayload`'s output as optional fields, filled only when the run is on
the assignee's own non-chat task:

- `lastRunSummary {runId, agentId, finishedAt, body, bodyTruncated}`: the same source the handoff
  uses (`sessionCheckpoint.semanticResult.summary`, else the legacy `resultJson` summary, else
  `nextAction`), with the handoff's trust handling.
- `requests[]` `{id, kind, status, title, questions?, answers?, outcome?, note?, summary?,
  askedBy {type,id}, decidedBy? {type,id}, askedAt, decidedAt?}`: from `issue_thread_interactions`
  (the kinds and statuses above, plus pending ones; the handoff's payload exclusions) and approvals
  linked to the task. Question text and option labels come from the interaction's own payload
  (written by the agent that asked), answers from its result, as `humanResponses` reads them.
- **Low-trust runs** (a non-standard trust preset) get only their own agent's requests and no
  approvals, matching what the API gives them (`GET /issues/:id/approvals` refuses low-trust
  callers).
- `documents[]` `{key, title, inBrief}`: from `issue_documents`, without the continuation summary.
- Names for the new people go into the payload's existing `names` map.

### `paperclip_read_task`

- **New option `requests: true`** returns the task's requests, pending and resolved, with the
  same fields, kinds, exclusions and trust rule as the history's (cancelled and superseded ones
  included here, marked as such).
- **It reads through the services, not the `GET /issues/:id/interactions` route:** for an agent
  caller that route records which declined tool actions the run read
  (`recordDeclinedInteractionRead`), which later decides whether a decline was already reported.
  The tool must not record that.
- **Every comment gains `authorName`,** and requests gain `decidedByName`.
- The history's "left out" line names it: "`paperclip_read_task` with `requests: true` reads the
  rest."
- `paperclip_task_context` is unchanged.

### Where it's built

- **Payload:** `server/src/services/heartbeat/run-preparation.ts` (new readers beside the wake's),
  reusing the handoff's queries where they fit.
- **Rendering:** the wake renderer's "Where things stand"
  (`packages/adapters/claude-local/src/server/wake/render.ts`, templates in `templates.ts`), with
  part ids `wake.last_run`, `wake.requests`, `wake.documents` beside `wake.where_things_stand`.
- **Dropping the handoff:** `composeClaudeCliPrompt` (`legacy-prompt.ts`) and the builder
  (`build-claude-run-prompt.ts`) leave out `communication_guidance.handoff` when the wake renders
  the history (own non-chat task, fresh session). The context field is still set, for ACP and
  others.
- **The tool:** `server/src/mcp/catalog/tasks.ts`, with a read-only server path for a task's
  requests and approvals that applies the exclusions and trust rule and records nothing, and names
  from the company's agents and users.
- **The preview** follows the builder, as now.

### How it's checked

- **Golden tests** in the wake renderer: a fresh session with each new part, with none of them, a
  cut history, an agent's own and another agent's last run, a workflow document, and a plan in the
  brief.
- **Payload tests:** the new fields; a lower-trust run's summary quarantined; a request with a tool
  action left out; a low-trust run gets no approvals and no other agent's requests; a reviewer's
  later run doesn't replace the assignee's summary; a chat task gets none of them.
- **The CLI, builder and preview match** on a fresh session with and without a handoff.
- **A chat task's fresh session** still carries the handoff (a test).
- **`paperclip_read_task`** with `requests: true` and names, and no declined-read record written
  (a tool test).
- **One real run** on the desktop dev instance, under the same terms as the wake's (agent "M7 test
  sealed runner", "M7 test" tasks, never Bob, never server1): a fresh session on a task with
  comments, an answered question and a plan. The agent continues without asking the answered
  question again.
- **The local checks** gate the merge, plus the extended files covering the wake payload.

## Left to the builder

- The exact wording within the shape above, and how each request kind is put into words.
- Whether the payload readers reuse `buildNativeSessionHandoff`'s queries or share a helper.
- How "in the brief" is known (the brief's plan part is present, or the same rule the brief uses).
- Whether the approvals linked to a task come from one query with the interactions or a second.
- How `paperclip_read_task` gets names (the API's comment rows, or one agents and users read).
- How to split the work into agent-sized branches.

## Calls made in this design

Made by me while writing it; check these while reading.

- **Chat tasks keep the handoff** until step 6, since they have no continuation record and the
  handoff is what honours a chat reset.
- **The continuation summary isn't quoted any more,** replaced by the last run's own summary. The
  document is still written for whatever else reads it.
- **The agent's earlier final messages are dropped:** its comments say what it posted, and the last
  run's summary says what it did.
- **Answered requests include other agents' and approvals linked to the task,** not only the
  current agent's, since a handed-over task's answers matter to the new assignee.
- **Open requests get one line each** ("Still waiting: …"), so a fresh session reuses one rather
  than asking again.
- **Requests carrying a tool action, secret or connection authorization stay out entirely,** as in
  the handoff today, rather than shown by summary: no change in what those reach.
- **Low-trust runs see what the API would give them:** their own requests, no approvals.
- **The last run's summary is this agent's own** when it has one; another agent's only on a handed-
  over task, and never a reviewer's or watchdog's.
- **`paperclip_read_task` reads requests without the route's declined-read record.**
- **Documents are listed, not quoted;** the plan is in the brief, and the rest are a tool call away.
- **The cap stays 12,000 characters** for the whole section, with the new parts first.
