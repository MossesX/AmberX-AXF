#!/usr/bin/env bash
# Dry-run comparison for deploy/install-console.sh: runs the installer as it was at a git ref and as it is now, against
# fake docker/git/curl/openssl/node in a private mount namespace (nothing on this machine changes; needs root for
# unshare + overlay mounts), in a set of scenarios, and diffs every `docker` call (one argument per line), the
# installer's output, the files it writes under .axf-console (with modes) and the cron/update files.
#
#   sudo bash deploy/dryrun/compare.sh [<git-ref>, default HEAD] [<work dir>, default a temp dir]
#
# Use it before changing the installer or framework/deploy/axf-deploy.sh: what runs on the live VPS must stay the same
# unless the change means it to. Exit 1 when docker calls, output or .axf-console files differ.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
REF="${1:-HEAD}"; W="${2:-$(mktemp -d)}"
mkdir -p "$W/repo/apps/console-web" "$W/repo/framework" "$W/repo/deploy"
git -C "$REPO" show "$REF:deploy/install-console.sh" > "$W/before.sh"
cp -r "$REPO/apps/console-web/plugins" "$W/repo/apps/console-web/"
cp -r "$REPO/framework/deploy" "$W/repo/framework/"
find "$W/repo" -name node_modules -prune -exec rm -rf {} +
SECRET_B="$(printf 'b%.0s' $(seq 64))"; SECRET_C="$(printf 'c%.0s' $(seq 64))"
SCENARIOS=(
  "default"
  "wall-off AXF_WALL=off"
  "wall-saved-off PRE_WALL=off"
  "hub-empty HARNESS_HUB=empty"
  "hub-down-saved-on HARNESS_HUB=down PRE_WALL=on PRE_SECRET=$SECRET_B"
  "users-off AXF_WALL_USERS=off"
  "users-saved-off PRE_WALL_USERS=off PRE_WALL=on"
  "secret-env AXF_WALL_SECRET=$SECRET_C"
  "volume HARNESS_VOLUME=coolify_axhub-projects"
  "no-coolify HARNESS_COOLIFY=0"
  "token-env AXF_TOKEN=newtoken GITHUB_TOKEN=ghp_new DOMAIN=c2.example.com"
)
bad=0
for s in "${SCENARIOS[@]}"; do
  read -ra a <<< "$s"; n="${a[0]}"; args=("${a[@]:1}")
  "$HERE/run.sh" "$W/before.sh" "$W/repo" "$W/out/$n-before" "${args[@]}"
  "$HERE/run.sh" "$REPO/deploy/install-console.sh" "$W/repo" "$W/out/$n-after" "${args[@]}"
  line="$n:"
  for f in calls.log stdout.log axf-console.txt written.txt; do
    sed "s#/$n-before/#/X/#g" "$W/out/$n-before/$f" > "$W/out/$n-before/$f.n"
    sed "s#/$n-after/#/X/#g" "$W/out/$n-after/$f" > "$W/out/$n-after/$f.n"
    if diff -u "$W/out/$n-before/$f.n" "$W/out/$n-after/$f.n" > "$W/out/$n.$f.diff"; then line="$line $f=same"
    else line="$line $f=DIFF"; [ "$f" = written.txt ] || bad=1; fi
  done
  echo "$line ($(grep -c '^=== docker' "$W/out/$n-after/calls.log") docker calls)"
done
echo "diffs: $W/out/<scenario>.<file>.diff"
for f in "$W"/out/default.written.txt.diff; do [ -s "$f" ] && { echo "--- cron/update files (default scenario):"; cat "$f"; }; done
exit "$bad"
