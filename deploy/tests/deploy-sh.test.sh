#!/usr/bin/env bash
# Tests for deploy/deploy.sh, with fake docker, gh, curl and sleep (stubs/) on
# PATH: nothing here touches Docker, GitHub or a running Paperclip.
#
#   deploy/tests/deploy-sh.test.sh            run every case
#   deploy/tests/deploy-sh.test.sh rollback   run the cases whose name matches
#
# Each case runs deploy.sh in a scratch git repo with three commits:
#   A  packages/db/src/migrations/0001_a.sql
#   B  adds 0002_b.sql
#   C  a docs change (HEAD)
# "Deployed at B" means a deploy with no new migrations, "deployed at A" one
# that adds 0002_b.sql. The stubs record their calls in calls.log, which the
# cases check.
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
script=$here/../deploy.sh
compose_file=$here/../docker-compose.yml
filter=${1:-}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# --- The scratch repo ----------------------------------------------------------
site=$tmp/site
repo=$site/repo
mkdir -p "$repo/deploy" "$repo/packages/db/src/migrations"
git -C "$repo" init -q -b main
git -C "$repo" config user.email test@example.com
git -C "$repo" config user.name test
git -C "$repo" remote add origin https://github.com/test-owner/test-repo.git
git -C "$repo" remote add upstream https://github.com/paperclipai/paperclip.git
cp "$script" "$repo/deploy/deploy.sh"
cp "$compose_file" "$repo/deploy/docker-compose.yml"
echo "deploy/.env" > "$repo/.gitignore"
echo "select 1;" > "$repo/packages/db/src/migrations/0001_a.sql"
git -C "$repo" add -A && git -C "$repo" commit -q -m A
commit_a=$(git -C "$repo" rev-parse HEAD)
echo "select 2;" > "$repo/packages/db/src/migrations/0002_b.sql"
git -C "$repo" add -A && git -C "$repo" commit -q -m B
commit_b=$(git -C "$repo" rev-parse HEAD)
echo "docs" > "$repo/README.md"
git -C "$repo" add -A && git -C "$repo" commit -q -m C
commit_c=$(git -C "$repo" rev-parse HEAD)
printf 'PAPERCLIP_PORT=3999\nPOSTGRES_PASSWORD=x\n' > "$repo/deploy/.env"

