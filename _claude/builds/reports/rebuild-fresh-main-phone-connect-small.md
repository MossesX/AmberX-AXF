# Rebuild fresh on main: Phone Connect — report

Build `rebuild-fresh-main-phone-connect-small` · PR #787 · branch `claude/rebuild-fresh-main-phone-connect-small`.
Brett (Nov 17 2026): "What's up with the new phone connection? You gonna build it or what?"

Phase 1 (Fable, s1–s5): contract `framework/spec/PHONE-CONNECT.md`, engine `framework/core/phone-connect.mjs`, fixture,
schemas, `check-phone-connect.mjs`. Phase 2 (Opus, s6–s27, this report): the console plugin, the Android companion,
the axHub switch, AmberX retirement (staged), CI.

## What landed

| Part | Where |
| --- | --- |
| Console plugin | `apps/console-web/plugins/phone-connect` (server: `engine.py` Python port, `store.py` data-store@1, `service.py`, routes in `__init__.py`; web: settings tab, actions, client; CLI `phone-connect.mjs`; `notify.json`, `help.json`) |
| Device link | `device_router` mounted at `/api/plugins/phone-connect/device/…` without the console token (manifest `deviceRoutes: true`, main.py hook, plugin.schema.json); every call carries the device token + `X-AXPP: axpp@1` |
| Capability | `axf.phone@1` (status, available, send, open_url, notify, approval, command, push_alert, hub_tool); never a decide method |
| Approvals relay | `approvals-relay@1` in the approvals banner (`PhoneTapRelay.decide_from_phone_tap`): only a verified phone tap (device token + person tap uuid), decided with the console's owner sign-in; no route reaches it |
| Notifications | alert hub → paired phone (notify-control channel `amberx`, relabelled "Phone push"); direct notifications ask `axf.notify@1` first; types `phone-connect.*` in notify.json, group `phone` |
| Systems check | health@1 item `phone-connect` (not paired = amber, watched phone silent 10 min = red) with auto-fix "Re-send the pairing notice" |
| Android app | `apps/phone-connect` (`ai.amberx.axf.phoneconnect`): pairing screen (hub sign-in once, code, EncryptedSharedPreferences), watch service (long poll, backoff, revoked/unpaired end it), open_url (direct or full-screen intent), notifications, approval prompts (Approve/Deny open the hub page), audio-output recorder (MediaProjection, 30-min AAC parts → axHub), voice say / listen (opt-in) / voice intents → console |
| axHub switch | `amberx.open_url`, `recorder_stop`, `recorder_status` answered by the paired phone first (Vinny's `hub_call`, console wake); `recorder_start` keeps the hub's approval; hub adapter relay documented in PHONE-CONNECT.md → axHub switch (MossesX/axHub work) |
| AmberX | retired in policy (decision, push rule, notify channel); code removal staged as build `remove-amberx-app-code-once-phone`, gated on Phone Connect being paired |
| CI | `phone-connect-debug.apk` + LinkRules unit tests in android.yml, artifact, errors to the "CI build errors" issue; ci-scope + watch-live know the app |
| Catalog | `cx.phone` in catalog.json + status.json |

## How each feature is reached (UI · REST · MCP · CLI · voice)

REST base `/api/plugins/phone-connect`. MCP tools are `phone_connect_<id>` (plugin-commands; control@1 path
`plugins.commands` / `plugins.reads` `phone-connect/<id>`). CLI `axf phone …` (also `axf phone-connect …`). Voice and
Ctrl+K: console actions `phone.*`. Deep link: `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=phone-connect`.

| Feature | UI | REST | MCP | CLI | Voice / action |
| --- | --- | --- | --- | --- | --- |
| Status / presence | header chip, Phones tab | `GET status` | `phone_connect_status` | `axf phone status` | `phone.status` |
| Everything + addresses | the tab | `GET state` | `phone_connect_state` | `axf phone state` | `phone.open` |
| Pair (issue code) | Pair → New code | `POST pair/start` | `phone_connect_pair` | `axf phone pair` | `phone.pair` |
| Cancel code | Pair → Cancel code | `POST pair/cancel` | `phone_connect_pair-cancel` (tool `phone_connect_pair_cancel`) | `axf phone pair --cancel` | — |
| Claim (personOnly) | the app's Pair button | `POST pair/confirm` (wall admin only) | not a command (skipped, why given) | — | — |
| Phones | Phones tab, rows `row:device/<id>` | `GET devices`, `GET devices/{id}` | `phone_connect_devices`, `_device` | `axf phone devices [id]` | `phone.devices`, `phone.device:<id>` |
| Revoke / forget / watch / url policy | row buttons and fields (owner) | `POST devices/{id}/revoke|forget|settings` (person only) | not commands (owner's tap) | `axf phone revoke` (refused for the token, by design) | — |
| Open a page | — | `POST open` | `phone_connect_open-url` (`phone_connect_open_url`) | `axf phone open <url>` | `phone.url:<url>` |
| Notification | — | `POST notify` | `phone_connect_notify` | `axf phone notify <title>` | `phone.notify:<text>` |
| Recorder | Activity tab; row chip | `POST recorder/start` (approvalId), `POST recorder/stop`, `GET recorder/status` | `phone_connect_recorder-start|stop|status` | `axf phone recorder start|stop|status` | `phone.recorder:<status|stop|start>` |
| Voice line | — | `POST voice` | `phone_connect_voice` | `axf phone voice say|listen` | `phone.say:<text>`; phone → console `phone.voice:<phrase>` |
| Any command | — | `POST command`, `GET commands`, `GET commands/{id}?wait=` | `phone_connect_command`, `_commands`, `_command-result` | `axf phone command <id>` | — |
| Feature switches + layout | Features tab (`setting:phone-connect.feature.<k>`, `setting:phone-connect.layout`) | `GET/POST settings` | `phone_connect_settings`, `_set-features` | `axf phone settings --on/--off` | — |
| Approve / deny | the hub's own page only | none | none | none | none |

## Tests

| Check | Result |
| --- | --- |
| `python apps/console-web/plugins/phone-connect/test.py` | 244 checks (168 engine fixture replay incl. messages, 76 server: pairing, personOnly, queue, ws, relay, notify gate, health, state, voice-in, hub tools) |
| `node --experimental-strip-types apps/console-web/plugins/phone-connect/test.mts` | 17 CLI checks |
| `node framework/spec/check-phone-connect.mjs` | phase 1, unchanged |
| approvals-banner, notify-control, agent-manager, console-commands, alerts self-tests | pass |
| plugin-lifecycle check, check-plugin-commands, plugins.mjs --check, check-token-registry, check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control, help-coverage, project validate --all, ci-scope | pass |
| console `tsc --noEmit` | pass |
| `apps/phone-connect` Gradle build + LinkRulesTest | CI only (no Android SDK on the VPS) |

## Gaps (honest)

- **AmberX code not deleted yet**: staged as `remove-amberx-app-code-once-phone` until Phone Connect is paired on Brett's phone.
- **Hub adapter relay** (axHub's `amberx` service → console routes, `recorder_start` with the hub approval id) is MossesX/axHub work, documented in PHONE-CONNECT.md.
- **No QR**: the framework has no QR encoder; the code shows large with Copy.
- **Recorder mic track** ("Record my mic too", two-track) not ported from AmberX yet.
- **Android screenshots**: no emulator on the VPS; the pairing screen is reviewed from the CI APK on the phone.
- **Kotlin engine twin**: deferred (PORTING.md); the app keeps the rules it needs in `LinkRules`.
- The wall must let `/api/plugins/phone-connect/device/…` through with a Bearer device token (no hub cookie); if the hub's forward-auth blocks it, the systems check shows the phone offline.

On land: close PR #712 (the Nov 15 attempt) and keep `phone-connect-small-android-companion` archived.
