# Terminal (console plugin)

`ai.amberx.axf.console.terminal` · built on Opus (Oct 18 2026).

**Sessions nav (v0.5.0, Nov 3 2026, Opus; build `terminal-sessions-nav`).** A collapsible rail on the left of every
terminal window (`web/nav.tsx`, model `server/nav.py`, answer `terminal-nav@1`; setting `sessionsNav`).
- **Sections:** *My sessions* (Brett's own tmux sessions on the VPS and in the console, e.g. Claude Code over Moshi, the
  persistent `axt-…` tabs, and his claude.ai chat / voice sessions as feeds), *Agents* (headless `axf-…` builds with
  agent, model, live cost and status from the headless meters), *Connections* (where a tab can open) and *Recent* (ended,
  with a link to the Session browser). Each row shows its start time and a running timer. Search, filter (all / live /
  working / waiting), sort (started / activity / name), collapsible groups, all remembered per browser.
- **Collapsed** = icons with status dots; **phone** = a drawer behind ☰ in the tab strip (or swipe from the left edge,
  swipe back to close).
- **Tap** opens or focuses the tab. A session of Brett's opens as a **read-only mirror** (`tmux attach -r`, and the
  server drops typed input too); **Jump in** on the mirror bar re-attaches writable on the same tmux session. Headless
  builds open as before (writable). **Right-click / long-press:** Open, Open in a new window, Jump in, Open in Moshi
  (copies the attach command), Session info, Stop… (with a confirm; `POST nav/stop`).
- **claude.ai chats:** claude.ai has no live transcript API, so a chat is mirrored from what reaches the console: the
  lines it posts with the MCP tool `console_session_note` (session, text, source, agent, url) and every console MCP tool
  it calls (tool, a secret-free argument summary, ok / error, time), grouped by the session name (`X-Axhub-Session`
  header, else "axHub"). Its tab is a feed (`kind: 'feed'`); **Jump in** opens the chat's claude.ai link. Feeds live in
  `feeds.json` (last 60 sessions × 200 lines, 0600). Capability `axf.session-feed@1` (note / record_call / feeds) is how
  the console's MCP server posts into it. Zero tokens.
- **Live:** websocket `nav/ws` (one per page, pushed on change, at once on a new feed line); falls back to polling `GET nav`.
- **Commands** (plugin-commands@1, so REST + MCP + CLI): `sessions-list`, `sessions-feed`, `sessions-note`,
  `sessions-stop` (destructive, confirm), and the console actions `sessions-mirror` / `sessions-jump`
  (`terminal.mirror` / `terminal.jump` with args `[name, where]`).
- **Known gap:** axHub does not pass the caller's session or correlation id to downstream MCP servers, and its audit log
  is only readable from Brett's signed-in browser, so calls a chat makes to *other* axHub services are not in its feed;
  only its console calls and its own `console_session_note` lines are.

**Headless tabs (v0.4.0, Nov 3 2026, Opus; Urgent build `headless-tabs`).**
- **Persistent tabs:** VPS and console tabs (shells and Claude Code) run inside a tmux session named `axt-…` (the
  browser picks it once and keeps it with the tab; setting `persistTabs`). The ssh / pty link is only an attachment:
  after a reload, a sleeping phone, a reaped link or a console restart the tab opens a new link on the same name, which
  replays the pane's last 3000 lines (`tmux capture-pane`) and re-attaches. Closing a tab detaches (the tmux session
  lives on and shows in ∨ → Running sessions); right-click → **Kill session…** ends it after a confirm; **Open in
  Moshi** copies `mosh root@<vps> -- tmux attach -t <name>` (console tabs go through `docker exec`). Container tabs keep
  the server-side ring only. The console image installs tmux (`server/Dockerfile`).
- **Headless sessions:** `deploy/claude-headless.sh` tags each run's tmux session (`@axf_agent`, `@axf_model`,
  `@axf_meter`, `@axf_chain`, `@axf_cwd`, `@axf_kind`), appends `session-start` / `session-end` to
  `$AXF_HEADLESS_DIR/events.jsonl` (default `/var/tmp/axf-headless`), and its stream printer keeps
  `<session>.meter.json` (headless-meter@1) and `<session>.chain.json` (context-chain@1) there
  (`deploy/claude-meter.mjs`). Every running `axf-…` session no live window shows gets a tab, on every load too, unless
  that tab was closed by hand (`web/headless.ts`).
