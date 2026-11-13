# Full API and voice control of the console — report (Nov 13 2026, Fable then Opus, headless VPS)

Build `full-api-and-voice-control-of-the-entire-console-every-tab-screen-setting-bu`: full API and voice control of the
entire console, meaning every tab, screen, setting, button, function and plugin (including turning plugins on and off),
scrolling up and down, bringing any row or step of any table or grid into focus, and searching screens and everything
loaded and pulling the hit into focus.

Branch `claude/full-api-and-voice-control-of-the-entire-console-every-tab-screen-setting-bu`, PR #556. Phase 1 (Fable,
s1–s8): contract, reference engine, fixtures, React registry. Phase 2 (Opus, s9–s31): everything else. Doc
`_claude/memory/docs/console-control.md`, contract `framework/spec/CONSOLE-CONTROL.md`.

## What it does

- **Every place has an address:** `view:settings`, `view:settings/tab:settings.tabs=plugins`, `setting:axf.help.mode`,
  `button:console.settings`, `function:snapshots.delete`, `plugin:<id>`, `row:<build>`, `row:<build>/step:s3`.
  Framework controls (TabGroup, Button, DataGrid, settings rows, toolbars, plugins) register themselves; hand-drawn
  controls in the banner, nav, menu bar, Settings, Terminal, Builds views and the plugin UIs carry `data-axf-target`.
- **Verbs:** open, state, press, set, scroll, focus, search, list, plugin.enable / plugin.disable. Each answer carries
  a live state snapshot: screen, open tabs, scroll, focused row or step, open dialog.
- **Runs where it can:** commands go to the open console over the console-commands relay (Follow Amber channel) and
  run in the page (`src/control/executor.ts`), which highlights the result. Settings and plugin toggles run
  server-side. With no console open the answer is "no console open" plus the link to open it; search and target
  lists then fall back to the static inventory.
- **Guards:** approve / deny and owner-only Claude settings are never commands (`personOnly`); destructive presses
  answer `confirmation_required` until sent with confirm; core plugins refuse to turn off, and a plugin others need
  names them and refuses unless forced, with the effects reported; one audit line per command; a rate limit. Each
  answer's policy tag goes to axHub: reads and navigation are read-only, state-changing verbs are veto calls.
- **Search:** one ranked search over screens, tabs, settings, buttons, plugins, help and everything loaded (build rows
  and steps, UI Review items, Plan Studio, chat lines, Breakroom). Every hit carries its address.
- **Search palette:** Ctrl+K, the `console.control.search` action, or `?axf-cmd=search&q=<words>`. Pick a hit and it
  is pulled into focus. Framework controls only (TextField, TabGroup, Button), tokens only.

## How each feature is reached

| Feature | Deep link / UI | State | REST `/api/console-control` | MCP | CLI | Voice (AmberX) |
|---|---|---|---|---|---|---|
| Open a screen, tab, setting, row or step | `console_open` / `console_show` take an address | `GET /state` | `POST /do {verb: open}` | `console_control_do`, `console_open` | `axf console do open <addr>` | "open plugins settings", "go to plan studio" |
| Pull into focus (expands the row, opens its tab) | palette pick | `state.focused`, `focusedRow` | `POST /focus` | `console_control_focus` | `axf console focus <addr> [--expand]` | "show step 3 of <build>" |
| Scroll | — | `state.scroll` | `POST /scroll` | `console_control_scroll` | `axf console scroll up\|down\|page-up\|page-down\|top\|bottom` | "scroll down", "go to the top" |
| Read state | — | `GET /state[?address]` | same | `console_control_state` | `axf console state [addr]` | — |
| Press a button / run a function | — | `state <addr>` (disabled, can) | `POST /do {verb: press, confirm}` | `console_control_do` | `axf console do press <addr> [--confirm]` | "press save" |
| Set a setting | Settings | `state setting:<id>` → value | `POST /do {verb: set, value}` (server-side) | `console_control_do` | `axf console do set <addr> --value v` | "set font scale to 1.2", "turn help mode on" |
| Plugin on / off | Settings › Plugins | `GET /targets?kinds=plugin` | `POST /plugins/{id}/enable\|disable {force}` | `console_control_plugin` | `axf console plugin enable\|disable <id>` | "disable plugin skins" |
| Search | Ctrl+K, `?axf-cmd=search&q=` | `state.dialog = console-control.search` | `GET\|POST /search` | `console_control_search` | `axf console search <words>` | "find dark mode" |
| List targets | — | — | `GET /targets?under&kinds&source` | `console_control_targets` | `axf console targets` | — |
| Console actions | menus, palette, `console.control.*` | — | — | console actions, control@1 target `console.control` | — | via the actions registry |

## Checks (all green, Nov 13 2026)

| Check | Result |
|---|---|
| `npx -y tsx framework/spec/check-console-control.mts` (fixtures) | 290 checks, 12 kinds, 10 verbs |
| `check-control.mts`, `check-console-commands.mts`, `check-orchestrator-focus.mts`, `check-project-fixtures.mjs` | 389, 101, 8 checks, 16 cases |
| `node framework/cli/check-console-control.mjs` (coverage, ratchet) | views, nav, tab rows, settings, plugins, toolbars, grids: 0 without an address |
| `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` | pass |
| `help-coverage.mjs --check`, glossary `catalog.mjs --check` | pass (ratchets held) |
| `python apps/console-web/server/tests/test_console_control.py` | 8 tests (REST, guards, plugins, voice, MCP) |
| `python apps/console-web/server/test_mcp_tools.py` | 206 checks, 65 tools |
| `node apps/console-web/scripts/console-control.e2e.mjs` (Playwright, vite preview) | 23 checks |
| `node apps/console-web/scripts/console-control-parity.mjs` | 14 cases, 132 comparisons: REST, CLI, MCP and voice agree |
| `tsc --noEmit`, `vite build` (console-web) | pass |

## Found and fixed while testing (phase 2, last steps)

- `state <address>` lost the target's own value under the live snapshot; both are kept now (`state.value`,
  `state.target`).
- `focus` on a screen answered not_implemented, so palette picks of screens did nothing; it opens the screen now.
- The palette field lost the keyboard to an autofocus field on the screen under it; it takes it back.
- Palette hits: detail spaced from its label; targets with no label of their own rank after named ones.
- Help coverage was one entry short from the base (Claude accounts › One Claude account); written.

## Open

- UI Review: the search palette (desktop and phone), item `r-20261113-3lor001`, waiting for Brett.
- Android / Kotlin twin of console-control@1: recorded as a deferred gap in `framework/spec/PORTING.md` (no new
  Kotlin work).
- 437 hand-drawn buttons are still counted in the coverage baseline (`rawButtons`); the ratchet only lets that number
  go down.
