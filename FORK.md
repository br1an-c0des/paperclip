# About this fork

This is a fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip) at
[br1an-c0des/paperclip](https://github.com/br1an-c0des/paperclip). Its purpose is to build a new
board UI in SolidJS (`ui-new/`) while continuing to take upstream's daily changes.

**The fork is UI-only.** Apart from registering `ui-new` in the pnpm workspace, it doesn't change
server, database or package code. Upstream lands many commits a day, and the server areas the
redesign touches are still changing, so `ui-new` works with the API as it is. Small server or
documentation fixes found along the way go upstream as focused pull requests (see
[Contributing fixes upstream](#contributing-fixes-upstream)), not into the fork.

The rule behind every decision below: **keep changes in files upstream doesn't own wherever
possible, and record every exception.** New files never conflict with upstream, so merges stay
easy. Each change to an upstream file is recorded in [FORK-PATCHES.md](FORK-PATCHES.md), so a merge
can check what upstream changed against what the fork depends on.

### Fork-only files

| Fork-only files | Purpose |
| --- | --- |
| `FORK.md` | This plan |
| `FORK-PATCHES.md` | Every change the fork makes to upstream files, and why |
| `CLAUDE.md` | Instructions for Claude Code in this fork |
| `ui-new/` | The SolidJS UI ([ui-new/README.md](ui-new/README.md)) |
| `deploy/` | Production deployment ([deploy/README.md](deploy/README.md)) |
| `fork/` | Fork records, such as upstream sync reports and the upstream fixes list |
| `.claude/skills/upstream-sync/` | The upstream sync skill |
| `.claude/skills/upstream-fix/` | The skill for building a small fix to send upstream |
| `packages/plugins/fork-*/` | Plugins the fork adds (see below). Already in the pnpm workspace through `packages/plugins/*`. |

The upstream files the fork edits are listed in [FORK-PATCHES.md](FORK-PATCHES.md). So far that is
`pnpm-workspace.yaml` (one line, `- ui-new`), plus the `pnpm-lock.yaml` entries that line causes.

## Remotes and branches

| Remote | URL | Use |
| --- | --- | --- |
| `origin` | `br1an-c0des/paperclip` | Your fork; push here |
| `upstream` | `paperclipai/paperclip` | Fetch only. Push is disabled, and only `master` is fetched |

| Branch | Rule |
| --- | --- |
| `master` | An exact mirror of `upstream/master`. Never commit here; it only fast-forwards. |
| `new-ui` | All fork work. Upstream changes come in by merging `master`. |
| `sync/<date>` | Short-lived, local. The `upstream-sync` skill merges `master` here first; `new-ui` fast-forwards to it once you approve. |
| `fix/*`, `docs/*` | Pull requests to upstream. Branched from `master`, never merged into `new-ui` (see [Contributing fixes upstream](#contributing-fixes-upstream)). |

Setting this up in a fresh clone (the git aliases and rerere live in `.git/config`, so they are
per-clone):

```bash
git clone https://github.com/br1an-c0des/paperclip.git && cd paperclip
git remote add upstream https://github.com/paperclipai/paperclip
git remote set-url --push upstream DISABLE
git config remote.upstream.fetch '+refs/heads/master:refs/remotes/upstream/master'
git config rerere.enabled true
git config rerere.autoupdate true
git config alias.sync-master '!f() { set -e; cur=$(git branch --show-current); git fetch upstream; git checkout -q master; git merge --ff-only upstream/master; git push origin master; git checkout -q "$cur"; echo "master now at $(git rev-parse --short master); you are on $cur"; }; f'
git config alias.sync-ui '!f() { set -e; git sync-master; git checkout new-ui; git merge master --no-edit; echo "Merged master into new-ui. Run tests, then: git push"; }; f'
```

## Changing server, database and packages

The fork plans no server, database or package changes. When a UI feature seems to need one, first
look for a way to build it on the existing API, then consider proposing the change upstream. The
options below are kept for a change that turns out to be unavoidable; agree on it before starting.
If one is needed, pick the first option that works:

1. **A plugin.** Paperclip's plugin system ([doc/plugins/PLUGIN_AUTHORING_GUIDE.md](doc/plugins/PLUGIN_AUTHORING_GUIDE.md))
   gives a plugin its own Postgres schema with its own migrations, JSON API routes under
   `/api/plugins/:pluginId/api/*`, event subscriptions, scheduled jobs, and read access to core
   tables on an allowed list. `ui-new` can call plugin routes like any other API. A plugin can't
   alter core tables or claim core API paths. Plugins never conflict with upstream.
2. **New files plus a small hook.** Put the logic in new files (new routes, services, schema
   files) and keep the edit to upstream files to a line or two that wires them in, such as
   registering a router. Mark each hook with a `FORK:` comment and add an entry to
   [FORK-PATCHES.md](FORK-PATCHES.md).
3. **Editing upstream logic directly.** Last resort, for when a hook can't do it. Same marking and
   entry, and the entry says why a hook wasn't enough. Expect these to need attention on syncs.

`@paperclipai/shared` is upstream-owned too. Put fork-only types in fork files rather than adding
them to `packages/shared`.

### Database changes

Upstream numbers its migrations in one sequence (`packages/db/src/migrations/NNNN_*.sql`, tracked
in `meta/_journal.json`) and adds new ones most days. **Don't add fork migrations to that
sequence:** the next upstream migration would take the same number, and renumbering a migration
that a database has already applied breaks that database.

- Prefer a plugin's own schema and migrations (option 1 above).
- If core code needs fork tables, keep them on a separate migration track: their own folder and
  tracking table, applied after upstream's. The mechanism isn't built, and isn't planned while
  the fork is UI-only. If it's ever needed, record it in [FORK-PATCHES.md](FORK-PATCHES.md).
- Prefer side tables that reference upstream tables over altering upstream tables. A fork column
  on an upstream table conflicts with every upstream change to that table.
- List every fork database object under **Database objects** in [FORK-PATCHES.md](FORK-PATCHES.md).

## Contributing fixes upstream

Small server or documentation fixes found while building the UI go to `paperclipai/paperclip` as
pull requests instead of fork patches. Once upstream merges one, it reaches the fork through the
normal sync.

Build each one with the `upstream-fix` skill (`/upstream-fix`,
[.claude/skills/upstream-fix/SKILL.md](.claude/skills/upstream-fix/SKILL.md)), once the user has
signed off on that fix. The skill covers the duplicate search, upstream's rules, a testing budget
(the targeted test with and without the fix, plus `tsc`; the full suite is left to CI), and the PR
description, and it stops before anything is pushed. The commands below are the outline.

```bash
git sync-master                                  # start from an up-to-date master
git checkout -b fix/<short-description> master
# make the change, with tests
git push -u origin fix/<short-description>
gh pr create --repo paperclipai/paperclip --base master --head br1an-c0des:fix/<short-description>
```

- **Branch from `master`, never from `new-ui`,** so the pull request contains only the fix. Don't
  merge these branches into `new-ui`.
- **Follow upstream's rules for contributors:** [CONTRIBUTING.md](CONTRIBUTING.md) (one logical
  change in as few files as possible, and a search for duplicate pull requests first) and the PR
  template rules in [AGENTS.md](AGENTS.md). Feature changes need agreement in upstream's Discord
  `#dev` channel before any code is written.
- **Name branches after the change** (`fix/…`, `docs/…`), with no internal task IDs.
- **Track each fix in [fork/upstream-fixes.md](fork/upstream-fixes.md)** from the moment it's
  found until it's merged: add it as a candidate, then record its branch, pull request and dates.
  Ideas that still need agreement upstream stay in the proposal that found them, for example
  [ui-new/docs/proposals/unifying-requests.md](ui-new/docs/proposals/unifying-requests.md#small-upstream-contributions).

## Staying in sync with upstream

Upstream lands about 25 commits a day, and about a third of them touch `ui/`. Sync often (daily
or every few days); small merges are much easier than large ones.

### With the sync skill (normal route)

In Claude Code, run `/upstream-sync`. The skill
([.claude/skills/upstream-sync/SKILL.md](.claude/skills/upstream-sync/SKILL.md)):

1. Fetches upstream and outlines the commits `new-ui` doesn't have yet: the larger new features,
   the bug fixes by area, other changes, and what to expect from the merge. Then it stops and
   waits; nothing is pushed or merged until you give the go-ahead.
2. Updates `master` from upstream, pushes it to origin, and checks the new commits against
   [FORK-PATCHES.md](FORK-PATCHES.md).
3. Merges them into a new local `sync/<date>` branch, resolving the conflicts its policy lets
   it decide alone.
4. Asks you about anything else, giving its options and a recommendation.
5. Runs the checks: install, typechecks, tests near fork patches, the migration check, and the
   inventory.
6. Writes a report to `fork/sync-reports/<date>.md`.

`new-ui` isn't touched until you approve. Then the skill fast-forwards `new-ui` to the sync branch
and pushes it.

### By hand

```bash
git sync-ui            # updates master from upstream, then merges it into new-ui
corepack pnpm install  # upstream changes dependencies often
corepack pnpm --filter @paperclipai/ui-new typecheck   # catches API type changes from @paperclipai/shared
corepack pnpm --filter @paperclipai/ui-new inventory   # regenerate the existing-UI inventory
git diff ui-new/docs/inventory/generated      # new or changed routes, requests and flags upstream added
git push
```

When the inventory diff shows new capabilities, add them to `ui-new/docs/inventory/capabilities.md`
(see [ui-new/docs/inventory/README.md](ui-new/docs/inventory/README.md)). Once the fork patches
server code, also check upstream's changes against [FORK-PATCHES.md](FORK-PATCHES.md) and run the
tests around each patch.

### Rules

- **Merge, don't rebase.** `new-ui` is long-lived and pushed. Rebasing it would replay hundreds of
  upstream commits and rewrite pushed history.
- **rerere is on**, so git reapplies a conflict resolution you've done before.
- **`pnpm-lock.yaml` conflicts:** don't hand-edit. Take master's version and regenerate it:
  ```bash
  git checkout --theirs pnpm-lock.yaml && pnpm install && git add pnpm-lock.yaml
  ```
- `pnpm` isn't installed globally on the dev Mac. Use `corepack pnpm`, or run `corepack enable`
  once.

## The new UI

`ui-new/` is a standalone SolidJS + Vite app beside the React UI in `ui/`. It talks to the server
over the same `/api`, and imports API types from `@paperclipai/shared` with `import type`, so
upstream type changes show up as type errors after a merge. Use `ui/src` (especially
`ui/src/api/`) as the reference for how the API is used. Details:
[ui-new/README.md](ui-new/README.md).

### A standalone app, not a plugin

Paperclip's plugin SDK can add UI too: [paperclip-office](https://github.com/Kshitijm7/paperclip-office)
is a full page built that way. In October 2026 we looked at building `ui-new` as a plugin instead and
decided against it:

- **A plugin adds to the old UI; it can't replace it.** Plugin pages mount at
  `/:companyPrefix/<slug>/*` inside the old app's layout, sidebar and breadcrumbs
  (`ui/src/pages/PluginPage.tsx`). A plugin can't own `/`, sign-in, onboarding, settings or company
  switching, or remove old pages and experimental flags, and replacing those is what the redesign
  is for.
- **Plugin UI is React that shares the old UI's page.** The old UI lends plugins its own React
  through a global and loads each plugin as one ES module from a blob URL
  (`ui/src/plugins/slots.tsx`). There's no code splitting, relative assets don't resolve, and the
  old UI's global CSS applies. Solid would only fit through the custom-element fallback, without the
  SDK's hooks.
- **The plugin worker can read only part of the API.** It has no attention feed, Decisions, budgets
  or runs. Plugins work around that with per-issue scans or `SELECT`s on allowed core tables, which
  ties them to the database layout. Calling `/api` straight from plugin UI works today, but the spec
  says plugins must not (`doc/plugins/PLUGIN_SPEC.md`, §19.0.2).
- **The fork already has most of what a plugin would win.** It changes one upstream line, and the
  deploy reuses upstream's image with only the UI swapped. What's left is installing on a stock
  Paperclip with no custom image, which would matter only if pieces of the redesign were meant for
  other Paperclip users.

Where plugins do fit:

- **A companion plugin** (`packages/plugins/fork-*`) for state that belongs to the fork, such as
  saved views, per-user triage state or agent tools. `ui-new` calls its routes under
  `/api/plugins/:pluginId/api/*`. This is option 1 in
  [Changing server, database and packages](#changing-server-database-and-packages). Don't use it to
  combine core data; `ui-new` does that from the API.
- **A demo of one idea on stock Paperclip**, such as the "Needs you" page from the
  [requests proposal](ui-new/docs/proposals/unifying-requests.md), written as a React plugin page to
  share in upstream's Discord. Optional.
- **Hosting other plugins in `ui-new`.** Once `ui-new` replaces the old UI in production, installed
  plugins (paperclip-office included) appear only if `ui-new` provides their mount points. That
  means the global React registry the old UI sets up (`ui/src/plugins/bridge-init.ts`), the module
  loader and slots, React loaded only for plugin areas, and the shared components the SDK promises
  (`IssuesList`, `AssigneePicker` and others, which wrap old-UI components today). Tracked as
  `shell/plugins` in the [capability checklist](ui-new/docs/inventory/capabilities.md).

## Production deployment

Summary (full steps in [deploy/README.md](deploy/README.md)):

- **Image:** `deploy/Dockerfile` starts from upstream's published image for the upstream commit
  last merged into `new-ui` (`ghcr.io/paperclipai/paperclip:sha-<commit>`), and replaces its UI
  with a `ui-new` build. The server, Rust runner and agent CLIs are exactly upstream's, and nothing
  heavy is rebuilt. `deploy/deploy.sh` picks the base commit automatically.
- **No server changes needed:** the server serves whatever is in `ui/dist`.
- **Stack:** `deploy/docker-compose.yml` runs Postgres + Paperclip with bind mounts under
  `PAPERCLIP_DATA_ROOT` (default `/srv/paperclip`). Paperclip listens on loopback; put
  `tailscale serve` (private) or Caddy (public, with HTTPS) in front.

### Where agents' repos live

Agents run inside the container and work in `PAPERCLIP_HOME` (`/paperclip`), which is
bind-mounted from `<PAPERCLIP_DATA_ROOT>/home`. Everything is visible on the host:

```
<PAPERCLIP_DATA_ROOT>/home/instances/default/
├── projects/<company>/<project>/<repo>/     repos Paperclip clones (git_repo projects)
│   └── .paperclip/worktrees/<branch>/       per-task git worktrees
├── workspaces/<agentId>/                     agent scratch space when no project is set
├── data/  logs/  secrets/master.key          uploads, run logs, secrets encryption key
```

- Projects with `sourceType: git_repo` are cloned by Paperclip. `local_path` projects must point
  at a path that exists inside the container, so add another bind mount for those.
- Private GitHub repos: Paperclip uses a company secret named `GITHUB_TOKEN` (or `GH_TOKEN` /
  `PAPERCLIP_GITHUB_TOKEN`), falling back to the server's `GITHUB_TOKEN` env var. The token goes
  to git through a credential helper limited to `https://github.com`, never onto disk.
- Not yet checked: how agents themselves push branches or open PRs from inside the container (the
  `gh` CLI is in the image, but how it's authenticated hasn't been looked at).

## Open items

- Once the sync skill has run by hand a few times, consider scheduling it.
- Test the full image build and a first deploy on a real server.
- Optionally, a GitHub Actions workflow in this fork that builds the image on pushes to `new-ui`
  and publishes it to `ghcr.io/br1an-c0des/paperclip`, so the server only pulls. Keep upstream's
  own workflows disabled in the fork (GitHub disables them on forks by default).
- Agent git push / PR authentication inside the container (see above).
- Decide how `ui-new` hosts plugin UI before it replaces the old UI in production (see
  [A standalone app, not a plugin](#a-standalone-app-not-a-plugin)).
