# Banner widgets

Right-click or long-press the top banner and pick **Widgets…** to choose what sits on it, in what order and how much room each piece takes.

- **Widgets…** lists every widget: tick to show, drag or use the arrows to reorder, with a live preview. It also lists the banners under the bar. It opens from the banner, Banner settings and View → Banner widgets.
- **Widget settings** (right-click a widget, or the gear in the picker): size (icon only, compact, normal, wide), what it shows, max width in pixels or characters, hide when empty, may it move into `⋯`, priority, region.
- **Overflow:** when the bar runs out of room the lowest-priority widgets move into `⋯`, and come back when there is room. Priority 1 goes first. Widgets with *Move into the ⋯ menu* off stay.
- **Saved** per app and per form factor (phone or computer) in `axf.banners.widgets.<app>.<phone|desktop>`, a look setting that syncs through axHub. Region and order stay in the host arrangement (`axf.widgets.arrange.banner`), shared with arrange mode. **Reset to default** clears both.

## For plugins

Every chip goes through `rt.attachToBanner`, which is the one registry. It then appears in the picker by itself. Add a hint so it has a good name and default:

```ts
rt.attachToBanner({ type: 'status', id: 'usage', at: 'right', order: 26, origin: ID,
  widget: { label: 'Usage meter', size: 'compact', priority: 5, aliases: ['usage'] } });
```

Hint fields: `label`, `icon`, `size`, `show`, `priority`, `hideWhenEmpty`, `overflow`, `hidden`, `aliases`. `node framework/cli/check-banner-widgets.mjs` fails CI on a chip hard-coded into the banner and warns on a call with no hint.

## API, MCP, CLI, voice

Console action `banner.widget:<name>:<hide|show|reset|icon|compact|normal|wide>`, where the name is what you'd say ("clock", "ticker"). `banner.widgets` opens the picker, `banner.widgets.reset` resets.

```bash
node apps/console-web/plugins/console-commands/console.mjs action banner.widget clock hide
```

MCP: `console_action("banner.widget", ["ticker", "compact"])`. Voice goes through the same tool.

Rules: `framework/core/engines/bannerwidgets.ts`, checks in `framework/spec/check-widgets.mts`. Runtime: `rt.bannerWidgets()`, `rt.setBannerWidget(key, patch)`, `rt.resetBannerWidgets()`. UI: `framework/react/components/BannerWidgets.tsx`.
