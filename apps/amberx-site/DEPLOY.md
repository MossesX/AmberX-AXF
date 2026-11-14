# Deploying the AmberX site

## Today (Nov 14 2026)

`apps/amberx-site/deploy.sh` builds the image and runs container `amberx-site` on the VPS's `coolify` network behind the
Coolify proxy (Traefik), the same way `axf.amberxai.com` runs: HTTP redirects to HTTPS, Let's Encrypt issues the
certificate (`letsencrypt` resolver, HTTP challenge), data lives in the `amberx-site-data` volume, and the admin token
is in `/opt/amberx-site/.env` (root only, generated on the first run). Re-run the script to ship a new version; the
waitlist survives.

Host: **join.amberxai.com**. The apex `amberxai.com` is not used because the existing `amberx-app` web container
already claims `amberxai.com` / `www.amberxai.com` in the proxy, and the apex DNS still points at Hostinger
(2.57.91.91), not the VPS.

## Steps that need Brett

1. **DNS** (Hostinger hPanel → Domains → amberxai.com → DNS): A record `join` → `31.97.13.252`, TTL 300.
   The certificate follows within a minute. The systems check item "AmberX launch site is public" goes green by itself.
2. **Console** env: `AMBERX_SITE_URL=https://join.amberxai.com`, `AMBERX_SITE_ADMIN_TOKEN=` the value in
   `/opt/amberx-site/.env`. Restart the console; the Launch waitlist page, MCP tools and CLI then work.
3. **Optional, the apex**: to put the landing page on `amberxai.com` itself, decide what happens to the `amberx-app` web
   container's apex route, then `apps/amberx-site/deploy.sh amberxai.com www.amberxai.com join.amberxai.com`
   (first host = referral link base) and point the apex A record at `31.97.13.252` (delete the AAAA record
   `2a02:4780:84::32`, which points at Hostinger, not the VPS).

## As a Coolify application instead

New resource → Public/Private repository `MossesX/AmberX-AXF`, branch `main`, build pack **Dockerfile**, base
directory `/`, Dockerfile `apps/amberx-site/Dockerfile`, port `8080`, domain `https://join.amberxai.com`,
persistent storage `/data`, env `SITE_ADMIN_TOKEN` (secret) and `PUBLIC_URL`. Stop the `amberx-site` container first so
the two don't share the host rule.
