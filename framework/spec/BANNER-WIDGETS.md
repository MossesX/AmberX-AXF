# Banner widgets

Right-click or long-press the top banner and pick **Widgets…** to choose what sits on it, in what order and how much room each piece takes.

- **Widgets…** lists every widget: tick to show, drag or use the arrows to reorder, with a live preview. It also lists the banners under the bar. It opens from the banner, Banner settings and View → Banner widgets.
- **Widget settings** (right-click a widget, or the gear in the picker): size (icon only, compact, normal, wide), what it shows, max width in pixels or characters, hide when empty, may it move into `⋯`, priority, region.
- **Overflow:** when the bar runs out of room the lowest-priority widgets move into `⋯`, and come back when there is room. Priority 1 goes first. Widgets with *Move into the ⋯ menu* off stay.
- **Saved** per app and per form factor (phone or computer) in `axf.banners.widgets.<app>.<phone|desktop>`, a look setting that syncs through axHub. Region and order stay in the host arrangement (`axf.widgets.arrange.banner`), shared with arrange mode. **Reset to default** clears both.

## Skins

Right-click the banner → **Skins**: every skin in the app, the one in force ticked; a pick applies it live (`skin.use:<id>`), plus **Skin off** and **Skin picker…**. The **Skins** widget (a chip that opens the skin picker) is hidden by default: tick it in **Widgets…**, or run `banner.widget:skins:show` (API / MCP `console_action("banner.widget", ["skins", "show"])`, CLI `console.mjs action banner.widget skins show`, voice "show the skins widget"). `skin.use:next` / `skin.use:prev` step through the skins.

## Widgets on toolbars and tab rows

Every toolbar (the app's, a page's, a workspace's) and every tab row hosts the same widgets, from the same registry (Brett, Nov 13 2026: "I can attach widgets to the toolbar right, just like the banner widgets"). Right-click or long-press the bar → **Widgets…**: what is on it by side (Start / End), drag or arrows to reorder, the gear for the same settings a banner widget has, Remove (or Hide for a widget the bar or a plugin put there), and **Add a widget** with a search over every widget: status chips, counters, CPU / disk meters, account, clocks, search, logos, every chip a plugin attached to the banner. **Drag them on the toolbar** turns on arrange mode for that bar. Widgets that don't fit move into the bar's own `⋯`, lowest priority first, and come back when there is room.

- **Saved per bar:** `axf.widgets.on.<toolbar|tab-group>.<app>.<phone|desktop>.<instance>` (a look setting, syncs through axHub) holds what the person added and chose; order and side stay in `axf.widgets.arrange.<host id>`, where the host id is `toolbar` for the app toolbar, else `toolbar@<instance>` / `tab-group@<row id>`. The instance is the bar's settings id (the same one its chrome settings use): `app`, a page toolbar's asset id, `axf-ws-toolbar:<ws>`, a tab row's id. **Reset to default** clears both.
- **Chrome settings:** the picker's **Toolbar settings…** opens the bar's chrome settings (`chrome.settings:toolbar:<instance>`); the context menu offers both.

### API, MCP, CLI, voice

Console actions (`toolbar.*` for toolbars, `tabs.*` for tab rows; the instance is its id or words like "main", "settings"):

- `toolbar.widgets[:<instance>[:<key>]]` opens the picker (deep link: `console_action("toolbar.widgets", ["app"])`, CLI `console.mjs action toolbar.widgets app`).
- `toolbar.widget:[<instance>:]<name>:<op>` with op `add | remove | hide | show | reset | icon | compact | normal | wide | start | end`. "Add the CPU widget to the main toolbar" → `toolbar.widget:app:cpu:add`; MCP `console_action("toolbar.widget", ["app", "cpu", "add"])`; CLI `console.mjs action toolbar.widget app cpu add`. Two arguments mean the app toolbar (`toolbar.widget:cpu:add`); a key with a colon (`status:cpu`) needs the instance spelled out.
- `toolbar.widgets.reset[:<instance>]`, `widgets.arrange:toolbar@<instance>`, `widgets.reset:toolbar@<instance>`.
- State: `rt.hostWidgets(host, instance)` (every row: on the bar or addable), `rt.hostInstanceWidgets(host, instance)` (what is drawn), `rt.hostWidgetChoice(host, instance)`; the setting is readable through `console_settings` / `settings.set` like any other.

Rules: `framework/core/engines/hostwidgets.ts`; runtime `rt.addHostWidget / removeHostWidget / setHostWidget / resetHostWidgets / findHostWidget / resolveHostInstance`; UI `framework/react/components/HostWidgets.tsx` (`useHostWidgets` is what `Toolbar`, `AssetToolbar` and `TabGroup` draw with). Checks in `spec/check-widgets.mts`.

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
