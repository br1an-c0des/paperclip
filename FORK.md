# About this fork

This is a hard fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip) at
[br1an-c0des/paperclip](https://github.com/br1an-c0des/paperclip). It began on 2026-10-14 as a
soft fork that built a new board UI in SolidJS (`ui-new/`) while merging upstream's changes every
few days, without changing upstream's server. On 2026-11-17 it stopped merging upstream and became
its own codebase ([fork/hard-fork-plan.md](fork/hard-fork-plan.md)).

## The freeze

- **Freeze point:** upstream `79c8cf8b6` (tag `upstream-freeze`), merged in the
  [2026-11-17 sync](fork/sync-reports/2026-11-17.md). Everything upstream did up to there is in
  `main`; nothing after it is, unless the upstream watch brings it in.
- **Before the freeze:** 489 upstream migrations plus `0490`, 20 sync reports in
  [fork/sync-reports/](fork/sync-reports/), and the soft fork's rules (no upstream code changes,
  `FORK:` markers, fixes sent upstream). Those rules are retired; the history stays for reference.
- **Upstream pull requests still open from the soft fork:** #17828, #17905 and #20710, on their
  `fix/*` branches (worktrees in `~/coding/paperclip-fixes/`). They're left open. Their code came
  into `main` in hard-fork step 2; the image patches that carried two of them before then are
  retired ([FORK-PATCHES.md](FORK-PATCHES.md)).

## Remotes and branches

| Remote | URL | Use |
| --- | --- | --- |
| `origin` | `br1an-c0des/paperclip` | Ours; push here |
| `upstream` | `paperclipai/paperclip` | Fetch only. Push is disabled, and only `master` is fetched |

| Branch | Rule |
| --- | --- |
| `main` | Our codebase, GitHub's default branch. Feature branches merge into it with `--no-ff`. Don't rebase it. |
| `master` | An exact mirror of `upstream/master`, so the upstream watch can compare. Only fast-forwards (`git sync-master`); never committed to, never merged into `main`. |
| `new-ui` (on origin) | Frozen pointer at the branch point, from before the rename. Don't push to it. |
| `upstream-watch/<date>` | Short-lived: cherry-picks chosen in a watch, merged into `main` after approval. |
| `fix/*` | The three open upstream pull requests above. No new ones. |

Setting up a fresh clone (the alias and remotes live in `.git/config`, so they're per-clone):
[fork/setup-clone.sh](fork/setup-clone.sh).

## The upstream watch

Upstream keeps moving (about 90 commits a day at the freeze). We don't merge it, but we review it:
the `upstream-watch` skill (`/upstream-watch`,
[.claude/skills/upstream-watch/SKILL.md](.claude/skills/upstream-watch/SKILL.md)) lists the
upstream commits since the last review, filters out what only touches code we don't use, triages
the rest (bug fixes in code we run, security fixes, features worth having, ideas to port by hand),
and, once you choose, cherry-picks them on a branch for approval. Its ledger,
[fork/upstream-watch.md](fork/upstream-watch.md), records the last upstream commit reviewed and the
decision on each candidate. Weekly, by hand, to start.

## The new UI

`ui-new/` is a standalone SolidJS + Vite app, and the only board UI: upstream's React UI (`ui/`) was
removed on 2026-11-17. It talks to the server over `/api`, and imports API types from
`@paperclipai/shared` with `import type`, so server type changes show up as type errors. The old
UI's code is still readable at the freeze (`git show upstream-freeze:ui/src/api/...`), and the
[inventory](ui-new/docs/inventory/README.md) catalogues what it did. Paths under `ui/src` below refer
to that copy. Details: [ui-new/README.md](ui-new/README.md).

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
- **The fork already had most of what a plugin would win.** It changed one upstream line, and the
  deploy reuses upstream's image with only the UI swapped. Since the hard fork the question is
  settled anyway: the server is ours to change.

Where plugins do fit:

- **A companion plugin** (`packages/plugins/fork-*`) was the plan for state that belonged to the
  fork before the hard fork. Now such state can go in core tables instead; a plugin is still fine
  for something self-contained.
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

The working instance runs on server1 (details and commands in [deploy/README.md](deploy/README.md)):

- **Image, built from source** (since hard-fork step 2): `deploy/deploy.sh` builds the repo's root
  `Dockerfile` (upstream's, target `production`) into `paperclip-core:<commit>`, and
  `deploy/Dockerfile` builds on that, replacing its UI with a `ui-new` build. Every change on `main`
  reaches server1 at its next deploy. No upstream image and no image patches are involved.
- **Optionally, later:** a GitHub Actions workflow that builds the image and publishes it to
  `ghcr.io/br1an-c0des/paperclip`, so server1 only pulls.
- **Stack:** `deploy/docker-compose.yml` runs Postgres + Paperclip with bind mounts under
  `PAPERCLIP_DATA_ROOT`. Paperclip listens on loopback, behind `tailscale serve`.
- **Before a deploy that adds a migration,** back up the database: migrations don't run backwards.

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

- Optionally, a GitHub Actions workflow that builds the image and publishes it to
  `ghcr.io/br1an-c0des/paperclip`, so server1 only pulls instead of building.
- Agent git push / PR authentication inside the container (see above).
