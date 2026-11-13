# Console app part 3: native bridge, mic, recorder, open_url, wake, four slots

Build `console-app-part-3-native-bridge-mic` · branch `claude/console-app-part-3-native-bridge-mic` · PR #633 · Opus phase 2.

Brett said (2026-11-13 18:41): "split the console wrapper so it runs on four slots at the same time"

## Shipped

| Step | What | Where |
| --- | --- | --- |
| s1 | `native-bridge@1` contract and dispatcher | `apps/console-droid/.../BridgeContract.java`, `DeviceBridge.java`, JUnit `BridgeContractTest` |
| s2 | `window.axfNative` for the console page | `apps/console-web/src/native/bridgeClient.mjs` (+ test in CI) |
| s3 | axHub device service moved from AmberX, same `amberx.*` names | `HubLink.java`, `HubLinkRules.java`, `DeviceTools.java`, `DeviceRules.java` |
| s4 | Mic switch and permission requests | `MicRules.java`, `MicTools.java`, JUnit `MicRulesTest` |
| s5 | API parity: `device.*` console actions, `panel:phone-bridge` state, help, Shipped features (`cx.phonebridge`) | `deviceApi.ts`, `deviceActions.mjs` (+ test in CI) |
| s6 | Four console slots at once: single / split / 2x2 grid, focus owns keyboard + mic, saved across restarts | `SlotRules.java`, `SlotHost.java`, JUnit `SlotRulesTest`; `slots.*` tools, `console-slots@1`, `device.slots` |

## How each feature is reached (no UI needed)

- REST: `POST /api/console/action {"action":"device.slots:open:settings:2"}`; state `/api/console/control` `state panel:phone-bridge`.
- MCP: `console_action { action: "device.mic:off" }`, `console_control { verb: "state", address: "panel:phone-bridge" }`;
  axHub: `amberx.open_url`, `amberx.recorder_*`, `amberx.console_wake`, `amberx.notify`, `amberx.slots_*` straight to the phone.
- CLI: `axf console action device.slots`, `axf console control state panel:phone-bridge`.
- Voice: AmberX runs the same console actions by name.
- Full table: `apps/console-droid/BRIDGE.md`.

## Tests

- `node apps/console-web/src/native/bridgeClient.test.mjs` 10/10, `node apps/console-web/src/native/deviceActions.test.mjs` 5/5 (both in CI).
- check-theme, check-controls, check-toolbars, check-console-control: pass.
- JUnit (`BridgeContractTest`, `HubLinkRulesTest`, `MicRulesTest`, `SlotRulesTest`) was not run here: no JDK on the VPS,
  and part 1's `ShellRules`/`Perms`/`ConsoleActivity` live on part 1's branch. They run in the Gradle job once both land.

## Gaps / decisions

- Wiring into part 1's `ConsoleActivity` / `WebHost` is a few lines, written out in BRIDGE.md; it lands with the integration.
- Recorder stays in AmberX until its capture service moves (`recorder@1` not advertised by the console app yet).
- Slots have no native chrome (no borders or labels), so nothing new to theme; focus moves by tap or `slots.focus`.
- An outside page in a slot is refused (`bad_args`) rather than silently swapped for the console's home.
- Kotlin twin: none needed (Java, Android-only).
