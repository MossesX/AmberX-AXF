<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=134 -->
## GitHub App for the whole stack (Nov 1 2026, github-app, Opus)

- Console plugin `github-app` (Settings → Plugins → GitHub): GitHub App manifest flow on MossesX (Create → Install on All
  repositories → Authorize as Brett). Broker `framework/cli/github-token.mjs` (lib `github-app.mjs`): app JWT (RS256),
  installation tokens cached and renewed at 50 min, user token refreshed under a lock (refresh token rolled), repo creation,
  health. Credentials in `<console>/.axf-console/github-app/` (0700/0600), never in git or a browser.
