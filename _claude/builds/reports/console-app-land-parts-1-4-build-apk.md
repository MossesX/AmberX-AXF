# Console app: land parts 1-4 and build the APK (draft)

Brett (Nov 13 2026, 23:41): "is that new APK ready for download"

Status: draft, s1 (survey). Phase 1 (Opus).

## The five branches (origin, fetched Nov 14 2026)

| Part | Branch (`claude/…`) | PR | Ahead / behind main | What it adds |
|---|---|---|---|---|
| 1 | `console-android-app-thin-webview-wrapper` | #637 | 11 / 512 | `apps/console-droid` (WebView shell, `NativeBridge.java`, overlay service, insets, wake, update), `src/native/axfNative.ts` + `nativeRules.mjs`, help, inventory, axf.css safe-area tokens, android.yml (JUnit + APK build step) |
| 2 | `console-app-part-2-native-floating-2` | #639 | 13 / 372 (stacked on part 1) | `overlay@1` contract for the floating toolbar and approvals bar (`OverlayContract*`) |
| 3 | `console-app-part-3-native-bridge-mic` | #633 | 8 / 482 (NOT stacked on part 1) | `native-bridge@1` (`BridgeContract`, `DeviceBridge`, `MicRules/MicTools`, `HubLink`, `SlotHost`), `bridgeClient.mjs`, `deviceActions.mjs`, `device.*` actions, catalog/status |
| 4 | `console-app-part-4-console-side-safe` | #640 | 19 / 373 (stacked on part 1) | safe area for every edge-fixed layer, `browserFallback.mjs`, `liveUpdate.mjs`, `check-safe-area.mjs`, catalog/status |
| Wake | `console-app-wake-word-voice-listener` | #643 | 2 / 371 | `plugins/wake-listener` (wake phrases, voice catalog, spoken wizard, voice approvals), `core/build-id.mjs`, PORTING gap |

The Android app is `apps/console-droid` (package `ai.amberx.consoleapp`), not `apps/console` (that is the older Kotlin
Dev Console, whose APK is the existing `console-debug.apk` artifact).

## Landing order

One stack in the merge queue, in this order: **#637 (part 1) → #639 (part 2) → #633 (part 3) → #640 (part 4) → #643 (wake)**.
Parts 2 and 4 already contain part 1's commits; part 3 and wake are based on plain main. Each branch gets main merged in
and then the part below it, so every PR in the stack is a strict superset of the one ahead of it.

## Expected clashes

| File | Branches | Plan |
|---|---|---|
| `apps/console-web/src/control/inventory.json` | all five | generated: regenerate, never hand-merge |
| `apps/console-web/src/assets/help/console.json` | 1, 2, 3, 4 | union of help entries |
| `_claude/THREADS.md` | 1, 3, 4, wake | union of rows |
| `.github/workflows/android.yml` | 1, 3, 4 | keep every added test line once |
| `framework/catalog/catalog.json`, `status.json` | 3, 4 | union, then `tracker.mjs` regenerates `tracker.json` |
| `framework/ui/axf.css`, `src/axf/ui/axf.css` | 1, 4 | part 4 extends part 1: take part 4 |
| `src/native/axfNative.ts` | 1, 4 | part 4 extends part 1: take part 4 |
| `DeviceRules.java` / `DeviceRulesTest.java` | 1, 3 (add/add) | one class with both rule sets, no duplicate names |
| `window.axfNative` (`NativeBridge` / `axfNative.ts` vs `DeviceBridge` / `bridgeClient.mjs`) | 1, 3 | part 3 was designed to coexist (`axfNativeHost` vs `axfBridgeHost`, `installBridge` merges both); check no duplicate method names, both registered in `WebHost`, manifest permissions present |
| mic ownership | 3 (`MicTools`), wake (`wake-listener`), 1 (`Wake.java`) | one audio path: the listener and mic capture share it |
| `apps/console-web/src/main.tsx`, `App.tsx` | 1, 3 | keep both installs |

## APK

`android.yml` on part 1 runs `gradle :app:testDebugUnitTest :app:assembleDebug` in `apps/console-droid`, but uploads
no artifact for it: the existing `console-debug.apk` artifact is the old `apps/console` app. Part 1 needs an
`upload-artifact` step for the console app APK so there is something to download.

## Merges (s2-s10)

