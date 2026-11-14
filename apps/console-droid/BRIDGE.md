# `window.axfNative` — the native bridge contract (`native-bridge@1`)

Console app part 3 (build `console-app-part-3-native-bridge-mic`), on the shell contract from part 1
(`apps/console-droid`, package `ai.amberx.consoleapp`, `ShellRules`, `ConsoleActivity`).

Brett, Nov 13 2026: "make the console an Android app, just a wrapper for the web app, keep it floating on top" and
"split the console wrapper so it runs on four slots at the same time". Native code exists only where Android requires
it: mic, recorder, open_url, console wake, notifications, permissions. Everything else is the web console, so each native
piece is one **tool** with one name, reached the same way from the page, from axHub, from the console API, the CLI and
voice. Code: `BridgeContract.java` (the pure rules, JUnit `BridgeContractTest`) and `DeviceBridge.java` (the Android side).

## Who may call it

Only pages on Brett's own domains (`ShellRules.bridgeAllowed`: https, `amberxai.com` and subdomains). The shell builds
`window.axfNative` on those pages and nowhere else; the offline page and any outside site never see it. A console in a
desktop browser has no `window.axfNative`, so it keeps working without the phone.

## From the page

```js
window.addEventListener('axf-native-ready', () => { /* fired once window.axfNative exists */ });

const info = await window.axfNative.call('bridge.info');            // { app, version, bridge, sdk, device, tools }
await window.axfNative.call('recorder.start', { session_name: 'Build night', mic: true });
const off = window.axfNative.on('recorder', (data) => { /* running, since, session, … */ });   // off() unsubscribes
try { await window.axfNative.call('mic.set', { on: true }); }
catch (e) { e.code /* 'permission' */; e.permissions /* ['mic'] */; }
```

`call(tool, args)` returns a Promise. Under it, the page posts `{ id, tool, args }` to the host object
(`window.axfBridgeHost.call(json)`), and the shell answers with a `CustomEvent('axf-native')` on `window` whose
`detail` is one of:

| Shape | Meaning |
| --- | --- |
| `{ id, tool, ok: true, data }` | the answer to the call `id` |
| `{ id, tool, ok: false, error: { code, message, permissions? } }` | the call failed; `permissions` lists the short keys to ask for when `code` is `permission` |
| `{ event, data }` | a native event: `recorder`, `mic`, `permission`, `wake`, `link` (the axHub device link went up or down) |

