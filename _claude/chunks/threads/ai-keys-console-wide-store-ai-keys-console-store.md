<!-- memory-chunk@1 source=_claude/THREADS.md tokens=165 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| AI keys console-wide store (`ai-keys-console-store`, Opus; Janitor Joey): AI keys was already one store and never held a key, Brett's 5 are in `~/.claude-accounts`. Added an admin + service-token guard, a per-user store migration (no such files today), `vpsAccounts` on GET /keys, POST /active and /switch for VPS accounts (held), fixed claude-accounts dropping `[token]` / `[api key]` rows. Tokens deliberately not copied: AI keys rotates refresh tokens. Importing them is Brett's call | in progress | claude/ai-keys-console-store-2 | | merge queue, redeploy, verify | 2026-11-05 |
