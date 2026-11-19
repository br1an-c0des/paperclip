#!/usr/bin/env bash
# Applies the fork's git configuration to a fresh clone. Safe to run again.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

UPSTREAM_URL="https://github.com/paperclipai/paperclip.git"

if git remote get-url upstream >/dev/null 2>&1; then
  git remote set-url upstream "$UPSTREAM_URL"
else
  git remote add upstream "$UPSTREAM_URL"
fi
git config remote.upstream.fetch "+refs/heads/master:refs/remotes/upstream/master"
git config remote.upstream.pushurl DISABLE

git config rerere.enabled true
git config rerere.autoupdate true

# master mirrors upstream locally only: pushing it to origin would let GitHub run upstream's
# workflows in the fork (they are in master's .github/workflows). No checkout, so it is safe in a
# checkout the dev servers run from.
git config alias.sync-master '!f() { set -e; git fetch upstream; git merge-base --is-ancestor master upstream/master || { echo "master is not an ancestor of upstream/master: stopping" >&2; exit 1; }; git branch -f master upstream/master; git branch -q --set-upstream-to=upstream/master master; echo "master now at $(git rev-parse --short master), local only (never pushed to origin)"; }; f'
git config branch.master.pushRemote no_push

git fetch upstream
echo "Configured upstream (fetch master only, push disabled), rerere, and the sync-master alias (master mirrors upstream locally for /upstream-watch; never push it, never merge it into main)."
