#!/usr/bin/env bash
# install-hand-build.sh — the host half of the hand build lane (hand-build@1, framework/cli/hand-build.mjs; Brett,
# Nov 21 2026: hand builds start from Plan Studio, tracked, without the Pipeline 2.0 dispatcher).
#
#   sudo bash deploy/install-hand-build.sh            install / refresh (idempotent)
#   sudo bash deploy/install-hand-build.sh --remove   take it out
#
# The console runs in a container without the host's tmux, so a hand build Brett starts there is recorded in the builds
# store (signed as emergency) and launched here: axf-hand-build.timer runs `hand-build.mjs tick` every 10 s, which
# launches every recorded hand build (worktree from /opt/axf on claude/<id>, deploy/claude-headless.sh in tmux, the
# model he picked, one emergency slot) and keeps each open one's live state (building, PR #, CI, merged) on its record.
# A tick with nothing to do reads the store once and exits.
set -euo pipefail
UNIT_DIR=/etc/systemd/system
[[ "$(id -u)" == 0 ]] || { echo "install-hand-build: run as root" >&2; exit 2; }
command -v systemctl >/dev/null && [[ -d /run/systemd/system ]] || { echo "install-hand-build: needs systemd" >&2; exit 2; }
NODE="$(command -v node)" || { echo "install-hand-build: needs node" >&2; exit 2; }

if [[ "${1:-}" == --remove ]]; then
  systemctl disable --now axf-hand-build.timer 2>/dev/null || true
  rm -f "$UNIT_DIR/axf-hand-build.service" "$UNIT_DIR/axf-hand-build.timer"
  systemctl daemon-reload
  echo "removed: axf-hand-build.timer (hand builds already running keep running)"
  exit 0
fi

cat > "$UNIT_DIR/axf-hand-build.service" <<UNIT
# Written by deploy/install-hand-build.sh (hand-build@1). Launches recorded hand builds, refreshes their live state.
[Unit]
Description=AXF hand builds: launch the recorded ones, refresh live state
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/axf
Environment=HOME=/root
ExecStart=/bin/sh -c 'f=/opt/axf/framework/cli/hand-build.mjs; [ -f "\$f" ] && exec $NODE "\$f" tick || exit 0'
TimeoutStartSec=300
UNIT
cat > "$UNIT_DIR/axf-hand-build.timer" <<UNIT
# Written by deploy/install-hand-build.sh (hand-build@1).
[Unit]
Description=AXF hand builds, every 10 s

[Timer]
OnBootSec=30s
OnUnitActiveSec=10s
AccuracySec=2s

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now axf-hand-build.timer >/dev/null
echo "installed: axf-hand-build.timer (every 10 s): $NODE /opt/axf/framework/cli/hand-build.mjs tick"
