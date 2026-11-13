# Icon map (console plugin)

Every icon, badge and logo slot in every app, plugin and screen, in one map (icon-map@1,
`framework/core/engines/icon-map-rules.mjs`), with the icon pack in force and per-slot picks. Brett (Nov 13 2026):
"a map of every single icon and badge for the whole entire app, every plugin, every screen, every UI; a template so I
can change every single one with a click".

## Reach it

| How | Where |
| --- | --- |
| Screen | View → Icon map · nav `icon-map` · deep link `console_show view:icon-map` / `console_open icon-map` |
| REST | `/api/plugins/icon-map/{map,tree,roles,glyphs,packs,state,slot/{id},resolve,check}` (GET), `PUT /pack {pack}`, `DELETE /pack`, `PUT /slot/{id} {glyph}`, `DELETE /slot/{id}`; the same under `/api/control/icon-map/<command>` (plugin-commands@1) |
| MCP | `icon-map_map`, `icon-map_packs`, `icon-map_state`, `icon-map_pack-set`, `icon-map_pack-clear`, `icon-map_slot-set`, `icon-map_slot-clear`, `icon-map_resolve`, `icon-map_check`, … (`plugin_commands icon-map` lists them) |
| CLI | `axf icon-map pack-set --pack duotone`, `axf icon-map map --q save`, `node framework/cli/icon-map.mjs …` (the map from the files, no console needed) |
| Voice | "switch to the duotone icon pack", "use the filled icon pack", "back to the default icon pack", "open the icon map" |
| Console actions | `icon-map.open`, `icon-map.pack.use:<pack>`, `icon-map.pack.clear`, `icon-map.slot.set:<slot>:<glyph>`, `icon-map.slot.clear:<slot>`, `icon-map.slot.open:<slot>`, `icon-map.refresh` (search, context menu, `function:` control targets) |
| Other UI tools | web service `axf.icon-map@1` (`globalThis.__axfWebServices`): `open(slot)`, `resolve(name, slot?, role?)`, `setSlot(slot, glyph \| null)`, `usePack(pack)`, `packs()`, `map(query)` |

## The page

Two views (TabGroup): **Tree** (app → plugin / screen owner → surface → slot, with counts; a search opens the
branches it matches) and **List**. Filters: search, app, surface, kind (icon / badge / logo). Every row previews what
the place draws now, through the runtime, so a pack switch or a pick shows at once. **Change** opens the slot panel:
previews at three sizes, why it draws what it draws (pick, pack role, pack glyph, framework, fallback) and a glyph
grid; one click on a glyph changes that place.

## State

`icons.json` in the plugin's data folder (`.axf-console/plugins/icon-map/`, or `AXF_ICON_MAP_DIR`):
`{ "pack": "<icon-pack id or ''>", "slots": { "<slot id>": "<glyph>" } }`. The open console reads it on load and
every few seconds, and writes it back when a pick is made on screen, so REST, MCP, CLI, voice and the page agree.
The runtime keys are `axf.icons.pack.app` (the skin engine's own key) and `axf.icons.slot.<slot id>`.

## Tests

`node apps/console-web/plugins/icon-map/test.mjs` (the map CLI and the state file) and
`python3 apps/console-web/plugins/icon-map/test.py` (the routes against a scratch data folder).
