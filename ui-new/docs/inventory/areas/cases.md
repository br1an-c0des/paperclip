# Cases

Tier 1 (redesign). An experimental feature (`enableCases`, default off): structured records with a type,
fields, parent/child relationships, documents, revisions and activity, linked to the tasks that work on
them. Since the 2026-10-22 upstream sync, a case can have one primary task that agents hand off to each
other through phases and reusable workflows, and the board pages only read cases: agents and authorized
API callers write them. (Pipelines, which built on cases, were removed upstream in the same sync.)

Source of truth for requests: [generated/pages.md](../generated/pages.md) sections for `Cases` and
`CaseDetail`. Upstream recipe: `maps/feature-map/cases.md`.

## Pages

| Page | Routes | What it is |
| --- | --- | --- |
| Cases (`pages/Cases.tsx`) | `/:co/cases` | All case records. Behind `CasesExperimentalGate`. |
| Case detail (`pages/CaseDetail.tsx`) | `/:co/cases/:caseIdentifier` | One case. |

## Capabilities

### `cases/browse`: Case list

- **What:** search, filter (status, type, project), sort and group case records; nested children stay
  visible when they match. Read-only since the 2026-10-22 sync (inline field edits and the label filter
  were removed).
- **Requests:** `GET /api/companies/:companyId/cases` (sort, group and offset parameters),
  `GET /api/companies/:companyId/cases/types` (type filter), `GET /api/companies/:companyId/projects`.

### `cases/structure` and `/history`: Case detail

- **What:** read-only since the 2026-10-22 sync: details (fields, labels, project), parent and child
  cases, documents (the case's own and previews of its primary task's documents), attachments, and the
  handoff history of the primary task between agents. Editing fields, labels and documents, document
  revisions and annotations, and the event history were removed from the page.
- **Requests:** `GET /api/cases/:idOrIdentifier`, `GET /api/companies/:companyId/cases` (children),
  `GET /api/cases/:caseId/handoffs` (handoff history, paged), `GET /api/projects/:id`,
  `GET /api/companies/:companyId/agents`.
- **Unused by the old UI:** the API still has `PATCH /api/cases/:idOrIdentifier`, the case document
  routes, `GET /api/cases/:idOrIdentifier/events`, and handoff control
  (`POST /api/companies/:companyId/case-handoffs`, `POST /api/cases/:caseId/handoffs/:handoffId/retry|cancel`).

### `cases/task-links`: Linked work

- **What:** a summary of the primary task (status, assigned agent, phase, workflow, pending handoff),
  then related tasks as links with their role; from a task, the cases it belongs to. Before the
  2026-10-22 sync, linked tasks were shown with the task detail components (documents, work products,
  runs, watchdog, scheduled retry).
- **Requests:** the primary task and links arrive with `GET /api/cases/:idOrIdentifier`;
  `GET /api/issues/:issueIdOrIdentifier/cases` (from a task).

## Redesign notes

- Experimental and gated. Decide whether cases survive the redesign before porting. Upstream has
  narrowed the board's role to reading cases and following handoffs, so a port is now much smaller than
  the task-detail reuse this note first assumed.
