# Banner widget shapes: more than circle and pill, all token-driven

Build `banner-widget-shapes-more-than-circle` · branch `claude/banner-widget-shapes-more-than-circle` · PR #703.
Phase 1 (Fable, s1–s7): shape@1 contract, validator twins, engine, resolve chain, fixtures. Phase 2 (Opus, this
session): s28 and s8–s27.

## What was added

- **Change icon… on any banner / toolbar widget (s28, Brett Nov 16).** Right-click / long-press menu and widget
  settings → icon picker (framework icons + every icon-pack glyph, searchable). Saved per instance as an override
  (`axf.banners.icons.<app>`, `core/engines/widgeticons.ts`), laid over the asset's icon; the asset is never changed.
- **Starter shapes (s8):** circle, pill, rounded-square, square, squircle, hexagon, diamond, tag, leaf (corners
  example), star (mask example), each described.
- **Defaults (s9):** every banner asset has `shape { icon: circle, chip: pill }`; every skin names `assets.shape: pill`.
  Nothing changes visually until a shape is picked.
- **Runtime (s10):** chain widget → app → skin → global → banner default (`rt.resolveShape`), `rt.setShape` /
  `rt.restoreShape` with edit history; global and skin levels under `axf.tokens.shape.*` (shared document, every app);
  `--fx-shape-widget-*` in the known token set. The chain and history moved to `core/engines/shape-scope.mjs` so the
  CLI shares them (fixtures unchanged).
- **CSS (s11):** banner chips read radius + clip + mask + corner + aspect tokens; focus ring on the unclipped item,
  hover tint inside the shape. theme-swap later caught the ⋯ button keeping 2px: fixed.
- **React (s12–s17):** per-item `data-fx-shape` + inline tokens for a per-widget pick; `ShapePicker` (previews of every
  shape, per-corner sliders, SVG paste / upload with the validator's errors); Shape tab in the banner's right-click
  settings (chrome-banner + every app copy) and a Shape field per widget; Theme manager → Shapes (skin level + per
  widget); UI manager view (every widget, its shape and source, inline edit, restore); Settings → Appearance → Banner
  widget shape (hub-wide) plus the `axf.tokens.shape.global` settings key at level simple.
- **API (s18–s22):** control@1 `tokens.shape` (appended last); theme-manager REST; plugin commands; console actions;
  `framework/cli/shapes.mjs` + `axf shape`; voice phrases (JS engine + Python twin + fixture).
- **Bake (s23):** console re-baked (the baked `libs/hub/veto.ts` held an overlay API never moved into the framework:
  moved first); shared assets baked into console, axHub web, AmberX, Molly.

## API reach per feature

| Feature | Deep link | State | Actions |
|---|---|---|---|
| Widget shape (any level) | `console_show` view `ui-manager`; actions `theme-manager.shapes`, `shape.pick[:<widget>]`; Settings → Appearance | REST `GET /api/plugins/theme-manager/shapes[?app=]`, `GET /shapes/resolve?app=&widget=`; MCP `theme-manager/shape-list`, `shape-get`, control@1 `get tokens.shape <path>`; CLI `axf shape get|resolve` | REST `PUT /shapes/{global|skin|app|widget}`, `POST /shapes/{scope}/restore-previous`, `POST /shapes/assets`; MCP `shape-set`, `shape-restore`, `shape-add`, control@1 `set|reset tokens.shape`; console actions `shape.set`, `shape.restore`, `shape.pick`; CLI `axf shape set|restore|add`; voice "make the banner widgets hexagons [everywhere]", "make the clock widget a squircle", "undo the shape change" |
| Widget icon | action `widget.icon.pick:<host>:<widget>` (opens the picker) | setting `axf.banners.icons.<app>` (console-control `state`) | action `widget.icon:<host>:<widget>:<icon|reset>` via REST `/api/console-control` press `function:widget.icon`, MCP console tools, `axf console action widget.icon banner clock star`, voice "change the clock icon to star", "reset the clock icon" |

## Checks (all green on the branch)

check-shape (405), check-control (396, 25 targets), check-shapes-cli (20), theme-manager `test_shapes.py` (32) and
`test.py` (36), token-control (21), check-theme, check-controls, check-chrome-assets, check-toolbars, chrome-settings,
shared-assets, check-console-control, check-banner-widgets, check-skin-coverage, check-skin (357), check-widgets (278),
`axf validate --framework` (550 assets), framework + console typecheck, voice fixture replayed against the Python twin.

theme-swap on the built console: colours follow (0 stuck); the new shape pass: every banner chip follows all 10 shapes
at desktop (10/10) and phone (3/3). Still red there, not from this build: "transparency tokens did not change between
style themes": in skins-only mode a style-theme swap is refused, so the style pass sees one value set.

## UI Review hold

Item `r-20261116-h9nkg01` (group "Banner widget shapes: more than circle and pill"): 3 options shipped as shape
assets in `apps/console-web/plugins/theme-manager/assets/shape/` (soft squircle, hex badges, label tags). Written to
the live console's data folder (no console URL / token in the session). Check shots (every shape at desktop and phone,
the touch long-press menu and widget Shape settings) are in UI Review → Screenshots and in
`_claude/builds/reports/banner-widget-shapes-more-than-circle/shots/`.

## Gaps and notes

- **Android:** Kotlin twin of shape@1, shape-scope and widget icons deferred (`framework/spec/PORTING.md`).
- **Skins beat global:** every starter skin names `assets.shape: pill`, so with a skin on, the hub-wide pick shows only
  after the skin's own shape is cleared in Theme manager → Shapes. By design (child overrides parent), but worth a look.
- **UI manager:** none existed; its first section (banner widget shapes) is a view hosted by the theme manager plugin,
  built from framework components so it moves to a dedicated plugin without a rewrite.
- **Other apps' runtime:** axHub web, AmberX and Molly carry hand edits in their baked framework (`rebake.mjs status` =
  edited); this build re-baked their shared assets only. Their runtimes pick up shapes and Change icon… at their next
  clean re-bake.
- Hub-added shapes are registered by the console (theme manager loads `/shapes/assets`); other apps see them after
  they read the same route.
- MCP command ids use dashes (`shape-list` …): plugin-commands@1 refuses underscores.
