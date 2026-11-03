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
# When it finishes and nobody is attached, the tmux session ends after closeFinishedAfterSec (agent cap settings, default
# 2 min; 120 s without the cap), logs kept. If a client is attached it waits for Enter up to a day.
# Headless tabs (Nov 3 2026, Brett): the console opens a tab for every running session with the agent, the model and a
# live cost. The run tags its tmux session (@axf_agent, @axf_model, @axf_meter, @axf_chain, @axf_cwd, @axf_kind) and
# appends session-start / session-end lines to $AXF_HEADLESS_DIR/events.jsonl (default /var/tmp/axf-headless). The stream
# printer keeps <session>.meter.json (headless-meter@1: status, cost from usage × framework/schemas/model-pricing.json,
# reconciled to the result's total_cost_usd) and <session>.chain.json (context-chain@1: the files the session takes in,
# with their rules) there, which the Terminal reads. Agent = --agent, else AXF_AGENT, else --name; model = AXF_MODEL,
# else the --model in the claude args.
# Without tmux it falls back to the old `nohup … &` (nothing to attach to; the systems check offers to install tmux).
# Activity banner: before Claude starts, `activity.mjs hooks ensure` adds any Claude Code hook event missing from the
# running user's ~/.claude/settings.json (root or axfbuild alike), so headless sessions report and close their lines.
# Watch live (watch-live@1): next to the session runs framework/cli/watch-live.mjs, which starts a hot-reloading preview
# for every app the session touches, registers it for the console (proxied at /preview/<session>/<app>/) and stops it
# when the session ends; the brief gets a line asking the session to `axf focus` the screen it works on.
# AXF_WATCH_LIVE=off turns it off. Its log: .axf-watch-live.log.
# Prints one line: "started <tmux session> in <folder>" (or "started pid …").
# Model upgrades (Brett, Nov 3 2026): before anything starts, framework/cli/model-gate.mjs checks the model against the
# orchestrator build the run belongs to (--name, AXF_BUILD_ID or the brief's "Continue build … (<id>)"): a higher model
# than its step, or an upgrade phase Brett hasn't approved, is refused with exit 3 and one line saying why. Every brief
# gets a line saying upgrades need Brett and downgrades are fine.
#
# Who asked (axHub decision 109, Nov 1 2026): the run exports AXF_SESSION=<slug of --name>. When an axHub token is at
# hand (AXHUB_TOKEN, else the console's env file), Claude gets an `axhub` MCP server whose requests carry
# `X-Axhub-Session: $AXF_SESSION`, so every approval it asks for shows "Headless · <name>". The token stays a
# ${AXHUB_TOKEN} placeholder in the config; Claude Code fills it from the environment.
# Secrets the run needs (GIT_CONFIG_* git auth, AXHUB_TOKEN) reach the tmux session through a 0600 file the inner run
# reads and deletes at once, never on a command line (tmux -e would show them in `ps`).
# Agent cap (agent-slots@1, Brett, Nov 1 2026): before starting, the run asks framework/cli/agent-slots.mjs for a slot
# (max running agents, memory guard; settings hot-reloaded from the console). No slot = it joins the queue (FIFO within
# --priority boss|urgent|normal|low, or the priority rules), prints "queued at position N (<id>) …" and a background
# waiter starts it by itself when a slot frees (cancelled from the console = it never starts). Inside tmux the run binds
# its slot, marks it finished when Claude exits (finished sessions don't count) and closes after closeFinishedAfterSec
# (the log stays). Heavy steps go through `agent-slots.mjs heavy -- <cmd>` (the brief says so). AXF_SLOTS=off skips it.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"   # vps.run / cron shells don't load the profile; Claude Code installs here

name="" brief="" log=".axf-headless.log" inner="" envfile="" mcp="" slot="" queued="" priority="${AXF_PRIORITY:-}" agent="${AXF_AGENT:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) name="$2"; shift 2 ;;
    --brief) brief="$2"; shift 2 ;;
    --log) log="$2"; shift 2 ;;
    --inner) inner=1; shift ;;
    --envfile) envfile="$2"; shift 2 ;;
    --slot) slot="$2"; shift 2 ;;
    --queued) queued="$2"; shift 2 ;;
    --priority) priority="$2"; shift 2 ;;
    --agent) agent="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "claude-headless: unknown option $1" >&2; exit 2 ;;
  esac
