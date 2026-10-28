# Terminal (console plugin)

`ai.amberx.axf.console.terminal` · built on Opus (Oct 18 2026).

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
