# Banner widgets

Right-click or long-press the top banner and pick **Widgets…** to choose what sits on it, in what order and how much room each piece takes.

- **Widgets…** lists every widget: tick to show, drag or use the arrows to reorder, with a live preview. It also lists the banners under the bar. It opens from the banner, Banner settings and View → Banner widgets.
- **Widget settings** (right-click a widget, or the gear in the picker): size (icon only, compact, normal, wide), what it shows, max width in pixels or characters, hide when empty, may it move into `⋯`, priority, region.
- **Overflow:** when the bar runs out of room the lowest-priority widgets move into `⋯`, and come back when there is room. Priority 1 goes first. Widgets with *Move into the ⋯ menu* off stay.
- **Saved** per app and per form factor (phone or computer) in `axf.banners.widgets.<app>.<phone|desktop>`, a look setting that syncs through axHub. Region and order stay in the host arrangement (`axf.widgets.arrange.banner`), shared with arrange mode. **Reset to default** clears both.

## Skins

Right-click the banner → **Skins**: every skin in the app, the one in force ticked; a pick applies it live (`skin.use:<id>`), plus **Skin off** and **Skin picker…**. The **Skins** widget (a chip that opens the skin picker) is hidden by default: tick it in **Widgets…**, or run `banner.widget:skins:show` (API / MCP `console_action("banner.widget", ["skins", "show"])`, CLI `console.mjs action banner.widget skins show`, voice "show the skins widget"). `skin.use:next` / `skin.use:prev` step through the skins.

## Shapes (shape@1)

Brett, Nov 14 2026: "banner widgets can only be circles or pills." The shape a chip-like widget is cut to is now an asset
of type `shape` (`framework/assets/shape/`, rules in `core/engines/shape-rules.mjs`, engine `core/engines/shape.ts`,
fixtures `spec/fixtures/shape.json` + `shape-validate.json`, check `spec/check-shape.mts`). Kinds: `circle`, `pill`,
`rounded`, `square`, `squircle` (a superellipse), `hexagon`, `diamond`, `tag`, `corners` (a radius step per corner,
`corners: { tl, tr, br, bl }` in `none | sm | md | lg | pill`; `corners` may also override any other kind) and `mask`
(closed SVG path data `M … Z` in its own `viewBox`, default `0 0 100 100`; no script, no url() / links / images).
Radius steps are the style theme's `--fx-radius-*` tokens, never lengths, so a shape follows the skin's corners.

The active shape compiles per **slot** (`compileShape(shape, slot)`; the one slot today is `widget`, every chip-like
banner widget) to tokens on the root (`runtime.compileStyles`). The stylesheet reads only these:

| Token | What |
| --- | --- |
| `--fx-shape-widget-radius` | four corner radii in CSS order, always four values (tokens, `0` or `999px`) |
| `--fx-shape-widget-clip` | a clip-path polygon in percentages for hexagon, diamond and tag, else `none` |
| `--fx-shape-widget-mask` | a mask-image `url("data:image/svg+xml,…")` for squircle and mask, stretched over the chip, else `none` |
| `--fx-shape-widget-corner` | `round`, or `squircle` where CSS corner-shape is drawn |
| `--fx-shape-widget-aspect` | `1` when the shape keeps a square box (circle, diamond, hexagon), else `auto` |
| `data-fx-shape-widget` | the kind, on the root |

Clip and mask never both cut; radius + clip + mask together describe every kind. A widget with its own shape gets the
same five tokens inline (`shapeInlineVars(shape, 'widget')`).

**Default = today's look.** The `pill` starter (`framework/defaults.json`) and "no shape asset at all" both compile to
`999px 999px 999px 999px`, no clip and no mask: the circle every square widget drew and the pill every wide one drew before.

