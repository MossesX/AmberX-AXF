#!/usr/bin/env bash
# Re-records the AmberX walkthrough video against the live app and publishes it to AmberX (behind axHub's wall).
#
#   bash apps/amberx-droid/walkthrough/rebuild.sh            everything (~15 min)
#   ONLY=home,settings bash …/rebuild.sh                    just those chapters, the rest kept from the last run
#   NO_PUBLISH=1 bash …/rebuild.sh                           record and check, don't publish
#   UI_CHECK=1 bash …/rebuild.sh                             after publishing, check the entry + player on the live app
#
# Steps: script check → demo data (seed.mts) → recorder image (Piper voice, Playwright, ffmpeg) → secrets scan of every
# frame's text → copy publish/ to AmberX's data folder, served at /api/walkthrough/* (the app's Walkthrough player).
# Needs: docker, node 22, the recorder image `amberx-tour-recorder` (built from /opt/amberx-tour/recorder if missing),
# and the recorder account in /root/.tour-recorder.env (HUB_USER / HUB_PASS, root-only; never printed).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${AMBERX_WALKTHROUGH_WORK:-/opt/amberx-walkthrough-rec}"
PUBLISH="${AMBERX_WALKTHROUGH_PUBLISH:-/opt/amberx-web/.app/data/walkthrough}"
ENVF="${AMBERX_WALKTHROUGH_ENV:-/root/.tour-recorder.env}"
IMAGE="${AMBERX_WALKTHROUGH_IMAGE:-amberx-tour-recorder}"
VOICE="en_US-kristin-medium"
say() { printf '\033[1;33m[walkthrough]\033[0m %s\n' "$*"; }

[ -r "$ENVF" ] || { echo "No recorder account: $ENVF (HUB_USER=…, HUB_PASS=…, chmod 600)." >&2; exit 2; }
mkdir -p "$WORK/voice"
say "checking the script"
node "$HERE/check.mjs"
say "demo data"
(cd "$HERE/.." && npx -y tsx walkthrough/seed.mts "$WORK/seed.json")
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  say "building the recorder image"
  docker build -t "$IMAGE" /opt/amberx-tour/recorder
fi
if [ ! -s "$WORK/voice/$VOICE.onnx" ]; then
  say "downloading Amber's voice ($VOICE)"
  base="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/kristin/medium"
  curl -fsSL -o "$WORK/voice/$VOICE.onnx" "$base/$VOICE.onnx"
  curl -fsSL -o "$WORK/voice/$VOICE.onnx.json" "$base/$VOICE.onnx.json"
fi
say "recording (voice, live app with demo data, assembly)"
docker run --rm --name amberx-walkthrough-rec --env-file "$ENVF" -e OUT=/out -e ONLY="${ONLY:-}" \
  -v "$HERE:/rec:ro" -v "$WORK:/out" -v "$WORK/voice:/voice:ro" "$IMAGE" bash /rec/run.sh 2>&1 | tee "$WORK/run.log"
rm -f "$WORK/state.json"
say "secrets scan"
node "$HERE/check.mjs" --scan "$WORK"
if [ -n "${NO_PUBLISH:-}" ]; then say "recorded in $WORK/publish (not published)"; exit 0; fi
mkdir -p "$PUBLISH"
cp "$WORK/publish/"{walkthrough.mp4,walkthrough.vtt,chapters.json,poster.jpg} "$PUBLISH/"
chmod 644 "$PUBLISH"/*
chown -R --reference="$PUBLISH/.." "$PUBLISH" 2>/dev/null || true   # same owner as AmberX's data folder
say "published to $PUBLISH (AmberX → Walkthrough)"
if [ -n "${UI_CHECK:-}" ]; then
  say "UI check on the live app (Home card, menus, player, chapters)"
  # Playwright's Chromium has no H.264: ui-check plays a VP9 copy of the first 30 s for its pictures
  docker run --rm --env-file "$ENVF" -e OUT=/out -v "$HERE:/rec:ro" -v "$WORK:/out" "$IMAGE" bash -c \
    'mkdir -p /out/ui && ffmpeg -loglevel error -y -t 30 -i /out/publish/walkthrough.mp4 -c:v libvpx-vp9 -b:v 1M -deadline realtime -cpu-used 8 -c:a libopus /out/ui/preview.webm && cd /rec-app && cp /rec/*.mjs . && node ui-check.mjs'
fi
