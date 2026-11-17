# settings-opened-banners-nav-menu (Fable, phase 1)

## What Brett said (verbatim, Nov 17 2026)

> When I click on like banners or whenever the settings opens from on like the navigation menu or the toolbar, it doesn't open in the floating window. It opens in the main area.

Branch `claude/settings-opened-banners-nav-menu`.

## s1: the #628 floating window, and what still opens settings in the main area

### The floating window #628 added (PR #628, merge `2e73f739d`, build `all-settings-interfaces-open-floating`)

| Piece | Where |
|---|---|
| Route engine `settingsOpenRoute({ tab, view, hostTakes })` → `{ via: 'dialog', dialog }` or `{ via: 'page' }`. Page only when an embedding host takes settings (embed@1) or `view === 'settings'` (the Settings view is already up) | `framework/core/engines/settingsopen.ts` |
| Dialog ids `axf.settings.all` (whole interface) and `axf.settings.tab` (one tab, prop `tab`), both `surface: 'glass'`, `size: 'wide'` | `framework/core/engines/settingsopen.ts`, `framework/libs/settings/index.tsx` (`dialogs`) |
| Open function: the settings library's `openSettings(tab)` behind the actions `app.settings` and `settings.open[:tab]` (`rt.openDialog(r.dialog, { tab })`, else `rt.navigate('settings')`) | `framework/libs/settings/index.tsx` (`library.install`) |
| Dialog host: `data-fx-dialog-surface="glass"`, `data-fx-dialog-size="wide"`; phone sheet / drawer comes from the dialog style asset (`[data-fx-dialog='sheet']`) | `framework/react/components/Overlays.tsx`, `framework/ui/axf.css` |
| console-control `view:settings` opens through `app.settings` | `framework/react/controlTargets.ts` |
| CI: `framework/spec/check-settings-open.mts` (source guard on `navigate('settings')` / `nav:settings` literals in `.ts/.tsx/.mjs` only) | |

### Inventory: every chrome entry point and where it lands today

| # | Entry point | What it runs | Lands today | Why |
|---|---|---|---|---|
| 1 | **Nav menu → Settings item** (every nav-menu asset: `framework/assets/nav-menu/*.json` ×23 and `apps/console-web/src/assets/nav-menu/console-nav.json` carry `"view": "settings"`) | `NavMenu` in `framework/react/components/Chrome.tsx` → `rt.navigate(it.view)` | **Main area** | A nav item is a view link, not an action; the #628 guard only catches the literal `navigate('settings')`, not a view read from the asset |
| 2 | **Nav tree (nav-style@1) → Settings item**, incl. a group whose page is Settings | `NavTree.tsx` `pick()` → `rt.navigate(it.view)` | **Main area** | same |
| 3 | **`nav:settings` action** (any menu, toolbar, context menu, voice or deep link that names the view instead of `app.settings`) | `framework/core/runtime.ts` action `nav` → `this.navigate(view)` | **Main area** | the core action knows nothing of the settings route |
| 4 | **Search palette → the "Settings" view hit**, **Help → Related `view:settings`**, **PriorityTag waiting row with route `settings`**, **banner strip follower** (embedded frame) | `Search.tsx` `focusEntry` case `view`, `Help.tsx` related button, `PriorityTag.tsx` `go()`, `BannerStrip.tsx` follower → `rt.navigate(view)` | **Main area** | view navigation with a variable |
| 5 | **Every opener that runs `settings.open:<tab>` while the Settings view is up** (banner gears: systems check Fix, alerts bell, claude badge, main build status, push banner, session check-in, voice notes, project wizard, whats-shipped; plugin menu "Settings" rows in `plugins-menu`, `agent-manager`, `ai-assistant`, `console-terminal`, `systems-check`, `mcp-client`, …; toolbar / menu-bar assets `settings.open:appearance / account / plugins / about`; `chrome.edits`) | `settingsOpenRoute` → `via: 'page'` ("already on the Settings view") | **Main area** once #1–#4 put the Settings view there; the floating window otherwise | the "already on Settings" rule is meant for a dialog not to stack over the same settings, but after a nav click the person is on the page for the rest of the session, so every gear then switches a tab in the main area |
| 6 | **Toolbar / menu bar → Settings** (`app.settings` in `framework/assets/toolbar/*.json`, `framework/assets/menu-bar/*.json`, console `consoleSettingsMenu.ts`) | `app.settings` → `openSettings(undefined)` | Floating (`axf.settings.all`), main area under #5 | |
| 7 | **Right-click / long-press → `<Kind> settings…`** on banner, nav menu, toolbar, tab group, menu bar | `chrome.settings:<type>:<instance>` → `rt.openDialog('axf.chrome.settings')` | Floating dialog (glass by id) | no focus-if-open: a second Settings… replaces the first dialog's props without telling the person; no shared entry point with #6 |
| 8 | **Right-click banner → Banner settings**, chrome dialog Look tab → "Banner settings…" button | `banners.settings` / `rt.openDialog(BANNER_SETTINGS_DIALOG)` | Floating dialog | same as #7 |
| 9 | **Plugin settings gear reached from those menus** (plugins menu row "Settings", `plugin-manager.open:<folder>` → its settings tab) | `settings.open:<tab>` | Floating (`axf.settings.tab`), main area under #5 | |
| 10 | console-control `view:settings` (REST / MCP / CLI / voice) | `app.settings` | Floating | fixed by #628 |

