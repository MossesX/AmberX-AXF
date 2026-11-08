<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=125 -->
## Status (as of Oct 21 2026)

- **Agent ID cards — agent-card@1 (Oct 31 2026, Opus, web only):** asset type with one rules file `framework/core/engines/agent-card-rules.mjs` (both validators, schema, card model), four branded starters (`corporate-badge` default, `license`, `trading-card`, `backstage-pass`), React `AgentCard` + `.fx-idcard` (theme tokens only), fixture `agent-card.json` + `check-agent-card.mts`. Kotlin twin deferred (PORTING.md); QR strip shows the page link (no encoder yet).
