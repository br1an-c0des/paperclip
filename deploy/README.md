# Deploying the fork

How to run this fork (Paperclip with the `ui-new` SolidJS UI) on a Linux server with Docker. For
why things are set up this way, see [FORK.md](../FORK.md).

## What's here

| File | Purpose |
| --- | --- |
| `Dockerfile` | The core image built from source, with `ui-new` built and added |
| `docker-compose.yml` | Postgres + Paperclip, with bind mounts for all data |
| `.env.example` | Settings template; copy it to `deploy/.env` (gitignored) |
| `deploy.sh` | Checks CI, builds the core image for the checked-out commit, backs up and rehearses new migrations, (re)starts the stack and checks it came up; `--rollback` undoes the last deploy ([Updating](#updating)) |
| `tests/` | `deploy-sh.test.sh`, the tests for `deploy.sh`, with fake `docker`, `gh` and `curl` in `tests/stubs/` ([Testing deploy.sh](#testing-deploysh)) |

### How the image is built

Since 2026-11-17 (hard-fork step 2) the image is built from this repo's source, so every change on
`main` (server, packages, migrations, `ui-new`) reaches the server at its next deploy. There are no
image patches and no upstream images involved. `deploy.sh` builds two images:

1. **`paperclip-core:<commit>`**, from the repo's root `Dockerfile` (upstream's, without the old
   React UI's build) with `--target production`: the server, the Paperclip Runner (Rust) and the
   agent CLIs (Claude Code, Codex, OpenCode, Gemini, Kimi). `<commit>` is the checkout's
   `git rev-parse HEAD`. If an image with that tag exists, `deploy.sh` reuses it; pass `--rebuild`
   to build it again. A checkout with uncommitted or untracked files always rebuilds it, since the
   build reads the working tree, not the commit. The root `Dockerfile` copies the whole build
   context into the final image, so the root `.dockerignore` keeps every `.env` and `.env.*` file
   out (only the committed `*.example` templates go in); otherwise `deploy/.env` and its secrets
   would be readable by agents inside the container.
2. **`paperclip-fork:local`**, from `deploy/Dockerfile` through `docker compose up -d --build`:
   - builds `ui-new` in a small Node stage. The build copies `ui-new/public` (the app logos in
     `brands/`, the favicons and home-screen icons, the web app manifest and the service worker)
     and stamps the worker with a build id; the stage fails if any of these is missing;
   - starts `FROM` the core image (the `BASE_IMAGE` build arg; a build without `deploy.sh` fails on
     the placeholder `paperclip-core-missing-run-deploy-sh`);
   - puts the `ui-new` build in `/app/ui-new/dist`, where the server serves it from
     (`server/src/app.ts` serves the first of `server/ui-dist` and `ui-new/dist` that has an
     `index.html`; the stage clears both first).

Two build arguments of the root `Dockerfile` matter here:

- `CLI_TOOLS_CACHE_EPOCH` is the ISO week (e.g. `2026-W47`), as upstream's CI does. The agent CLIs
  are installed at `@latest` in a cached layer, so they move forward once a week, at the first
  deploy of the week; between those the layer is reused.
- `PAPERCLIP_BUILD_COMMIT` is **not** passed: in the root `Dockerfile` it also builds the remote
  provider pack (about 2.5 GB of provider binaries for cloud and sandbox runs, which this setup
  doesn't use). `deploy/Dockerfile` sets `PAPERCLIP_BUILD_COMMIT` as an environment variable
  instead, which is where the server reads its commit from first (`server/src/build-commit.ts`).
  Upstream's published image had the pack; nothing that runs locally uses it.

Run `deploy/deploy.sh --dry-run` to see the commit, its CI state, whether the core image would be
built or reused (and the exact build command), any new migrations and what each later stage would
do, without changing anything.

### Build time and disk use

Measured on the dev machine (16 cores, Docker Desktop on WSL):

- **First build** of the core image, with an empty layer cache: about 9 minutes (552 s on
  2026-11-17). The slow parts are compiling the Rust Runner daemon (about 2.5 minutes), installing
  the workspace's dependencies, the agent CLIs, and the TypeScript server build. Expect longer on a
  smaller machine like server1, and a few GB of downloads (Node and Rust toolchains, npm packages).
- **Later builds** reuse Docker's layer cache. A commit that changes no package manifest rebuilds
  only the app layers (the server build and the copy into the final image),
  not the dependency install, the Rust daemon or the agent CLIs: about 2.5 minutes for the core
  image (136 s), then under a minute for the `ui-new` image (53 s). A lockfile change also reruns
  the dependency install (about 2 minutes more), and the first deploy of each ISO week reinstalls
  the agent CLIs (about 1.5 minutes).
- **Size:** about 9.6 GB for `paperclip-core:<commit>` (upstream's published image, which also
  carries the remote provider pack, was about 15.7 GB); `paperclip-fork:local` adds only `ui-new`.
  Consecutive core images share most of their layers (the dependency `node_modules` layer changes
  only with the lockfile), but each deploy leaves the previous `paperclip-core:*` tag behind, and
  the build cache grows too.

To prune old core images, keep the one in use and the one `paperclip-fork:previous` (the rollback
image) was built from, and remove the rest:

```bash
docker images 'paperclip-core' --format '{{.Repository}}:{{.Tag}}'   # list them
commit_of() { docker image inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
  | sed -n 's/^PAPERCLIP_BUILD_COMMIT=//p'; }
keep="paperclip-core:$(commit_of paperclip-fork:local)|paperclip-core:$(commit_of paperclip-fork:previous)"
docker images 'paperclip-core' --format '{{.Repository}}:{{.Tag}}' | grep -vxE "$keep" | xargs -r docker rmi
docker builder prune --filter until=168h   # build cache older than a week
```

Removing a `paperclip-core` tag only untags it; its layers stay while a tagged image uses them.
`deploy.sh` tags the image that was running before each deploy `paperclip-fork:previous`, and the
one before that loses its last tag. server1's Docker uses the containerd image store, which deletes
an image as soon as its last tag goes, even while a container runs it ([Rolling back](#rolling-back));
on the classic store it stays as an untagged image, which `docker image prune` removes (all of them
on the machine, not only Paperclip's).

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

- **Layout:** since Nov 18, 2026 server1 is also a second dev machine, so deployment and dev work
  live in separate folders:

  ```
  ~/deployments/paperclip/
  ├── repo/      the deploy checkout, on main, used only for deploys; deploy/.env is here (mode 600)
  ├── data/      PAPERCLIP_DATA_ROOT (postgres/ and home/, see Data on the host)
  └── backups/   database dumps taken before deploys, e.g. paperclip-2026-11-18-1210.dump,
                 and last-deploy.env (what the last deploy did, for --rollback)
  ~/coding/paperclip/   the dev checkout, for manual dev work on server1 (never deployed from)
  ```

  Never build, test or edit in `~/deployments`. Dev work on server1 happens in
  `~/coding/paperclip`, and a dev instance there needs its own ports and data folder (see the
  root [CLAUDE.md](../CLAUDE.md#dev-work-on-server1)).
- **Access:** Paperclip on `127.0.0.1:3100`, fronted by `tailscale serve --bg 3100`, so it's
  `https://server1.<tailnet>.ts.net`.
- **Updating from a dev machine** (after pushing `main`):

  ```bash
  ssh server1 'cd ~/deployments/paperclip/repo && git pull --ff-only && deploy/deploy.sh'
  ```

  The build runs on server1, so a deploy that rebuilds the core image takes a while (see
  [Build time and disk use](#build-time-and-disk-use)); the running instance stays up until
  Compose swaps the container at the end. `deploy.sh` refuses a commit whose CI run didn't pass,
  and backs up and rehearses a deploy that adds a migration ([Updating](#updating)). Right after a
  push CI is still running, so add `--wait-ci` to deploy when it passes.

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
  tailscale serve --bg --https=8443 http://localhost:3100    # dev server
  ```

- **Staying up:** the stack restarts whenever Docker Desktop starts (`restart: unless-stopped`), so
  turn on Docker Desktop's "Start when you sign in". It's down while the PC sleeps.

## Updating

Push `main` from your dev machine, then on the server:

```bash
cd ~/deployments/paperclip/repo   # the deploy checkout on server1
git pull --ff-only
deploy/deploy.sh --dry-run   # optional: CI state, what it would build, any new migrations
deploy/deploy.sh
```

Postgres data and everything under `PAPERCLIP_DATA_ROOT` survives rebuilds.

### What a deploy does

In order, stopping at the first problem. Nothing touches the running instance until step 7, so a
deploy that stops before then leaves it as it was.

1. **CI gate.** Looks up the run of the Test workflow (`.github/workflows/test.yml`) for the
   checkout's `HEAD` on GitHub and goes on only if the newest one passed (see
   [The CI gate](#the-ci-gate)).
2. **Core image.** Builds `paperclip-core:<commit>`, or reuses it
   ([How the image is built](#how-the-image-is-built)).
3. **Fork image.** First tags the image the server is running `paperclip-fork:outgoing`, so the
   build doesn't delete it ([Rolling back](#rolling-back)). Then `docker compose build server`
   builds `paperclip-fork:local` (`ui-new` on top of the core image). Building it before the
   backup means a `ui-new` build failure stops the deploy before anything else, and the backup is
   taken as close to the restart as it can be.
4. **New migrations?** Compares the commit the running server reports (from its container's
   environment, which outlives its image) with `HEAD` and lists new files in
   `packages/db/src/migrations`. If there are none, steps 5 and 6 are skipped. When it can't tell
   what's deployed (an image without a commit, or a commit this clone doesn't have) and a database
   is running, it carries on as if there were some.
5. **Backup** ([Automatic backups](#automatic-backups)).
6. **Rehearsal** ([Migration rehearsal](#migration-rehearsal)).
7. **Restart.** Moves `paperclip-fork:outgoing` to `paperclip-fork:previous`, writes
   `last-deploy.env` next to the backups (the commit, the previous image and commit, the
   migrations, the backup), then `docker compose up -d --no-build`. Migrations run when the new
   server starts.
8. **Check.** Waits for `/api/health` on `PAPERCLIP_PORT` (up to `DEPLOY_HEALTH_TIMEOUT`, 300 s by
   default) and checks that the commit it reports is `HEAD`. Then it scans the server's log since
   the restart for error-level lines (pino's JSON `"level":50` and `60`, or `ERROR` / `FATAL` in
   pretty output) and prints a summary: commit, migrations, backup, rehearsal, health and the
   error lines it found. A health or commit failure exits non-zero, with the last lines of the
   server log and the way back. Error lines on their own are reported, not fatal.

### Flags and settings

| Flag | What it does |
| --- | --- |
| `--dry-run` | Reports each stage (CI state, build or reuse, migrations, the backup path and free space, the rehearsal, the image it would keep as previous or why there's none, the health URL) and exits 0. Changes nothing, and runs only read-only `docker` and `gh` queries; doesn't need `deploy/.env`. |
| `--rebuild` | Builds the core image even if one exists for this commit. |
| `--wait-ci` | If HEAD's CI run hasn't finished (or hasn't appeared yet), waits for it, polling every 30 s for up to `DEPLOY_CI_TIMEOUT` (3600 s), and deploys if it passes. |
| `--skip-ci` | Deploys without a passing CI run, after a loud warning that says what the CI state was. |
| `--backed-up` | You took your own backup: no automatic one. The rehearsal still runs, on a temporary dump that's deleted afterwards. |
| `--skip-rehearsal` | Takes the backup but doesn't rehearse the migrations. |
| `--rollback` | Puts `paperclip-fork:previous` back and restarts ([Rolling back](#rolling-back)). |
| `--rollback --force` | Rolls back even though the last deploy applied migrations, or was already rolled back. |

| Setting (environment) | Default |
| --- | --- |
| `DEPLOY_BACKUP_DIR` | `backups/` beside the checkout: `~/deployments/paperclip/backups` on server1. Holds the dumps and `last-deploy.env`. |
| `DEPLOY_BACKUP_KEEP` | 10: how many automatic dumps to keep. |
| `DEPLOY_BACKUP_MIN_FREE_MB` | 1024: free space to leave on the backup disk beyond the database's size. |
| `DEPLOY_HEALTH_TIMEOUT` | 300: seconds to wait for `/api/health` after the restart. |
| `DEPLOY_CI_TIMEOUT` | 3600: seconds `--wait-ci` waits. |

### The CI gate

`deploy.sh` asks GitHub (with `gh run list -R <origin's repo> --commit <HEAD> --workflow
test.yml`) for the newest Test run of the commit it's about to deploy. The repository comes from
the `origin` remote and is passed with `-R`, because `gh` on its own picks the `upstream` remote.
It stops when:

- **there's no run:** the commit isn't pushed (it says so when no remote branch has it), or CI
  hasn't started yet (`--wait-ci` waits for it to appear);
- **the run hasn't finished:** run again with `--wait-ci`;
- **the run failed or was cancelled:** it prints the jobs that didn't pass and the run's URL;
- **`gh` is missing or not logged in** (`gh auth login`).

To deploy anyway, for example when the only failure is a known flaky test, add `--skip-ci`. Look at
the failing job first (`gh run view <id> -R br1an-c0des/paperclip --log-failed`), or re-run it
(`gh run rerun <id> --failed -R br1an-c0des/paperclip`) and deploy with `--wait-ci`. A docs-only
commit gets a CI run like any other push, so it's gated too.

### Automatic backups

Migrations run when the server starts and don't run backwards, so restoring a backup is the only
way back from a deploy that adds one. When the deploy adds migrations, `deploy.sh` takes that
backup itself, after building and before the restart:

1. checks the backup disk has room for the whole database (its size from `pg_database_size`, an
   upper bound for the compressed dump) plus `DEPLOY_BACKUP_MIN_FREE_MB`;
2. dumps it with `docker compose exec -T db pg_dump -Fc -U paperclip paperclip` to
   `paperclip-YYYY-MM-DD-HHMM.dump` in `DEPLOY_BACKUP_DIR` (written as `.partial` until checked);
3. checks the dump isn't empty and that `pg_restore --list` reads it, in a throwaway container of
   the db service's Postgres image with no network (not in the production container);
4. prunes: keeps the newest `DEPLOY_BACKUP_KEEP` automatic dumps. It only removes dumps it took
   itself, which it lists in `.automatic-dumps` in the same folder; a dump you took by hand,
   even under the same name pattern, and every other file are left alone.

If any of these fails, it stops and nothing is deployed. With no new migrations, no backup is
taken. `--backed-up` skips it, for when you took one yourself ([Backups](#backups)).

### Migration rehearsal

After the backup, `deploy.sh` tries the new migrations on a copy of the production database before
they run for real:

1. creates a Docker network and a throwaway Postgres container on it (the db service's image,
   capped at 2 GB, no published port);
2. restores the fresh dump into it (`pg_restore --exit-on-error --no-owner`);
3. runs `packages/db`'s migrate script from the new `paperclip-core:<commit>` image against it:
   `tsx src/migrate.ts` in `/app/packages/db` (what `pnpm db:migrate` runs, without its numbering
   checks). It calls `applyPendingMigrations`, the same function the server calls at startup, and
   fails unless every migration is applied afterwards;
4. removes the containers and the network, on success, failure or Ctrl-C.

If the restore or a migration fails, it prints the output and stops: production is untouched and
nothing is deployed. Rehearsing migration 0491 on a dump of server1's database (4.8 MB) took under
20 seconds. `--skip-rehearsal` skips it.

### Rolling back

Before each restart, `deploy.sh` tags the image that was running `paperclip-fork:previous` (its
`paperclip-core:<commit>` stays too) and records the deploy in `last-deploy.env` next to the
backups. `deploy/deploy.sh --rollback` tags `paperclip-fork:previous` back as
`paperclip-fork:local`, recreates the server container, and runs the same health, commit and log
checks against the previous commit. `--rollback --dry-run` says what it would do. It refuses when
`paperclip-fork:previous` isn't the image `last-deploy.env` recorded, so a leftover tag never
starts the wrong server.

server1's Docker uses the containerd image store, which deletes an image when its last tag moves
away, even while a container runs it. `docker compose build server` moves `paperclip-fork:local` to
the new build, so `deploy.sh` holds the running image under `paperclip-fork:outgoing` before the
build and moves that tag to `paperclip-fork:previous` just before the restart. A deploy that stops
in between leaves `paperclip-fork:previous` and `last-deploy.env` as they were, so `--rollback`
still undoes the last deploy that went out; the outgoing tag stays on the running image until the
next deploy.

If the running image is already gone when a deploy starts (a deploy that stopped after the build
with an older `deploy.sh`, as on 2026-11-20, or a tag removed by hand), `deploy.sh` rebuilds it from
`paperclip-core:<its commit>` and that commit's own tree (`git archive <commit> | docker build -f
deploy/Dockerfile ... -`, not Compose, which would move `paperclip-fork:local`). When it can't (no
core image for that commit, the commit isn't in the clone, or the rebuild fails), it warns that
this deploy has no rollback image, removes any older `paperclip-fork:previous`, and records no
previous image, so `--rollback` refuses afterwards. The way back is then to deploy the old commit
again: `git checkout <commit> && deploy/deploy.sh`, then `git checkout main` for the next deploy.

It refuses when the deploy being rolled back applied migrations, or might have (its deployed
commit was unknown and the server's log didn't settle it). Migrations don't run backwards,
so the previous server would run against a schema it doesn't know; the way back is restoring the
backup taken before the deploy, whose path the refusal names, then rolling back with `--force`:

```bash
cd ~/deployments/paperclip/repo/deploy
docker compose stop server
docker compose exec -T db psql -U paperclip -d postgres -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE paperclip WITH (FORCE)' -c 'CREATE DATABASE paperclip'
docker compose exec -T db pg_restore -U paperclip -d paperclip --exit-on-error --no-owner \
  < ~/deployments/paperclip/backups/paperclip-YYYY-MM-DD-HHMM.dump
cd .. && deploy/deploy.sh --rollback --force
```

Everything written to the database since the backup is lost. Only one step back is kept: a
second `--rollback` is refused, and the next deploy tags whatever is running then as previous.

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
docker compose exec -T db pg_dump -Fc -U paperclip paperclip > ../../backups/paperclip-$(date +%Y-%m-%d-%H%M).dump
```

That's the command `deploy.sh` runs for its [automatic backups](#automatic-backups), in
`pg_dump`'s custom format, which `pg_restore` reads ([Rolling back](#rolling-back) restores one).
On server1, keep the dumps in `~/deployments/paperclip/backups/`; dumps you take by hand there are
never pruned.

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

## Testing deploy.sh

`deploy/tests/deploy-sh.test.sh` runs `deploy.sh` in a scratch git repo with fake `docker`, `gh`,
`curl` and `sleep` (`deploy/tests/stubs/`) first on `PATH`, so it touches no Docker, GitHub or
running Paperclip. The fakes record their calls, and each case checks the output, the calls and the
files left behind: the CI gate's every state, the backup and its failures (empty dump, unreadable
dump, low disk, no database), pruning, the rehearsal and its cleanup, the checks after the restart,
the previous image, and rollback. Like the containerd image store, the fake `docker` deletes an
image when its last tag goes, so a step that tags an image after the build moved its tag fails
there as it does on server1. Plain bash, no dependencies; it takes a few seconds:

```bash
deploy/tests/deploy-sh.test.sh            # every case
deploy/tests/deploy-sh.test.sh rollback   # the cases whose name contains "rollback"
```

Run it after changing `deploy.sh`, and `shellcheck` the script too (it isn't installed on server1;
`docker run --rm --network none -v "$PWD/deploy:/mnt:ro" koalaman/shellcheck:v0.10.0 deploy.sh`
works). It's not part of the CI workflow.

## Troubleshooting

- **Slow first start:** on first boot, or after changing `USER_UID`/`USER_GID`, the image's
  startup script checks ownership of every file under `/paperclip`. With many worktrees this can
  take minutes. Later boots skip the full check.
- **The core image build fails:** the output names the stage. Common causes: a change that
  breaks the server's TypeScript build;
  `pnpm-lock.yaml` behind a package manifest (the `runner-lockfile` stage says so and gives the
  command to run in the checkout); a new workspace package the server depends on, whose
  `package.json` the root `Dockerfile`'s `deps` stage doesn't copy yet (add a `COPY` line there);
  or a full disk (`docker system df`, then prune as above). Fix it on `main`, then deploy again.
  The running instance is untouched by a failed build.
- **`deploy.sh` stops at the CI gate:** see [The CI gate](#the-ci-gate); `--skip-ci` overrides.
- **The backup or the rehearsal fails:** nothing was deployed. A rehearsal failure means the
  migration fails on the real data: fix it on `main`. A leftover rehearsal container (only after
  a `kill -9`) is labelled `paperclip.deploy.rehearsal=1`:
  `docker rm -f -v $(docker ps -aq --filter label=paperclip.deploy.rehearsal=1)`.
- **The check after the restart fails:** the summary shows what failed and the last lines of the
  server log. `deploy/deploy.sh --rollback` puts the previous image back, unless migrations ran
  ([Rolling back](#rolling-back)).
- **Login fails or requests are rejected:** `PAPERCLIP_PUBLIC_URL` must match the URL in the
  browser exactly. Add extra hostnames to `PAPERCLIP_ALLOWED_HOSTNAMES`.
