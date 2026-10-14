# Artifacts

Tier 1 (redesign). The artifact library: every output agents produced across the company (files,
documents, media, work products), searchable in one place. Per-task outputs are covered in the
[Tasks guide](tasks.md) (`documents-artifacts/*`).

Source of truth for requests: [generated/pages.md](../generated/pages.md) section for `Artifacts`.
Upstream recipe: `maps/feature-map/documents-artifacts.md` (`library`).

## Pages

| Page | Routes | What it is |
| --- | --- | --- |
| Artifacts (`pages/Artifacts.tsx`) | `/:co/artifacts` | Company-wide artifact library. |

## Capabilities

### `documents-artifacts/library`: Artifact library

- **What:** search artifacts; filter by type; group by task or kind (or none); artifact stacks (several
  versions or files from one source); open an artifact in its viewer (media preview, documents) or jump
  to its source task.
- **Requests:** `GET /api/companies/:companyId/artifacts`; opening an item uses the task requests
  (attachments content, documents, work products) listed in [tasks](tasks.md).
- **Notes:** the same request, filtered by agent, feeds Agent Chat's work panel
  (`components/chat/AgentWorkPanels.tsx`). The task side panel's Artifacts tab lists the task's own
  outputs (work products and attachments) instead.

## Redesign notes

- A single read-only list over task outputs. It could become a view in a combined work area (filter by
  project, agent or task) rather than a standalone section.
