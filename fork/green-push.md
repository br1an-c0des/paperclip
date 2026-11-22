# Pushing green

How to push so the CI run comes back green: the checks to run before a push, which extra tests a
given change needs, and what to do when a run fails anyway. The reasons behind each step are in
[ci-review-2026-11-21.md](ci-review-2026-11-21.md).

CI runs the thorough tier and the whole-workspace typecheck on every push
([.github/workflows/test.yml](../.github/workflows/test.yml)). You can't run the thorough tier on
every push locally (~21 min), so the aim is to run the cheap checks that catch what CI would.

## Before every push

Run these two from the repo root, or let the pre-push hook run them for you (below). Together they
take about 5 minutes.

```bash
corepack pnpm typecheck
```

```bash
corepack pnpm test:quick
```

1. **Typecheck the whole workspace, not one package.** A change to a shared type has to compile in
   every package that builds it, the dormant ones included. A plugin's test fixture broke a run
   this way.
2. **`test:quick`** runs the tests your change touches, by name and import. Unless the change is
   only Markdown, it also runs the whole-app checks listed under `alwaysQuick` in
   `scripts/test-tiers.json` (~40 s): OpenAPI route coverage, the issue-detail golden file, and the
   route access scan. Name and import rules never select them, and they caused two of the three
   red runs a local check could have caught. A new test that checks the whole app belongs in that
   list.

**The pre-push hook** runs both on every push. Turn it on once per clone:

```bash
corepack pnpm hooks:install
```

- **What it checks:** the commits being pushed, so pushing `main` after a merge tests the merged
  range. A push that changes only Markdown skips both checks.
- **It covers every worktree:** the setting lives in `.git/config`, which all worktrees share, so
  agents' pushes are checked too. A worktree without `node_modules` gets a blocked push telling it
  to install first.
- **What it can't check:** the checks run on the working tree. A pushed commit that isn't checked
  out (`git push origin other-branch`) is let through with a warning, and uncommitted changes are
  tested along with the commit.
- **Bypass:** `git push --no-verify`, or `PAPERCLIP_SKIP_PREPUSH=1 git push`, when you have a reason.

## When the change touches…

| You changed | Also run or do |
| --- | --- |
| A route (added, removed, renamed a path) | Describe it in `server/src/routes/openapi.ts`. `openapi-routes` fails on any route the spec doesn't list. |
| A field on an entity (`packages/shared/src/types`, `packages/db/src/schema`) | `issue-detail-statements` compares the issue response to `server/src/__tests__/fixtures/issue-detail-response.json`. Regenerate it with `PAPERCLIP_WRITE_ISSUE_DETAIL_GOLDEN=1`, read the diff, and commit it. The workspace typecheck finds fixtures that build the type. |
| A migration | The db package's tests: `ls packages/db/src/*.test.ts > /tmp/db-tests.txt && node scripts/test.mjs --files /tmp/db-tests.txt`. The deploy rehearses the migration on a copy of server1's database too, but by then it's already on `main`. |
| `ui-new` | `corepack pnpm --filter @paperclipai/ui-new typecheck` and `test`. If you changed a page, also `test:e2e` (mocked, no server); CI's ui-new job runs it too, with `vite build`. |
| Test infrastructure (`scripts/test.mjs`, `scripts/test-tiers.json`, vitest configs) | `corepack pnpm test:runner`, and `node scripts/test.mjs --dry-run --tier thorough --shard 1/10` to check every file still lands in exactly one shard. |
| Shared code that dormant areas use | The opt-in files concerned (`corepack pnpm test:optin`, or a `--files` list). Push runs don't include them; the weekly opt-in run does, after the fact. |
| A `Dockerfile`, `deploy/`, a `package.json` or the lockfile | Nothing extra: CI builds the Docker images for such a push, which adds about 11 minutes to its run. |
| Only Markdown | Nothing. CI still runs, and that's fine. |

## New or changed tests

- **Make sure a new test fails without your change**, then passes with it.
- **Run any test that waits or uses timers several times**, and under load, before pushing. In CI a
  shard runs on 2 workers on slow cores, so a test that passes once on the desktop isn't proven:

  ```bash
  for i in 1 2 3 4 5; do node scripts/test.mjs --files /tmp/my-test.txt --workers 2 || break; done
  ```

- **Clean up what the test starts.** Every past flake here was a background heartbeat run that
  outlived its test file. Await in-flight runs in `afterEach` before tearing down the database. A
  file that leaves module state behind goes in `ISOLATED_BY_NAME` in `server/vitest.config.ts`.
- **No new retries or skips to get green.** A skip needs a note saying why (the dormant-area rule in
  `CLAUDE.md`).

## Branches and merges

- **Merge `main` into the branch before its last push** when `main` has moved. CI tests the branch
  head. The merge into `main` creates a new tree, and that tree is only tested after you've pushed
  it.
- **Merge into `main` only after the branch's latest push is green**, then push `main`. Its run
  should be the same tree passing again.

## When a run fails anyway

1. **Read the failure first.** The run's page shows a summary per shard: each failed test's file,
   name and assertion. The full output is in the log:

   ```bash
   gh run view <id> -R br1an-c0des/paperclip --log-failed
   ```

2. **Decide whether your change caused it.** If your change touches the code under test, or the
   test fails the same way locally, it's real. Fix it on the branch, not on `main`.
3. **If it's a flake, write it down before re-running.** Add the test, run ID, shard and assertion
   to [upstream-fixes.md](upstream-fixes.md) (a new bug, or a line on an existing one), then
   re-run the failed job. A re-run that passes overwrites the red result, so the bug list is the
   only record that the test flaked.
4. **A test that flakes twice gets fixed before more work goes on top of it.**

To see every re-run and red run of the last two weeks, with the tests that failed:

```bash
node scripts/ci-flakes.mjs --since 2026-11-19
```

## Now and then

- **The weekly opt-in run** (`Opt-in tier (weekly)` in Actions, Mondays) shows how far the dormant
  code has drifted. Read it before waking a dormant area up; don't fix it for its own sake.
- **Shard weights:** when the shards' times spread out (in the run's job list), refresh them from a
  few recent green runs, `node scripts/refresh-shard-weights.mjs --run <id> --run <id>`, and commit
  `scripts/test-weights.json`.

## Deploying

`deploy/deploy.sh` deploys only a commit with a green run. Use `--wait-ci` after a push, and keep
`--skip-ci` for emergencies.
