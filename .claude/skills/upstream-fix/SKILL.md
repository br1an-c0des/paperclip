---
name: upstream-fix
description: Build one small, signed-off fix for upstream paperclipai/paperclip on its own fix/* or docs/* branch off master, following upstream's CONTRIBUTING.md, PR template and review rules, with a strict testing budget, and stop with a PR description draft before anything is pushed. Use when the user approves building an entry from fork/upstream-fixes.md, asks to fix an upstream bug or send a fix upstream, or runs /upstream-fix.
---

# Upstream fix

Build one small fix for `paperclipai/paperclip` as a pull request, never as a fork patch. The skill
ends with a committed branch and a PR description draft. Pushing and opening the pull request wait
for the user.

## Before you start

- **The fix must be in [fork/upstream-fixes.md](../../../fork/upstream-fixes.md)** with a section
  describing the problem. Newly found bugs go there as `candidate` first.
- **The user must have signed off on building this specific fix.** A candidate in the list is not
  approval. If there's no sign-off in the conversation, stop and ask.
- **Bugs, docs and small targeted fixes only.** A feature, or anything that changes behaviour other
  users rely on, needs agreement in upstream's Discord `#dev` channel first (CONTRIBUTING.md,
  "Path 2"). Keep it in the build plan's stage 2b and stop.

## 1. Search for duplicates

Search upstream's open and closed pull requests and issues with `gh`, using several wordings,
for example:

```bash
gh pr list --repo paperclipai/paperclip --state all --search "<words>"
gh issue list --repo paperclipai/paperclip --state all --search "<words>"
```

Also check that `upstream/master` still has the bug. If a pull request already covers it, stop and
report it, so the user can decide whether to help that one instead. Link related issues and pull
requests in the description.

## 2. Set up the worktree

Work in a worktree under `C:\Users\brian\coding\paperclip-fixes\`, never in the main checkout:

```bash
git fetch upstream master:master      # fast-forwards master without checking it out
git worktree add C:/Users/brian/coding/paperclip-fixes/<slug> -b fix/<short-description> master
```

- `git sync-master` also pushes `origin/master` and needs `master` checked out in the main
  checkout. Don't use it from here; the next upstream sync pushes `origin/master`.
- Name the branch after the change (`fix/…`, `docs/…`), with no internal task IDs.
- Install with `corepack pnpm install`. If it changes `pnpm-lock.yaml`, restore it
  (`git checkout pnpm-lock.yaml`); the lockfile is never part of the fix.
- Server tests need the plugin SDK built first (its `ensure-build-deps` and `build` scripts).

## 3. Read upstream's rules

In the worktree, read these before writing code. They change, so read them each time:

- `CONTRIBUTING.md`: one logical change, the fewest possible files, no code comments, no PR that
  takes a file from under 1,000 lines to over 1,000, public references only, Simplified Technical
  English for PR text.
- `.github/PULL_REQUEST_TEMPLATE.md` and the matching `.github/ISSUE_TEMPLATE/*.yml` (for a bug
  with no issue, the description repeats the bug report's bold labels with real content under each).
- `AGENTS.md`, sections 7 (verification) and 10 (PR requirements).
- Every `rules/*.mdc` whose `globs` match the files you touch, plus the ones with
  `alwaysApply: true`. These are what Greptile reviews against.

## 4. Make the change

- Write the test first, in the existing test file closest to the code, and see it fail.
- Make the smallest change that passes it. Keep the behaviour with the module that owns it.
- Commit with a Conventional Commits subject (`fix(<area>): …`) and a body saying what was wrong
  and what changed. Upstream accepts the `Co-Authored-By: Claude …` trailer.

## 5. Test within a budget

A small fix needs a small amount of testing. Upstream's CI runs the full suite on every pull
request; local runs only need to prove the change. On Oct 26, 2026 an agent ran every server test
file that imports the changed module, about 70 to 100 files, several times. It took over 90
minutes, and the last run hung on an integration test. Don't repeat that.

**Run only:**

1. The test file you changed, with the fix: it must pass.
2. The same file without the fix (`git stash` the source change): the new tests must fail. This is
   what proves the fix.
3. Tests that directly exercise the functions you changed, named individually: at most about five
   more files.
4. `tsc --noEmit` in the package you changed, for example
   `corepack pnpm --filter @paperclipai/server exec tsc --noEmit`.

**Don't:**

- Run the full suite, `pnpm -r typecheck`, `pnpm test:run` or `pnpm build` locally. Leave them to
  CI, and say so in the description.
- Sweep test files with grep ("every file that imports X") to choose what to run.
- Run more than ten test files in total without asking the user first.
- Rerun the same command unchanged. Rerun only after changing something, or once, without the fix,
  to show a failure isn't caused by it.

**Every test command gets a time limit:** wrap it in `timeout 15m` (Git Bash) or run it in the
background and check on it. If a run prints nothing new for 10 minutes, it has hung:

- kill its process tree (`taskkill //PID <pid> //T //F`);
- kill any embedded Postgres it started (data folders under `%TEMP%\paperclip-*`);
- never kill the long-running Postgres on port 54329 (`~\.paperclip-test\instances\default\db`) or
  one from another worktree;
- record the hang in the report, and don't start the run again.

**Known Windows problems, not caused by your fix:**

| Problem | What to do |
| --- | --- |
| `pnpm --filter @paperclipai/server typecheck` stops in `prepare:runner-vendor` with `ERR_UNSUPPORTED_ESM_URL_SCHEME` | Run `tsc --noEmit` through `exec` instead |
| `server-startup-feedback-export`, `external-chat-wait.integration` and `workspace-recovery` tests fail | They fail the same way on `master`. Don't run them unless the fix touches them |
| `muse-control` tests are flaky | Same |
| `pnpm install` fails with `EPERM` in `link-plugin-dev-sdk.mjs` without Developer Mode | Use `--ignore-scripts` (upstream fix 4 in the tracker) |

Add to this table when you find another one.

## 6. Check the change against the rules

Go through each item and fix what fails:

- [ ] One logical change, in as few files as possible.
- [ ] No code comments added (`git diff master | grep -nE '^\+\s*(//|/\*|\*)'`).
- [ ] No file grows from under 1,000 lines to over 1,000 (compare `git show master:<file> | wc -l`
      with `wc -l <file>`).
- [ ] The matching `rules/*.mdc` are satisfied: ownership (`module-boundaries`), cost of new calls on
      request or startup paths (`runtime-dependency-boundaries`), no new polling
      (`sleep-aware-background-work`).
- [ ] No internal references: no instance task IDs, no `localhost` or tailnet links, no fork paths.

## 7. Draft the pull request description

Write `PR_DESCRIPTION.md` in the worktree root. It stays untracked. Use the PR template's sections in
order: Thinking Path, Linked Issues or Issue Description, What Changed, Verification, Risks, Model
Used, Checklist.

- **Short sentences in the active voice** (Simplified Technical English).
- **Verification:**
  - the exact commands, the result with the fix, and the result without it;
  - the main assumption the design relies on, and the evidence that checks it;
  - what you didn't run (full suite, build) and why;
  - any failures you saw in other tests, and how you know they aren't caused by the fix.
- **Risks:** behaviour changes, cost, and the limits of the fix.
- **Model Used:** the provider, the exact model ID and its capabilities.
- **Checklist:**
  - Tick only what is true. If no documentation applies, say so under Verification.
  - Leave "All Paperclip CI gates are green", "Greptile is 5/5" and "I will address all … comments"
    unticked until they are true.
- **End with** `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## 8. Stop and report

Don't push, and don't open the pull request. Report:

- the duplicate search;
- the worktree, the branch and the commit;
- the files changed, and why the change lives there;
- each test command and its result, with and without the fix, including any run you stopped;
- the path to `PR_DESCRIPTION.md`;
- anything a reviewer should know.

The project manager or the user then moves the fix to `ready` in the tracker.

## 9. After the user approves

```bash
git push -u origin fix/<short-description>
gh pr create --repo paperclipai/paperclip --base master --head br1an-c0des:fix/<short-description> --title "<title>" --body-file PR_DESCRIPTION.md
```

- Record the pull request, its number and the date in the tracker, with status `submitted`.
- Watch CI and Greptile. A merge needs green CI and a 5/5 Greptile score with no open comments.
  Fix what they find in new commits on the same branch, or reply when a comment is wrong.
- When upstream merges it, set the status to `merged`, and note any fork workaround that can now be
  removed. The fix reaches `new-ui` through the next upstream sync; never merge a fix branch into
  `new-ui`.
