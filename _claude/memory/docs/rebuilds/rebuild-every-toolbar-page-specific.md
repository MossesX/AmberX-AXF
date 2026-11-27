# Rebuild: every toolbar with page-specific buttons (page-toolbar@1)

Build `rebuild-every-toolbar-page-specific`, Phase 1 (Fable), branch `claude/rebuild-every-toolbar-page-specific`, Nov 17 2026.
Brett: "Everywhere there's a toolbar, rebuild the asset for that page/plugin with useful, integrated buttons made for it. Use Fable."

Phase 1 builds the contract, the migration, the engine, the fixtures, the React renderer and the API spine. The per-page
assets themselves (one toolbar asset per page or plugin, from the inventory) are the next phase; until a page gets one it
keeps its handwritten bar (`<PageToolbar fallback={…}>` draws nothing new when no asset matches).

## What it replaces

Before: a toolbar asset was a bare button list for the app frame (`groups[].items[]` with `action` = a console action id,
`badge` = a counter, `checked` = an app-menu binding). The 119 handwritten `role="toolbar"` bars on the console, its
plugins, Molly, AmberX web and the framework libraries (`_claude/builds/reports/rebuild-every-toolbar-page-specific/inventory.json`:
122 toolbars on 46 pages, 342 controls, 3 asset-driven) each decided their own buttons in code; none was an asset, none
was reachable by address beyond the generic `button:<label>`.

## Removed

Nothing. Every starter toolbar, every `AssetToolbar` call and every handwritten bar works as before.

## Kept

- The toolbar asset envelope and its required grid (`variant`, `align`, `groups`, `showSearch`); every optional field
  (`density`, `surface`, `divider`, `search`, `widgets`, `collapsible`, providers, `max`, `badge`, `checked`, `requires`).
- Bare console action ids as `action` (including `nav:home`, `settings.open:x`, `swap:layout:next`): a bare id is an
  `action:` ref. Old assets validate and draw the same.
- `role="toolbar"`, the aria-label, the settings id, tap-to-confirm, the chrome context menu (Settings… / Change… / Move),
  chrome-settings@1 overrides per instance, UAC gating, embed@1 takes and locks, the live provider groups.
- The frame toolbar (`Toolbar` in Chrome.tsx) is untouched; `AssetToolbar` keeps its signature and now renders through the engine.

## Changed

- `framework/schemas/asset-types.json` → `types.toolbar`: a `pageToolbar` block (contract `page-toolbar@1`, append-only
  lists: scope kinds, action kinds, badge kinds, checked kinds, overflow modes, when operators, limits, defaults,
  control-target shapes) and the new optional fields. The generated `toolbar.schema.json` carries `$defs.toolbarItem`.
- `core/types.ts`: `ToolbarItem` / `ToolbarGroup` / `ToolbarData` gain the optional fields.
- `AssetToolbar` (Chrome.tsx) delegates to `<PageToolbar assetId>`.
- console-control@1: the kind list gains `toolbar` (thirteenth, append-only); `button` may follow `toolbar`.
- control@1: target `console.toolbars` appended (27th).
- CLI: `axf console toolbar list|get|press`. MCP: `console_control_toolbar`. REST: `/api/console-control/toolbars…`.
- Voice (JS + Python twins): "press <button> on the <x> toolbar", "what's on the <x> toolbar".

## Added

| Piece | Where |
|---|---|
| Inventory of every toolbar (settings id, page, buttons, page functions) | `framework/cli/toolbar-inventory.mjs` → `_claude/builds/reports/rebuild-every-toolbar-page-specific/inventory.json` |
| Contract rules: grammar parsers, both validators, JSON Schema | `framework/core/engines/toolbar-rules.mjs` (+ `.d.mts`) |
| Migration (no visible change) + the look signature both validators compare | `framework/core/engines/toolbar-migrate.mjs` (+ `.d.mts`) |
| Reference engine: pick, resolve, gate, badge, overflow plan, invoke, API state | `framework/core/engines/toolbar-actions.ts` |
| Fixtures + checks | `spec/fixtures/toolbar-migrate.json`, `spec/fixtures/toolbar-actions.json`, `spec/toolbar-actions-cases.ts`, `spec/check-toolbar-actions.mts` (CI) |
| React: page state, handlers, dispatchers, `usePageToolbar`, `<PageToolbar>`, live registry | `framework/react/pageToolbar.ts`, `framework/react/components/Toolbar.tsx` |
| Tokens-only CSS for the danger tone and the More menu | `framework/ui/axf.css` (page toolbars section) |
| Console targets `toolbar:<id>` / `toolbar:<id>/button:<b>` + the plugin command runner | `apps/console-web/src/control/toolbars.ts` |
| REST / MCP / control@1 host handler / Python voice twin | `server/console_control_api.py`, `server/mcp_server.py`, `plugins/console-commands/server/__init__.py`, `server/console_control.py` |

