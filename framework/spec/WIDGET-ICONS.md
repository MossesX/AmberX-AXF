# WIDGET-ICONS — widget-icons@1, an icon and a display mode for every banner and settings widget

Status: contract since Nov 17 2026 (build `icon-picker-every-banner-settings-widget`, Fable phase 1).
Reference: `framework/core/engines/widget-icons.ts` (pure: ids, keys, refs, the resolver, the long-text detector).
Fixture: `framework/spec/fixtures/widget-icons.json`, replayed by `framework/spec/check-widget-icons.mts` (CI).
Token: `--fx-size-widget-text-max` (sizing@1 `widget.textMax`, `framework/core/engines/scale-rules.mjs`).
Kotlin twin deferred (Android on hold, PORTING.md).

## Why

Brett (Nov 17 2026): "allows me to select icons for all the widgets in the banner; some don't even have icons, just big
long strings of text; and the settings too."

Today a banner widget draws whatever icon its module attached it with, and a widget that came without one draws its
text, however long. Settings tabs, groups and rows are the same: a label, sometimes an icon, never a choice. This
contract gives every such widget one place where the person picks its icon and how it is drawn, and one rule that turns
a long string of text into an icon with the text as a tooltip.

## The widget id

Every widget this contract reaches has an id of three parts, `<host>:<kind>:<id>`:

| Host | Kind | Id | Example |
|---|---|---|---|
| `banner` | the widget's asset type (`status`, `counter`, `action-button`, `label`, `link`, `badge`, `clock`, …) | the asset id | `banner:status:usage` |
| `toolbar` | the widget's asset type (reserved for toolbar widgets, build `attach-widgets-to-any-toolbar-banner`) | the asset id | `toolbar:action-button:build` |
| `settings` | `tab`, `group` or `setting` | the tab id, the group id or the setting key | `settings:setting:axf.display.fontScale` |

For a banner widget the kind and id are the banner widget key (`<type>:<id>`, `engines/bannerwidgets.ts`), so the
Widgets picker, the banner's own settings and this contract name one widget the same way.

Rules (`parseWidgetIconId`, `WIDGET_ICON_ID`):

- host `[a-z0-9-]{1,40}`, kind `[a-z0-9-]{1,40}`, id `[A-Za-z0-9._-]{1,80}`; exactly two colons.
- The host must be registered: `WIDGET_ICON_HOSTS` is `banner`, `toolbar`, `settings`, append-only;
  `registerWidgetIconHost(host)` opens a new one (a plugin host, a nav rail). Kinds are open.
- Anything else is not a widget id: the setting is ignored, never a crash.

## The settings

Two keys per widget, both appearance settings (prefix `axf.widget.` in `engines/designpackage.ts`), so they live in
the app's look document on axHub and reach every device of that app:

| Key | Value | Meaning |
|---|---|---|
| `axf.widget.<widgetId>.icon` | an icon ref (below) or `own` | the icon the person picked; `own` or unset = the widget's own |
| `axf.widget.<widgetId>.mode` | `icon`, `icon+text` or `text` | how it is drawn; unset = `auto` (the rule below decides) |

`widgetIconKey(id)` and `widgetModeKey(id)` build them; `widgetIconSettings(get, id, token)` reads both plus the
threshold token into the `settings` argument of the resolver. A value that does not parse is dropped and named in the
resolution's `fell` list; the next source in the chain applies.

## Icon refs

| Form | Meaning |
|---|---|
| `<glyph>` | a glyph name; drawn through the icon pack in force when it has it, else the framework's own set |
| `<pack>/<glyph>` | that glyph of that icon-pack asset, whichever pack is in force |
| `pack:<pack>/<glyph>` | the same written with the icon-map@1 prefix; normalized to `<pack>/<glyph>` |
| `own` | the widget's own icon (clears a pick) |

glyph `[a-z0-9][a-z0-9._-]{0,63}`, pack `[a-z0-9][a-z0-9-]{1,47}` (the icon-pack asset id grammar). `parseIconRef`
returns `{ pack, glyph }` or null. A ref only resolves when the glyph exists: in the named pack, else in the pack in force
or the framework set. An unknown pack, or a glyph the pack lacks, is refused and reported, never drawn as a box.

## The resolution chain

`resolveWidgetIcon(widget, settings, iconMap)` → `{ icon, via, label, tooltip, mode, fell }`.

`widget` is what the host knows: `id`, `kind`, `text` (the words it shows right now), `icon` (its own icon hint),
`iconOverride` (widget-shape@1 `{ pack, id }`, when the shapes build is in), `slot` (its icon-map@1 slot id, when its
owner declared one), `tooltip` (its own), `defaultMode` (the host's own display setting: a banner widget's `show`
folds to it as `both` → `icon+text`, `icon` → `icon`, `text` / `number` → `text`, `auto` → `auto`).

