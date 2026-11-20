#!/usr/bin/env bash
# Build the fork image from this checkout's source and (re)start the stack,
# with the checks a production deploy needs. Run from anywhere inside the repo
# checkout on the server.
#
#   deploy/deploy.sh                   check CI, build, back up and rehearse (when the
#                                      deploy adds migrations), start, verify
#   deploy/deploy.sh --dry-run         report what each stage would do; changes nothing
#   deploy/deploy.sh --rebuild         rebuild the core image even if one exists for this commit
#   deploy/deploy.sh --wait-ci         wait for HEAD's CI run to finish instead of stopping
#   deploy/deploy.sh --skip-ci         deploy without a green CI run (prints a warning)
#   deploy/deploy.sh --backed-up       you took your own backup: skip the automatic one
#   deploy/deploy.sh --skip-rehearsal  don't rehearse new migrations on a copy of the database
#   deploy/deploy.sh --rollback        put the previous image back and restart (refused
#                                      when the last deploy applied migrations)
#   deploy/deploy.sh --rollback --force  roll back anyway (after restoring the backup)
#
# Settings, from the environment:
#   DEPLOY_BACKUP_DIR          dumps and the last-deploy record (last-deploy.env);
#                              default: backups/ beside the checkout
#                              (~/deployments/paperclip/backups on server1)
#   DEPLOY_BACKUP_KEEP         automatic dumps to keep (default 10)
#   DEPLOY_BACKUP_MIN_FREE_MB  free space to leave beyond the database's size (default 1024)
#   DEPLOY_HEALTH_TIMEOUT      seconds to wait for /api/health after the restart (default 300)
#   DEPLOY_CI_TIMEOUT          seconds --wait-ci waits for the CI run (default 3600)
#
# Two images:
#   paperclip-core:<commit>  the repo's root Dockerfile, target `production`
#                            (server, Paperclip Runner, agent CLIs); built here
#                            once per commit and skipped when the tag exists.
#   paperclip-fork:local     deploy/Dockerfile: the core image with ui-new in
#                            place of the React UI; built by Compose.
#   paperclip-fork:previous  the image that was running before the last deploy,
#                            for --rollback.
#   paperclip-fork:outgoing  the image running when a deploy started, held
#                            through the build (see "Keep what's running now").
set -euo pipefail

# Prints the comment block above, up to "Two images".
usage() {
  awk 'NR == 1 { next } /^# Two images/ { exit } { sub(/^# ?/, ""); print }' "$0"
}

dry_run=false
rebuild=false
backed_up=false
skip_ci=false
wait_ci=false
skip_rehearsal=false
rollback=false
force=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --rebuild) rebuild=true ;;
    --backed-up) backed_up=true ;;
    --skip-ci) skip_ci=true ;;
    --wait-ci) wait_ci=true ;;
    --skip-rehearsal) skip_rehearsal=true ;;
    --rollback) rollback=true ;;
    --force) force=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 2 ;;
  esac
done
if $force && ! $rollback; then
  echo "--force only applies to --rollback." >&2
  exit 2
fi

repo_root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$repo_root"

# The Compose project (`name:` in deploy/docker-compose.yml). Containers are
# found by its labels with plain `docker ps`, so read-only stages (and
# --dry-run) never need Compose or deploy/.env.
compose_project=paperclip
backup_dir=${DEPLOY_BACKUP_DIR:-$(dirname "$repo_root")/backups}
backup_keep=${DEPLOY_BACKUP_KEEP:-10}
min_free_mb=${DEPLOY_BACKUP_MIN_FREE_MB:-1024}
health_timeout=${DEPLOY_HEALTH_TIMEOUT:-300}
ci_timeout=${DEPLOY_CI_TIMEOUT:-3600}
# Seconds between polls of CI and /api/health (the tests set it to 1).
poll_interval=${DEPLOY_POLL_INTERVAL:-5}
ci_poll_interval=${DEPLOY_CI_POLL_INTERVAL:-30}
# What the last deploy did, for --rollback: key=value lines, read with sed
# rather than sourced.
state_file=$backup_dir/last-deploy.env
# The dumps this script took. Pruning only ever removes names listed here, so a
# dump you took by hand under the same naming pattern is never touched.
auto_manifest=$backup_dir/.automatic-dumps
auto_dump_pattern='^paperclip-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}\.dump$'

for setting in backup_keep min_free_mb health_timeout ci_timeout poll_interval ci_poll_interval; do
  case "${!setting}" in
    ''|*[!0-9]*) echo "deploy.sh: $setting must be a whole number, got '${!setting}'." >&2; exit 2 ;;
  esac
done

die() {
  echo "" >&2
  echo "deploy.sh: $*" >&2
  exit 1
}