## The contract in one screen

```jsonc
{ "type": "toolbar", "id": "gate-auto-lander", "data": {
  "scope": "view:gate", "slot": "auto-lander",            // settings id gate.auto-lander
  "variant": "icons-labels", "align": "start", "showSearch": false,
  "overflow": { "when": "auto", "keep": 1, "label": "More" },
  "groups": [{ "id": "lander", "items": [
    { "id": "run",   "icon": "play",    "label": "Run now", "action": "command:gate/lander-run", "enabledWhen": ["!paused", "waiting>0"], "badge": "state:waiting", "priority": 200, "overflow": "never" },
    { "id": "retry", "icon": "refresh", "label": "Retry",   "action": "command:gate/lander-retry", "args": { "build": "$selection.id" }, "enabledWhen": "selection.id" },
    { "id": "pause", "icon": "pause",   "label": "Pause",   "action": "handler:gate.pause", "checked": "state:paused", "visibleWhen": "status!=off" },
    { "id": "reset", "icon": "trash",   "label": "Reset",   "action": "command:gate/rules-reset", "destructive": true, "confirm": "Reset every rule?", "priority": 10 },
    { "id": "rules", "icon": "settings","label": "Rules",   "action": "control:view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=gate", "overflow": "always" }
  ] }]
} }
```

A page publishes its state (`usePublishPageState('gate', { paused, waiting, selection, status })`), registers its handlers
(`useToolbarHandlers('gate', { 'gate.pause': fn })`) and draws `<PageToolbar slot="auto-lander" fallback={oldBar} />`.

## API: how each piece is reached

- Deep link / open: `console_control open toolbar:gate.auto-lander` (also `axf console do open toolbar:gate.auto-lander`).
- State: `GET /api/console-control/toolbars/gate.auto-lander`, MCP `console_control_toolbar {toolbar}`, control@1
  `console.toolbars get gate.auto-lander`, CLI `axf console toolbar get gate.auto-lander`, voice "what's on the auto-lander toolbar".
- Every button: `POST /api/console-control/toolbars/gate.auto-lander/press {button: "run"}`, MCP `console_control_toolbar
  {toolbar, button}`, control@1 `console.toolbars act press`, CLI `axf console toolbar press gate.auto-lander run`,
  voice "press run now on the auto-lander toolbar". Disabled or hidden buttons refuse with the engine's reason; a
  destructive one answers `confirmation_required` until sent with `confirm`.
- Settings: the per-toolbar chrome settings (`axf.chrome.toolbar.<id>`, tap-to-confirm) are the same keys as before, through `setting:` targets.
- List: `GET /api/console-control/toolbars?view=gate`, `axf console toolbar list --view gate`.

## Migrations and compatibility

- `toolbar-migrate.mjs` runs where an asset is read; files are not rewritten. It sets `scope: app`, the default overflow
  rule and canonical badge refs; `toolbarSignature` before and after must be equal or both validators fail the asset.
- Apps on the framework: nothing to change. An app that wants page toolbars bakes the framework again (`src/axf`), adds
  `<PageToolbar>` to a page and ships `toolbar` assets with a `scope`.
- console-control kind `toolbar` is appended; parsers that whitelist kinds (the console server's MCP `ADDRESS_RE`) were updated.

## Tests before vs after

- Before: no toolbar-specific check. After: `check-toolbar-actions.mts` (324 checks: 11 resolve cases, 30 starters migrate
  with the same look, both validators agree, overflow, invocations, API state), `check-console-control.mts` (13 kinds),
  `check-control.mts` (27 targets), `check-console-control.mjs` ratchet unchanged (437), `check-theme`, `check-controls`,
  `check-toolbars`, `axf validate --framework` (544 assets), the console type-check. The Python voice twin replays all 33
  fixture phrases identically (pytest is not installed on this VPS; CI runs the server tests).

## Known gaps

- No page draws a page toolbar asset yet: the per-page assets (one per entry in the inventory, with the real functions
  wired) are the next phase, each shipped as UI Review choices.
- Kotlin twin deferred (`spec/PORTING.md`).
- The More menu measures room by button count; a very narrow bar converges in two or three renders.
- `handler:` refs are per page; a plugin that wants a handler reachable from the API without its page open should expose a plugin command instead.
