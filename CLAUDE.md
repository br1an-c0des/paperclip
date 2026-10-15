# CLAUDE.md

This is a personal fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip)
(`br1an-c0des/paperclip`). Its purpose is to build a **new board UI in SolidJS** (`ui-new/`) that
regroups the existing UI into a more coherent, single interface, while continuing to merge upstream's
daily changes. Some of the fork's features will also need server and database changes.

## Intentions

- **Redesign the core work areas.** Tasks, projects, agents, goals, routines, approvals/decisions,
  artifacts and cases may be merged or reorganized into fewer, clearer pages.
- **Port the rest mostly as-is.** Settings, secrets, plugins, skills, apps and activity keep their
  current structure.
- **Remove the switches.** The current UI hides and shows features behind about 40 experimental flags.
  The new UI should settle on one refined interface instead of toggles.
- **Lose no functionality by accident.** Every capability of the old UI is catalogued; anything left out
  is dropped on purpose.
- **Stay mergeable.** Server, database and package changes are allowed, but they're shaped so that
  upstream merges stay easy, and every change to an upstream file is recorded.

## Ground rules

- **Prefer fork-only files** (listed in [FORK.md](FORK.md#fork-only-files)). For server, database or
  package changes, choose in this order: a plugin in `packages/plugins/fork-<name>/`, then new files
  plus a small hook line in an upstream file, then editing upstream logic directly. Details:
  [FORK.md](FORK.md#changing-server-database-and-packages).
- **Record every upstream edit.** Mark it with a `FORK: <entry id>` comment and add or update its
  entry in [FORK-PATCHES.md](FORK-PATCHES.md) in the same commit. Never edit `ui/`: the old UI is the
  reference, and `ui-new` replaces it.
- **No fork migrations in upstream's numbered sequence** (`packages/db/src/migrations`). Use a
  plugin's schema or the fork's separate migration track. See
  [FORK.md](FORK.md#database-changes).
- **Branches:** work on `new-ui`. `master` mirrors upstream and is never committed to. Merge `master` into
  `new-ui`; don't rebase.
- **`ui-new` talks to the existing API** (`/api`, proxied to the server on :3100) and imports types from
  `@paperclipai/shared` with `import type`. Use `ui/src` as the reference for how the API is used.
- `pnpm` isn't installed globally on this machine; use `corepack pnpm`.
- For upstream conventions (repo map, dev setup, API rules), see `AGENTS.md`. Its PR-template and
  Paperclip-issue workflow rules are for upstream contributions, not this fork.

## Documentation

| Doc | What it covers |
| --- | --- |
| [FORK.md](FORK.md) | Remotes, branches, how to change server and database code, the upstream sync routine, deployment summary, open items. |
| [FORK-PATCHES.md](FORK-PATCHES.md) | Every change the fork makes to upstream files: what, why, what it depends on, how to resolve conflicts. |
| [.claude/skills/upstream-sync/SKILL.md](.claude/skills/upstream-sync/SKILL.md) | The upstream sync procedure and conflict-resolution policy. Reports go to `fork/sync-reports/`. |
| [ui-new/README.md](ui-new/README.md) | Running and building the SolidJS app; layout; lockfile-conflict fix. |
| [deploy/README.md](deploy/README.md) | Production deployment: Docker image on top of upstream's, Compose with bind mounts, Tailscale or Caddy. |
| [ui-new/docs/inventory/README.md](ui-new/docs/inventory/README.md) | How the existing UI is documented, and the redesign tiers. |
| [ui-new/docs/inventory/capabilities.md](ui-new/docs/inventory/capabilities.md) | The redesign checklist: every capability, its new home, and its status. |
| [ui-new/docs/inventory/areas/](ui-new/docs/inventory/areas/) | What each existing page does, its key actions and the API requests behind them. |
| [ui-new/docs/inventory/generated/](ui-new/docs/inventory/generated/) | Generated routes, per-page requests, API methods and experimental flags. |

## Common commands

```bash
corepack pnpm dev                                    # server + old UI on :3100
corepack pnpm --filter @paperclipai/ui-new dev       # new UI on :5174
corepack pnpm --filter @paperclipai/ui-new typecheck
corepack pnpm --filter @paperclipai/ui-new inventory # regenerate the existing-UI inventory
git sync-master                                      # fast-forward master from upstream and push it
```

To sync with upstream, run the `upstream-sync` skill (`/upstream-sync`). It merges on a `sync/<date>`
branch, checks upstream's changes against FORK-PATCHES.md, regenerates the inventory, and moves
`new-ui` only after approval. `git sync-ui` merges straight into `new-ui` and is the manual fallback.
