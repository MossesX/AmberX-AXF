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
# Watch live (watch-live@1): next to the session runs framework/cli/watch-live.mjs, which starts a hot-reloading preview
# for every app the session touches, registers it for the console (proxied at /preview/<session>/<app>/) and stops it
# when the session ends; the brief gets a line asking the session to `axf focus` the screen it works on.
# AXF_WATCH_LIVE=off turns it off. Its log: .axf-watch-live.log.
# Prints one line: "started <tmux session> in <folder>" (or "started pid …").
#
# Who asked (axHub decision 109, Nov 1 2026): the run exports AXF_SESSION=<slug of --name>. When an axHub token is at
# hand (AXHUB_TOKEN, else the console's env file), Claude gets an `axhub` MCP server whose requests carry
# `X-Axhub-Session: $AXF_SESSION`, so every approval it asks for shows "Headless · <name>". The token stays a
# ${AXHUB_TOKEN} placeholder in the config; Claude Code fills it from the environment.
# Secrets the run needs (GIT_CONFIG_* git auth, AXHUB_TOKEN) reach the tmux session through a 0600 file the inner run
# reads and deletes at once, never on a command line (tmux -e would show them in `ps`).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"   # vps.run / cron shells don't load the profile; Claude Code installs here

name="" brief="" log=".axf-headless.log" inner="" envfile="" mcp=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) name="$2"; shift 2 ;;
    --brief) brief="$2"; shift 2 ;;
    --log) log="$2"; shift 2 ;;
    --inner) inner=1; shift ;;
    --envfile) envfile="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "claude-headless: unknown option $1" >&2; exit 2 ;;
  esac
done
[[ -n "$brief" && -f "$brief" ]] || { echo "claude-headless: --brief <file> is required" >&2; exit 2; }
[[ "$log" =~ ^[A-Za-z0-9._-]{1,80}$ ]] || { echo "claude-headless: --log is a plain file name" >&2; exit 2; }
raw="${log%.log}.jsonl"

WATCH_LIVE="$HERE/../framework/cli/watch-live.mjs"
WATCH_NOTE='Watch live: Brett can watch the screen you are changing hot-render in the console. Whenever you start work on a screen or element, run `node framework/cli/axf.mjs focus <app> [route] [css-selector] --note "<what you are changing>"` (apps: console-web, axhub-web, amberx-droid, patches-web, walkthrough-studio, demo, framework, console, axhub-android, voicevault).'
start_watch_live() {   # $1 = session name; prints the watcher pid (empty when off or unavailable)
  [[ "${AXF_WATCH_LIVE:-on}" == off ]] && return 0
  command -v node >/dev/null && [[ -f "$WATCH_LIVE" ]] || return 0
  node "$WATCH_LIVE" watch --session "$1" --worktree "$(pwd)" --parent "$$" > .axf-watch-live.log 2>&1 &
  echo $!
}

if [[ -n "$inner" ]]; then   # inside tmux: run, show, keep the result on screen
  if [[ -n "$envfile" && -f "$envfile" && -O "$envfile" ]]; then
    # shellcheck disable=SC1090
    source "$envfile"
    rm -f "$envfile"
  fi
  if [[ -n "${AXHUB_TOKEN:-}" && -n "${AXF_SESSION:-}" ]]; then
    mcp="$(mktemp "${TMPDIR:-/tmp}/axf-mcp-XXXXXX.json")"
    hub="${AXHUB_URL:-https://axhub.amberxai.com}"; hub="${hub%/}"; hub="${hub%/mcp}"
    printf '{"mcpServers":{"axhub":{"type":"http","url":"%s/mcp","headers":{"Authorization":"Bearer ${AXHUB_TOKEN}","X-Axhub-Session":"${AXF_SESSION}"}}}}\n' "$hub" > "$mcp"
    set -- --mcp-config "$mcp" "$@"
  fi
  printf '\033[2m# headless Claude Code · %s · %s\033[0m\n\n' "$(pwd)" "$(date '+%Y-%m-%d %H:%M')"
  wl="$(start_watch_live "$(tmux display-message -p '#S' 2>/dev/null || echo "axf-${name:-run}")")"
  prompt="$(cat "$brief")"
  [[ -n "$wl" ]] && prompt="$prompt"$'\n\n'"$WATCH_NOTE"
  if command -v node >/dev/null; then
    claude -p "$@" --output-format stream-json --verbose "$prompt" 2>&1 | tee "$raw" | node "$HERE/claude-stream.mjs" | tee "$log"
  else
    claude -p "$@" "$prompt" 2>&1 | tee "$log"
  fi
  st=${PIPESTATUS[0]}
  [[ -n "${mcp:-}" ]] && rm -f "$mcp"
  [[ -n "$wl" ]] && kill "$wl" 2>/dev/null   # the session ended: its previews stop and leave the registry
  printf '\n\033[1m── finished (exit %s) · log: %s/%s ──\033[0m\n' "$st" "$(pwd)" "$log"
  read -r -t 86400 -p "Press Enter to close this session. " _ || true
  exit "$st"
fi

slug="$(printf '%s' "${name:-run}" | tr -c 'A-Za-z0-9._-' '-' | sed 's/^-*//; s/-*$//' | cut -c1-48)"
session="axf-${slug:-run}"
# axHub 109: the build's name, sent as X-Axhub-Session (letters, digits, . _ - only; at most 48 here, 60 on the hub).
export AXF_SESSION="${AXF_SESSION:-${slug:-run}}"
[[ "$AXF_SESSION" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$ ]] || AXF_SESSION="${slug:-run}"
if ! command -v tmux >/dev/null; then
  nohup claude -p "$@" "$(cat "$brief")" > "$log" 2>&1 &
  echo "started pid $! in $(pwd) (tmux missing: the console can't show it)"
  exit 0
fi
tmux has-session -t "=$session" 2>/dev/null && session="$session-$(date +%H%M%S)"
envs=()   # tmux starts the command in its server's environment: pass what the run needs explicitly
for v in PATH HOME AXF_SURFACE AXF_MODEL AXF_ADOPT_CHANGE AXF_CLAUDE_AUTH AXF_SESSION AXHUB_URL; do
  [[ -n "${!v:-}" ]] && envs+=(-e "$v=${!v}")
done
# Secrets go through a private file, not tmux's command line: git auth (GIT_CONFIG_COUNT/KEY_n/VALUE_n, which tmux
# never passed before, so pushes from a headless build failed) and the axHub token (env, else the console's env file).
secret="$(umask 077; mktemp "${TMPDIR:-/tmp}/axf-headless-env-XXXXXX")"
{
  for v in $(compgen -e | grep -E '^GIT_CONFIG_(COUNT|KEY_[0-9]+|VALUE_[0-9]+|PARAMETERS)$'); do printf 'export %s=%q\n' "$v" "${!v}"; done
  tok="${AXHUB_TOKEN:-}"
  if [[ -z "$tok" && -r /opt/axf/.axf-console/env ]]; then tok="$(sed -n 's/^AXHUB_TOKEN=//p' /opt/axf/.axf-console/env | head -1 | tr -d '"'"'"'\r')"; fi
  [[ -n "$tok" ]] && printf 'export AXHUB_TOKEN=%q\n' "$tok"
} > "$secret"
tmux new-session -d -s "$session" -x 200 -y 50 -c "$(pwd)" "${envs[@]}" \
  bash "$HERE/claude-headless.sh" --inner --name "$slug" --envfile "$secret" --brief "$brief" --log "$log" -- "$@"
tmux set-option -t "$session" history-limit 50000 >/dev/null 2>&1 || true
echo "started $session in $(pwd)"
