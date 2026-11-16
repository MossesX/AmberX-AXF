#!/usr/bin/env bash
# Publishes recorded series videos to AmberX (behind axHub's wall): each one's MP4, captions, chapters, poster, chapter
# videos and social exports go to AmberX's data folder as walkthrough series-<id>, where the Walkthrough page plays them
# (/api/walkthrough/series-<id>/…). A video recorded before the social exports existed gets them made first.
#
#   bash apps/amberx-droid/walkthrough/series/publish.sh                    every recorded series video
#   bash …/series/publish.sh voice-control axhub commute-60                 just those
#   SKIN=1 bash …/series/publish.sh voice-control                           also put each player in its video's skin
#                                                                            (AmberX's skin scope ui:walkthrough-series-<id>
#                                                                            on the hub, framework/cli/skins.mjs use)
#
# Runs the secrets scan again before copying; a video that fails it is not published.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT="$(cd "$HERE/.." && pwd)"
WORKROOT="${AMBERX_WALKTHROUGH_WORK:-/opt/amberx-walkthrough-rec}"
PUBROOT="${AMBERX_WALKTHROUGH_PUBLISH:-/opt/amberx-web/.app/data/walkthrough}"
IMAGE="${AMBERX_WALKTHROUGH_IMAGE:-amberx-tour-recorder}"
say() { printf '\033[1;33m[series]\033[0m %s\n' "$*"; }
if [ "$#" -eq 0 ]; then
  set -- $(for d in "$WORKROOT"/series-*/publish/chapters.json; do [ -f "$d" ] && basename "$(dirname "$(dirname "$d")")" | sed 's/^series-//'; done)
fi
[ "$#" -gt 0 ] || { say "nothing recorded yet (series/record.sh)"; exit 0; }
ok=(); failed=()
for v in "$@"; do
  case "$v" in *[!a-z0-9-]*|'') say "bad id: $v"; failed+=("$v"); continue;; esac
  id="series-$v"; WORK="$WORKROOT/$id"; PUB="$PUBROOT/$id"
  if [ ! -s "$WORK/publish/chapters.json" ]; then say "$id: not recorded"; failed+=("$v"); continue; fi
  if [ ! -s "$WORK/publish/walkthrough-social-9x16.mp4" ] || ! grep -q '"series"' "$WORK/publish/chapters.json"; then
    say "$id: social exports"
    docker run --rm -e OUT=/out -e WALKTHROUGH="$id" -v "$WT:/rec:ro" -v "$WORK:/out" "$IMAGE" bash -c 'cd /rec-app && cp /rec/*.mjs . && rm -rf series && cp -r /rec/series . && node series/social.mjs' \
      || { failed+=("$v"); continue; }
  fi
  node "$WT/check.mjs" --scan "$WORK" || { say "$id: secrets scan failed, not published"; failed+=("$v"); continue; }
  mkdir -p "$PUB/chapters"
  cp "$WORK/publish/"walkthrough*.mp4 "$WORK/publish/"{walkthrough.vtt,chapters.json,segments.json,poster.jpg,script.json} "$PUB/"
  cp "$WORK/publish/chapters/"*.mp4 "$PUB/chapters/" 2>/dev/null || true
  chmod 755 "$PUB" "$PUB/chapters"; chmod 644 "$PUB"/*.* "$PUB/chapters/"* 2>/dev/null || true
  chown -R --reference="$PUBROOT" "$PUB" 2>/dev/null || true
  if [ -n "${SKIN:-}" ]; then
    skin="$(node -e 'try{process.stdout.write(String(require(process.argv[1]).skin||""))}catch{}' "$PUB/chapters.json")"
    [ -n "$skin" ] && node "$WT/../../../framework/cli/skins.mjs" use amberx "$skin" --scope "ui:walkthrough-$id" >/dev/null && say "$id: player skin $skin"
  fi
  ok+=("$v"); say "$id: published (AmberX → Walkthrough)"
done
say "published: ${ok[*]:-none}"
[ "${#failed[@]}" -eq 0 ] || { printf '\033[1;31m[series]\033[0m not published: %s\n' "${failed[*]}"; exit 1; }
