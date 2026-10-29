# Deploying the fork

How to run this fork (Paperclip with the `ui-new` SolidJS UI) on a Linux server with Docker. For
why things are set up this way, see [FORK.md](../FORK.md).

## What's here

| File | Purpose |
| --- | --- |
| `Dockerfile` | Upstream's published image with `ui-new` built and swapped in for the React UI |
| `docker-compose.yml` | Postgres + Paperclip, with bind mounts for all data |
| `.env.example` | Settings template; copy it to `deploy/.env` (gitignored) |
| `deploy.sh` | Picks the matching upstream image, then builds and (re)starts the stack |

### How the image is built

The server serves whatever is in `ui/dist`. `Dockerfile` therefore:

1. Builds `ui-new` in a small Node stage. The build copies the app logos (`ui/public/brands`) and
   the favicons and home-screen icons from `ui/public`, adds `ui-new/public` (the web app manifest
   and the service worker), and stamps the worker with a build id; the stage fails if any of these
   is missing.
2. Starts `FROM ghcr.io/paperclipai/paperclip:sha-<UPSTREAM_SHA>`, the image upstream publishes
   for each `master` commit.
3. Replaces `/app/ui/dist` with the `ui-new` build.

The service worker (`/sw.js`) replaces the old UI's in every browser that had it, since it's served
at the same address with new contents. Each deploy changes its build id, so open tabs and the
home-screen app reload onto the new build the next time they're in the background.

`docker-compose.yml` also sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` for the server, which reaches
`claude_local` agent runs, so every run of an agent sees the same memory. Paperclip Runner agents
don't inherit the server's environment; set it in their adapter's `env`.

`deploy.sh` sets `UPSTREAM_SHA` to the newest upstream commit already merged into your branch
that has a published image. The server in the image then matches the API your UI was
type-checked against. Run `deploy/deploy.sh --dry-run` to see which image it would use.

## Server requirements

- Linux with Docker Engine and the Compose plugin.
- RAM: agents run on this machine (the Claude/Codex CLIs live in the container), so don't go too
  small. 4 GB is a reasonable floor (an estimate, not a measured figure).
- Disk: repo clones, per-task worktrees and their `node_modules` grow quickly. Put
  `PAPERCLIP_DATA_ROOT` on a disk with plenty of room.

## First-time setup

```bash
git clone https://github.com/br1an-c0des/paperclip.git
cd paperclip
git checkout new-ui

cp deploy/.env.example deploy/.env
$EDITOR deploy/.env                   # see "Settings" below
sudo mkdir -p /srv/paperclip/home     # your PAPERCLIP_DATA_ROOT
sudo chown "$(id -u):$(id -g)" /srv/paperclip/home

deploy/deploy.sh
```

Then open `PAPERCLIP_PUBLIC_URL` and create the first account.

### Settings (`deploy/.env`)

| Setting | Notes |
| --- | --- |
| `PAPERCLIP_DATA_ROOT` | Host directory for all data; `postgres/` and `home/` go under it |
| `USER_UID` / `USER_GID` | Output of `id -u` / `id -g`, so files agents create are owned by you |
| `PAPERCLIP_PUBLIC_URL` | The exact URL people open, including `https://` |
| `PAPERCLIP_DEPLOYMENT_EXPOSURE` | `private` (Tailscale/VPN/LAN) or `public` (internet, behind Caddy) |
| `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET` | Generate each with `openssl rand -hex 32`. Keep them stable: changing `BETTER_AUTH_SECRET` signs everyone out. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | At least one, for agents |
| `GITHUB_TOKEN` | Optional fallback for cloning private repos. A company secret named `GITHUB_TOKEN` (set in the UI) takes precedence and is scoped to one company. |

## Access

Paperclip listens on `127.0.0.1:3100` only. Pick one of these to put in front of it.

**Private, just you or a small team (recommended to start).** Use [Tailscale](https://tailscale.com):

```bash
sudo tailscale serve --bg 3100
```

This gives `https://<machine>.<tailnet>.ts.net` with a valid certificate, reachable only on your
tailnet. Set `PAPERCLIP_PUBLIC_URL` to that URL and `PAPERCLIP_DEPLOYMENT_EXPOSURE=private`.

**Public, on the internet.** Point a domain at the server and run [Caddy](https://caddyserver.com),
which gets HTTPS certificates automatically. In `/etc/caddy/Caddyfile`:

```
paperclip.example.com {
    reverse_proxy 127.0.0.1:3100
}
```

Set `PAPERCLIP_PUBLIC_URL=https://paperclip.example.com` and
`PAPERCLIP_DEPLOYMENT_EXPOSURE=public`. Public mode enables stricter checks, including auth rate
limiting.

## Updating

Sync with upstream on your dev machine (`git sync-ui`, see [FORK.md](../FORK.md)), push, then on
the server:

```bash
cd paperclip
git pull
deploy/deploy.sh
```

Postgres data and everything under `PAPERCLIP_DATA_ROOT` survives rebuilds. `deploy.sh` also
updates the base image to match what you merged.

## Data on the host

```
<PAPERCLIP_DATA_ROOT>/
├── postgres/                                   database files (owned by the Postgres container user)
└── home/                                       PAPERCLIP_HOME, mounted at /paperclip
    └── instances/default/
        ├── projects/<company>/<project>/<repo>/  repos Paperclip clones for projects
        │   └── .paperclip/worktrees/<branch>/    per-task git worktrees
        ├── workspaces/<agentId>/                 agent scratch space when no project is set
        ├── data/                                 uploads, run logs, backups
        ├── logs/
        └── secrets/master.key                    encryption key for company secrets
```

Agents run inside the container and work in these directories. Because of the bind mount you can
read them directly on the server: browse them, run `git log`, or open them in an editor over SSH.

**Projects pointing at an existing directory** (`sourceType: local_path`): the path must exist
inside the container. Add a bind mount under `server.volumes` in `docker-compose.yml`, using the
same path on both sides, e.g. `- /srv/code:/srv/code`. Make sure it's owned by `USER_UID`; the
container only fixes ownership under `/paperclip`.

## Backups

Back up all of `PAPERCLIP_DATA_ROOT`. `secrets/master.key` encrypts company secrets, so without it
stored secrets can't be decrypted. For a consistent database copy, either stop the stack first
(`docker compose stop` in `deploy/`), or dump it while it runs:

```bash
cd deploy
docker compose exec db pg_dump -U paperclip paperclip | gzip > paperclip-$(date +%F).sql.gz
```

## Operating

Run these from `deploy/`. Building always goes through `deploy.sh`, which supplies the upstream
base image; everything else is plain Compose:

```bash
docker compose logs -f server     # follow server logs
docker compose ps                 # status
docker compose restart server
docker compose down               # stop (data is kept)
```

## Troubleshooting

- **Slow first start:** on first boot, or after changing `USER_UID`/`USER_GID`, the image's
  startup script checks ownership of every file under `/paperclip`. With many worktrees this can
  take minutes. Later boots skip the full check.
- **`deploy.sh` finds no published image:** upstream only publishes images for commits that pass
  its CI. The script looks back up to 50 commits; if that fails, sync to a newer upstream commit.
- **Login fails or requests are rejected:** `PAPERCLIP_PUBLIC_URL` must match the URL in the
  browser exactly. Add extra hostnames to `PAPERCLIP_ALLOWED_HOSTNAMES`.
