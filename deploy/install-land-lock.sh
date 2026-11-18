#!/usr/bin/env bash
# install-land-lock.sh — one landing at a time on the VPS (land-lock@1, framework/cli/land-lock.mjs; Gizmo, Nov 18 2026).
#
#   sudo bash deploy/install-land-lock.sh        install / refresh (idempotent)
#
# What it does (root on the host):
#   - copies framework/cli/land-lock.mjs (built-ins only) to /usr/local/lib/axf/land-lock.mjs, so the hook works even
#     before the deployed checkout has it;
#   - adds the land-lock line to the shared pre-push hook of /opt/axf (every build worktree and session uses it): a push
#     to refs/heads/main (build_land, a session, a script) takes the landing lock for the life of that `git push`, and
#     waits its turn while the merge queue, the console or another push lands. The deployed copy is preferred.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB=/usr/local/lib/axf
REPO="${AXF_REPO:-/opt/axf}"
[[ "$(id -u)" == 0 ]] || { echo "install-land-lock: run as root" >&2; exit 2; }
NODE="$(command -v node)" || { echo "install-land-lock: needs node" >&2; exit 2; }
mkdir -p "$LIB"
install -m 0755 "$HERE/../framework/cli/land-lock.mjs" "$LIB/land-lock.mjs"
HOOKS="$(git -C "$REPO" rev-parse --git-common-dir)/hooks"
case "$HOOKS" in /*) ;; *) HOOKS="$REPO/$HOOKS" ;; esac
"$NODE" "$LIB/land-lock.mjs" install-hook --hooks "$HOOKS" --cli "$REPO/framework/cli/land-lock.mjs,$LIB/land-lock.mjs"
"$NODE" "$LIB/land-lock.mjs" status
