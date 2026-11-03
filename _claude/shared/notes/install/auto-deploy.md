# Auto-deploy from GitHub (state as of 2026-10-16)

| Repo | Deploys to | Mechanism | Status |
|---|---|---|---|
| xGallery | xgallery.amberxai.com (/opt/xgallery) | GitHub Actions deploy.yml: scp + ssh with VPS_PASSWORD secret | working |
| AmberX-AXF | xaf.amberxai.com (/var/www/xaf.amberxai.com) | Actions builds to `site` branch; /etc/cron.d/xaf-amberxai pulls every 2 min | working |
| studioX | studio.amberxai.com (/opt/amberx/studio) | Actions deploy.yml -> ssh root@31.97.13.252 `deploy studiox` via restricted key (`~/.ssh/github-deploy`, secret VPS_SSH_KEY) | working since 2026-10-16 (run 38880747948) |
| Expense | expenses.amberxai.com (/opt/amberx/expense) | Actions deploy.yml -> ssh `deploy expense` (same restricted key) -> `~/hub/deploy/expense.sh` (compose -p expenses, build from repo Dockerfile) | working since 2026-10-16 |
| pilotX, xAI, ActiveX, UltraX-26, tooltree | Android/Gradle CI; UltraX-26 web -> GitHub Pages | their own workflows | working |

## studioX pieces already on the VPS
- `~/hub/bin/gh-deploy-gate` — forced command: allows only `ping` and `deploy <name>` (runs `~/hub/deploy/<name>.sh` under flock, log in `~/hub/data/deploy/<name>.log`).
- `~/hub/deploy/studiox.sh` — ff-only pull of /opt/amberx/studio, studio compose rebuild, health gate.
- `~/.ssh/github-deploy` (+ .pub) — key pair; public half in authorized_keys with the forced command.

## Notes
- First run's SSH step hit a transient `connect ... port 22: Connection timed out` from the GitHub runner; a rerun (`gh run rerun <id> --failed`) connected fine. If it recurs, rerun before suspecting the firewall (Hostinger firewall group is not attached to this VM).
- Server-side log: `~/hub/data/deploy/studiox.log`; run by hand: `~/hub/deploy/studiox.sh`.
- expenses.amberxai.com deploys ONLY from MossesX/Expense since 2026-10-16 (studioX commit 8583a95 removed the peel-based deploy `packages/studio/deploy/expenses`; the embedded tracker in the studio is obsolete). The peel tooling itself (`npm run peel` in packages/studio) is still in the repo.