# Everything this run creates for itself and must not leave behind, removed on
# any exit: the rehearsal's containers and network, and temporary files.
rehearsal_db=""
rehearsal_migrate=""
rehearsal_net=""
temp_files=()
cleanup() {
  if [ -n "$rehearsal_migrate" ]; then docker rm -f -v "$rehearsal_migrate" >/dev/null 2>&1 || true; fi
  if [ -n "$rehearsal_db" ]; then docker rm -f -v "$rehearsal_db" >/dev/null 2>&1 || true; fi
  if [ -n "$rehearsal_net" ]; then docker network rm "$rehearsal_net" >/dev/null 2>&1 || true; fi
  rehearsal_migrate="" rehearsal_db="" rehearsal_net=""
  if [ "${#temp_files[@]}" -gt 0 ]; then rm -f -- "${temp_files[@]}"; fi
  temp_files=()
}
trap cleanup EXIT
# Without these, bash skips the EXIT trap when it's killed by a signal.
trap 'exit 130' INT
trap 'exit 143' TERM

# --- Small lookups -----------------------------------------------------------

# The commit an image's server reports: deploy/Dockerfile sets it as
# PAPERCLIP_BUILD_COMMIT (upstream's images did too).
image_commit() {
  docker image inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | sed -n 's/^PAPERCLIP_BUILD_COMMIT=//p' || true
}

image_id() {
  docker image inspect "$1" --format '{{.Id}}' 2>/dev/null || true
}

# The commit a container's server reports, from the container's own
# environment, which it keeps even when its image is gone.
container_commit() {
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null \
    | sed -n 's/^PAPERCLIP_BUILD_COMMIT=//p' || true
}

# Removes the tag $1 if it exists. Only the tag: an image with other tags keeps
# them.
drop_tag() {
  [ -n "$(image_id "$1")" ] || return 0
  docker rmi "$1" >/dev/null \
    || echo "Warning:    couldn't remove the tag $1 (docker rmi $1)." >&2
}

# The running container of a Compose service, by the labels Compose puts on it.
compose_container() {
  docker ps -q \
    --filter "label=com.docker.compose.project=$compose_project" \
    --filter "label=com.docker.compose.service=$1" | head -n 1
}

# A value from deploy/.env, without sourcing the file (it holds secrets, and
# isn't shell).
env_setting() {
  local value=""
  if [ -f deploy/.env ]; then
    value=$(sed -n "s/^$1=//p" deploy/.env | tail -n 1)
    value=${value%\"}
    value=${value#\"}
  fi
  echo "${value:-$2}"
}

# The Postgres image the db service runs: the running container's, which made
# the dumps, else the one in docker-compose.yml.
db_image() {
  local ctr
  ctr=$(compose_container db)
  if [ -n "$ctr" ]; then
    docker inspect --format '{{.Config.Image}}' "$ctr"
  else
    awk '/^  db:/ { in_db = 1; next } /^  [a-z]/ { in_db = 0 } in_db && /image:/ { print $2; exit }' \
      deploy/docker-compose.yml
  fi
}

health_url() {
  local addr port
  addr=$(env_setting PAPERCLIP_BIND_ADDR 127.0.0.1)
  port=$(env_setting PAPERCLIP_PORT 3100)
  [ "$addr" = "0.0.0.0" ] && addr=127.0.0.1
  echo "http://$addr:$port/api/health"
}

state_get() {
  if [ -f "$state_file" ]; then
    sed -n "s/^$1=//p" "$state_file" | tail -n 1
  fi
}

# Writes the last-deploy record: one key=value pair per argument.
state_write() {
  mkdir -p "$backup_dir"
  printf '%s\n' "$@" > "$state_file.tmp"
  mv "$state_file.tmp" "$state_file"
}

# Free MB on the disk that holds $1, or its nearest existing parent.
free_mb_near() {
  local dir=$1
  while [ ! -d "$dir" ]; do dir=$(dirname "$dir"); done
  df -Pk "$dir" | awk 'NR == 2 { print int($4 / 1024) }'
}

require_env_file() {
  if [ ! -f deploy/.env ]; then
    die "deploy/.env not found. Copy deploy/.env.example and fill it in."
  fi
}

# --- CI gate -----------------------------------------------------------------

# owner/repo of the `origin` remote. gh is always given -R: on its own it picks
# the `upstream` remote, which is paperclipai/paperclip.
github_repo() {
  local url
  url=$(git remote get-url origin 2>/dev/null) || return 1
  url=${url%.git}
  case "$url" in
    https://github.com/*) echo "${url#https://github.com/}" ;;
    git@github.com:*) echo "${url#git@github.com:}" ;;
    ssh://git@github.com/*) echo "${url#ssh://git@github.com/}" ;;
    *) return 1 ;;
  esac
}

# Sets ci_status, ci_conclusion, ci_run_id and ci_run_url from the newest run of
# the Test workflow for HEAD; ci_status is "none" when there is no run.
ci_lookup() {
  local line
  line=$(gh run list -R "$ci_repo" --commit "$commit" --workflow test.yml --limit 1 \
    --json status,conclusion,databaseId,url \
    --jq '.[0] | select(.) | [.status, (if (.conclusion // "") == "" then "-" else .conclusion end), (.databaseId | tostring), .url] | join(" ")') \
    || return 1
  if [ -z "$line" ]; then
    ci_status=none ci_conclusion=- ci_run_id="" ci_run_url=""
  else
    read -r ci_status ci_conclusion ci_run_id ci_run_url <<<"$line"
  fi
}

