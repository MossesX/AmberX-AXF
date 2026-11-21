# The floating overlay and approvals bar (`overlay@1`)

Console app part 2 (build `console-app-part-2-native-floating`, first written on branch
`claude/console-app-part-2-native-floating-2`), on the shell contract from part 1
(`apps/console-droid`, package `ai.amberx.consoleapp`, `window.axfNativeHost` wrapped by the console as
`window.axfNative`, `native.*` console actions, `ShellRules`, `Perms`, `Insets`).

Brett, Nov 13 2026: "make the console an Android app, just a wrapper for the web app, keep it floating on top" and
"split the console wrapper so it runs on four slots at the same time". The toolbar floats over every app
(draw-over-apps), expands to the full-screen console with the toolbar docked top-left, keeps the app in front, and pops
an approval bar with a link to the approvals page when an approval waits. Native code only where Android requires it:
the window over other apps, the permission, the foreground service. What the bar says, what counts as waiting and
every setting are the web console's.

Code: `OverlayContract.java` (the names, pure Java, JUnit `OverlayContractTest`), `OverlayRules.java` (the pure
rules, `OverlayRulesTest`), `OverlayService.java` (the Android side), the overlay methods of `NativeBridge.java`.
Console side: `apps/console-web/src/native/nativeRules.mjs` and `axfNative.ts` (part 1), whose lists are the twins
of the ones here.

## States

