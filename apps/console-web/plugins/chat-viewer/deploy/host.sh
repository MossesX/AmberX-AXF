#!/usr/bin/env bash
# Chat viewer — host part (plugin-lifecycle@1). Run by deploy/install-console.sh on the VPS as root:
#   host.sh up     print extra `docker run` args for the console, one per line: read-only mounts of the session folders
# The console reads Claude Code sessions and headless build logs from them. Only these folders are mounted, read-only:
#   /root/.claude/projects            → /hostfs/claude/root
#   /home/axfbuild/.claude/projects   → /hostfs/claude/axfbuild
#   /root/axf-builds                  → /hostfs/axf-builds          (headless build worktrees + their .log / .brief.md)
#   /home/axfbuild/wt-*               → /hostfs/axfbuild-wt/wt-*    (one mount each; never the whole home: it holds git-cred)
# New axfbuild worktrees show up after the next install-console.sh run. Nothing runs and nothing is left on the host,
# so removing this folder removes everything.
set -euo pipefail
case "${1:-}" in
  up)
    m() { [ -d "$1" ] && printf '%s\n' -v "$1:$2:ro"; return 0; }
    m /root/.claude/projects /hostfs/claude/root
    m /home/axfbuild/.claude/projects /hostfs/claude/axfbuild
    m /root/axf-builds /hostfs/axf-builds
    for d in /home/axfbuild/wt-*; do [ -d "$d" ] && m "$d" "/hostfs/axfbuild-wt/$(basename "$d")"; done
    ;;
  down) ;;
  *) echo "usage: host.sh up|down" >&2; exit 2 ;;
esac
