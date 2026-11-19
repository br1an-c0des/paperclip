---
name: upstream-watch
description: Review what upstream paperclipai/paperclip has done since the last review, filter out what only touches code this hard fork doesn't use, triage the rest (bug fixes in code we run, security fixes, features worth having, ideas to port by hand) into a short report, and, only after the user picks, cherry-pick the chosen commits on a branch, check them and stop for approval before merging into main. Use when the user asks what's new upstream, wants to review, watch or pull from upstream, wants an upstream fix, or runs /upstream-watch.
---

# Upstream watch

Since the hard fork (2026-11-17, tag `upstream-freeze` at upstream `79c8cf8b6`), `main` never merges
upstream. This skill reviews upstream instead and brings in only what the user chooses, by
cherry-pick. Background: [fork/hard-fork-plan.md](../../../fork/hard-fork-plan.md#watching-upstream).

The skill runs in two stages, each gated by the user:

1. **Review (steps 1–4):** fetch upstream, list the commits since the last review, filter, triage,
   report, and stop. Nothing is cherry-picked, merged or pushed, except fast-forwarding `master`.
2. **Take (steps 5–8), only for the commits the user picks:** cherry-pick on a branch, check, report,
   and merge into `main` only after the user approves the result.

The ledger, [fork/upstream-watch.md](../../../fork/upstream-watch.md), records the last upstream
commit reviewed and the decision on each candidate, so nothing is reviewed twice.

## Hard rules

- Never merge `master` (or `upstream/master`) into `main`. Only cherry-pick chosen commits.
- Never commit to `master`; it only fast-forwards to `upstream/master`. Never rebase or force-push.
- Don't cherry-pick anything the user hasn't picked, and don't touch `main` until the user approves
  the result.
- A scheduled or background run with no one to answer stops after the report (step 4).
- Use `corepack pnpm`, not `pnpm`.
- If something unexpected happens (a dirty tree you didn't cause, `master` not fast-forwarding, a
  failing step you can't explain), stop and report it.

## 1. Preflight

```bash
git status --porcelain                  # must be empty
git branch --show-current               # main
git fetch origin main
git rev-list --left-right --count main...origin/main   # behind must be 0, else stop and ask
```

Read the ledger: `LAST` is its "Last reviewed" commit (the first review starts at `upstream-freeze`).

## 2. Fetch and update the mirror

`master` mirrors upstream **locally only**. Never push it to `origin`: it holds upstream's
workflows, and a push would let GitHub run them in the fork (decided 2026-11-19; `origin`'s
`master` was deleted then).

```bash
git sync-master                          # fetch upstream, fast-forward local master; stops if it can't
TIP=$(git rev-parse upstream/master)
git log --oneline --no-merges $LAST..$TIP | wc -l
```

If there are no new commits, say so, update the ledger's "Last checked" date, and stop.

## 3. Filter and triage

Upstream squash-merges each pull request into one commit with a typed, scoped subject
(`fix(tasks): …`, `feat(acpx): …`, `perf(…)`, `test(…)`, `chore(…)`, `docs(…)`), so each commit is a
whole pull request and the right size to cherry-pick.

**Drop automatically**, but count them by reason in the report:

- commits whose files are all in code this setup doesn't use (the dormant areas in
  [hard-fork plan step 3](../../../fork/hard-fork-plan.md#3-leave-unused-code-until-it-gets-in-the-way)
  and, once it exists, the repo map in `fork/`): other adapters (`packages/adapters/*` except
  `claude-local`, and their UI parsers), the Paperclip Runner (`packages/paperclip-runner`,
  `server/src/services/native-runtime`), cloud and sandbox execution, `ui/` only, releases, CI,
  evals, tests only;
- `chore(lockfile)`, release and version bumps.

Check with `git show --stat <sha>` before dropping anything that also touches shared code
(`server/src/routes`, `server/src/services` outside the dormant folders, `packages/shared`,
`packages/db`, `packages/adapters/claude-local`, `packages/adapter-utils`, `skills/`).

**Triage the rest** into:

1. **Security fixes:** always listed first, whatever they touch.
2. **Bug fixes in code we run:** tasks, issues, heartbeat, `claude_local`, approvals, documents,
   routines, auth, MCP, the `paperclip` skill, database.
3. **Features worth having.**
4. **Ideas to port by hand:** worth having, but the code no longer fits `main` (a cherry-pick would
   conflict heavily or depend on dormant code).

For each, read past the subject: `git show --stat <sha>`, and the pull request
(`gh pr view <n> --repo paperclipai/paperclip`). Check whether it would apply to `main` without
touching any tree: `git merge-tree --write-tree --name-only --merge-base=<sha>^ main <sha>` lists
the conflicting files (none means it applies cleanly). Say which in the report. Note migrations (`packages/db/src/migrations`): an upstream migration numbered
past ours needs renumbering when cherry-picked.

Also check [fork/upstream-fixes.md](../../../fork/upstream-fixes.md): an upstream commit that fixes
one of our listed bugs goes in category 2 with the entry number.

## 4. Report and stop

Give the report in chat, in this shape, and add a dated entry to the ledger (the range, the counts,
each candidate with its decision `pending`). Commit the ledger on `main` only if the tree was clean
and the user agrees; otherwise leave it for the take stage.

```markdown
**Upstream since the last review** (<LAST short>..<TIP short>, <first date>–<last date>): <n> commits, <k> dropped by the filter (<counts by reason>)

### Security
- **<subject>** (`<sha>`, #<PR>): what it fixes, in code we run or not. Applies cleanly / conflicts.

### Bug fixes in code we run
- ...

### Features worth having
- ...

### Ideas to port by hand
- ...

### Recommendation
<which to take now, which to port later, which to skip, in a few lines>
```

Then **stop and end the turn.** Ask which to take. Record the user's decisions in the ledger
(taken, skipped, port later).

## 5. Cherry-pick on a branch (after the user picks)

Work in a separate worktree so the main checkout stays on `main`:

```bash
git worktree add -b upstream-watch/$(date +%F) ../paperclip-watch/$(date +%F) main
cd ../paperclip-watch/$(date +%F)
git cherry-pick -x <sha> [<sha> ...]   # oldest first; -x records the upstream commit
```

A fresh worktree needs `corepack pnpm install` and
`corepack pnpm --filter @paperclipai/plugin-sdk build` before the checks.

Resolve conflicts keeping our behaviour and taking upstream's fix. If a resolution needs a judgement
(dropping behaviour on either side, a redesign), stop and ask with options and a recommendation.
If a commit can't be taken cleanly, abort that one (`git cherry-pick --abort`), mark it "port by
hand" in the ledger, and continue with the rest.

For an upstream migration: renumber it after our last migration, update `meta/_journal.json` and
the snapshot the way the drizzle tooling expects, and say so in the report.

## 6. Check

```bash
corepack pnpm install
corepack pnpm typecheck
corepack pnpm --filter @paperclipai/db check:migrations
corepack pnpm --filter @paperclipai/ui-new typecheck
corepack pnpm --filter @paperclipai/ui-new test
corepack pnpm exec vitest run <the test files next to each changed file>
```

Run `corepack pnpm --filter @paperclipai/ui-new test:e2e` if anything under `ui-new/` or an API
`ui-new` uses changed. A failing test in a dormant area is skipped with a note, not fixed
(hard-fork plan step 3).

If a cherry-pick changes what the board sees (a new field, status, route or behaviour), add a line to
[Upstream changes to integrate](../../../ui-new/docs/build-plan.md#upstream-changes-to-integrate) in
the build plan with a proposed outcome, as the sync skill used to.

## 7. Report the result

Update the ledger: "Last reviewed" becomes `TIP`, and each candidate's decision is final (taken with
its new commit, skipped, port later). Commit the ledger on the branch. Then tell the user, in chat:
what was taken, what conflicted and how it was resolved, the checks and their results, and anything
left to port by hand. Remind them that a server change reaches server1 only once the deployment
builds from source (hard-fork step 2).

## 8. Finish (only after the user approves)

In the main checkout:

```bash
git merge --no-ff upstream-watch/<date> -m "Merge upstream fixes from the <date> watch"
git push origin main
git worktree remove ../paperclip-watch/<date>
git branch -d upstream-watch/<date>
```

Then `corepack pnpm install` and `corepack pnpm --filter @paperclipai/plugin-sdk build` in the main
checkout, and restart the dev servers if they're running.

If the user rejects the result, leave the branch for them and don't delete anything.
