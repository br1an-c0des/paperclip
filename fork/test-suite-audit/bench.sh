#!/usr/bin/env bash
# Step 3a benchmark: run the fixed benchmark set (bench-set.txt) once and print one result line.
#
#   fork/test-suite-audit/bench.sh <label> [extra vitest args...]
#   fork/test-suite-audit/bench.sh baseline
#   fork/test-suite-audit/bench.sh workers-6 --fileParallelism --maxWorkers=6
#
# Runs from the checkout it lives in (a worktree runs its own code). Takes a machine-wide lock, so
# only one benchmark runs at a time across all worktrees; it waits for the lock rather than failing.
# Without extra args it uses server/vitest.config.ts as it stands (today: one file at a time).
# Results: one line appended to ${PAPERCLIP_BENCH_DIR:-/tmp/paperclip-bench}/results.tsv, plus the
# run's log and Vitest JSON report next to it.
set -uo pipefail

root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
label=${1:?usage: bench.sh <label> [extra vitest args...]}
shift
outdir=${PAPERCLIP_BENCH_DIR:-/tmp/paperclip-bench}
mkdir -p "$outdir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
base="$outdir/$stamp-$label"
mapfile -t files < <(grep -v '^#' "$root/fork/test-suite-audit/bench-set.txt" | sed '/^$/d; s#^server/##')

exec 9>/tmp/paperclip-test-bench.lock
echo "bench $label: waiting for the benchmark lock..." >&2
flock 9
echo "bench $label: running ${#files[@]} files from $root" >&2

start=$(date +%s.%N)
(cd "$root/server" && corepack pnpm exec vitest run "${files[@]}" \
  --reporter=dot --reporter=json --outputFile.json="$base.json" "$@") >"$base.log" 2>&1
rc=$?
wall=$(echo "$(date +%s.%N) - $start" | bc)

node -e '
const [json, label, wall, rc, branch] = process.argv.slice(1);
let r = {};
try { r = require(json); } catch {}
const failed = (r.testResults ?? []).filter(f => f.status === "failed").map(f => f.name.split("/server/")[1] ?? f.name);
const line = [new Date().toISOString(), label, branch, Number(wall).toFixed(1), rc,
  r.numPassedTests ?? "?", r.numFailedTests ?? "?", r.numPendingTests ?? "?", failed.join(" ")].join("\t");
require("fs").appendFileSync(require("path").join(require("path").dirname(json), "results.tsv"), line + "\n");
console.log(`${label}: wall ${Number(wall).toFixed(1)}s, exit ${rc}, passed ${r.numPassedTests}, failed ${r.numFailedTests}, skipped ${r.numPendingTests}` + (failed.length ? `\n  failed files: ${failed.join(", ")}` : ""));
' "$base.json" "$label" "$wall" "$rc" "$(git -C "$root" branch --show-current)"
echo "log: $base.log" >&2
exit 0
