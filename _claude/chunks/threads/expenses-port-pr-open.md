<!-- memory-chunk@1 source=_claude/THREADS.md tokens=146 -->
### expenses-port (PR open)
- Asked: port MossesX/Expense into AmberX-AXF as its own app (`apps/expenses`), on the framework, deployed from AXF on the same data, API/MCP/CLI. Model Opus. Branch `claude/expenses-port`.
- Done: all six steps; live on `expenses-axf` since Nov 4 11:2x UTC. Waits on: CI green → auto-merge. After merge the cron (`/etc/cron.d/amberx-expenses`) deploys from main by itself.
- If anything is wrong: `sudo bash /opt/expenses-axf/apps/expenses/deploy/install.sh --rollback` (before merge: the worktree copy). Read `_claude/builds/reports/expenses-port.md`.
