# Goals

Tier 1 (redesign). Goals explain *why* work exists. They form a tree (company → team → agent → task
level) and connect to projects and tasks.

Source of truth for requests: [generated/pages.md](../generated/pages.md) sections for `Goals` and
`GoalDetail`, and **App shell** for the new-goal dialog. Upstream recipe: `maps/feature-map/goals.md`.

## Pages

| Page | Routes | What it is |
| --- | --- | --- |
| Goals (`pages/Goals.tsx`) | `/:co/goals` | The goal tree. |
| Goal detail (`pages/GoalDetail.tsx`) | `/:co/goals/:goalId` | One goal with its sub-goals and projects. |
| New-goal dialog (`components/NewGoalDialog.tsx`, app shell) | none | Create a goal or sub-goal. |

Reference: levels `company`, `team`, `agent`, `task`; statuses `planned`, `active`, `achieved`,
`cancelled`.

## Capabilities

### `goals/hierarchy`: Goal tree and creation

- **Where:** Goals page (`GoalTree`); new-goal dialog; "add sub-goal" on goal detail.
- **What:** browse goals as a tree; create a goal with title, markdown description (image upload), level,
  status, owner and parent.
- **Requests:** `GET /api/companies/:companyId/goals`, `POST /api/companies/:companyId/goals`,
  `POST /api/companies/:companyId/assets/images`.

### `goals/detail`: Goal detail and properties

- **What:** inline-edit title and description; properties panel: status, level, owner, parent goal,
  created/updated; tabs for sub-goals ("children") and linked projects.
- **Requests:** `GET|PATCH /api/goals/:id`, `GET /api/companies/:companyId/projects`,
  `GET /api/companies/:companyId/agents` (owner picker).
- **Notes:** the UI has no delete; `DELETE /api/goals/:id` exists (`goalsApi.remove`) but nothing calls it.
  Cancelling (status) is the UI's way to retire a goal.

### `goals/alignment`: Goal context on work

- **Where:** project and task pages (goal shown as context; projects and tasks can reference a goal).
- **What:** follow a goal from a project or task, and see which projects serve a goal.
- **Requests:** project and task requests ([projects](projects.md), [tasks](tasks.md)).

## Switches that change this area

`enableGoalsSidebarLink` (default off) only adds the sidebar link; the pages always exist. Full list:
[generated/flags.md](../generated/flags.md).

## Redesign notes

- Small surface: a tree, a detail page and a dialog. A natural candidate to merge into a combined
  "planning" view with projects, or to show as context on project and task pages, not a standalone
  section.
- The only switch is the sidebar link, which a redesign can drop by deciding where goals live.
