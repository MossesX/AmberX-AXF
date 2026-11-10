# urgent-terminal-pops-up-every-time-the-console-o — the Terminal stops popping up when the console opens

**Brett said (verbatim, Nov 9 2026 18:51):** "Every time I open the console, the terminal seems to pop up. You need to stop that."

Branch `claude/urgent-terminal-pops-up-every-time-the-console-o`. Model Opus, one phase, steps s1–s3.

## What caused it (from the live console's logs, Nov 9)

- 20:24:05: a fresh console page ran its first headless check (`GET console-terminal/headless`). By 20:24:09 seven running
  agent sessions (sully, rhonda, earl, joey, gina, lenny…) had been opened in a Terminal window and brought to the front.
- The headless watcher treats every running agent session that no open tab shows as *new*. After a reload no tab shows
  anything, so every running session looked new. With *When a new session starts* = **Bring Terminal to front**, each
  one opened the window and raised it, on **every** console open. With agents running all day, that meant every time.
- The same happened at 20:15:47 and 20:23:55, both straight after `console_open "Claude accounts"` woke or refocused the console.
- At 20:29 Gizmo set the setting to **Do nothing** as a stopgap (`console_terminal_new_session_set`). That stopped it,
  but agent sessions also stopped getting tabs at all.
- Ruled out: console-commands queue (empty; no queued or recent command opened the Terminal), Follow Amber (only
  screens / settings were shown), approved VPS commands (the newest run is 12 days old), window layout restore (the
  window manager doesn't persist windows).

## What changed (Terminal plugin only)

- `web/headless-core.ts`: `planNew(mode, fresh, hasWindow, baseline)`. The first check after the page loads, or after it
  comes back from the background, is a *baseline*: sessions found then were already running before Brett looked,
  so they are never raised in any mode. **Bring to front** treats them like **quiet**: a background tab if a Terminal
  window is open, otherwise only the count on the Terminal toolbar icon. Only a session that starts while Brett is
  watching comes to the front.
- `web/headless.ts`: tracks `watching` (reset on load and whenever the page goes hidden) and passes the baseline.
- `web/RunOutputTab.tsx`: approved VPS / shell commands never open a window on their own any more. The first answer is
  a baseline on the **server's** clock, so a phone clock that runs behind can't make old runs look new. A new run gets a
  background tab in an open Terminal window. With none open it waits on the Terminal toolbar count and gets a tab once
  Brett opens the Terminal (`flushRuns`, also on `terminal.toolbar`). New pure planner `planRun`.
- `web/index.tsx`: wiring and comments.
- Explicit opens are unchanged: the Terminal icon, New terminal, Open / Jump in, the Crew's Terminal tab,
  `terminal.attach` and right-click Open terminal all still bring it up.

## Stale queued commands

Checked live: the console-commands queue is empty, and none of the last 16 console commands opened the Terminal.
Nothing to clear.

## API

No new screen or setting. The behaviour hangs off the existing *When a new session starts* setting, which is already
reachable everywhere: REST `GET/PUT /api/plugins/console-terminal/new-session`, MCP `console_terminal_new_session_set`,
CLI / voice through the same tool, deep link Settings → Plugins → Terminal → Headless tabs.

## Tests

- New `framework/spec/check-terminal-no-popup.mts` (14 checks, green), added to CI next to `check-headless-tabs`.
- Console `tsc --noEmit`: clean.
- Pre-existing, not from this build: `framework/spec/check-headless-tabs.mts` fails on main at "meter starts with the
  memory chain loaded" (the meter's chain count changed with headless-context@1). Left for its owner.
- Screenshots: skipped (no visual change; the only visible difference is the existing toolbar count).

## Brett

- After this deploys, **Bring to front** is safe again. Gizmo set the setting to **Do nothing** on Nov 9 as a stopgap.
  Set it back to **Add tab quietly** (or Bring to front) in Settings → Plugins → Terminal → Headless tabs if you want
  agent tabs again.
