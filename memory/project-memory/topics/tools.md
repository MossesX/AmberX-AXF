---
name: tools
description: Brett's server setup — Hostinger VPS runs Coolify with its Traefik proxy in front of all web apps
sources: [chat]
aliases: [VPS setup, Coolify, Hostinger VPS]
---
- [stated] His Hostinger VPS runs Coolify; Coolify's Traefik proxy (coolify-proxy container) holds ports 80/443, so new web apps there must go behind it rather than a separate nginx
