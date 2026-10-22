#!/usr/bin/env bash
# Dry-run harness for deploy/install-console.sh: runs an installer copy against fake docker/git/curl/openssl inside a
# private mount namespace (overlay on /etc, /usr/local/bin and /var/log, so nothing on this machine changes), then
# records every docker call (one argument per line), the files it wrote and their modes.
#   run.sh <installer.sh> <repo-copy> <out-dir> [ENV=VALUE …]
# Scenario switches: HARNESS_COOLIFY=0|1, HARNESS_HUB=ready|empty|down, HARNESS_VOLUME=<name>|"" , PRE_* files.
set -euo pipefail
H="$(cd "$(dirname "$0")" && pwd)"
INST="$1"; REPO="$2"; OUT="$3"; shift 3
rm -rf "$OUT"; mkdir -p "$OUT"/{state,persist,ovl}
STATE="$OUT/state"
cp -a "$REPO/." "$STATE/axf"
cp "$INST" "$STATE/axf/deploy/install-console.sh"
# the host doctor is not part of what is compared (it reads this machine); replace it with a logger
printf '#!/usr/bin/env bash\necho "=== console-doctor $*" >> "$HARNESS_LOG"\n' > "$STATE/axf/deploy/console-doctor.sh"
mkdir -p "$STATE/axf/.git" "$STATE/axf/.axf-console"
for v in "$@"; do case "$v" in PRE_WALL=*) echo "${v#PRE_WALL=}" > "$STATE/axf/.axf-console/wall";; PRE_SECRET=*) printf '%s' "${v#PRE_SECRET=}" > "$STATE/axf/.axf-console/wall-secret"; chmod 600 "$STATE/axf/.axf-console/wall-secret";; PRE_WALL_USERS=*) echo "${v#PRE_WALL_USERS=}" > "$STATE/axf/.axf-console/wall-users";; esac; done
printf 'AXF_TOKEN=tok123tok123tok123tok123tok12345\nGITHUB_TOKEN=ghp_fake\nDOMAIN=console.amberxai.com\n' > "$STATE/axf/.axf-console/env"
ENVS=(); for v in "$@"; do case "$v" in PRE_*) ;; *) ENVS+=("$v");; esac; done
export H; export HARNESS_LOG="$OUT/calls.log"; : > "$HARNESS_LOG"
unshare -m --propagation private bash -c '
  set -e
  O="$1"; shift
  for d in etc usr/local/bin var/log; do
    k="${d//\//_}"; mkdir -p "$O/ovl/$k/up" "$O/ovl/$k/work"
    mount -t overlay overlay -o "lowerdir=/$d,upperdir=$O/ovl/$k/up,workdir=$O/ovl/$k/work" "/$d"
  done
  cd /
  env PATH="$H/stubs:$PATH" DIR="$O/state/axf" PERSIST_DIR="$O/persist" "$@" bash "$O/state/axf/deploy/install-console.sh" > "$O/stdout.log" 2>&1 || echo "EXIT $?" >> "$O/stdout.log"
  # what it wrote outside the clone
  for f in /etc/cron.d/axf-console /etc/cron.d/axf-doctor /usr/local/bin/axf-console-update; do
    [ -f "$f" ] && { echo "### $f mode $(stat -c %a "$f")"; cat "$f"; } >> "$O/written.txt"
  done
  find /etc/axf -printf "%p %m\n" 2>/dev/null | sort > "$O/etc-axf.txt" || true
' _ "$OUT" "${ENVS[@]}"
# files under .axf-console (content + mode); host-check.json excluded (doctor stubbed)
(cd "$STATE/axf/.axf-console" && for f in $(find . -type f | sort); do echo "### $f mode $(stat -c %a "$f")"; cat "$f"; echo; done) > "$OUT/axf-console.txt"
sed -i "s#$OUT#<OUT>#g" "$OUT"/*.log "$OUT"/*.txt
