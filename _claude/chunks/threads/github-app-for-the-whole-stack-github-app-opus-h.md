<!-- memory-chunk@1 source=_claude/THREADS.md tokens=203 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| GitHub App for the whole stack (`github-app`, Opus, headless): one-click GitHub App (manifest flow: Create → Install on All repositories → Authorize as Brett), token broker `framework/cli/github-token.mjs` (installation tokens minted from the app key, renewed at 50 min; user token refreshed, rolled), console keeper puts `GITHUB_TOKEN` on the app (old PAT = fallback), git credential helper + gh wrapper on the VPS, health items, `axf repo create`; axp-backup finish timer creates its 3 repos once authorized | done (waiting on Brett's 3 taps) | `claude/github-app` → main | — | Brett: Settings → Plugins → GitHub, 3 taps. Follow-up: axHub's github connector on the app. Report `_claude/builds/reports/github-app.md` | 2026-11-01 |
