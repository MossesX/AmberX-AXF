# Console app part 2: native floating overlay and approvals bar

Build `console-app-part-2-native-floating` · branch `claude/console-app-part-2-native-floating` · phase 2 on Opus
(phase 1, the `overlay@1` contract, on Fable).

Brett, Nov 13 2026: "split the console wrapper so it runs on four slots at the same time".

## What landed

- **s1 (Fable)** `overlay@1` contract on the part 1 shell (`OverlayContract`, `OVERLAY.md`); the wake listener reads the real bridge.
- **s2** The rest of the `overlay-toolbar-v2` port onto the console app's floating toolbar: per-item countdowns for held
  commands, the toolbar label (`show`: next countdown or count), the bar's line with the first item's real title and
  countdown (re-rendered once a second), and "seen" items that don't pop the bar again. New bridge method
  `overlayItems`; the approvals banner sends the list when it changes (`overlayItems()` in its `web/overlay.ts`).
  State JSON gains `show` and `label`.
- **s3** "Display over other apps": one line on why before Android's page, a check on return (toolbar starts when
  granted, a toast says the outcome either way, the `permissions` event carries `overlayFlow`), offered once on the
  first start with the toolbar on (`OverlayPermission`).
- **s4** Safe areas (`SafeArea`): the toolbar clears side cutouts and navigation bars in landscape and stays between
  the status bar and the bottom bar or keyboard (drags too), reads the screen's insets itself and moves back on
  rotation; the docked toolbar sits in the safe top-left corner; the shell owns the top strip when docked and the page
  gets the other three sides, so no side is padded twice.
- **s5** Help for the label, seen items, safe areas and the permission flow (console app + AmberX).
- **s6** Main merged in; the four console-app parts mapped to their files and PRs (`apps/console-droid/README.md`). A
  trial merge with parts 3 and 4 is clean on every source file; only generated data overlaps.

## How each piece is reached (all four ways the same)

| Piece | REST / MCP / CLI / voice | State |
| --- | --- | --- |
| Toolbar verbs | `native.overlay:<expand\|collapse\|toggle\|approvals\|dismiss>` (`POST /api/console/action`, MCP `console_action`, `axf console action`, voice) | `panel:phone-app` state → `overlay` (now with `show`, `label`) |
| Toolbar label | setting `approvals-banner.overlay.show` (Settings → Plugins → Approvals banner; console settings API, MCP, CLI, voice) | same |
| Permission | `native.permission:overlay` | `permissions` in `native.state`; event `permissions.overlayFlow` |
| Approvals page | `console_open approvals.view`, deep link `axf-console://open/approvals.view` | — |

## Tests

- JUnit (pure Java, run here in an `eclipse-temurin:17-jdk` container; CI runs them in the Gradle job): 46 tests
  green, new `OverlayItemsTest`, `OverlayPermissionTest`, `SafeAreaTest`, `OverlayContractTest` updated.
- `nativeRules.test.mjs`, approvals-banner `test.mts` (new `overlayItems` check), console `tsc --noEmit`.
- check-theme, check-controls, check-console-control, check-toolbars, check-chrome-assets, help-coverage `--check`.

## Not verified here

- The Android-side classes (`OverlayService`, `NativeBridge`, `Perms`, `Insets`, `ConsoleActivity`) were not compiled
  locally (no Android SDK on the VPS); CI's Gradle job compiles them and builds the APK.
- No phone shots: they need the new APK on the phone.

## Still open

- Parts 3 (#791) and 4 (#792) land on their own.
- From part 1: the Audio Output Recorder and the wake listener's on-device backend still live in AmberX.
