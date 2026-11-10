# Banners (Molly plugin)

Molly's one banner region (Brett, Nov 3 2026: "Install the banners in Molly."). The Dev Console draws its own live
banners in a strip at the top of Molly, so every banner it has shows here with its own Banner settings, colours and
order, and a banner plugin added to the console shows in Molly with no change here:

- the `banners` plugins (systems check, keys needed, What's new, builds, approvals, branches not on main, activity,
  codebase changes, Claude handoff, pass) in the console's `app.frame.banners` slot;
- the chips its plugins attach to its banner bar (alerts bell, Plan, What's new, Claude badge, build profile, main
  build status, axHub).

How it works (molly-one-shell s11): the console's native surface (`apps/console-web/src/surface.tsx`, shell-surface@1)
shows its banner slot through the reserved part `axf-banners`; this plugin mounts it in Molly's `app.frame.banners`
slot (`NativeView`), in Molly's own page. No frame, no banner-strip messages. A banner item that opens a console screen
navigates the console, and Molly shows that screen (`console/<screen>`).
