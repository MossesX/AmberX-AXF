#!/usr/bin/env bash
# install-build-limit.sh — puts the VPS's hard build limit (build-limit@1, framework/cli/build-limit.mjs) in place on the
# host (Brett, Nov 12 2026: "Add a HARD limit enforced by the VPS itself, not by Claude or the dispatcher").
#
#   sudo bash deploy/install-build-limit.sh            install / refresh (idempotent)
#   sudo bash deploy/install-build-limit.sh --remove   take it out (the slice, the timer, the installed copy; the config stays)
#
# What it does (root on the host):
#   - copies framework/cli/build-limit.mjs (standalone) to /usr/local/lib/axf/build-limit.mjs, so the enforcer runs even
#     from a checkout that doesn't have it yet; the timer prefers /opt/axf's copy once it is there;
#   - writes the config <agent-slots dir>/build-limit.json with the defaults when there is none (maxBuilds 8);
#   - writes /etc/systemd/system/axf-builds.slice (CPUQuota, MemoryHigh, MemoryMax, TasksMax from the config) and starts it;
#   - installs axf-build-limit.service + .timer (every 30 s): `build-limit.mjs enforce` keeps the slice in step with the
#     config, moves any axf-* tmux pane tree or `claude -p` tree still outside it into it, gives docker test containers
#     (node:*, Playwright) --cpus / --memory with `docker update`, and writes the live count the console shows.
# The launch gates themselves live in deploy/claude-headless.sh and the swarm runner (they refuse the N+1st build).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../framework/cli/build-limit.mjs"
LIB=/usr/local/lib/axf
UNIT_DIR=/etc/systemd/system
[[ "$(id -u)" == 0 ]] || { echo "install-build-limit: run as root" >&2; exit 2; }
command -v systemctl >/dev/null && [[ -d /run/systemd/system ]] || { echo "install-build-limit: needs systemd" >&2; exit 2; }
NODE="$(command -v node)" || { echo "install-build-limit: needs node" >&2; exit 2; }

if [[ "${1:-}" == --remove ]]; then
  systemctl disable --now axf-build-limit.timer 2>/dev/null || true
  rm -f "$UNIT_DIR/axf-build-limit.service" "$UNIT_DIR/axf-build-limit.timer" "$UNIT_DIR/axf-builds.slice" "$LIB/build-limit.mjs"
  systemctl daemon-reload
  echo "removed: the timer and the slice unit (running builds keep their scopes until they end; the config stays)"
  exit 0
fi

mkdir -p "$LIB"
install -m 0755 "$SRC" "$LIB/build-limit.mjs"
# the config: defaults on first install, never overwritten (only Brett changes it)
CFG_DIR="$("$NODE" -e 'import("'"$LIB"'/build-limit.mjs").then((m) => console.log(m.slotsDir()))')"
mkdir -p "$CFG_DIR"
if [[ ! -f "$CFG_DIR/build-limit.json" ]]; then
  "$NODE" -e 'import("'"$LIB"'/build-limit.mjs").then((m) => { const fs = require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ ...m.normLimit({}), setBy: "install (default)", setAt: new Date().toISOString() }, null, 2) + "\n"); })' "$CFG_DIR/build-limit.json"
  chmod 0664 "$CFG_DIR/build-limit.json"
  echo "config: $CFG_DIR/build-limit.json (defaults: $("$NODE" "$LIB/build-limit.mjs" status | head -1))"
fi
"$NODE" "$LIB/build-limit.mjs" slice-unit > "$UNIT_DIR/axf-builds.slice"

cat > "$UNIT_DIR/axf-build-limit.service" <<EOF
# Written by deploy/install-build-limit.sh (build-limit@1). The VPS's hard build limit enforcer.
[Unit]
Description=AXF hard build limit: slice caps, adopt stray build processes, docker test-run limits, live count
After=docker.service

[Service]
Type=oneshot
Nice=-5
ExecStart=/bin/sh -c 'f=/opt/axf/framework/cli/build-limit.mjs; [ -f "\$f" ] || f=$LIB/build-limit.mjs; exec $NODE "\$f" enforce'
TimeoutStartSec=60
EOF
cat > "$UNIT_DIR/axf-build-limit.timer" <<EOF
# Written by deploy/install-build-limit.sh (build-limit@1).
[Unit]
Description=AXF hard build limit enforcer, every 30 s

[Timer]
OnBootSec=20s
OnUnitActiveSec=30s
AccuracySec=5s

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl start axf-builds.slice
systemctl enable --now axf-build-limit.timer >/dev/null
systemctl start axf-build-limit.service || true
echo "installed: axf-builds.slice ($(systemctl show axf-builds.slice -p CPUQuotaPerSecUSec -p MemoryMax --value | paste -sd' ')), axf-build-limit.timer (every 30 s)"
"$NODE" "$LIB/build-limit.mjs" status | head -2
