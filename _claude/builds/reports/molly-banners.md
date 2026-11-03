# molly-banners: install the banners in Molly

Brett, Nov 3 2026 (voice): "Install the banners in Molly." Build `molly-banners`, profile Current, Opus, headless
session (assigned: Amber). Branch `claude/molly-banners`.

## s1: what Molly showed vs the Dev Console

| Banner / chip (console) | Kind | Molly before | Molly now |
|---|---|---|---|
| Systems check, Keys needed, What's new (`systems-check`) | banner plugin | none | in the strip |
| Builds (`build-manager`) | banner plugin | none | in the strip |
| Approvals (`approvals-banner`) | banner plugin | none | in the strip |
| Branches not on main (`push-banner`) | banner plugin | none | in the strip |
| Activity (`activity`) | banner plugin | none | in the strip |
| Codebase changes (`codebase-changes`) | banner plugin | none | in the strip |
| Claude handoff reminder (`claude-handoff`) | banner plugin | none | in the strip |
| Pass countdown (`token-control`, `token-pass`) | banner plugin | none | in the strip |
| Alerts bell + unread counter (`alerts-bell`) | banner-bar chip | none | in the strip's chip row |
| Claude badge (`claude-badge`) | banner-bar chip | none | chip row |
| What's new chip (`whats-shipped`), Plan capture, Build profile, Main build status, axHub status | banner-bar chips | none | chip row |
| Any banner plugin added later | — | — | shows by itself (the console draws it) |

Why Molly had none: Molly's `App.tsx` dropped the libraries' `slots` / `banners` (no `SlotsProvider`), and with xLayout
on, every framed app hides its own banner (xlayout@1 `banner: host`) while chrome@1 only carries plain widget data, which
xLayout's host never drew. So in Molly the console's banners showed nowhere. Without xLayout each frame drew its own
banner inside its frame (one per app, not one region).

## s2: one shared banner region

- **Framework (web only), no engine or contract change:** `framework/react/bannerStrip.ts` (strip ⇄ host messages
  `banner-strip@1`, strip → app channel `axf.banner-strip`, `bannerStripUrl`) and
  `framework/react/components/BannerStrip.tsx` (`BannerStripPage`, `useBannerStripFollower`). AppShell draws
  `BannerStripPage` for the embed@1 view page `view:axf-banners` (view pages already existed; page mode never skips a
  plugin, so the bell and badge load too). `axf.css`: see-through page behind the strip, full width, chip row height.
- **The strip** draws the app's `app.frame.banners` slot (every banner plugin, wrapped exactly as on its own page:
  Banner settings, colours, order, banner group, fold / undock) and the chips its plugins attach to its banner bar
  (`rt.hostAttachments('banner')`). It reports its height; while a dialog, menu, popover, toast or plugin portal it
  opened needs more room it asks for the whole window, and the host lays the strip's frame over its window and sends
  the strip's position (`inset`) so the banners don't jump.
- **Taps do what they do in the console:** dialogs open in the strip (over all of Molly). A tap that opens a console
  view (Build manager, a settings tab, …) is handed to the console's own frame over a same-origin BroadcastChannel (with
  the settings tab when it is one; resent when the console frame was still loading), and Molly brings the Console on
  screen (`open`). The strip goes back to its own page, so the same item works again.
- **Molly plugin `apps/molly/plugins/banners`** (plugin-lifecycle@1, removable): puts the console's strip in Molly's
  `app.frame.banners` slot (Molly's `App.tsx` now passes plugins' slots through a `SlotsProvider`). The frames Molly
  opens hide their own banner: xLayout's merge rules when xLayout is on, this plugin's `frameUrl` hook (embed@1
  `hidden: banner`) when it isn't. So there is one banner region, however many apps are open.
- Console: the "menu bar and side navigation are both hidden" rescue note no longer shows in a page a host shows alone
  (it showed in the strip).
- Re-baked: molly, console-web, axhub-web, amberx-droid (the frames Molly opens run the follower).

## s3: same settings as the console

- Each banner's settings and colours are the console's own (the strip is the console): right-click a banner in Molly →
  Banner settings opens the console's dialog over Molly.
- Settings → Plugins → **Banners** in Molly: show / hide the whole strip (also View → Banners), and a switch per banner
  (from the strip's live list). The per-banner switch writes that banner's own "Hide it inside a host app" in the
  console, so the console's Banner settings and Molly always agree.
- Phone + desktop: the strip is the console's responsive banner area; Molly caps it at 45% of the window and it scrolls
  inside itself when taller.

## s4: overlap with banner-pack (#251), banner-editor (#254), banners-one

Not merged, not rewritten. Both PRs also touch `framework/react/index.ts` and `framework/ui/axf.css` (different lines:
this build adds exports after the Slots line and a block after `.fx-frame-banners`) and #254 changes `Banner.tsx` (this
build only imports `BannerBadge` from it). Expect clean text merges; whichever lands second re-bakes. Once #254 lands,
its banner editing runs inside the strip like any other banner action.

## Tests

- `npx -y tsx framework/spec/check-banner-strip.mts`: 29 checks (message parsing, channel, address round-trip through
  embed@1, page mode never skips banner plugins); added to CI next to check-chrome.
- `tsc --noEmit`: apps/molly and apps/console-web clean. `vite build`: both green.
- `check-theme.mjs` ✓, `check-controls.mjs` ✓, `plugin-lifecycle check banners` ✓, `project.mjs validate --all` ✓,
  `shared-assets.mjs check --all` ✓, `rebake.mjs status` current for the four apps.
- Live (Playwright, local Molly + console builds, live console API): see "Live run" below.

## Known gaps

- A banner item that sets something only the strip's copy of the console knows before opening a view (the Build
  manager's focused row) opens the view in the console frame without that focus.
- The console runs twice in Molly (the strip and its frame), so its banners poll twice.
- AmberX and axHub have no banner plugins today; adding their strips is one entry each (the plugin's `SOURCE`).
- Android: nothing (web-only frame UI; Android work is on hold).