done
[[ -n "$brief" && -f "$brief" ]] || { echo "claude-headless: --brief <file> is required" >&2; exit 2; }
[[ "$log" =~ ^[A-Za-z0-9._-]{1,80}$ ]] || { echo "claude-headless: --log is a plain file name" >&2; exit 2; }
raw="${log%.log}.jsonl"
HDIR="${AXF_HEADLESS_DIR:-/var/tmp/axf-headless}"
model="${AXF_MODEL:-}"
if [[ -z "$model" ]]; then prev=""; for a in "$@"; do [[ "$prev" == --model ]] && model="$a"; [[ "$a" == --model=* ]] && model="${a#--model=}"; prev="$a"; done; fi
agent="${agent:-$name}"
hdir_ready() { mkdir -p "$HDIR" 2>/dev/null && { [[ -O "$HDIR" ]] && chmod 1777 "$HDIR" 2>/dev/null; true; } && [[ -w "$HDIR" ]]; }
event() {   # $1 = session-start | session-end, $2 = tmux session, $3 = exit (end only); one JSON line, never fails the run
  hdir_ready || return 0
  command -v node >/dev/null || return 0
  EV="$1" SES="$2" EXITC="${3:-}" AGENT="$agent" MODEL="$model" NAME="$name" LOGF="$(pwd)/$log" node -e '
    const e = process.env; const line = { event: e.EV, session: e.SES, name: e.NAME, agent: e.AGENT, model: e.MODEL, cwd: process.cwd(), log: e.LOGF,
      surface: e.AXF_SURFACE || "", at: new Date().toISOString(), ...(e.EXITC !== "" ? { exit: Number(e.EXITC) } : {}) };
    require("fs").appendFileSync(require("path").join(e.HDIR, "events.jsonl"), JSON.stringify(line) + "\n");' 2>/dev/null || true
}
export HDIR

WATCH_LIVE="$HERE/../framework/cli/watch-live.mjs"
WATCH_NOTE='Watch live: Brett can watch the screen you are changing hot-render in the console. Whenever you start work on a screen or element, run `node framework/cli/axf.mjs focus <app> [route] [css-selector] --note "<what you are changing>"` (apps: console-web, axhub-web, amberx-droid, walkthrough-studio, demo, framework, console, axhub-android, voicevault).'
SLOTS="$HERE/../framework/cli/agent-slots.mjs"
slots_on() { [[ "${AXF_SLOTS:-on}" != off ]] && command -v node >/dev/null && [[ -f "$SLOTS" ]]; }
HEAVY_NOTE="Agent cap: heavy steps (pnpm/npm/vite builds, docker node:22 test runs, Playwright) share a VPS-wide lock. Run each one as \`node $SLOTS heavy -- <command>\` so only a few run at once."
start_watch_live() {   # $1 = session name; prints the watcher pid (empty when off or unavailable)
  [[ "${AXF_WATCH_LIVE:-on}" == off ]] && return 0
  command -v node >/dev/null && [[ -f "$WATCH_LIVE" ]] || return 0
  node "$WATCH_LIVE" watch --session "$1" --worktree "$(pwd)" --parent "$$" > .axf-watch-live.log 2>&1 &
  echo $!
}

GATE="$HERE/../framework/cli/model-gate.mjs"
UPGRADE_NOTE="Model switches (Brett, Nov 3 2026): a downgrade (e.g. Fable → Opus) is fine. An UPGRADE (e.g. Opus → Fable) needs Brett's approval: when you reach one, run \`node apps/console-web/plugins/build-orchestrator/orchestrator.mjs request-upgrade <id> <phase>\`, ask once, and stop. Never approve a model switch upgrade yourself (no \`act approve\` on an upgrade), never relaunch on a higher model."  # axf-plugin:build-orchestrator
# Upgrades need Brett (framework/cli/model-gate.mjs): a build may not start on a higher model than its orchestrator step,
# nor start a phase that upgrades the model before Brett approved it. Checked once, before the slot (the queue waiter
# and the tmux inner run were checked when they were asked for). AXF_BUILD_ID names the build when the name doesn't.
if [[ -z "$inner" && -z "$queued" ]] && command -v node >/dev/null && [[ -f "$GATE" ]]; then
  model="${AXF_MODEL:-}"; prev=""
  for a in "$@"; do [[ "$prev" == --model ]] && model="$a"; prev="$a"; done
  if [[ -n "$model" ]]; then
    verdict="$(node "$GATE" launch --model "$model" --name "$name" --brief "$brief" 2>&1)"; gate_st=$?
    if (( gate_st == 3 )); then echo "claude-headless: $verdict" >&2; echo "$verdict"; exit 3; fi
  fi
