# CLAUDE.md

This is a personal fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip)
(`br1an-c0des/paperclip`). Its purpose is to build a **new board UI in SolidJS** (`ui-new/`) that
regroups the existing UI into a more coherent, single interface, while continuing to merge upstream's
daily changes.

## Intentions

- **Redesign the core work areas.** Tasks, projects, agents, goals, routines, approvals/decisions,
  artifacts and cases may be merged or reorganized into fewer, clearer pages.
- **Port the rest mostly as-is.** Settings, secrets, plugins, skills, apps and activity keep their
  current structure.
- **Remove the switches.** The current UI hides and shows features behind about 40 experimental flags.
  The new UI should settle on one refined interface instead of toggles.
- **Lose no functionality by accident.** Every capability of the old UI is catalogued; anything left out
  is dropped on purpose.
- **Stay mergeable.** The server, API and `@paperclipai/shared` types come from upstream unchanged.

## Ground rules

- **Keep changes in fork-only files**: `ui-new/`, `deploy/`, `FORK.md`, `CLAUDE.md`. Don't edit
  upstream code (`server/`, `ui/`, `packages/`). The only upstream files touched are
  `pnpm-workspace.yaml` (one line) and the `pnpm-lock.yaml` entries it causes.
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
| [FORK.md](FORK.md) | Remotes, branches, the upstream sync routine (`git sync-ui`), deployment summary, open items. |
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
git sync-ui                                          # pull upstream into master, merge into new-ui
```

After each upstream sync, regenerate the inventory and check `git diff ui-new/docs/inventory/generated`
for new routes, requests or flags; add new capabilities to the checklist.
