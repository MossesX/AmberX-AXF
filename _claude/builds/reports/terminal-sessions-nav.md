# terminal-sessions-nav (Current profile, Opus, Nov 3 2026)

Agent: Earl the Ear (the all-rounder router is not on main). Brett, Nov 3 2026 (voice): give the Terminal a collapsible
navigation menu on the left listing live sessions, including each session he is doing with Claude, so he can mirror it
and jump in. Built into the existing Terminal plugin (no second terminal), on top of `terminal-vps-host` (PR #274,
merged into this branch because it is not on main yet).

## What was built

| Step | What |
|---|---|
| s1 Left nav rail | `web/nav.tsx` `SessionsRail` inside every terminal window (`TerminalHost.tsx`): collapsible (icons + status dots when collapsed, full list when open), a drawer on phones (☰ in the tab strip, swipe from the left edge to open, swipe back to close), framework controls and theme tokens only (`axp-wtnav`). Open / collapsed, closed groups, sort and filter are remembered per browser. Sections **My sessions**, **Agents** (agent, model, live cost, status dot from the headless meters), **Connections**, **Recent**. Tap = open or focus the tab; right-click / long-press = Open, Open in a new window, Jump in, Open in Moshi (copies the attach command), Session info, Stop… (confirm). Setting `sessionsNav` (Settings → Plugins → Terminal → Headless tabs). Menu Plugins → Terminal → Terminal sessions. |
| s2 My sessions | (a) Every tmux session on the VPS and in the console that isn't a headless run (Brett's own Claude Code / shells, e.g. over Moshi, plus the persistent `axt-…` tabs). Tap opens a **read-only mirror** (`tmux attach -r`; the server drops typed input as well); the mirror bar's **Jump in** re-attaches writable on the same session with the scrollback replayed. (b) claude.ai chat / voice sessions as **feeds**: the lines a session posts with the new MCP tool `console_session_note` (session, text, source, agent, url, title, model) plus every console MCP tool it calls (tool, a secret-free argument summary, ok / error, ms), grouped by the session name. Jump in opens the chat's claude.ai link and keeps the feed in the Terminal. Rule added (shared RULES.md → Sessions) and in the console MCP instructions: chat / voice sessions post a short line to `console_session_note` when they act. Zero tokens on the console side. |
| s3 Live list | Websocket `nav/ws` (one per page, pushed on change, at once when a feed gets a line; falls back to polling `GET nav`). Each row: started time (tooltip) and a running timer; search (all words, across title / agent / model / last line), filter (all / live / working / waiting), sort (started / activity / name), collapsible groups. Ended sessions move to **Recent** (only judged on a good `tmux ls`, so an ssh hiccup doesn't empty the list); Recent links to the Session browser (Session check-in → Sessions). |
| s4 Commands, tests, docs | plugin-commands@1 items, so REST `/api/control/console-terminal/<id>`, MCP `console_terminal_<id>` and CLI `axf console-terminal <id>`: `sessions-list`, `sessions-feed`, `sessions-note`, `sessions-stop` (destructive, confirm), `sessions-mirror` / `sessions-jump` (console actions `terminal.mirror` / `terminal.jump`, args `[name, where]`). Tests below; README, PORTING (Android twin deferred), help pack. |

## Server

- `server/nav.py` (new): the `terminal-nav@1` model (one `tmux ls` on the VPS, cached 8 s and shared with the headless
  watch; one in the console; one meters read), feeds (`feeds.json` in the data folder, 0600, last 60 sessions × 200
  lines), `summarise_args` (secret-looking keys dropped, values cut), capability `axf.session-feed@1`
  (`note`, `record_call`, `feeds`).
- `server/sessions.py`: `ATTACH_RE` (any plain tmux name may be attached, not only `axf-` / `axt-`), `attach_script`
  (read-only `-r`), console-side attach, `Session.read_only` (input dropped), `parse_ls(mine=True)` (kind `mine`),
  `vps_tmux()["mine"]`, `console_tmux(mine)`, attach / kill accept any plain tmux name.
- `server/__init__.py`: `GET nav`, `GET nav/feed`, `POST nav/note`, `POST nav/stop`, `WS nav/ws`; `GET tmux` gains `mine`.
- `apps/console-web/server/mcp_server.py`: `console_session_note` (write, no destructive hint, so axHub can allow it);
  `_watch_calls` wraps the tool manager so every tool call is reported (`on_call`; a failing listener never fails a
  call); `CALLER` context variable. `main.py` sets it from `X-Axhub-Session` / `X-Axf-Session` (else "axHub" for the
  hub's user agent, else "MCP client") and wires `notes` + `on_call` to `axf.session-feed@1`.

## Contract change worth knowing

A tab may now attach to **any** plain tmux session name (letters, digits, `. _ -`, ≤ 64), not only `axf-…` / `axt-…`;
that is what lets Brett mirror his own sessions. Names are still checked by a strict pattern and always quoted. Stop
(kill) has the same rule and asks for a confirm in the rail; the MCP / REST command is marked destructive (confirm).

## Known gaps

- **Other axHub services are not in a chat's feed.** axHub does not pass the caller's session or correlation id to
  downstream MCP servers (`packages/connectors/mcp-proxy` sends only the tool and arguments), and its audit log is
  readable only from Brett's signed-in browser and holds no arguments. So a chat's feed has its own
  `console_session_note` lines and the console MCP tools it calls; calls to other hub services need an axHub change
  (forward `X-Axhub-Session` downstream, or a token-readable activity stream). Not built here (separate repo).
- **axHub policy:** `console_session_note` must be allowed in axHub's per-tool policy for the console service (an axHub
  admin setting, like the other `console_*` tools); until then a chat's first note may be held as a veto call.
- **Sync holds:** `_claude/shared/rules/RULES.md` (and THREADS.md, STATUS.md) are held by claude-sync (changed in two
  places). The rule is added to the repo copy through this PR; which copy wins on the hub is Brett's call
  (`claude-sync resolve shared:rules/RULES.md --keep local|hub`).
- Kotlin / Android twin deferred (Android on hold), recorded in PORTING.md.

## Tests

| Check | Before | After |
|---|---|---|
| `python3 apps/console-web/plugins/console-terminal/test.py` | 106 checks | 132 checks (26 new: own sessions listed apart, read-only attach + input dropped, attach name guard, GET tmux `mine`, notes + link guard + name guard, MCP calls into the caller's feed with no secrets, Recent on end but not on ssh failure, stop, websocket push, feeds survive a restart) |
| `python3 apps/console-web/server/test_mcp_tools.py` | 139 checks | 145 checks (`console_session_note` only with a notes runner, plain write, reaches the feed; every call reported with caller; failures recorded; a broken listener never fails a call) |
| `npx -y tsx framework/spec/check-terminal-nav.mts` (new, in CI) | — | 13 checks |
| `npx -y tsx framework/spec/check-headless-tabs.mts` | 30 | 30 |
| `node framework/cli/check-theme.mjs` / `check-controls.mjs` | pass | pass |
| `node framework/cli/help-coverage.mjs --check` / `check-help.mts` | 100 % | 100 % (4 new entries written) |
| `node framework/cli/plugin-commands.mjs check` (console-terminal) | — | 15 reads · 15 commands (6 declared here: sessions-list / feed / note / stop / mirror / jump) |
| console `tsc --noEmit` | pass | pass |
| `plugin-lifecycle.mjs check console-terminal` | — | only two stray references outside the repo's tracked files (`.axf-focus.json`, git-ignored Watch-live file; an untracked `framework/plan/profiles/current/framework/plan/pending.json`) |

## Screenshots

SCREENSHOTS
