<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/windows-terminal.md lines=10-47 tokens=769 -->
## Differences

**Removed**
- `web/TerminalTab.tsx` (one window-engine tab per shell, with its own bar). Its screen code lives on in `TerminalSession.tsx`.
- The per-tab bar (title, mouse/Mosh/search/size/+ buttons) — replaced by the host's tab strip + command toolbar.

**Kept**
- Every session feature: mouse mode, Mosh mode (server-kept, reconnect, predictive echo), search, copy/paste and the
  multi-line paste warning, the phone key row, the terminal right-click menu, idle timeout, the session log, one-time
  WebSocket tickets, clean shell environment, protected-container confirm, headless Claude Code tabs, approved-command
  output tabs, Open terminal on every right-click. Server API unchanged except the additions below.

**Changed**
- One window = one **terminal host** (`terminal-host` tab, `TerminalHost.tsx`) with its own Windows Terminal tab strip;
  sessions are kept in `hosts.ts` (per browser) instead of being window-engine tabs. Legacy `terminal` tabs open as a host
  with one session. `newTab()` returns a session id; `bringToFront()` takes a session id.
- Font: Cascadia Mono → Cascadia Code → Consolas → the theme's monospace font (was the theme's only).
- New terminal follows Settings → Startup (Claude Code on the default profile by default).
- Menus portal to `<body>` and sit above every window (a blurred window traps fixed children).

**Added**
- Tab strip: icon, title, status dot, badge, close; double-click rename, middle-click close, drag to reorder; right-click:
  Connection…, Rename, Duplicate, tab colour, Move to a new window, Close / Close others / Close to the right.
- **+** (like the current tab, or the picker) and **∨** (Claude Code…, every profile, Shell…, console, VPS, containers, Settings).
- Command toolbar (hideable): Claude Code, the tab's connection, find, A−/A+, mouse, Mosh, copy, paste, settings.
- Windows keys: Ctrl+Shift+T/W/D, Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+Alt+1…9, Ctrl+= / Ctrl+-.
- Close confirm for a running tab; closing the last tab closes the window.
- **Connections**: `GET connections`; Claude Code `via` console / vps / container / axhub (`--mcp-config` with axHub's
  MCP URL, `AXF_AXHUB_MCP_URL` overrides); connection picker dialog `terminal.connect`; per-tab Connection manager
  dialog `terminal.connection` (facts, Reconnect, Switch connection, New tab elsewhere). Docker down → the other
  connections still list, with a note.
- **Claude Code profiles** (`claudeProfiles`, `defaultClaudeProfile`): model, permission mode, flags, folder, first
  prompt, icon, colour, default connection; server-checked (`clean_profile`, `claude_args`).
- **Settings** (live, `look.tsx`): colour scheme (6 Windows Terminal schemes in `schemes.json` or the app theme), font,
  cursor style + blink, text size, line height, padding, Windows look, Mica, toolbar, startup, + button, tab width, bell
  (flash / sound / off), scrollback, close confirm, copy on select, paste warning. Each carries `data-axf-level`.
- `framework/cli/rebuild-shots.mjs` prints page errors (found a render loop here before it shipped).