# Polls until the run exists and has finished, or DEPLOY_CI_TIMEOUT passes.
ci_wait() {
  local waited=0
  while [ "$ci_status" != completed ] && [ "$waited" -lt "$ci_timeout" ]; do
    if [ "$ci_status" = none ]; then
      echo "            waiting for a CI run to appear (${waited}s of ${ci_timeout}s)"
    else
      echo "            CI is $ci_status (${waited}s of ${ci_timeout}s): $ci_run_url"
    fi
    sleep "$ci_poll_interval"
    waited=$((waited + ci_poll_interval))
    ci_lookup || return 1
  done
}

ci_failed_jobs() {
  gh run view "$ci_run_id" -R "$ci_repo" --json jobs \
    --jq '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped" and .conclusion != "") | "  - \(.name): \(.conclusion)"' \
    2>/dev/null || echo "  (couldn't list the jobs: gh run view $ci_run_id -R $ci_repo)"
}

# Deploys only a commit whose Test workflow passed. Prints the state; on a
# problem it stops, unless --skip-ci (warn and go on) or --dry-run (report).
ci_gate() {
  local problem=""
  ci_repo=""
  if ! command -v gh >/dev/null 2>&1; then
    problem="gh (the GitHub CLI) isn't installed, so the CI state of $commit can't be checked."
  elif ! gh auth status -h github.com >/dev/null 2>&1; then
    problem="gh isn't logged in to github.com (run: gh auth login), so the CI state of $commit can't be checked."
  elif ! ci_repo=$(github_repo); then
    problem="can't tell the GitHub repository from the origin remote ($(git remote get-url origin 2>/dev/null || echo none))."
  elif ! ci_lookup; then
    problem="gh run list failed for $ci_repo."
  else
    if $wait_ci && ! $dry_run && [ "$ci_status" != completed ]; then
      ci_wait || problem="gh run list failed for $ci_repo while waiting."
    fi
    if [ -z "$problem" ]; then
      if [ "$ci_status" = none ]; then
        problem="no Test workflow run in $ci_repo for $commit."
        if [ -z "$(git branch -r --contains "$commit" 2>/dev/null)" ]; then
          problem+=$'\n'"No remote branch has this commit (as of the last fetch): push it first."
        else
          problem+=$'\n'"It's pushed, so CI may not have started yet: run again with --wait-ci to wait for it."
        fi
      elif [ "$ci_status" != completed ]; then
        problem="CI for $commit is still running ($ci_status): $ci_run_url"
        problem+=$'\n'"Run again with --wait-ci to wait for it and deploy when it passes."
      elif [ "$ci_conclusion" = success ]; then
        echo "CI:         passed ($ci_run_url)"
        return 0
      else
        problem="CI for $commit didn't pass ($ci_conclusion): $ci_run_url"
        problem+=$'\n'"Jobs that didn't pass:"$'\n'"$(ci_failed_jobs)"
      fi
    fi
  fi

  if $skip_ci; then
    echo "CI:         SKIPPED (--skip-ci)" >&2
    echo "  ************************************************************" >&2
    echo "  WARNING: deploying without a green CI run." >&2
    echo "$problem" | sed 's/^/  /' >&2
    echo "  ************************************************************" >&2
    return 0
  fi
  if $dry_run; then
    echo "CI:         not deployable as it stands:"
    echo "$problem" | sed 's/^/            /'
    echo "            (a real deploy stops here; --skip-ci overrides, e.g. for a known flaky test)"
    return 0
  fi
  die "$problem"$'\n\n'"To deploy anyway (for example when the failure is a known flaky test), run again with --skip-ci."
}

# --- Backup ------------------------------------------------------------------

# Fails unless the backup directory's disk has room for a dump of the whole
# database (an upper bound: the custom format is compressed) plus
# DEPLOY_BACKUP_MIN_FREE_MB.
check_disk_space() {
  local db_bytes free_kb need_kb
  db_bytes=$( (cd deploy && docker compose exec -T db psql -U paperclip -d paperclip -tAc \
    "select pg_database_size('paperclip')") | tr -d '[:space:]') || db_bytes=""
  case "$db_bytes" in ''|*[!0-9]*) die "couldn't read the database's size from the db container." ;; esac
  free_kb=$(df -Pk "$backup_dir" | awk 'NR == 2 { print $4 }')
  need_kb=$((db_bytes / 1024 + min_free_mb * 1024))
  if [ "$free_kb" -lt "$need_kb" ]; then
    die "not enough disk space for a backup in $backup_dir: $((free_kb / 1024)) MB free, $((need_kb / 1024)) MB needed (database $((db_bytes / 1024 / 1024)) MB + DEPLOY_BACKUP_MIN_FREE_MB=$min_free_mb). Nothing was deployed."
  fi
  echo "            disk: $((free_kb / 1024)) MB free, database $((db_bytes / 1024 / 1024)) MB"
}

