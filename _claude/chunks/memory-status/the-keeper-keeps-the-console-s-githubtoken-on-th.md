<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=206-208 tokens=107 -->
## GitHub App for the whole stack (Nov 1 2026, github-app, Opus)

- The keeper keeps the console's `GITHUB_TOKEN` on the installation token (old PAT in `GITHUB_TOKEN_PAT`, used again if the
  app can't mint), so every plugin and subprocess uses the app; systems check GitHub route default `auto`; "GitHub token"
  item tests the old token. VPS: `axf-git-cred` (app first, PAT fallback) and a `gh` wrapper (`framework/deploy/`).
