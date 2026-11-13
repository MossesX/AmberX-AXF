# Badge shape picker on the Banners screen

Build: `badge-shape-picker-on-the-banners-screen-pill-text-icon-or-dot-for-every-bad` · Phase 1 (Opus) · Nov 13 2026
Branch: `claude/badge-shape-picker-on-the-banners-screen-pill-text-icon-or-dot-for-every-bad`

## Result
Every badge on the top bar can now be shown as a **pill** (icon + text), **icon** only or a **dot**, or kept as its **own** shape (the
`shape` the badge asset was made with). A status chip (Following AmberX and the like) has no icon, so it takes pill or dot.

## Where it shows
- Settings → Banners: new collapsible **Badge shapes** section listing every badge and status on the top bar with an Own · Pill · Icon · Dot segmented picker.
- Banner widgets picker (`banner.widgets`): badge and status rows show the same picker in place of the size label.
- The banner draws the pick: `Banner.tsx` `BannerWidgetBody` passes the picked shape to `BannerBadge`; a status picked as a dot draws only its dot. Banner items carry `data-fx-wshape`.

## How it is stored
A banner widget pref (`core/engines/bannerwidgets.ts`): `shape` on `BannerWidgetPref` / `BannerWidgetView`, `BANNER_BADGE_SHAPES`,
`BANNER_SHAPE_TYPES` (badge: pill/icon/dot, status: pill/dot), `bannerWidgetShapes(type)`, `bannerBadgeShape(type, own, view)`.
It is saved per app + form factor in the same settings key as every other widget choice, so it syncs the same way. Widget reset clears it.

## API reach
- Action (REST console actions, MCP console actions, CLI, AmberX voice — all go through the action registry):
  `banner.widget:<widget>:shape-pill|shape-icon|shape-dot|shape-own` (widget = key, name or alias, e.g. `banner.widget:badge:x:shape-dot`).
  A shape the type does not take is refused with a toast naming what it takes.
- Deep links: `banners.settings` (Banners page, Badge shapes section), `banner.widgets[:<key>]` (the picker, optionally on one widget).
- State: the banner widget prefs settings key (`rt.bannerWidgetPrefs()`, `rt.bannerWidgetView(key).shape`); rendered items carry `data-fx-wshape`.

## Android twin
The AmberX Android app gets it now through its baked web framework (`apps/amberx-droid/src/axf`, synced). Native Kotlin
(`BannerWidgetEngine.kt` `shape` + Compose picker row) is recorded as a deferred gap in `framework/spec/PORTING.md` (Android port on hold, Brett Oct 21 2026).

## Files
`framework/core/engines/bannerwidgets.ts`, `framework/core/runtime.ts`, `framework/react/components/{BadgeShapes,Banner,BannerSettings,BannerWidgets}.tsx`,
`framework/ui/axf.css`, `framework/spec/check-widgets.mts`, `framework/spec/PORTING.md`; same files synced into the baked copies in
`apps/{console-web,axhub-web,amberx-droid,molly}/src/axf`.

## Tests
- `framework/spec/check-widgets.mts`: 290 checks ok (12 new shape checks)
- `check-banner-hide` 58, `check-banner-strip` 29, `check-appearance-lock` 27: pass
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`: pass
- console-web `tsc --noEmit`: 0 errors

## Open
- UI Review shots (desktop + phone) not taken in this session: the screenshot CLI (`axf shot` / `axf focus`) is not in this checkout's `axf.mjs`, and the live console runs main, not this branch. Shots are due once the branch is on a preview.
- walkthrough-studio and demo pick it up on their next rebake.