# A dump is good when it's non-empty and pg_restore can read its table of
# contents. pg_restore runs in a throwaway container of the db service's image,
# not in the production db container.
verify_dump() {
  local dump=$1 list entries
  [ -s "$dump" ] || { echo "            the dump is empty" >&2; return 1; }
  list=$(mktemp)
  temp_files+=("$list")
  if ! docker run --rm -i --network none --memory 512m "$pg_image" pg_restore --list \
      < "$dump" > "$list"; then
    echo "            pg_restore --list couldn't read the dump" >&2
    return 1
  fi
  # Entries are the lines that aren't ";" comments.
  entries=$(grep -c -v '^;' "$list" || true)
  if [ "$entries" -lt 1 ]; then
    echo "            pg_restore --list found nothing in the dump" >&2
    return 1
  fi
  echo "            verified: $(du -h "$dump" | cut -f1), $entries entries in pg_restore --list"
}

# pg_dump of the running database, in custom format (the command in
# deploy/README.md, Backups), to $1. Removes a partial file on failure.
dump_database() {
  local out=$1
  if ! (cd deploy && docker compose exec -T db pg_dump -Fc -U paperclip paperclip) > "$out"; then
    rm -f -- "$out"
    die "pg_dump failed. Nothing was deployed."
  fi
  if ! verify_dump "$out"; then
    rm -f -- "$out"
    die "the dump didn't verify. Nothing was deployed."
  fi
}

# Keeps the newest DEPLOY_BACKUP_KEEP automatic dumps. Only names listed in the
# manifest and matching the automatic pattern are candidates; any other file in
# the folder is left alone.
prune_backups() {
  [ -f "$auto_manifest" ] || return 0
  local name kept=() count=0
  while IFS= read -r name; do
    [ -f "$backup_dir/$name" ] || continue
    count=$((count + 1))
    if [ "$count" -le "$backup_keep" ]; then
      kept+=("$name")
    else
      rm -f -- "${backup_dir:?}/$name"
      echo "            pruned old automatic dump $name"
    fi
  done < <(grep -E "$auto_dump_pattern" "$auto_manifest" | sort -r -u)
  if [ "${#kept[@]}" -gt 0 ]; then
    printf '%s\n' "${kept[@]}" | sort > "$auto_manifest.tmp"
  else
    : > "$auto_manifest.tmp"
  fi
  mv "$auto_manifest.tmp" "$auto_manifest"
}

# Takes, verifies and records the automatic backup; sets backup_path.
take_backup() {
  local name
  [ -n "$(compose_container db)" ] \
    || die "the db container isn't running, so it can't be backed up (start it: cd deploy && docker compose up -d db)."
  mkdir -p "$backup_dir"
  name=paperclip-$(date +%Y-%m-%d-%H%M).dump
  backup_path=$backup_dir/$name
  if [ -e "$backup_path" ]; then
    die "$backup_path already exists; wait a minute and run again."
  fi
  echo "Backup:     $backup_path"
  check_disk_space
  dump_database "$backup_path.partial"
  mv "$backup_path.partial" "$backup_path"
  echo "$name" >> "$auto_manifest"
  prune_backups
}

# --- Migration rehearsal -------------------------------------------------------

# Restores the dump $1 into a throwaway Postgres container (the db service's
# image) and applies the new migrations to it with the new core image, through
# packages/db's own migrate script (src/migrate.ts, what `pnpm db:migrate`
# runs): it calls applyPendingMigrations, the function the server calls at
# startup. Production isn't touched; the containers and network go on any exit.
rehearse_migrations() {
  local dump=$1 log tries=0
  local prefix=paperclip-rehearsal-$$-$RANDOM
  log=$(mktemp)
  temp_files+=("$log")
  echo "Rehearsal:  restoring the dump into a throwaway $pg_image, then migrating with $core_image"

  rehearsal_net=$prefix
  docker network create --label paperclip.deploy.rehearsal=1 "$rehearsal_net" >/dev/null
  rehearsal_db=$prefix-db
  docker run -d --name "$rehearsal_db" --network "$rehearsal_net" --memory 2g \
    --label paperclip.deploy.rehearsal=1 \
    -e POSTGRES_USER=paperclip -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=paperclip \
    "$pg_image" >/dev/null

  # Over TCP: the image's init phase runs a temporary server on the socket
  # only, which a plain pg_isready would mistake for the real one.
  until docker exec "$rehearsal_db" pg_isready -q -h 127.0.0.1 -U paperclip -d paperclip; do
    tries=$((tries + 1))
    [ "$tries" -le 60 ] || die "the rehearsal database didn't start. Nothing was deployed."
    sleep 1
  done

  if ! docker exec -i "$rehearsal_db" pg_restore -U paperclip -d paperclip --exit-on-error --no-owner \
      < "$dump" > "$log" 2>&1; then
    sed 's/^/    /' "$log" >&2
    die "restoring the dump into the rehearsal database failed (above). Nothing was deployed."
  fi

  rehearsal_migrate=$prefix-migrate
  if ! docker run --rm --name "$rehearsal_migrate" --network "$rehearsal_net" --memory 2g \
      --label paperclip.deploy.rehearsal=1 \
      --user node -w /app/packages/db --entrypoint /app/packages/db/node_modules/.bin/tsx \
      -e DATABASE_URL="postgres://paperclip:rehearsal@$rehearsal_db:5432/paperclip" \
      "$core_image" src/migrate.ts > "$log" 2>&1; then
    sed 's/^/    /' "$log" >&2
    die "the migrations failed on a copy of the production database (output above). Production is untouched and nothing was deployed. --skip-rehearsal overrides."
  fi
  sed 's/^/    /' "$log"
  cleanup
  echo "            passed"
}

