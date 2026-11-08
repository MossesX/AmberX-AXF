<!-- memory-chunk@1 source=_claude/memory/docs/patches-banners.md lines=10-26 tokens=380 -->
## How it works
- **Console on its own:** exactly as before — plugin banners on its page and the App tabs bar (Console / Pilot /
  axHub). The App tabs plugin removed with Patches is back (0.2.0).
- **Console as a tab in Patches** (embed@1 marker in the user agent): no plugin banners on the page and no tab group
  (App tabs contributes no bar, cover or Apps-menu tab entries inside any host app). Patches runs the tabs and shows
  the banners in its strip. The console's own menu-rescue note still shows.
- **Banner strip:** `https://console.amberxai.com/?axf-strip=banners` is the same console app rendering only the
  plugin banners (`src/bannerStrip.tsx`). It waits for axHub's look like the rest of the console.
- **Patches:** `views/BannerStrip.kt`: a web view above the banner and tab row (all tabs), loaded once the Console
  tab has reached the console (session good), console origin only, links out open in the browser. Height follows the
  banners through the `AxfPatchesStrip.height(px)` bridge (0 = hidden), capped at 45 % of the screen.
  Settings → Patches → **Banners above every tab** (`patches.banners`, default on).
- **Taps:** what a banner opens (an action a tap dispatches, any dialog, any view — an approval opening by itself
  included) goes to the Console tab over a same-origin BroadcastChannel (storage-event fallback) and
  `AxfPatchesStrip.open("console")` brings that tab up. The Console tab only runs relayed messages while it is
  embedded in Patches (`rt.embedded.host === 'patches'`).
