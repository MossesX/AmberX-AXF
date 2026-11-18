# All banner widgets in one plugin (banner-widgets-one-plugin)

Built Nov 18 2026 on Opus, branch `claude/banner-widgets-one-plugin`. Gizmo: "every banner widget gathered into ONE plugin".

## What a "banner widget" is here
The chips and badges on the console's top bar: everything that reached it through `rt.attachToBanner` (the framework's
one widget registry, so every one of them is also in the banner's Widgets picker). The full-width banner strips under the
bar (Activity, Systems check, Push banner, Approvals, Codebase changes, token pass…) are *banners*, not widgets; they keep
their own plugins and their own Banner settings. The Activity strip's "slots 4/6" line is a slot inside that strip, not a
bar widget, so it stays with agent-slots. The framework's own widgets (clock, search bar, logo, theme switch, the axHub
library status) stay in the framework.

## Before
16 widgets drawn by 12 plugins, each with its own attach code, hint, show switch and settings place:
Badges (`claude-badge`: Claude, VPS, axHub, AmberX, usage meter), project-switcher, build-profiles, claude-accounts,
follow-amber, whats-shipped, agent-voice, wake-listener, builds-page, main-build-status, alerts-bell (bell + count),
plan-studio (+ Plan).

## After
- **One plugin: Banner widgets** (`apps/console-web/plugins/banner-widgets`, id `ai.amberx.axf.console.banner-widgets`).
  It is the Badges plugin moved and grown (`git mv`, so history follows; `builtWith.replaces` names the old id).
  - `web/registry.ts`: the one table of all 16 widgets: id, asset type and id, side, order, picker hint, the setting keys it
    obeys, and the old owner's plugin id and folder as aliases.
  - `web/supplied.ts`: builds the asset for every widget another plugin feeds, attaches it, takes it off, repaints on
    data, setting or counter changes.
  - `web/WidgetsScreen.tsx`: **Settings → Plugins → Banner widgets → Every banner widget**: each widget with show/hide,
    up/down, side, size, shape (appears once widget-shape@1 is on main), icon, and More (the banner's own picker for it).
  - `web/commands.ts`: `banner-widgets.open | show | hide | move | size | shape | icon` (control@1, so REST, MCP, CLI and
    voice). A widget is named by id, title, alias, or its old owner's plugin id or folder ("main-build-status", "claude-badge").
  - The five status badges keep their reading code, server, drop-downs and per-badge settings, unchanged.
- **Data only, through a service.** New console module `src/bannerData.ts` (capability `axf.banner-data@1`):
  `supplyBannerData(widget, {type, data, name?, description?} | null, origin)`. The 11 other plugins now only hand over
  their numbers and words; none of them attaches, registers a banner asset or owns a show switch any more. The console
  drops a plugin's data when it is switched off (App.tsx, next to `detachAll`). AmberX bundles the same file (vite alias).
- **Nothing moves for the person.** Asset type and id of every widget are unchanged, so saved positions, sizes and hides
  (keyed `type:id`) apply as before. Every old setting key is kept and now declared by Banner widgets:
  `projects.show`, `build-profiles.show`, `follow-amber.chip`, `whats-shipped.show`, `agent-voice.banner`,
  `builds.banner`, `main-build-status.show`, `alerts-bell.show`, `alerts-bell.side`, `plan-studio.banner`, all
  `claude-badge.*`. Old action `claude-badge.tap.*` and a saved tap target `settings.open:claude-badge` still work.
  New: `banner-widgets.<id>.icon` (icon choice), `banner-widgets.claude-account.show`, `banner-widgets.wake-listener.show`.

## Choices made (nobody to ask)
- Moved the Badges folder instead of adding a 2nd plugin: it was already "badges in one plugin"; two would leave the
  split the job removes. Its data folder is now `.axf-console/plugins/banner-widgets`; the old one only held a status and
  usage cache, refilled within minutes, so it is not copied (old env var `AXF_CLAUDE_BADGE_DIR` still honoured).
- Wake listener keeps its own "Mic light on the banner" choice: it is a server-side listener setting that decides whether
  there is a light at all, so the plugin supplies nothing when it is off. Follow Amber, builds progress and Claude account
  likewise supply nothing while they have nothing to show (same as before).
- Hide in the one screen = the framework's per-device hide (what the banner's own picker does); Show turns the old switch
  back on too, so one switch covers both.
- The shape control reads `BANNER_WIDGET_SHAPES` from the framework at run time: it appears when widget-shape@1
  (`banner-widget-shapes-plus-change-icon`, in the merge queue) lands, and needs no change here.
- Banner widgets also targets AmberX (agent voice, builds progress, wake listener and + Plan are on AmberX's banner); the
  five status badges run on the console only.

## Checks
- New `widgets.test.mts` (real console runtime, 31 checks: placement, old keys, `when`, side, icon, drop on disable,
  aliases, no runtime warnings), plus the moved `test.mts` (50), `banner.test.mts` (48), `test.py` (73). Added to CI.
- Updated: whats-shipped `test.mts`, alerts-bell and main-build-status `widget-check.mjs` + `test.py` (they now check the
  data they supply; placement is checked in Banner widgets). Every touched plugin's `test.py` passes.
- `tsc --noEmit` clean apart from `src/control/inventory.json` (generated, not in git). check-theme, check-controls,
  check-toolbars, check-chrome-assets, check-banner-widgets, check-plugin-settings, help-coverage, lazy-loader-check pass.
- plugin-lifecycle check: clean for every touched plugin, apart from failures already on main (builds-page, plan-studio,
  wake-listener: references in framework fixtures and plan-studio-2). Fixed on the way: wake-listener was missing from
  the lazy loader's KNOWN_BANNERS (failing on main).
- check-plugin-pages and menu-reach fail on main for orchestrator-demo / phone-connect; untouched.

## Left
- No Kotlin twin: no framework engine changed (the data channel is console code).
