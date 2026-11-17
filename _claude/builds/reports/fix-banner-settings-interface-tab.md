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