# A PATH without gh, for the "gh missing" case: every tool but gh, plus stubs.
nogh=$tmp/nogh-bin
mkdir -p "$nogh"
for f in /usr/bin/* /usr/local/bin/*; do
  name=$(basename "$f")
  [ "$name" = gh ] || [ -e "$nogh/$name" ] || ln -s "$f" "$nogh/$name"
done
for f in docker curl sleep; do ln -sf "$here/stubs/$f" "$nogh/$f"; done

# --- Harness -------------------------------------------------------------------
passed=0
failed=0
failures=()
case_name=""
case_ok=true
out=""
code=0

key() { printf '%s' "$1" | tr ':/' '__'; }

# Fresh stub state and backups folder, with the server running the fork image
# of commit $1 (empty: nothing deployed, no container).
fresh() {
  state=$tmp/state
  rm -rf "$state" "$site/backups"
  mkdir -p "$state/images" "$state/commits"
  : > "$state/calls.log"
  if [ -n "${1:-}" ]; then
    seed_image "paperclip-fork:local" "sha256:fork-$1" "$1"
    cp "$state/images/paperclip-fork_local" "$state/running_server"
  fi
}

seed_image() { # ref id commit
  echo "$2" > "$state/images/$(key "$1")"
  echo "$3" > "$state/commits/$(key "$2")"
}

# Runs deploy.sh with the given environment assignments and arguments, e.g.
#   run STUB_CI=failure -- --dry-run
run() {
  local envs=()
  while [ $# -gt 0 ] && [ "$1" != -- ]; do envs+=("$1"); shift; done
  [ "${1:-}" = -- ] && shift
  out=$(cd "$repo" && env STUB_STATE="$state" PATH="${test_path:-$here/stubs:$PATH}" \
    DEPLOY_POLL_INTERVAL=1 DEPLOY_HEALTH_TIMEOUT=3 DEPLOY_BACKUP_MIN_FREE_MB=1 \
    "${envs[@]}" bash deploy/deploy.sh "$@" 2>&1)
  code=$?
}

begin() {
  case_name=$1
  case_ok=true
  test_path=""
}

fail() {
  case_ok=false
  echo "    FAIL: $*"
}

end() {
  if $case_ok; then
    passed=$((passed + 1))
    echo "ok    $case_name"
  else
    failed=$((failed + 1))
    failures+=("$case_name")
    echo "FAIL  $case_name"
    echo "$out" | sed 's/^/    | /'
    echo "    calls:"
    sed 's/^/    > /' "$state/calls.log"
  fi
}

selected() { [ -z "$filter" ] || [[ "$1" == *"$filter"* ]]; }

expect_exit() { [ "$code" -eq "$1" ] || fail "exit $code, expected $1"; }
expect_out() { grep -qF -- "$1" <<<"$out" || fail "output lacks: $1"; }
expect_no_out() { ! grep -qF -- "$1" <<<"$out" || fail "output has: $1"; }
expect_call() { grep -qE -- "$1" "$state/calls.log" || fail "no call matching: $1"; }
expect_no_call() { ! grep -qE -- "$1" "$state/calls.log" || fail "unexpected call matching: $1"; }
expect_file() { [ -e "$1" ] || fail "missing file: $1"; }
expect_no_file() { [ ! -e "$1" ] || fail "file should not exist: $1"; }
expect_state() { grep -qxF -- "$1" "$site/backups/last-deploy.env" 2>/dev/null || fail "last-deploy.env lacks: $1"; }
# Nothing that changes anything: builds, tags, compose build/up/exec, runs.
expect_read_only() {
  expect_no_call '^docker (build|tag|run|exec|rm|network)( |$)'
  expect_no_call '^docker compose (build|up|exec|down|stop|restart)'
  expect_no_file "$site/backups"
}
automatic_dumps() { find "$site/backups" -maxdepth 1 -name 'paperclip-*.dump' 2>/dev/null | wc -l; }

# --- Cases ---------------------------------------------------------------------

if selected "usage"; then
  begin "usage: --help lists every flag; bad options exit 2"
  fresh "$commit_b"
  run -- --help
  expect_exit 0
  for flag in --dry-run --rebuild --wait-ci --skip-ci --backed-up --skip-rehearsal --rollback --force \
      DEPLOY_BACKUP_DIR DEPLOY_BACKUP_KEEP DEPLOY_HEALTH_TIMEOUT DEPLOY_CI_TIMEOUT; do
    expect_out "$flag"
  done
  expect_no_out "set -euo"
  run -- --bogus
  expect_exit 2
  run -- --force
  expect_exit 2
  expect_out "--force only applies to --rollback"
  run DEPLOY_BACKUP_KEEP=ten -- --dry-run
  expect_exit 2
  end
fi

if selected "dry-run no migrations"; then
  begin "dry-run, no migrations, CI green: reports, changes nothing"
  fresh "$commit_b"
  run -- --dry-run
  expect_exit 0
  expect_out "CI:         passed"
  expect_out "Migrations: none added"
  expect_out "would tag sha256:fork-$commit_b"
  expect_out "http://127.0.0.1:3999/api/health"
  expect_no_out "Backup:"
  expect_call "^gh run list -R test-owner/test-repo --commit $commit_c --workflow test.yml"
  expect_read_only
  end
fi

if selected "dry-run migrations"; then
  begin "dry-run, migrations, CI red: reports the failure and the plan, exits 0"
  fresh "$commit_a"
  run STUB_CI=failure -- --dry-run
  expect_exit 0
  expect_out "CI for $commit_c didn't pass (failure)"
  expect_out "Thorough tier, shard 1/10: failure"
  expect_out "--skip-ci"
  expect_out "0002_b.sql"
  expect_out "would dump the database"
  expect_out "$site/backups/paperclip-"
  expect_out "would restore the dump into a throwaway postgres:17-alpine"
  expect_read_only
  end
fi

if selected "ci failure"; then
  begin "ci failure: stops before building, names the jobs, the URL and --skip-ci"
  fresh "$commit_b"
  run STUB_CI=failure --
  expect_exit 1
  expect_out "didn't pass (failure): https://github.com/test-owner/test-repo/actions/runs/101"
  expect_out "Thorough tier, shard 1/10"
  expect_out "run again with --skip-ci"
  expect_call "^gh run view 101 -R test-owner/test-repo"
  expect_read_only
  end

  begin "ci cancelled: stops"
  fresh "$commit_b"
  run STUB_CI=cancelled --
  expect_exit 1
  expect_out "(cancelled)"
  expect_read_only
  end
fi

if selected "ci none"; then
  begin "ci none: says the commit isn't pushed"
  fresh "$commit_b"
  run STUB_CI=none --
  expect_exit 1
  expect_out "no Test workflow run"
  expect_out "push it first"
  expect_read_only
  end
fi

if selected "ci running"; then
  begin "ci running: stops and offers --wait-ci"
  fresh "$commit_b"
  run STUB_CI=in_progress --
  expect_exit 1
  expect_out "still running (in_progress)"
  expect_out "--wait-ci"
  expect_read_only
  end

  begin "ci running, --wait-ci: polls until it passes, then deploys"
  fresh "$commit_b"
  run STUB_CI=none,queued,in_progress,success -- --wait-ci
  expect_exit 0
  expect_out "waiting for a CI run to appear"
  expect_out "CI is in_progress"
  expect_out "CI:         passed"
  expect_call "^docker compose up -d --no-build"
  end

  begin "ci running, --wait-ci, ends red: stops"
  fresh "$commit_b"
  run STUB_CI=in_progress,failure -- --wait-ci
  expect_exit 1
  expect_out "didn't pass (failure)"
  expect_no_call "^docker compose up"
  end

  begin "ci running, --wait-ci, times out: stops"
  fresh "$commit_b"
  run STUB_CI=in_progress DEPLOY_CI_TIMEOUT=2 DEPLOY_CI_POLL_INTERVAL=1 -- --wait-ci
  expect_exit 1
  expect_out "still running"
  expect_no_call "^docker compose up"
  end
fi

if selected "gh"; then
  begin "gh not logged in: stops; --skip-ci warns and deploys"
  fresh "$commit_b"
  run STUB_GH_AUTH=no --
  expect_exit 1
  expect_out "gh isn't logged in"
  expect_read_only
  run STUB_GH_AUTH=no -- --skip-ci
  expect_exit 0
  expect_out "WARNING: deploying without a green CI run."
  expect_out "gh isn't logged in"
  expect_call "^docker compose up"
  end

  begin "gh missing: stops"
  fresh "$commit_b"
  test_path=$nogh
  run --
  expect_exit 1
  expect_out "gh (the GitHub CLI) isn't installed"
  expect_read_only
  end
fi

if selected "deploy no migrations"; then
  begin "deploy, no migrations: no backup, tags previous, restarts, verifies"
  fresh "$commit_b"
  run --
  expect_exit 0
  expect_out "Core image: paperclip-core:$commit_c (build: no image for this commit yet)"
  expect_call "^docker build --target production .* -t paperclip-core:$commit_c \.$"
  expect_call "^docker compose build server$"
  expect_call "^docker tag sha256:fork-$commit_b paperclip-fork:previous$"
  expect_call "^docker compose up -d --no-build$"
  expect_no_call "pg_dump|pg_restore|network create"
  expect_out "Migrations:  none"
  expect_out "Backup:      none (no migrations)"
  expect_out "the server reports commit $commit_c"
  expect_out "Error lines: none"
  expect_state "commit=$commit_c"
  expect_state "previous_commit=$commit_b"
  expect_state "migrations=none"
  expect_state "status=ok"
  [ "$(cat "$state/images/paperclip-fork_previous")" = "sha256:fork-$commit_b" ] || fail "previous not tagged"
  # Order: build before tag before up.
  order=$(grep -nE '^docker (compose build|tag|compose up)' "$state/calls.log" | cut -d: -f1 | paste -sd ' ')
  read -r o1 o2 o3 <<<"$order"
  [ "$o1" -lt "$o2" ] && [ "$o2" -lt "$o3" ] || fail "order of build, tag, up: $order"
  end

  begin "deploy, core image exists: reused, not rebuilt"
  fresh "$commit_b"
  seed_image "paperclip-core:$commit_c" "sha256:core-$commit_c" "$commit_c"
  run --
  expect_exit 0
  expect_out "(already built; pass --rebuild"
  expect_no_call "^docker build"
  run -- --rebuild
  expect_call "^docker build"
  end
fi

if selected "deploy migrations"; then
  begin "deploy, migrations: backup, verify, prune, rehearse, then restart"
  fresh "$commit_a"
  mkdir -p "$site/backups"
  # A dump taken by hand with the automatic naming, and an unrelated file:
  # neither is in the manifest, so pruning leaves them alone.
  echo manual > "$site/backups/paperclip-2020-01-01-0000.dump"
  echo notes > "$site/backups/notes.txt"
  for d in 2021-01-01-0001 2021-01-02-0001 2021-01-03-0001 2021-01-04-0001; do
    echo old > "$site/backups/paperclip-$d.dump"
    echo "paperclip-$d.dump" >> "$site/backups/.automatic-dumps"
  done
  # A listed name that doesn't match the pattern is never removed.
  echo keep > "$site/backups/precious.dump"
  echo "precious.dump" >> "$site/backups/.automatic-dumps"
  touch "$state/migrations_pending"
  run DEPLOY_BACKUP_KEEP=3 --
  expect_exit 0
  expect_out "Migrations: this deploy adds database migrations"
  expect_call "^docker compose exec -T db pg_dump -Fc -U paperclip paperclip$"
  expect_call "^docker run --rm -i --network none --memory 512m postgres:17-alpine pg_restore --list$"
  expect_call "^docker network create .*paperclip-rehearsal-"
  expect_call "^docker run -d --name paperclip-rehearsal-[0-9]+-[0-9]+-db .*--memory 2g .*postgres:17-alpine$"
  expect_call "^docker exec -i paperclip-rehearsal-.*pg_restore -U paperclip -d paperclip --exit-on-error --no-owner$"
  expect_call "^docker run --rm --name paperclip-rehearsal-.*-migrate .*--entrypoint /app/packages/db/node_modules/.bin/tsx .*paperclip-core:$commit_c src/migrate.ts$"
  expect_call "^docker rm -f -v paperclip-rehearsal-.*-db$"
  expect_call "^docker network rm paperclip-rehearsal-"
  [ -z "$(ls "$state/containers" 2>/dev/null)" ] || fail "rehearsal containers left: $(ls "$state/containers")"
  [ -z "$(ls "$state/networks" 2>/dev/null)" ] || fail "rehearsal networks left: $(ls "$state/networks")"
  expect_out "Migrations complete"
  expect_out "Rehearsal:   passed"
  expect_out "Migrations:  0002_b.sql (server: Applying 1 pending migrations)"
  backup=$(sed -n 's/^backup=//p' "$site/backups/last-deploy.env")
  [[ "$(basename "$backup")" =~ ^paperclip-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}\.dump$ ]] || fail "backup name: $backup"
  expect_file "$backup"
  expect_out "Backup:      $backup"
  expect_state "migrations=0002_b.sql"
  expect_state "status=ok"
  expect_file "$site/backups/paperclip-2020-01-01-0000.dump"
  expect_file "$site/backups/notes.txt"
  expect_file "$site/backups/precious.dump"
  expect_no_file "$site/backups/paperclip-2021-01-01-0001.dump"
  expect_no_file "$site/backups/paperclip-2021-01-02-0001.dump"
  expect_file "$site/backups/paperclip-2021-01-03-0001.dump"
  expect_file "$site/backups/paperclip-2021-01-04-0001.dump"
  [ "$(wc -l < "$site/backups/.automatic-dumps")" -eq 3 ] || fail "manifest: $(cat "$site/backups/.automatic-dumps")"
  [ -z "$(find "$site/backups" -name "*.partial" 2>/dev/null)" ] || fail "partial dump left"
  # Order: dump before rehearsal before tag before up.
  order=$(grep -nE '^docker (compose exec -T db pg_dump|network create|tag|compose up)' "$state/calls.log" \
    | cut -d: -f1 | paste -sd ' ')
  read -r o1 o2 o3 o4 <<<"$order"
  [ "$o1" -lt "$o2" ] && [ "$o2" -lt "$o3" ] && [ "$o3" -lt "$o4" ] || fail "order of dump, rehearsal, tag, up: $order"
  end

  begin "deploy, migrations, DEPLOY_BACKUP_DIR: dumps go there"
  fresh "$commit_a"
  run DEPLOY_BACKUP_DIR="$tmp/elsewhere" --
  expect_exit 0
  [ "$(find "$tmp/elsewhere" -name 'paperclip-*.dump' | wc -l)" -eq 1 ] || fail "no dump in DEPLOY_BACKUP_DIR"
  expect_file "$tmp/elsewhere/last-deploy.env"
  expect_no_file "$site/backups"
  rm -rf "$tmp/elsewhere"
  end
fi

if selected "backup"; then
  begin "backup, empty dump: stops before restarting, removes it"
  fresh "$commit_a"
  run STUB_DUMP=empty --
  expect_exit 1
  expect_out "the dump is empty"
  expect_no_call "^docker compose up|^docker tag|network create"
  [ "$(automatic_dumps)" -eq 0 ] || fail "a dump was kept"
  [ -z "$(find "$site/backups" -name "*.partial" 2>/dev/null)" ] || fail "partial dump left"
  end

  begin "backup, pg_dump fails: stops"
  fresh "$commit_a"
  run STUB_DUMP=fail --
  expect_exit 1
  expect_out "pg_dump failed"
  expect_no_call "^docker compose up"
  [ "$(automatic_dumps)" -eq 0 ] || fail "a dump was kept"
  end

  begin "backup, pg_restore --list fails: stops"
  fresh "$commit_a"
  run STUB_RESTORE_LIST=fail --
  expect_exit 1
  expect_out "pg_restore --list couldn't read the dump"
  expect_no_call "^docker compose up|network create"
  [ "$(automatic_dumps)" -eq 0 ] || fail "a dump was kept"
  end

  begin "backup, pg_restore --list empty: stops"
  fresh "$commit_a"
  run STUB_RESTORE_LIST=empty --
  expect_exit 1
  expect_out "found nothing in the dump"
  expect_no_call "^docker compose up"
  end

  begin "backup, low disk: stops before dumping"
  fresh "$commit_a"
  run DEPLOY_BACKUP_MIN_FREE_MB=999999999 --
  expect_exit 1
  expect_out "not enough disk space"
  expect_no_call "pg_dump|^docker compose up"
  end

  begin "backup, db not running: stops"
  fresh "$commit_a"
  run STUB_DB_RUNNING=0 --
  expect_exit 1
  expect_out "the db container isn't running"
  expect_no_call "^docker compose up"
  end

  begin "backup, --backed-up: no saved dump, rehearsal on a temporary one"
  fresh "$commit_a"
  run -- --backed-up
  expect_exit 0
  expect_out "skipped (--backed-up"
  expect_out "taking a temporary dump to rehearse on"
  expect_call "pg_dump"
  expect_call "src/migrate.ts"
  [ "$(automatic_dumps)" -eq 0 ] || fail "a dump was saved"
  expect_out "Backup:      your own (--backed-up)"
  expect_state "migrations=0002_b.sql"
  end

  begin "backup, --backed-up --skip-rehearsal: no dump at all"
  fresh "$commit_a"
  run -- --backed-up --skip-rehearsal
  expect_exit 0
  expect_no_call "pg_dump|src/migrate.ts"
  expect_out "Rehearsal:   skipped (--skip-rehearsal)"
  end

  begin "backup, deployed commit unknown: backs up and rehearses anyway"
  fresh ""
  seed_image "paperclip-fork:local" "sha256:fork-unknown" "0000000000000000000000000000000000000000"
  cp "$state/images/paperclip-fork_local" "$state/running_server"
  run --
  expect_exit 0
  expect_out "Deployed:   unknown"
  expect_call "pg_dump"
  expect_call "src/migrate.ts"
  expect_state "migrations=none"
  end

  begin "backup, first deploy (nothing running): no backup"
  fresh ""
  run STUB_DB_RUNNING=0 --
  expect_exit 0
  expect_out "a first deploy"
  expect_no_call "pg_dump|^docker tag"
  end
fi

if selected "rehearsal"; then
  begin "rehearsal, migration fails: stops with its output, cleans up, production untouched"
  fresh "$commit_a"
  run STUB_MIGRATE=fail --
  expect_exit 1
  expect_out "column \"access_level\" of relation \"agents\" already exists"
  expect_out "the migrations failed on a copy of the production database"
  expect_no_call "^docker compose up|^docker tag"
  expect_call "^docker rm -f -v paperclip-rehearsal-.*-migrate$"
  expect_call "^docker rm -f -v paperclip-rehearsal-.*-db$"
  expect_call "^docker network rm paperclip-rehearsal-"
  [ -z "$(ls "$state/containers" 2>/dev/null)" ] || fail "rehearsal containers left"
  [ -z "$(ls "$state/networks" 2>/dev/null)" ] || fail "rehearsal networks left"
  [ "$(automatic_dumps)" -eq 1 ] || fail "the backup should be kept"
  expect_no_file "$site/backups/last-deploy.env"
  end

  begin "rehearsal, restore fails: stops, cleans up"
  fresh "$commit_a"
  run STUB_REHEARSAL_RESTORE=fail --
  expect_exit 1
  expect_out "restoring the dump into the rehearsal database failed"
  expect_no_call "src/migrate.ts|^docker compose up"
  [ -z "$(ls "$state/containers" 2>/dev/null)" ] || fail "rehearsal containers left"
  [ -z "$(ls "$state/networks" 2>/dev/null)" ] || fail "rehearsal networks left"
  end

  begin "rehearsal, --skip-rehearsal: backup only"
  fresh "$commit_a"
  run -- --skip-rehearsal
  expect_exit 0
  expect_call "pg_dump"
  expect_no_call "network create|src/migrate.ts"
  expect_out "Rehearsal:   skipped (--skip-rehearsal)"
  end
fi

if selected "verify"; then
  begin "verify, health never answers: exits 1, suggests --rollback"
  fresh "$commit_b"
  run STUB_HEALTH=down --
  expect_exit 1
  expect_out "Health:      no answer from http://127.0.0.1:3999/api/health within 3s"
  expect_out "Last lines of the server log"
  expect_out "--rollback puts $commit_b back"
  expect_state "status=failed"
  end

  begin "verify, health slow: waits, then passes"
  fresh "$commit_b"
  run STUB_HEALTH_DOWN_FIRST=2 --
  expect_exit 0
  expect_out "Health:      ok after 2s"
  end

  begin "verify, wrong commit: exits 1"
  fresh "$commit_b"
  run STUB_HEALTH_COMMIT=deadbeef --
  expect_exit 1
  expect_out "the server reports commit 'deadbeef', not $commit_c"
  expect_state "status=failed"
  end

  begin "verify, error lines in the log: reported, not fatal"
  fresh "$commit_b"
  run 'STUB_LOGS={"level":50,"time":4,"msg":"boom"}\n{"level":60,"time":5,"msg":"fatal boom"}\n[12:00:00.000] \033[31mERROR\033[39m (7): pretty boom\n{"level":30,"msg":"ERROR in a message is not an error line"}' --
  expect_exit 0
  expect_out "Error lines: 3 (below)"
  expect_out '"msg":"boom"'
  expect_out "pretty boom"
  expect_no_out "is not an error line"
  end

  begin "verify, failed after migrations: points at the backup, not --rollback"
  fresh "$commit_a"
  run STUB_HEALTH=down --
  expect_exit 1
  expect_out "it applied migrations, so --rollback alone won't do"
  expect_state "migrations=0002_b.sql"
  end

  begin "verify, compose up fails: the record says migrations may have run"
  fresh "$commit_a"
  run STUB_UP=fail --
  expect_exit 1
  expect_state "status=starting"
  expect_state "migrations=0002_b.sql"
  end
fi

if selected "rollback"; then
  begin "rollback after a deploy without migrations: puts previous back"
  fresh "$commit_b"
  run --
  expect_exit 0
  : > "$state/calls.log"
  run -- --rollback --dry-run
  expect_exit 0
  expect_out "would tag paperclip-fork:previous as paperclip-fork:local"
  expect_no_call "^docker tag paperclip-fork:previous"
  run -- --rollback
  expect_exit 0
  expect_call "^docker tag paperclip-fork:previous paperclip-fork:local$"
  expect_call "^docker compose up -d --no-build --force-recreate server$"
  expect_out "the server reports commit $commit_b"
  expect_out "rolled back from $commit_c"
  expect_state "status=rolled-back"
  expect_state "commit=$commit_b"
  [ "$(cat "$state/running_server")" = "sha256:fork-$commit_b" ] || fail "not running previous"
  expect_no_call "^gh "
  end

  begin "rollback twice: the second is refused"
  run -- --rollback
  expect_exit 1
  expect_out "already rolled back"
  end

  begin "rollback after a deploy with migrations: refused, names the backup; --force goes ahead"
  fresh "$commit_a"
  run --
  expect_exit 0
  backup=$(sed -n 's/^backup=//p' "$site/backups/last-deploy.env")
  : > "$state/calls.log"
  run -- --rollback
  expect_exit 1
  expect_out "applied database migrations (0002_b.sql), which don't run backwards"
  expect_out "restoring the backup taken before it ($backup)"
  expect_no_call "^docker (tag|compose)"
  run -- --rollback --force
  expect_exit 0
  expect_out "Rolling back anyway (--force)"
  expect_call "^docker tag paperclip-fork:previous paperclip-fork:local$"
  expect_state "status=rolled-back"
  end

  begin "rollback, no record: refused"
  fresh "$commit_b"
  run -- --rollback
  expect_exit 1
  expect_out "no record of a deploy"
  end

  begin "rollback, health fails: exits 1"
  fresh "$commit_b"
  run --
  run STUB_HEALTH=down -- --rollback
  expect_exit 1
  expect_out "the rolled-back server didn't come up healthy"
  end
fi

echo ""
echo "$passed passed, $failed failed"
if [ "$failed" -gt 0 ]; then
  printf '  %s\n' "${failures[@]}"
  exit 1
fi
