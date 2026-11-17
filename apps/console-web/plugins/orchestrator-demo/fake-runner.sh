#!/usr/bin/env bash
# Orchestrator demo — the fake headless runner. Stands in for a Claude session on a demo build, so a demo run never
# spends a Claude account: it only writes a heartbeat until it is told to stop or is killed.
#   fake-runner.sh <demo-build-id> <state-dir> [max-seconds]
# Writes <state-dir>/<id>.beat (heartbeat, every second) and, when it ends, <id>.exit with its exit code:
#   0 on a clean end (max-seconds reached or <id>.stop present), 143 when killed with SIGTERM (what the watchdog sees).
set -u
id="${1:?usage: fake-runner.sh <demo-build-id> <state-dir> [max-seconds]}"
dir="${2:?state dir}"
max="${3:-900}"
case "$id" in demo-*) ;; *) echo "fake-runner: $id is not a demo build" >&2; exit 2 ;; esac
mkdir -p "$dir"
rm -f "$dir/$id.exit" "$dir/$id.stop"
echo $$ > "$dir/$id.pid"
trap 'echo 143 > "$dir/$id.exit"; exit 143' TERM
trap 'echo 130 > "$dir/$id.exit"; exit 130' INT
i=0
while [ "$i" -lt "$max" ]; do
  date -u +%Y-%m-%dT%H:%M:%SZ > "$dir/$id.beat"
  [ -e "$dir/$id.stop" ] && break
  sleep 1 & wait $!
  i=$((i + 1))
done
echo 0 > "$dir/$id.exit"
exit 0