So the main-area openings Brett sees are #1–#4 directly, and #5 as their consequence: the nav menu's Settings item
(and anything else that navigates to the `settings` view) puts the Settings page in the main area, and from then on
every banner gear, toolbar button and menu entry that runs `settings.open:<tab>` stays on that page.

## s2: one door, `openSettingsFloating(rt, target)`

| Piece | Where |
|---|---|
| Target model (pure): `SettingsFloatingTarget` = all / tab / chrome(type, instance) / banner(id); `parseSettingsFloatingTarget` (`all`, `tab:<id>`, bare tab id, `chrome:<type>[:<instance>]`, `banner[:<id>]`), `settingsFloatingDialog` (which dialog + props), `sameSettingsDialog` (same dialog already up), `viewOpensSettings`; the Settings view id, last-tab key, tab event and the chrome / banner dialog ids now live here | `framework/core/engines/settingsopen.ts` |
| The door: host takes settings → dispatch to the host; Settings view actually on screen → switch the tab in place; whole interface up + a tab → switch inside it and focus; same dialog up → focus; else `rt.openDialog`. `openView(rt, view)`: every view is a page except `settings`. `installSettingsFloating`: action `settings.floating[:<target>]` | `framework/react/settingsFloating.ts`, exported from `framework/react/index.ts`, installed by `AppShell` |
| Callers routed: settings library `openSettings` (so `app.settings` / `settings.open:<tab>` use the door), nav menu (`Chrome.tsx`, also its search box), nav tree, search palette view hits, Help related links, waiting rows (`PriorityTag`), banner strip follower, the core `nav:<view>` action (`nav:settings` → `app.settings`) | `framework/libs/settings/index.tsx`, `framework/react/components/{Chrome,NavTree,Search,Help,PriorityTag,BannerStrip}.tsx`, `framework/core/runtime.ts` |
| `CHROME_SETTINGS_DIALOG` / `BANNER_SETTINGS_DIALOG` read the engine's ids (no import cycle between the door and the dialogs) | `ChromeContext.tsx`, `BannerSettings.tsx` |
| Contract note + Android gap | `framework/spec/SETTINGS-FLOATING.md`, `framework/spec/PORTING.md` |
| Help entry `action:settings.floating`, status note on `cx.settings.opendialog` | `framework/assets/help/framework.json` (+ every app's baked copy, walkthrough-studio), `framework/catalog/status.json` |
| Baked copies (console, axHub web, AmberX web, Molly): the touched files copied where the app's copy matched the framework; the console's `core/runtime.ts` and `libs/settings/index.tsx` (already drifted) got the same diff applied | `apps/*/src/axf/…` |
| CI: `check-settings-open.mts` grew from 42 to 84 checks (target parsing, dialog maths, focus rule, every caller imports `openView` and no longer navigates to a variable view, the core nav action, the library through the door, every app ships the same door) | `framework/spec/check-settings-open.mts` |

Checks run: check-settings-open 84, check-theme, check-controls, check-console-control (CLI + spec 290), check-chrome-settings 304, check-embed 429, check-help 274, check-console-commands 101, validate --framework; console-web `tsc --noEmit` clean. `check-help-mode.mts` needs `jsdom`, which this worktree does not have (not related to this change).

### What s3 does with it

- s2: one entry point `openSettingsFloating(rt, target)` in `framework/react/settingsFloating.ts` (exported from
  `framework/react`): target = the whole interface, a settings tab, a chrome kind + instance, or a banner. It resolves
  the dialog through the #628 engine, focuses the dialog when the same target is already open instead of opening it
  again, and routes a view navigation to `settings` (nav menu, nav tree, `nav:settings`, search, help, waiting rows,
  banner strip) into the floating window. Contract note in `framework/spec/SETTINGS-FLOATING.md`; Kotlin twin a
  deferred gap in PORTING.md.
- s3: `chrome.settings` and the Banner settings button in `ChromeContext.tsx` go through it; the "already on the
  Settings view" rule only keeps the page when the Settings view is actually the screen on show (never after a nav
  click, since that no longer navigates); the CI source guard also catches nav-menu assets and view variables; the
  settings-open e2e gets a nav-menu case.
