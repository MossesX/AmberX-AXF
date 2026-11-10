# Molly flagship skin: premium, sellable, uncluttered (phase 2, Opus: s5–s12)

Brett (Nov 10 2026): "I want a powerful, beautiful, very expensive, professional, sellable skin on Molly, my flagship.
Cannot be cluttered. Access everything, even redundantly. Context menu spot on, completely mapped. Sub menus keep the
main menu short; expand left if they'd go off screen; the menu scrolls, not the screen. Choices in the app menu change
instantly with status listed beside them. Live info next to entries like the little green axHub logo, red if not. Hover
explains icons. Make that shit sick."

Phase 1 (Fable, s1–s4) built the engine: menu-item@2, sub-menus flipping left/up, the menu scrolling instead of the page,
inline choices, live status slots, tooltips, the item-settings dialog. This phase puts it on Molly.

## What shipped

| Step | Result |
|---|---|
| s5 skin tokens | `molly-flagship` (day) and `molly-flagship-night` skins + design packages; colour themes `molly-flagship-day` / `-night` (porcelain, ink and royal violet / graphite and luminous violet, vivid status green and red); style theme `molly-flagship` (Inter, 8/12/18 radii, 8-pt rhythm, layered shadows, 160 ms motion, frosted blur); typography, behaviour, dialog, pop-up and theme-switch assets; menu / context-menu / dialog / button / badge style parts. Molly defaults to the flagship look. Baked into all four apps. |
| s6 components | Framework: styled tooltips on chrome (`TipLayer`, `placeTip`, inverted tip, delay, keyboard, no double native tooltip); menu polish (drop-downs grow from their button, eased hover, press tint, healthy / failing status icons glow softly; reduced motion respected). Molly's menu bar on the glass surface. Molly rebaked (it was still on the pre-s1 framework, so the new menu engine reaches Molly now). Checked at 1440, 1280 and 390 wide. |
| s7 app menu | Molly menu 7 entries (Start page · Apps ▸ · This app ▸ · Appearance ▸ · Status ▸ · Settings · Account); View 4 (one sub-menu per plugin instead of 10 flat rows); Help 3. A hint on every row. Inventory `apps/molly/menus/inventory.md`. |
| s8 choices + status | Appearance ▸ Skin, Day / night (cycles), Density, Text size, Motion: value beside the label, applies at once, menu stays open. A bridge (`src/molly/look.ts`) keeps one settings key per choice in step with the live look both ways. Status ▸ axHub connection (lib-hub `source:hub`), Look sync, Skin, Role (`src/molly/status.ts`), green / amber / red / pulsing with tooltips; Status itself carries the axHub icon. |
| s9 context menus | Molly's own `context-menu/molly`: page (default), start-page app card (new target), nav entry, menu bar; only rows that work in Molly. Removed the shared menu's stub rows (Cut / Copy / Paste / Next theme / Random / Shortcuts) and a duplicate nav-item row. Fixed in the framework: right-click on the menu bar showed the browser's menu (`ContextMenuHost` only listened inside `.fx-shell`). |
| s10 REST | Console plugin `molly-menus`: state, tree, choices, set-choice, skin, set-skin, invoke, links, status, overrides (control@1 `tokens.menu`). Changes go to Molly's look document on axHub; Molly follows live. Molly deep links (`src/molly/links.ts`): `#/menu/<menu>/<sub-menu>…`, `#/skin`, `#/item-settings/<path>`, `#/set/<choice>/<value>`, `#/do/<menu action>` (only actions Molly's menus offer). |
| s11 parity | plugin-commands@1 projects every route to MCP `molly_menus_*`, CLI `axf molly-menus …` and `/api/control/molly-menus/*`; AmberX voice: Developer → Molly, 12 commands, each naming its MCP tool. Parity test enumerates the REST commands and checks MCP, CLI and voice for each, plus menu choice rows = API choices. |
| s12 tests | `framework/spec/check-tip-layer.mts` (15), `apps/molly/menus/test.mts` (124), `molly-menus/test.mjs` parity (52), `molly-menus/server/test_molly_menus.py` (23); all in CI. Framework menu checks still green (fit 54, keys 35, items 47, settings 45). UI smoke: Playwright shots desktop + phone, day + night. |

## How each feature is reached

| Feature | Deep link | REST | MCP | CLI | Voice |
|---|---|---|---|---|---|
| Skin picker / switch skin | `#/skin`, `#/set/skin/<id>` | `GET/PUT /skin` | `molly_menus_skin`, `molly_menus_set_skin` | `axf molly-menus skin`, `set-skin --skin` | "molly use night skin" |
| Look choices | `#/set/<choice>/<value>` | `GET /choices`, `PUT /choices/{choice}` | `molly_menus_choices`, `molly_menus_set_choice` | `choices`, `set-choice` | "molly density roomy" |
| App menu / each sub-menu | `#/menu/molly`, `#/menu/molly/appearance` … | `GET /tree`, `GET /links` | `molly_menus_tree`, `molly_menus_links` | `tree`, `links` | "molly menus" |
| Run any menu item | `#/do/<action>`, `#/<app>` | `POST /invoke` | `molly_menus_invoke` | `invoke --path` | "molly menu reload this app" |
| Live status | — | `GET /status`, `GET /state` | `molly_menus_status`, `molly_menus_state` | `status`, `state` | "molly status" |
| Item settings dialog / overrides | `#/item-settings/<path>` | `GET/PUT/DELETE /items/overrides` | `molly_menus_overrides`, `_set_override`, `_reset_override` | `overrides`, `set-override`, `reset-override` | "change molly menu item …" |

## Gaps and decisions

- `invoke` of an action only a browser can run (reload a frame, open in a new tab, help mode) answers the Molly deep link
  that runs it; there is no live Molly client channel yet (the console's command channel reaches console tabs). A Molly
  client announce/stream like console-commands@1 would let it run in the open Molly directly.
- Look choices are asset slots, so menu-item@2 choice rows bind them through settings keys kept in step by Molly
  (`look.ts`), not a new `slot:` binding in the engine (that is an engine contract change: Fable).
- Inter and JetBrains Mono are named first; devices without them fall back to the system UI font (as other themes do).
- The skin is Molly's default; the hub-wide look on axHub wins once someone picks there, as for every app.
- UI Review: this session has no console URL / token, so the review item and screenshots were saved in the worktree
  (`r-20261110-xgwxd01`), not uploaded. Re-submit from a session with `AXF_CONSOLE_URL` + `AXF_TOKEN`.
- Android / Kotlin: none (on hold); TipLayer has no Compose twin (recorded in PORTING.md).
