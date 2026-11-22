#!/usr/bin/env bash
# End-to-end test of the build watchdog (build-watchdog@1) with a fake claude, everything in a temp folder:
#   1. a Queue build is started the real way: the dispatcher tick (pipeline.mjs, its dispatch token) runs
#      deploy/claude-headless.sh, which takes an agent slot and starts the fake claude in HOME/.local/bin inside tmux
#      (its own tmux server: TMUX_TMPDIR)
#   2. the fake claude is killed (SIGTERM → exit 143); the wrapper records the run end (builds-live run-end, the slot's
#      run-status file); the dispatcher's own end hook is off (AXF_PIPELINE_EXIT=off), as when it is missed
#   3. watchdog.mjs run: the build is reset and requeued, its slot freed, the recovery recorded and the phone FYI sent;
#      the pass then ticks the dispatcher, which starts the build again (the slot is refilled)
# Then the notify-control registry test runs (the watchdog's notify types must be in the registry).
#   bash apps/console-web/plugins/build-orchestrator/test-watchdog-e2e.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
command -v tmux >/dev/null || { echo "watchdog e2e: skipped (no tmux)"; exit 0; }
T="$(mktemp -d "${TMPDIR:-/tmp}/axf-wd-e2e-XXXXXX")"
REAL_HOME="$HOME" REAL_PATH="$PATH"   # the registry test runs with the real ones (python's user site-packages)
ID="wd-e2e-$(date +%s)-$$"
cleanup() { TMUX_TMPDIR="$T/tmux" tmux kill-server >/dev/null 2>&1 || true; pkill -TERM -f "$T/home/.local/bin/claude" >/dev/null 2>&1 || true; sleep 2; rm -rf "$T"; }   # the killed wrappers write their run end first
trap cleanup EXIT
mkdir -p "$T"/{home/.local/bin,tmux,pipe,slots,headless,wt,accounts/w-max,workers,claude-home,cron.d}
fail() { echo "✗ $*" >&2; exit 1; }
ok() { echo "  ✓ $*"; }

# the fake claude: one init line, then it works until it is killed (SIGTERM → exit 143)
cat > "$T/home/.local/bin/claude" <<'EOF'
#!/usr/bin/env bash
echo '{"type":"system","subtype":"init","session_id":"fake","model":"claude-opus","tools":[],"mcp_servers":[]}'
trap 'exit 143' TERM
while :; do sleep 0.2; done
EOF
chmod +x "$T/home/.local/bin/claude"
echo '{}' > "$T/accounts/w-max/.credentials.json"; echo 'w-max' > "$T/accounts/.active"; echo '{}' > "$T/claude.json"
echo '{"w-max":{"email":"max@x","plan":"max"}}' > "$T/workers/seen.json"; echo '{"workers":["w-max"]}' > "$T/workers/workers.json"

