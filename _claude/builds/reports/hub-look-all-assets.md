# hub-look-all-assets — one look from axHub, every app ships every shareable asset

Brett, Nov 1 2026: "The apps should only get appearance from axhub period." "If you select design package in one app
it changes it for all! Any theme change applies to all." "They all gotta ship all assets that can be shared bruh!"
"Scrap patches and demo and walkthrough" (from this build).

Built by Opus in a claude.ai session (the headless Fable build could not run: the main account hit its weekly limit
until Tue Nov 3). Brett chose "Opus here, now"; a Fable review of the contract parts is the follow-up.
Branch `claude/hub-look-all-assets`, apps: Dev Console (`apps/console-web`), axHub web (`apps/axhub-web`),
AmberX (`apps/amberx-droid`). Patches, the demo and Walkthrough Studio are left out (Walkthrough's copy of the
framework help was synced so the help check stays green; nothing else there changed).

## Part B — appearance only from axHub

| Before | After |
|---|---|
| Settings → Appearance had **Get the look from axHub** (off = the app keeps its own look, nothing sent) | Switch, action `appearance.hub` and help entry removed. A saved "off" (`axf.hub.appearance.follow`) is cleared when the source attaches, with a terminal line. |
| axHub web and AmberX attached the hub source only `if (manifest.developer?.hub)` | Always attached (manifest hub, else `DEFAULT_HUB`). |
| Console main window had **GizmoX Night / AmberX Signature** tabs drawing the app under an interface's own look | Tabs removed (`interfaceTabs.tsx` deleted). Applying an interface still works and goes to the hub. `InterfaceScope` stays in the framework. |
| Console server ran the console on local settings when the wall was off or the hub had no data server | Removed. No hub = the waiting screen. `AXF_APPEARANCE_HUB=off` is kept only for offline screenshot runs on a dev checkout (rebuild-shots), never on the VPS. |
| Sliders, per-asset tokens, banner looks, rolls (look settings) stayed on each device / in each app's own settings file | appearance@1 `settings` map carries them; every local change pushes per key; a document that lists them owns them (unlisted keys cleared); an older document is seeded once from the app's own. hubsync no longer mirrors them in the per-app file. A change that would make the document exceed 16 KB keeps the hub's settings (no document other apps would refuse). |
| A design package's settings plan stayed in the app that applied it | Its settings are look settings, so they reach every app with the slots. |

Choice for "look tweaks reach every app": **carried in appearance@1** (not the hub settings mirror), because the
mirror is per app (`settingsFileFor(appId)`), so it could never make one app's tweak show in another; one document
also keeps one version, one conflict path (409 re-merge) and one live feed for the whole look.

Contract notes: the fixture `spec/fixtures/appearance.json` is unchanged (16 KB limit kept). Kotlin twin deferred
(PORTING.md). New: `SettingsRegistry.onAnyChange`, `AppearanceChange`, `combineAppearanceChanges`.

## Part A — every app ships every shareable asset

- `asset-types.json` types carry `shared` (default true); `job-type` is `false` (agent job data, not UI).
- Shared set = every `framework/assets` file of a shared type + its dependency closure (`app-assets.mjs`) + extra
  roots in `framework/schemas/shared-assets.json` (none needed today). **470 assets.**
- `framework/cli/shared-assets.mjs` bakes it into `src/axf/assets` of each listed app (rebake does it too and records
  the hashes in `axf.lock.json`; CI's re-bake steps call `bake .`). `check` fails CI when an app misses one, holds its
  own copy of a shared id, or its main.tsx doesn't load the baked set.
- Apps load `src/axf/assets`, then `src/assets` (truly their own: app menu, nav, toolbar, context menu, help,
  access policy, AmberX's mic status), then `src/assets-overrides` (shared ids the app tunes, same id).
- A shared asset may name an app's own chrome (AmberX's day/night packages pick AmberX's toolbar and nav): other apps
  skip that one slot, as for any package.

Moved into `framework/assets` (were in one app only): `banner/amberx-branded`, `branding/amberx-app`,
`design-package/amberx-app-day`, `design-package/amberx-app-night`, `theme-switch/amberx-day-night` (from AmberX),
`layout/axhub-console` (from axHub web; AmberX's copy only differed in its name, "AmberX (console)" → "AXHub
(console)"). The three apps' newer `banner/amberx-thin` (with the day/night switch) stays an override in each app:
the framework copy is pinned by the banner/roll fixtures and the Kotlin kernel tests, so changing it is a contract
change for the Fable review.

Overrides kept (app-tuned copies of shared ids):
- Console: app menus `developer`, `minimal-picker`, `standard-desktop`; layouts `data-grid`, `document-reader`, `kiosk`,
  `portal-top`, `right-handed`, `studio-dock` + new `split-review` (the console keeps its menu bar in every layout);
  nav menus `icon-rail`, `pill-tabs`, `sidebar-list`; toolbars `enterprise-command`, `touch-dock` + new
  `approvals-desk`, `minimal-glass`, `power-user`, `review-flow` (the console's bell lives on the banner only).
- All three apps: `banner/amberx-thin` (the newer copy they all had, with the day/night switch).
- axHub web + AmberX: `counter/approvals` (links to `nav:home`, the approvals page there).
Dropped as older: axHub web's and AmberX's `context-menu/roomy-touch` (had lost the Focus Top item only because
that layout wasn't shipped).

| App | Registered before | Registered after | Own (src/assets) | Overrides | Shareable assets it lacked before |
|---|---|---|---|---|---|
| Dev Console | 415 | 477 | 7 | 19 | 62 |
| axHub web | 384 | 475 | 5 | 1 | 92 |
| AmberX | 396 | 475 | 5 | 1 | 85 |

(Registered = distinct type/id the app loads; after = 470 shared + its own. `shared-assets.mjs appAssetFiles`.)

## Checks

- New `framework/spec/check-hub-look.mts` (26): two apps on one hub; a design package (4 packages), a colour theme,
  spacing, hidden chrome, the Sliders, per-asset tokens, clearing one, Restore default in one app are exact in the
  other, nothing skipped; an older document is seeded; the lock stays per device; no console look tabs.
- `node framework/cli/shared-assets.mjs check` in CI.
- Updated: `check-appearance-lock.mts` (no opt-out; the retired key is cleared), `check-scale`, `check-design-package`,
  `check-help`, `help-coverage` (baked help + assets dirs; framework ratchet 111 → 110 for the removed switch,
  +2 entries for `action:inspector` and `cycle-slot`), console `menu-reach`, alerts-bell + main-build-status widget
  checks, plugin-manager hook, axHub web + AmberX tests, axHub `refresh-check`.
- Typecheck clean: console-web, axhub-web, amberx-droid. axHub web builds.

## Known gaps

- Android/Kotlin twin (PORTING.md). AmberX's native shell runs the web build, so it gets all of this.
- Fable review of the appearance@1 `settings` contract and the `shared` flag (Brett's rule: foundation work on Fable).
- Kotlin kernel tests load every `framework/assets` file: the six assets moved in from the apps are new there
  (validated by the web validator, which mirrors Kotlin's); Android CI is the proof.
- `apps/console-web/scripts/theme-swap.mjs` (Playwright, every colour/style theme in the built console) was not run
  here; the console now ships 8 more colour themes and 8 more behaviour themes, so CI runs it over more themes.
- Patches, demo, Walkthrough Studio keep their old baked framework and own asset copies (left out on purpose).
