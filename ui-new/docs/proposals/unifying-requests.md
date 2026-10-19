# Unifying questions, decisions and approvals

Oct 16, 2026 · revised Oct 19, 2026 · @Brian Abbott

## Summary

Treat agent questions, Decisions and approvals as one concept in the interface, a **request**: something waiting on someone's response, where the response decides what happens next. Today they are three separate systems, added months apart, with different tables, audiences, lifecycles and agent guidance, and their boundaries don't follow the lines they imply.

The request model lives entirely in the fork's new UI (`ui-new`). It is built from upstream's attention feed, which already presents every kind of request as one item shape, plus detail requests to the existing API. The fork makes no server, database or package changes for it.

Earlier drafts also proposed server changes, among them closing a review-stage bypass, rules for removing reviewers, default reviewers, and showing a Decision as a card on its task. As of this revision the fork is UI-only (see [Scope](#scope-ui-only)), and those ideas are sorted into three lists:

- [In the new UI](#in-the-new-ui): what `ui-new` builds on the existing API.
- [Left to upstream](#left-to-upstream): server changes the fork neither makes nor proposes.
- [Small upstream contributions](#small-upstream-contributions): four small pull requests and one bug report worth sending upstream.

Review stages stay a separate concept: a sign-off rule configured on a task, not a request. The new UI shows each turn to sign as a request and makes handoffs visible, but doesn't change how stages work.

## Scope: UI only

Upstream lands many commits a day, and the server code these ideas touch is among its busiest. In the 30 days to Oct 19, `server/src/routes/issues.ts` (about 19,600 lines) had 38 commits, `server/src/services/issues.ts` 32, the Runner finalizer 19 and `issue-thread-interactions.ts` 17.

Review stages in particular are under active development. Upstream already has open work on two of the earlier server changes: [#16431](https://github.com/paperclipai/paperclip/pull/16431) stops agents from editing a policy that includes a person participant (the earlier rules for removing reviewers), and [#15267](https://github.com/paperclipai/paperclip/pull/15267) adds company and project default policies (the earlier default reviewers). More open pull requests ([#16416](https://github.com/paperclipai/paperclip/pull/16416), [#15159](https://github.com/paperclipai/paperclip/pull/15159), [#15321](https://github.com/paperclipai/paperclip/pull/15321)) and issues ([#12325](https://github.com/paperclipai/paperclip/issues/12325), [#12883](https://github.com/paperclipai/paperclip/issues/12883), [#13001](https://github.com/paperclipai/paperclip/issues/13001), [#13744](https://github.com/paperclipai/paperclip/issues/13744), [#15240](https://github.com/paperclipai/paperclip/issues/15240)) change the same area.

So the fork builds the request model in its UI, watches that work land, and sends upstream only small fixes that stand on their own. The fork's general policy is in [FORK.md](../../../FORK.md).

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
| Agent guidance | detailed, across the skill and its API reference | a table row and a section in `SKILL.md` covering options, effects, expiry and `wake_origin_agent`; nothing on reading the outcome or what `strict` means | a short section in `SKILL.md`, framed as "governed actions" |
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

The feed also includes items that are not requests: failed runs, budget alerts, agent errors and blocked tasks (`blocker_attention`).

### Review stages

A review stage is a **sign-off rule configured on a task in advance**: "before this task counts as finished, Sam checks it, then Alex approves it." Each turn to sign is effectively a request ("approve, or send back?"), but the ordering, the hand-back to the worker, the round limit and escalation belong to the task.

- **Storage.** The rule is `executionPolicy.stages[]` and its progress is `executionState`, both JSON columns on the task. Stage verdicts are logged in `issue_execution_decisions`. Each stage needs one approval; its participants are alternatives, not a sequence.
- **Trigger.** A stage starts when the worker moves the task to `in_review` or `done`. Requesting `done` with an unfinished stage starts the stage instead of closing the task.
- **Handoff.** The task is reassigned to each participant in turn. The worker is stored as `returnAssignee` and gets the task back when changes are requested or the last stage approves. After the round limit (3 by default) of agent-requested changes, the stage escalates to the task's responsible person or creator.
- **Board override.** A person can close or reassign a task mid-stage through PATCH; this clears the stage.
- **Who can change stages.** Any actor allowed to modify the task can add or remove participants, by sending the whole policy, so a worker agent can remove a reviewer a person added. Upstream [#16431](https://github.com/paperclipai/paperclip/pull/16431) would stop that.
- **What is recorded.** The task stores its creator and `responsibleUserId`. Reviewer and approver changes are logged as `issue.reviewers_updated` and `issue.approvers_updated`, but only for the first stage of each type. Assignee changes are logged in `issue.updated`: updates through PATCH include the new `executionState`, while approving by comment records only the status. There is no assignee-history table, and a stage handoff is not labelled as such.
- **Old UI.** It allows one review stage followed by one approval stage, although the API accepts any number in any order. The properties panel shows "Review pending with Sam" but not who the task returns to.
- **`review` and `approval` behave the same**, apart from their label, the wake reason, and one auto-skip rule for review stages.
- **Related settings.** A separate issue-level `reviewPolicy` (`anyone`, `not_creator` or `human_only`) governs who may give a verdict on a review card. Tasks returned by the API carry `reviewAttention`, which lists what an `in_review` task is waiting on (a stage participant, a card, an approval, a monitor, a run), with labels and responders.

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
- **Agents get little guidance on Decisions.** The skill's routing rule ("same issue → interaction; other issues or bundles → decision") is the only guidance on when to use one. It never says when to propose a change instead of making it, or how to read the result. The Decisions sidebar link is also behind the `enableDecisions` flag, which is off by default.
- **Audiences are set in different ways.** Cards default to `anyone` (people or agents), configurable per company and per kind. Decisions and approvals are people-only, with no setting.
- **Some paths to `done` skip review stages.** See [Review-stage bypass](#review-stage-bypass).
- **Some documented rules are not enforced.** The skill's API reference (`references/api-reference.md`) says a CEO's first strategic plan must be approved (`approve_ceo_strategy`) before the CEO can move tasks to `in_progress`. Nothing on the server checks this.

Approvals overlap the most with cards. Two approval types, `request_board_approval` and `approve_ceo_strategy`, have no server-side handler at all: they store a payload, record approve or reject, and wake the requester, which is what a `human_only` confirmation card does. The vocabulary is mixed too: the skill's example confirmation card is titled "Plan approval", and the feed's detail kind for plan confirmations is `plan_approval`.

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

The fix is not a matter of copying an existing check. `issueService.update` already refuses an agent's `done` while a tool review is pending, but only when the update names an acting agent, and the Runner finalizer writes with no acting agent. A guard for stages would have to work without an actor and still allow the board override, in upstream's busiest files. The fork reports the bypass upstream with failing tests rather than fixing it (see [Small upstream contributions](#small-upstream-contributions)).

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

Only the discussion thread and the revision loop are unique to approvals; "formal" is just a display label for them.

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

**Vocabulary.** **Request** for the umbrella; **question** for outcome = return; **proposal** for outcome = apply; **approval** for requests stored in the approvals table. Plan confirmations stop being labelled "approvals". Upstream overloads these words: "decision" names proposals, attention queues (`decision_queues`), LLM classifiers (`decision_models`), Runner status decisions and review-stage verdicts (`issue_execution_decisions`), while "approval" and "review" both name ask-first tool gates. The fork renames things in its own UI and does not try to change upstream's names.

### Where the model lives

The model is a **view model in `ui-new`**, built from:

- the attention feed, for the subject, asker, audience, expiry, queues and triage;
- detail requests where needed: `GET /api/decisions/:id` for effects and results, the task's interactions for card payloads, and `GET /api/approvals/:id` with its comments and linked tasks;
- derived fields: the outcome, the "what happens next" line, and the formal label.

Storage stays as it is. Upstream's own feature map (`maps/feature-map/questions-and-approvals.md`) says these requests "can look similar but have different authority and continuation rules", and upstream keeps building on the split: queues in [#10651](https://github.com/paperclipai/paperclip/pull/10651), retention in [#10672](https://github.com/paperclipai/paperclip/pull/10672), retiring Decisions with completed targets in [#10892](https://github.com/paperclipai/paperclip/pull/10892). If the detail requests become slow, the UI caches and batches them; a server endpoint that bundles them would be a proposal to upstream, not a fork change.

## In the new UI

Everything here uses the existing API: the attention feed, `GET /api/companies/:co/decisions`, `GET /api/decisions/:id`, `GET /api/issues/:id/interactions`, the approval endpoints and the budget endpoints. Capability IDs refer to [capabilities.md](../inventory/capabilities.md).

### Requests

1. **A "Needs you" page with one card design.** It replaces the old `WhatNeedsMe` page at `/decisions` (capability `decisions/feed`). Group feed items as question, proposal, approval or sign-off, and keep alerts (failed runs, budget alerts, agent errors, blocked tasks) in their own group. Every card shows who is asking, about what, why now (`whyNow`), who can answer, the response controls, the expiry and the "what happens next" line. Who can answer comes from the feed's `resolverAudience` for cards; Decisions and approvals are always people only. Queue and triage labels use the same vocabulary.
2. **A proposal resolver with a change preview.** Port the old `DecisionCard`, which already summarizes each effect and warns when a target changed. Add current versus proposed values: current from the task, proposed from the effect. Stale-target flags (`targetChanged`) come from the list endpoint, not from `GET /api/decisions/:id`. After a decision, show each effect's result (`executions`) separately from the decision.
3. **Proposals on their tasks.** Show a waiting proposal in the thread or properties panel of its origin task and of every task it changes, not as a header strip (the strip upstream removed in [#10891](https://github.com/paperclipai/paperclip/pull/10891)). Find proposals that target a task with `GET /api/companies/:co/decisions?targetIssueId=` (people only; 50 results by default, at most 100). There is no filter by origin task, so a task's own proposals come from the feed's Decision items, whose `subject.metadata.originIssueId` names it. Linked approvals already appear in task threads (capability `tasks/approvals`).
4. **Approvals as formal requests.** Show "formal" as a badge. Formal requests open a detail view with the discussion thread and revision history, and the Approvals pages become a "formal" filter on the requests page (capability `approvals/governance`). Hires show the agent being activated. Budget overrides open the budget resolution instead of Approve and Reject: raise the limit to an amount, or keep the scope paused, through `POST /api/companies/:co/budget-incidents/:incidentId/resolve`. `GET /api/companies/:co/budgets/overview` lists incidents with their `approvalId`, which links an approval to its incident.
5. **Cards that act.** Cards that run a tool call (capability `approvals/tool-review`) or write a secret look distinct, show the scope being approved, and show the execution result separately from the decision.
6. **Live updates.** The old UI refreshes the feed only on window focus or after your own actions. The new UI also refreshes it on the live-events socket's `activity.logged` events for `decision.*`, `approval.*`, `issue.thread_interaction_*` and `issue.updated` actions. For signed-in users these events carry only the action, entity type and entity ID, which is enough to know what to refetch.
7. **Vocabulary.** Use the request vocabulary above everywhere: page names, filters, queue labels and empty states.

### Review stages (display only)

8. **Each turn to sign appears as a request.** Whoever's turn it is, person or agent, sees the same card as every other request: "Your sign-off is needed on PAP-12: approve or send back." For people, the feed's `review` items provide this. For agents, read the turn from the task's `executionState.currentParticipant`; don't keep a second copy.
9. **Where the task is, and where it returns.** Show "With Sam for review · returns to Agent A" from `executionState` (`currentParticipant` and `returnAssignee`). Task lists tell "reviewing" apart from "working on" for the same assignee.
10. **What `in_review` is waiting on.** The status means "waiting on anything". Show what, from the task's `reviewAttention.paths`, rather than the bare status.
11. **Handoffs in the history.** Label stage handoffs ("handed to Sam for review", "returned to Agent A with changes requested") where the `issue.updated` entry records the new `executionState`, as updates through PATCH do. Approving by comment records only the status, so those entries show as a plain status change.
12. **Two kinds of review.** Present **planned sign-offs** (stages) and **one-off review requests** (a card asked for on the spot). Label tool, plan and pull-request reviews by what they are.
13. **The stage editor keeps the old UI's shape:** one review stage, then one approval stage. The API accepts any number in any order, but participant changes are logged only for the first stage of each type, and upstream is still changing how stages work. Revisit once the work listed under [Scope](#scope-ui-only) lands.

### Port, or drop on purpose

14. **Queues, triage and archiving** (capability `decisions/queues`): saved queues, decide-by and snooze, keep, and the aging shelf. Port them, or mark them dropped in `capabilities.md` with the reason.
15. **Audience settings.** The old Company Settings page already edits each company's per-kind default and cap for card audiences (`interactionResolverGovernance`). Port it as it is.

## Left to upstream

The fork neither makes nor proposes these. Each is either a feature change, which upstream's `CONTRIBUTING.md` says needs agreement first ("uncoordinated feature PRs against the core product may be closed"), or sits in code upstream is actively changing.

| Idea | Why it's left alone |
| --- | --- |
| One requests table, or any merged storage | It would re-key every table in the shared layer, change the Runner's governance checks and chat-channel publishing (both query cards and approvals directly), and let cards exist without a task. `hire_agent` and `budget_override_required` are also tied to the agent lifecycle and to budget incidents, and are the audit trail for the two most consequential governance actions. |
| Formal cards, with `request_board_approval` and `approve_ceo_strategy` moved into them | Cards must belong to exactly one task. Strategy approvals have no task, and board approvals link zero or more and can be created by people. It would also copy approvals' thread and revision loop rather than retire anything. |
| A `board` audience for Decisions, or letting agents decide them | `board` already means `human_only`, and Decisions are already people only. Letting agents decide is an authority change: effects run with the decider's permissions, and a deciding agent has no person's permissions to check against. |
| A Decision shown as a confirmation card on its task | A feature change, and upstream deliberately moved Decision work off task pages in [#10891](https://github.com/paperclipai/paperclip/pull/10891). The UI shows proposals on their tasks instead (UI item 3). |
| Fixing the review-stage bypass in the fork | A real bug, but the fix sits in upstream's busiest files and needs care (see [Review-stage bypass](#review-stage-bypass)). Reported upstream instead (small contribution 5). |
| Rules for removing reviewers, with "added by" fields on participants | Upstream [#16431](https://github.com/paperclipai/paperclip/pull/16431) covers the main case: agents can't change a policy that includes a person. |
| Default reviewers per project or company | Upstream [#15267](https://github.com/paperclipai/paperclip/pull/15267). If it lands, the UI exposes the setting. |
| Approval as the final step, or several stages of one type | Needs upstream validation that runs only when a policy changes, plus participant logging for every stage. The UI keeps the old shape meanwhile (UI item 13). |
| Runner tools to add a reviewer or sign off, and guidance on when a task needs a reviewer | Runner and skill design are upstream's call. |
| Merging the many kinds of review (review child tasks, stalled reviews, completion reviews and others) | The UI presents two kinds (UI item 12) without changing the server. |
| A stage-handoff marker on activity entries | The UI infers most handoffs (UI item 11). The marker would go in the PATCH route's activity code, which open upstream pull requests also edit. |
| Rewriting the skill's guidance into one decision tree | The skill is the core agent prompt, and restructuring it is a product decision. The narrow missing pieces go upstream as small contribution 2. |
| Growing the Decision effect catalog | Upstream's roadmap plans for agents to propose structural changes, so upstream may grow it. |
| Enforcing the CEO-strategy gate | A product decision. Small contribution 3 asks upstream which is intended. |

## Small upstream contributions

Each is one logical change that stands on its own, the kind upstream's `CONTRIBUTING.md` says gets merged fastest. None is carried as a fork patch: each goes from its own branch off `master` (see [FORK.md](../../../FORK.md#contributing-fixes-upstream)) and comes back through the normal sync once merged.

| # | Change | Kind | Files |
| --- | --- | --- | --- |
| 1 | Refuse approve and reject on budget-override approvals | bug fix | `server/src/services/approvals.ts`, plus a test |
| 2 | Document how an agent reads a Decision's outcome | docs | `skills/paperclip/SKILL.md` |
| 3 | Stop the skill promising an unenforced CEO-strategy gate | docs, or an issue | `skills/paperclip/references/api-reference.md` |
| 4 | Optional: log participant changes for every stage of a type | bug fix | `server/src/routes/issues.ts`, plus a test |
| 5 | Report the review-stage bypass, with failing tests | bug report | none |

1. **Budget-override approvals.** `POST /api/approvals/:id/approve` and `/reject` on a `budget_override_required` approval mark it approved or rejected, and leave the budget incident open and the scope paused. Plugins reach the same code through the plugin host. Add a check to the approvals service's `decide` that refuses these approvals with an error pointing to the budget-incident resolve endpoint. Refusing is simpler than resolving, because an approval carries no new limit amount. The old UI already hides Approve and Reject on these approvals, so the change only makes the API agree with it. The files involved have barely changed in the last month (`routes/approvals.ts` once, `services/approvals.ts` five times).
2. **Reading a Decision's outcome.** The skill's Standalone Decisions section covers creating a Decision but not what happens afterwards. Add a few lines:
    - with `wake_origin_agent`, the proposer is woken with reason `decision_<outcome>` (`decided`, `expired` or `cancelled`) and a payload naming the `decisionId`;
    - `GET /api/decisions/:id` returns the status, the chosen option and each effect's result (`executions`);
    - an effect with `staleness: "strict"` is skipped if its target task changed after the proposal;
    - only people can decide a Decision.
3. **The CEO-strategy line.** `references/api-reference.md` says a CEO's first strategic plan must be approved before the CEO can move tasks to `in_progress`; nothing on the server checks this. Either reword the line so it doesn't promise enforcement, or open a short issue asking which is intended. The issue is the safer start, since the answer is a product decision.
4. **Participant logging for every stage.** `summarizeExecutionParticipants` in `server/src/routes/issues.ts` uses `stages.find`, so `issue.reviewers_updated` and `issue.approvers_updated` miss changes to every stage after the first of its type. The fix is a few lines, but the file is upstream's busiest, and no interface creates a second stage of one type yet. Send it only as an easy first contribution.
5. **The review-stage bypass.** Write tests for the two Runner paths: a Runner agent finishing a task with configured but unstarted stages, and someone accepting a Runner completion-review card on such a task. If they fail, file a bug with upstream's bug template, attach the tests, and link [#13744](https://github.com/paperclipai/paperclip/issues/13744) and [#13001](https://github.com/paperclipai/paperclip/issues/13001). Let upstream own the fix.

Before sending any of these, search upstream for duplicate pull requests; upstream's PR template asks you to confirm the search. As of Oct 19, none of the five had a duplicate.

## Open questions

Answered by reading the code:

- [x] Is a housekeeping ("gardener") agent the intended main producer of Decisions? It is a role the code supports, not a bundled agent. An agent with `decision_triage:manage` creates archive proposals (`POST /api/companies/:co/decision-archive-proposals`), sets triage, and reads the stats endpoint, which the route documents as the "Gardener telemetry contract".
- [x] Does approving a `budget_override_required` approval from the Approvals page lift the budget pause? No. The approvals API only marks the approval; the old UI hides the buttons and points to the budget controls on `/costs`. See small contribution 1.
- [x] Should `anyone` remain the default audience for questions? It is already configurable per company and per kind, with a cap. The new UI ports that setting (UI item 15) rather than changing the default.
- [x] Which routes may create formal requests? Any agent with approval access can create `request_board_approval` and `approve_ceo_strategy`, through `POST /api/companies/:co/approvals` or the Runner's `request_approval`; people can create them too. Hires and budget overrides are created by their own flows.
- [x] Can a worker agent remove a reviewer a person added, before it submits? Yes. Upstream [#16431](https://github.com/paperclipai/paperclip/pull/16431) describes the same gap and proposes a fix.

Open:

- [ ] Does the review-stage bypass reproduce in a test, for each path in [Review-stage bypass](#review-stage-bypass)? Small contribution 5 starts here.
- [ ] Port or drop queues, triage and the aging shelf (UI item 14)?
- [ ] Do alerts (failed runs, budget alerts, agent errors, blocked tasks) belong on the "Needs you" page, or somewhere else, such as the dashboard?
- [ ] What should the page be called? "Needs you" is a working name.
- [ ] When upstream's review-stage work lands (#16431, #15267 and the others under [Scope](#scope-ui-only)), which of UI items 8–13 change?