export HOME="$T/home" PATH="$T/home/.local/bin:$PATH" TMUX_TMPDIR="$T/tmux"
unset TMUX AXF_BUILD_ID AXF_SESSION AXF_DISPATCH_TOKEN AXF_WATCHDOG_SETTINGS AXF_WATCHDOG_PROBE AXF_WATCHDOG_ACCOUNTS
export AXF_BUILDS_STORE="$T/store.json" AXF_BUILDS_LIVE=0 AXF_BUILD_HOOKS=off AXF_SHIPPED=off AXF_DATA_DIR=off AXF_BUILD_PROFILE=all
export AXF_PIPELINE_DIR="$T/pipe" AXF_SLOTS_DIR="$T/slots" AXF_SLOTS_MEM_GB=8 AXF_HEADLESS_DIR="$T/headless" AXF_PIPELINE_WORKTREES="$T/wt" AXF_PIPELINE_WORKTREE_MODE=mkdir
export AXF_CLAUDE_ACCOUNTS="$T/accounts" AXF_CLAUDE_SEEN="$T/workers/seen.json" AXF_CLAUDE_WORKERS="$T/workers" AXF_CLAUDE_HOME="$T/claude-home" AXF_CLAUDE_GLOBAL="$T/claude.json"
export AXF_CLAUDE_SETTINGS_FILE="$T/claude-settings.json" AXF_PIPELINE_CONSOLE=off AXF_PIPELINE_SPLITTER=/bin/false AXF_PIPELINE_SETTINGS='{"parallelPerAccount":2,"idleAfterMin":0,"splitProvider":"off"}'
export AXF_PIPELINE_LOCK="$T/pipeline.lock" AXF_PIPELINE_LOCKED=1 AXF_PIPELINE_EXIT=off AXF_CREW_SAY=off
export AXF_ORIGIN=off AXF_LOOK_GATE=off AXF_AGENT_BOOK=off AXF_BUILD_LIMIT=off AXF_BUILD_SLICE=off AXF_OWN_LOGIN=off AXF_WORKERS=off AXF_WATCH_LIVE=off AXF_LOGIN_NOTE=off AXF_STILL_CHECK_OFF=1 AXF_ACCOUNT_SWITCHES=0
export AXF_WATCHDOG_NOTIFY_LOG="$T/notify.jsonl" AXF_WATCHDOG_CRON="$T/cron.d/axf-watchdog"
node "$ROOT/framework/cli/agent-slots.mjs" set closeFinishedAfterSec=600 >/dev/null   # the finished session waits to close: the watchdog closes it
PIPE="node $HERE/pipeline.mjs"; WD="node $HERE/watchdog/sessions.mjs"; ORCH="node $HERE/orchestrator.mjs"
js() { node -e "const s=JSON.parse(require('fs').readFileSync('$T/store.json','utf8'));const b=s.builds.find(x=>x.id==='$ID');$1"; }
wait_for() { local i; for i in $(seq 1 "${2:-100}"); do eval "$1" && return 0; sleep 0.2; done; return 1; }

cd "$ROOT"
$ORCH act "{\"action\":\"add\",\"id\":\"$ID\",\"title\":\"Watchdog e2e\",\"steps\":[{\"text\":\"do it\",\"model\":\"Opus\",\"estimate\":\"10 min\"},{\"text\":\"and more\",\"model\":\"Opus\",\"estimate\":\"10 min\"}]}" --json >/dev/null
$PIPE queue "$ID" --by test --json >/dev/null
$PIPE tick --json > "$T/tick1.json" || fail "the first tick failed: $(tail -c 600 "$T/tick1.json")"
[[ "$(js 'console.log(b.status)')" == running ]] || fail "not launched: $(js 'console.log(b.status, JSON.stringify(b.pipeline))') $(tail -c 400 "$T/tick1.json")"
wait_for "pgrep -f '$T/home/.local/bin/claude' >/dev/null" 150 || fail "the fake claude never started (log: $(cat "$T/wt/$ID/$ID.log" 2>/dev/null | tail -5))"
SES1="$(js 'console.log(b.pipeline.session)')"
LAUNCH1="$(js 'console.log(b.pipeline.launchedAt)')"
wait_for "node -e \"const st=require('$T/slots/state.json');process.exit(st.running.some(r=>r.build==='$ID'||r.name==='$ID')?0:1)\"" 50 || fail "no agent slot for the run"
SLOT1="$(node -e "const st=require('$T/slots/state.json');console.log(st.running.find(r=>r.build==='$ID'||r.name==='$ID').id)")"
ok "launched through the dispatcher and claude-headless.sh: $SES1 (slot $SLOT1)"

$WD scan --json > "$T/scan0.json"
node -e "const s=require('$T/scan0.json');const x=s.builds.find(b=>b.id==='$ID');if(!x||x.decision.stuck||x.decision.cause!=='live'&&x.decision.cause!=='starting')process.exit(1)" || fail "a live build was called stuck: $(cat "$T/scan0.json" | head -c 800)"
ok "while it runs the watchdog leaves it alone"

