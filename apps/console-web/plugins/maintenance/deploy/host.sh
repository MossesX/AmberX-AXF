#!/usr/bin/env bash
# Maintenance — host part (plugin-lifecycle@1). Run by deploy/install-console.sh on the VPS as root:
#   host.sh up     installs /etc/cron.d/axf-maintenance (the engine measures every 10 minutes, at low priority) and
#                  prints no docker args (the console reads the snapshot from the checkout it already mounts at /axf)
#   host.sh down   removes the cron file
# The cron line removes its own file when the plugin folder is gone, so uninstalling the plugin leaves nothing behind.
# Clean-up runs are never started from here: only axHub's vps.run starts them, after Brett approves the held call.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="$HERE/../engine/maint.py"
ENGINE="$(cd "$(dirname "$ENGINE")" && pwd)/maint.py"
CRON=/etc/cron.d/axf-maintenance
case "${1:-}" in
  up)
    if ! command -v python3 >/dev/null 2>&1; then echo "[axf] maintenance: python3 not on the host, host part skipped" >&2; exit 0; fi
    tmp="$(mktemp)"
    cat >"$tmp" <<CRONEOF
# AXF Maintenance plugin (apps/console-web/plugins/maintenance). Removes itself when the plugin is gone.
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/10 * * * * root if [ -f "$ENGINE" ]; then nice -n 19 ionice -c3 python3 "$ENGINE" snapshot >/dev/null 2>&1; else rm -f $CRON; fi
CRONEOF
    install -m 0644 "$tmp" "$CRON"
    rm -f "$tmp"
    # first snapshot now, in the background, so the console has data straight after the install
    (nice -n 19 python3 "$ENGINE" snapshot >/dev/null 2>&1 &) || true
    ;;
  down) rm -f "$CRON" ;;
  *) echo "usage: host.sh up|down" >&2; exit 2 ;;
esac
