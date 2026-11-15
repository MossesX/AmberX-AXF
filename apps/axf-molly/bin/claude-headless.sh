#!/usr/bin/env bash
# Launcher shim for the axf-molly container (AXF_PIPELINE_LAUNCHER points here). pipeline.mjs launch() calls it exactly
# like deploy/claude-headless.sh; the shim forwards one `launch` request over the host bridge (host-bridge@1), where the
# real launcher runs in the build's worktree with the dispatcher's one-build token. The claude argv is rebuilt on the
# host from the model name: nothing after `--` here reaches the host.
set -euo pipefail
name=""; account=""; brief=".axf-brief.md"; log=""
while [ $# -gt 0 ]; do
  case "$1" in
    --name) name="$2"; shift 2 ;;
    --account) account="$2"; shift 2 ;;
    --brief) brief="$2"; shift 2 ;;
    --log) log="$2"; shift 2 ;;
    --) shift; break ;;
    *) shift ;;
  esac
done
[ -n "$name" ] || { echo "launch shim: --name is required" >&2; exit 2; }
[ -n "$log" ] || log="$name.log"
model="${AXF_MODEL:-opus}"
here="$(cd "$(dirname "$0")" && pwd)"
args=("$name" "${account:-}" "$model" "$brief" "$log")
if [ -n "${AXF_DISPATCH_TOKEN:-}" ]; then
  args+=("$AXF_DISPATCH_TOKEN")
  [ -n "${AXF_PRIORITY:-}" ] && args+=("$AXF_PRIORITY")
fi
exec node "$here/../bridge-client.mjs" launch "${args[@]}"
