# Toolbar widgets in any banner style

Build `toolbar-widgets-in-any-banner-style`. Brett, Nov 16 2026: "Rebuild."

## Result (Phase 1, Nov 27 2026)

The feature was already built on the twin build's branch, `claude/attach-widgets-to-any-toolbar-banner` (17 steps, Nov 16 to 18), but that branch never got a pull request and sat about 2,000 commits behind main. Both builds were queued from the same request within nine seconds of each other and the builds store gave them the same branch. This phase did not build the feature a second time: it merged that branch onto current main, fixed the conflicts, regenerated what is generated, and filled the gaps against this build's step list.

- Branch pushed: `claude/toolbar-widgets-in-any-banner-style`, and the same head fast-forwarded to `claude/attach-widgets-to-any-toolbar-banner` (the branch the store names for this build).
- Design note for the contract: `_claude/builds/reports/attach-widgets-to-any-toolbar-banner.design.md`.

## Intent from the old branch

`claude/toolbar-widgets-attach-any-banner-style` (PR #656, closed unmerged, branch kept; build archived Nov 16). Two commits on Nov 13 2026, 46 files, about 2,000 lines, read only:

- `d6591a9e1` Toolbar widgets: any banner-style widget on any toolbar or tab row.
- `03c08c4c5` Toolbar widgets: say when the app toolbar is off and offer to show it.

What it set out to do, from Brett's words ("I can attach widgets to the toolbar right, just like the banner widgets"):

- Every toolbar hosts widgets the way the banner does, from the same widget assets and registry (status, counters, clock, account, search).
- Add, remove and arrange widgets per toolbar from its right-click menu and its settings.
- Widgets follow skins and tokens and move into an overflow when the bar is full.
- It did this with a new `hostwidgets.ts` engine and a `HostWidgets.tsx` component, about 250 lines added to `runtime.ts`, and it made tab rows a host too.

Not carried over: tab rows as a widget host (left to the snappable-assets items), and the separate `hostwidgets` engine (the toolbar now goes through the banner's own style function instead of a parallel one). The "app toolbar is off" hint is worth keeping in mind for the UI phase.

## Current state

What main had before this merge:

| Piece | Where | State |
| --- | --- | --- |
| Widget host engine | `framework/core/engines/widgets.ts` (`hostSpec`, `placeToolbarWidgets`, `validateHostAttachments`) | Toolbar was already a host with sides `start` / `end`, but only the app toolbar, with no style or shape per widget |
| Banner widget styles | `framework/core/engines/bannerwidgets.ts` (`bannerWidgetView`, `overflowWidgets`) | Banner only |
| Widget shapes | builds `banner-widget-shapes-*` (PR #703 closed, #821 open) | Not on main. The `shape` field is reserved as an id so that build needs no second contract |
| Toolbars plugin settings | `axf.toolbar.<id>.*`, chrome settings `axf.chrome.toolbar.<instance>` | No widget keys |
| Snap rule | `framework/ui/axf.css`, banner section | Toolbars had scroll snap only; no engine stated the order |

What was missing for toolbars, and is now in the branch: per-instance hosts, the `hostEntry` shape with `widget` and `shape`, one resolver shared with the banner, a pure fit function, settings keys, React slot, CSS, attach UI, drag and drop, and the API on all four surfaces.

## How this build's steps map to what landed

| Step | Covered by |
| --- | --- |
| s1 archive + intent | Old build archived with a note pointing here; PR #656 already closed with "Rebuilding fresh on current main. Branch kept."; section above |
| s2 current state | Section above |
| s3 contract | `framework/spec/BANNER-WIDGETS.md` → Widget hosts: toolbars; Kotlin twin deferred in `framework/spec/PORTING.md` |
| s4 schema | `hostEntry` in `framework/schemas/asset-types.json`, both validators, JSON Schemas regenerated. A toolbar with no `widgets` stays valid; migration is a no-op |
| s5 engine, style and shape | `resolveToolbarWidgets` in `framework/core/engines/toolbar-widgets.ts`, through the banner's `bannerWidgetView` (one function, no copy) |
| s6 engine, snap layout | `fitToolbar` (pure, returns placements) |
| s7 fixtures | `framework/spec/fixtures/toolbar-widgets.json`: added every banner widget size × show with a shape (20 cases), empty toolbar, old asset with no widgets; crowded-toolbar fit cases were there (w900 down to w120) |

## Differences from the step wording

- Field names follow what the banner already used: the slot is `at` (not `slot`), the style is `widget` (not `style`). Renaming would have broken the banner's existing assets.
- Slots are `start` and `end`. Overflow is where the fit function moves a widget, not a slot a widget is assigned to.
- Host instances are toolbar ids under the existing `toolbar` host, not a new host kind string: the `toolbar` host was already in the registry.

## Merge notes

- 63 conflicts. Hand-written ones resolved by union: core exports, CLI help and routing, MCP address kinds (`place` from main, `widget` from the branch), catalog, voice phrases.
- `apps/amberx-droid` was removed on main and stays removed.
- Baked framework copies (`apps/*/src/axf`): main's copies have drifted from their lock files, so `rebake apply` refuses three apps. This build's framework delta was applied to each baked file by three-way merge so the drift is untouched. Walkthrough Studio re-baked normally.
- Not on main, so not run: `toolbar-owner.mjs check` and `check-toolbar-owner.mjs` (from the unlanded every-plugin-gets-own-default-toolbar build).

## Checks run on the merged tree

check-widgets (468), check-toolbar-widgets (127), validate --framework (600 assets), check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control, shared-assets check, chrome-settings check, tracker --check, console `tsc --noEmit`, toolbar-widgets plugin tests (24 + 36), console-control server tests (11): all pass.

## CI fixes after the first run (PR #935)

The branch had never been through CI. The first run failed on four things, all fixed in `971a55cb2`:

- `--fx-widget-cap` was not in the token registry (`token-registry.mjs sync --write`).
- The new `toolbar-widgets` plugin had no default settings interface (`settings-iface.mjs defaults --write`).
- Framework help coverage fell to 96.8%: six draft entries added and synced to the apps.
- `check-banner-widgets` read the toolbar widget frame as hard-coded banner chips. Toolbar widgets come through the toolbar's own registry, so the guard now leaves `fx-toolbar__widget` items and `ToolbarWidgetSlot.tsx` alone.
- Kotlin `ConformanceTest` replays `validation.json`; the two new widget style / shape cases are skipped there as a deferred twin (`DEFERRED_VALIDATION_CASES`, PORTING.md), the same way the opacity tokens are.

Failing only on the VPS, not in CI (Node 20 here, 22 there, or no jsdom / built console): shipped-features test, lander tests, check-help-mode and four other jsdom checks, test_wall_users, session-checkin, check-headless-tabs.

## Left for the next phase

The Opus steps (s8 to s19) are largely built on this branch already (React slot, CSS, attach UI, drag and drop, addresses, REST, MCP, CLI, voice, tests, re-bake). Still open: the UI Review shots with three option assets, and the wrap-up run. Each Opus step should be checked against the branch before anything is rebuilt.
