# Icon map and icon packs (icon-map-icon-packs-every-icon-badge-app)

Brett, Nov 13 2026: "I need a shitload of icon packs, badges, logos, the works; a map of every single icon and badge
for the whole entire app, every plugin, every screen, every UI; a template so I can change every single one with a
click; some packs must be themable, others don't have to be; just need a lot of them"

Phase 1 (Fable, s1-s2) built the registry and the API. Phase 2 (Opus, s3-s8, Nov 13 2026) built the screen, the
template, the packs and the asset side. Branch `claude/icon-map-icon-packs-every-icon-badge-app`.

## What there is now
- **The map:** 5922 slots (5816 icons, 24 badges, 82 logos) over 8 apps and every plugin folder with a plugin.json,
  each with a stable id `<app>/<owner>/<surface>/<name>`, its role, glyph, file and line. s7 added Molly's 5 plugins
  and the expenses app's plugins, which the map had skipped.
- **The screen** (View → Icon map, Appearance nav): tabs **Slots** and **Packs**. Slots: Tree (app → plugin / screen
  owner → surface → slot, with counts) or List; search, app, surface, kind filters; a live preview per row. **Change**
  opens the slot panel: previews at three sizes, why the place draws what it draws (pick, pack role, pack glyph,
  framework), a searchable glyph grid (one click changes that place), Clear pick, Restore previous edit, Restore from axHub.
- **One click for everything:** Use on any pack switches every icon in the console at once, chrome included. This was
  checked in a browser against this branch.
- **Template:** one icon-pack@1 file maps all 168 roles to glyphs, with glyph art. Change a line to change every place of
  that role, import it, use it.
- **41 packs** (38 new). Themable (follow the skin's colour and stroke): Lucide; Tabler outline / filled; Feather;
  Iconoir; Heroicons outline; Phosphor regular / thin / light / bold / fill / duotone; Bootstrap / fill; Material
  filled / outlined / round / sharp / two-tone; Octicons; Ionicons glyph / sharp; 6 badge styles (dot, ring, square,
  shield, hexagon, diamond); 5 logo marks; Tiles and Circles (every glyph on a backdrop, for app and plugin logos).
  Fixed colour: Twemoji emoji-style, badges traffic light, logo amber gem. Licences: ISC, MIT, Apache-2.0, CC-BY-4.0
  (Twemoji graphics, attributed in the pack); own art MIT.
- **Packs are assets:** a pack library with previews, per-skin default packs, import (validated) and export, sharing
  through axHub's shared icon-pack table, and Take from axHub.

## How each part is reached (page, REST, MCP, CLI, voice)
| Feature | Page | REST `/api/plugins/icon-map/…` (MCP `icon-map_*`, CLI `axf icon-map …`) | Console action | Voice |
| --- | --- | --- | --- | --- |
| Open | View → Icon map; `console_show view:icon-map` | — | `icon-map.open`, `icon-map.slot.open:<slot>` | "open the icon map" |
| Map / tree | Slots tab | `GET map`, `tree`, `slot/{id}`, `resolve`, `check` | `icon-map.refresh` | — |
| Change one slot | slot panel glyph grid | `PUT / DELETE slot/{id}` | `icon-map.slot.set` / `slot.clear` | "change the save icon to check circle" |
| Restore | slot panel, pack bar | `POST slot/{id}/restore`, `POST pack/restore` `{from: previous\|hub}` | `icon-map.slot.restore`, `pack.restore` | "restore the previous icon pack", "restore the icons from axhub" |
| Switch pack | Use / Use pack | `PUT / DELETE pack` | `icon-map.pack.use` / `pack.clear` | "switch to the duotone icon pack" |
| Template | Download template | `GET template?from=` · `node framework/cli/icon-map.mjs template` | `icon-map.template` | "download the icon pack template" |
| Import / export | Packs → Import and share, Export | `POST packs/import`, `GET packs/imported`, `DELETE packs/imported/{id}`, `GET packs/{id}/export` | `icon-map.pack.import` / `export` / `remove` | "export the lucide icon pack" |
| Per-skin defaults | Packs → Per-skin defaults | `GET skin-packs`, `PUT / DELETE skin-packs/{skin}` | `icon-map.skin.pack` / `skin.clear` | — |
| axHub sharing | Share, Read axHub, Take | `GET / PUT hub-packs` (the console's last read) | `icon-map.pack.share`, `hub.refresh`, `pack.fromhub` | "share the phosphor duotone icon pack" |

Other UI tools reach the map through the web service `axf.icon-map@1` (open, resolve, setSlot, usePack, packs, map).

## What broke on the way, and the fixes
- The console's baked framework copy never got s1's icon runtime, so the console typecheck failed on the s2 plugin.
  s3 baked the icon files in (lock hashes updated). Other framework drift was left for a normal re-bake.
- s2's sync cleared the skin's icon pack every 20 s whenever no pack was picked by hand. Fixed in s6.
- s2 hand-edited the voice fixture and never added the phrases to the generator. The generator now holds them, and
  the fixture is regenerated from it.

## Costs and limits
- Bundle: the packs add about 1.1 MB raw (265 KB gzipped) to each of the 4 apps that ship shared assets (they load eagerly).
- Fixed-colour packs draw a one-colour fallback until **s9 (Fable)** teaches icon-pack@1 colour layers.
- The 82 logo slots are brand marks (logo-mark assets via the branding package). Logo packs reach them only where a
  place draws an Icon with role app-logo / app-mark. Making BrandMark follow a logo pack is also in **s9**.
- Not shipped: Heroicons solid / mini and Iconoir solid. They mostly use even-odd fills, which the renderer can't draw.
  Glyphs a set lacks fall back to the framework glyph (3-42 per pack).
- Restore from axHub uses the icons axHub's look held when the console last loaded it, which the open console sends.
  With axHub sync off it answers 503 with the steps.
- Sharing uses the browser's axHub sign-in, and axHub's 64 KB file limit means Twemoji can't be shared that way.
- A removed imported pack stays drawable in an open console until it reloads.
- Kotlin twin deferred (Android on hold, PORTING.md row from s1).

## Tests
- `python3 apps/console-web/plugins/icon-map/test.py`: 63 route checks.
- `node apps/console-web/plugins/icon-map/test.mjs`: 7.
- `node framework/spec/check-icon-map.mjs`: 53.
- Console-control server tests: 8 (both voice twins replay the fixture).
- Also passing: check-icons, check-theme, check-controls, check-toolbars, check-chrome-assets, help coverage 100%,
  control inventory, shared-assets, `axf validate --framework` (578 assets), console `tsc --noEmit`, and spec checks
  (plugin-commands, plugin-catalog, conform, skin coverage / sections, refs, ui-review, card).
- Browser check: desktop and phone, the tree, the slot panel, a glyph click saved on the server, and a pack switch.

UI Review: the screens are waiting there (desktop and phone).