- **Tab title:** agent (the swarm agent's name via `AXF_AGENT`, else the build name), model, live cost (usage ×
  `framework/schemas/model-pricing.json`, replaced by Claude Code's `total_cost_usd` when a run ends; grey while it is an
  estimate) and a status dot: working / waiting (quiet a minute, no tool running) / done / failed (`web/meters.ts`,
  `GET headless/meters`, one ssh call for all tabs, cached 2 s).
- **Split pane** (`web/SplitView.tsx`): session + context chain side by side or stacked (tab menu, remembered per tab;
  default `splitDefault`); narrower than about 40 characters of text per pane it becomes a swipeable row.
- **Context chain** (`web/ChainPane.tsx`, `GET headless/<name>/chain`): the files the session takes in, in order, nested
  under the file that imported them, with their rules typed out one at a time (`chainSpeed`: slow / normal / fast /
  all), Pause, Skip to the end. Pure helpers in `web/headless-core.ts`; check `framework/spec/check-headless-tabs.mts`.

**Windows-style terminal (v0.3.0, Oct 28 2026, Opus).** One floating window per terminal host (tab kind
`terminal-host`, `web/TerminalHost.tsx`) drawn like Windows Terminal: its own tab strip (icon, title, status dot, close;
double-click renames, middle-click closes, drag reorders; right-click = Connection…, rename, duplicate, colour, move to
a new window, close / others / to the right), **+** and **∨** (Claude Code…, every Claude Code profile, Shell…, the
console, the VPS host, containers, Settings), a hideable command toolbar (Claude Code, the tab's connection, find, text
size, mouse + Mosh modes, copy / paste, settings), Mica, and Windows keys (Ctrl+Shift+T / W / D, Ctrl+Tab, Ctrl+Alt+1…9,
Ctrl+= / -). Closing the last tab closes the window. Sessions live in `web/hosts.ts` (per browser) and keep their server
session when moved between windows.

- **Connections** (`web/connections.tsx`, `GET connections`): Claude Code runs on the console container, the VPS host
  (ssh, HOST ROOT), any container (Container access exec, protected ones after a confirm) or **axHub** (Claude Code in
  the console with axHub's MCP server added). The picker opens new tabs; a tab's Connection manager shows where it is and
  switches it.
- **Claude Code profiles** (`web/profiles.ts`, Settings → Claude Code profiles): model, permission mode, extra flags
  (each checked on the server), folder, first prompt, icon, tab colour, default connection; the default one opens with
  New terminal (Settings → Tabs & behaviour → New terminal opens).
- **Settings** (`web/look.tsx`, live): colour scheme (Windows Terminal set in `web/schemes.json`, or the app theme), font,
  cursor, text size, line height, padding, Windows look, Mica, toolbar, blinking cursor, startup, + button, tab width,
  bell, scrollback, close confirm, copy on select, paste warning. Every setting carries its level for the settings level
  toolbar.

Classic tabs (pre-0.3 `terminal` tabs) open as a host with one session.

**Open terminal** is on every right-click / long-press (runtime context extras `*:terminal`). On a container or a
folder the console marks (`data-fx-ctx-target` `axf-container` / `axf-container-path`), it opens right there.

Per tab: mouse mode (click moves the cursor; clicks go to apps that use the mouse), **Mosh mode** (the session is kept
on the server, survives dropped signal and sleep, reconnects by itself, predictive echo while offline), search, text
size, a terminal menu (Copy, Paste, Paste as plain text, Select all, Clear, Search, Open link), Ctrl+Shift+C/V,
Ctrl+C copies when there's a selection, copy on select, a multi-line paste warning, and a phone key row (Ctrl, Esc,
Tab, arrows, |, ~). For real Mosh from the Moshi app, Settings → Mosh & Moshi shows the command.

Safety: WebSockets use a one-time ticket (`POST /api/ws-ticket`, 30 s, single use) so the console token never goes in
a URL; shells get the console's environment minus every token, key and stored credential; sessions close when idle
(60 min) and every open/close is logged (who, where, when, how long; never what was typed). A console token reset
closes every terminal.

xterm.js 5.3.0 + fit/search/web-links addons are vendored in `web/vendor/` (MIT) so uninstalling leaves nothing.

## Lifecycle (plugin-lifecycle@1)
Data: `.axf-console/plugins/console-terminal/` (`settings.json`, `ssh/` key + known_hosts, `claude-token`, `sessions.jsonl`).
```bash
node apps/console-web/plugins/console-terminal/install.mjs
node apps/console-web/plugins/console-terminal/uninstall.mjs --all
python3 apps/console-web/plugins/console-terminal/test.py
```