Error codes: `unknown_tool`, `bad_args`, `denied` (not Brett's site, or the hub asked for a page-only tool),
`permission`, `unavailable`, `not_implemented` (in the contract, code lands in a later step of this build).
A call id is 1-64 of `A-Z a-z 0-9 _ . : -`; a call is at most 64 KB.
The page side adds two codes of its own: `timeout` (no answer in 2 minutes) and `no_bridge` (not inside the app).

### Who builds `window.axfNative`

- **The console** builds it itself at load (`apps/console-web/src/native/bridgeClient.mjs`, `installBridge(window)` in
  `main.tsx`), before any plugin runs; console code calls `nativeTool(window, tool, args)`, which rejects with
  `no_bridge` in a desktop browser. Tested in Node against a fake host (`bridgeClient.test.mjs`, in CI), including a
  check that its tool list, events and aliases are the ones in `BridgeContract.java`.
- **Any other page on Brett's sites** gets the same object from `BridgeContract.script()`, which the shell runs on
  `onPageFinished`; it does nothing where the console already built it (same `version`).

### Living with part 1's object

Part 1 of the console app (build `console-android-app-thin-webview-wrapper`) exposes its own synchronous host,
`window.axfNativeHost`, one method per feature (`info()`, `overlay(verb)`, `insets()`, …), and assigns its own
`window.axfNative`. This bridge's host is `window.axfBridgeHost` and its Java class is `DeviceBridge`, so the two never
collide, and `installBridge` keeps one merged `window.axfNative` whichever lands first: a bridge tool (or alias) with an
args object answers a Promise; part 1's method names (`LEGACY_METHODS`) with positional or no args keep their
synchronous answer; `on(event, fn)` listens to both; the earlier object stays reachable as `axfNative.legacy`.

## Tools

| Tool | Args | Answer | From the hub | Capability | Needs |
| --- | --- | --- | --- | --- | --- |
| `bridge.ping` | | `{ pong, at }` | yes | | |
| `bridge.info` | | `{ app: "console-droid", version, bridge, sdk, device, tools }` | yes | | |
| `bridge.capabilities` | | `{ bridge, capabilities, tools, notYet, events }` | yes | | |
| `permissions.status` | | `{ mic, notifications, overlay }` (booleans) | yes | | |
| `permissions.request` | `{ permission }` (`mic` / `notifications` / `overlay`) | `{ permission, granted }` | no (prompts) | | |
| `mic.status` | | `{ on, available, reason }` | yes | `mic@1` | |
| `mic.set` | `{ on }` (also `mic.on`, `mic.off`) | `{ on }` | no (phone setting) | `mic@1` | `mic` when on |
| `recorder.start` | `{ session_name, group?, note?, mic? }` (AmberX's `RecorderControl.sessionOf`) | recorder status + `awaitingConsent` / `alreadyRunning` | yes, never auto-approved | `recorder@1` | `notifications`, + `mic` when `mic: true` |
| `recorder.stop` | | recorder status + `wasRunning` | yes | `recorder@1` | |
| `recorder.status` | | `{ running, since, session, group, parts, uploaded, currentFile, mic, micDefault, queue }` | yes | `recorder@1` | |
| `browser.open` | `{ url, where? }` (own domains only, `ShellRules.allowed`) | `{ url, opened, where, notified }` | yes | `open-url@1` | |
| `console.wake` | `{ target?, url? }` (a console-control address, else home) | `{ opened, where, notified }` | yes | `console-wake@1` | |
| `notify.show` | `{ id?, title, text?, url? }` (tap opens `url`, own domains only) | `{ id, shown }` | yes | `notify@1` | `notifications` |
| `notify.cancel` | `{ id }` | `{ id, cancelled }` | yes | `notify@1` | |
| `notify.status` | | `{ enabled, shown: [ids] }` | yes | `notify@1` | |

Every tool checks its permissions first and answers `permission` with the keys to ask for; the page then calls
`permissions.request` and retries. Starting a recording is never auto-approved (axHub decision #108, `NEVER_AUTO`).

## From axHub (the same tools, AmberX's names)

The shell is the `amberx` device service AmberX was (AXPP `hello` with `app: "console-droid"`, capabilities
`recorder@1`, `open-url@1`, `console-wake@1`, `mic@1`, `notify@1`), so axHub's MCP tools keep working with no hub
change. `BridgeContract.tool()` maps every spelling onto one bridge tool:

| axHub MCP tool | AXPP / bridge tool |
| --- | --- |
| `amberx.open_url` | `browser.open` |
| `amberx.recorder_start` / `_stop` / `_status` | `recorder.start` / `.stop` / `.status` |
| `amberx.console_wake` | `console.wake` |
| `amberx.notify` | `notify.show` |
| `amberx.mic_status` | `mic.status` |

Snake-case and hyphenated spellings (`open_url`, `recorder-status`, `console_wake`, …) map the same way, so the
console API, the CLI (`axf console …`) and voice can use their own spelling. The hub only gets the tools marked
"yes" above; a page-only tool answers `denied`.

## The axHub device link (moved from AmberX, s3)

`HubLink` is AmberX's `AxppLink` moved here: one background thread, `hello` / long-poll `next` / `answer` on
`https://axhub.amberxai.com/axpp/v1/` (`HubLinkRules`, JUnit `HubLinkRulesTest`) with the hub session from the
WebView's cookies, nothing sent anywhere else. Every hub call goes through `DeviceBridge.run`, so a hub call and a page
call run the same code and answer the same errors (AXPP `error` with the bridge's `code`, plus `permissions`).
The `hello` says `app: "console-droid"`, `service: "amberx"`, and lists only the capabilities this build has tools for.

| Moved | Tool | Code |
| --- | --- | --- |
| `amberx.open_url` | `browser.open` | `DeviceTools.open`: Brett's own https pages (`ShellRules.allowed`); in the app, or `where: "browser"` |
| `amberx.console_wake` | `console.wake` | `DeviceTools.wake`: `?axf-open=<target>` (`DeviceRules.wakeUrl`), over the lock screen; emits `wake` |
| `amberx.notify` | `notify.show` / `.cancel` / `.status` | `DeviceTools.notify*`, on part 1's `Notifier` channels |
| `amberx.recorder_start\|stop\|status` | `recorder.*` | **stays in AmberX** for now (see below) |

When Android refuses a start from the background, `browser.open` and `console.wake` post a one-tap notification and
answer `opened: false, notified: true`, as AmberX did.

**The recorder stays in AmberX.** Its capture service (`OutputRecordService`, MediaProjection, upload queue) is far
bigger than a step; until it moves, the console app does not advertise `recorder@1`, so the hub keeps routing
`amberx.recorder_*` to AmberX, and a page call to `recorder.*` answers `not_implemented`. Recorded as a deferred gap in
the build report.

## Mic and permissions (s4)

Two gates for the mic: the console's own **mic switch** (`mic.set` / `mic.on` / `mic.off`, kept in the app, on by
default) and Android's `RECORD_AUDIO`. `mic.status` answers `{ on, granted, available, reason }` with `reason`
`ok`, `switched_off` or `no_permission`. Switched off, the WebView's audio requests (talk mode, dictation) are denied
without a prompt (`MicTools.webCaptureAllowed`); switched on, part 1's `WebHost` asks Android as before. Every change is
a `mic` event. Rules in `MicRules` (JUnit `MicRulesTest`), tools in `MicTools`, on part 1's `Perms` prompts.

`permissions.request { permission }` (`mic`, `notifications`, `overlay`; `microphone` / `notify` accepted) answers at
once: `granted: true` when it already was, else `asked: true`, and the prompt's answer arrives as the `permission` event
`{ permission, granted, asked, all }`. In the console, `requestPermission(window, key)` waits for that event, and
`callWithPermissions(window, tool, args)` runs a tool, asks for whatever a `permission` error lists, and tries once more
(`bridgeClient.mjs`, tested).

## Without the UI: REST, MCP, CLI, voice (s5)

Every tool is a `device.*` console action (`apps/console-web/src/native/deviceApi.ts`, mapping in `deviceActions.mjs`,
tested), so it is reached the same four ways as any console action; the bridge's state is on `panel:phone-bridge`.

| Action | Tool |
| --- | --- |
| `device.state` | `bridge.info` |
| `device.tool:<tool>[:<json args>]` | any tool or alias, e.g. `device.tool:amberx.open_url:{"url":"https://console.amberxai.com/"}` |
| `device.mic[:on\|off\|status]` | `mic.set` / `mic.status` |
| `device.permission[:mic\|notifications\|overlay\|status]` | `permissions.request` / `permissions.status` |
| `device.open:[browser:]<https url>` | `browser.open` |
| `device.wake[:<console address>]` | `console.wake` |
| `device.notify:<title>[:<text>]` | `notify.show` |
| `device.notify-cancel[:<id>]` | `notify.cancel` / `notify.status` |
| `device.recorder[:start[:<session>]\|stop\|status]` | `recorder.*` |
| `device.slots[:status\|open:<target>[:<slot>]\|close:<slot>\|focus:<slot>]` | `slots.*` |

- REST: `POST /api/console/action {"action":"device.mic:off"}`; state: `/api/console/control` `state panel:phone-bridge`.
- MCP: `console_action { action: "device.wake:panel:phone-app" }`, `console_control { verb: "state", address: "panel:phone-bridge" }`.
- CLI: `axf console action device.recorder:status`, `axf console control state panel:phone-bridge`.
- Voice: AmberX voice runs console actions through `console_action`, so every `device.*` id works there by name.
- axHub: the hub's own `amberx.*` MCP tools reach the phone directly through the device link (while the console app is open).

A tool that answers `permission` is asked for and retried once (`callWithPermissions`). Outside the app every action
says the phone app isn't here. Part 1's `native.*` actions (overlay, safe area, update) stay as they are.

## Four console slots (s6)

Brett: "split the console wrapper so it runs on four slots at the same time". The app runs up to four consoles at once,
each in its own WebView with its own `window.axfNative` (`SlotRules.java`, JUnit `SlotRulesTest`; `SlotHost.java`).

- Slot 1 is the main console and always open; slots 2-4 open and close. One open slot fills the screen, two split it
  (side by side in landscape, stacked in portrait), three or four share a 2x2 grid in slot order.
- One slot has the focus (a tap moves it): it gets the keyboard, the mic (only the focused page may capture audio)
  and the hub's calls. Phone-wide events (`mic`, `permission`, `recorder`, `link`, `slots`) reach every slot.
- Each slot opens a console address (the `?axf-open=` target `console.wake` takes) or one of Brett's https pages;
  any other page is refused (`bad_args`), and neither opens the console's home. The set is saved and comes back when the app starts.

| Tool | Args | Answer |
| --- | --- | --- |
| `slots.status` (`slots`) | | `{ max: 4, count, layout: single\|split\|grid, focused, slots: [{ slot, open, url, focused }] }` |
| `slots.open` | `target` or `url`, `slot?` (else the first free one), `focus?` (default true) | the status; `bad_args` when all four are open |
| `slots.close` | `slot` (2-4; default the focused one) | the status; slot 1 answers `bad_args` |
| `slots.focus` | `slot` (an open one) | the status |

Capability `console-slots@1`; axHub reaches them as `amberx.slots_status|open|close|focus`. Without the UI:
`device.slots:open:settings:2`, `device.slots:focus:2`, `device.slots:close:2`, `device.slots` (REST, MCP, CLI and
voice as above); the state is under `slots` on `panel:phone-bridge`.

Wiring: `ConsoleActivity` builds `new SlotHost(this, container, slot -> /* part 1's WebView setup, DeviceBridge.attach,
DeviceTools/MicTools.register */)` and calls `restore()`; `WebHost.onPermissionRequest` also checks
`host.micAllowed(view)`; back goes to `host.focusedWeb()`.

## Wiring in `ConsoleActivity` (part 1's file; the integration adds these lines)

```java
bridge = DeviceBridge.attach(this, web);      // in onCreate, after the WebView exists
DeviceTools.register(bridge, this);           // open_url, wake, notifications
MicTools.register(bridge, this);              // mic.status, mic.set, permissions.request
HubLink.ensure(this);                         // the axHub device link (amberx device service)
bridge.onPageFinished(view, url);             // in Client.onPageFinished
bridge.detach();                              // in onDestroy
// WebHost.onPermissionRequest, first line for RESOURCE_AUDIO_CAPTURE:
if (!MicTools.webCaptureAllowed(web.getContext(), origin)) { req.deny(); return; }
```

Anything in the contract with no code yet answers `not_implemented`, never silence, and `bridge.capabilities` lists it
under `notYet`.
