# Settings open in the floating window: one entry point (settings-floating@1)

Build `settings-opened-banners-nav-menu` (Nov 17 2026). Brett: "When I click on like banners or whenever the settings
opens from on like the navigation menu or the toolbar, it doesn't open in the floating window. It opens in the main
area." Builds on #628 (`all-settings-interfaces-open-floating`, `core/engines/settingsopen.ts`): every settings
interface is a floating glass dialog; this contract makes every opener go through one door so none of them can land
in the main area.

## The door

`openSettingsFloating(rt, target)` in `framework/react/settingsFloating.ts` (exported from `framework/react`).

| Target | Dialog | Props |
|---|---|---|
| `{ kind: 'all' }` | `axf.settings.all` (the whole interface) | none |
| `{ kind: 'tab', tab }` | `axf.settings.tab` | `{ tab }` |
| `{ kind: 'chrome', type, instance? }` (tab group / toolbar / banner / nav menu / menu bar) | `axf.chrome.settings` | `{ type, instance }` |
| `{ kind: 'banner', id? }` | `axf.banners.settings` | `{ id }` |

Rules, in order:

1. **A host that takes settings** (embed@1): `all` / `tab` go to the host through `dispatch('app.settings')` /
   `dispatch('settings.open:<tab>')`. Result `{ via: 'host' }`.
2. **The Settings view is the screen on show** (only an old deep link can put it there now): a `tab` switches in place
   (`axf.settings.lastTab` + the `axf:settings-tab` event), nothing stacks over it. Result `{ via: 'page' }`.
3. **The whole-interface dialog is already up** and a `tab` is asked: the tab switches inside it and the dialog gets
   focus. Result `{ via: 'focused' }`.
4. **The same dialog with the same props is already up**: it gets focus, no second one. Result `{ via: 'focused' }`.
5. Otherwise `rt.openDialog(dialog, props)`. Result `{ via: 'dialog' }`.

On a phone the dialog host draws the dialog as the dialog style asset says (floating, sheet or drawer); the door does
nothing phone-specific. The pure parts live in the engine: `parseSettingsFloatingTarget`, `settingsFloatingDialog`,
`sameSettingsDialog`, `viewOpensSettings`.

## A view navigation to `settings` is an opening

`openView(rt, view)` is what a nav item, a nav tree item, a search hit, a Help related link, a waiting row and the
banner strip follower call instead of `rt.navigate(view)`: every view is a page except `settings`, which is
`openSettingsFloating(rt, { kind: 'all' })`. The core `nav:<view>` action does the same (`app.settings` when the settings
library is installed). Nav-menu assets keep `"view": "settings"`; the item is drawn like any other and marked active
only while the Settings page itself is on screen.

## Who calls it

| Opener | Through |
|---|---|
| `app.settings`, `settings.open[:tab]` (toolbars, menu bars, banner gears, plugin menu rows, console-control `view:settings`) | the settings library's `openSettings` → the door |
| Nav menu / nav tree Settings item, `nav:settings`, search "Settings" hit, Help related `view:settings`, waiting rows, banner strip | `openView` |
| Right-click / long-press `<Kind> settings…` (`chrome.settings:<type>:<instance>`), the "Assets with edits" gear | `openSettingsFloating(rt, { kind: 'chrome', … })` |
| Banner settings (`banners.settings[:id]`, the chrome dialog's Banner settings button) | `openSettingsFloating(rt, { kind: 'banner', … })` |
| REST / MCP / CLI / voice | action `settings.floating[:all | tab:<id> | <tab id> | chrome:<type>[:<instance>] | banner[:<id>]]`; state: console-control `state.dialog` |

## Checks

`framework/spec/check-settings-open.mts`: the source guard also fails a view navigation reached with a variable
outside `openView`, and nav-menu assets are allowed `"view": "settings"` only because the nav components route it.
`apps/console-web/scripts/settings-open.e2e.mjs`: the nav menu's Settings item opens the dialog, a second press keeps
one dialog, a banner gear after it stays floating.

## Ports

Web only. Kotlin: `lib-settings` opening its screen as a dialog from every nav / toolbar / banner entry is the same
deferred gap as #628 (PORTING.md).
