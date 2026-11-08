<!-- memory-chunk@1 source=_claude/memory/docs/session-checkin.md lines=89-94 tokens=147 -->
### 7. Effort level, with a cost estimate
- **Levels:** `low · medium · high · xhigh · max` (where the client can set effort; otherwise record "client default").
- **Each option shows the estimated cost of the baseline build** (below) for the chosen model at that effort level.
- **Why a fixed baseline:** the same reference build every time gives a consistent number to compare across sessions, models and price changes. It is **not** an estimate of today's task.
- **On a Claude plan** (`claude-pick` → plan), show the API-equivalent cost and label it so: a plan doesn't bill per token.
