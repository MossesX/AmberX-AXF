# Console app notifications — amberx-console-api@1

Status: contract, Nov 13 2026 (build `change-to-move-amberx-web-app-into-the-console-amberx-andr-pr-528-brett-do`, which narrows
build `move-amberx-web-app-into-the-console-amberx-andr`, PR #528, before anything of it shipped). Brett (Nov 13 2026): "do NOT
bring AmberX features into the console. Plan Studio is already there. Only build the Console Android app with all notifications
(text, approvals, alerts) going through the console. Drop the rest of the AmberX port."

This document is the one source for what the Console phone app (`apps/amberx-droid`, the Capacitor shell and its native Java in
`android/app/src/main/java/ai/amberx/droid`) reads from the Dev Console (`apps/console-web`, `https://console.amberxai.com`).
A route the phone reads that is not here is added here first.

Companion specs: `framework/spec/INTEROP.md` (wire codes), `framework/python/axf_server/wall.py` (who is calling behind
axHub's sign-in wall), `apps/console-web/plugins/plugin-commands` (plugin-commands@1: how a plugin route becomes an MCP tool and
a CLI command).

## 1. What changes, in one paragraph

The phone app is the Console app: it shows `https://console.amberxai.com` (same package `ai.amberx.droid`, so the installed app
updates in place) and every notification it raises comes from the console's alerts feed: text notices (FYIs), approvals waiting,
veto calls, builds, CI, deploys, merge failures, systems check, UI Review. The AmberX web app (`https://amberx.amberxai.com`)
keeps its own features and is not ported: notes, to-dos and plans are Plan Studio's and the Todo manager's on the console
already; the recorder, open_url, AmberX settings, AI routes, Molly and the walkthroughs stay where they are.

## 2. Auth

| Caller | How it signs | What it reaches |
|---|---|---|
| The phone's WebView (the console site in the shell) | The axHub session cookie; `console.amberxai.com` and `axhub.amberxai.com` share the parent domain, so the one hub sign-in covers both. | What the signed-in hub user reaches on the console (admin: everything). |
| Native Java (`WatchService`) | The same hub session from Android's cookie store, sent as `Cookie` to the console host. Never follows a redirect; replies capped (`HubRules.readLimited`). | Reads only (C1–C3). A reply that is not `200` JSON means signed out: nothing is shown from it. |
| A machine (CI, a Claude session) | `Authorization: Bearer <AXF_TOKEN>` | Admin role. |

Decisions stay a person's: approve / decline / deny / approve-now / shelve run on axHub with the person's session (the phone's
native action or the console's `decide` from an admin browser), never with a token, never from MCP or the CLI.

## 3. The contract

Every row names the REST route, the MCP tool and the CLI form; voice on the phone reads the same MCP tools through Amber.

| Call | What | REST | MCP | CLI |
|---|---|---|---|---|
| C1 feed | The phone's notifications | `GET /api/alerts?view=phone&device=<name>&since=<version>` → `{alerts[alert@1], unread, version, notify: {off[]}}` (`unchanged` when nothing moved); the device's name records each alert in its history (`deliveredAt`) | `alerts-bell_feed` | `axf alerts-bell feed` | <!-- axf-plugin:alerts-bell -->
| C2 approvals watch | Whether the console carries approvals | `GET /api/plugins/approvals-banner/watch` → `{on, state: ok|error|unreachable|off|idle, waiting, lastAt, error}`; `POST .../watch/poll` reads axHub now | `approvals-banner_watch`, `approvals-banner_watch-poll` | `axf approvals-banner watch` | <!-- axf-plugin:approvals-banner -->
| C3 history | What a device was shown, read, tapped | `GET /api/alerts/history?device=&since=&limit=`; `POST /api/alerts/ack {ids|all, device?}` (`readAt`); `POST /api/alerts/tapped {id, device}` (`tappedAt`) | `alerts-bell_history`, `alerts-bell_read` | `axf alerts-bell history` | <!-- axf-plugin:alerts-bell -->
| C4 raise a text notice | FYI | `POST /api/plugins/notify-control/fyi {title, body?, link?, key?}` → source `fyi`, type `fyi.note`; the same `key` updates one FYI and buzzes again | `notify-control_fyi` | `axf notify-control fyi --title …` | <!-- axf-plugin:notify-control -->
| C5 raise any alert | Machines | `POST /api/alerts {source, severity, title, body, key?, link?}` | `alerts-bell_raise` | `axf alerts-bell raise …` | <!-- axf-plugin:alerts-bell -->
| C6 read / dismiss / resolve | | `POST /api/alerts/ack`, `/dismiss`, `/resolve` | `alerts-bell_read`, `_dismiss`, `_resolve` | `axf alerts-bell read <id>` | <!-- axf-plugin:alerts-bell -->
| C7 types and quiet | Which types reach the phone | the notify-control plugin's `GET state|types`, `POST set|master|app|quiet|test|reset` (channel `amberx` = the phone) | `notify-control_*` | `axf notify-control …` | <!-- axf-plugin:notify-control -->

Deep links: `console_open("alerts-history", focus="<alert id>")` or `focus="device:<name>"` (Notification history screen);
an alert's `link` is what a tap on the phone opens (for an approval, the call's page on axHub).

### 3.1 Approvals and veto calls through the console

The approvals banner's watch reads axHub's feed every 30 s with the console's owner sign-in
(`AXF_HUB_RELAY_USER` / `AXF_HUB_RELAY_PASSWORD`) and keeps one alert per waiting call: source `approvals`, key
`approvals:<id>` (type `approvals.waiting`) or `approvals:veto:<id>` (type `approvals.veto-call`). A decided or expired call
resolves its alert. It only reads. Both types reach the phone (channel `amberx` on by default).

The phone each round:

1. Reads C2. When `on` is true and `state` is `ok`, the console carries approvals: the phone shows the console's
   `approvals:<id>` alert and not its own "Approval waiting" notification (and takes its own copies away the round the console
   takes over). Otherwise (console unreachable, signed out, watch off or failing) the phone keeps telling about approvals from
   its own axHub read, so no approval is missed.
2. Still reads axHub itself for two things that are actions, not notices: auto-approve (the monitor rules) and held veto calls,
   whose card carries the Deny button and re-reads every 10 s. While it shows those cards it skips the console's
   `approvals:veto:<id>` alerts so a veto call never rings twice; when it can't read axHub, the console's veto alert is what shows.
3. Reads C1 with its device name and shows every other open alert once per change; resolved ones are taken away.

### 3.2 Push at any severity

A type the notify gate marks must-buzz (`push: true`, or the phone picked in the Notifications panel) reaches the console's own
ntfy and web push whatever its severity. A channel switched off for the source in Settings → Alerts stays off; a repeat never
pushes twice.

## 4. Not part of this contract

Dropped from PR #528 by Brett's change (Nov 13 2026), nothing of it shipped: the AmberX notes, to-dos, lists and settings console
plugins (Plan Studio and the Todo manager already cover notes and plans), the amberx-import migration, the recorder upload and
playback routes, open_url queued for the phone, the backend switch back to the AmberX web app, the forwarding of old AmberX web
addresses, and the device stream. The AmberX web app keeps serving its own features unchanged.
