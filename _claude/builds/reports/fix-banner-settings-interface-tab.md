# Fix: banner settings Interface tab changes the banner, not the settings window

Brett (Nov 17 2026): "why does the settings interface tab of the banner change just the interface of the settings itself? what's the point of that"

## s1 — trace (working note)

**Where:** right-click the banner → *Banner settings…* → action `chrome.settings:banner:app` → dialog
`axf.chrome.settings` → `ChromeSettingsPanel` (framework/react/components/ChromeContext.tsx). The dialog's tabs come
from `CHROME_SETTINGS_TABS` (look / behaviour / asset / interface), laid out by the settings asset
`settings/chrome-banner` (or the app's copy).

**The bug:** the Interface tab body is `body('interface') → <InterfacePicker type={type} />`. `InterfacePicker` takes
only the chrome *type*, never the instance, and every control in it writes the settings window's own keys:

| control | key written | what it changes |
|---|---|---|
| Settings interface (choice grid) | `axf.chrome.settings.banner` (CHROME_SETTINGS_PICK_KEY) | which settings asset the dialog renders through |
| Layout / Header / Search / Descriptions / Level toolbar / Hidden ids | `axf.chrome.settings.banner.patch` (CHROME_SETTINGS_PATCH_KEY) | the dialog's own layout |
| Reset custom to default | clears the patch | the dialog |

None of them touches `axf.chrome.banner.<id>` (the banner's per-instance override, CHROME_INSTANCE_KEY) or
`axf.chrome.banner.<id>.asset`. So every change on that tab restyles the settings window and leaves the banner alone,
which is exactly what Brett saw.

**Affected kinds:** the same `InterfacePicker` renders the Interface tab for every chrome kind, so all six are hit:
banner, toolbar, tab-group, nav-menu, app-menu, context-menu. DataGrid has no chrome settings dialog; its per-grid
look is component-tokens@1 (`axf.chrome.instance-tokens`, family `grid`) — checked in s8.

**What already works:** the banner reads its per-instance overrides (`rt.banner()` → `rt.chromeData('banner')`), and
`rt.styleSettingsKey()` includes `axf.chrome.<type>.app`, so a write to the app instance recompiles the style tokens
and re-renders the provider. The Look / Behaviour tabs already write the instance key correctly.

**Fix plan:** the Interface tab gets the instance (type + id) and edits that instance: every field of the kind
(look + behaviour, `axf.chrome.<type>.<id>`) and its asset pick (`.asset` for tab groups, the app slot otherwise).
The settings-window controls move out of the tab into a clearly labelled "This settings window" section beside the
existing "Settings interface for this one" picker, so they stay reachable but never pose as the banner's interface.

## s2–s4 — banner

- `framework/spec/check-chrome-interface-tab.mts` (jsdom) renders the real `axf.chrome.settings` dialog next to the
  chrome itself, opens Interface and presses every choice and switch on it. Before the fix: 5 failures (no controls
  for the banner). After: every press writes only `axf.chrome.banner.app`, the banner's data and drawn markup change at
  once, and the settings window's keys and resolved layout stay as they were.
- Fix: `InstanceInterfaceTab` (the instance's asset + every field, grouped Look / Behaviour, Reset) replaces
  `InterfacePicker` in the tab; the settings-window picker is `SettingsWindowPicker`, a fold above the tabs titled
  "This settings window (every banner)…".
- `Banner` subscribes to `axf.chrome.banner.app` (useBannerOverrides) on top of the runtime's settings bump; the
  app instance's key is already in `styleSettingsKey()`, so the tokens recompile in the same render.

## s5 — toolbars

The hotfix `claude/hotfix-toolbar-settings-still-change` (PR #673, landed Nov 14) made every toolbar renderer read
its override; its own diff past main is only its report. The Interface tab bug was the shared `InterfacePicker`, so
the s3 fix covers toolbars. Cases added: the app toolbar (`axf.chrome.toolbar.app`) and a page toolbar
(`axf.chrome.toolbar.data-grid-tools`, drawn by `AssetToolbar`). Found on the way: `baseDataOf` compared a page
toolbar's fields with the app toolbar asset, so a value equal to the app toolbar's was dropped instead of saved;
it now compares with the page toolbar's own asset.

## s6 — tab groups

Case `tab-group:demo.sections` (a real `TabGroup` drawn beside the dialog): every Interface control writes only
`axf.chrome.tab-group.demo.sections`, the row's data and markup change at once, and the row's own asset pick on the
same tab writes `axf.chrome.tab-group.demo.sections.asset`. The dialog's own tab row (`chrome.settings.tab-group`)
is a different instance and is left alone.
