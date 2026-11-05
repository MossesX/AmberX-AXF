# Three layouts per screen (`three-layouts-per-screen`, run r2)

**Result:** every new plugin screen now has three layouts and a layout toolbar, hidden by default. Older screens are not
touched. Branch `claude/three-layouts-per-screen-r2`. Spec: `framework/spec/SCREEN-LAYOUTS.md`.

**Model:** all Opus (Brett, Nov 5: this account has no Fable). **The new format `screen-layouts@1` is marked "Opus, possible
Fable review".** Run 1 started on Fable and died on usage credits; its files were carried over and finished here.

## What Brett said

> "From now on, all plugin screens get three layouts, and come with a toolbar to select which one, with the toolbar hidden by default." "Not old ones, only new ones."
> "So UI Review will only allow you to select from the three layouts it is going to generate."
> Amber: "If they all point to the same shared toolbar, change it once and every plugin's view toolbar updates; if you ever want one plugin different, give it its own copy." Brett: "Yep."

## Salvage

Run 1 pushed nothing; all of its work was uncommitted in `/root/axf-builds/three-layouts-per-screen`. Its feature files were
applied onto current main, with 2 small conflicts (`framework/core/index.ts`, `framework/core/runtime.ts`, both from the
tab-group work). Baked app copies were regenerated instead of copied. No builds store, journal or other builds' reports
came over.

## What was built

| Part | Where |
| --- | --- |
| Contract `screens` in plugin@1 (3 to 8 layouts, a default) | `framework/core/engines/screen-layouts.mjs`, `plugin.schema.json`, `plugins.mjs`, console `main.py` |
| Runtime: pick, show or hide, own copy, actions, right-click items | `framework/core/runtime.ts` |
| One shared toolbar asset, shipped to every app | `framework/assets/toolbar/layout-switcher.json` |
| React: `useScreenLayout`, `LayoutToolbar` | `framework/react/components/ScreenLayouts.tsx` |
| Settings → Plugins → Toolbars → Layout toolbars | `framework/libs/toolbars/index.tsx` |
| Scaffold: `axf new-plugin`, `_template` plugins (console, axHub web, AmberX), library templates | `framework/cli/new-plugin.mjs`, `framework/library-templates/` |
| CI with grandfather list | `framework/cli/check-screen-layouts.mjs`, `framework/spec/screen-layouts-baseline.json` |
| UI Review choices | `reviewLayoutChoices`, `apps/console-web/src/screenLayouts.ts`, `framework/cli/screen-layouts.mjs review` |

Added in r2, on top of run 1:

- **Right-click Toolbar settings… on the layout toolbar** (chrome-settings@1, #327). Without this a copy could not be edited
  from the UI. It edits the shared toolbar, or only the copy once the plugin has one; back to shared drops the copy's edits.
- `framework/cli/screen-layouts.mjs`, which run 1 referred to but never wrote.
- The spec, rules, brief template line and Android deferral note.
- The grandfather list brought up to date (see below).

## Tests

- `check-screen-layouts`: 92 → 100 checks, all pass.
- Real console build with a scaffolded throwaway plugin, driven in Playwright on desktop and phone: hidden by default, title
  right-click, show, pick Compact and Spacious, toolbar right-click, own copy, copy edit, hide. No page errors.
- `axf new-plugin` output passes `check-screen-layouts` and `plugins.mjs --check`.

Screenshots: UI Review → Screenshots, group `three-layouts-per-screen - Nov 5 6:11 AM`, and `three-layouts-per-screen/shots/`.

## Decisions to check

- **Open branches are grandfathered.** 14 screens from branches already built or in progress when the rule landed are on the
  list, so the merge queue doesn't kick out finished work. Builds still running that haven't pushed their plugin yet
  (for example `skins-r2`) are not on it: if one adds a plugin page, CI tells it to add `screens`.
- **The layout toolbar's right-click has no Change or Move.** Those act on the app's toolbar. Own copy, back to shared and
  hide cover it.
- **`--update-baseline` drops the open-branch entries** until those branches land, so don't run it before they do.

## Known gaps

- **The UI Review Layout dropdown is not built.** It and its Apply button belong to `ui-review-alarm` (addendum 5, PR #343),
  which changes the same files and is not merged. The helper is ready and a note on that build says to use it.
- **No plugin uses this yet**, because nothing was retrofitted. The first real new plugin is its first production use.
- **Copies and their edits are per device** (settings), while the shared asset is the same everywhere.
- **The hub-wide look:** toolbar settings from the right-click are device settings. Changing the asset itself changes every
  plugin.
- **Android twin deferred** (`framework/spec/PORTING.md`).
