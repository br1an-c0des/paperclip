# Unifying questions, decisions and approvals

Oct 16, 2026 · revised Oct 18, 2026 · @Brian Abbott

## Summary

Treat agent questions, Decisions and approvals as one concept in the interface, a **request**: something waiting on someone's response, where the response decides what happens next. Today they are three separate systems, added months apart, with different tables, audiences, lifecycles and agent guidance. The lines between them are also not where the code draws them: question cards and approvals already make server-side changes, which was the stated reason for adding Decisions.

The request model is a **view model in the fork's new UI**, not a storage change. Storage stays as it is, for three reasons: the differences between the systems mostly encode real differences in authority and lifecycle; upstream already has a shared layer over all of them (the attention feed, with its queues, triage, retention and training data); and upstream is actively building on the current split. `ui-new` builds its request view from the attention feed plus detail requests, with no server changes.

On the server, a short list of small, independent fixes is worth sending upstream, led by a review-stage bypass in the Paperclip Runner. One larger change, showing a Decision as a confirmation card on its task, is optional and needs upstream agreement first. Earlier drafts also proposed a shared `board` audience value, formal cards and one requests table; those are dropped, with reasons in [Considered and dropped](#considered-and-dropped).

Review stages stay a separate concept: they are a sign-off rule configured on a task, not a request. Each turn to sign should appear as a request, and the rule itself needs several smaller fixes, covered in [Review stages](#review-stages).

## Today

Paperclip has three main ways to wait on someone's response, and they differ on almost every axis.

|  | Question (task-thread interaction) | Decision | Approval |
| --- | --- | --- | --- |
| Added | Apr 2026 ([#4244](https://github.com/paperclipai/paperclip/pull/4244)) | Jul 2026 ([#10010](https://github.com/paperclipai/paperclip/pull/10010)) | Feb 2026 (original data model) |
| Tables | `issue_thread_interactions`, plus `tool_action_requests` and `company_secret_proposals` for cards that carry a governed action | `decisions`, `decision_bundles`, `decision_target_issues`, `decision_effect_executions` | `approvals`, `approval_comments`, `issue_approvals` |
| Kinds | `ask_user_questions`, `request_confirmation`, `request_checkbox_confirmation`, `request_item_verdicts`, `suggest_tasks`, `connection_intent` | pick one of up to 8 options, each carrying up to 10 effects, with up to 4 optional text inputs; a separate archive-proposal mode (below) | `hire_agent`, `budget_override_required`, `approve_ceo_strategy`, `request_board_approval` |
| Created by | an agent, from a run | an agent, from a run tied to a task | an agent or person; hires and budget overrides are often created by the system |
| What responding does | stores the answer and optionally wakes the assignee; some cards also act (see [Problem](#problem)) | the server applies the chosen option's effects, then optionally wakes the proposer | records the outcome and wakes the requester; for hires the server activates the agent |
| Subject | the task it is posted on | the origin task plus any tasks the effects target | links to zero or more tasks; often none (hires, budgets, strategy) |
| Who can respond | `resolverPolicy`: `anyone`, `not_creator` or `human_only`, plus an optional named agent or person; each company can set a default and a cap per kind; cards carrying a governed action are always `human_only` | people only, hard-coded | people only |
| Lifetime | until answered or withdrawn; ends early when a later user comment supersedes it (on by default for target-bound cards), when a newer card replaces it, when the task closes, or when its addressee is deleted; ask-first tool approvals expire after 60 minutes | 7-day default expiry, 30 days at most; also retired when its strict targets complete or disappear | no expiry; a revision loop (request changes, edit, resubmit) |
| Discussion | the task thread | none | its own comment thread |
| Where it appears | the task thread, the attention feed, and configured chat channels such as Slack, Discord and Telegram | the attention feed only | the Approvals pages, linked task threads, and the attention feed |
| Agent guidance | detailed, across the skill and its API reference | one table row and one section in `SKILL.md`; mentions `wake_origin_agent` but not how to read the outcome | a short section in `SKILL.md`, framed as "governed actions" |
| Paperclip Runner | built-in `request_human_input` tool | generic `call_api` only | optional `request_approval`, `decide_approval` and `comment_on_approval` tools, each gated by a claim, plus read tools |

"People only" and "board-only" mean the same thing throughout this document. In Paperclip a board actor is any signed-in person with access to the company, and the cards' legacy `board_only` value is an alias for `human_only`.

The six Decision effects are `comment_on_issue`, `update_issue_status`, `assign_issue`, `create_issue`, `resolve_blocker` and `cancel_issue_tree`. Each is checked against both the proposing agent's and the deciding person's permissions, and a `strict` effect is skipped if its target changed since the proposal. A second Decision mode, `attention_archive_proposal`, applies no effects: an agent with the `decision_triage:manage` permission proposes archiving a set of aging feed items, and a person archives or keeps them.

### Other requests

Several other things also wait on someone's response, outside these three systems:

- **Tool reviews**: an ask-first app call, answered with Approve and run, Always allow (which saves a standing rule) or Decline. Stored in `tool_action_requests`; shown as a `request_confirmation` card and in Apps → Review.
- **Secret proposals**: a card that writes a secret binding when accepted (`company_secret_proposals`).
- **Connection intents**: requests to set up a connection, answered by completing, declining or adopting one.
- **Join requests**: a person asking to join the company.
- **Recovery actions**: stuck work that needs a person to choose a way forward.
- **Runner completion reviews**: cards the Runner creates when an agent explicitly asks a named reviewer to check its work.
- **Budget incidents**: a hard budget stop, resolved by raising the limit or keeping the scope paused. The `budget_override_required` approval mirrors the incident.

### The shared layer that already exists

The attention feed (`GET /api/companies/:co/attention`) already presents all of these as one item shape, `AttentionItem`. Each item carries the subject, who is asking, why now, the response verbs, the audience for cards, the expiry, and the related task and project. Several tables build on it, all keyed by `(sourceKind, sourceId)`:

| Table | What it holds |
| --- | --- |
| `decision_queues`, `decision_queue_items` | saved queues of items |
| `decision_triage` | a decide-by date and snooze per item, settable by people or agents |
| `decision_retention` | keep, or archive when idle, for every kind, approvals included |
| `decision_training_examples` | labeled human decisions from cards, approvals and review-stage verdicts (`execution_decision`) |
| `inbox_dismissals` | per-person dismiss and snooze |

The feed also includes items that are not requests: failed runs, budget alerts and agent errors.

## Problem

The three systems are confusing because their boundaries do not follow the lines they imply. Each was added to fill a gap the previous one did not cover, rather than extending it. Decisions, for example, were added ([#10010](https://github.com/paperclipai/paperclip/pull/10010)) so that a person's approval would apply exactly the change they were shown, rather than leaving an agent to interpret an answer. That is a sound goal, but question cards and approvals already do the same thing in special cases:

| Request | What approving or accepting it does |
| --- | --- |
| `suggest_tasks` card | the server creates the accepted tasks |
| `request_confirmation` card for an ask-first app call | the server runs the stored, signed call |
| `request_confirmation` card for a secret request | the server writes the secret binding |
| `hire_agent` approval | the server activates the pending agent |
| Decision | the server applies the chosen option's effects |

`budget_override_required` is not on this list. Approving one through the approvals API only marks the approval approved; the budget stays paused and the incident open. The old UI hides Approve and Reject on these approvals and sends people to the budget controls on `/costs`, which resolve the incident and then mark the approval.

So "applies a change when approved" is already spread across all three systems. The Decision object is a general version of something cards do in special cases. The practical results:

- **The UI already merges them, inconsistently.** The Decisions page lists questions, Decisions, approvals, join requests, connection requests, recovery actions and reviews as one feed. Questions open as the task-thread card; Decisions open in a separate resolver and never appear on the task they came from or the tasks they change. Upstream removed a decision strip from task headers in [#10891](https://github.com/paperclipai/paperclip/pull/10891) as noise, so this is a deliberate choice of one place for decision work, not an oversight.
- **Agents rarely use Decisions.** The skill's routing rule ("same issue → interaction; other issues or bundles → decision") is the only guidance. It never says when to propose a change instead of making it, who can respond, or how to read the result. The Decisions sidebar link is also behind the `enableDecisions` flag, which is off by default.
- **Audiences are set in different ways.** Cards default to `anyone` (people or agents), configurable per company and per kind. Decisions and approvals are people-only, with no setting. The real open question is whether agents should ever decide Decisions, not how to name the audience.
- **Some paths to `done` skip review stages.** See [Review-stage bypass](#review-stage-bypass).
- **Some documented rules are not enforced.** The skill says a CEO's first strategic plan must be approved (`approve_ceo_strategy`) before the CEO can move tasks to `in_progress`. Nothing on the server checks this.

Approvals overlap the most with cards. Two approval types, `request_board_approval` and `approve_ceo_strategy`, have no server-side handler at all: they store a payload, record approve or reject, and wake the requester, which is what a `human_only` confirmation card does. The vocabulary is mixed too: the skill's example confirmation card (in `references/api-reference.md`) is titled "Plan approval", and the feed's detail kind for plan confirmations is `plan_approval`.

Four approval features are genuinely distinct from cards: a **discussion thread**, a **revision loop** (request changes, edit, resubmit), a **subject that need not be a task**, and **links to several tasks**. Cards always belong to exactly one task (`issue_thread_interactions.issue_id` is `NOT NULL`).

### Review-stage bypass

Review-stage logic is a pure function, `applyIssueExecutionPolicyTransition`, that each caller must run before calling `issueService.update`; the service has no review-stage logic of its own. Four callers run it: `PATCH /api/issues/:id`, `POST /api/issues/:id/comments`, `POST /api/issues/:id/recovery-actions/resolve`, and the workspace branch reconcile. Other paths write status directly:

| Path | Who acts | What happens |
| --- | --- | --- |
| Runner finalizer (`native-run-finalizer.ts`, `status-decision-committer.ts`) | the agent; no person involved | it checks only for an already-active stage, so a task with configured but unstarted stages is written straight to `done` |
| Accepting a Runner completion-review card (`issue-thread-interactions.ts`) | whoever accepts the card | the task is written straight to `done` |
| Decision `update_issue_status` effect | a person | before the worker submits, it closes the task without starting its stages (PATCH would start them); during a stage, it closes the task like a board override but leaves `executionState` pending |
| Stalled-review approve (`stalled-review-decisions.ts`) | a person | it closes a review that has no live path, like a board override, but leaves `executionState` pending |

Through PATCH, people already have an override: asking for `done` during an active stage clears the stage and closes the task. So the two person-driven paths are mostly that override with stale state left behind. The Runner paths are the real hole, because an agent can finish its own task past a reviewer someone configured. These findings come from reading the code; each needs a test to confirm.

## Proposed model: requests

A **request** is something waiting on someone's response, usually but not always attached to a task. Every request is described by the same properties.

| Property | Values |
| --- | --- |
| Response shape | yes/no · pick one · pick several · per-item verdicts · form · suggested tasks |
| Outcome | **return**: the answer goes to the agent · **apply**: the server makes the bound changes · **apply and remember**: apply, and save a standing rule for next time. Any outcome can also wake the agent. |
| Audience | anyone · not the creator · people only · a named agent or person |
| Subject | one task · several tasks · an agent · a budget incident · the company · feed items |
| Discussion | the task thread · its own thread · none |
| Revisions | answered once · revision loop (request changes, edit, resubmit) |
| Lifetime | expires · can be superseded · open until answered |

Earlier drafts had a single "formality" property bundling people-only resolution, a discussion thread, a revision loop, no expiry and permanence. In the code these vary independently: people-only is just an audience, approvals are archived from the feed like everything else, and only the thread and revision loop are unique to approvals. "Formal" stays only as a display label for approvals.

Today's objects become combinations of these properties rather than separate systems:

| Today | Shape | Outcome | Subject | Discussion, revisions |
| --- | --- | --- | --- | --- |
| `ask_user_questions` | form | return | task | task thread, once |
| `request_confirmation` (plan, scope question) | yes/no | return | task | task thread, once |
| `request_confirmation` (secret) | yes/no | apply, then return | task | task thread, once |
| Tool review | approve once · always allow · decline | apply, or apply and remember | task | task thread, once |
| `suggest_tasks` | pick several | apply, then return | task | task thread, once |
| `connection_intent` | complete · decline · adopt | apply | task | task thread, once |
| Decision | pick one, plus optional text | apply, optionally return | several tasks | none, once |
| Archive proposal (a Decision mode) | archive or keep | apply | feed items | none, once |
| `request_board_approval` | yes/no | return | zero or more tasks | own thread, revision loop |
| `approve_ceo_strategy` | yes/no | return | the company | own thread, revision loop |
| `hire_agent` | approve or reject | apply: activate the agent | agent | own thread, revision loop |
| Budget incident (mirrored by `budget_override_required`) | form: raise the limit to an amount, or keep paused | apply: change the limit and resume | budget incident | none, once |
| Join request | approve or reject | apply: add the person | the company | none, once |

The interface explains every request with one line answering "what happens if I click this?":

- *Your answer goes to Agent X, which will continue the task.*
- *Approving applies these changes now: reassign PAP-12 from Agent A to Agent B; comment on PAP-9.*
- *Approving runs this call once. Always allow also approves future calls with this scope.*
- *Approving activates Agent X; it can then be assigned work.*

The interface also keeps a decision and its result as separate facts: an approved tool call can still fail to run, and an applied Decision can succeed only partly.

**Vocabulary (fork UI only).** **Request** for the umbrella; **question** for outcome = return; **proposal** for outcome = apply; **approval** for requests stored in the approvals table. Plan confirmations stop being labelled "approvals". Upstream overloads these words: "decision" names proposals, attention queues (`decision_queues`), LLM classifiers (`decision_models`), Runner status decisions and review-stage verdicts (`issue_execution_decisions`), while "approval" and "review" both name ask-first tool gates. The fork renames things in its own UI and does not try to change upstream's names.

### Where the model lives

The model is a **view model in `ui-new`**, built from:

- the attention feed, for the subject, asker, audience, expiry, queues and triage;
- detail requests where needed: `GET /api/decisions/:id` for effects and results, the task's interactions for card payloads, and `GET /api/approvals/:id` with its comments and linked tasks;
- derived fields: the outcome, the "what happens next" line, and the formal label.

No server change is needed. `attention.ts` is an upstream file that changes often, so the fork does not change the feed's shape. If the extra detail requests become slow, a fork-only endpoint that bundles them is the next step; that is still a read-side change.

Storage stays as it is. Merging it would mean re-keying every table in the shared layer, changing the Runner's governance checks and the chat-channel publishing (both query cards and approvals directly), and letting cards exist without a task. Upstream's own feature map (`maps/feature-map/questions-and-approvals.md`) says these requests "can look similar but have different authority and continuation rules", and upstream keeps building on the split: queues in [#10651](https://github.com/paperclipai/paperclip/pull/10651), retention in [#10672](https://github.com/paperclipai/paperclip/pull/10672), retiring Decisions with completed targets in [#10892](https://github.com/paperclipai/paperclip/pull/10892).

## In the fork's new UI (no server changes)

The fork's SolidJS board (`ui-new`) can present the request model now, using the existing API. `GET /api/companies/:co/attention`, `GET /api/companies/:co/decisions`, `GET /api/decisions/:id`, `GET /api/issues/:id/interactions` and the approval endpoints already return what it needs.

1. **One card design for every request.** Group feed items as question, proposal, approval or review. Every card shows who is asking, about what, why, the response controls, and the "what happens next" line. Cards that run a tool call or write a secret look distinct, show the scope being approved, and show the execution result separately from the decision.
2. **Approvals as formal requests.** Show "formal" as a badge. Formal requests open a detail view with the discussion thread and revision history. The Approvals pages become a "formal" filter on the requests page rather than a separate area. Budget overrides open the budget resolution (raise the limit to an amount, or keep paused) instead of Approve and Reject; hires show the agent being activated.
3. **Proposals on task pages, in the thread.** Show a waiting proposal in the thread or properties panel of its origin task and of every task it changes, not as a header strip (the strip upstream removed in [#10891](https://github.com/paperclipai/paperclip/pull/10891)). Find proposals that target a task with `GET /api/companies/:co/decisions?targetIssueId=` (people only, at most 100 results). The list has no origin filter, so find a task's own proposals through the feed's Decision items, which carry `originIssueId`. Linked approvals already appear in task threads.
4. **A preview of each change.** Port the old `DecisionCard`, which already summarizes each effect and warns when a target changed. Add current versus proposed values: current from the task, proposed from the effect. Stale-target flags (`targetChanged`) come from the list endpoint, not from `GET /api/decisions/:id`.
5. **Rename the page** from "Decisions" to something like "Needs you". The old page is `WhatNeedsMe` at `/decisions`; rename the queue and triage labels to match.
6. **Live updates.** Today the feed refreshes only on window focus or after your own actions. Activity is already published over the live-events socket as `activity.logged` events; the new UI refreshes the feed on `decision.*`, `approval.*` and `issue.thread_interaction_*` actions, and on task status changes.
7. **Queues, triage and archiving.** Port saved queues, decide-by and snooze, keep, and the aging shelf (capability `decisions/queues`), or drop them on purpose in `capabilities.md`.
8. **Audience settings.** Expose each company's per-kind default and cap for card audiences in company settings.

## Upstream changes

Each is a small, focused pull request that stands on its own, which is the easiest kind for upstream to accept. None is carried as a fork patch: they touch files upstream changes often (`issue-thread-interactions.ts` had 43 commits between Aug 1 and mid-October), and `CONTRIBUTING.md` warns that "uncoordinated feature PRs against the core product may be closed".

| # | Change | Kind | Size |
| --- | --- | --- | --- |
| 1 | Close the review-stage bypass, starting with the Runner | bug fix | medium |
| 2 | Rewrite the skill's guidance on asking for input | documentation | small |
| 3 | Stop the approvals API resolving budget overrides | bug fix | small |
| 4 | Mark stage handoffs in activity entries | server | small |
| 5 | Log participant changes for every stage | bug fix | small |
| 6 | Optional: show a Decision as a confirmation card on its task | server, shared types | medium |

1. **Close the review-stage bypass.** Write the tests first: a Runner agent finishing a task with configured but unstarted stages, and someone accepting a Runner completion-review card on such a task. The cheapest fix is a guard in `issueService.update` that refuses `done` while the task has unfinished stages, unless the same update completes or clears the stage state, as the transition's board override does. The service already has a similar guard: it refuses an agent's `done` while a tool review is pending. With the guard, every path fails closed, and callers can then be changed to run the transition one at a time. Extracting one shared "apply a task change" path is larger than it looks: stage wakeups, stage-decision records and reviewer activity live in `server/src/routes/issues.ts`, which is about 19,600 lines.
2. **Skill guidance.** Replace the scattered guidance with one decision tree: *Do you need information, or a change applied exactly as approved?* *Who should respond?* *Does it need formal sign-off* (spending, hiring, strategy, public commitments)? Document what is missing today: who can decide a Decision, what status to leave the task in, the `decided`, `expired` and `cancelled` outcomes of the `wake_origin_agent` wake, how to read the outcome and effect results, and what `strict` means. Either enforce the CEO-strategy gate on the server or remove the claim from the skill.
3. **Budget overrides in the approvals API.** `POST /api/approvals/:id/approve` and `/reject` on a `budget_override_required` approval should refuse, or resolve the incident the same way the budget controls do. Today they mark the approval and leave the scope paused.
4. **Stage handoff marker.** The PATCH route already knows when an assignment comes from a stage (`transition.workflowControlledAssignment`). Record that on the activity entry, for example as `assignmentReason: "execution_stage"`, so interfaces need not infer handoffs.
5. **Participant logging for every stage.** `issue.reviewers_updated` and `issue.approvers_updated` only look at the first stage of each type (`summarizeExecutionParticipants` uses `stages.find`), so changes to later stages go unlogged. This is needed before more than one stage of a type is supported.
6. **Optional: a Decision as a card on its task.** Post a confirmation card on the origin task that points to a Decision. It would follow the pattern of cards that carry a tool call or a secret: always people-only, never offered as quick-reply buttons in chat channels, and executed by the existing Decision executor (signing, snapshots, permission checks, per-effect idempotency). Most single-task Decisions would then appear in the thread with a card's lifecycle, without merging the systems. Start with yes/no only; effects per checkbox option or per verdict bring partial application and repeated submissions. This is a feature change, so it should be discussed in upstream's Discord `#dev` channel before any code is written.

### Considered and dropped

- **A `board` audience value for Decisions, with proposals defaulting to `human_only`.** `board` already means `human_only` (the legacy `board_only` alias), and Decisions are already people-only. The real question, whether agents may decide Decisions, is an authority change: effects run with the decider's permissions, and a deciding agent has no person's permissions to check against. If a narrower change is needed, letting a Decision name a specific person (`addresseeUserId`, as cards do) is useful.
- **Formal cards, with `request_board_approval` and `approve_ceo_strategy` moved into them.** Cards must belong to exactly one task. Strategy approvals have no task, and board approvals link zero or more tasks and can be created by people, so this cannot happen unless cards lose their task requirement. It would also copy approvals' thread and revision loop rather than retire anything.
- **One requests table.** It would re-key every table in the shared layer, change the Runner's checks and chat-channel publishing, and land in upstream's busiest area against its current direction. The fork UI's view model gives the unified presentation without it. Raise it upstream only if upstream starts moving that way, or if the fork needs something that truly needs shared storage, such as discussion threads on Decisions.

`hire_agent` and `budget_override_required` keep their own storage. They are tied to the agent lifecycle (`pending_approval`) and to budget incidents, are often created with no task or run behind them, and are the audit trail for the two most consequential governance actions.

## Review stages

Review stages remain their own concept. A request is a single ask, created when someone needs a response. A review stage is a **sign-off rule configured on a task in advance**: "before this task counts as finished, Sam checks it, then Alex approves it." The rule produces requests (each turn to sign is effectively "approve, or send back?"), but the ordering, the hand-back to the worker, the round limit and escalation belong to the task.

### How stages work today

- **Storage.** The rule is `executionPolicy.stages[]` and its progress is `executionState`, both JSON columns on the task. Stage verdicts are logged in `issue_execution_decisions`. Each stage needs one approval; its participants are alternatives, not a sequence.
- **Trigger.** A stage starts when the worker moves the task to `in_review` or `done`. Requesting `done` with an unfinished stage starts the stage instead of closing the task.
- **Handoff.** The task is reassigned to each participant in turn. The worker is stored as `returnAssignee` and gets the task back when changes are requested or the last stage approves. After the round limit (3 by default) of agent-requested changes, the stage escalates to the task's responsible person or creator.
- **Board override.** A person can close or reassign a task mid-stage through PATCH; this clears the stage.
- **Who can change stages.** Any actor allowed to modify the task can add or remove participants, by sending the whole policy. An agent can add a reviewer to its own task and submit in one request (route test at `server/src/__tests__/issue-execution-policy-routes.test.ts:641`). No participant-level check prevents a worker agent from removing a reviewer a person added, before it submits.
- **What is recorded.** The task stores its creator (`createdByAgentId` or `createdByUserId`) and `responsibleUserId`. Reviewer and approver changes are logged as `issue.reviewers_updated` and `issue.approvers_updated`, with the actor and the participants added or removed, but only for the first stage of each type. Assignee changes are logged in `issue.updated`, whose details include the new `executionState`. There is no separate assignee-history table, and a stage handoff is not labelled as such: it can only be inferred from that state.
- **Old UI.** It allows one review stage followed by one approval stage, although the API accepts any number in any order. The properties panel shows "Review pending with Sam" but not who the task returns to.
- **`review` and `approval` behave the same**, apart from their label, the wake reason, and one auto-skip rule for review stages.
- **Related settings.** A separate issue-level `reviewPolicy` (`anyone`, `not_creator` or `human_only`) governs who may give a verdict on a review card. Tasks returned by the API carry `reviewAttention`, which lists what an `in_review` task is waiting on (a stage participant, a card, an approval, a monitor, a run), with labels and responders.

### Changes

1. **Each turn to sign appears as a request.** Whoever's turn it is, person or agent, sees the same card as every other request: "Your sign-off is needed on PAP-12: approve or send back." For people, the feed's `review` items already provide this. For agents, the turn stays in `executionState` and is presented as a request rather than stored as a second record. A second copy would drift from the stage state, which the transition code already works hard to repair.
2. **No back doors.** Every route to "finished" respects the sign-off rule. This is upstream change 1.
3. **Conditional removal of reviewers.** Anyone allowed to modify the task can add a reviewer. Removing one is limited:
    - a person, including the task's responsible person, can remove any participant;
    - an agent can remove a participant that an agent added, if it added that participant itself or created the task;
    - no agent can remove a participant a person added.

   To enforce this:
    - Each participant records who added it (`addedByAgentId` / `addedByUserId`). The server stamps this from its own diff of the old and new policy and never takes it from the client.
    - `normalizeIssueExecutionPolicy` rebuilds participants field by field, so the shared schema and the normalizer must both carry the new fields.
    - For participants added before the field exists, use the latest `issue.reviewers_updated` or `issue.approvers_updated` entry whose `addedParticipants` includes that participant. Until upstream change 5 lands, this works only for the first stage of each type.
    - The rule must also cover removing a whole stage, changing a stage's type, and clearing the policy.
4. **Keep the reassignment, and make it visible.** Reviewers keep receiving the task, which puts the work in their queue. What changes is how clearly it reads:
    - The task shows "With Sam for review · returns to Agent A", using the stored `returnAssignee`.
    - The activity history labels stage handoffs ("handed to Sam for review", "returned to Agent A with changes requested") instead of showing a plain reassignment.
    - Task lists can tell "reviewing" apart from "working on" for the same assignee.

   The fork's UI infers handoffs from the `executionState` recorded in each `issue.updated` entry. Upstream change 4 removes the need to infer.
5. **One kind of review.** Paperclip has many things called review: stages, review cards (governed by the issue-level `reviewPolicy`), the Runner's completion reviews, review child tasks, stalled reviews, the `in_review` status, ask-first tool reviews, plan review, artifact review documents and pull-request reviews. The fork UI presents two: **planned sign-offs** (stages) and **one-off review requests** (a card asked for on the spot). It labels tool, plan and pull-request reviews by what they are. Keep review child tasks only for reviews big enough to be their own piece of work, and make the skill consistent about them. The `in_review` status currently means "waiting on anything"; the interface shows what it is waiting on, from `reviewAttention`, rather than renaming the status upstream.
6. **Flexible review steps, with approval as the final step.** Allow any number of review steps, in any order. Give approval a concrete meaning: **at most one approval stage, always the last**. Its participant can be an agent or a person. The fork's UI enforces this in its editor. Upstream validation must run only when a policy changes, not inside `normalizeIssueExecutionPolicy`: PATCH normalizes the stored policy on every update, so existing tasks with other stage orders would stop accepting updates. More than one review stage also needs upstream change 5.
7. **Guidance and tools for agents.** The skill says how to add a reviewer but not when. Add guidance on when a task should get one (code changes, anything customer-facing). The Runner has `request_review`, which submits the agent's own task for review, but no tool to add a reviewer. When a Runner agent that is the current stage participant reports `finish_task`, the finalizer appears to treat the pending stage as a gate and keep the task in review, so there is no tool to sign off either. Add both.
8. **Default reviewers.** There is no way to say "every task in this project is reviewed by Sam". Add default reviewers and approvers per project or company, applied when a task is created.

### Where each change happens

| Change | Fork UI alone | Needs upstream |
| --- | --- | --- |
| 1. Turns to sign as requests | for people, from the feed's `review` items; for agents, presented from `executionState` | no |
| 2. No back doors | | yes (upstream change 1) |
| 3. Conditional removal | can hide the remove control | yes, to enforce it |
| 4. Visible handoffs | yes, inferred from `executionState` | optional marker (upstream change 4) |
| 5. One kind of review | labels, and what `in_review` waits on | merging the variants; skill consistency |
| 6. Approval as final step | in the editor | validation when a policy changes; logging for every stage (upstream change 5) |
| 7. Agent guidance and tools | | yes |
| 8. Default reviewers | pre-fill the new-task form | a real project or company setting |

## Out of scope and open questions

Out of scope:

- **Merging storage.** Questions, Decisions and approvals keep their tables; see [Where the model lives](#where-the-model-lives) and [Considered and dropped](#considered-and-dropped).
- **Merging review stages into requests.** Stages stay a rule on the task; see [Review stages](#review-stages).

Answered by reading the code:

- [x] Is a housekeeping ("gardener") agent the intended main producer of Decisions? It is a role the code supports, not a bundled agent. An agent with `decision_triage:manage` creates archive proposals (`POST /api/companies/:co/decision-archive-proposals`), sets triage, and reads the stats endpoint, which the route documents as the "Gardener telemetry contract".
- [x] Does approving a `budget_override_required` approval from the Approvals page lift the budget pause? No. The approvals API only marks the approval; the old UI hides the buttons and points to the budget controls on `/costs`. See upstream change 3.
- [x] Should `anyone` remain the default audience for questions? It is already configurable per company and per kind, with a cap. The fork UI exposes that setting (UI item 8) rather than changing the default.
- [x] Which routes may create formal requests? Any agent with approval access can create `request_board_approval` and `approve_ceo_strategy`, through `POST /api/companies/:co/approvals` or the Runner's `request_approval`; people can create them too. Hires and budget overrides are created by their own flows.

Open:

- [ ] Does the review-stage bypass reproduce in a test, for each path in [Review-stage bypass](#review-stage-bypass)?
- [ ] Can a worker agent remove a person-added reviewer before submitting? No participant-level check was found; confirm with a test.
- [ ] Should the effect catalog grow (priority, labels, adding a reviewer), or stay at six to keep proposals easy to audit? Upstream's roadmap plans for agents to propose structural changes, so upstream may grow it; the fork should not add effects on its own.
- [ ] Should an agent that created a task be able to remove a reviewer a person added later? Change 3 proposes no.
- [ ] Should approval stages be limited to people in some companies, as a setting? The issue-level `reviewPolicy` already offers `human_only` for review cards and could serve as the model.
- [ ] Should the CEO-strategy gate be enforced on the server, or removed from the skill?
