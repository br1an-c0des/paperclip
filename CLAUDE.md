# CLAUDE.md

This is a personal hard fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip)
(`br1an-c0des/paperclip`), frozen at upstream `79c8cf8b6` (tag `upstream-freeze`) on 2026-11-17.
It's our codebase now: we change the server, database and packages freely, and take upstream's
changes only by choice ([FORK.md](FORK.md), [fork/hard-fork-plan.md](fork/hard-fork-plan.md)). It's
set up for one person running Claude agents.

## Intentions

- **A new board UI in SolidJS** (`ui-new/`): the core work areas (tasks, projects, agents, goals,
  routines, requests, artifacts, cases) regrouped into fewer, clearer pages, the rest ported mostly
  as-is, one refined interface instead of experimental toggles, and no capability lost by accident
  (every one is catalogued). Stage 1 of the [build plan](ui-new/docs/build-plan.md) is complete.
- **Make Claude runs first-class.** Agents run on the `claude_local` adapter, whose default engine is
  ACP (`claude-agent-acp`), with `claude --print` as the CLI engine
  ([fork/claude-local-run.md](fork/claude-local-run.md)). The plan: runs that behave like a Claude Code session in the project's repo (its CLAUDE.md, skills and
  MCP servers), Paperclip reached through MCP instead of curl, one prompt builder we own, and chat
  as its own concept rather than a hidden task (hard-fork plan steps 4–7).
- **Then the build plan's features, in core,** without the plugin limits the fork used to work under.
- **Leave unused code alone until it gets in the way.** The other adapters, the Paperclip Runner,
  Claude Managed and cloud execution stay in the tree, dormant. Remove a subsystem only when it
  blocks a change we want (hard-fork plan step 3).

## Ground rules

- **Branches:** work on `main`; larger work on a feature branch merged into `main` with `--no-ff`.
  `master` mirrors upstream for the upstream watch and is never merged into `main` and never
  committed to. Don't rebase `main`. `origin/new-ui` is a frozen pointer at the branch point; don't
  push to it.
- **Upstream code is ours to change.** No `FORK:` markers and no patch records needed. Keep each
  change focused and tested, and prefer fixing the cause over working around it in `ui-new`.
- **Dormant areas:** don't extend or fix code this setup doesn't use (other adapters, the Runner,
  cloud and sandbox execution). If a change to shared code breaks a test there, skip that test with
  a note saying why, or remove the subsystem if that's simpler. Ask before removing anything large.
- **Migrations** continue upstream's numbered sequence in `packages/db/src/migrations` (the first
  of ours is `0491`). Back up server1's database before deploying one; migrations don't run
  backwards.
- **Upstream changes come in by choice**, through the `upstream-watch` skill (`/upstream-watch`):
  review, pick, cherry-pick on a branch, approve. Never merge `master` into `main`.
- **Bugs** go in [fork/upstream-fixes.md](fork/upstream-fixes.md), the fork's bug list (the name
  is historical). Fix them in our tree.
- **`ui-new` talks to the API** (`/api`, proxied to the server on :3100) and imports types from
  `@paperclipai/shared` with `import type`. When the API lacks something, change the server rather
  than designing around the gap. The old React UI (`ui/`) was removed on 2026-11-17: it's in git at
  `upstream-freeze` (`git show upstream-freeze:ui/<path>`), and the ui-new inventory docs
  ([ui-new/docs/inventory/](ui-new/docs/inventory/README.md)) catalogue it.
- **Deploys** build the image from source: `deploy/deploy.sh` builds the root `Dockerfile`
  (`paperclip-core:<commit>`) and swaps `ui-new` in, so every change on `main` reaches server1 at
  its next deploy. The core image doesn't build `ui-new`; `deploy/Dockerfile` builds it and puts it
  in `ui-new/dist`, where the server serves it from.
- `pnpm` isn't installed globally on this machine; use `corepack pnpm`.
- For the repo's conventions (repo map, dev setup, API rules), see `AGENTS.md`. Its pull-request
  template and Paperclip-issue workflow rules are upstream's and don't apply here.

## UI text

