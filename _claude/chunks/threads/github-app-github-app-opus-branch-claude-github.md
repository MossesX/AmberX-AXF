<!-- memory-chunk@1 source=_claude/THREADS.md lines=450-455 tokens=301 -->
### GitHub App (`github-app`, Opus) — branch `claude/github-app`, on main
- **Asked:** one GitHub App for the stack (no more dying tokens; repo creation), one-click setup, broker, every caller on it, health + banner, then finish the axp-backup push.
- **Done:** broker + plugin + helpers + checks; VPS helpers installed (`/usr/local/bin/axf-git-cred`, `/usr/local/bin/gh`); `/root/axp-backup/bin/finish.sh` creates the 3 private repos with the app's user token on its next 15-min run after Brett authorizes, then pushes (secret scan in backup.sh unchanged).
- **Waits on Brett:** console → Settings → Plugins → GitHub: Create GitHub App → Install (All repositories) → Authorize as Brett.
- **Left (follow-up thread):** axHub's github connector still uses its own token (MossesX/axHub: add app auth via the same JWT exchange, test with pnpm test on node:22, redeploy via Coolify). The axp-backup branch's repo copy of finish.sh (`deploy/axp-backup/`) doesn't have the repo-create step; the live copy does.
- **Checks:** `node framework/spec/check-github-app.mjs`, `python3 apps/console-web/plugins/github-app/test.py`, `node framework/cli/github-token.mjs status --live`. <!-- axf-plugin:github-app -->
