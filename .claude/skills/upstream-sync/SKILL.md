---
name: upstream-sync
description: Pull new commits from upstream paperclipai/paperclip into master, merge them into a sync branch off new-ui, resolve the conflicts the fork's policy allows, ask the user about the rest, run the checks and write a sync report. Use when the user asks to sync, pull or merge upstream, or runs /upstream-sync.
---

# Upstream sync

Bring upstream's new commits into the fork without putting `new-ui` at risk. All merge work
happens on a local `sync/<date>` branch, and `new-ui` only moves after the user approves.

Read [FORK.md](../../../FORK.md) and [FORK-PATCHES.md](../../../FORK-PATCHES.md) first. Every
judgement below depends on the patch entries' **Why**, **Depends on** and **If upstream changes
this**.

## Hard rules

- The only push before approval is fast-forwarding `master` to `upstream/master` (`git sync-master`).
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
                                        # ahead is fine: unpushed commits go out with new-ui in step 8
BASE=$(git merge-base new-ui master)    # last upstream commit already in new-ui
```

## 2. Update master

```bash
git sync-master
git log --oneline $BASE..master | wc -l
```

If there are no new commits, say so and stop.

## 3. Analyse the new commits

Work over `$BASE..master`. Collect:

- **Summary by theme.** Group the commits (fixes, performance, features, tests/CI, dependencies)
  and name the commits that matter: new features, behaviour changes, major-version dependency bumps.
- **UI and API changes.** `git diff --stat $BASE..master -- ui/src ':!*.test.*' ':!*.stories.*'`,
  changes in `ui/src/api/`, new server routes, and changes to `packages/shared` outside tests.
- **Migrations.** New files in `packages/db/src/migrations/` and the tables they touch.
- **Fork impact.** For each entry in FORK-PATCHES.md, diff its **Files** and search the upstream
  diff for everything under **Depends on** (`git diff $BASE..master -S'<name>'`, `git grep` on
  `master`). Do this whether or not git reports a conflict: a clean merge can still break a patch.
  Do the same for each object under **Database objects**, against the new migrations.
- **Expected conflicts.** `git merge-tree --write-tree --name-only new-ui master`.

## 4. Merge on a sync branch

```bash
git checkout -b sync/$(date +%F) new-ui      # add -2, -3 if the name exists
git merge master --no-ff --no-commit
```

Resolve each conflict according to the policy below. Keep a note for each one: the file, what each
side wanted, what you did and why.

## 5. Resolution policy

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

## 6. Commit and check

Commit the merge once every conflict is resolved:

```
Merge upstream master (<BASE short>..<master short>) into new-ui

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
- For new routes, requests or flags in the inventory diff, add rows to
  `ui-new/docs/inventory/capabilities.md` in the right area table. Leave **New home** and
  **Status** blank, put `Added by upstream sync <date>` in **Notes**, and list them in the report.
  If a capability needs a new area guide entry, say so in the report instead of writing one.
- If a resolution moved or rewrote a patch, update its FORK-PATCHES.md entry in the same commit.

## 7. Report

Write `fork/sync-reports/<date>.md` and commit it on the sync branch:

```markdown
# Upstream sync <date>

Range: <BASE short>..<master short> (<n> commits). Branch: sync/<date>.

## Needs your decision
<PROVISIONAL resolutions and open questions, or "Nothing.">

## Upstream changes
<summary by theme, with the notable commits>

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

## 8. Finish (only after the user approves)

```bash
git checkout new-ui
git merge --ff-only sync/<date>     # if new-ui moved meanwhile: git merge sync/<date> --no-edit
git push origin new-ui
git branch -d sync/<date>
```

If the user rejects the sync, leave the branch for them and don't delete anything.
