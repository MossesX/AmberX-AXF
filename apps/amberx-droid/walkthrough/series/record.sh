#!/usr/bin/env bash
# Records the three-minute series, one video at a time, each as its own walkthrough (series/walkthrough.mjs) with its own
# work folder (/opt/amberx-walkthrough-rec/series-<id>): voice, live recording, assembly and the secrets scan. Nothing
# is published here (NO_PUBLISH); publishing is series/publish.mjs.
#
#   bash apps/amberx-droid/walkthrough/series/record.sh                     the seven core videos
#   bash …/series/record.sh voice-control axhub                             just those
#   bash …/series/record.sh all                                             every video and every 60-second cut
#   bash …/series/record.sh commute-60                                      one 60-second cut
#   ONLY=queue bash …/series/record.sh orchestrator-agents                   re-record one piece of one video
#
# Each video goes through the VPS-wide heavy slot (framework/cli/agent-slots.mjs), so only a few heavy jobs run at once.
# A video that fails is reported and the next one still records.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
if [ "$#" -eq 0 ]; then
  set -- $(cd "$HERE" && node --input-type=module -e "const { VIDEOS } = await import('./scripts.mjs'); console.log(VIDEOS.map((v) => v.id).join(' '))")
elif [ "$1" = all ]; then
  set -- $(cd "$HERE" && node --input-type=module -e "const { seriesIds } = await import('./walkthrough.mjs'); console.log(seriesIds().map((i) => i.slice(7)).join(' '))")
fi
ok=(); failed=()
for v in "$@"; do
  id="series-$v"
  printf '\033[1;33m[series]\033[0m recording %s\n' "$id"
  if WALKTHROUGH="$id" NO_PUBLISH=1 node "$ROOT/framework/cli/agent-slots.mjs" heavy -- bash "$HERE/../rebuild.sh"; then ok+=("$v"); else failed+=("$v"); fi
done
printf '\033[1;33m[series]\033[0m recorded: %s\n' "${ok[*]:-none}"
[ "${#failed[@]}" -eq 0 ] || { printf '\033[1;31m[series]\033[0m failed: %s\n' "${failed[*]}"; exit 1; }
