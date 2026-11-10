# CLAUDE.md

This is a personal fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip)
(`br1an-c0des/paperclip`). Its purpose is to build a **new board UI in SolidJS** (`ui-new/`) that
regroups the existing UI into a more coherent, single interface, while continuing to merge upstream's
daily changes. The fork is UI-only: it builds on the existing API and doesn't change server, database
or package code.

## Intentions

- **Redesign the core work areas.** Tasks, projects, agents, goals, routines, approvals/decisions,
  artifacts and cases may be merged or reorganized into fewer, clearer pages.
- **Port the rest mostly as-is.** Settings, secrets, plugins, skills, apps and activity keep their
  current structure.
- **Remove the switches.** The current UI hides and shows features behind about 40 experimental flags.
  The new UI should settle on one refined interface instead of toggles.
- **Lose no functionality by accident.** Every capability of the old UI is catalogued; anything left out
  is dropped on purpose.
- **Stay UI-only.** Upstream lands many commits a day, and the server areas the redesign touches are
  still changing. `ui-new` works with the API as it is; small, self-contained server or documentation
  fixes go upstream as focused pull requests instead of fork patches.

## Ground rules

- **Keep work in fork-only files** (listed in [FORK.md](FORK.md#fork-only-files)). Don't change
  server, database or package code in the fork. If a UI feature can't be built on the existing API,
  design around the gap or propose the change upstream. If a fork change ever seems unavoidable, ask
  first, then follow [FORK.md](FORK.md#changing-server-database-and-packages).
- **Fixes for upstream** go in their own `fix/*` or `docs/*` branch off `master`, as a pull request to
  `paperclipai/paperclip` that follows upstream's `CONTRIBUTING.md` and PR template. They are never
  merged into `new-ui`. Record each one in [fork/upstream-fixes.md](fork/upstream-fixes.md), from
  candidate to merged. See [FORK.md](FORK.md#contributing-fixes-upstream).
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
  Paperclip-issue workflow rules apply only to pull requests sent upstream, not to work on `new-ui`.

## Documentation

| Doc | What it covers |
| --- | --- |
| [FORK.md](FORK.md) | Remotes, branches, the UI-only policy and its fallback rules, sending fixes upstream, the upstream sync routine, why `ui-new` is a standalone app rather than a plugin, deployment summary, open items. |
| [FORK-PATCHES.md](FORK-PATCHES.md) | Every change the fork makes to upstream files: what, why, what it depends on, how to resolve conflicts. |
| [fork/upstream-fixes.md](fork/upstream-fixes.md) | Small fixes for upstream: candidates to build, and each one's branch, pull request and status until it's merged. |
| [.claude/skills/upstream-sync/SKILL.md](.claude/skills/upstream-sync/SKILL.md) | The upstream sync procedure and conflict-resolution policy. Reports go to `fork/sync-reports/`. |
| [.claude/skills/upstream-fix/SKILL.md](.claude/skills/upstream-fix/SKILL.md) | Building one signed-off fix for upstream: duplicate search, upstream's rules, the testing budget, the PR description, and stopping before anything is pushed. |
| [.claude/skills/pm/SKILL.md](.claude/skills/pm/SKILL.md) | Project-manager mode (`/pm`): plan and review, delegate building to 3–5 agents, propose each one first. |
| [ui-new/README.md](ui-new/README.md) | Running and building the SolidJS app; layout; lockfile-conflict fix. |
| [deploy/README.md](deploy/README.md) | Production deployment: Docker image on top of upstream's, Compose with bind mounts, Tailscale or Caddy. |
| [ui-new/docs/build-plan.md](ui-new/docs/build-plan.md) | The build plan: every redesign idea sorted into UI-only, small upstream PRs and experimental features, stage 1 milestones, the upstream changes still to integrate, decisions to make, and open questions. |
| [ui-new/docs/inventory/README.md](ui-new/docs/inventory/README.md) | How the existing UI is documented, and the redesign tiers. |
| [ui-new/docs/inventory/capabilities.md](ui-new/docs/inventory/capabilities.md) | The redesign checklist: every capability, its new home, and its status. |
| [ui-new/docs/inventory/areas/](ui-new/docs/inventory/areas/) | What each existing page does, its key actions and the API requests behind them. |
| [ui-new/docs/inventory/generated/](ui-new/docs/inventory/generated/) | Generated routes, per-page requests, API methods and experimental flags. |
| [ui-new/docs/proposals/](ui-new/docs/proposals/) | Design proposals for the redesign, such as unifying questions, decisions and approvals into requests. |
| [ui-new/docs/decisions.md](ui-new/docs/decisions.md) | Discoveries and decisions: API gaps and constraints the redesign runs into, their options, and what was decided. |
| [ui-new/docs/guides/](ui-new/docs/guides/README.md) | Notes toward a user-facing guide to Paperclip: what each feature is for, when it helps, example flows. Raw material for a written guide and an in-app one (build plan 3.15). |
| [ui-new/docs/design/](ui-new/docs/design/README.md) | The approved redesign to build from: board index, phone layouts (`mobile.md`), Capsule Stack design system, `tokens.css`, a style guide page, and the board sources. |

## Common commands

```bash
PAPERCLIP_AGENT_JWT_SECRET=$(openssl rand -hex 32) corepack pnpm dev  # server + old UI on :3100; without the secret (or BETTER_AUTH_SECRET) agent runs get no API key
corepack pnpm --filter @paperclipai/ui-new dev       # new UI on :5174
corepack pnpm --filter @paperclipai/ui-new exec vite --port 5181 --strictPort  # a second new UI, e.g. for an agent (5181–5184)
corepack pnpm --filter @paperclipai/ui-new typecheck
corepack pnpm --filter @paperclipai/ui-new test
corepack pnpm --filter @paperclipai/ui-new inventory # regenerate the existing-UI inventory
corepack pnpm --filter @paperclipai/plugin-sdk build # after install, a sync, or in a fresh worktree; else the server dies with "does not provide an export named …"
git sync-master                                      # fast-forward master from upstream and push it (checks out master: see Gotchas)
```

To sync with upstream, run the `upstream-sync` skill (`/upstream-sync`). It first outlines the
unsynced upstream commits (features, bug fixes) and waits for your go-ahead. Then it merges on a
`sync/<date>` branch, checks upstream's changes against FORK-PATCHES.md, regenerates the inventory,
and moves `new-ui` only after approval. `git sync-ui` merges straight into `new-ui` and is the manual fallback.

## Gotchas

- Git worktrees here, including agents' `isolation: "worktree"`, start from `master`. Before working:
  `git merge-base --is-ancestor new-ui HEAD || git reset --hard new-ui`.
- `git sync-master` checks out `master`, so don't run it in a checkout the dev servers run from. Instead:
  `git fetch upstream && git push origin upstream/master:master && git branch -f master upstream/master && git branch --set-upstream-to=origin/master master`.
- Finished agent worktrees can be locked: `git worktree unlock <path>` before `git worktree remove`.
- Stop a dev server by its port (`ss -ltnp | grep ':5181 '`), not `pkill -f <pattern>`, which also matches and kills the
  shell running it.
- Playwright's Chromium (in `~/.cache/ms-playwright`) needs `libnss3`, `libnspr4` and `libasound2t64`. If
  `ldd` on its binary reports them missing, ask the user to run `sudo apt install -y libnss3 libnspr4 libasound2t64`
  rather than extracting them into a temporary folder, which is gone after a restart.

## Testing against the local instance

- The test company is TES (`c3948f92-4af2-414f-81c4-88f1c59bf2ab`). Never change the agent Bob
  (`8997b521-5718-4fce-988f-e79a301dc876`).
- Browser checks stub every write (POST/PATCH/PUT/DELETE) with Playwright's `page.route`. Never wake an agent,
  start a real run, or run a real OAuth flow.
- Name throwaway data with an "M7 test" prefix and keep it. Throwaway agents stay paused.
