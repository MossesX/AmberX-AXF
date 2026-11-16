# Banner widget shapes (shape@1) and widget icons

Build `banner-widget-shapes-more-than-circle` (Brett, Nov 14 2026: "banner widgets can only be circles or pills";
Nov 16 2026: change the icon of any banner / toolbar widget). PR #703.

## What it is

Every chip-like banner widget (badges, counters, status dots, the theme switch, avatars, the progress bar, the ⋯
button) is cut to a **shape asset** (`shape@1`, type `shape`). The look is token-driven: the shape engine compiles the
shape in force to `--fx-shape-widget-radius | -clip | -mask | -corner | -aspect`, and `framework/ui/axf.css` reads only
those (no px literals, no var fallbacks). Focus rings are drawn on the unclipped banner item; hover tints are fills
inside the shape.

Starters in `framework/assets/shape/`: circle, pill, rounded-square, square, squircle, hexagon, diamond, tag, leaf
(corners example), star (mask example). Custom shapes: a radius step per corner (`none | sm | md | lg | pill`, never
a length) or one closed SVG path (`M … Z`, commands and numbers only, at most 2000 characters).

## Where the shape comes from (child overrides parent)

| Level | Stored in | Picked in |
|---|---|---|
| widget (instance) | app look settings `axf.banners.widgets.<app>.<form>[<type:id>].shape` | widget settings → Shape, banner right-click → Settings → Shape, UI manager |
| app | the app's `shape` slot (`swap:shape:<id>`) | banner right-click → Settings → Shape |
| skin | `axf.tokens.shape.skin[<skin>]` over the skin's own `assets.shape` | Theme manager → Shapes |
| global | `axf.tokens.shape.global` (shared document, every app) | Settings → Appearance → Banner widget shape |
| banner default | banner asset `data.shape { icon: circle, chip: pill }` | the banner asset |

Every edit is recorded in `axf.tokens.shape.history`; **Restore previous edit** puts a level back (twice = the edit again).
Note: every starter skin names `assets.shape: pill`, so with a skin on, the global pick only shows once the skin's own
shape is cleared in Theme manager → Shapes (or a skin without a shape is used).

## Code

- Rules + validator: `framework/core/engines/shape-rules.mjs` (shared with the build engine)
- Chain + history: `framework/core/engines/shape-scope.mjs` (shared with the CLI); typed engine `shape.ts`
- Runtime: `rt.resolveShape(widget?)`, `rt.setShape(level, id, widget?)`, `rt.restoreShape(level, widget?)`
- React: `ShapePicker`, `ShapePreview`, `WidgetShapeField`, `BannerShapeSettings`, `BannerShapesManager`, dialog `axf.shape.pick`
- Hub writer: `framework/cli/shapes.mjs` (CLI, REST, control@1)

## API reach (all four the same)

| | Deep link | State | Actions |
|---|---|---|---|
| REST | — | `GET /api/plugins/theme-manager/shapes`, `/shapes/resolve?app=&widget=` | `PUT /shapes/{global|skin|app|widget}`, `POST /shapes/{scope}/restore-previous`, `POST /shapes/assets` |
| MCP | `console_show` → views `theme-manager`, `ui-manager`; actions `theme-manager.shapes`, `shape.pick:<widget>` | plugin commands `theme-manager/shape-list`, `shape-get`; control@1 `tokens.shape` get/list | `shape-set`, `shape-restore`, `shape-add`; control@1 `tokens.shape` set/reset (paths `global`, `skin/<id>`, `widget/<app>/<type:id>`); console actions `shape.set`, `shape.restore`, `shape.pick` |
| CLI | `axf console action shape.pick <widget>` | `axf shape list | get [<app>] | resolve <app> [--widget …]` | `axf shape set <id|inherit> --scope … [--app --skin --widget]`, `restore`, `add <id> --corners … | --mask "M … Z"` |
| Voice | "open the UI manager" | — | "make the banner widgets hexagons [everywhere]", "make the clock widget a squircle", "undo the shape change" |

## Widget icons (s28)

Right-click / long-press any banner or toolbar widget → **Change icon…** (also in the widget's settings) opens the icon
picker: the framework icons plus every glyph of every icon pack. The pick is a per-instance override
(`axf.banners.icons.<app>` = `{ "<host>/<type:id>": "<icon>" }`, `core/engines/widgeticons.ts`) laid over the asset's
own icon; Back to the widget's own icon clears it. API: action `widget.icon:<host>:<widget>:<icon|reset>` and
`widget.icon.pick:<host>:<widget>` (REST `/api/console-control` press `function:widget.icon`, MCP console tools,
`axf console action widget.icon banner clock star`, voice "change the clock icon to star", "reset the clock icon").

## Gaps

- Android / Kotlin twin of shape@1 and widget icons: deferred (Android on hold, `framework/spec/PORTING.md`).
- Shapes added on the hub are registered by the console (theme manager); other apps see them after their next
  re-bake or once they read `/shapes/assets` too.
- axhub-web, amberx-droid and molly carry hand edits in their baked framework (`rebake.mjs status` = edited), so this
  build re-baked only their shared assets; their runtime picks up shapes and icons at their next clean re-bake.
