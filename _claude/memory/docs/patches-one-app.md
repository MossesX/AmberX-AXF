# Patches as one app (suite mode)

Oct 24–25 2026, Opus, branch `claude/project-thread-vcxt2b`, pending item `patches-one-app` (Fable rebuild parked as
`patches-one-app-fable`, built only once Android work resumes). Brett asked for Patches and the apps in its tabs
(Console, Pilot, axHub, plugin tabs such as Todos) to work like **one professional app**. This replaces the Oct 24 rule
"Apps render whole in Patches". Interactive guide: the "Patches Suite Mode" artifact linked from the PR.

## What you see now (patches-web)

- **One banner.** Left: the Patches mark and the app in front. Centre: one search box for every app
  (`search-bar/suite`). Right: the front app's own items (its alerts counter, status dots, buttons, pop-ups), the axHub
  badge (lib-hubstatus), day/night, clock and Settings.
- **App tabs above the menu bar**: Console, Pilot, axHub and any plugin tab (Todos …). Alt+1 … Alt+9 bring a tab up,
  in Patches or inside any app. Each tab opens behind a cover: spinner, "taking a while" after 12 s, "didn't load"
  after 45 s, with Reload and Open in a browser tab. Patches reopens on the last tab (setting), `#/<tab>` links win.
  Every app tab loads in the background 1.5 s after Patches has drawn (`AppShell` `warm`, setting **Load every app at
  start**), so search, menus and banners cover every app from the start; plugin tabs load when first opened.
- **One application menu**: **Patches** (Patches settings, Settings of the app in front, Settings for ▸, Search every
  app, Bars and menus ▸, Keyboard shortcuts, About), **Tabs** (live tab list with Alt keys, next/previous, reload,
  open in a browser tab, Add a tab…, Tabs settings, Console banners above every tab), then **one menu per app** holding
  that app's own menus (live lists, badges and check marks included).
- **Console banners above every tab** (codebase changes, builds, activity, approvals, systems check, keys, What's
  new) through the console's banner strip. If the strip isn't running, the Console tab shows them itself (heartbeat).
- **One look.** Colour theme, style theme and every shared control (tab group, dialog, popup, button, slider,
  container, gauge, meter) are the same in every app; each app keeps its own layout, banner, menus and bars.
- **Settings**: each app keeps its own settings and they open inside its tab (Settings of the app in front,
  Settings for ▸). Console, axHub web and Patches all use the new `settings/suite` interface (tabs on top, compact
  header, search over every setting); Pilot gets it on its next re-bake.
- **Plugin tabs** show the plugin's page alone (`axf-embed-page=view:<id>`), no banner or menu of its own.

## Exactly what is hidden or moved inside Patches

| In the app | Inside Patches | Where it went |
| --- | --- | --- |
| Banner | hidden (take `banner`) | its counters, status, buttons and pop-ups are on Patches' banner while its tab is in front; clock, day/night, logo, spacers, dividers and its search bar aren't copied (Patches has its own); an app's own axHub badge isn't shown twice |
| Application menu bar | hidden (take `app-menu`) | one top-level menu per app in Patches' menu |
| Search box | hidden with the banner (take `search`) | Patches' search finds the app's pages, settings, actions and menu items; a pick runs in that app's tab |
| Links to another suite app | open as a Patches tab (take `links`) | `open-url` → Patches brings that tab up (other links open normally) |
| Ctrl/Cmd+K, `/`, Alt+1…9 | handed to Patches | one search, one set of tab keys |

Nothing else changes: toolbars, side navigation, settings, plugins and notifications stay in each app. Standalone
(its own address), every app is exactly as before.

## How it works (embed@1 suite takes, web)

Patches loads each app tab with
`?axf-embed=patches&axf-embed-hide=none&axf-embed-take=app-menu,banner,search,links` (`tabUrl` in
`apps/patches-web/src/patches.ts`). `hide=none` keeps an older app's banner on screen (it ignores takes it doesn't
know); the `banner` take hides it in an app that knows it (`EmbedTakeSpec.hides`).

Messages (`parseEmbedMessage` in `framework/core/engines/embed.ts`, every one size-checked):

| From | Message | Meaning |
| --- | --- | --- |
| app → Patches | `ready {app, takes}` | sent once when the app has drawn (its hub look is ready) |
| app → Patches | `banner {items}` | the banner items it would draw (≤ 32: type, id, side, order, data, counter value, pop-up) |
| app → Patches | `search-catalog {entries}` | its search entries (ids `e<n>`, label, kind, words) |
| app → Patches | `focus-search` | Ctrl/Cmd+K or `/` pressed inside the app |
| app → Patches | `hotkey {key}` | `Alt+1` … `Alt+9` pressed inside the app |
| app → Patches | `open-url {url}` | a link the app would open (https only) |
| app → Patches | `menu`, `plugins`, `notify` | unchanged (menu as data; plugins report for the Add tab dialog) |
| Patches → app | `run {id}` | `w:<key>` = tap that banner item, `s:<eN>` = open that search result, else a menu id it sent |
| Patches → app | `apps {apps}` | the suite's apps (id, label, bare origin) so the app knows which links are tabs |
| Patches → app | `open-settings`, `menu-request`, `open-tab` | unchanged |

