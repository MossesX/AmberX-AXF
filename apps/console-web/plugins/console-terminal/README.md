# Terminal (console plugin)

`ai.amberx.axf.console.terminal` · built on Opus (Oct 18 2026).

Floating terminal windows (drag, resize, minimize, dock/undock like any console window) with tabs:
- **Container**: a root shell in a container, through Container access (`axf.containers@1` → exec TTY), so the
  protected list and audit log apply; protected containers (Coolify, Traefik, databases) open only after a confirm.
- **Console**: the console's own container (always there, even without Container access).
- **VPS**: root on the host over SSH with a key made just for this (Settings → VPS host), red **HOST ROOT** badge.
- **Claude Code**: an interactive CLI session (Edit/Write/Bash on: you're driving), optional saved token.
- **+** adds any of these; tabs can be renamed, reordered and dragged out into their own window.

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