| State | What shows |
| --- | --- |
| `toolbar` | A small bar at the side of the screen: the Console button and the approvals badge. Drag it anywhere; it settles on the nearer edge and remembers the height. |
| `approvals` | The toolbar with the approval bar opened out of it: what waits ("Run deploy — 2 more"), an "Open approvals" link, a dismiss button. |
| `expanded` | The full-screen console (the app's one WebView) in the overlay window, in front of whatever app was showing, the toolbar docked top-left inside the safe area. |

## Verbs

`expand`, `collapse`, `toggle`, `approvals` (open the console on the approvals list), `dismiss` (hide the bar
until a new approval arrives; the expanded console stays). `OverlayRules.verb(state, verb)` is the transition table.
With the overlay off or not allowed, `expand`, `toggle` and `approvals` open the app itself (it is the full-screen
console then); `collapse` and `dismiss` do nothing.

## The four ways in, all the same

| Way | How |
| --- | --- |
| Console API (REST) | `POST /api/console/action` with `native.overlay:<verb>`; state: `GET /api/console/control` → `state` on `panel:phone-app` |
| MCP | `console_action` `native.overlay:<verb>`; `console_control` `state panel:phone-app`; `console_open` target `approvals.view` |
| CLI | `axf console action native.overlay:<verb>`; `axf console control state panel:phone-app`; over USB: `adb shell am start-foreground-service -n ai.amberx.consoleapp/.OverlayService -a ai.amberx.consoleapp.OVERLAY --es verb <verb>` |
| Voice (AmberX) | "expand the overlay", "open approvals", "hide the bar": the same `native.overlay:<verb>` action |
| The page | `window.axfNative.call('overlay', verb)`, `call('overlayState')`, `call('overlayConfigure', json)`, `call('overlayApprovals', count, held, firstTitle)`, `call('overlayItems', json)`; events `on('overlay' \| 'overlay.moved' \| 'approvals.open' \| 'permissions', fn)` |
| Deep links | `axf-console://open/approvals.view` (the approvals list in the app); a console URL with `?axf-overlay=expand\|collapse` (axHub's `amberx.open_url`) is a verb, not a page |

Outside the app (a desktop browser) the actions answer that the Android console app is not running this page.

## State (every API reads the same JSON)

```json
{"running":true,"state":"toolbar","waiting":2,"held":0,"dismissedAt":0,
 "on":true,"edge":"end","top":30,"size":"small","expand":"every","idleOpacity":85,
 "show":"next","label":"Runs in 1:05 · +1"}
```

`overlayState()` wraps it as `{ok, overlay, canDraw}`; `canDraw` is the "Display over other apps" permission.
The `overlay` event carries it on every change; `native.state` carries it inside the phone app's state.

## Settings

The console's own, under Settings → Plugins → Approvals banner, keys `approvals-banner.overlay.*`; the page hands
them to the shell with `overlayConfigure` whenever they change, and a drag hands `edge` / `top` back
(`overlay.moved`), so the console stays the one place they live.

| Key | Values | Default |
| --- | --- | --- |
| `on` | boolean | `true` |
| `edge` | `end` (right), `start` (left) | `end` |
| `top` | 0–90, percent of the screen height | `30` |
| `size` | `small`, `medium`, `large` | `small` |
| `expand` | what pops the bar: `every`, `held`, `never` | `every` |
| `idleOpacity` | 40–100, toolbar opacity while nothing waits | `85` |
| `show` | what the toolbar says while something waits: `next` (the next held command's countdown), `count` | `next` |

## What waits, one by one (`overlayItems`)

The approvals banner hands the shell every waiting item whenever the list changes:
`[{"id":"held:abc","kind":"held","title":"Deploy","runsAt":1763400000000,"shelved":false}, {"id":"approval:x","kind":"approval","title":"Restart nginx","runsAt":0,"shelved":false}]`
(`runsAt` epoch ms, 0 for approvals and shelved commands). The shell sorts them (running countdowns soonest first, then
shelved, then approvals), shows the toolbar label (`show`), the bar's line with the first item's title and countdown
("Deploy — 1 more · Runs in 1:05 unless you stop it", re-rendered once a second while a countdown runs), and pops the
bar only for an id it hasn't shown yet: one Brett dismissed or already saw keeps the toolbar small. Once items arrive
they replace `overlayApprovals`' counts. Rules: `OverlayRules.order / toolbarLabel / countdown / afterItems / forget`
(JUnit `OverlayItemsTest`); console side `overlayItems()` in `plugins/approvals-banner/web/overlay.ts`.

## Permission flow: "Display over other apps"

Short name `overlay` (`android.permission.SYSTEM_ALERT_WINDOW`). `axfNative.permissions()` reports it,
`axfNative.requestPermission('overlay')` / `native.permission:overlay` opens Android's settings page for the app;
coming back, `Perms.resumed` reports a `permissions` event and starts the toolbar when it is on. Without it the
toolbar never shows and every verb falls back to the app.

The flow (`OverlayPermission`, JUnit `OverlayPermissionTest`): one tap asks; the shell first says in one line why
("Let the console float over other apps … find AXF Console and switch it on") with **Open settings** / **Not now**,
because Android's page is a bare list of apps. Coming back it checks the permission: granted starts the toolbar and
says "Floating toolbar is on"; still off says so. The `permissions` event then carries `overlayFlow`
(`granted` / `still-off`) next to `mic`, `notifications`, `overlay`. On the app's first start with the toolbar on and
the permission missing, the same explanation is offered once; after that only an ask brings it back (the console's
`native.permission:overlay` through REST, MCP, the CLI or voice; `axfNative.requestPermission('overlay')`).

## Safe areas

`SafeArea` (pure, JUnit `SafeAreaTest`) places everything from the screen's insets {top, right, bottom, left}: status
bar and cutout, navigation bar, keyboard, on whichever side Android puts them.

- **The floating toolbar** keeps clear of a side cutout or navigation bar in landscape (`toolbarX`), and its height
  stays between the status bar / camera and the navigation bar or keyboard (`toolbarY`, drags too: `clampY`). The
  toolbar window reads the screen's insets itself (`WindowMetrics`) and moves back inside on rotation.
- **The expanded console**: the docked toolbar sits in the safe top-left corner (`dock`); the shell owns the top strip
  (status bar + toolbar) and the page gets the other three sides as `--fx-safe-*` (`rootPadding` / `pageInsets`), so no
  side is padded twice or not at all. Before the page pads itself, the shell pads all four sides.

## With Phone Connect (`console-overlay@1`)

Phone Connect (`apps/phone-connect`, phone-connect@1) runs the console's `open_url` command (`browser.open`). When the
command asks for the overlay (`where: overlay`, the default) and this app is installed, Phone Connect hands the page to
this app first: one synchronous `ContentResolver.call` on `content://ai.amberx.consoleapp.overlay`, method `open`, the
url as the argument, `where` in the extras. The page loads in the one console WebView and the toolbar expands over
whatever is on screen: the same path as axHub's `amberx.open_url` (`DeviceLink.open`), so `?axf-overlay=expand|collapse`
urls run the verb. The answer is `{ok: true, json}` (`json` = the open answer: `url`, `verb`, `where`, `overlay`), and
Phone Connect reports `how: "console-overlay"` in its phone-result@1.

With the toolbar switched off but "Display over other apps" granted, the app itself comes to the front on the page
(`how: "console-app"`): the permission is Android's exemption from the background-start block, so there is no
tap-to-open notification. Android drops a blocked start without raising anything, so the provider answers `ok` only
once the page is on screen (the overlay took it, or the activity resumed within 2 s); otherwise `unavailable`.

This app declines, and Phone Connect opens the page itself, when: `where` is `browser` (code `browser`), "Display
over other apps" isn't granted (`no_overlay`; Phone Connect then starts this app's activity itself when it holds the
permission), the url isn't on Brett's sites (`validation`), or the page did not come up (`unavailable`).
Only Phone Connect's package (`ai.amberx.axf.phoneconnect`) and this app may call (`denied` otherwise); Android vouches
for the calling package. `call("state")` answers `{overlay, canDraw, on, visible}` (`visible`: the app is on screen).

Code: `PhoneConnectRules.java` (pure, JUnit `PhoneConnectRulesTest`, which also checks the Kotlin twin
`apps/phone-connect/.../watch/ConsoleOverlay.kt`, Phone Connect's `<queries>` entry and its application id),
`PhoneConnectProvider.java` (the Android side). Phone Connect side: `ConsoleOverlay.kt`, `LinkRules.wantsOverlay`,
the `browser.open` handler in `Commands.kt`.

## What part 1 built and what part 2 adds

Part 1 (build `console-android-app-thin-webview-wrapper`, PR #637) ported a slimmed `ApprovalOverlay` from AmberX:
the three states, drag and settle, the badge, the bar text, the dismiss rule, the expanded window with the docked
toolbar, the settings sync and the `native.overlay` action. Part 2 builds on it in this module only:

- the contract above (this step), pinned by `OverlayContractTest`;
- the rest of the `overlay-toolbar-v2` port: per-item countdowns for held commands (`ApprovalOverlayRules.clock`,
  `countdown`), the toolbar label while items wait, "seen" items that stop re-popping the bar, the first item's real
  title from the page;
- the one-tap permission flow with an explanation before Android's settings page and a check on return;
- safe areas for the toolbar on every edge in landscape (left and right cutouts, the navigation bar at the side);
- tests for each, help entries for the new verbs or settings, Shipped features.
