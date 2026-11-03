# terminal-tabs-left — Terminal tab position (top, left / right stack, bottom)

**Asked (Brett, Nov 3 2026, voice):** "I want a setting in terminal to put all the tabs on the left side in a stack
instead of across the top."

- Build: `terminal-tabs-left`, profile **current**, 5 steps, all **Opus** (plugin UI, no cross-port contract).
- Agent: **Janitor Joey** (headless worktree session; the job router isn't on this checkout's main).
- Branch `claude/terminal-tabs-left`.

## What changed

Built into the existing Terminal plugin (`apps/console-web/plugins/console-terminal`); no second terminal.

- **Setting "Tab position":** Top (as before) · Left stack · Right stack · Bottom.
  - Per device: kept in the browser's settings registry (`terminal.tabs.position`, `.width`, `.collapsed`).
  - A device that hasn't picked follows the server default (`tabPosition` in the terminal settings).
  - Settings → Plugins → Terminal → Tabs & behaviour has two pickers: *this device* (with "Follow the default") and
    *default for every device*.
  - The tab right-click menu has a **Tab position** section. In stack mode, right-clicking empty stack space opens a
    menu with Tab position, Follow the default, Collapse / Show titles and Reset the width.
- **Left / right stack** (`web/TabStack.tsx`):
  - Each row shows the status dot (working / waiting / done / failed), the agent's avatar, the title, the model, the
    live cost, the connection dot and a close button.
  - **Collapse to icons** (header chevron), **resizable width** (drag the edge, arrow keys or Home / End on it,
    double-click resets), **drag to reorder** (mouse drag, or hold then drag on touch; Alt+↑/↓ from the keyboard).
  - A long list scrolls. "New tab" sits at the bottom of the stack.
  - Double-click renames, middle-click closes, and right-click opens the same tab menu as the strip.
- **Bottom:** a horizontal tab strip under the panes, showing cost and close on each tab.
- **Title bar still works:** the strip above stays as the frameless window's title bar (+, ∨, drag space, minimise /
  maximise / close). Only its tabs hide when the tabs live elsewhere.
- **Phone / narrow window:** the stack turns into a slide-out. A **Tabs** button with the tab count, or a swipe in from
  the edge, opens it. Tapping a tab, the scrim or ✕, or swiping back, closes it. The breakpoint is the split view's
  (about 40 characters of text).
- **Tokens only.** The stack width is counted in text-size steps (`--fx-type-root-md` × n). The first try used
  `--fx-space`, but compact density made the stack about 60 px wide.
- **Commands, declared once** (plugin.json `commands.items` + routes; plugin-commands derives REST, MCP and CLI):
  - `GET  /api/plugins/console-terminal/tab-position`: the default plus the choices. MCP tool
    `console_terminal_tab_position`, CLI `axf console-terminal tab-position`.
  - `PUT  …/tab-position {position}`: set the default. MCP `console_terminal_tab_position_set`, CLI
    `axf console-terminal tab-position-set --position left`.
  - Web action `terminal.tabs.position:<top|left|right|bottom>` sets the position on the open console's device. Empty
    means follow the default. Command `action-terminal-tabs-position`.
- **Agent avatar:** crew-live (#273, which has the drawn agent avatars) is not on main yet, so the stack shows the
  agent's initials in a tinted circle. When crew-live lands, swap `__avatar` for its avatar component through a
  capability; plugins can't import one another.

## Files

- New: `web/TabStack.tsx`, `web/tab-position-core.ts`, `framework/spec/check-terminal-tab-position.mts` (in CI,
  `android.yml`).
- Edited:
  - `web/TerminalHost.tsx`: 8 lines (import, hook, root class/style, `<TabStack>` in the body, Tab position in the
    tab menu).
  - `web/look.tsx`, `web/api.ts`, `web/index.tsx`, `web/terminal.css` (appended section).
  - `server/store.py`, `server/__init__.py`, `test.py`, `plugin.json`, `help.json`.

## Overlaps (merge notes)

- **terminal-sessions-nav (#286, open, not on main):** adds a left nav rail and wraps the toolbar and body in
  `__main` → rail + `__pane`.
  - This build keeps all its UI inside `__body`, which ends up inside `__pane` after that merge. The stack therefore
    sits beside the rail, between the rail and the panes. Expect no textual conflict beyond adjacent-line context.
  - Not done yet: a setting to put the stack *inside* the rail (Brett picks). That needs #286 on main first and is
    left as a follow-up.
- **terminal-drag-chain-tree (running):** rewrites the strip's pointer handling (reorder, hold-drag).
  - This build doesn't touch the strip's tab markup. It hides the strip tabs with CSS in stack mode, so the two merge
    cleanly.
  - The stack has its own pointer reorder. If that build adds a shared hold-to-drag engine, the stack can move to it
    later.

## Tests

| Check | Before | After |
|---|---|---|
| `python3 apps/console-web/plugins/console-terminal/test.py` | stops at "a console token reset closes every terminal" (fails on clean main too) | 3 new tab-position checks pass; same unrelated stop |
| `npx -y tsx framework/spec/check-terminal-tab-position.mts` | — | 21 / 21 |
| `tsc --noEmit` (console-web) | ok | ok |
| `check-theme.mjs`, `check-controls.mjs` | ok | ok |
| `help-coverage.mjs --check` | ok | ok (6 new entries) |
| `commands.mjs check console-terminal` | 22 | 14 reads · 12 commands (+ tab-position, tab-position-set, action-terminal-tabs-position) |

The token-reset failure in `test.py` is already on main and unrelated (it was reported in headless-tabs as well).

## Screenshots

Taken with `framework/cli/rebuild-shots.mjs` (`AXF_APPEARANCE_HUB=off`, shots `terminal-tabs-left/shots.json`). Four
headless sessions are mocked (agent, model, cost, status) so the stack shows real rows. xterm doesn't load under the
harness's Vite dev server (same on main), so the panes are empty.

| | |
|---|---|
| Left stack (desktop) | ![](terminal-tabs-left/shots/after/tabs-left-desktop.png) |
| Right stack | ![](terminal-tabs-left/shots/after/tabs-right-desktop.png) |
| Collapsed to icons | ![](terminal-tabs-left/shots/after/tabs-left-collapsed-desktop.png) |
| Bottom | ![](terminal-tabs-left/shots/after/tabs-bottom-desktop.png) |
| Top (unchanged) | ![](terminal-tabs-left/shots/after/tabs-top-desktop.png) |
| Tab menu → Tab position | ![](terminal-tabs-left/shots/after/tabs-left-menu-desktop.png) |
| Phone, closed (Tabs button) | ![](terminal-tabs-left/shots/after/tabs-left-phone.png) |
| Phone, slide-out open | ![](terminal-tabs-left/shots/after/tabs-left-drawer-phone.png) |

## Known gaps

- Android twin: not applicable (console plugin, web only; Android on hold).
- Stack inside the sessions rail: waits for #286 (see Overlaps).
- Real agent avatars: wait for crew-live (#273).
