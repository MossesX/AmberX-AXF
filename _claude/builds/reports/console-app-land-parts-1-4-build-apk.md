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
