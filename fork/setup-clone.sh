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

git config alias.sync-master '!f() { set -e; cur=$(git branch --show-current); git fetch upstream; git checkout -q master; git merge --ff-only upstream/master; git push origin master; git checkout -q "$cur"; echo "master now at $(git rev-parse --short master); you are on $cur"; }; f'
git config alias.sync-ui '!f() { set -e; git sync-master; git checkout new-ui; git merge master --no-edit; echo "Merged master into new-ui. Run tests, then: git push"; }; f'

git fetch upstream
echo "Configured upstream (fetch master only, push disabled), rerere, and the sync-master / sync-ui aliases."
