<!-- memory-chunk@1 source=_claude/THREADS.md lines=78-78 tokens=274 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Home cards draw live data (Urgent `home-cards-live`, Opus, agent Ping Paulie; Brett Nov 3 voice: "I shouldn't need to build cards. I should draw dynamic data."; replaces Angel `home-cards`, archived): card@1 = a data binding to any plugin read (control@1) or console read, open view registry (number, list, meter, chart, feed, table, status, panel), Add card with live preview + smart view, drag reads/hooks onto Home, card menu, reorder, sizes, Show/Hide all, layout per user on axHub (`/api/home/layout`), Suggested cards from existing reads, zero tokens | built (s6 screenshots + PR in progress) | `claude/home-cards-live` | — | Report `_claude/builds/reports/home-cards-live.md`. To carry on: `node framework/spec/check-card.mjs`; console `npx tsc --noEmit -p apps/console-web`; push, open PR, submit UI Review (group `home-cards-live - Nov 3 …`). Gaps: approvals-banner has no read of waiting approvals (suggestion stays off); hook@1/drop-target@1 not on main (Home reads the same payloads itself) | 2026-11-03 |