# --- After the restart -------------------------------------------------------

# Waits for /api/health to answer with a 2xx; sets health_body and health_secs.
wait_for_health() {
  local url waited=0
  url=$(health_url)
  health_body=""
  echo "Health:     waiting up to ${health_timeout}s for $url"
  while :; do
    if health_body=$(curl -fsS -m 5 "$url" 2>/dev/null); then
      health_secs=$waited
      return 0
    fi
    [ "$waited" -lt "$health_timeout" ] || break
    sleep "$poll_interval"
    waited=$((waited + poll_interval))
  done
  health_body=""
  health_secs=$waited
  return 1
}

# Error and fatal lines in the server's log since $1: pino's JSON (level 50,
# 60) and pino-pretty's text, with colour codes stripped.
scan_logs() {
  local ctr=$1 since=$2
  [ -n "$ctr" ] || return 0
  docker logs --since "$since" "$ctr" 2>&1 \
    | sed 's/\x1b\[[0-9;]*m//g' \
    | grep -E '"level":(50|60)[,}]|^\[[^]]*\] (ERROR|FATAL)\b|^(ERROR|FATAL)\b' || true
}

# Health, commit and log checks after a (re)start, then the summary. Sets
# verify_ok, migrations_reported and health_line.
verify_deploy() {
  local expected=$1 since=$2 ctr reported errors error_count
  verify_ok=true
  if wait_for_health; then
    reported=$(printf '%s' "$health_body" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')
    if [ "$reported" = "$expected" ]; then
      health_line="ok after ${health_secs}s; the server reports commit $reported"
    else
      health_line="ok after ${health_secs}s, but the server reports commit '${reported:-none}', not $expected"
      verify_ok=false
    fi
  else
    health_line="no answer from $(health_url) within ${health_timeout}s"
    verify_ok=false
  fi
  ctr=$(compose_container server)
  [ -n "$ctr" ] || ctr=$(docker ps -aq --filter "label=com.docker.compose.project=$compose_project" \
    --filter "label=com.docker.compose.service=server" | head -n 1)
  errors=$(scan_logs "$ctr" "$since")
  error_count=$(printf '%s' "$errors" | grep -c . || true)
  migrations_reported=""
  if [ -n "$ctr" ]; then
    migrations_reported=$(docker logs --since "$since" "$ctr" 2>&1 \
      | grep -o 'Applying [0-9]* pending migrations' | head -n 1 || true)
  fi
  error_summary="none"
  [ "$error_count" -eq 0 ] || error_summary="$error_count (below)"
  if ! $verify_ok && [ -n "$ctr" ]; then
    echo ""
    echo "Last lines of the server log:"
    docker logs --tail 30 "$ctr" 2>&1 | sed 's/^/    /'
  fi
  if [ "$error_count" -gt 0 ]; then
    error_lines=$(printf '%s\n' "$errors" | head -n 20 | cut -c1-400 | sed 's/^/    /')
  else
    error_lines=""
  fi
}

print_summary() {
  echo ""
  echo "Summary"
  echo "  Commit:      $1"
  echo "  Migrations:  $2"
  echo "  Backup:      $3"
  echo "  Rehearsal:   $4"
  echo "  Health:      $health_line"
  echo "  Error lines: $error_summary"
  [ -z "$error_lines" ] || echo "$error_lines"
}

# --- Rollback ----------------------------------------------------------------

do_rollback() {
  local last_commit prev_commit prev_image current migrations backup status since
  [ -f "$state_file" ] || die "no record of a deploy in $state_file, so there's nothing to roll back (DEPLOY_BACKUP_DIR sets where it's kept)."
  last_commit=$(state_get commit)
  migrations=$(state_get migrations)
  backup=$(state_get backup)
  status=$(state_get status)
  prev_image=$(state_get previous_image)
  prev_commit=$(state_get previous_commit)

  echo "Rollback:   from ${last_commit:-unknown} to ${prev_commit:-unknown} (paperclip-fork:previous)"
  if [ "$status" = rolled-back ] && ! $force; then
    die "the last deploy ($last_commit) was already rolled back; paperclip-fork:previous is what's running. --force restarts it anyway."
  fi
  if [ "$migrations" != none ]; then
    local why="the deploy of $last_commit applied database migrations ($migrations), which don't run backwards: the previous server would run against a schema it doesn't know."
    if ! $force; then
      die "$why"$'\n'"The way back is restoring the backup taken before it (${backup:-none recorded}), then rolling back with --force. See deploy/README.md, Rolling back."
    fi
    echo "Warning:    $why Rolling back anyway (--force); restore the backup (${backup:-none recorded}) first if you haven't." >&2
  fi
  # The record names the image the deploy kept; paperclip-fork:previous must
  # still be that image, or it's a leftover that would start the wrong server.
  if [ -z "$prev_image" ]; then
    local how="check out the commit you want and deploy it (git checkout <commit> && deploy/deploy.sh), then git checkout main for the next deploy"
    [ -z "$prev_commit" ] || how="deploy that commit again: git checkout $prev_commit && deploy/deploy.sh, then git checkout main for the next deploy"
    die "the deploy of ${last_commit:-unknown} kept no image to roll back to: the image that was running before it (${prev_commit:-commit unknown}) was already gone and couldn't be rebuilt, which that deploy warned about."$'\n'"To go back, $how."
  fi
  current=$(image_id paperclip-fork:previous)
  [ -n "$current" ] || die "there's no paperclip-fork:previous image to roll back to (last-deploy.env expects $prev_image)."
  if [ "$current" != "$prev_image" ]; then
    die "paperclip-fork:previous is $current, not the image the deploy of ${last_commit:-unknown} kept ($prev_image), so rolling back to it could start the wrong server. Nothing was changed."
  fi
  prev_commit=$(image_commit paperclip-fork:previous)

  if $dry_run; then
    echo "            would tag paperclip-fork:previous as paperclip-fork:local, recreate the server (docker compose up -d --no-build --force-recreate server) and wait for /api/health to report ${prev_commit:-its commit}"
    exit 0
  fi
  require_env_file

  docker tag paperclip-fork:previous paperclip-fork:local
  since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  (cd deploy && docker compose up -d --no-build --force-recreate server)
  verify_deploy "$prev_commit" "$since"
  state_write "deployed_at=$since" "commit=$prev_commit" "previous_image=$(image_id paperclip-fork:previous)" \
    "previous_commit=$prev_commit" "migrations=none" "backup=" "status=rolled-back" \
    "rolled_back_from=$last_commit"
  print_summary "$prev_commit (rolled back from ${last_commit:-unknown})" "none" "-" "-"
  $verify_ok || die "the rolled-back server didn't come up healthy."
  exit 0
}

# --- Main --------------------------------------------------------------------

commit=$(git rev-parse HEAD)
core_image="paperclip-core:$commit"
# The root Dockerfile installs the agent CLIs (Claude Code, Codex, ...) at
# @latest in a cached layer. Upstream's CI passes the ISO week here so the CLIs
# move forward weekly; without it the layer, and the CLIs, never change.
cli_tools_epoch=$(date -u +%G-W%V)
pg_image=$(db_image)

if $rollback; then
  do_rollback
fi

# The image is built from the working tree, not from the commit, so local
# changes would end up in an image tagged with a commit that doesn't have them.
if [ -n "$(git status --porcelain)" ]; then
  echo "Warning: the checkout has uncommitted or untracked files, which go into the image." >&2
  echo "         Building the core image again so the tag isn't reused for a different tree." >&2
  rebuild=true
fi

echo "Commit:     $commit"
ci_gate

if $rebuild; then
  build_core=true
  reason="--rebuild or a changed working tree"
elif [ -n "$(image_id "$core_image")" ]; then
  build_core=false
  reason="already built"
else
  build_core=true
  reason="no image for this commit yet"
fi
if $build_core; then
  echo "Core image: $core_image (build: $reason)"
  echo "            docker build --target production --build-arg CLI_TOOLS_CACHE_EPOCH=$cli_tools_epoch -t $core_image ."
else
  echo "Core image: $core_image ($reason; pass --rebuild to build it again)"
fi
echo "Fork image: paperclip-fork:local (deploy/Dockerfile FROM $core_image, with ui-new), via docker compose build server"

# What's deployed now: the running server container's image, else (stack
# stopped) paperclip-fork:local. Taken before Compose builds, which moves the
# paperclip-fork:local tag. The commit comes from the container's environment
# when there is one, since its image may be gone (see "Keep what's running
# now" below).
server_ctr=$(compose_container server)
deployed=""
if [ -n "$server_ctr" ]; then
  deployed_image=$(docker inspect --format '{{.Image}}' "$server_ctr")
  deployed=$(container_commit "$server_ctr")
else
  deployed_image=$(image_id paperclip-fork:local)
fi
[ -n "$deployed" ] || [ -z "$deployed_image" ] || deployed=$(image_commit "$deployed_image")

# Migrations don't run backwards, so a deploy that adds one gets a verified
# backup and a rehearsal first. "unknown" (no image, or a commit this clone
# lacks) is treated as possibly adding some whenever there's a database to lose.
new_migrations=""
if [ -n "$deployed" ] && git cat-file -e "$deployed^{commit}" 2>/dev/null; then
  echo "Deployed:   $deployed"
  new_migrations=$(git diff --name-only --diff-filter=A "$deployed" HEAD -- packages/db/src/migrations \
    | grep '\.sql$' | xargs -r -n 1 basename || true)
  if [ -n "$new_migrations" ]; then
    migration_state=new
    echo "Migrations: this deploy adds database migrations, which don't run backwards:"
    echo "$new_migrations" | sed 's/^/            /'
  else
    migration_state=none
    echo "Migrations: none added; no backup or rehearsal needed"
  fi
else
  echo "Deployed:   unknown (no paperclip-fork image, or its commit isn't in this clone)"
  if [ -n "$(compose_container db)" ]; then
    migration_state=unknown
    echo "Migrations: unknown, so backing up and rehearsing as if there were some"
  else
    migration_state=none
    echo "Migrations: no running database to back up (a first deploy)"
  fi
fi
needs_backup=false
[ "$migration_state" = none ] || needs_backup=true
migrations_record=none
[ "$migration_state" = new ] && migrations_record=$(echo "$new_migrations" | paste -sd ' ' -)
[ "$migration_state" = unknown ] && migrations_record=unknown

# --- Keep what's running now, for --rollback ---------------------------------
#
# With Docker's containerd image store (server1's), an image is deleted when its
# last tag moves away, even while a container runs it. `docker compose build
# server` moves paperclip-fork:local, so the running image is held under
# paperclip-fork:outgoing before the build, and becomes paperclip-fork:previous
# just before the restart. A deploy that stops in between leaves
# paperclip-fork:previous and last-deploy.env as they were, so --rollback still
# undoes the last deploy that went out; the outgoing tag stays on the running
# image until the next deploy.
#
# previous_plan says what happens:
#   keep     the running image exists: hold it
#   rebuild  it's gone (an earlier build deleted it), but its commit and
#            paperclip-core:<commit> are here: rebuild it from them (not with
#            Compose, which would move paperclip-fork:local)
#   gone     it's gone and can't be rebuilt: deploy without a rollback image,
#            after a warning, and remove any older paperclip-fork:previous
#   none     nothing is deployed (a first deploy)
outgoing_ref=paperclip-fork:outgoing
previous_plan=none
previous_core=""
previous_why=""
if [ -n "$deployed_image" ]; then
  if [ -n "$(image_id "$deployed_image")" ]; then
    previous_plan=keep
  else
    previous_plan=gone
    if [ -z "$deployed" ]; then
      previous_why="the server's commit is unknown"
    elif ! git cat-file -e "$deployed^{commit}" 2>/dev/null; then
      previous_why="this clone doesn't have commit $deployed"
    elif [ -z "$(image_id "paperclip-core:$deployed")" ]; then
      previous_why="paperclip-core:$deployed, its core image, is gone too"
    else
      previous_plan=rebuild
      previous_core=paperclip-core:$deployed
    fi
  fi
fi

# The loud warning for a deploy with no rollback image; $1 says why.
warn_no_previous() {
  echo "Previous:   NONE: this deploy has no image to roll back to" >&2
  echo "  ************************************************************" >&2
  echo "  WARNING: the image the server runs ($deployed_image, commit ${deployed:-unknown})" >&2
  echo "  no longer exists (Docker's containerd image store deletes an image once its last" >&2
  echo "  tag moves away, as when paperclip-fork:local moves to a later build)." >&2
  echo "  It can't be rebuilt: $1." >&2
  echo "  After this deploy --rollback refuses; to go back, deploy ${deployed:-the old commit} again." >&2
  echo "  ************************************************************" >&2
}

if $dry_run; then
  if $needs_backup; then
    if $backed_up; then
      echo "Backup:     skipped (--backed-up: you took your own)"
    else
      echo "Backup:     would dump the database (docker compose exec -T db pg_dump -Fc) to"
      echo "            $backup_dir/paperclip-$(date +%Y-%m-%d-%H%M).dump, verify it with pg_restore --list"
      echo "            ($pg_image), and keep the newest $backup_keep automatic dumps"
      echo "            disk: $(free_mb_near "$backup_dir") MB free there"
    fi
    if $skip_rehearsal; then
      echo "Rehearsal:  skipped (--skip-rehearsal)"
    else
      echo "Rehearsal:  would restore the dump into a throwaway $pg_image and run"
      echo "            packages/db's src/migrate.ts from $core_image against it"
    fi
  fi
  case "$previous_plan" in
    keep)
      echo "Previous:   would hold $deployed_image (${deployed:-commit unknown}) as $outgoing_ref"
      echo "            through the build, then tag it paperclip-fork:previous before the restart"
      ;;
    rebuild)
      echo "Previous:   the image the server runs ($deployed_image) no longer exists"
      echo "            (Docker's containerd image store deletes an image once its last tag moves away)."
      echo "            would rebuild it from $previous_core and $deployed's deploy/Dockerfile"
      echo "            (git archive $deployed | docker build -f deploy/Dockerfile -t $outgoing_ref -),"
      echo "            then tag it paperclip-fork:previous before the restart"
      ;;
    gone)
      warn_no_previous "$previous_why"
      [ -z "$(image_id paperclip-fork:previous)" ] \
        || echo "            would remove the older paperclip-fork:previous, so --rollback can't use it"
      ;;
  esac
  echo "Restart:    would run docker compose up -d --no-build, then wait up to ${health_timeout}s for"
  echo "            $(health_url) to report $commit and scan the server log for errors"
  [ -f deploy/.env ] || echo "Note:       deploy/.env is missing; a real deploy stops until it exists."
  exit 0