pkill -TERM -f "$T/home/.local/bin/claude"
wait_for "js 'process.exit(b.pipeline.runEnd && b.pipeline.runEnd.exit===143 ? 0 : 1)'" 150 || fail "no run end recorded: $(js 'console.log(JSON.stringify(b.pipeline))')"
[[ "$(js 'console.log(b.status)')" == running ]] || fail "the build moved on by itself: $(js 'console.log(b.status)')"
[[ -f "$T/slots/runs/$ID.json" ]] || fail "no run-status file under the slot dir"
ok "killed (SIGTERM): exit 143 / SIGTERM on the run record and runs/$ID.json; still marked running"

$WD run --json > "$T/run.json" || fail "watchdog run failed: $(tail -c 800 "$T/run.json")"
node -e "
const r=require('$T/run.json'); const f=r.fixes.find(x=>x.buildId==='$ID');
if(!f) { console.error(JSON.stringify(r).slice(0,1500)); process.exit(1); }
if(f.cause!=='exit-killed'||f.action!=='retry'||f.exit!==143) { console.error(JSON.stringify(f)); process.exit(1); }
if(!r.fill.launched.includes('$ID')) { console.error('not refilled', JSON.stringify(r.fill)); process.exit(1); }" || fail "the pass did not fix and refill it"
ok "watchdog run: exit-killed → retry, then the pass ticked the dispatcher and started it again"

js "
const r=b.recoveries||[]; if(r.length!==1||r[0].cause!=='exit-killed'||r[0].exit!==143||!r[0].notified) { console.error(JSON.stringify(r)); process.exit(1); }
if(b.status!=='running'||!(b.pipeline.launchedAt>'$LAUNCH1')||!(b.pipeline.launchedAt>b.pipeline.runEnd.at)||b.pipeline.runs!==2) { console.error(b.status, JSON.stringify(b.pipeline)); process.exit(1); }" || fail "build not requeued and relaunched with its recovery"
ok "recovery recorded on the build (notified), requeued and relaunched as run 2"
node -e "
const st=require('$T/slots/state.json'); const run=st.running.map(r=>r.id);
if(run.includes('$SLOT1')) { console.error('old slot still held', run); process.exit(1); }
if(!st.done.some(d=>d.id==='$SLOT1')) { console.error('old slot not closed'); process.exit(1); }
if(!st.running.concat(st.queue).some(r=>r.build==='$ID'||r.name==='$ID')) { console.error('no new slot for the relaunch', JSON.stringify(st.running)); process.exit(1); }" || fail "slot not freed and refilled"
ok "the old slot was freed and a new one taken for the relaunch"
[[ "$(TMUX_TMPDIR="$T/tmux" tmux ls -F '#S' 2>/dev/null | grep -c "^axf-$ID")" -le 1 ]] || fail "the dead session was left open next to the relaunch: $(TMUX_TMPDIR="$T/tmux" tmux ls)"
ok "the dead session's tmux was closed (one session for the build: the relaunch)"
[[ "$(wc -l < "$T/notify.jsonl")" -eq 1 ]] || fail "expected one phone FYI, got: $(cat "$T/notify.jsonl")"
node -e "const a=JSON.parse(require('fs').readFileSync('$T/notify.jsonl','utf8'));if(a.source!=='watchdog'||!/^watchdog:fix:/.test(a.key)||a.meta.builds[0]!=='$ID')process.exit(1)" || fail "the FYI is not a watchdog.fix for $ID"
ok "one phone FYI (source watchdog, watchdog.fix)"

$WD run --json > "$T/run2.json"
node -e "const r=require('$T/run2.json');if(r.fixes.length)process.exit(1)" || fail "a second pass changed something: $(head -c 600 "$T/run2.json")"
ok "a second pass does nothing"

echo "  … notify-control registry test"
HOME="$REAL_HOME" PATH="$REAL_PATH" python3 "$ROOT/apps/console-web/plugins/notify-control/test.py" | tail -1  # axf-plugin:notify-control
echo "watchdog e2e: passed"
