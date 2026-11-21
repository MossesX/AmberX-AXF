# Fix: banner settings Interface tab changes the banner, not the settings window

Brett (Nov 17 2026): "why does the settings interface tab of the banner change just the interface of the settings itself? what's the point of that"

## Result

Fixed for every kind. The Interface tab of any chrome Settings… dialog (banner, toolbar, tab group, nav menu,
application menu, context menu) now edits the chrome it was opened for: its asset and every look and behaviour
field, written to `axf.chrome.<type>.<id>` (`.asset` for a tab row's own pick), live. The settings window's own
layout picker moved out of the tab into a fold above the tabs titled "This settings window (every <kind>)…".
Grids never had the bug (no chrome dialog; their per-grid tokens already write only that grid's set).

Before: Interface showed the settings-window picker (writes `axf.chrome.settings.<type>` / `.custom.<type>`), so
the banner never changed. After: pick Accent on Interface and the banner across the top turns accent while the
dialog keeps its look (shots below).

Checks (all pass): `check-chrome-interface-tab.mts` (new, jsdom, 296), `check-chrome-settings.mts` (326, with the new
guard), `check-tab-group.mts` (445), `check-chrome-apply.mts` (174), `chrome-settings.mjs check`,
`check-chrome-assets.mjs`, `check-theme.mjs`, `check-controls.mjs`, `check-toolbars.mjs`, `check-console-control.mjs`,
`shared-assets.mjs check`; console `tsc --noEmit` and `npm run build`.

Clash check: `rebuild-every-toolbar-page-specific` (in progress, Fable) reworks page toolbars; main's page-toolbar
model (instance = the page's settings id) landed while this ran and is followed here (`baseDataOf` resolves a page
toolbar's own asset from its settings id). No pending item covers the Interface tab.

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
the s3 fix covers toolbars. Cases added: the app toolbar (`axf.chrome.toolbar.app`) and a page toolbar (after main's page-toolbar@1 landed:
a view-scoped asset drawn by `PageToolbar`, instance = the page's settings id `demo`, `axf.chrome.toolbar.demo`). Found on the way: `baseDataOf` compared a page
toolbar's fields with the app toolbar asset, so a value equal to the app toolbar's was dropped instead of saved;
it now compares with the page toolbar's own asset (the pick for its settings id, else the asset scoped to it).

## s6 — tab groups

Case `tab-group:demo.sections` (a real `TabGroup` drawn beside the dialog): every Interface control writes only
`axf.chrome.tab-group.demo.sections`, the row's data and markup change at once, and the row's own asset pick on the
same tab writes `axf.chrome.tab-group.demo.sections.asset`. The dialog's own tab row (`chrome.settings.tab-group`)
is a different instance and is left alone.

## s7 — nav menu, application menu, context menu

Cases `nav-menu:app` (drawn `NavMenu`), `app-menu:app` (drawn `MenuBar`) and `context-menu:app` (data the open menu
reads; it draws only while open). Every Interface control writes only `axf.chrome.<kind>.app`; nav and menu bar
redraw at once; the settings window is untouched. No code change needed past the s3 fix: all kinds shared the one
`InterfacePicker`.

## s8 — grids

`lib-datagrid` has no chrome Settings… dialog, so it never had the bug: a grid's own look is its component-tokens@1
set (`axf.tokens.instances`, family `grid`, keyed by the grid's id), edited through `InstanceTokensPanel` and the
`chrome.token:grid:<id>:…` action. Case `grid:demo.grid`: Set writes only that grid's entry, the grid's CSS vars
(`instanceTokenVars`) carry it at once, another grid and a tab row of the same id keep their values, and no settings
window key moves. A right-click Settings… for grids is a separate feature, not part of this fix.

## s9 — guard

`check-chrome-settings.mts` now fails when the dialog's Interface tab renders anything but `InstanceInterfaceTab`
for the instance it was opened for, when that component touches a settings-window key (pick, patch,
`chrome.interface:`), a raw `rt.settings.set/clear`, an action not addressed `${type}:${instance}`, or renders a
piece that isn't instance-bound. Proved by mutation: putting `InterfacePicker` back makes it fail. CI also runs the
DOM check `check-chrome-interface-tab.mts` (android.yml, next to the other jsdom checks).

## s10 — API

Each instance's Interface settings are console-control@1 targets, the same keys the tab writes:

| Surface | How |
|---|---|
| REST | `POST /api/console-control/do {verb:"set", address:"setting:chrome.banner.app.surface", value:"accent"}`; `GET /state?address=setting:chrome.banner.app.surface`; `value:"reset"` drops a field; `….asset` picks the asset (tab groups: that row only) |
| MCP | `console_control_do` / `console_control_state` with the same address; console actions `chrome.set:<type>:<id>:<field>:<value>`, `chrome.unset:…`, `chrome.reset:<type>:<id>`, `chrome.swap:<type>:<id>:<asset>` |
| CLI | `axf console chrome get|set|reset|open <type> <id> [key] [value]` (e.g. `axf console chrome set banner app surface accent`) |
| Voice | "set banner surface to accent" resolves through the console search (the targets are labelled "Banner · Surface") |
| Deep link | `console_show function:chrome.settings` with value `banner:app:interface`, or `open` on any `setting:chrome.…` address → the instance's Settings → Interface tab (`chrome.settings` takes a 4th part, the tab) |

Targets are derived (`addDerivedTargets` in controlTargets.ts): each kind's `app` instance, every instance with saved
settings, the tab rows on screen, and any instance a command names (so a row not on screen is still reachable).

## s11 — re-bake

Took main's `apps/console-web/src/axf` + `axf.lock.json`, then `rebake.mjs apply apps/console-web`. It refused at
first: main's baked `ui/axf.css` was byte-identical to `framework/ui/axf.css` but its lock hash was stale, so the
re-bake ran with `--force` (nothing lost). Console `tsc --noEmit` and `npm run build` pass.

## s12 — shots and UI Review

`apps/console-web/scripts/chrome-interface-shots.mjs` (vite preview of dist/, Playwright, APIs offline) opens each
instance's Settings → Interface through the deep link, shoots, presses one control on the tab, shoots again:

| Kind | Control pressed | Result |
|---|---|---|
| Banner (`banner:app`) | Surface → Accent | the banner across the top turns accent; the dialog keeps its look |
| Toolbar (`toolbar:app`) | Buttons → Icons + labels | the app toolbar shows labels |
| Tab group (`tab-group:settings.tabs`) | Show → Icons | `setting:chrome.tab-group.settings.tabs.display` reads `icons` |

Pictures in `fix-banner-settings-interface-tab/` next to this report, and in UI Review → Screenshots (group "Fix:
banner settings Interface tab changes the banner, not the settings window"). UI Review item `r-20261117-c12zx01`
carries 3 choices (settings assets in `plugins/ui-review/assets/settings/chrome-banner-interface-tab-*`):
all-in-one (built), interface-first (Look / Behaviour tabs hidden), one-list (list layout, no tabs).

Found on the way: the deep link opened the dialog on Look when the dialog host reused the panel; the panel now
follows a new `tab` prop as well as its first one.