Four levels, resolved by `resolveShape` / `resolveShapeAt` (`core/engines/shape.ts`, the model of `resolveLookSkin`: the
chain runs from the leaf and the first level that names a shape decides, the child overriding the parent): the
**widget** (setting `axf.banner.widget.<type:id>.shape` = `BannerWidgetPref.shape`, a shape asset id, folded into
`BannerWidgetView.shape`; `''` = inherit; the hint may set a default, `widget: { shape: 'tag' }`), the app's **slot**
(Appearance → Assets → Widget shape, `swap:shape:<id>`), the **skin** (`assets.shape` in a skin@1; the registry declares
`skin: { by: slot }`), and the **hub** (setting `axf.shape`). Nothing anywhere = `pill`. Every edit at a level is
recorded per key (`recordShapeEdit`: the previous and the current id) so **Restore previous edit** (`restorePreviousShape`)
puts the last value back and is itself restorable; the history is plain data saved with the settings (`normalizeShapeHistory`,
100 keys at most). Golden outputs: `spec/fixtures/shape-engine.json`.

Every chip the shape cuts carries the class **`fx-shaped`** (phase 2 adds it alongside the rules below), which is the
`shape` style target in `schemas/customize.json`: a skin's `parts.shape` and the slot's Customize panel style those chips'
box, text and icon in one go, and `check-skin-coverage` reads the type as slot + parts.

Where the shape was hard-coded before (phase 2 wires each of these to the tokens and adds `fx-shaped`; `framework/ui/axf.css` unless noted):

| Widget | Rule | Was |
| --- | --- | --- |
| badge (pill / icon / dot) | `.fx-banner__badge`, `.fx-banner__dot` | `border-radius: 999px`; `BadgeData.shape` picks pill / icon / dot (`react/components/Banner.tsx`) |
| counter | `.fx-widget-counter__num` | `999px` |
| status dot | `.fx-widget-status__dot` | `999px` |
| progress bar + fill | `.fx-widget-progress__bar`, `__fill` | `999px` |
| avatar | `.fx-widget-avatar.is-circle` / `.is-rounded` | `999px` / `var(--fx-radius-sm)`; `AvatarData.shape` circle / rounded (`react/components/Widgets.tsx`) |
| agent avatar | `.fx-agent-avatar.is-circle` / `.is-rounded` | same, from the `agent-avatar` asset (`react/components/AgentAvatar.tsx`) |
| theme switch | `.fx-widget-theme` | `999px` |
| action button | `.fx-widget-button` → `fx-btn` | the button asset's `--fx-btn-radius` (`core/engines/components.ts`) |
| ⋯ overflow button | `.fx-banner__more-btn` → `fx-iconbtn` | `999px` (`.fx-iconbtn`) |
| chips in the skin picker | `.fx-chip` | `--fx-size-chip-radius` (sizing@1 `chip.radius`) |

## For plugins

Every chip goes through `rt.attachToBanner`, which is the one registry. It then appears in the picker by itself. Add a hint so it has a good name and default:

```ts
rt.attachToBanner({ type: 'status', id: 'usage', at: 'right', order: 26, origin: ID,
  widget: { label: 'Usage meter', size: 'compact', priority: 5, aliases: ['usage'] } });
```

Hint fields: `label`, `icon`, `size`, `show`, `priority`, `hideWhenEmpty`, `overflow`, `hidden`, `aliases`, `shape` (a shape@1 asset id). `node framework/cli/check-banner-widgets.mjs` fails CI on a chip hard-coded into the banner and warns on a call with no hint.

## API, MCP, CLI, voice

Console action `banner.widget:<name>:<hide|show|reset|icon|compact|normal|wide>`, where the name is what you'd say ("clock", "ticker"). `banner.widgets` opens the picker, `banner.widgets.reset` resets.

CLI: `console.mjs action banner.widget clock hide` (the Console commands plugin).

MCP: `console_action("banner.widget", ["ticker", "compact"])`. Voice goes through the same tool.

Rules: `framework/core/engines/bannerwidgets.ts`, checks in `framework/spec/check-widgets.mts`. Runtime: `rt.bannerWidgets()`, `rt.setBannerWidget(key, patch)`, `rt.resetBannerWidgets()`. UI: `framework/react/components/BannerWidgets.tsx`.
