---
name: upstream-sync
description: Check upstream paperclipai/paperclip for commits new-ui doesn't have yet and outline what they cover (bug fixes, larger features), then, only after the user gives the go-ahead, update master, merge them into a sync branch off new-ui, resolve the conflicts the fork's policy allows, ask the user about the rest, run the checks and write a sync report. Use when the user asks to sync, pull or merge upstream, asks what's new upstream, or runs /upstream-sync.
---

# Upstream sync

Bring upstream's new commits into the fork without putting `new-ui` at risk. The skill runs in two
stages, each gated by the user:

1. **Outline (steps 1–3):** fetch upstream, list the commits `new-ui` doesn't have, outline what they
   cover, and stop. Nothing is pushed, merged or checked out.
2. **Merge (steps 4–10), only after the user says go ahead:** update `master`, merge on a local
   `sync/<date>` branch, check and report. `new-ui` only moves after the user approves the result.

Read [FORK.md](../../../FORK.md) and [FORK-PATCHES.md](../../../FORK-PATCHES.md) first. Every
judgement below depends on the patch entries' **Why**, **Depends on** and **If upstream changes
this**.

## Hard rules

- Before the go-ahead on the outline, only read: `git fetch` is the one command that changes
  anything. Don't run `git sync-master`, create a branch, merge or install.
