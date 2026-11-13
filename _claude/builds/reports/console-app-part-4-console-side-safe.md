# Console app part 4: console-side safe areas and wrapper support

Build `console-app-part-4-console-side-safe`, part 4 of 4 of `console-android-app-thin-webview-wrapper`.
Web console side only (apps/console-web, framework).

Brett (2026-11-13 18:41): "split the console wrapper so it runs on four slots at the same time; AmberX's banner was
behind the camera, the clock and the notification panel"

## Base

The parent build (PR #637, branch `claude/console-android-app-thin-webview-wrapper`) already added the `--fx-safe-*`
tokens, `.fx-frame` padding, `window.axfNative` (synchronous `axfNativeHost`) and the shell-side content update.
Part 3 (branch `claude/console-app-part-3-native-bridge-mic`) adds the asynchronous `axfBridgeHost` bridge.
This branch is stacked on the parent so the tokens and bridge are shared rather than duplicated; until #637 lands
the PR diff includes the parent's commits.

## Steps

- s1: stacked on the parent; control inventory regenerated after the merge.
- s2: every layer fixed to a screen edge (dialogs, drawers, sheets, toasts, corners, help panel and intro, watch-live
  float, "new version" bar) adds its `--fx-safe-*` inset; the frame already pads the top bars and bottom nav.
- s3: `wrapperEnv()` (browserFallback.mjs) treats part 1's `axfNativeHost` or part 3's `axfBridgeHost` as the app and
  sets `<html data-axf-wrapper="app|browser">`; `native.*` actions use the browser's own features without part 1's host.
- s4: index.html is served `cache-control: no-cache`; an open page compares its entry bundle with the live one (on
  return to screen, every 30 min) when the shell has no native update check.
- s5: `framework/cli/check-safe-area.mjs` + test in CI; it caught the UI Review full-screen viewer under the status
  bar (fixed). Help for `native.*` in a browser; catalog `cx.phoneweb.*` built.
- s6: the four parts run side by side: routing keys on part 1's host, detection on either host, so a shell with
  only part 3's bridge never dead-ends. Measured with a simulated 48px status bar on a 412px phone viewport: the
  frame pads 48px and its first bar starts at y=48; desktop stays at 0.
