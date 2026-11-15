# Phone Connect (console plugin)

Build `phone-connect-small-android-companion` (Brett, Nov 15 2026). The contract is `framework/spec/PHONE-CONNECT.md`
(phone-connect@1); the reference engine is `framework/core/phone-connect.mjs`.

This folder holds the migration first. The plugin itself (manifest, `install.mjs` / `uninstall.mjs`, the Settings →
Plugins → Phone Connect sub-tab with pairing, devices and the recorder, REST `/api/plugins/phone-connect/*`, MCP
`phone-connect_*`, CLI `axf phone-connect …`, voice) comes with the plugin phase of the same build; until then the folder
has no `plugin.json`, so the Plugin Manager and the lifecycle checks leave it alone.

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