- The only push before the result is approved is fast-forwarding `master` (`git sync-master`, step 4).
- Never commit to `master`, never rebase, never force-push, never push the sync branch.
- Never touch `new-ui` until the user approves the result.
- Use `corepack pnpm`, not `pnpm`.
- If something unexpected happens (a non-fast-forward on `master`, a dirty tree you didn't cause,
  a failing step you can't explain), stop and report it. Don't work around it.

## 1. Preflight

```bash
git status --porcelain                  # must be empty
git branch --show-current               # switch to new-ui if needed
git fetch origin new-ui
git rev-list --left-right --count new-ui...origin/new-ui   # "<ahead> <behind>": behind must be 0, else stop and ask
                                        # ahead is fine: unpushed commits go out with new-ui in step 10
BASE=$(git merge-base new-ui master)    # last upstream commit already in new-ui
```

## 2. Check the unsynced commits

```bash
git fetch upstream
TIP=$(git rev-parse upstream/master)    # the tip the outline covers; the merge uses this exact commit
git log --oneline --no-merges $BASE..$TIP | wc -l
git log --no-merges --format='%h %ad %s' --date=short $BASE..$TIP
```

If there are no new commits, say so and stop.

Read past the subject lines where they're vague or a commit looks significant:
`git show --stat <sha>` for scope, and the commit body or PR description (`gh pr view <n> --repo
paperclipai/paperclip`) for what it actually does. Use `git diff --stat $BASE..$TIP` to see which
areas (`ui/`, `server/`, `packages/*`, `cli/`, adapters, docs) the range touches.

## 3. Outline and wait for the go-ahead

Give the user the outline in chat, in this shape:

```markdown
**<n> upstream commits not yet in new-ui** (<BASE short>..<TIP short>, <first date>–<last date>)

<two or three sentences: what this batch is mostly about>

### Larger new features
- **<feature>** (`<sha>`, #<PR>): what it does for a board user or agent, where it shows up (page,
  API, CLI), and whether it sits behind an experimental flag.

### Bug fixes
<grouped by area (tasks, agents and runners, chat, workspaces and git, connections, UI, auth, …),
one line per fix or per cluster of related fixes, saying what was broken. Name the commits.>

### Other changes
<one line each for refactors, performance, dependencies (call out major-version bumps), tests/CI and
docs, with counts rather than every commit>

### Merge outlook
<expected conflicts (`git merge-tree --write-tree --name-only new-ui $TIP`), new migrations
(`git diff --name-only --diff-filter=A $BASE..$TIP -- packages/db/src/migrations`), files listed
under a FORK-PATCHES.md entry's **Files** that upstream touched, and features removed or reworked
that a ui-new capability or decision depends on. "Nothing notable" if so.>
```

Count a change as a larger feature when it adds a page, a workflow, an API resource, a connection or
adapter, or changes how an existing feature behaves; small additions go under other changes. Lead
with what matters most for the fork: anything that touches areas `ui-new` redesigns, removals, and
behaviour changes.

Shell variables don't survive between commands or across the wait, so the outline's header must
carry `BASE` and `TIP`; step 4 onwards reuses those exact commits.

Then **stop and end the turn.** Ask whether to go ahead with the merge. Don't start step 4 until the
user explicitly says to. If they ask questions about the commits, answer them and keep waiting. If
the run is scheduled or in the background with no one to answer, stop after the outline; never merge
without the go-ahead.

## 4. Update master (after the go-ahead)

```bash
git status --porcelain                  # still empty
git sync-master
git log --oneline --no-merges $TIP..master | wc -l
```

If upstream landed more commits after the outline (`master` is past `$TIP`), tell the user how many
and outline them briefly, and ask whether to include them or merge only up to `$TIP`. Merge only what
the user agreed to; set `TIP` accordingly.

## 5. Analyse fork impact

Work over `$BASE..$TIP`. The outline already covers the summary by theme; add:

- **UI and API changes.** `git diff --stat $BASE..$TIP -- ui/src ':!*.test.*' ':!*.stories.*'`,
  changes in `ui/src/api/`, new server routes, and changes to `packages/shared` outside tests.
- **Migrations.** New files in `packages/db/src/migrations/` and the tables they touch.
- **Fork impact.** For each entry in FORK-PATCHES.md, diff its **Files** and search the upstream
  diff for everything under **Depends on** (`git diff $BASE..$TIP -S'<name>'`, `git grep` on
  `$TIP`). Do this whether or not git reports a conflict: a clean merge can still break a patch.
  Do the same for each object under **Database objects**, against the new migrations.

## 6. Merge on a sync branch

```bash
git checkout -b sync/$(date +%F) new-ui      # add -2, -3 if the name exists
git merge $TIP --no-ff --no-commit
```

Resolve each conflict according to the policy below. Keep a note for each one: the file, what each
side wanted, what you did and why.

## 7. Resolution policy

**Decide alone:**

- `pnpm-lock.yaml`: `git checkout --theirs pnpm-lock.yaml && corepack pnpm install && git add pnpm-lock.yaml`.
- Conflicts in fork-only files (listed in FORK.md): keep the fork's side and fold in any upstream
  change it needs.
- Conflicts git resolved from an earlier resolution (rerere). Check the result still matches the
  patch entry.
- Conflicts where a patch entry's **If upstream changes this** says what to do and both sides'
  intent survives, such as a hook line that needs re-adding next to code upstream reworded.
- Mechanical follow-ups in fork code caused by upstream renames or type changes (for example,
  `ui-new` type errors from a changed `@paperclipai/shared` type), where the fix is unambiguous.

**Ask the user:**

- Upstream changed or removed something a patch **Depends on**, and keeping the patch means
  redesigning it.
- Upstream changed the schema of a table that a fork database object references.
- Upstream now does something the fork patches in on its own, so the patch might be redundant.
- Any resolution that drops fork behaviour or upstream behaviour.
- A check fails and the fix isn't obvious.
- Anything the policy above doesn't clearly cover.

How to ask: if the session is interactive, use the AskUserQuestion tool. Each question gives the
options (two to four, recommendation first), the files involved, and what upstream changed. Apply
the answer and continue. If no one can answer (a scheduled or background run), apply the
recommended option, mark it **PROVISIONAL** in the report, and leave it for the user to confirm.

## 8. Commit and check

Commit the merge once every conflict is resolved:

```
Merge upstream master (<BASE short>..<TIP short>) into new-ui

<one line per conflict: file, resolution>
```

Then run the checks. Fix and commit what the policy lets you fix; otherwise record it.

```bash
corepack pnpm install
corepack pnpm --filter @paperclipai/ui-new typecheck
corepack pnpm --filter @paperclipai/db check:migrations
corepack pnpm --filter @paperclipai/ui-new inventory
git diff --stat ui-new/docs/inventory/generated
```

- If FORK-PATCHES.md has entries outside `pnpm-workspace.yaml` and `pnpm-lock.yaml`, also run
  `corepack pnpm typecheck` and the vitest files next to each patched file
  (`corepack pnpm exec vitest run <paths>`).
- Commit the regenerated inventory separately: `Regenerate UI inventory after upstream sync`.
- For new routes, requests or flags in the inventory diff, find the capability they belong to:
  - **An existing capability** (the new request serves a page or feature already in the
    checklist): add the request, and a few words on what it does, to that capability's entry in
    `ui-new/docs/inventory/areas/`, and note the change in the **Notes** of its row in
    `ui-new/docs/inventory/capabilities.md` (`Upstream sync <date>: <what changed>`).
  - **A new capability:** add a row to `capabilities.md` in the right area table. Leave
    **New home** and **Status** blank and put `Added by upstream sync <date>` in **Notes**. Don't
    write its area guide entry; say in the report that one is needed.
  - **A new or removed flag** in `generated/flags.md`: propose its outcome (built in, dropped, or
    follows the instance setting) by the rules in decision 12 of `ui-new/docs/decisions.md`, and
    list it in the report for the user to confirm. Add it to that entry only once confirmed.

  List them all in the report.
- If a resolution moved or rewrote a patch, update its FORK-PATCHES.md entry in the same commit.

## 9. Report

Write `fork/sync-reports/<date>.md` and commit it on the sync branch:

```markdown
# Upstream sync <date>

Range: <BASE short>..<TIP short> (<n> commits). Branch: sync/<date>.

## Needs your decision
<PROVISIONAL resolutions and open questions, or "Nothing.">

## Upstream changes
<the outline from step 3: larger features, bug fixes, other changes>

## Fork impact
<per patch entry and database object: unaffected / affected and how>

## Conflicts and resolutions
<file: what each side wanted, what was done, why>

## Checks
<each check: passed / failed, with the relevant output>

## Inventory and capabilities
<new or changed routes, requests and flags; rows added to the checklist>
```

Then give the user a short summary in chat and the path to the report.

## 10. Finish (only after the user approves the result)

```bash
git checkout new-ui
git merge --ff-only sync/<date>     # if new-ui moved meanwhile: git merge sync/<date> --no-edit
git push origin new-ui
git branch -d sync/<date>
```

If the user rejects the sync, leave the branch for them and don't delete anything.
