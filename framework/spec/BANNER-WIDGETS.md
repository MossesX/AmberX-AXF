# Banner widgets

Right-click or long-press the top banner and pick **Widgets…** to choose what sits on it, in what order and how much room each piece takes.

- **Widgets…** lists every widget: tick to show, drag or use the arrows to reorder, with a live preview. It also lists the banners under the bar. It opens from the banner, Banner settings and View → Banner widgets.
- **Widget settings** (right-click a widget, or the gear in the picker): size (icon only, compact, normal, wide), what it shows, max width in pixels or characters, hide when empty, may it move into `⋯`, priority, region.
- **Overflow:** when the bar runs out of room the lowest-priority widgets move into `⋯`, and come back when there is room. Priority 1 goes first. Widgets with *Move into the ⋯ menu* off stay.
- **Saved** per app and per form factor (phone or computer) in `axf.banners.widgets.<app>.<phone|desktop>`, a look setting that syncs through axHub. Region and order stay in the host arrangement (`axf.widgets.arrange.banner`), shared with arrange mode. **Reset to default** clears both.

## Skins

Right-click the banner → **Skins**: every skin in the app, the one in force ticked; a pick applies it live (`skin.use:<id>`), plus **Skin off** and **Skin picker…**. The **Skins** widget (a chip that opens the skin picker) is hidden by default: tick it in **Widgets…**, or run `banner.widget:skins:show` (API / MCP `console_action("banner.widget", ["skins", "show"])`, CLI `console.mjs action banner.widget skins show`, voice "show the skins widget"). `skin.use:next` / `skin.use:prev` step through the skins.

## For plugins

Every chip goes through `rt.attachToBanner`, which is the one registry. It then appears in the picker by itself. Add a hint so it has a good name and default:

```ts
rt.attachToBanner({ type: 'status', id: 'usage', at: 'right', order: 26, origin: ID,
  widget: { label: 'Usage meter', size: 'compact', priority: 5, aliases: ['usage'] } });
```

Hint fields: `label`, `icon`, `size`, `show`, `priority`, `hideWhenEmpty`, `overflow`, `hidden`, `aliases`. `node framework/cli/check-banner-widgets.mjs` fails CI on a chip hard-coded into the banner and warns on a call with no hint.

## API, MCP, CLI, voice

Console action `banner.widget:<name>:<hide|show|reset|icon|compact|normal|wide>`, where the name is what you'd say ("clock", "ticker"). `banner.widgets` opens the picker, `banner.widgets.reset` resets.

CLI: `console.mjs action banner.widget clock hide` (the Console commands plugin).

MCP: `console_action("banner.widget", ["ticker", "compact"])`. Voice goes through the same tool.

Rules: `framework/core/engines/bannerwidgets.ts`, checks in `framework/spec/check-widgets.mts`. Runtime: `rt.bannerWidgets()`, `rt.setBannerWidget(key, patch)`, `rt.resetBannerWidgets()`. UI: `framework/react/components/BannerWidgets.tsx`.

## Widget hosts: toolbars (toolbar-widgets@1)

A toolbar is a widget host like the banner. Every toolbar on screen is one instance of the host, named by its chrome-settings id (`app` for the app's own toolbar, otherwise `data-axf-toolbar`, the asset id, or a slug of the aria-label). Reference engine: `framework/core/engines/toolbar-widgets.ts` with the plain-JS rules twin `toolbar-widget-rules.mjs`; golden fixture `framework/spec/fixtures/toolbar-widgets.json`; checks `check-widgets.mts` and `check-toolbar-widgets.mts`.

**Entry (`asset-types.json → hostEntry`, shared by `toolbar.widgets[]` and `banner.attach[]`):**

```
{ type, id, at, order?, widget?, shape? }
```

- `at` is the slot: `start` or `end` on a toolbar (`left | center | right` on the banner). Overflow is not a place a widget is put: the fit order below moves it there.
- `order` is the attach order within a slot, lowest first; a move renumbers the whole slot in steps of 10.
- `widget` is the banner widget style, the same registry the banner reads (`core/engines/bannerwidgets.ts`): `label`, `icon`, `size` (icon, compact, normal, wide), `show` (auto, both, icon, text, number), `priority` 1 to 9, `hideWhenEmpty`, `overflow`, `hidden`, `aliases`.
- `shape` is a shape@1 asset id. A host may carry `shape: { icon?, chip? }` as its default for icon-only widgets and for widgets with text.
- A toolbar asset with no `widgets` field is valid and resolves to an empty host. Nothing is migrated.

**One resolver for both hosts.** `resolveToolbarWidgets` runs each widget through `bannerWidgetView`, the function the banner uses, so a style or shape means the same on either host. Layers, lowest first: the asset's `widgets[]`, run-time attachments (`rt.attachToToolbar`), the legacy app-toolbar arrangement (`axf.widgets.arrange.toolbar`), the app style (`axf.toolbars.widgetStyle`), the toolbar style (`axf.toolbar.<id>.widgetStyle`), the person's slots (`axf.toolbar.<id>.widgets`). Each resolved widget carries the attributes the UI sets: `data-fx-wsize`, `data-fx-wshow`, `--fx-widget-cap`, `data-fx-shape`.

**Snap, never overlap.** `fitToolbar(plan, available)` is pure and returns placements; the CSS in `framework/ui/axf.css` follows the same order:

1. Each side is as wide as its widgets and buttons and never shrinks.
2. The flexible piece (the toolbar's groups or search area) gives way first, down to its minimum.
3. Still too wide: widgets that may overflow move into `⋯`, lowest priority first.
4. Still too wide: the host scrolls sideways and every item is a snap point.

**Reached through:** addresses `toolbar:<id>/widget:all` and `toolbar:<id>/widget:<type:id>` (CONSOLE-CONTROL.md); REST `GET /api/plugins/toolbar-widgets/widgets[?toolbar=]` and `POST …/attach | detach | move | style | open`; MCP `toolbar_widgets_*`; CLI `axf toolbar widgets list | attach | detach | move | style | open`; console actions `toolbar.widget.attach | detach | move | style`; AmberX voice ("attach the CPU widget to the settings toolbar"). Detach is destructive and needs `confirm`. Plugin marker: `axf-plugin:toolbar-widgets`.

The Kotlin twin is a deferred gap (PORTING.md).
