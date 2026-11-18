# Deploying the fork

How to run this fork (Paperclip with the `ui-new` SolidJS UI) on a Linux server with Docker. For
why things are set up this way, see [FORK.md](../FORK.md).

## What's here

| File | Purpose |
| --- | --- |
| `Dockerfile` | The core image built from source, with `ui-new` built and swapped in for the React UI |
| `docker-compose.yml` | Postgres + Paperclip, with bind mounts for all data |
| `.env.example` | Settings template; copy it to `deploy/.env` (gitignored) |
| `deploy.sh` | Builds the core image for the checked-out commit, then builds and (re)starts the stack |

### How the image is built

Since 2026-11-17 (hard-fork step 2) the image is built from this repo's source, so every change on
`main` (server, packages, migrations, `ui-new`) reaches the server at its next deploy. There are no
image patches and no upstream images involved. `deploy.sh` builds two images:

1. **`paperclip-core:<commit>`**, from the repo's root `Dockerfile` (upstream's, unchanged) with
   `--target production`: the server, the Paperclip Runner (Rust), the agent CLIs (Claude Code,
   Codex, OpenCode, Gemini, Kimi) and the React UI. `<commit>` is the checkout's
   `git rev-parse HEAD`. If an image with that tag exists, `deploy.sh` reuses it; pass `--rebuild`
   to build it again. A checkout with uncommitted or untracked files always rebuilds it, since the
   build reads the working tree, not the commit. The root `Dockerfile` copies the whole build
   context into the final image, so the root `.dockerignore` keeps every `.env` and `.env.*` file
   out (only the committed `*.example` templates go in); otherwise `deploy/.env` and its secrets
   would be readable by agents inside the container.
2. **`paperclip-fork:local`**, from `deploy/Dockerfile` through `docker compose up -d --build`:
   - builds `ui-new` in a small Node stage. The build copies the app logos (`ui/public/brands`)
     and the favicons and home-screen icons from `ui/public`, adds `ui-new/public` (the web app
     manifest and the service worker), and stamps the worker with a build id; the stage fails if
     any of these is missing;
   - starts `FROM` the core image (the `BASE_IMAGE` build arg; a build without `deploy.sh` fails on
     the placeholder `paperclip-core-missing-run-deploy-sh`);
   - replaces `/app/ui/dist` with the `ui-new` build.

Two build arguments of the root `Dockerfile` matter here:

- `CLI_TOOLS_CACHE_EPOCH` is the ISO week (e.g. `2026-W47`), as upstream's CI does. The agent CLIs
  are installed at `@latest` in a cached layer, so they move forward once a week, at the first
  deploy of the week; between those the layer is reused.