`iconMap` is the icon world as the runtime sees it, shaped so that icon-map@1 (`engines/icon-map-rules.mjs`, branch
`icon-map-icon-packs-every-icon-badge-app`) plugs straight in: `glyphs` (the framework glyph names), `packs` (icon-pack
id → the glyph names it holds), `pack` (the pack in force at this scope, `axf.icons.pack.<scope>`), `slots` (icon-map
slot id → the pinned ref), `fallback` (what an unknown glyph draws; the framework's is `box`).

The icon is the first of these that resolves, in this order; `via` says which:

| `via` | Source |
|---|---|
| `pick` | `axf.widget.<id>.icon` |
| `override` | widget-shape@1 `iconOverride` folded as `<pack>/<glyph>` (the shapes build's `icon=<pack>/<glyph>` action writes the pick key from now on, so the two never disagree) |
| `slot` | the icon-map@1 pin for the widget's slot |
| `own` | the widget's own icon hint, when the pack in force or the framework knows it |
| `kind` | the default for its kind (`WIDGET_KIND_ICONS`: status → `info`, counter → `chart`, action-button → `zap`, link → `external`, label → `type`, badge → `bell`, tab → `folder`, group → `list`, setting → `sliders`, …; `registerWidgetKindIcon` adds one) |
| `fallback` | `iconMap.fallback`, else `box` |

So a widget never has no icon: a text-only widget gets its kind's icon, and the person can replace it with any glyph
of any pack. Every refused input (a bad ref, a missing pack, an unknown own icon) is a line in `fell`.

## Long text

`--fx-size-widget-text-max` (sizing@1 `widget.textMax`, default 24, 6 to 80) is the most characters a widget shows as
text. The host reads the token's value and passes it as `settings.textMax`; `longTextThreshold(value)` turns `24`,
`"24"` or `"24ch"` into the number and clamps it into range, anything else is the default. `isLongText(text, max)` is
true when the text, trimmed with its whitespace collapsed, is longer than `max` code points.

Mode (`WIDGET_ICON_MODES`: `icon`, `icon+text`, `text`; the pick, else the host's `defaultMode`, else `auto`):

| Picked | Text | `mode` | `label` | `tooltip` |
|---|---|---|---|---|
| `auto` | empty | `icon` | `` | the widget's own, else `` |
| `auto` | short | `icon+text` | the text | the widget's own, else `` |
| `auto` | long | `icon` | `` | the text |
| `icon` | any | `icon` | `` | the text, else the widget's own |
| `icon+text` | short | `icon+text` | the text | the widget's own, else `` |
| `icon+text` | long | `icon+text` | the text | the text (the host clips it to its width cap) |
| `text` | short | `text` | the text | the widget's own, else `` |
| `text` | long | `text` | the text | the text |

`label` is the collapsed text; the host draws it under its own width cap. `tooltip` is what the hover / long-press shows;
it is the full text whenever the text is hidden or clipped, so nothing the widget says is ever lost.

## What a host does with it

- Banner (`Banner.tsx`): for every attached widget, `resolveWidgetIcon` with the banner widget key, the hint's icon, the
  widget's current text and `show`; draws `icon` through `Icon` (a `<pack>/<glyph>` ref draws that pack's glyph), the
  label when the mode has text, and `tooltip` as the title. The `--fx-widget-icon` token of widget-shape@1 takes the
  resolved ref.
- Settings (`libs/settings`): tabs, groups and rows resolve with `settings:tab:<id>`, `settings:group:<id>`,
  `settings:setting:<key>`; a long tab label becomes its icon with the label as the tooltip.
- Every host reads the two keys live, so a change in the picker, by API or by voice redraws at once.

## API, MCP, CLI, voice (built in phase 2, Nov 17 2026)

Every action and setting of the picker is reachable without the UI, all on the same code:

| Channel | How |
|---|---|
| UI | right-click / long-press a banner widget, a Settings tab, sub-tab, group header or setting row → **Choose icon…** and **Show as**; Banner widgets dialog → each widget's **Choose icon…** and **Icon or text** |
| Deep link | dialog `axf.widget.icons` with `arg=<widget id>` (MCP `console_dialog("axf.widget.icons", arg="banner:status:project")`, REST `POST /api/console/dialog {id, arg}`, `POST /api/widget-icons/<id>/open`); action `widget.icons:<id>` |
| REST | `GET /api/widget-icons[?app=&q=]`, `GET /api/widget-icons/glyphs`, `GET/PUT/DELETE /api/widget-icons/<id>` (`{icon?, mode?, app?}`), `POST /api/widget-icons/reset` (`server/widget_icons.py`) |
| MCP | `widget_icons_list`, `widget_icons_get` (read-only), `widget_icons_set`, `widget_icons_reset` |
| control@1 | target `console.widgeticons` (list, get; act `set` `{icon?, mode?}`, `reset` (path `*` = all), `open`) |
| CLI | `axf widget-icon list|get|set|reset|glyphs|open` (`framework/cli/widget-icon.mjs`) |
| Console actions | `widget.icons[:<id>]`, `widget.icon:<id>:<ref|own>`, `widget.mode:<id>:<mode>`, `widget.icons.reset[:<id>]`, `widget.icon.set:<phrase>`, `widget.icon.reset[:<phrase|id>]` |
| Voice | "use the rocket icon for the project widget", "set the usage meter icon to star", "show the ticker as text", "reset the project widget icon", "reset all widget icons" (console `src/actions/widget-icon-voice.ts`, server twin `widget_icons.voice`, run before the console-control grammar) |

Server-side channels read and write the app's look document on axHub (`shared/settings/looks/<app>.json`,
`own.settings`), so they work with no console open and every device of the app follows. The inventory of every
widget and its default icon is `framework/schemas/widget-icon-defaults.json` (widget-icon-defaults@1,
`engines/widget-icon-defaults.ts`).

## Related builds

- `banner-widget-shapes-plus-change-icon` (Opus, in flight): widget-shape@1 `iconOverride` is read by this chain as
  `override`, under the pick key. Its action should write `axf.widget.<id>.icon` instead of the pref field.
- `icon-map-icon-packs-every-icon-badge-app` (Fable, built, not yet on main): `iconMap.slots` and the `pack:` prefix
  are its grammar; `resolveIcon` becomes the lookup behind `own` once it lands.
- `icon-packs-with-drag-drop-pack-designer`, `icon-browser-manager`: the picker lists their packs through `iconMap.packs`.