Worked in a detached worktree (`/root/axf-builds/cal-stack`) and pushed each result to its own branch, so the five
finished builds' worktrees were left alone. Generated files were regenerated with `AXF_DATA_DIR=off` (on this host
`tracker.mjs` otherwise reads the hub's saved copy of `status.json`, not the branch's).

| Step | Merge | Clashes | Resolution |
|---|---|---|---|
| s2 | origin/main → part 1 (#637) | `control/inventory.json` | regenerated (`control-inventory.mjs`) |
| s3 | part 1 | — | added the `console-app-debug.apk` upload (apps/console-droid) and its build log to the "CI build errors" report; checks green (tracker, `axf validate --framework`, project validate, theme, controls, console-control, toolbars, chrome assets, nativeRules) |
| s5 | part 1 → part 2 (#639) | `control/inventory.json` | regenerated |
| s6 | part 2 → part 3 (#633) | `DeviceRules.java` (add/add), help `console.json`, `status.json`, inventory | see below |
| s7 | bridge check | — | nothing to fix (below) |

**s6, part 3 on parts 1+2.** Part 3 was written against part 1's classes but on plain main, so its Java had never been
compiled and was never wired in. Part 3's own design keeps its bridge in a separate class (`DeviceBridge`, JS host
`window.axfBridgeHost`) next to part 1's `NativeBridge` (`window.axfNativeHost`), and `bridgeClient.mjs` merges both into
one `window.axfNative`. That design was kept instead of folding both into `NativeBridge.java`: the two classes share no
method, field or JS name, and folding them together would have broken part 3's contract test (tool list =
`BridgeContract.java`).
- `DeviceRules.java`: one class with both rule sets. Part 1's hello app name became `APP_ID` (`console-droid`), so `APP`
  stays the `where` value both sides use. `where()` is part 3's case-insensitive version, and part 1's tests still pass.
- `WebHost.get`: attaches `DeviceBridge` and registers `DeviceTools` and `MicTools` next to `NativeBridge.install`.
  `onPageFinished` builds `window.axfNative` on Brett's other pages, and `onPermissionRequest` denies page audio when the
  phone's mic switch is off (`MicTools.webCaptureAllowed`).
- One axHub link: part 1's `DeviceLink` stays the device service (started at launch, handles the overlay verbs from
  part 2's contract). Part 3's `HubLink` is not started, so the phone says hello to the hub once. Gap: `device.*`
  tools beyond `browser.open` are not reachable from axHub yet. They can be reached from the page, REST, MCP, the CLI
  and voice through the console.
- Gap: `SlotHost` (four console slots) is not wired yet. That needs `ConsoleActivity` to host several WebViews, so
  `slots.*` calls answer `not_implemented`.
- Help entries and `status.json` (`cx.phonebridge` + main's `cx.contextmenu.consolesettings`) unioned. Inventory
  and tracker regenerated.

**s7, bridge check.** Every method `axfNative.ts` calls on `window.axfNativeHost` is an `@JavascriptInterface` on
`NativeBridge` (`recorder` is optional on the TS side and absent in Java, so the page falls back). `bridgeClient.mjs`
`LEGACY_METHODS` match. `DeviceBridge` exposes only `call(json)` on `axfBridgeHost`, as `bridgeClient.mjs` expects.
Permission keys `mic` / `notifications` / `overlay` are the same in `Perms`, `BridgeContract` and `MicRules`, and the
manifest declares `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `POST_NOTIFICATIONS` and `SYSTEM_ALERT_WINDOW`. Node tests:
bridgeClient 10/10, deviceActions 5/5, nativeRules 7/7.

**s8, part 4 on parts 1-3.** Clashes: `framework/catalog/catalog.json` (`cx.phoneweb` and `cx.phonebridge`, unioned)
and the inventory (regenerated). These pass on the merged tree: check-safe-area (and its test), browserFallback 5,
liveUpdate 4, nativeRules 7, bridgeClient 10/10, deviceActions 5/5, theme, controls, console-control, inventory
`--check`, and help-coverage at the ratchet.

**s9, part 4 API check.** Part 4 adds no new view, tab or button. Its one visible piece is the console's existing
"new version" bar (`loader.markStale`), which it drives through `native.update` (`check` / `reload`), a console action:
REST `/api/console/actions`, MCP console actions, `axf console`, and voice through console-commands. Phone state can be
read from `panel:phone-app` (part 1, `native.state`) and `panel:phone-bridge` (part 3, `device.state`), using the
`console_control` state verb. `check-console-control.mjs` passes (0 on every count except the frozen rawButtons
baseline). Gap noted: the `native.*` actions are registered in a loop over `nativeRules.mjs`, so the static
`control/inventory.json` scanner (literal ids only) doesn't list them. They are live at runtime and have help entries.
The `device.*` actions are listed.

**s10, wake word on parts 1-4.** Only the inventory clashed (regenerated). Mic ownership: the phone has one audio path,
the WebView's capture. `WebHost.onPermissionRequest` gates it with part 3's mic switch (`MicTools.webCaptureAllowed`)
and then Android's `RECORD_AUDIO`. On the page, the listener takes `mic-lease@1` (the same lease the Assistant mic,
dictation and voice notes use), so only one of them listens at a time. Part 3 has no native capture of its own. The
native `listener.*` recognizer is still a deferred twin (`framework/spec/PORTING.md`), so in the app the listener uses
the WebView's SpeechRecognition. Checks: wake-listener 82/82, plugin-lifecycle clean, theme, controls, console-control,
toolbars, chrome assets and help-coverage all pass.

**s13, web tests on the top of the stack (wake head).** Before: `tsc --noEmit` failed with 11 errors in
`wake-listener/web/engine.ts`. The listener typed its window as `Window & { axfNative?: NativeBridge }`, which
intersected with the console's global `Window.axfNative` (parts 1/3/4) into `unknown`. Fixed on the wake branch: the
listener now uses `Omit<Window, 'axfNative'>` and reads only the bridge part it needs. After: typecheck clean and
`npm run build` green (vite, 12 s). Part 4's head typechecks clean on its own too. Also passing: check-builds-store 40,
console-commands 10, wake-listener 82/82, plus the checks listed under s8-s10. theme-swap needs Playwright, which this
host does not have, so CI's run of it on the PRs is the result.

## CI round 1 (s11-s12)

PR CI here is the light check only (the full run with Gradle happens once, in the merge queue). Round 1 came back red on
all five PRs. Fixes, in the order found:

1. **Light check, all PRs: `approvals-banner` TS2339 `overlayCommand` / `overlay` on `VetoHost`.** CI copies `framework/`
   over `apps/console-web/src/axf` before `tsc`. `framework/libs/hub/veto.ts` was missing the three overlay members that
   only the console's copy had (main has the same drift). Fixed on part 1 (`framework/libs/hub/veto.ts` now matches the
   console copy) and merged up the stack. Before: 3 TS errors. After: CI's exact light check (copy, bake, sync, tsc) is
   clean locally, and the rest of the light list passes (validate, tracker, project, builds-store verify, theme,
   controls, toolbars, console-commands 10, molly-guide 21 + 18, ci-scope 10).
2. **Build-engine sweep: `plugins.mjs --check`, wake-listener manifest.** `"banner": true` and `"opens": "settings"` are
   not valid any more. Changed to `banner: false` (the listener only puts a status light on a banner, it ships no banner)
   and `opens: false` (settings tab only).
3. **Gradle: `ConformanceTest > theme variables match the reference engine` (`--fx-opacity-dialog` expected 1, was
   null).** This is already red on main: main's last run with Gradle (`240263ee9`) fails the same way, and
   `framework/spec/PORTING.md` says the Kotlin test "will see the twelve new variables" until the Android twin of the
   surface opacity tokens lands. It is not from this stack, but it stops the Gradle job before the console app step.
   The Kotlin twin is kernel engine work (Fable, Android port on hold), so this Opus session did not write it.
   Instead, on part 1 the console app step and its APK upload run `if: !cancelled()` (the app has no framework module
   dependencies). The job still goes red, but the APK is built, tested and uploaded.
   **Needs Brett:** while this test is red, the merge queue's full run for any batch that touches Android is red, so
   the stack can't land. The fix is to port `SURFACE_KINDS` / `surfaceVars` into `StyleTheme` + `ThemeEngine.kt`
   (6 fields, 12 vars), as a Fable step.

One full android.yml run was dispatched on the top of the stack (wake branch) to compile parts 1-3's Java together and
run the console app's JUnit before the queue (part 3's Java had never been compiled). The first run stopped at the
kernel test. The second runs after fix 3.