fi

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
  if [[ -n "$slot" ]] && slots_on; then
    node "$SLOTS" bind "$slot" --pid "$$" --session "$(tmux display-message -p '#S' 2>/dev/null || echo "axf-${name:-run}")" >/dev/null 2>&1 || true
  fi
  printf '\033[2m# headless Claude Code · %s · %s\033[0m\n\n' "$(pwd)" "$(date '+%Y-%m-%d %H:%M')"
  # Activity banner hooks (Oct 31 2026): add whatever event is missing from this user's ~/.claude/settings.json (an old
  # install without PostToolUse left every push/pull/merge/delete/build line open as a ghost). Never blocks the run.
  act="$HERE/../apps/console-web/plugins/activity/activity.mjs"  # axf-plugin:activity
  command -v node >/dev/null && [[ -f "${act:-}" ]] && node "$act" hooks ensure >/dev/null 2>&1 || true  # axf-plugin:activity
  wl="$(start_watch_live "$(tmux display-message -p '#S' 2>/dev/null || echo "axf-${name:-run}")")"
  prompt="$(cat "$brief")"
  [[ -n "$wl" ]] && prompt="$prompt"$'\n\n'"$WATCH_NOTE"
  [[ -n "$slot" ]] && slots_on && prompt="$prompt"$'\n\n'"$HEAVY_NOTE"
  prompt="$prompt"$'\n\n'"${UPGRADE_NOTE:-}"
  # Several Claude accounts (Nov 2 2026, Brett): when the run stops on a usage limit ("You've hit your weekly limit"),
  # AI keys switches to the next saved account that still answers and writes it to the VPS (the AI keys plugin),
  # then the run starts again on it. At most AXF_ACCOUNT_SWITCHES times (default 3; 0 turns it off).
  switches=0 max_switches="${AXF_ACCOUNT_SWITCHES:-3}"
  while :; do
    if command -v node >/dev/null; then
      ses="$(tmux display-message -p '#S' 2>/dev/null || echo "axf-${name:-run}")"; meter=()
      hdir_ready && meter=(--meter "$HDIR/$ses.meter.json" --chain "$HDIR/$ses.chain.json" --session "$ses" --name "$name" --agent "$agent" --model "$model")
      claude -p "$@" --output-format stream-json --verbose "$prompt" 2>&1 | tee "$raw" | node "$HERE/claude-stream.mjs" "${meter[@]}" | tee "$log"
    else
      claude -p "$@" "$prompt" 2>&1 | tee "$log"
    fi
    st=${PIPESTATUS[0]}
    (( switches < max_switches )) || break
    tail -n 40 "$log" 2>/dev/null | grep -qiE "hit your (weekly |daily |session |5-hour )?limit|usage limit reached|out of credits|credit balance is too low" || break
    sw_js="$HERE/../apps/console-web/plugins/ai-keys/switch.mjs"  # axf-plugin:ai-keys
    command -v node >/dev/null && [[ -f "$sw_js" ]] || break
    printf '\n\033[1m── this Claude account hit its limit: switching accounts ──\033[0m\n'
    sw="$(node "$sw_js" --reason "headless build ${name:-run} hit its limit" 2>&1)" || { printf '%s\n' "$sw"; break; }
    printf '%s · starting again\n\n' "$sw"
    switches=$((switches + 1))
  done
  [[ -n "${mcp:-}" ]] && rm -f "$mcp"
  [[ -n "$wl" ]] && kill "$wl" 2>/dev/null   # the session ended: its previews stop and leave the registry
  printf '\n\033[1m── finished (exit %s) · log: %s/%s ──\033[0m\n' "$st" "$(pwd)" "$log"
  event session-end "$(tmux display-message -p '#S' 2>/dev/null || echo "axf-${name:-run}")" "$st"
  # Nobody attached (the usual headless run): close ~2 min after claude exits, logs stay. Someone watching keeps the
  # old wait for Enter (up to a day). Finished sessions piling up used to block the cap and the queue (Nov 1 2026).
  session_now="$(tmux display-message -p '#S' 2>/dev/null || true)"
  clients=0; [[ -n "$session_now" ]] && clients="$(tmux list-clients -t "=$session_now" 2>/dev/null | wc -l)"
  close=120; (( clients > 0 )) && close=86400
  if [[ -n "$slot" ]] && slots_on; then   # finished = the slot is free now
    node "$SLOTS" finish "$slot" --exit "$st" >/dev/null 2>&1 || true
    if (( clients == 0 )); then close="$(node "$SLOTS" get closeFinishedAfterSec 2>/dev/null || echo 120)"; [[ "$close" =~ ^[0-9]+$ ]] || close=120; fi
  fi
  if (( close > 0 )); then
    if (( clients > 0 )); then read -r -t "$close" -p "Enter closes it (waits up to ${close}s). " _ || true
    else printf 'Closes by itself in %ss.\n' "$close"; sleep "$close"; fi
  fi
  [[ -n "$slot" ]] && slots_on && node "$SLOTS" release "$slot" --exit "$st" >/dev/null 2>&1
  exit "$st"
