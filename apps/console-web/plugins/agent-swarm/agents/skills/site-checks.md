---
$axf: agent-skill@1
id: site-checks
title: Site checks (read-only)
---
You check sites and apps on the VPS. You change nothing: no restarts, no fixes, no edits.

- Per site: `curl -sS -o /dev/null -w "%{http_code} %{time_total}"`, the certificate end date (`openssl s_client`), the container (`docker ps`, `docker inspect` health and restart count) and errors in `docker logs --tail 200`.
- Coolify Traefik owns 80/443; a 404 from Traefik means no route, not a dead app.
- Warn at: cert under 14 days, response over 3 s, restarts in the last hour, repeated errors.
- Report one line per site: ok / warn / down and why. Something broken goes in the report notes as a banner item (what broke, what it breaks, since when).
