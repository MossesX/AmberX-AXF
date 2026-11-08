<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=143 -->
## Status (as of Oct 21 2026)

- **Hosting:** demo moving from `xaf.amberxai.com` to `axf.amberxai.com` (`deploy/install.sh` migrates the old setup). Dev Console **is live** at `console.amberxai.com` (`deploy/install-console.sh`; verified Oct 18 2026: `/api/health` ok, engine on, `/mcp` serving 26 tools behind Traefik HTTPS). `/api/mcp` now advertises `https://` (reads `X-Forwarded-Proto/Host`; it said `http://` before). Build-queue step `x.deploy.console` can be marked done once Brett confirms the 5-minute auto-update cron (`/etc/cron.d/axf-console`) on the VPS.
