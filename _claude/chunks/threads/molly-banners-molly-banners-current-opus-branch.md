<!-- memory-chunk@1 source=_claude/THREADS.md lines=275-280 tokens=302 -->
### Molly banners (`molly-banners`, Current, Opus) — branch `claude/molly-banners`, PR #294
- Asked: "Install the banners in Molly." One banner region in Molly fed live by the console's banner plugins; taps act as in the console; same settings; per-banner show/hide in Molly; don't touch banner-pack #251 / banner-editor #254 / banners-one.
- Done: framework banner strip (`framework/react/bannerStrip.ts`, `components/BannerStrip.tsx`, AppShell page `view:axf-banners`), Molly plugin `apps/molly/plugins/banners`, re-bakes, `framework/spec/check-banner-strip.mts` (CI). Report `_claude/builds/reports/molly-banners.md`.
- Left: Brett's UI Review (r-20261104-269b05db); after merge, redeploy Console then Molly (the strip page must be live on console.amberxai.com); check on the live site that a banner item that opens a console view (Build manager, a settings tab) opens it in the Console frame.
- Checks: `npx -y tsx framework/spec/check-banner-strip.mts`; `cd apps/molly && npm run build`; check-theme; check-controls; `AXF_PLUGINS_DIR=apps/molly/plugins node framework/cli/plugin-lifecycle.mjs check banners`.
- First message: "Carry on molly-banners from s5 on branch claude/molly-banners (PR #294)."