fi

require_env_file

if $build_core; then
  # PAPERCLIP_BUILD_COMMIT is deliberately not passed: in the root Dockerfile
  # it also builds the remote provider pack (about 2.5 GB of provider binaries
  # for cloud and sandbox runs, which this setup doesn't use). deploy/Dockerfile
  # sets the commit for the server instead.
  docker build --target production \
    --build-arg CLI_TOOLS_CACHE_EPOCH="$cli_tools_epoch" \
    -t "$core_image" .
fi

# Read by docker-compose.yml: the base image for deploy/Dockerfile, and the
# commit stamped into ui-new and reported by the server (the build context has
# no .git).
export BASE_IMAGE=$core_image
export BUILD_COMMIT=$commit

case "$previous_plan" in
  keep)
    docker tag "$deployed_image" "$outgoing_ref" \
      || die "couldn't tag the running image $deployed_image as $outgoing_ref. Nothing was deployed."
    echo "Previous:   holding $deployed_image (${deployed:-commit unknown}) as $outgoing_ref through the build"
    ;;
  rebuild)
    echo "Previous:   the image the server runs ($deployed_image) is gone; rebuilding it from"
    echo "            $previous_core and $deployed's deploy/Dockerfile"
    # From the commit's own tree, so its ui-new goes in, not this checkout's.
    if git archive --format=tar "$deployed" \
        | docker build -f deploy/Dockerfile \
            --build-arg BASE_IMAGE="$previous_core" --build-arg PAPERCLIP_UI_COMMIT="$deployed" \
            -t "$outgoing_ref" -; then
      echo "            rebuilt as $outgoing_ref"
    else
      previous_plan=gone
      previous_why="rebuilding it from $previous_core failed (above)"
    fi
    ;;
