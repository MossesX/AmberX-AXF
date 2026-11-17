# Icon picker for every banner and settings widget

Build `icon-picker-every-banner-settings-widget` · branch `claude/icon-picker-every-banner-settings-widget` · PR #820
Phase 1 (Fable, s1–s2): the widget-icons@1 contract, fixture, sizing token and resolver engine.
Phase 2 (Opus, s3–s12): inventory, picker, banner and settings wiring, every API channel, docs, shots, tests.

## What Brett asked for

> allows me to select icons for all the widgets in the banner; some don't even have icons, just big long strings of
> text; and the settings too

## What it does now

- **Every banner widget has an icon.** The 10 status widgets that drew text only (Project, Claude account, Build
  profile, Following Amber, What's new ticker, Main build status, Wake listener, Agent voice, axHub status, the clock)
  now get a fitting default icon (`framework/schemas/widget-icon-defaults.json`, 29 widgets inventoried).
- **Long text becomes an icon.** In automatic mode, text longer than `--fx-size-widget-text-max` (sizing token
  `widget.textMax`, 24 characters) is drawn as the icon alone; the full text moves to the tooltip and the accessible
  name. Icon + text caps the text at the token with an ellipsis.
- **Pick any icon for any widget.** Right-click (long-press on the phone) a banner widget, a Settings tab, sub-tab,
  group header or setting row → **Choose icon…** opens the picker (search, a grid per source: framework set then each
  icon pack, live preview, Show as, Reset to default). **Show as** on the same menu: icon only / icon and text / text
  only / automatic. The Banner widgets dialog has **Choose icon…** and **Icon or text** on every widget.
- **Settings too.** Settings tabs and every plugin sub-tab resolve their icon the same way; a long tab label turns into
  its icon with the label as tooltip. Groups draw the picked icon on their header; setting rows show one once picked.
- Picks are appearance settings (`axf.widget.<id>.icon` / `.mode`) in the app's look on axHub, so they follow to every
  device of the app. Icon pack glyphs work everywhere (`Icon` now draws `<pack>/<glyph>` refs).

## How each feature is reached

| Feature | UI | REST | MCP | CLI | Voice / console action |
|---|---|---|---|---|---|
| List widgets with icon, source, mode | picker opened with no widget | `GET /api/widget-icons[?app=&q=]` | `widget_icons_list` | `axf widget-icon list` | action `widget.icons` |
| One widget | picker | `GET /api/widget-icons/<id>` | `widget_icons_get` | `axf widget-icon get <id>` | — |
| Pick an icon | Choose icon… | `PUT /api/widget-icons/<id> {icon}` | `widget_icons_set(widget, icon)` | `axf widget-icon set <id> rocket` | "use the rocket icon for the project widget"; `widget.icon:<id>:<ref>`, `widget.icon.set:<phrase>` |
| Show as icon / icon+text / text / auto | Show as menu, Icon or text field | `PUT … {mode}` | `widget_icons_set(widget, mode=…)` | `axf widget-icon set <id> --mode text` | "show the ticker as text"; `widget.mode:<id>:<mode>` |
| Reset one / all | Reset to default | `DELETE /api/widget-icons/<id>`, `POST /api/widget-icons/reset` | `widget_icons_reset` | `axf widget-icon reset [<id>]` | "reset the project widget icon", "reset all widget icons"; `widget.icons.reset[:<id>]`, `widget.icon.reset` |
| Open the picker (deep link) | right-click | `POST /api/widget-icons/<id>/open` | `console_dialog("axf.widget.icons", arg="<id>")` | `axf widget-icon open <id>` | `widget.icons:<id>` |
| Picker layout | — | — | `console_action("widget.icons.layout", ["list"])` | `axf console action …` | `widget.icons.layout:<grid|list|compact>` |
| Glyph list | picker search | `GET /api/widget-icons/glyphs` | — | `axf widget-icon glyphs` | — |

control@1: target `console.widgeticons` (list, get; act `set` `{icon?, mode?}`, `reset` (path `*` = all), `open`),
appended last after main's `console.toolbars` (28 targets).

Server-side channels (REST, MCP, CLI, control@1, server voice) read and write the look document on axHub
(`shared/settings/looks/<app>.json`, `own.settings`), so they work with no console open. The deep link is a dialog
with an argument rather than a `dialog:` console-control address: console-control@1 has no dialog address kind, and
adding one is a contract change for a Fable phase.

## Files

- Engine and data: `framework/core/engines/widget-icons.ts` (phase 1), `framework/core/engines/widget-icon-defaults.ts`,
  `framework/schemas/widget-icon-defaults.json` (in `schemas/` instead of `assets/icon-map/` so it is baked into every
  app; icon-map is not an asset type yet)
- React: `framework/react/widgetIcons.tsx` (runtime helpers, actions, context menu), `components/IconPicker.tsx`,
  `components/Banner.tsx` (BannerWidgetBody), `components/BannerWidgets.tsx` (WidgetIconFields),
  `components/TabGroup.tsx` (iconOnly, widgetIcon), `components/Icon.tsx` (pack refs), `components/Overlays.tsx`
  (contextWidgetIcon), `libs/settings/index.tsx`, `ui/axf.css`
- Server: `apps/console-web/server/widget_icons.py` (+ `test_widget_icons.py`), `mcp_server.py`, `console_control_api.py`
  (voice first), console-commands host target
- CLI `framework/cli/widget-icon.mjs`; console voice `apps/console-web/src/actions/widget-icon-voice.ts`
- control@1 `framework/core/engines/control-rules.mjs` (+ snapshot, fixtures, CONTROL.md, check-control)
- Docs: `framework/spec/WIDGET-ICONS.md`, help `src/assets/help/console.json`, glossary `widget-icon`,
  `_claude/memory/docs/console-control.md`
- Shots: `apps/console-web/scripts/widget-icon-shots.mjs`

## Tests and checks

- `npx -y tsx framework/spec/check-widget-icons.mts`: 319 checks (contract, 34 resolution cases, the inventory)
- `python apps/console-web/server/test_widget_icons.py`: 108 checks (REST routes, look document writes, refusals, voice)
- `node framework/spec/check-widget-icons-parity.mjs`: 37 checks (every operation on REST, MCP, CLI, console actions,
  control@1; the CLI and the server write and resolve the same on one look document; console and server voice agree)
- `npx -y tsx framework/spec/check-control.mts`: 433 checks, 28 targets
- `python apps/console-web/server/test_mcp_tools.py`: 232 checks (annotations of the four new tools)
- console-commands server tests: 120 checks. This suite is timing-flaky on the VPS (2 of 3 runs passed; the failures
  were different delivery-timing asserts each time, not the new target)
- check-console-control, check-theme, check-controls, check-toolbars, check-chrome-assets: pass; console `tsc` clean,
  `npm run build` clean

## UI Review

Choices (ui-choices@1, asset type `dialog`, owner `ui-review`): picker **grid** (centred dialog, default), **list**
with names (side drawer), **compact** popover (small sheet). Each is live behind `widget.icons.layout`, so a pick
needs no code change. Before / after shots of the banner and Settings on desktop and phone are in UI Review →
Screenshots, group "Icon picker for every banner and settings widget".

## Decisions made without asking

- Dialog id is `axf.widget.icons` (the phase 1 contract), not `icon-picker` (the step text).
- A setting row shows an icon only once the person picks one, so Settings doesn't fill with identical default icons.
- Settings tabs use automatic mode (long label → icon); groups keep icon + text (they are headings).
- Voice phrases run before the console-control grammar, because "set the project widget icon to rocket" otherwise reads
  as "set <setting> to <value>". The shared console-control voice engine and fixture are unchanged.
- Fixed on the way: Plan Studio's banner button used a glyph that does not exist (`map`, drew a box); it is now `list`.
  The console's baked framework copy was behind and has been re-baked.

## Deferred

- Kotlin twin of widget-icons@1 (Android on hold, `framework/spec/PORTING.md`).
- A `dialog:` console-control address kind (needs a Fable contract change).
