# Icon Browser + Icon Manager (`icon-browser-manager`)

Build of Nov 7 2026, phase 1 on Fable (s1–s6), launched headless by Brett from the Build manager (agent Greenlight Gina).
Phase 2 (s7–s10) is pinned to Opus: this report is the hand-over. Branch `claude/icon-browser-manager`.

## What Brett said

Verbatim in the build's origin: `node framework/cli/build-origin.mjs get icon-browser-manager`. In short: an Icon
Browser plugin (a starter library of a couple thousand open-licensed icons as assets; tree / grid / list views,
categorized, sortable, filterable, searchable, thumbnails toggle; sources of any kind with per-type forms and secrets in
the secure store; packs by drag and drop between collapsible, floatable panes; selected icons into docked or floating
tab groups; save a pack as an icon-pack asset) and an Icon Manager (every UI and plugin has an icon map; list them by
app; open a map or a live preview and drop icons on it; Save / Apply; a global pack of every icon; inheritance root →
UI → plugin, child overrides; save changes as a new root or scoped pack; packs separate from design packs; switch
packs globally, Randomize, Generate cohesive packs). Rules: everything registry assets with API / MCP / CLI parity and
voice control; settings in categorized collapsible sections; at least 3 UI options to UI Review first.

## Built (s1–s6, Fable)

### Contracts (s1)
- **icon-map@1** (`framework/core/engines/iconmap-rules.mjs`, typings `.d.mts`, TS face `iconmap.ts`): a scope (app root,
  one UI / screen, one plugin), a pack applied to the whole scope, slot → ref overrides (`name`, `pack:<id>/<glyph>`,
  `none`), `extends`. Resolution most specific first: plugin → UI → app root → the branding's pack → the framework
  glyph; aliases followed (depth-capped); a child only states what it changes. Seeded `randomizeMap`, cohesive
  `generateCohesiveMap` over an open synonym table, `allIcons` (the global listing), `foldIconMap`, `explainIcons`.
- **icon-source@1**: an open registry of kinds (local, http, rest, mcp, ftp, sftp, gdrive, gphotos, dropbox, repo) with
  per-kind fields and auth modes; `auth.secretRef` only — any raw secret field (`password`, `token`, `apiKey`…) anywhere
  in the asset is refused by both validators.
- Wired into `asset-types.json` (before `uac-policy`), `core/types.ts`, `core/validate.ts`, `cli/build-engine.mjs`
  (validation + generated JSON Schema properties), `cli/app-assets.mjs` (dependency closure: packs a map names).
  Starters `framework/assets/icon-map/framework.json`, `icon-source/framework-library.json`. Fixture
  `spec/fixtures/icon-map.json`, check `spec/check-icon-map.mjs` (17 checks) in CI. PORTING row: Kotlin twin deferred.
- Glyphs gained an optional `evenodd` flag (brand-rules + `glyphSvg`) for solid sets whose holes need it.

