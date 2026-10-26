#!/usr/bin/env bash
# claude-headless.sh — start a headless Claude Code session the console's Terminal can watch (Oct 26 2026, Brett:
# "whenever the console or axHub runs a headless session on the VPS, use the built-in terminal in the console and
# bring the floating window to focus and front").
#
#   bash deploy/claude-headless.sh --name <slug> --brief <file> --log <file> -- <claude args…>
#
# Runs `claude -p <args> --output-format stream-json --verbose "$(cat <brief>)"` inside a detached tmux session named
# `axf-<slug>` in the current folder. The console's Terminal plugin lists `axf-*` tmux sessions on the VPS and opens
# each new one in a VPS tab attached to it, in the terminal window brought to the front. The stream is printed as
# readable lines (deploy/claude-stream.mjs) and kept: <log> = what you see, <log minus .log>.jsonl = the raw stream.
# When it finishes the session waits for Enter (up to a day) so the result stays on screen; the tmux session then ends.
# Without tmux it falls back to the old `nohup … &` (nothing to attach to; the systems check offers to install tmux).
# Prints one line: "started <tmux session> in <folder>" (or "started pid …").
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"   # vps.run / cron shells don't load the profile; Claude Code installs here

name="" brief="" log=".axf-headless.log" inner=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) name="$2"; shift 2 ;;
    --brief) brief="$2"; shift 2 ;;
    --log) log="$2"; shift 2 ;;
    --inner) inner=1; shift ;;
    --) shift; break ;;
    *) echo "claude-headless: unknown option $1" >&2; exit 2 ;;
  esac
done
[[ -n "$brief" && -f "$brief" ]] || { echo "claude-headless: --brief <file> is required" >&2; exit 2; }
[[ "$log" =~ ^[A-Za-z0-9._-]{1,80}$ ]] || { echo "claude-headless: --log is a plain file name" >&2; exit 2; }
raw="${log%.log}.jsonl"

if [[ -n "$inner" ]]; then   # inside tmux: run, show, keep the result on screen
  printf '\033[2m# headless Claude Code · %s · %s\033[0m\n\n' "$(pwd)" "$(date '+%Y-%m-%d %H:%M')"
  if command -v node >/dev/null; then
    claude -p "$@" --output-format stream-json --verbose "$(cat "$brief")" 2>&1 | tee "$raw" | node "$HERE/claude-stream.mjs" | tee "$log"
  else
    claude -p "$@" "$(cat "$brief")" 2>&1 | tee "$log"
  fi
  st=${PIPESTATUS[0]}
  printf '\n\033[1m── finished (exit %s) · log: %s/%s ──\033[0m\n' "$st" "$(pwd)" "$log"
  read -r -t 86400 -p "Press Enter to close this session. " _ || true
  exit "$st"
fi

slug="$(printf '%s' "${name:-run}" | tr -c 'A-Za-z0-9._-' '-' | sed 's/^-*//; s/-*$//' | cut -c1-48)"
session="axf-${slug:-run}"
if ! command -v tmux >/dev/null; then
  nohup claude -p "$@" "$(cat "$brief")" > "$log" 2>&1 &
  echo "started pid $! in $(pwd) (tmux missing: the console can't show it)"
  exit 0
fi
tmux has-session -t "=$session" 2>/dev/null && session="$session-$(date +%H%M%S)"
envs=()   # tmux starts the command in its server's environment: pass what the run needs explicitly
for v in PATH HOME AXF_SURFACE AXF_MODEL AXF_ADOPT_CHANGE AXF_CLAUDE_AUTH; do
  [[ -n "${!v:-}" ]] && envs+=(-e "$v=${!v}")
done
tmux new-session -d -s "$session" -x 200 -y 50 -c "$(pwd)" "${envs[@]}" \
  bash "$HERE/claude-headless.sh" --inner --brief "$brief" --log "$log" -- "$@"
tmux set-option -t "$session" history-limit 50000 >/dev/null 2>&1 || true
echo "started $session in $(pwd)"
