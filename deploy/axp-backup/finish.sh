#!/usr/bin/env bash
# AXP backup, last step: once the three private repos exist on GitHub, push the backups and switch the
# nightly timer on. Runs every 15 minutes from axp-backup-finish.timer until it succeeds (and can be run by hand).
set -uo pipefail
ROOT=/root/axp-backup
for n in axp-xchat axp-devstudio axp-demo; do
  vis=$(gh repo view "MossesX/$n" --json visibility -q .visibility 2>/dev/null) || { echo "MossesX/$n does not exist yet"; exit 0; }
  [ "$vis" = "PRIVATE" ] || { echo "MossesX/$n is $vis, not PRIVATE: refusing to push"; exit 1; }
done
"$ROOT/bin/backup.sh" || exit 1
systemctl enable --now axp-backup.timer
systemctl disable --now axp-backup-finish.timer
docker exec -i axf-console sh -c 'curl -s -o /dev/null -X POST http://127.0.0.1:7090/api/alerts/resolve -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @-' <<<'{"keys":["system:axp-backup-repos"]}' || true
echo "AXP backup pushed; nightly timer on"
