# Console control (console-control@1)

Full API and voice control of the Dev Console: every screen, tab, setting, button, function and plugin, scrolling, and
any grid row or build step pulled into focus, all by address. Build
`full-api-and-voice-control-of-the-entire-console-every-tab-screen-setting-bu`, Nov 2026. The contract is
`framework/spec/CONSOLE-CONTROL.md`.

| Part | Where |
|---|---|
| Contract, schemas | `framework/spec/CONSOLE-CONTROL.md`, `framework/schemas/console-control.json`, `framework/schemas/json/console-control-*.schema.json` |
| Rules, pure (+ fixtures) | `framework/core/engines/console-control-rules.mjs` (addresses, commands, guards), `console-control-voice.mjs` (phrase → intent) |
| Target registry (browser) | `framework/react/controlTargets.ts`, `framework/react/scrollControl.ts` |
| Static inventory | `apps/console-web/scripts/control-inventory.mjs` → `apps/console-web/src/control/inventory.json` (views, nav, tabs, settings, functions, buttons, plugins) |
| Executor (browser) | `apps/console-web/src/control/executor.ts`: runs relay commands, highlights, answers with a state snapshot; `window.axfConsoleControl(cmd)` |
| Search | `apps/console-web/src/control/search.ts` (`addLoadedSource` for loaded rows, steps, review items, chat lines) |
| Palette | `apps/console-web/src/control/SearchPalette.tsx`: Ctrl+K, `console.control.search`, `?axf-cmd=search&q=` |
| Console actions | `apps/console-web/src/actions/console-control.ts` (`console.control.open/focus/scroll/search/state/press/set/plugin`), `voice-control.ts` |
| Server | `apps/console-web/server/console_control.py` (inventory, search, plugins, voice twin), `console_control_api.py` (REST, guards, audit, rate limit) |
| MCP | `console_control_targets`, `_state`, `_do`, `_search`, `_focus`, `_scroll`, `_plugin`, `_voice`; `console_open` / `console_show` take an address |
| CLI | `axf console do|state|targets|search|focus|scroll|plugin enable|disable|voice … [--json]` (`framework/cli/console-control.mjs`) |
| Checks | `framework/cli/check-console-control.mjs` (ratchet `framework/spec/console-control-baseline.json`), `server/tests/test_console_control.py`, `scripts/console-control.e2e.mjs`, `scripts/console-control-parity.mjs` |

## Addresses

Outermost first, `/`-joined: `view:settings`, `view:settings/tab:settings.tabs=plugins`, `setting:axf.help.mode`,
`button:console.settings`, `function:snapshots.delete`, `plugin:<id>`, `row:<build>`, `row:<build>/step:s3`. A short
address resolves to the full one. Framework controls (TabGroup, DataGrid, SettingsRegistry, toolbars, plugins)
register themselves; a hand-drawn element carries `data-axf-target="<kind>:<id>"`. A new view, tab row, toolbar,
setting, plugin or DataGrid without an address fails `check-console-control` in CI.

## REST (`/api/console-control`)

`GET /targets?under&kinds&source=auto|console|inventory` · `GET /state[?address]` · `POST /do {verb, address, value,
confirm, options, to}` · `GET|POST /search` · `POST /focus` · `POST /scroll {scroll:{dir, amount}}` ·
`POST /plugins/{id}/enable|disable {force}` · `POST /voice {text}`.

- Commands go to the open console over the console-commands relay (the Follow Amber channel). With none open the
  answer is `code: unavailable`, "no console open", with `openUrl`. Search, list and targets fall back to the
  static inventory.
- Settings and plugin toggles that need no browser run server-side (`source: server`). A plugin toggle reports
  `effects` (what loses a feature, what stops working); core plugins refuse with `reason: core`, and a plugin another
  needs refuses with `neededBy` unless `force`.
- Guards: deciding presses (approve, deny) and owner-only Claude settings are refused (`personOnly`); destructive
  presses answer `confirmation_required` until sent with `confirm`; one audit line per command; rate limit 120 reads
  and 20 writes per caller per 10 s. Each answer carries `policy.tag` (`allow` for reads and navigation, `veto` for
  writes, `confirm`, `person`), which is sent to axHub.

## Answers

Every answer is `{ $axf, ok, verb, address?, …, state }`, where `state` is the live snapshot `{screen, screenLabel,
tabs, scroll, focused, focusedRow, dialog?, targets}`. `state <address>` adds that target's own fields (`value`,
`disabled`, `can`, `onScreen`) and keeps them under `state.target`. `focus` on a screen or tab opens it.

## Voice (AmberX)

"scroll down", "go to the top", "open plugins settings", "find dark mode", "show step 3 of <build>",
"disable plugin <name>", "press <button>", "set font scale to 1.2". Words are resolved by the console search, the
command runs with the REST guards, and `say` is the line spoken back.

## Parity

REST, MCP, CLI and voice are one code path (`console_control_api.command` / `voice`): the MCP runner calls it
in-process inside the console, or over REST from a local clone; the CLI calls REST. `console-control-parity.mjs`
proves it: the same 14 commands through all four give the same answer, the same command at the console and the
same state.