- `PAPERCLIP_BUILD_COMMIT` is **not** passed: in the root `Dockerfile` it also builds the remote
  provider pack (about 2.5 GB of provider binaries for cloud and sandbox runs, which this setup
  doesn't use). `deploy/Dockerfile` sets `PAPERCLIP_BUILD_COMMIT` as an environment variable
  instead, which is where the server reads its commit from first (`server/src/build-commit.ts`).
  Upstream's published image had the pack; nothing that runs locally uses it.

Run `deploy/deploy.sh --dry-run` to see the commit, whether the core image would be built or
reused, and the exact build command, without building anything.

The root build also runs `vite build` for the React UI in `ui/` (its output is replaced, but the
step has to pass), so `ui/` has to keep building even though it isn't deployed. It isn't
type-checked there.

### Build time and disk use

Measured on the dev machine (16 cores, Docker Desktop on WSL):

- **First build** of the core image, with an empty layer cache: about 9 minutes (552 s on
  2026-11-17). The slow parts are compiling the Rust Runner daemon (about 2.5 minutes), installing
  the workspace's dependencies, the agent CLIs, and the TypeScript server build. Expect longer on a
  smaller machine like server1, and a few GB of downloads (Node and Rust toolchains, npm packages).
- **Later builds** reuse Docker's layer cache. A commit that changes no package manifest rebuilds
  only the app layers (the React `ui/` build, the server build and the copy into the final image),
  not the dependency install, the Rust daemon or the agent CLIs: about 2.5 minutes for the core
  image (136 s), then under a minute for the `ui-new` image (53 s). A lockfile change also reruns
  the dependency install (about 2 minutes more), and the first deploy of each ISO week reinstalls
  the agent CLIs (about 1.5 minutes).
- **Size:** about 9.6 GB for `paperclip-core:<commit>` (upstream's published image, which also
  carries the remote provider pack, was about 15.7 GB); `paperclip-fork:local` adds only `ui-new`.
  Consecutive core images share most of their layers (the dependency `node_modules` layer changes
  only with the lockfile), but each deploy leaves the previous `paperclip-core:*` tag behind, and
  the build cache grows too.

To prune old core images, keep the one in use and remove the rest:

```bash
docker images 'paperclip-core' --format '{{.Repository}}:{{.Tag}}'   # list them
in_use=paperclip-core:$(docker image inspect paperclip-fork:local \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PAPERCLIP_BUILD_COMMIT=//p')
docker images 'paperclip-core' --format '{{.Repository}}:{{.Tag}}' | grep -vx "$in_use" | xargs -r docker rmi
docker builder prune --filter until=168h   # build cache older than a week
```

Removing a `paperclip-core` tag only untags it; its layers stay while the current image uses them.
Each deploy also leaves the previous `paperclip-fork:local` build behind as an untagged image once
the container has been recreated; `docker image prune` removes untagged images (all of them on the
machine, not only Paperclip's).

The service worker (`/sw.js`) replaces the old UI's in every browser that had it, since it's served
at the same address with new contents. Each deploy changes its build id, so open tabs and the
home-screen app reload onto the new build the next time they're in the background.

`docker-compose.yml` also sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` for the server, which reaches
`claude_local` runs on the CLI engine (`engine: "cli"`) only, so every run of such an agent sees the
same memory. Runs on the default ACP engine inherit an allowlist of variables that leaves it out, so
Claude's auto memory stays on for them ([fork/claude-local-run.md](../fork/claude-local-run.md)). Paperclip Runner agents
don't inherit the server's environment; set it in their adapter's `env`.

`deploy.sh` also exports `BUILD_COMMIT` (the checkout's `git rev-parse HEAD`), which Compose
passes as the `PAPERCLIP_UI_COMMIT` build arg. The `ui` stage bakes it into `ui-new`, and the final
stage sets it as the server's `PAPERCLIP_BUILD_COMMIT`, so the nav shows `ui <commit> · server
<commit>` under your name (the server's commit comes from `/api/health`), the same commit twice. The
arg is needed because the build context has no `.git`; a build without it works and shows
`ui unknown`.

## Server requirements

- Linux with Docker Engine and the Compose plugin.
- RAM: agents run on this machine (the Claude/Codex CLIs live in the container), so don't go too
  small. 4 GB is a reasonable floor (an estimate, not a measured figure).
- Disk: repo clones, per-task worktrees and their `node_modules` grow quickly. Put
  `PAPERCLIP_DATA_ROOT` on a disk with plenty of room. Docker needs room too: the image is built
  on the server (see [Build time and disk use](#build-time-and-disk-use)).
- CPU and RAM for the build: the TypeScript server build is given up to 4 GB of Node heap
  (`NODE_OPTIONS` in the root `Dockerfile`), and compiling the Rust daemon uses every core.

## First-time setup

```bash
git clone https://github.com/br1an-c0des/paperclip.git
cd paperclip
git checkout main

cp deploy/.env.example deploy/.env
$EDITOR deploy/.env                   # see "Settings" below
sudo mkdir -p /srv/paperclip/home     # your PAPERCLIP_DATA_ROOT
sudo chown "$(id -u):$(id -g)" /srv/paperclip/home

deploy/deploy.sh
```

Then open `PAPERCLIP_PUBLIC_URL`, create an account, and choose **Claim this instance**. On a
`private` deployment the first signed-in person to claim it becomes the admin, so do this before
anyone else can reach it. (`public` deployments use `paperclipai auth bootstrap-ceo` instead; see
`doc/DEPLOYMENT-MODES.md`.)

### Settings (`deploy/.env`)

| Setting | Notes |
| --- | --- |
| `PAPERCLIP_DATA_ROOT` | Host directory for all data; `postgres/` and `home/` go under it |
| `USER_UID` / `USER_GID` | Output of `id -u` / `id -g`, so files agents create are owned by you |
| `PAPERCLIP_PUBLIC_URL` | The exact URL people open, including `https://` |
| `PAPERCLIP_DEPLOYMENT_EXPOSURE` | `private` (Tailscale/VPN/LAN) or `public` (internet, behind Caddy) |
| `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET` | Generate each with `openssl rand -hex 32`. Keep them stable: changing `BETTER_AUTH_SECRET` signs everyone out. |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | API keys for agents. Leave `ANTHROPIC_API_KEY` empty to use a Claude subscription instead: sign in from Connections → AI connections after setup. A set key takes precedence over the subscription. |
| `PAPERCLIP_PORT` | Host port, default 3100. Use another one (e.g. 3200) when a dev server already runs on 3100 on the same machine. |
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

## This fork's deployment: server1

Since Nov 16, 2026 the working instance runs on `server1`, an Ubuntu mini PC on the tailnet, as a
fresh instance (nothing was copied from the earlier desktop deployment):

- **Checkout:** `~/paperclip` on `main`, used only for deploys; `deploy/.env` lives there (mode
  600). Data is in `~/paperclip-data`.
- **Access:** Paperclip on `127.0.0.1:3100`, fronted by `tailscale serve --bg 3100`, so it's
  `https://server1.<tailnet>.ts.net`.
- **Updating from the dev machine** (after pushing `main`):

  ```bash
  ssh server1 'cd ~/paperclip && git pull --ff-only && deploy/deploy.sh'
  ```

  The build runs on server1, so a deploy that rebuilds the core image takes a while (see
  [Build time and disk use](#build-time-and-disk-use)); the running instance stays up until
  Compose swaps the container at the end. If the deploy adds a migration, `deploy.sh` stops and
  asks for a backup first ([Updating](#updating)).

## On the dev machine (WSL with Docker Desktop)

No longer in use: the deployment moved to server1, and the desktop stack was stopped on Nov 16,
2026 (its data is kept in `~/paperclip-data`). The notes stay for running it on a dev machine
again. The deployment can run on the same Windows + WSL machine you develop on, beside the dev
server:

- **Docker:** Docker Desktop on Windows with WSL integration on for the Ubuntu distro. Run every
  command from Ubuntu as usual. The containers run in Docker Desktop's own distro and bind-mount
  the data folder from Ubuntu's disk. Keep `PAPERCLIP_DATA_ROOT` on Ubuntu's disk (e.g.
  `~/paperclip-data`), not under `/mnt/c`.
- **A clean checkout:** the image is built from the working tree as it is, so build from a separate
  worktree that holds only committed `main`, never from the checkout you're editing:

  ```bash
  git worktree add --detach ~/coding/paperclip-deploy main   # once; deploy/.env lives here
  cd ~/coding/paperclip-deploy && git checkout --detach main && deploy/deploy.sh   # each update
  ```

- **Ports:** set `PAPERCLIP_PORT=3200` so it doesn't collide with the dev server on 3100.
- **Tailscale on Windows:** WSL forwards `localhost` to Windows, so `tailscale serve` on Windows
  can front it. For example, the deployment on 443 and dev on other ports:

  ```bash
  tailscale serve --bg --https=443 http://localhost:3200     # deployed Paperclip
  tailscale serve --bg --https=10000 http://localhost:5174   # dev ui-new
  tailscale serve --bg --https=8443 http://localhost:3100    # dev server and old UI
  ```

- **Staying up:** the stack restarts whenever Docker Desktop starts (`restart: unless-stopped`), so
  turn on Docker Desktop's "Start when you sign in". It's down while the PC sleeps.

## Updating

Push `main` from your dev machine, then on the server:

```bash
cd paperclip
git pull --ff-only
deploy/deploy.sh --dry-run   # optional: what it would build, and any new migrations
deploy/deploy.sh
```

Postgres data and everything under `PAPERCLIP_DATA_ROOT` survives rebuilds.

**Back up the database before a deploy that adds a migration.** Migrations run when the server
starts and don't run backwards, so restoring the backup is the only way back. `deploy.sh` checks
this for you: it compares the commit the running image was built from with the checkout, lists any
new files in `packages/db/src/migrations`, and stops until you run it again with `--backed-up`
(after taking the backup in [Backups](#backups)). When it can't tell which commit is deployed (no
`paperclip-fork:local` image yet, or a commit this clone doesn't have), it prints a reminder
instead.

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

Run these from `deploy/`. Building always goes through `deploy.sh`, which builds the core image
and supplies it as the base; everything else is plain Compose. The Compose project is named `paperclip`
(`name:` in `docker-compose.yml`), which is what Docker Desktop lists; a stack started before
Nov 11, 2026 runs as `deploy` and is stopped with `docker compose -p deploy down`.

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
- **The core image build fails:** the output names the stage. Common causes: a change that
  breaks the server's TypeScript build or the React `ui/` build (`vite build` still runs there);
  `pnpm-lock.yaml` behind a package manifest (the `runner-lockfile` stage says so and gives the
  command to run in the checkout); a new workspace package the server depends on, whose
  `package.json` the root `Dockerfile`'s `deps` stage doesn't copy yet (add a `COPY` line there);
  or a full disk (`docker system df`, then prune as above). Fix it on `main`, then deploy again.
  The running instance is untouched by a failed build.
- **`deploy.sh` stops about migrations:** see [Updating](#updating).
- **Login fails or requests are rejected:** `PAPERCLIP_PUBLIC_URL` must match the URL in the
  browser exactly. Add extra hostnames to `PAPERCLIP_ALLOWED_HOSTNAMES`.
