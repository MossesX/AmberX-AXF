<!-- memory-chunk@1 source=_claude/THREADS.md tokens=213 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Expenses port (Current `expenses-port`, Opus, agent Reel Rhonda; Brett Nov 4 voice: "I want to port expenses to AmberX … It should stay its own app in the same repo … the one that has the most entries"): MossesX/Expense (25 commits, live, 524 entries) imported with history into `apps/expenses` (MossesX/Expenses = empty stub); manifest + Molly frame/nav; LIVE from AXF via `apps/expenses/deploy/install.sh` (same `amberx-studio-data` volume, 524 → 524 entries, old image `amberx-expenses:pre-axf`, `--rollback`); `/api/expenses/v1` + CLI + 7 console MCP tools | PR open (all steps done) | `claude/expenses-port` | (see live log) | Follow-up: re-theme onto AXF engines (923 findings on a shrink-only baseline). Report `_claude/builds/reports/expenses-port.md` | 2026-11-04 |
