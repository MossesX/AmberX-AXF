# molly-banner-match — report (Nov 4 2026)

## Brett said (verbatim)
> "Make Molly's top banner asset the same as console. And when console's open in Molly, don't display its own banner."

Addendum (voice, Nov 4): "The approval waiting pop-up when I'm in Molly shows the sad face, but not when I'm in console."

## Approval pop-up in Molly (addendum, done first)

**Root cause.** Molly frames the console twice: the console itself and its banner strip (a one-page view,
`axf-embed-page=view:axf-banners`, #294). Both ran Follow Amber and the approvals banner, so both popped a dialog. The
strip's copy covered Molly's whole window, sat on top of the real one and took the taps. A tap on Approve there took the
`frame` route: axHub's approval page in a nested iframe, which axHub refuses (`frame-ancestors` lists only
patches/amberx), so the browser drew its blocked-frame face. The standalone console has only one instance, so it never
stacked. Joey's fix (#325: the `open` route, `drawable()`, the fallback boundary, chunk reload) was not merged: its CI
was red on the help-coverage ratchet.

**Fix.**
- Took over #325 (same files) and fixed its red CI (help for the two new buttons).
- `follow-amber/web/core.ts` `popsUpHere()`: a page view of the console (embed@1 `page`) never pops the approval up;
  the console's own frame does. The approvals banner's auto-open and reminder skip page views too.
- Decisions the console can't sign open axHub's page; no frame unless the hub allows this origin.

**Before:** two dialogs, the strip's on top (`shots/before-molly-two-popups.png`).
**After:** one dialog in the console frame; Approve opens axHub's page and says so; no iframe in the dialog
(`shots/molly-desktop-popup.png`, `shots/molly-phone-popup.png`; standalone unchanged: `shots/console-desktop-popup.png`).

## Banner match

- **Top banner is selected, not copied:** Molly's Banners plugin has a *Top banner* picker (Settings → Plugins → Banners):
  the console's banner (default) or Molly's own. With the console's, the strip draws the console's whole banner bar (its
  banner asset in force, logo, every attached chip and badge) above Molly's menu, and Molly hides its own bar. Changing
  the console's banner asset changes Molly's.
- **Console inside Molly hides its own banner:** AppShell leaves frame banners out when the host hides the banner
  (embed@1 `hidden: banner`); the strip draws them once. Works for every console frame Molly opens (it is per frame,
  from the URL Molly builds), so multi-instance tabs get it too.
- **Nothing lost:** chips, approvals and the Follow Amber badge come up in the strip (they are the console's own banner
  widgets, drawn by the console in the strip frame).
- **axHub web and AmberX** in Molly: their frames are marked `embedUrl(…, 'molly', ['banner'])` (or xLayout's guest URL),
  and both were re-baked with the AppShell change.
- **"What happened to the banners?"**: the shared look had saved the banner group as floating; inside the thin strip
  frame a floating group was clipped to nothing. The strip's group is now always docked.

## Contract changes
- `banner-strip@1` (`framework/react/bannerStrip.ts`, web only): `size` may carry `bar: true`; new host → strip
  `{ type: 'bar', on }`. Older strips ignore `bar` (host keeps its own bar). No Android twin (web only).
- `AxfRuntime.banner({ ownChoice })`, `Banner({ asHost })`, `BannerGroup({ docked })`, `FrameBanners({ docked })`.

## Tests
- `follow-amber/web/check.mts`: 13 → 14 (Molly-style embed URLs: only the whole console pops up; no frame).
- `framework/spec/check-banner-strip.mts`: 29 → 33 (`bar` messages).
- approvals-banner 11, lazy-loader 12, deploy self-test 45, check-widgets 248, theme / controls / toolbars,
  help-coverage, shared-assets, tsc (console, Molly): pass.
- Headless end-to-end (Playwright, live console API + new builds of the console and Molly, fake hub feed): desktop and
  phone, Molly and standalone.

## Gaps
- Live end-to-end with Brett's hub session not run (headless). Deciding inside the pop-up from the console or Molly still
  needs axHub to list those origins in `AXHUB_APPROVALS_FRAME_ANCESTORS` (then `setApprovalsHost({ frame: true })`).
