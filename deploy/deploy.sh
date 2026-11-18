#!/usr/bin/env bash
# Build the fork image from this checkout's source and (re)start the stack.
# Run from anywhere inside the repo checkout on the server.
#
#   deploy/deploy.sh             build (if needed) + start, or restart with the new image
#   deploy/deploy.sh --rebuild   rebuild the core image even if one exists for this commit
#   deploy/deploy.sh --dry-run   only print what would be built
#   deploy/deploy.sh --backed-up  confirm the database is backed up, when the
#                                 deploy adds migrations (it stops otherwise)
#
# Two images:
#   paperclip-core:<commit>  the repo's root Dockerfile, target `production`
#                            (server, Paperclip Runner, agent CLIs); built here
#                            once per commit and skipped when the tag exists.
#   paperclip-fork:local     deploy/Dockerfile: the core image with ui-new in
#                            place of the React UI; built by Compose.
set -euo pipefail

usage() {
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
}

dry_run=false
rebuild=false
backed_up=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --rebuild) rebuild=true ;;
    --backed-up) backed_up=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

repo_root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$repo_root"

commit=$(git rev-parse HEAD)
core_image="paperclip-core:$commit"
# The root Dockerfile installs the agent CLIs (Claude Code, Codex, ...) at
# @latest in a cached layer. Upstream's CI passes the ISO week here so the CLIs
# move forward weekly; without it the layer, and the CLIs, never change.
cli_tools_epoch=$(date -u +%G-W%V)

# The image is built from the working tree, not from the commit, so local
# changes would end up in an image tagged with a commit that doesn't have them.
if [ -n "$(git status --porcelain)" ]; then
  echo "Warning: the checkout has uncommitted or untracked files, which go into the image." >&2
  echo "         Building the core image again so the tag isn't reused for a different tree." >&2
  rebuild=true
fi

if $rebuild; then
  build_core=true
  reason="--rebuild or a changed working tree"
elif docker image inspect "$core_image" >/dev/null 2>&1; then
  build_core=false
  reason="already built"
else
  build_core=true
  reason="no image for this commit yet"
fi

echo "Commit:     $commit"
if $build_core; then
  echo "Core image: $core_image (build: $reason)"
  echo "            docker build --target production --build-arg CLI_TOOLS_CACHE_EPOCH=$cli_tools_epoch -t $core_image ."
else
  echo "Core image: $core_image ($reason; pass --rebuild to build it again)"
fi
echo "Fork image: paperclip-fork:local (deploy/Dockerfile FROM $core_image, with ui-new), via docker compose up -d --build"

# Migrations don't run backwards, so a deploy that adds one needs a database
# backup first. The deployed image carries its server's commit in
# PAPERCLIP_BUILD_COMMIT (upstream's images did too), so compare against that.
deployed=$(docker image inspect paperclip-fork:local \
  --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
  | sed -n 's/^PAPERCLIP_BUILD_COMMIT=//p' || true)
if [ -n "$deployed" ] && git cat-file -e "$deployed^{commit}" 2>/dev/null; then
  echo "Deployed:   $deployed"
  new_migrations=$(git diff --name-only --diff-filter=A "$deployed" HEAD -- packages/db/src/migrations \
    | grep '\.sql$' || true)
  if [ -n "$new_migrations" ]; then
    echo "This deploy adds database migrations, which don't run backwards:" >&2
    echo "$new_migrations" | sed 's/^/  /' >&2
    if ! $backed_up && ! $dry_run; then
      echo "Back up the database first (deploy/README.md, Backups), then run again with --backed-up." >&2
      exit 1
    fi
  fi
else
  echo "Deployed:   unknown (no paperclip-fork:local image, or its commit isn't in this clone)."
  echo "            If this deploy adds a migration, back up the database first."
fi

$dry_run && exit 0

if [ ! -f deploy/.env ]; then
  echo "deploy/.env not found. Copy deploy/.env.example and fill it in." >&2
  exit 1
fi

if $build_core; then
  # PAPERCLIP_BUILD_COMMIT is deliberately not passed: in the root Dockerfile
  # it also builds the remote provider pack (about 2.5 GB of provider binaries
  # for cloud and sandbox runs, which this setup doesn't use). deploy/Dockerfile
  # sets the commit for the server instead.
  docker build --target production \
    --build-arg CLI_TOOLS_CACHE_EPOCH="$cli_tools_epoch" \
    -t "$core_image" .
fi

cd deploy
# Read by docker-compose.yml: the base image for deploy/Dockerfile, and the
# commit stamped into ui-new and reported by the server (the build context has
# no .git).
export BASE_IMAGE=$core_image
export BUILD_COMMIT=$commit
docker compose up -d --build
docker compose ps