Guest runtime (`framework/core/runtime.ts`): `announceReady()`, banner / search / menu sharing (debounced, resent on
change and on request), `run` of only what it sent, Alt keys and focus-search forwarding, `apps` → link routing.
Page mode (a settings page or a plugin's page alone) and standalone share nothing.

Patches (`apps/patches-web/src/patchesLibrary.tsx`, library 0.2.0): per-tab state (loading / slow / error / ready),
`mirrorBanner` (front tab's items as Patches banner attachments, counters `patches.g.<tab>.<counter>`, taps
`patches.w:<tab>:<key>`), search provider `patches.apps` (`patches.find:<tab>:<eN>`), menu provider `patches.tabs`,
`guestMenuItems` (counters `patches.menu.<tab>.<id>`), shortcuts dialog `patches.shortcuts`. An app that never says
`ready` (Pilot until its re-bake) is marked ready 2.5 s after its page loads.

**Trust:** an app takes host messages only from its parent frame, and (where the browser gives
`location.ancestorOrigins`) only when that parent is on the same site; Patches believes a message only from its own
frame at that frame's origin. Every app stays behind the axHub wall.

## One look: scoped appearance@1

`asset-types.json` marks the look types `"shared": true`: color-theme, style-theme, tab-group, dialog, popup, button,
slider, container, gauge, meter. In the hub's `shared/settings/appearance.json` those stay at the top level (every app
reads them); everything else an app picks (layout, banner, menus, toolbars, nav, hidden chrome) goes under
`app--<appId>--<type>` keys (`appSlotKey`, `resolveAppearanceFor`, `mergeAppearanceFor`). So a colour picked in the
Console repaints Pilot and axHub too, while the Console's layout never reaches Patches. Older readers see the same
top-level keys as before and skip the scoped ones. `HubAppearanceSource` writes scoped.

## New and changed assets

- patches-web: `banner/patches` 2.0.0 (suite banner), `search-bar/suite` 1.0.0, `app-menu/patches` 2.0.0
  (Patches + Tabs menus), `settings/suite`, plus the colour themes, gauges and meters the console ships (coral-studio,
  graphite-lime, midnight-ink, sage-paper; every gauge/meter) so a look picked anywhere resolves in Patches.
- console-web, axhub-web: `settings/suite` (default settings interface).

## Re-bakes

console-web, axhub-web, patches-web and walkthrough-studio re-baked. `framework/cli/rebake.mjs` now also refreshes
an app's installed libraries (`src/axf/libs/<name>`) and their lock hashes. Pilot (other repo) gets the suite takes on
its next re-bake; until then it renders whole in its tab (own banner and menu) and Patches treats it as ready.

## Reference

Settings → Connections → Patches: Console / Pilot / axHub addresses (https, no path), **Console banners above every
tab** (`patches.strip`, on), **Open on the last tab** (`patches.remember`, on), **Load every app at start**
(`patches.warm`, on); panels Apps and Tabs.
Actions: `patches.reload|open|search|next|prev|go:<tab>|tabs.add|tabs|tabs.remove|front.settings|app.settings:<tab>|
menu:<tab>:<id>|w:<tab>:<key>|find:<tab>:<eN>|banners.toggle`. Keys: Ctrl/Cmd+K or `/` search, Alt+1…9 tabs, Esc.

## Tests and CI

`npx -y tsx framework/spec/check-suite.mts` (93: marker, message caps, guest runtime end to end, page mode, scoped
look for three apps), `npx -y tsx apps/patches-web/test.mts` (71), `check-embed.mts` 423, `check-appearance.mts` 80,
Patches server `test_server.py` 57. CI (console job) re-bakes and builds patches-web and runs both new checks. Shared
fixtures unchanged: the new takes are web-only, so `embed-takes.json` `ids` lists only the takes the Kotlin twin knows.

## Not done / known gaps

- **Android:** Patches Android keeps rendering apps whole (marker off). Kotlin twins of the suite takes, the hotkey
  message and scoped appearance are deferred (`framework/spec/PORTING.md`); the Fable rebuild covers them.
- **Pilot** needs a re-bake (Build-Pilot repo) for the suite takes and `settings/suite`.
- **Not screenshot-verified:** the apps wait for axHub in the build sandbox.
- The console and Patches send no `frame-ancestors`; framing by other sites is limited by the hub's SameSite cookies.
- Patches' server `/api/plugins` routes stay but nothing in the page uses them (the `plugins` take is gone: the
  Console runs its own plugins again).