esac
# Built before the backup, so a ui-new build failure stops the deploy before
# anything else happens, and the backup is as close to the restart as it can be.
(cd deploy && docker compose build server)

backup_record="none (no migrations)"
rehearsal_record="not needed"
if $needs_backup; then
  if $backed_up; then
    backup_path=""
    backup_record="your own (--backed-up)"
    echo "Backup:     skipped (--backed-up: you took your own)"
  else
    take_backup
    backup_record=$backup_path
  fi
  if $skip_rehearsal; then
    rehearsal_record="skipped (--skip-rehearsal)"
    echo "Rehearsal:  skipped (--skip-rehearsal)" >&2
  else
    rehearsal_dump=$backup_path
    if [ -z "$rehearsal_dump" ]; then
      # --backed-up: a dump of our own for the rehearsal only, removed on exit.
      rehearsal_dump=$(mktemp)
      temp_files+=("$rehearsal_dump")
      echo "Rehearsal:  taking a temporary dump to rehearse on"
      dump_database "$rehearsal_dump"
    fi
    rehearse_migrations "$rehearsal_dump"
    rehearsal_record="passed"
  fi
fi

# The image held before the build becomes the one --rollback uses. With none,
# an older paperclip-fork:previous goes, so nothing can roll back to it (and
# last-deploy.env records no previous image, which --rollback refuses).
case "$previous_plan" in
  keep|rebuild)
    docker tag "$outgoing_ref" paperclip-fork:previous
    docker rmi "$outgoing_ref" >/dev/null
    echo "Previous:   ${deployed:-unknown} tagged paperclip-fork:previous"
    ;;
  gone)
    warn_no_previous "$previous_why"
    drop_tag paperclip-fork:previous
    drop_tag "$outgoing_ref"
    ;;
  none)
    drop_tag paperclip-fork:previous
    ;;
