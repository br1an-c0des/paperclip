# Discoveries and decisions

Things the redesign turns up that `ui-new` needs a decision on: gaps in the API, behavior a design
assumed but the server doesn't have, and constraints that rule out an approach. Each entry records what
was found, the options, and the decision once it's made.

How this fits with the other redesign docs:

- [inventory/capabilities.md](inventory/capabilities.md) lists what the old UI does and where each
  capability lands. This log covers what the *new* design needs that isn't there yet.
- [proposals/](proposals/) holds larger designs. When an entry here grows into one, link it and keep
  the entry as the summary.
- Server or package changes are out of scope for the fork ([FORK.md](../../FORK.md)). An entry can
  propose one upstream, but the fork never carries it as a patch.

## Adding an entry

Give it the next number and add it to the index. Use the fields below, and keep the history: when a
decision changes, mark the old one superseded and link the new entry rather than rewriting it.

- **Status:** Open, Decided, or Superseded by another entry.
- **Area:** the capability IDs it touches, from the [checklist](inventory/capabilities.md).
- **Found in:** the design, page or code where it came up.
- Then **What we found**, **Why it matters**, **Options** and **Decision**.

## Index

| # | Entry | Area | Status | Opened |
| --- | --- | --- | --- | --- |
| 1 | [Projects can't hold documents or files](#1-projects-cant-hold-documents-or-files) | `projects/*`, `documents-artifacts/library` | Open | Oct 20, 2026 |

## Entries

### 1. Projects can't hold documents or files

- **Status:** Open
- **Area:** `projects/*`, `documents-artifacts/library`
- **Found in:** the project Docs tab in the tasks and projects design canvas (screen 9,
  [private link](https://claude.ai/artifact/Rfim4J3VCm6qkSvcpeLsi7)).

**What we found.** Documents (keyed markdown with revisions, locks and annotations) exist on tasks,
cases and pipelines (`/api/issues/:id/documents/:key`, `/api/cases/:id/documents/:key`,
`/api/pipelines/:pipelineId/documents/:key`). Attachments exist on tasks and cases. Projects have
neither. The only project-level text is the project's markdown `description`, which can embed images
uploaded with `POST /api/companies/:companyId/assets/images`.

Part of the design already works on the existing API: `GET /api/companies/:companyId/artifacts`
accepts `projectId` and `groupBy=task`. That covers the Docs tab's "From tasks" section, which lists
every task's documents, attachments and outputs, grouped by task.

**Why it matters.** The design's Docs tab opens with a "Project docs and files" section for material
that belongs to the whole project rather than one task: a project brief, architecture notes, trading
rules, reference files. There is nowhere to store it. Agents would need a way to find these docs as
well as people.

**Options.**

1. **A project docs task.** `ui-new` keeps one task per project to hold its documents and
   attachments, and hides it from lists, boards and counts. It works on the existing API and gets
   revisions, locks and annotations for free. But the server doesn't know about the convention, the
   old UI and agents see an ordinary task, and the UI needs a reliable way to find it (a label, or a
   field it can set). The task must also never be picked up as work.
2. **The project description only.** Treat the description as the single project doc. Nothing new is
   needed, but it's one document, with no revisions and no files other than embedded images.
3. **Propose project documents upstream.** Ask Paperclip to support documents and attachments on
   projects, as it already does for cases and pipelines. This is the cleanest result, but it depends on
   upstream accepting it and on when it lands.
4. **Drop the section.** The Docs tab shows task docs only.

Options 1 and 3 can be combined: start with a project docs task and move its contents over if upstream
adds project documents.

**Decision.** Not made yet. Until then the design keeps the section, and `ui-new` can build the
"From tasks" part first.
