# Cases

Tier 1 (redesign). An experimental feature (`enableCases`, default off): structured records with a type,
fields, parent/child relationships, documents, revisions and activity, linked to the tasks that work on
them. Pipelines (undecided tier) build on cases: a pipeline item is a case.

Source of truth for requests: [generated/pages.md](../generated/pages.md) sections for `Cases` and
`CaseDetail`. Upstream recipe: `maps/feature-map/cases.md`.

## Pages

| Page | Routes | What it is |
| --- | --- | --- |
| Cases (`pages/Cases.tsx`) | `/:co/cases` | All case records. Behind `CasesExperimentalGate`. |
| Case detail (`pages/CaseDetail.tsx`) | `/:co/cases/:caseIdentifier` | One case. |

## Capabilities

### `cases/browse`: Case list

- **What:** search, filter (labels, projects), sort and group case records; nested children stay
  visible when they match; inline field edits.
- **Requests:** `GET /api/companies/:companyId/cases`, `PATCH /api/cases/:idOrIdentifier`,
  `GET /api/companies/:companyId/labels`, `GET /api/companies/:companyId/projects`.

### `cases/structure` and `/history`: Case detail

- **What:** fields and properties (edit, create labels); child cases; documents with revisions, restore,
  lock/unlock and annotations; event history.
- **Requests:** `GET|PATCH /api/cases/:idOrIdentifier`, `GET /api/companies/:companyId/cases` (children),
  `GET|PUT|DELETE /api/cases/:idOrIdentifier/documents/:key` (+ `/revisions`, `/restore`, `/lock`,
  `/unlock`), `GET /api/cases/:idOrIdentifier/events`,
  `GET|POST /api/cases/:caseId/documents/:documentKey/annotations`.

### `cases/task-links`: Linked work

- **What:** tasks working on the case, shown with the task detail components (documents, work products,
  runs, watchdog, scheduled retry); from a task, the cases it belongs to.
- **Requests:** `GET /api/companies/:companyId/issues` (case filter), task requests (see [tasks](tasks.md)),
  `GET /api/issues/:issueIdOrIdentifier/cases`.

## Redesign notes

- Experimental and gated. Decide whether cases (and pipelines) survive the redesign before porting. If
  they do, case detail reuses most task-detail building blocks (documents, annotations, work products).