- **Help text goes behind an "i" icon, not in the page body.** When you write a short description
  or hint for a UI element (what a section, card or field is for, or general guidance), put it in a
  hover tooltip under a small "i" info icon: `ui-new/src/ui/InfoTip.tsx`, or the `info` prop on
  `SettingsCard` and `SettingsRow`. Keep visible only what describes the current state: empty
  states, why a control is missing or disabled, save status and errors. The tip also opens on tap,
  for phones. See [decision 52](ui-new/docs/decisions.md#52-help-text-goes-behind-an-info-icon).

## Documentation

| Doc | What it covers |
| --- | --- |
| [FORK.md](FORK.md) | Where this came from: the freeze, remotes and branches, the upstream watch, the deployment, why `ui-new` is a standalone app, open items. |
| [fork/hard-fork-plan.md](fork/hard-fork-plan.md) | **Adopted 2026-11-17.** The plan and its progress: leave unused code, make runs Claude-native, Paperclip over MCP, one prompt builder, first-class chat, the build plan in core. |
| [fork/repo-map.md](fork/repo-map.md) | The whole repo, labelled ours / shared core / dormant: where features live, where dormant code is wired in, which tests cover what. |
| [fork/claude-local-run.md](fork/claude-local-run.md) | One `claude_local` run from wake to finish (CLI and ACP engines), with file references and the change points for hard-fork steps 4 and 5. |
| [FORK-PATCHES.md](FORK-PATCHES.md) | Retired: since the deployment builds from source there are no patches; history in git. |
| [fork/upstream-fixes.md](fork/upstream-fixes.md) | The fork's bug list: what's wrong, where, and the likely fix. |
| [fork/test-suite-audit.md](fork/test-suite-audit.md) | Step 3a: what the full test suite costs (~7.6 h), where the time goes, and the fixes to try. |
| [.claude/skills/upstream-watch/SKILL.md](.claude/skills/upstream-watch/SKILL.md) | The weekly upstream review: list what's new, triage, cherry-pick what you choose. Ledger in [fork/upstream-watch.md](fork/upstream-watch.md); older sync reports in `fork/sync-reports/`. |
| [.claude/skills/pm/SKILL.md](.claude/skills/pm/SKILL.md) | Project-manager mode (`/pm`): plan and review, delegate building to 3–5 agents, propose each one first. |
| [ui-new/README.md](ui-new/README.md) | Running and building the SolidJS app; layout; lockfile-conflict fix. |
| [deploy/README.md](deploy/README.md) | Production deployment on server1: Docker image on top of upstream's, Compose with bind mounts, Tailscale or Caddy. |
| [ui-new/docs/build-plan.md](ui-new/docs/build-plan.md) | The build plan: stage 1 (the new UI, complete) and its milestones, upstream changes still to integrate, and the feature ideas now built in core. |
| [ui-new/docs/inventory/README.md](ui-new/docs/inventory/README.md) | How the existing UI is documented, and the redesign tiers. |
| [ui-new/docs/inventory/capabilities.md](ui-new/docs/inventory/capabilities.md) | The redesign checklist: every capability, its new home, and its status. |
| [ui-new/docs/inventory/areas/](ui-new/docs/inventory/areas/) | What each existing page does, its key actions and the API requests behind them. |
| [ui-new/docs/inventory/generated/](ui-new/docs/inventory/generated/) | Generated routes, per-page requests, API methods and experimental flags. |
| [ui-new/docs/proposals/](ui-new/docs/proposals/) | Design proposals for the redesign, such as unifying questions, decisions and approvals into requests. |
| [ui-new/docs/decisions.md](ui-new/docs/decisions.md) | Discoveries and decisions: API gaps and constraints the redesign ran into, their options, and what was decided. Many API gaps can now be server changes. |
| [ui-new/docs/guides/](ui-new/docs/guides/README.md) | Notes toward a user-facing guide to Paperclip: what each feature is for, when it helps, example flows. Raw material for a written guide and an in-app one (build plan 3.15). |
| [ui-new/docs/design/](ui-new/docs/design/README.md) | The approved redesign to build from: board index, phone layouts (`mobile.md`), Capsule Stack design system, `tokens.css`, a style guide page, and the board sources. |

## Common commands

```bash
PAPERCLIP_AGENT_JWT_SECRET=$(openssl rand -hex 32) corepack pnpm dev  # server (API) on :3100, plus ui-new's last build if there is one; without the secret (or BETTER_AUTH_SECRET) agent runs get no API key
corepack pnpm --filter @paperclipai/ui-new dev       # new UI on :5174
corepack pnpm --filter @paperclipai/ui-new exec vite --port 5181 --strictPort  # a second new UI, e.g. for an agent (5181–5184)
corepack pnpm --filter @paperclipai/ui-new typecheck
corepack pnpm --filter @paperclipai/ui-new test
corepack pnpm --filter @paperclipai/ui-new test:e2e   # Playwright smoke suite, mocked API (E2E_LIVE=1: read-only against :3100)
corepack pnpm --filter @paperclipai/plugin-sdk build # after install, a cherry-pick, or in a fresh worktree; else the server dies with "does not provide an export named …"
ssh server1 'cd ~/deployments/paperclip/repo && git pull --ff-only && deploy/deploy.sh'   # deploy main to server1 (the real instance)
```

To review upstream, run `/upstream-watch`: it lists upstream's new commits since the last review,
triages them, and cherry-picks only what you choose, on a branch, after approval.

## Gotchas

- Git worktrees here, including agents' `isolation: "worktree"`, may start from `master` rather than
  `main`. Before working: `git merge-base --is-ancestor main HEAD || git reset --hard main`.
- `git sync-master` checks out `master`, so don't run it in a checkout the dev servers run from. Instead:
  `git fetch upstream && git push origin upstream/master:master && git branch -f master upstream/master && git branch --set-upstream-to=origin/master master`.
- server1 runs the real instance with real data: never test against it, and never run M7 test data there.
  server1 is also a dev machine, so check `hostname` first: on server1, `localhost:3100` is the real
  instance ([Dev work on server1](#dev-work-on-server1)).
- `pnpm verify` and similar scripts compare against `origin/master`, which is upstream now: pass `--base main`
  where they take one ([fork/repo-map.md](fork/repo-map.md#5-tests)).
- Finished agent worktrees can be locked: `git worktree unlock <path>` before `git worktree remove`.
- Stop a dev server by its port (`ss -ltnp | grep ':5181 '`), not `pkill -f <pattern>`, which also matches and kills the
  shell running it.
- Playwright's Chromium (in `~/.cache/ms-playwright`) needs `libnss3`, `libnspr4` and `libasound2t64`. If
  `ldd` on its binary reports them missing, ask the user to run `sudo apt install -y libnss3 libnspr4 libasound2t64`
  rather than extracting them into a temporary folder, which is gone after a restart.

## Dev work on server1

There are two dev machines: the desktop (WSL) and server1. server1 also runs the real instance, so its
deployment and dev work live in separate folders ([deploy/README.md](deploy/README.md#this-forks-deployment-server1)):

- `~/deployments/paperclip/` holds the deployment: `repo/` (the deploy checkout), `data/` and
  `backups/`. Never build, test, edit or run dev servers there.
- `~/coding/paperclip` is the dev checkout. Do dev work there and in its worktrees.
- The real instance owns ports 3100 and 3200, and its containers are `paperclip-server-1` and
  `paperclip-db-1`. Leave them alone. Commands in this file that say `:3100` (`pnpm dev`, ui-new's API
  proxy, `E2E_LIVE=1`) mean the desktop's dev instance. On server1, they would reach the real instance.
- A dev instance on server1, when one is needed, gets its own port and data folder: the API on :3101
  and data in `~/coding/paperclip-dev-data`. Used for step 4a's run check (2026-11-18):
  `PAPERCLIP_HOME=~/coding/paperclip-dev-data PORT=3101 PAPERCLIP_API_URL=http://localhost:3101 PAPERCLIP_AGENT_JWT_SECRET=<saved secret> corepack pnpm dev`.
  - **Always set `PAPERCLIP_API_URL`:** it's the address agent runs use to reach Paperclip, and it
    keeps them off :3100.
  - **In a linked worktree,** the dev runner also needs a `.paperclip/.env` (gitignored). A file
    holding the same three variables does.
  - **The first start compiles the Runner's Rust crate,** which takes several minutes.
  - **Memory:** the server peaks near 4 GB, so cap it (`systemd-run … -p MemoryMax=4G`).
  - **Agent runs use your own Claude login** in `~/.claude`; no second login is needed. Don't copy
    production's login: two copies of one refresh token break each other.
  - **Stop it** with `systemctl --user stop <its run-….scope>`.
  - Its TES company (`17ad7e05-6ab8-4bdf-a8ec-76a1c806d513`) and agent "M7 test runner" (`98b9fcf0-3ba7-45eb-8bc1-53b49c20f0bf`)
    are server1's own, not the desktop's TES.
  - For ui-new's dev server and `E2E_LIVE=1`, use `PAPERCLIP_API_URL=http://localhost:3101`.
- Node: nvm defaults to Node 26, which doesn't ship corepack. The repo wants Node 24 (`.nvmrc`), so
  run `nvm use 24` first.
- The machine has 20 CPUs and 14 GB of memory, shared with the real instance. Cap heavy jobs with
  `systemd-run --user --scope -p MemoryMax=… -p CPUQuota=…`.

## Testing against the local instance

"The local instance" means a dev instance: the desktop's on :3100, or server1's on :3101. It never
means the real instance on server1.

- The test company is TES (`c3948f92-4af2-414f-81c4-88f1c59bf2ab`). Never change the agent Bob
  (`8997b521-5718-4fce-988f-e79a301dc876`).
- Browser checks stub every write (POST/PATCH/PUT/DELETE) with Playwright's `page.route`. Never wake an agent,
  start a real run, or run a real OAuth flow.
- Name throwaway data with an "M7 test" prefix and keep it. Throwaway agents stay paused.
