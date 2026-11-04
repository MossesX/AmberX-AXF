# Banners (Molly plugin)

Molly's one banner region (Brett, Nov 3 2026: "Install the banners in Molly."). The Dev Console draws its own live
banners in a strip at the top of Molly, so every banner it has shows here with its own Banner settings, colours and
order, and a banner plugin added to the console shows in Molly with no change here:

- the `banners` plugins (systems check, keys needed, What's new, builds, approvals, branches not on main, activity,
  codebase changes, Claude handoff, pass) in the console's `app.frame.banners` slot;
- the chips its plugins attach to its banner bar (alerts bell, Plan, What's new, Claude badge, build profile, main
  build status, axHub).

How it works (`framework/react/bannerStrip.ts`, `framework/react/components/BannerStrip.tsx`):

- Molly frames `https://console.amberxai.com/?axf-embed=molly&axf-embed-page=view:axf-banners`, an embed@1 view page
  that AppShell draws as the banner strip (no engine change: view pages already existed). The strip reports its height
  (`banner-strip@1` `size`), and while something it opened (dialog, menu, popover, toast) needs more room it asks for the
  whole window (`overlay: true`); Molly then lays the strip's frame over its window and tells it where its banners sit
  (`inset`) so they don't move.
- A banner item that opens a console view (Build manager, settings tab, …) opens it in the console's own frame through
  a same-origin BroadcastChannel (`axf.banner-strip`), and Molly brings the Console on screen (`open`).
- The apps Molly frames hide their own banner: xLayout's merge rules when xLayout is on, this plugin's `frameUrl` hook
  (embed@1 `hidden: banner`) when it isn't.
- Settings → Plugins → Banners: show the strip; show / hide each banner inside Molly (writes that banner's own
  "Hide it inside a host app" in the console, so the console's Banner settings and Molly agree). View → Banners toggles
  the strip.

```bash
node apps/molly/plugins/banners/install.mjs
node apps/molly/plugins/banners/uninstall.mjs --all
AXF_PLUGINS_DIR=apps/molly/plugins node framework/cli/plugin-lifecycle.mjs check banners
npx -y tsx framework/spec/check-banner-strip.mts
```

Known gaps: a banner item that opens a view after setting something only the strip's copy of the console knows (the
Build manager's focused row) opens the view in the console frame without that focus; the console runs twice in Molly
(the strip and its frame), so its banners poll twice.
