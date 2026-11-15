# Phone Connect (console plugin)

Build `phone-connect-small-android-companion` (Brett, Nov 15 2026). The contract is `framework/spec/PHONE-CONNECT.md`
(phone-connect@1); the reference engine is `framework/core/phone-connect.mjs`.

Phone Connect replaces AmberX: a small Android companion (`apps/phone-connect-droid`, overlay only, no app screens) and
this console plugin, which holds everything the phone is told and everything set for it.

| Feature | Where it lives |
| --- | --- |
| Pairing, devices, online state | `server/devices.py` (code or QR; only Brett's own hub session approves) |
| Open a page on the phone | `server/commands.py` `open_url` (amberxai.com, https only) |
| Notifications | `notify.json` types FYI, fix updates, alerts, approvals; sent through axf.notify@1 |
| Approvals + Monitor | the phone's overlay and WatchService; auto-approval rules in `server/rules.py` |
| Audio Output Recorder | `server/recorder.py` (moved in from the old output-recorder plugin); capability `axf.phone-recorder@1` |

Install / remove: `node apps/console-web/plugins/phone-connect/install.mjs`, `uninstall.mjs [--all]`. Data:
`.axf-console/plugins/phone-connect/`. Settings: Settings → Plugins → Phone Connect.

## migrate.mjs

AmberX → Phone Connect, three moves, each idempotent, dry run by default:

```
node apps/console-web/plugins/phone-connect/migrate.mjs                      # plan only, writes nothing
node apps/console-web/plugins/phone-connect/migrate.mjs --apply --owner brett
node apps/console-web/plugins/phone-connect/migrate.mjs --root /opt/axf --device amberx-device.json --json
```

| Move | From | To |
| --- | --- | --- |
| aliases | `amberx.open_url`, `amberx.recorder_start` / `_stop` / `_status` | `<data>/aliases.json`: the alias table, the deprecation note and the console files that still call the old names |
| data | `.axf-console/plugins/output-recorder/` (the Audio Output Recorder's old data folder) | `<data>/recorder/`, verified byte for byte, then a `MOVED-TO` pointer in the old folder (the old folder goes with that plugin's uninstall) | <!-- axf-not-plugin:output-recorder -->

| device | the axHub `amberx` device record (`--device`, else `<old>/device.json`, else `<data>/amberx-device.json`) | `<data>/devices.json` (`phone-devices@1`): the same id, `migratedFrom` set, still paired |

`<data>` is `.axf-console/plugins/phone-connect` under `--root` (default: the repo root or `AXF_ROOT`). Exit 0 on a
clean plan, 2 when a verify failed (nothing is written then). Test: `node apps/console-web/plugins/phone-connect/test.mjs`.

## How every feature is reached

| Feature | Deep link (console_show / console_open) | REST (`/api/plugins/phone-connect/…`) | MCP | CLI | Voice / console action |
| --- | --- | --- | --- | --- | --- |
| Phone, pairing, revoke | `view:phone-connect/tab:phone-connect.tabs=phone`, Settings sub-tab `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=phone-connect` | `status`, `devices`, `pair`, `devices/{id}/revoke` | `phone_status`, `phone_devices`, `phone_pair`, `phone_revoke` | `axf phone status|devices|pair|revoke` | `phone.pair`, `phone-connect.open phone` |
| Open a page on the phone | — | `open` | `phone_open_url` (`amberx_open_url`) | `axf phone open <url>` | `phone.open <url>` |
| Notifications | `…tabs=notifications` | `notify`, `settings` | `phone_notify`, `phone_settings(_set)` | `axf phone notify`, `axf phone settings --notify-<kind> on|off` | `phone.notify <kind> <title>` |
| Recorder | `view:phone-recorder`, `…tabs=recorder` | `recorder/start|stop|status` | `phone_recorder_*` (`amberx_recorder_*`) | `axf phone recorder start|stop|status` | `phone.recorder.start|stop|status` |
| Auto-approval rules | `view:phone-rules`, `…tabs=rules` | `rules`, `rules/{id}/enable`, `rules/{id}` | `phone_rules_list|add|enable|remove|evaluate` | `axf phone rules list|add|remove|enable|check` | `phone-connect.open rules` |

Every button and setting on the screens carries a `data-axf-target` (`phone-connect.*`), so console-control reaches it.
