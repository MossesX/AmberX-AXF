#!/usr/bin/env bash
# Rollback drill for the host services migration (deploy/host-services/migrate.mjs): a throwaway checkout with one demo
# service that replaces a cron line, the demo daemon and the host API on sockets in a temp folder, systemctl / sudo as
# stubs that remember unit states, a temp cron folder. Walks container → shadow (the host dry-runs, the console's runs
# are reported and compared) → host (cron line moved aside, verify) → rollback (mode container, unit stopped, cron line
# back, verify), and checks a cut-over straight from container is refused. Nothing on this machine changes.
#   bash deploy/dryrun/host-services-rollback.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d /tmp/axf-host-drill.XXXXXX)"
PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$T"; }
trap cleanup EXIT
N=0; ok() { N=$((N + 1)); echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; for f in "$T"/*.log; do echo "--- $f" >&2; tail -20 "$f" >&2; done; exit 1; }

R="$T/root"; mkdir -p "$R/deploy/host-services/services" "$R/deploy/host-services/workers" "$R/framework/core" "$T/data" "$T/run" "$T/cron" "$T/bin" "$T/units"
cp "$REPO/framework/core/host-services.mjs" "$R/framework/core/"
cp "$REPO/deploy/host-services/axf-hostd.mjs" "$R/deploy/host-services/"
cp "$REPO/deploy/host-services/services/host-api.json" "$R/deploy/host-services/services/"
cat > "$R/deploy/host-services/services/demo.json" <<'EOF'
{ "$axf": "host-service@1", "id": "demo", "title": "Demo", "kind": "daemon", "unit": "axf-demo.service", "plugin": "console",
  "runner": "deploy/host-services/workers/demo.mjs", "health": { "intervalSec": 5 },
  "replaces": [ { "kind": "cron", "name": "axf-demo", "where": "drill" } ] }
EOF
cat > "$R/deploy/host-services/workers/demo.mjs" <<'EOF'
export const intervalSec = 5;
export async function tick(ctx) { return { result: 'ok', message: ctx.dryRun ? 'would publish' : 'published', effects: ['publish'] }; }
EOF
echo '* * * * * root echo demo' > "$T/cron/axf-demo"
# stubs: sudo records the call and flips the unit's state; systemctl show reads it
cat > "$T/bin/sudo" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$T/sudo.log"
[ "\$2" = /usr/bin/systemctl ] || exit 0
case "\$3" in stop) echo inactive > "$T/units/\$4" ;; start|restart) echo active > "$T/units/\$4" ;; esac
EOF
cat > "$T/bin/systemctl" <<EOF
#!/bin/sh
s=\$(cat "$T/units/\$2" 2>/dev/null || echo inactive)
printf 'ActiveState=%s\nMainPID=0\nNRestarts=0\nUnitFileState=enabled\nLoadState=loaded\n' "\$s"
EOF
printf '#!/bin/sh\necho "2026-11-18T00:00:00+0000 host demo[1]: drill"\n' > "$T/bin/journalctl"
chmod +x "$T/bin/"*
echo active > "$T/units/axf-demo.service"

export AXF_HOST_ROOT="$R" AXF_HOST_DATA="$T/data" AXF_HOST_SOCKET_DIR="$T/run" AXF_HOST_TOKEN=drill AXF_HOST_PORT=$((20000 + RANDOM % 5000)) \
  AXF_HOST_SYSTEMCTL="$T/bin/systemctl" AXF_HOST_JOURNALCTL="$T/bin/journalctl" AXF_HOST_SUDO="$T/bin/sudo" \
  AXF_HOST_MIN_SHADOW_MS=1000 AXF_HOST_MIN_RUNS=2 AXF_CRON_DIR="$T/cron" AXF_MIGRATE_WAIT_S=20 \
  AXF_HOST_API="unix:$T/run/api.sock" AXF_HOST_API_FALLBACK="" AXF_CONSOLE_URL="" AXF_TOKEN=""
node "$R/deploy/host-services/axf-hostd.mjs" demo > "$T/demo.log" 2>&1 & PIDS+=($!)
AXF_HOST_PORT=$((AXF_HOST_PORT + 1)) node "$R/deploy/host-services/axf-hostd.mjs" host-api > "$T/api.log" 2>&1 & PIDS+=($!)
for _ in $(seq 50); do [ -S "$T/run/api.sock" ] && [ -S "$T/run/demo.sock" ] && break; sleep 0.2; done
[ -S "$T/run/api.sock" ] || fail "host API did not start"
M="node $REPO/deploy/host-services/migrate.mjs"
report() { node --input-type=module -e "import { call } from '$REPO/framework/cli/host-services.mjs'; await call('POST', '/services/demo/shadow', { result: 'ok', effects: ['publish'] });"; }

if $M host demo --json > "$T/refused.json" 2> "$T/refused.err"; then fail "container → host was allowed"; fi
grep -q "shadow first" "$T/refused.err" || fail "refusal did not say shadow first: $(cat "$T/refused.err")"
ok "container → host refused (shadow first)"

$M shadow demo --json > "$T/shadow.json" || fail "shadow: $(cat "$T/shadow.json")"
node -e "const o=require('$T/shadow.json'); if(!o.verify.ok) { console.error(JSON.stringify(o.verify)); process.exit(1) }" || fail "shadow verify"
ok "container → shadow, verified (host dry-run recorded, cron line still there)"

for _ in 1 2 3; do report; sleep 0.4; done
grep -q '"side":"container"' "$T/data/host-services/demo/shadow.jsonl" || fail "container runs not logged"
grep -q '"side":"host"' "$T/data/host-services/demo/shadow.jsonl" || fail "host dry-runs not logged"
! grep -q '"\$axf":"host-shadow-drift@1"' "$T/data/host-services/demo/shadow.jsonl" || fail "drift between identical runs"
ok "shadow: console and host runs compared, no drift"
# the cut-over guard counts clean host dry-runs (the runner records each one in the mode file): wait for two
for _ in $(seq 40); do node -e "const d=require('$T/data/host-services/mode.json'); process.exit((d.services.demo||{}).runs>=2?0:1)" 2>/dev/null && break; sleep 0.5; done
node -e "const d=require('$T/data/host-services/mode.json'); process.exit((d.services.demo||{}).runs>=2?0:1)" || fail "clean shadow runs not counted: $(cat "$T/data/host-services/mode.json")"
ok "clean host dry-runs counted towards the cut-over guard"
sleep 1.2

$M host demo --json > "$T/host.json" || fail "host: $(cat "$T/host.json")"
[ ! -e "$T/cron/axf-demo" ] || fail "cron line still there in host mode"
[ -f "$T/data/host-services/demo/cron-backup/axf-demo" ] || fail "cron line not backed up"
ok "shadow → host: cron line moved aside (backed up), verified"

$M rollback demo --json > "$T/rollback.json" || fail "rollback: $(cat "$T/rollback.json")"
node -e "const o=require('$T/rollback.json'); if(!o.verify.ok||o.to!=='container') { console.error(JSON.stringify(o)); process.exit(1) }" || fail "rollback verify"
[ -f "$T/cron/axf-demo" ] || fail "cron line not restored"
grep -q -- "-n /usr/bin/systemctl stop axf-demo.service" "$T/sudo.log" || fail "unit not stopped through sudo"
grep -q '"mode": "container"' "$T/data/host-services/mode.json" || fail "mode file not container"
ok "rollback: mode container, unit stopped through sudo, cron line restored, verified"

$M rollback demo --dry-run --json > "$T/plan.json"
grep -q '"do": "mode"' "$T/plan.json" || fail "dry-run plan"
ok "rollback --dry-run prints the steps (mode first)"
echo "✓ host-services rollback drill: $N checks"
