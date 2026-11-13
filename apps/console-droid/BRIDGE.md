# `window.axfNative` — the native bridge contract (`native-bridge@1`)

Console app part 3 (build `console-app-part-3-native-bridge-mic`), on the shell contract from part 1
(`apps/console-droid`, package `ai.amberx.consoleapp`, `ShellRules`, `ConsoleActivity`).

Brett, Nov 13 2026: "make the console an Android app, just a wrapper for the web app, keep it floating on top" and
"split the console wrapper so it runs on four slots at the same time". Native code exists only where Android requires
it: mic, recorder, open_url, console wake, notifications, permissions. Everything else is the web console, so each native
piece is one **tool** with one name, reached the same way from the page, from axHub, from the console API, the CLI and
voice. Code: `BridgeContract.java` (the pure rules, JUnit `BridgeContractTest`) and `NativeBridge.java` (the Android side).

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
(`window.axfNativeHost.call(json)`), and the shell answers with a `CustomEvent('axf-native')` on `window` whose
`detail` is one of:

| Shape | Meaning |
| --- | --- |
| `{ id, tool, ok: true, data }` | the answer to the call `id` |
| `{ id, tool, ok: false, error: { code, message, permissions? } }` | the call failed; `permissions` lists the short keys to ask for when `code` is `permission` |
| `{ event, data }` | a native event: `recorder`, `mic`, `permission`, `wake`, `link` (the axHub device link went up or down) |

Error codes: `unknown_tool`, `bad_args`, `denied` (not Brett's site, or the hub asked for a page-only tool),
`permission`, `unavailable`, `not_implemented` (in the contract, code lands in a later step of this build).
A call id is 1-64 of `A-Z a-z 0-9 _ . : -`; a call is at most 64 KB.

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

## Wiring in `ConsoleActivity` (part 1's file; the integration step adds two lines)

```java
bridge = NativeBridge.attach(this, web);      // in onCreate, after the WebView exists
bridge.onPageFinished(view, url);             // in Client.onPageFinished
bridge.detach();                              // in onDestroy
```

Later steps of this build register the tools: `bridge.register(BridgeContract.REC_START, args -> …)`. Anything in the
contract with no code yet answers `not_implemented`, never silence, and `bridge.capabilities` lists it under `notYet`.
