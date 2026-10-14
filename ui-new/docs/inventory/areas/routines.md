# Routines

Tier 1 (redesign). A routine is a saved, repeatable request: a task template (title, description,
variables) with a default agent and project, fired by triggers (schedule, webhook, API). Each firing
creates a task and run.

Source of truth for requests: [generated/pages.md](../generated/pages.md) sections for `Routines` and
`RoutineDetail`. Upstream recipe: `maps/feature-map/routines.md`.

## Pages

| Page | Routes | What it is |
| --- | --- | --- |
| Routines (`pages/Routines.tsx`) | `/:co/routines` | All routines, in folders. |
| Routine detail (`pages/RoutineDetail.tsx`) | `/:co/routines/:routineId?section=…` | One routine. Sections: overview, triggers, variables, secrets, delivery, runs, activity, history. |

Reference: statuses `active`, `paused`, `archived`; trigger kinds `schedule`, `webhook`, `api`;
webhook signing modes `bearer`, `app_webhook`, `hmac_sha256`, `github_hmac`, `fireflies_hmac`, `none`;
concurrency `coalesce_if_active`, `always_enqueue`, `skip_if_active`; catch-up `skip_missed`,
`enqueue_missed_with_cap`; activity gate `always`, `require_external_activity`.

## Capabilities

### `routines/management`: List, folders, run now

- **Where:** Routines page.
- **What:** built-in and custom routines; folders (create, rename, delete, move routines; "Unfiled");
  group and sort; columns for project, responsible person, default agent ("For"), concurrency; run now;
  pause/resume and archive; recent runs; create a new routine.
- **Requests:** `GET|POST /api/companies/:companyId/routines`, `PATCH /api/routines/:id`,
  `POST /api/routines/:id/run`, `GET|POST /api/companies/:companyId/folders`,
  `PATCH|DELETE /api/companies/:companyId/folders/:folderId`,
  `POST /api/companies/:companyId/folders/items/move`, `GET /api/companies/:companyId/live-runs`.
- **Notes:** plugin-managed and built-in routines are distinguished from custom ones (see
  [agents](agents.md) for built-in routine schedules).

### `routines/definition`: Overview

- **What:** title, description (markdown with annotation threads), default agent, project, priority,
  responsible person; inline edits with undo. Creating or hiring an agent inline from the agent picker.
- **Requests:** `GET|PATCH /api/routines/:id`, `GET|POST /api/routines/:routineId/description/annotations`
  (+ thread PATCH and comments), `POST /api/companies/:companyId/agent-hires`,
  `POST /api/companies/:companyId/agents`.

### `routines/variables` and `/secrets`: Inputs

- **What:** variables the request template uses (filled at run time or by triggers); secrets the routine
  run receives (create a company secret inline).
- **Requests:** `PATCH /api/routines/:id`, `GET|POST /api/companies/:companyId/secrets`.

### `routines/triggers`: Triggers

- **What:** add schedule (cron), webhook and API triggers; enable/disable, edit, delete; webhook URL and
  signing mode; rotate a trigger's secret; guided trigger setup (`?triggerSetup`).
- **Requests:** `POST /api/routines/:id/triggers`, `PATCH|DELETE /api/routine-triggers/:id`,
  `POST /api/routine-triggers/:id/rotate-secret`.

### `routines/delivery`: Delivery and run policy

- **What:** concurrency policy, catch-up policy for missed schedules, activity gate, advanced run policy,
  execution workspace and environment for runs.
- **Requests:** `PATCH /api/routines/:id`, `GET /api/companies/:companyId/environments`,
  `GET /api/companies/:companyId/execution-workspaces`.

### `routines/run-now` and `/history`: Runs, activity, revisions

- **What:** run now with inputs; Runs section lists executions with their tasks and live state;
  Activity lists routine events; History lists configuration revisions with restore (History is
  configuration, not executions).
- **Requests:** `POST /api/routines/:id/run`, `GET /api/routines/:id/runs`,
  `GET /api/companies/:companyId/activity` (routine filter), `GET /api/issues/:issueId/live-runs`,
  `GET /api/routines/:id/revisions`, `POST /api/routines/:id/revisions/:revisionId/restore`.
- **Notes:** in the production shell, Runs and Activity are separate legacy sections.

## Redesign notes

- **Routines are task templates.** The definition (title, description, agent, project, priority) mirrors
  the new-task dialog; a redesign could share one form.
- **Eight sections** for one object; triggers and delivery policy are the substantial ones.
- **Runs are tasks.** Routine executions produce tasks, so routine run history overlaps with the task list
  filtered by routine.
- Routines are also shown on execution workspace pages (run a workspace-bound routine).
