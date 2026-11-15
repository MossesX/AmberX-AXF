# Phone Connect on axHub

axHub defines the phone's tools; the phone only answers them (AXPP device relay). Phone Connect adds the `phone` device
service: **MossesX/axHub PR #46** (`claude/phone-connect-device-service`).

| axHub tool | Policy | Alias kept one release |
| --- | --- | --- |
| `phone.open_url` | allow (https on amberxai.com only, checked by the hub and the phone) | `amberx.open_url` |
| `phone.recorder_start` | **straight approval** (`explicitApproval`: no veto countdown, no auto-approve window) | `amberx.recorder_start` |
| `phone.recorder_stop` | allow | `amberx.recorder_stop` |
| `phone.recorder_status` | allow (read only) | `amberx.recorder_status` |

The console calls `phone.*` through `server/hub.py`; a hub without the `phone` service yet answers `not_found`, and the
console retries with the `amberx.*` alias (same tool, same policy). Once PR #46 is deployed and the `amberx` service is
removed (retirement step), only `phone.*` remains.