### Icon library (s2)
- `framework/cli/icon-import.mjs`: `sets | fetch | build | convert <svg folder> | library --check`. Shapes become path
  commands only (circle, ellipse, rounded rect, line, polyline, polygon); Phosphor's 256 grid is scaled to 24; glyphs
  with a transform, a `<use>`, a mask, text or an image, or over 2000 characters, are skipped and counted. Tarballs are
  data: nothing in them is executed (Phosphor's metadata module is read as text).
- `framework/icon-library/` (icon-library@1): 7 sets, **11,701 glyphs in 71 icon-pack assets** (≤ 600 glyphs each,
  split by category where the set has them), a sidecar index per set (name → pack, category, tags) for search,
  `LICENSES.md` with every licence text, `index.json`. 4.6 MB under a 9 MB budget. CI: `icon-import.mjs library --check`.

| set | licence | glyphs | packs |
|---|---|---|---|
| Lucide 1.70 | ISC | 2,029 | 4 |
| Tabler Icons 3.50 (outline) | MIT | 5,203 | 42 (by category) |
| Feather 4.29 | MIT | 287 | 1 |
| Heroicons 2.2 outline / solid | MIT | 324 / 322 | 1 / 1 |
| Phosphor 2.1 (regular) | MIT | 1,509 | 18 (by category) |
| Bootstrap Icons 1.13 | MIT | 2,027 | 4 |

### Runtime (s3)
- `AxfRuntime.iconFor(name, scope)` resolves every icon through the maps in force, cached per state revision and
  invalidated on any settings change; `iconsUsed()` / `iconScopes()` note what each scope has shown; `iconMaps()`;
  `setIconSlot / setIconMap / setIconPack / resetIcons / randomizeIcons / generateIcons` behind `assets.swap`.
- Actions `icons.set | map | pack | reset | randomize | generate` (voice / MCP / CLI; spec form `ui.<view>`,
  `plugin.<id>`, `pack/<id>/<glyph>` because a spec splits on `:`).
- `axf.icons.*` are appearance settings (`designpackage.ts` PREFIXES), so the hub look carries every pick to every app.
- React: `IconScope` context; `Icon.tsx` draws the resolution (a pack glyph through `glyphSvg`, nothing for `none`);
  the AppShell scopes each view (`ui:<view>`), the plugin wrapper (`withPluginTheme`) scopes each plugin.
- `spec/check-iconmap-engine.mts` (8 checks: chain layers, resolution, lookup, index, envelope, appearance keys, a real
  runtime with the actions) in CI.

### Icon Browser plugin (s4–s6), `apps/console-web/plugins/icon-browser`
- **Server** (`/api/plugins/icon-browser/`): the library read-only (`/library`, `/search` across every set's sidecar
  with set / category / style / sort / paging, `/sets/<id>`, `/pack/<id>`), your packs (`/packs`), saved maps (`/maps`,
  listing the framework's and every app's shipped maps too), sources (`/sources`, raw secrets refused, `/test`), the
  secure store (`/secrets`: refs only on GET, `POST /secrets/<ref>` sets, never read back, 0600), `POST /import`
  (a local folder of SVGs → packs through `icon-import.mjs convert`), `/config`. Data only in its data folder.
  Self-test `test.py` (43 checks).
- **Browser page**: tree (sets → categories → icons, thumbnails toggle, double-click selects a branch, drag takes it),
  virtualised grid (tile size, names), list; search, set / category / style filters, sort; click / Ctrl / Shift
  selection; drag out as `icon-drag@1`; details pane (sizes 16–48, set, pack, category, licence, ref, tags, Copy ref,
  Add to pack, Open in a docked / floating tab group); Float the library.
- **Pack composer pane**: collapsible Container, drop zone (from the library, a tab group, another pane), shared draft
  store so a floated copy shows the same pack, name → id, Save as icon-pack asset (server + registered in the app at
  once, one grid per pack), Open in a tab group, Clear.
- **Tab groups**: `openIconGroup` through the window engine (`wm.openGroup` / `wm.openFloating`); an empty group shows a
  "+" tab that takes drops; tab bodies take drops; tabs move between groups and windows with the engine's own drag.
  Actions `icon-browser.open | manager | open-group | float | float-composer`.
- **Icon Manager page**: every UI with an icon map (this app's live scopes: root, each screen, each plugin; plus the maps
  the server knows for other apps), filterable by app, searchable; per-scope editor: pack applied, map picked, the
  inheritance chain, Randomize, Generate from one pack, Reset; **live preview** (the scope's icons through the real
  `IconScope`; drop onto one to pin it, Apply is immediate); Slots table (what each draws and why, drop to pin, Hide,
  Clear); Save as a root / scoped map asset (picks it, clears loose pins); Import a library pack into the app; the
  every-icon listing (the global pack).
- Settings → Plugins → Icon browser in four collapsible sections (Library view, Default filters, Panes and tab groups,
  Icon Manager). `help.json` for every control, menu entries (View → Look, Plugins), `plugin-commands@1` (11 reads,
  16 commands → REST / MCP / CLI), lifecycle scripts, model test (`test.mts`).

### Checks (all green at hand-over)
`check-icon-map.mjs`, `check-iconmap-engine.mts`, `icon-import.mjs library --check`, `axf.mjs validate --framework`,
`check-brand`, `check-appearance`, `check-design-language`, `check-roller`, `check-customize`, `check-interface`,
`check-help`, `check-theme`, `check-controls`, `check-chrome-assets`, `check-toolbars`, `check-plugin-pages`,
`plugin-lifecycle.mjs check icon-browser`, `plugin-commands.mjs check icon-browser`, `menu-reach.mts`,
`help-coverage.mjs --check`, `shared-assets.mjs check`, console / axHub web / AmberX typechecks (Molly's worktree lacks
`vite/client` types; same baked framework). `plugins.mjs --check` is red on main too (asset-browser plan item), not this build.

## Left (s7–s10, Opus)
- **s7 Sources UI**: per-kind forms from `iconSourceKinds()` (fields, auth modes), secret entry → `POST /secrets/<ref>`
  + `auth.secretRef`, Test connection, Import from a local source; `framework/schemas/icon-repos.json` (known online
  repositories with what each needs) shown under the `repo` kind. The server and contract are done; the forms are not.
- **s8 Icon maps for every app**: `framework/cli/icon-map.mjs scan | list | check` over the icon names each UI and
  plugin uses (console, plugins, axHub web, AmberX, Molly) → shipped `icon-map` assets per app; CI check.
- **s9 Polish**: help drafts if any, a second look at phone layouts, `rebake` after the last framework edit.
- **s10**: desktop + phone shots of at least 3 UI options (browser: tree / grid / list; manager: list + editor +
  preview) → UI Review (headless group name `icon-browser-manager - <date>`), this report, THREADS, PR ready.

## Gaps and notes
- Phosphor and Bootstrap are filled sets; 14 glyphs over the 2000-character cap and 1 with a transform were skipped
  (counted in `index.json` → `skipped`).
- The composer refuses mixed grids (16 vs 24) rather than scaling in the browser; `icon-import.mjs` scales on import.
- The live preview draws the scope's icons through the real resolution rather than embedding the whole screen.
- Other apps' maps are listed and editable as assets; their picks apply in that app (the hub look carries the settings
  keys; a saved map asset reaches an app when it ships it).
