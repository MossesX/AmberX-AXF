#!/usr/bin/env bash
# lander-service.sh — the lander as a server service (Brett, Nov 12 2026: "the lander runs NON-STOP all night as a
# server service, restart=always, survives crashes and reboots, never stopped by kill-alls or slot caps").
#   bash lander-service.sh ensure      write /etc/systemd/system/axf-lander.service when it differs, enable and start it
#   bash lander-service.sh status      systemd's view of it
#   bash lander-service.sh remove      stop, disable and delete the unit (the plugin's uninstall)
# Root on the VPS host. It runs in its own unit (not axf-builds.slice), so build slot caps and the build-limit adopter
# never touch it; Restart=always brings it back after any kill, StartLimitIntervalSec=0 means it never gives up, and
# WantedBy=multi-user.target starts it on boot. Every start is logged by lander.mjs in the Server gate log + an AmberX FYI.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${AXF_LAND_REPO:-$(cd "$HERE/../../../../.." && pwd)}"
UNIT=/etc/systemd/system/axf-lander.service
NODE="$(command -v node || echo /usr/bin/node)"

unit() {
  cat <<UNIT
# Written by apps/console-web/plugins/push-banner/land/lander-service.sh (axf-plugin:push-banner).
[Unit]
Description=AXF lander: merges ready PRs into main one at a time through the main gate
After=network-online.target docker.service
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory=$REPO
Environment=AXF_LAND_REPO=$REPO
ExecStart=$NODE $REPO/apps/console-web/plugins/push-banner/land/lander.mjs serve
Restart=always
RestartSec=10
OOMScoreAdjust=-500
StandardOutput=append:/var/log/axf-lander.log
StandardError=append:/var/log/axf-lander.log

[Install]
WantedBy=multi-user.target
UNIT
}

case "${1:-status}" in
  ensure)
    command -v systemctl >/dev/null || { echo "lander-service: no systemd here" >&2; exit 0; }
    want="$(unit)"
    if [[ ! -f "$UNIT" ]] || [[ "$(cat "$UNIT")" != "$want" ]]; then
      printf '%s\n' "$want" > "$UNIT.tmp" && mv -f "$UNIT.tmp" "$UNIT"
      systemctl daemon-reload
      systemctl enable axf-lander.service >/dev/null 2>&1 || true
      systemctl restart axf-lander.service
      echo "lander-service: unit written, started"
    elif ! systemctl is-active --quiet axf-lander.service; then
      systemctl enable axf-lander.service >/dev/null 2>&1 || true
      systemctl start axf-lander.service
      echo "lander-service: started"
    fi ;;
  status) systemctl status axf-lander.service --no-pager 2>&1 | head -12 ;;
  remove)
    systemctl disable --now axf-lander.service >/dev/null 2>&1 || true
    rm -f "$UNIT"; systemctl daemon-reload 2>/dev/null || true
    echo "lander-service: removed" ;;
  *) echo "usage: lander-service.sh ensure | status | remove" >&2; exit 2 ;;
esac
