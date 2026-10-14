# About this fork

This is a fork of [paperclipai/paperclip](https://github.com/paperclipai/paperclip) at
[br1an-c0des/paperclip](https://github.com/br1an-c0des/paperclip). Its purpose is to build a new
board UI in SolidJS (`ui-new/`) while continuing to take upstream's daily changes.

The rule behind every decision below: **keep changes in files upstream doesn't own.** New files
never conflict with upstream, so merges stay easy.

| Fork-only files | Purpose |
| --- | --- |
| `FORK.md` | This plan |
| `ui-new/` | The SolidJS UI ([ui-new/README.md](ui-new/README.md)) |
| `deploy/` | Production deployment ([deploy/README.md](deploy/README.md)) |

The only upstream file the fork edits is `pnpm-workspace.yaml` (one line, `- ui-new`), plus the
`pnpm-lock.yaml` entries that line causes.

## Remotes and branches

| Remote | URL | Use |
| --- | --- | --- |
| `origin` | `br1an-c0des/paperclip` | Your fork; push here |
| `upstream` | `paperclipai/paperclip` | Fetch only. Push is disabled, and only `master` is fetched |

| Branch | Rule |
| --- | --- |
| `master` | An exact mirror of `upstream/master`. Never commit here; it only fast-forwards. |
| `new-ui` | All fork work. Upstream changes come in by merging `master`. |

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

## Staying in sync with upstream

Upstream lands about 25 commits a day, and about a third of them touch `ui/`. Sync often (daily
or every few days); small merges are much easier than large ones.

```bash
git sync-ui            # updates master from upstream, then merges it into new-ui
pnpm install           # upstream changes dependencies often
pnpm --filter @paperclipai/ui-new typecheck   # catches API type changes from @paperclipai/shared
git push
```

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

- Test the full image build and a first deploy on a real server.
- Optionally, a GitHub Actions workflow in this fork that builds the image on pushes to `new-ui`
  and publishes it to `ghcr.io/br1an-c0des/paperclip`, so the server only pulls. Keep upstream's
  own workflows disabled in the fork (GitHub disables them on forks by default).
- Agent git push / PR authentication inside the container (see above).
