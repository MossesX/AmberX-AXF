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
- s7: all checks green (below), THREADS row, PR.

## How each piece is reached (API parity)

- Safe area: no UI of its own; tokens `--fx-safe-*` on `<html>` (the console app sets them), CI `check-safe-area.mjs`.
- Wrapper detection and browser fallbacks: console actions `native.notify|open|permission|wake|update|state|overlay|recorder`
  over REST `POST /api/console/action`, MCP `console_action`, CLI `axf console action native.<x>:<args>` and voice;
  state on `panel:phone-app` (`env`, `browser` added) via REST `/api/console-control`, MCP `console_control`,
  `axf console control state panel:phone-app`.
- Live update: `native.update:check|reload|state` (same four channels); automatic otherwise.

## Checks

check-safe-area (+ test 6), browserFallback.test 5, liveUpdate.test 4, nativeRules.test 7, check-theme, check-controls,
check-toolbars, check-chrome-assets, check-console-control, control-inventory --check, plugin-lifecycle ui-review,
`tsc --noEmit` (console-web): all pass.

## Gaps

- No phone screenshots of the real console: the dev console here can't reach axHub, so it only shows the waiting
  card. The safe-area padding was measured instead (48px simulated status bar → frame pads 48px, first bar at y=48).
  Nothing submitted to UI Review for that reason; the shots come with the CI APK on the phone.
- The other apps' vendored axf.css copies (amberx-droid, molly, axhub-web, walkthrough-studio, demo) pick up the
  tokens on their next framework sync; the CI check covers the framework and console copies.
- No Kotlin twin: web console side only.
