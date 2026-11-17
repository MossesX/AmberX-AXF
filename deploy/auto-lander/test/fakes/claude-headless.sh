#!/usr/bin/env bash
# Fake deploy/claude-headless.sh for the auto-lander loop test: records the launch (name, account, model) in
# $FAKE_HEADLESS_LOG and answers like the real launcher ("started <tmux session> in <folder>"). No Claude, no tmux.
set -euo pipefail
name=""; account=""; model=""
while [ $# -gt 0 ]; do
  case "$1" in
    --name) name="$2"; shift 2;;
    --account) account="$2"; shift 2;;
    --model) model="$2"; shift 2;;
    --) shift;;
    *) shift;;
  esac
done
[ -n "$name" ] || { echo "fake headless: --name is required" >&2; exit 2; }
printf '%s %s %s\n' "$name" "$account" "${model:-opus}" >> "${FAKE_HEADLESS_LOG:?}"
echo "started axf-$name in $(pwd)"
