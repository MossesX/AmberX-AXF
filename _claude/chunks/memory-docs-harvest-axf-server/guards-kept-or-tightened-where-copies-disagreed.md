<!-- memory-chunk@1 source=_claude/memory/docs/harvest/axf-server.md lines=46-71 tokens=660 -->
## Guards kept or tightened (where copies disagreed, the stricter rule won)

- **Atomic writes:** some copies wrote `tmp` then chmod (briefly 0644 under the console's umask 002), some used a fixed
  `x.tmp` name (two writers clobber each other), none fsynced. Now: unique tmp, `O_EXCL|O_NOFOLLOW`, final mode at
  creation + `fchmod`, fsync, `os.replace`, tmp removed on failure, value serialised before any file is touched.
- **Privacy:** agent-manager collections/runs, ai-assistant conversations/usage, agent memory and `state.json` were
  0644 (inside 0700 folders); all are 0600 now. The token file, credential file, VAPID key, ntfy/GitHub/web push
  secrets unchanged (0600). Shared hub files (app catalog: 0664, setgid folder) keep their group bits explicitly.
- **HTTP:** every request is https-only (plain http only to loopback or a named Docker host). Before, systems-check's
  key checks used plain `urlopen` — **followed redirects carrying GitHub/Anthropic/Hostinger/Coolify/axHub tokens** and
  accepted an `http://` Coolify URL. Now no redirects, and a non-https Coolify URL is refused with a clear message
  before the token is sent. `app_ci`'s redirect handler stripped only `Authorization`; it now also drops Cookie,
  Proxy-Authorization and X-Api-Key, re-checks each hop's target (no redirect to plain http) and caps redirects at 5.
  `main._gh`/`release_download` (plain urlopen, followed redirects with the token, no size cap) now never send the token
  off api.github.com and cap downloads at 500 MB. `target_ok` also refuses user:password URLs and bad ports.
- **Wall:** same scheme, same 120 s window, same names; added: secret < 32 never verifies (was only checked in
  `trusted()`), timestamp ≤ 12 digits, header values must be strings. Build Pilot's copy accepted 1-char-longer names
  (`{0,63}`) and only admins; the console's stricter `NAME_RE` (`{1,31}`) is the framework's.
- **Token file:** once a token was read it stays in force if the file loses its line (before: fell back to the
  container's stale `AXF_TOKEN` env, i.e. a reset token could revert). The console refuses a bare-token file
  (`allow_bare=False`); Build Pilot's one-line copy is supported (`allow_bare=True`, its default).
- **Credentials:** a value with a line break is refused (it could inject a second key).
- **Plugin packages:** Python patterns use `\Z` (Python's `$` accepts a trailing newline; JS's doesn't — Build Pilot's
  copy would have accepted `web/x.ts\n`); `NaN`/`Infinity` in plugin.json refused like `JSON.parse`.
- Pre-existing bug fixed on the way: systems-check `checks.py` raised `HTTPException` without importing it.
