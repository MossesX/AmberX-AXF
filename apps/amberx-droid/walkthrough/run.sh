#!/usr/bin/env bash
# Runs inside the recorder image (amberx-tour-recorder: Playwright, ffmpeg, Piper): voice, recording, assembly.
# HUB_USER / HUB_PASS come from the env file; the signed-in session file is removed whatever happens.
set -euo pipefail
cd /rec-app
cp /rec/*.mjs /rec/*.html .
trap 'rm -f "${OUT:-/out}/state.json"' EXIT
node tts.mjs
node record.mjs
node assemble.mjs
