<!-- memory-chunk@1 source=_claude/memory/docs/harvest/deploy-misc.md lines=65-78 tokens=277 -->
## Guards kept or tightened

- Strip middleware for all five `X-Auth-*` headers before forwardAuth (both copies had all five).
- Wall turns on only when the hub can sign someone in, then stays on (both copies).
- Choice files 0600. **Stricter where the copies differed:** the console wrote `wall`/`wall-users` with `echo` then
  `chmod 600` (briefly world-readable under a 022 umask); `axf_save_choice` writes them under umask 077. Same final mode.
- Wall secret: written under umask 077 (both), now also re-`chmod 600` when replaced from `AXF_WALL_SECRET` (same as before).
- Update script 0700 (was 0755 in both copies).
- Build Pilot's "never create a wall secret, reuse the console's" rule is a caller choice; the template follows it
  (reuses the console's file when present, else makes its own).
- Template server: same signature rules as the console's `server/wall.py` (HMAC-SHA256, 120 s, host-bound, name/perm
  patterns, admin ⇒ `*`), malformed session ⇒ 403 never anonymous, bearer-via-hub must be the real token,
  same-origin browser writes, default-deny for hub users, static-file path guard.
