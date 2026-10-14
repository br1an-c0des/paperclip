# Approvals and decisions

Tier 1 (redesign). Everything that waits on a person: formal board **approvals** (hire an agent, approve
strategy, override a budget), and the broader **attention feed** of agent questions, confirmations,
proposed decisions, join requests and recovery actions.

Source of truth for requests: [generated/pages.md](../generated/pages.md) sections for `Approvals`,
`ApprovalDetail`, `WhatNeedsMe`, `DecisionQueuePage`. Upstream recipe:
`maps/feature-map/questions-and-approvals.md`.

## Pages

| Page | Routes | What it is |
| --- | --- | --- |
| Approvals (`pages/Approvals.tsx`) | `/:co/approvals/pending`, `/:co/approvals/all` | Formal approvals, pending or all. |
| Approval detail (`pages/ApprovalDetail.tsx`) | `/:co/approvals/:approvalId` | One approval with discussion and linked tasks. |
| Decisions (`pages/WhatNeedsMe.tsx`) | `/:co/decisions` | The attention feed: everything that needs you. |
| Decision queue (`pages/DecisionQueuePage.tsx`) | `/:co/decisions/queues/:key` | A saved queue of decision items. |

Reference:

- Approval types: `hire_agent`, `approve_ceo_strategy`, `budget_override_required`,
  `request_board_approval`. Statuses: `pending`, `revision_requested`, `approved`, `rejected`,
  `cancelled`.
- Attention item kinds: approval, decision, task-thread interaction, join request, recovery action.

## Capabilities

### `approvals/governance`: Approvals list and detail

- **Where:** Approvals pages; approval cards in tasks, inbox and the Decisions feed.
- **What:** list pending or all approvals; approve or reject from the card; on detail: the request
  payload (e.g. the agent to be hired), discussion comments, linked tasks, request revision, resubmit;
  deleting the pending agent of a rejected hire.
- **Requests:** `GET /api/companies/:companyId/approvals`, `GET /api/approvals/:id`,
  `POST /api/approvals/:id/approve|reject|request-revision|resubmit`,
  `GET|POST /api/approvals/:id/comments`, `GET /api/approvals/:id/issues`, `DELETE /api/agents/:id`.

### `decisions/feed`: What needs me

- **Where:** Decisions page; inbox attention rows.
- **What:** one feed of actionable items across the company, each expandable inline:
  - agent questions, confirmations, item verdicts and suggested tasks (same cards as the task thread),
  - proposed decisions (structured proposals, e.g. change a task's status): decide or dismiss,
  - approvals (approve, reject, request revision), join requests (approve, reject),
  - connection requests (complete, decline, adopt, set default AI connection),
  - stalled reviews (decide), and recovery actions,
  - reply on the underlying task without leaving the feed.
- **Requests:** `GET /api/companies/:companyId/attention`, `GET /api/companies/:companyId/decisions`,
  `GET /api/decisions/:id`, `POST /api/decisions/:id/decide|dismiss`,
  `POST /api/issues/:id/interactions/:interactionId/*`, `POST /api/issues/:id/stalled-review-decision`,
  `POST /api/issues/:id/comments`, approval, join-request and connection-intent requests as above.
- **Notes:** dismiss and snooze go through `inboxDismissalsApi` (shared with Inbox). Unanswered
  questions stay in the feed after dismissal and can be reopened (upstream `dismiss-and-reopen`).

### `decisions/queues`: Decision queues and triage

- **Where:** Decisions page (queue list), queue page.
- **What:** create and rename saved queues; add items to and remove items from a queue; triage an item
  (state per item); mark an item to keep (retention).
- **Requests:** `GET|POST /api/companies/:companyId/decision-queues`,
  `PATCH /api/companies/:companyId/decision-queues/:key`,
  `POST .../decision-queues/:key/items`, `DELETE .../decision-queues/:key/items/:sourceKind/:sourceId`,
  `PUT /api/companies/:companyId/decision-triage/:sourceKind/:sourceId`,
  `PATCH /api/companies/:companyId/decision-retention/:sourceKind/:sourceId`.

### `approvals/tool-review`: App call review

- **Where:** a task's "Review request" for an ask-first app call; Apps → Review (Tier 2).
- **What:** approve once, always allow the displayed scope, or decline.
- **Notes:** listed here because it is the same kind of "waiting on you" item; the requests belong to the
  Apps area.

## Switches that change this area

`enableDecisions` (default off) only adds the sidebar link to Decisions; `enableCombinedInboxTasks`
routes inbox attention rows into Tasks views. Full list: [generated/flags.md](../generated/flags.md).

## Redesign notes

- **Three overlapping "needs you" surfaces:** Inbox (My-work views in [Tasks](tasks.md)), Approvals, and
  Decisions. Each lists approvals and join requests; Decisions also lists interactions. A redesign can
  pick one home for "waiting on me" and treat the others as filters.
- **The same card everywhere.** Interaction, approval and connection cards appear in the task thread,
  agent chat, inbox and Decisions. One card component in `ui-new` covers all of them.
- **Formal approvals are rarer but heavier** (comments, revision cycle). They need a detail view even if
  the list merges into a unified feed.
