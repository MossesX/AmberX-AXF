# Report: every-app-gets-own-locked-default

Every app gets its own locked default navigation menu and application menu. Same model as settings-iface@1
(`settings-iface-default-all`, landed 810eecf3ca7b).

Model: Opus, one session, phase 1 (s1–s6). Branch `claude/every-app-gets-own-locked-default`.

## What shipped

- **app-menus@1** (`framework/core/engines/app-menus-rules.mjs`, reference engine, `.d.mts` types): a `nav-menu` or
  `app-menu` says who it is built for in `data.builtFor` = `app:<app>` (the app's folder under `apps/`).
- **Own defaults (s1):** each web app ships `default-<app>-nav` and `default-<app>-appmenu` in its own `src/assets`, and
  its manifest's defaults name them: console-web, axhub-web, amberx-droid, molly, walkthrough-studio, demo. The app
  knows who it is from that default id (`appOfDefaults`), so no new manifest field.
- **Locked row + picker (s2):** Settings → Appearance now has two rows in place of the old "Navigation menu" select:
  *Navigation menu* and *Application menu*, each greyed with a lock on the default and a checkbox *Use another
  navigation menu* / *Use another application menu*. Ticking opens a dialog (`axf.settings.menus`) that lists only
  the menus built for that app. Unticking puts the app back on its default. `framework/libs/settings/menus.tsx`.
- **No shared menu, ever (s3):** the runtime refuses a nav-menu / app-menu not built for the app everywhere a slot is
  set (`slotAllowed` / `rt.slotOk` in `core/runtime.ts`: start-up picks, saved picks, the hub's look, `swap`, `next` /
  `prev`), and every picker filters through it (chrome right-click Change…, Asset Studio, the Appearance rows, the
  hot-swap search). The 28 shared nav-menu starters and 3 app-menu starters in `framework/assets` are still baked
  (templates) but are never offered or used by an app on app-menus@1.
- **Migration (s4):** each app's current menus (console-nav, console, axhub-web, amberx-droid, molly,
  walkthrough-studio) became its defaults; the old files were identical and are removed. A saved pick of a shared or
  removed menu falls back to the default on load, so older looks migrate by themselves. The console's one-time move
  to the `console` app menu is gone (the runtime does it now). Tests, AmberX design packages and the console's
  control inventory point at the new ids.

## API (s5): REST / MCP / CLI / voice

Registered as console actions, so the console-control surface reaches them the same way on all four:

- `menus.pick:<nav|appmenu>:<menu id|default>` pick a menu built for this app; `default` = untick, back to the
  locked default. Picking a shared or another app's menu is refused with a reason.
- `menus.choose:<nav|appmenu>` open the picker dialog (deep link).
- `menus.state` (read): which menu each kind uses, locked or not, how many are built for the app.
- State is also the slots themselves (`active['nav-menu']`, `active['app-menu']`) in the console-control state.
- REST `POST /api/console-control` with the action; MCP `console_control_*`; CLI `axf console do menus.pick:nav:default`;
  voice through AmberX (same command search).
- Repo-level CLI: `node framework/cli/app-menus.mjs list | backfill [--write] | check [--json]`.

## Checks

- New: `node framework/spec/check-app-menus.mjs` (fixture `framework/spec/fixtures/app-menus.json` + the repo audit,
  the CI guard that no app points at a shared or another app's menu), `npx -y tsx framework/spec/check-app-menus-runtime.mts`
  (11 runtime checks). Both added to CI (`.github/workflows/android.yml`).
- Green locally: app tests axhub-web 255/255, amberx-droid 2336/2336; check-theme, check-controls, check-toolbars,
  check-chrome-assets, check-console-control, settings-iface check, chrome-settings check, shared-assets check,
  help-coverage (100%).
- Baked copies of the five apps re-synced with `rebake.mjs apply --force` (the two "edited" files were byte-identical
  to the framework; only the lock hashes were stale).

## Not done / notes

- Android (android-compose: axhub-android, console, phone-connect, voicevault) keep shared menus: twin deferred,
  recorded in `framework/spec/PORTING.md`.
- `apps/demo` has a stale baked framework (rebake status), so its runtime does not enforce the rule yet; it has its
  own defaults and its manifest names them. Its other 28 nav menus are copies of the shared starters and stay
  untagged (never offered once it is re-baked).
- `asset-types.json` is not changed: `builtFor` on menus is an optional data field the validator already allows. If
  it should be listed in `optional_fields` (a schema edit), that is a Fable step.
- No UI Review choices were produced: the change reuses the settings-iface row and dialog look one-for-one.
