#!/usr/bin/env bash
# remove-stray-assets-log.sh — delete the copies of an old session log that every build folder got (Nov 8 2026).
#
#   bash deploy/remove-stray-assets-log.sh [--apply] [root…]      (default root: /root/axf-builds; dry run without --apply)
#
# assets.log (an Oct 31 ui-all-assets session log) was committed by mistake in 202fa1ce9, so every `git worktree add`
# checked it out. It is untracked and ignored now. This removes only files named assets.log, one level under each root,
# whose content is byte-identical to that committed log (last version, 10dea2350); anything else named assets.log is listed and left alone.
# In a worktree still on an older branch the deletion shows as " D assets.log"; the maintenance worktree job treats that
# as not being work.
set -uo pipefail
apply="" roots=()
for a in "$@"; do [[ "$a" == --apply ]] && apply=1 || roots+=("$a"); done
(( ${#roots[@]} )) || roots=(/root/axf-builds)
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
want="$(git -C "$REPO" show 10dea2350:assets.log 2>/dev/null | sha256sum | cut -d' ' -f1)"
[[ -n "$want" && "$want" != "$(printf '' | sha256sum | cut -d' ' -f1)" ]] || { echo "can't read the committed assets.log (10dea2350) from $REPO" >&2; exit 2; }
n=0 bytes=0 other=0
for r in "${roots[@]}"; do
  for f in "$r"/*/assets.log; do
    [[ -f "$f" && ! -L "$f" ]] || continue
    if [[ "$(sha256sum "$f" | cut -d' ' -f1)" == "$want" ]]; then
      n=$((n + 1)); bytes=$((bytes + $(stat -c %s "$f")))
      if [[ -n "$apply" ]]; then rm -f -- "$f"; else echo "would remove $f"; fi
    else
      other=$((other + 1)); echo "kept $f (different content)"
    fi
  done
done
echo "$([[ -n "$apply" ]] && echo removed || echo "would remove") $n stray assets.log ($((bytes / 1024)) KB); $other other assets.log left alone"
