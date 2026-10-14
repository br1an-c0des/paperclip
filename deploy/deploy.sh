#!/usr/bin/env bash
# Build the fork image on top of the matching upstream image and (re)start the
# stack. Run from anywhere inside the repo checkout on the server.
#
#   deploy/deploy.sh             build + start (or restart with the new image)
#   deploy/deploy.sh --dry-run   only print which upstream image would be used
#
# The base is the newest upstream commit already merged into this branch that
# upstream published an image for (ghcr.io/paperclipai/paperclip:sha-<commit>).
set -euo pipefail

cd "$(dirname "$0")"

dry_run=false
[ "${1:-}" = "--dry-run" ] && dry_run=true

# This fork's master mirrors upstream, so origin/master works on a server
# clone that has no `upstream` remote. Prefer upstream/master when present.
if git rev-parse -q --verify upstream/master >/dev/null; then
  mirror=upstream/master
else
  mirror=origin/master
fi
base=$(git merge-base HEAD "$mirror")

token=$(curl -fsS "https://ghcr.io/token?scope=repository:paperclipai/paperclip:pull" \
  | sed -E 's/.*"token":"([^"]+)".*/\1/')

upstream_sha=""
for sha in $(git rev-list --first-parent --max-count=50 "$base"); do
  status=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
    "https://ghcr.io/v2/paperclipai/paperclip/manifests/sha-$sha")
  if [ "$status" = 200 ]; then
    upstream_sha=$sha
    break
  fi
done

if [ -z "$upstream_sha" ]; then
  echo "No published upstream image found within 50 commits of $base." >&2
  exit 1
fi

echo "Merged upstream commit: $base"
echo "Base image:             ghcr.io/paperclipai/paperclip:sha-$upstream_sha"
if [ "$upstream_sha" != "$base" ]; then
  echo "Note: no image for the merged commit itself; using the nearest older one." >&2
fi

$dry_run && exit 0

if [ ! -f .env ]; then
  echo "deploy/.env not found. Copy deploy/.env.example and fill it in." >&2
  exit 1
fi

export UPSTREAM_SHA=$upstream_sha
docker compose up -d --build
docker compose ps
