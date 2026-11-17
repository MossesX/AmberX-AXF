#!/usr/bin/env bash
# Maintenance — host part (plugin-lifecycle@1). Run by deploy/install-console.sh on the VPS as root:
#   host.sh up       installs and (re)starts the host runner axf-maintenance.service (engine/hostd.py serve): it measures
#                    every 10 minutes and runs the plugin's actions (clear the Docker cache, restart Docker) on the host,
#                    outside every container, so it keeps working when the console or Docker is down. The console talks
#                    to it over the Unix socket <data>/host/hostd.sock in the checkout it already mounts at /axf.
#                    Without systemd it falls back to the old cron line (measuring only).
#   host.sh down     stops and removes the service (and the cron line)
#   host.sh status   the service state and the runner's answer
# The service removes its own unit when the plugin folder is gone, so uninstalling the plugin leaves nothing behind.
# Clean-up runs are never started from here: only axHub's vps.run starts them, after Brett approves the held call.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$(cd "$HERE/../engine" && pwd)"
HOSTD="$ENGINE_DIR/hostd.py"
ENGINE="$ENGINE_DIR/maint.py"
CRON=/etc/cron.d/axf-maintenance
UNIT=axf-maintenance.service
UNIT_FILE=/etc/systemd/system/$UNIT

has_systemd() { command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; }

case "${1:-}" in
  up)
    if ! command -v python3 >/dev/null 2>&1; then echo "[axf] maintenance: python3 not on the host, host part skipped" >&2; exit 0; fi
    PY="$(command -v python3)"
    if has_systemd; then
      tmp="$(mktemp)"
      cat >"$tmp" <<UNITEOF
# Written by apps/console-web/plugins/maintenance/deploy/host.sh. The Maintenance plugin's host runner.
# It must not depend on docker.service: it is what restarts Docker when Docker is stuck.
[Unit]
Description=AXF Maintenance host runner (server health, clear the Docker cache, restart Docker)
After=network.target

[Service]
Type=simple
ExecStart=$PY $HOSTD serve
Restart=always
RestartSec=5
Nice=5
IOSchedulingClass=idle
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
UNITEOF
      if ! cmp -s "$tmp" "$UNIT_FILE" 2>/dev/null; then install -m 0644 "$tmp" "$UNIT_FILE"; systemctl daemon-reload; fi
      rm -f "$tmp"
      systemctl enable "$UNIT" >/dev/null 2>&1 || true
      systemctl restart "$UNIT"   # picks up a changed engine after a deploy
      rm -f "$CRON"               # the runner measures now; the old cron line would only double it
      echo "[axf] maintenance: host runner $UNIT running" >&2
    else
      tmp="$(mktemp)"
      cat >"$tmp" <<CRONEOF
# AXF Maintenance plugin (apps/console-web/plugins/maintenance). Removes itself when the plugin is gone.
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/10 * * * * root if [ -f "$ENGINE" ]; then nice -n 19 ionice -c3 python3 "$ENGINE" snapshot >/dev/null 2>&1; else rm -f $CRON; fi
CRONEOF
      install -m 0644 "$tmp" "$CRON"
      rm -f "$tmp"
      (nice -n 19 python3 "$ENGINE" snapshot >/dev/null 2>&1 &) || true
      echo "[axf] maintenance: no systemd, so only the measuring cron is installed (no host runner)" >&2
    fi
    ;;
  down)
    if has_systemd; then systemctl disable --now "$UNIT" >/dev/null 2>&1 || true; rm -f "$UNIT_FILE"; systemctl daemon-reload; fi
    rm -f "$CRON"
    ;;
  status)
    has_systemd && systemctl --no-pager status "$UNIT" | head -5 || true
    python3 "$HOSTD" call ping || true
    ;;
  *) echo "usage: host.sh up|down|status" >&2; exit 2 ;;
esac
