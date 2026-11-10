# Fix log + FYI phone notifications from Claude sessions

Build `fix-log-fyi-phone-notifications-from-claude-sess` · Phase 1 · Opus · Nov 9–10 2026

Brett said (Nov 9 2026 23:44): "If something needs to be fixed, you can send me a notification on my phone through
AmberX... log it, and then if you try something, notify me that you're trying this, say what it is. If that fails, say
that failed... just notify me of doing it, not for permission or veto."

## What shipped

- **Plugin `fix-log`** (`apps/console-web/plugins/fix-log/`). One line per step of a fix: `found` · `trying` ·
  `failed` · `fixed`. Each line is appended to `entries.jsonl` in the plugin's data folder and raised as an
  informational alert (source `fix-log`): console bell plus AmberX through notify type `fix-log.fyi` (`push: true`).
  The alert body starts "FYI, nothing to approve". No approval, no veto, no countdown.
- **Threads**: the first line returns an issue id; later lines without one join the session's open fix. A new line
  resolves the fix's earlier alerts, so the bell keeps only the newest. `fixed` closes the fix.
- **Settings**: notify on/off per outcome (always logged), per-session flood limit (default 20 per 10 min: past it
  lines are logged but not sent), lines kept (default 5000).
- **Page**: Plugins → Fix log and Console → Fix log (view `fix-log`). Today's counts, filters (outcome incl. "Not
  fixed yet", session, build, text search), one-fix view, 15 s refresh. Settings → Plugins → Fix log.
- **Standing rule**: new seed brief `fix-log` in `framework/schemas/rules-briefs.json` (every launch): sessions log
  found / trying / failed / fixed as they go and never wait for an answer.
- **axHub**: tool `fix_log_log` on service `axf-console` set to policy `allow` and pinned (live, done from this session
  with `axhub services tool-policy` / `pin`).

## How each part is reached (full API control)

| What | Deep link | REST | MCP | CLI | Voice (AmberX) |
|---|---|---|---|---|---|
| Log a line | — | `POST /api/plugins/fix-log/log` | `fix_log_log` (allow, pinned) | `fixlog.mjs found\|trying\|failed\|fixed "…"`, `axf fix-log log` | Claude through axHub calls `fix_log_log` |
| Read lines / one fix | `view:fix-log` (console_show) | `GET entries`, `GET entries/{id}` | `fix_log_entries`, `fix_log_entry` | `fixlog.mjs list`, `axf fix-log entries` | same MCP |
| Fixes, summary | `view:fix-log` | `GET issues`, `GET summary` | `fix_log_issues`, `fix_log_summary` | `fixlog.mjs issues`, `axf fix-log summary` | same MCP |
| Settings | Settings → Plugins → Fix log | `GET/PUT settings` | `fix_log_settings`, `fix_log_set_settings` | `axf fix-log set-settings` | same MCP |

`fixlog.mjs` reaches the console with `AXF_CONSOLE_URL` + `AXF_TOKEN`, else `docker exec axf-console` on the VPS.
Until this plugin is deployed, a log line falls back to a plain console alert so the FYI still reaches Brett.

## Checks

- `python3 apps/console-web/plugins/fix-log/test.py`: 35 checks pass (rules, threading, routes, filters, settings,
  flood limit, hub failure, CLI fallback).
- `notify-control/test.py` 132 pass · `plugin-lifecycle check fix-log` clean · `plugin-commands check fix-log` 7 reads,
  2 commands · `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` pass · console `tsc` clean ·
  `menu-reach` reports nothing for fix-log.
- `help-coverage --check` still fails on main's own gaps (claude-accounts `kind: panel`, 27 controls elsewhere); every
  fix-log control has help.

## Gaps

- **Screenshots / UI Review**: not submitted. `rebuild-shots.mjs` ran (with `AXF_APPEARANCE_HUB=off`; without it the
  local console waits for axHub), but the menu steps never reached the new page within the time box. Shots are needed
  from the deployed console: Plugins → Fix log (desktop + phone) and Settings → Plugins → Fix log.
- Not sent: a live test notification (it would buzz Brett for nothing). The send path is covered by the tests and by the
  alert hub's existing push.
- No Android/Kotlin work (none needed: AmberX shows these through its existing alerts reader).
