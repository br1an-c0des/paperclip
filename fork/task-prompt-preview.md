# Prompt preview in the New task dialog

**Approved 2026-11-24.** Follows step 5 ([step-5-prompt-builder.md](step-5-prompt-builder.md)), which
made a run's prompt visible on the run's Input tab and as a next-run preview in an agent's settings.

## Intent

You can see what an agent will get before the task exists. The user works visually: the prompt an
assignee receives is easier to judge while writing the task than after the run. This uses the same
builder and section view as step 5, so the preview and the real run agree.

## Approaches

- **A new draft request on the server (chosen).** `POST /api/agents/:id/run-preview/draft` takes the
  dialog's draft and builds an assignment preview from it with step 5's builder, as if the task had
  just been created and assigned. Read-only: it creates nothing.
- **Create the task first, then preview it:** not this. It writes data and wakes the agent.
- **Build the brief in `ui-new`:** not this. It's a second prompt builder, which step 5 exists to avoid.

## Design

- **Server:** the draft carries the title, description, project, parent, goal, priority, work mode
  (do the work / answer a question / plan first) and workspace choice. It's a POST only because
  a description can be too long for a URL. Values that exist only once the task does (its
  identifier, ids, the workspace a new worktree gets) are marked "filled in at launch", as the
  settings preview marks its pending values. Fields the task would inherit or default on creation
  (a project's goal, say) are applied as creation would.
- **The button** sits in the assignment row next to the assignee, with an "i" tip. It's enabled
  for an agent on `claude_local`'s CLI engine with Repeat off. Otherwise it's disabled with a short
  reason: no assignee, a person, another adapter or engine, or a recurring task (its runs start
  differently; left out of this first version).
- **The pop-up** is a dialog over the New task dialog (a full-screen sheet on phones) that reuses
  `PromptSections`. It builds the preview when opened. After editing, opening it again shows the
  new version; it doesn't follow typing live.
- **A new task always starts a fresh session,** so the preview always includes the system prompt.

## Left to the builder

How the draft is turned into the brief's input; the exact icon and placement within the
assignment row; the request's validation (it reuses issue creation's limits).