esac
previous_image=""
case "$previous_plan" in keep|rebuild) previous_image=$(image_id paperclip-fork:previous) ;; esac
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Recorded before the restart: if it dies halfway, --rollback still knows
# migrations may have run.
state_write "deployed_at=$since" "commit=$commit" "previous_image=$previous_image" \
  "previous_commit=$deployed" "migrations=$migrations_record" "backup=${backup_path:-}" "status=starting"

(cd deploy && docker compose up -d --no-build)

verify_deploy "$commit" "$since"
# The server logs "Applying N pending migrations" when it runs any, which
# settles an "unknown".
if [ "$migrations_record" = unknown ]; then
  if [ -n "$migrations_reported" ]; then
    migrations_record="unknown (server: $migrations_reported)"
  elif $verify_ok; then
    migrations_record=none
  fi
fi
status=ok
$verify_ok || status=failed
state_write "deployed_at=$since" "commit=$commit" "previous_image=$previous_image" \
  "previous_commit=$deployed" "migrations=$migrations_record" "backup=${backup_path:-}" "status=$status"

if [ "$migrations_record" = none ]; then
  migrations_line=none
else
  migrations_line="$migrations_record${migrations_reported:+ (server: $migrations_reported)}"
fi
print_summary "$commit" "$migrations_line" "$backup_record" "$rehearsal_record"

if ! $verify_ok; then
  if [ "$migrations_record" = none ]; then
    if [ -z "$previous_image" ]; then
      die "the deploy didn't verify, and it kept no image to roll back to (above). To go back, deploy ${deployed:-the previous commit} again: git checkout ${deployed:-<commit>} && deploy/deploy.sh."
    fi
    die "the deploy didn't verify. deploy/deploy.sh --rollback puts ${deployed:-the previous image} back."
  fi
  die "the deploy didn't verify, and it applied migrations, so --rollback alone won't do: restore $backup_record first (deploy/README.md, Rolling back)."
fi
