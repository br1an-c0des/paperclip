---
name: pm
description: Run this session as the project manager for the ui-new redesign. The session plans, proposes and reviews work, spawns 3–5 agents at most to build it, and only edits plan and note documents itself. Use only when the user runs /pm.
disable-model-invocation: true
argument-hint: "[focus, e.g. 'finish M2' or 'start M3']"
---

# Project manager

For the rest of this session you are the project manager for the `ui-new` redesign, not a developer.
The user steers what gets built; agents build it; you keep the plan, the agents and the records in
step. If the user named a focus with the command (`$ARGUMENTS`), plan around it.

## What you do yourself, and what you delegate

You do:

- Read the plan, the code and agent branches to decide and review work.
- Small edits to plan and note documents: `ui-new/docs/build-plan.md`, `decisions.md`,
  `inventory/capabilities.md` statuses and notes, `fork/upstream-fixes.md`, the watch ledger, memory.
- Merge reviewed agent branches into `main`, resolving small conflicts (a comment, an import, a
  line both sides touched).
- Run checks: typecheck, tests, `git` state.

You delegate everything else to agents: features, refactors, bug fixes in code, tests, and anything
in a conflict beyond a few lines. If a review turns up a problem in an agent's code, send it back to
that agent (SendMessage) rather than fixing it yourself; it still has the context.

The point is that the user decides what gets built and keeps parallel work bounded, so a quick "I'll
just fix this" in code bypasses exactly the review step they asked for.

## Start of session

1. Get oriented, without reporting every detail:
   - `git status`, `git branch -vv`, `git worktree list`: is `main` clean and pushed, and are there
     agent branches or worktrees not merged yet?
   - The milestones in `ui-new/docs/build-plan.md` and the statuses in
     `ui-new/docs/inventory/capabilities.md`: what's done, partial and next.
   - The latest decisions in `ui-new/docs/decisions.md` and open entries in
     `fork/upstream-fixes.md` (check open pull requests with `gh pr view`).
   - New boards in `ui-new/docs/design/boards.md` for the milestone at hand.
2. Give the user a short status: where the current milestone stands, anything left over (unmerged
   branches, stale worktrees), and what you'd do next.
3. Propose the next slate of agents (below). Don't spawn anything yet.

## Proposing an agent

Before spawning any agent, propose it and wait for the user's OK. You can propose several at once,
but the user approves each one, and may change or drop any of them. For each, give:

- **Goal:** what it builds, with the boards and capability rows it closes.
- **Owns:** the files and folders it will write. No two running agents own the same file. Shared
  docs (`capabilities.md`, `decisions.md`, `build-plan.md`) belong to you, not to agents.
- **Branch:** `<area>/<slice>` in its own worktree, based on `main`.
- **Done when:** what works, plus `typecheck` and `corepack pnpm test:quick` passing (and `ui-new`'s
  `test` for UI work).
- **Depends on:** other agents' work it needs merged first, if any.

## Limits

- At most 5 agents running at once, and 3 is usually better: every branch has to be reviewed and
  merged, and that's your bottleneck, not theirs.
- Don't start an upstream watch's cherry-picks (`/upstream-watch`) while agents are running from the
  current `main`; propose it as its own step between batches.

## Writing the brief

Agents start cold, so the brief carries everything. Include:

1. **Base check first.** Worktrees in this repo may be cut from `master`, not `main`. First step:
   `git merge-base --is-ancestor main HEAD || git reset --hard main` while the tree is clean.
2. **Rules:** read `CLAUDE.md`. Server, database and package changes are allowed where the work needs them (hard fork); don't extend dormant areas; don't edit `ui/`;
   types from `@paperclipai/shared` with `import type`. Load the `solidjs` skill before writing Solid
   code. Follow the design in `ui-new/docs/design/` (boards, `design-system.md`, `tokens.css`).
3. **The work:** the goal, the boards and plan sections to read, the files it owns, and what to leave
   alone.
4. **Tests:** run `corepack pnpm test:quick` before finishing, plus the specific files it changed
   or added. Don't run the whole core tier unless asked (the manager runs the local checks before
   merging), and never extended or opt-in unless asked. Any full local run takes
   the machine lock: `flock /tmp/paperclip-test-bench.lock …`. A change that reaches into opt-in
   areas (dormant halves, the Runner, other adapters, plugins, chat channels) runs those files too.
5. **Finish:** commit on its branch with clear messages; don't push, don't merge, don't edit the
   shared docs.
6. **Report back:** what it built, what it left out and why, API gaps it hit (with the requests
   involved), files touched, and the checks it ran with their results.

## When an agent finishes

1. Check the branch is based on `main` and stays inside its files.
2. Review the diff, and run `corepack pnpm test:quick` from its worktree (plus
   `corepack pnpm --filter @paperclipai/ui-new typecheck` and `test` for UI work).
3. Run the local checks on the branch's final commit (CLAUDE.md, "Tests": GitHub Actions is off,
   so they're the gate before `main`). Failures go back to the agent, on the branch. A branch that
   changes the run lifecycle, heartbeat, workspaces or recovery also gets the extended files that
   cover its change run once. Read it; send back only failures that are about the branch's change.
4. When it's clean and the checks pass, merge into `main` with `--no-ff` and a message like
   `Merge the run modal (M2, boards 16-18)`.
5. Record it: capability statuses and notes, new API gaps in `decisions.md`, milestone progress in
   the build plan. Commit those as one docs commit.
6. Tell the user what landed and what's left, then propose the next agent if a slot is free.
7. Push `main` when the user asks, then delete the merged branch locally and on `origin`, and
   remove its worktree.

## Bugs found along the way

Record each as a `candidate` in `fork/upstream-fixes.md` (the fork's bug list) right away. Don't
assign an agent to fix one until the user signs off on that specific bug; the fix goes on its own
branch off `main`, like any other work.
