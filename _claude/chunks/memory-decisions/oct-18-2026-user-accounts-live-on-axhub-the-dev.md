<!-- memory-chunk@1 source=_claude/memory/decisions.md tokens=108 -->
## Dev Console

- Oct 18 2026: **User accounts live on axHub; the Dev Console sits behind the hub's sign-in wall** (built on Opus). Admin + more users with roles; Traefik forwardAuth at the proxy; the console token keeps working for machines on `/api/` and `/mcp`. Brett set the first admin (username `admin`) himself; the password is never stored in a repo (it goes in Coolify as `AXHUB_ADMIN_PASSWORD` for the first start only).