fi

slug="$(printf '%s' "${name:-run}" | tr -c 'A-Za-z0-9._-' '-' | sed 's/^-*//; s/-*$//' | cut -c1-48)"
session="axf-${slug:-run}"
# axHub 109: the build's name, sent as X-Axhub-Session (letters, digits, . _ - only; at most 48 here, 60 on the hub).
export AXF_SESSION="${AXF_SESSION:-${slug:-run}}"
[[ "$AXF_SESSION" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$ ]] || AXF_SESSION="${slug:-run}"
if [[ -n "$queued" ]]; then   # the background waiter: hold until the queue hands this run a slot
  slots_on || exit 0
  node "$SLOTS" wait "$queued" --pid "$$" || { echo "claude-headless: $queued left the queue (cancelled); not starting"; exit 0; }
  slot="$queued"
elif slots_on; then
  node "$SLOTS" sweep >/dev/null 2>&1 || true   # close finished sessions first: they don't hold a slot
  slot_id="" slot_started=1 slot_pos=0 slot_reason=none
  eval "$(node "$SLOTS" enqueue --name "$slug" --kind headless ${priority:+--priority "$priority"} --pid "$$" --cwd "$(pwd)" --sh 2>/dev/null | grep -E '^slot_id=[A-Za-z0-9-]+ slot_started=[01] slot_pos=[0-9]+ slot_reason=[a-z]+$')"
  if [[ -n "$slot_id" && "$slot_started" == 0 ]]; then
    ${SETSID:-$(command -v setsid)} nohup bash "$HERE/claude-headless.sh" --queued "$slot_id" --name "$name" --agent "$agent" --brief "$brief" --log "$log" -- "$@" > .axf-queue.log 2>&1 &
    why=""; [[ "$slot_reason" == memory ]] && why=", waiting for free memory"
    echo "queued at position $slot_pos ($slot_id$why) in $(pwd): starts by itself when a slot frees"
    exit 0
  fi
  slot="$slot_id"
fi
if ! command -v tmux >/dev/null; then
  nohup claude -p "$@" "$(cat "$brief")" > "$log" 2>&1 &
  [[ -n "$slot" ]] && slots_on && node "$SLOTS" bind "$slot" --pid "$!" >/dev/null 2>&1
  echo "started pid $! in $(pwd) (tmux missing: the console can't show it)"
  exit 0
fi
tmux has-session -t "=$session" 2>/dev/null && session="$session-$(date +%H%M%S)"
envs=()   # tmux starts the command in its server's environment: pass what the run needs explicitly
for v in PATH HOME AXF_SURFACE AXF_MODEL AXF_AGENT AXF_HEADLESS_DIR AXF_ADOPT_CHANGE AXF_CLAUDE_AUTH AXF_SESSION AXHUB_URL AXF_SLOTS AXF_SLOTS_DIR AXF_SLOTS_PREFIX AXF_SLOTS_HOST AXF_WATCH_LIVE; do
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
  bash "$HERE/claude-headless.sh" --inner --name "$slug" --agent "$agent" --envfile "$secret" --brief "$brief" --log "$log" ${slot:+--slot "$slot"} -- "$@"
tmux set-option -t "$session" history-limit 50000 >/dev/null 2>&1 || true
# Headless tabs: what the console's Terminal shows on the tab (one `tmux ls` reads them all)
for kv in "@axf_kind=headless" "@axf_agent=$agent" "@axf_model=$model" "@axf_cwd=$(pwd)" "@axf_meter=$HDIR/$session.meter.json" "@axf_chain=$HDIR/$session.chain.json"; do
  tmux set-option -t "$session" "${kv%%=*}" "${kv#*=}" >/dev/null 2>&1 || true
done
event session-start "$session"
echo "started $session in $(pwd)"
