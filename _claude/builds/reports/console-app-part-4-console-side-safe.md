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
