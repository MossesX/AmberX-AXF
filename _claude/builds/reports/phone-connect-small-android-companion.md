# Phone Connect: small Android companion + console plugin; retire AmberX

Build `phone-connect-small-android-companion` · branch `claude/phone-connect-small-android-companion` · PR #712 ·
phase 1 (s1–s3) Fable, phase 2 (s4–s34) Opus.

Brett (Nov 15 2026, verbatim): "We're gonna build phone connect. Plug in, and it's gonna contain these features. Approval
page, add it. Monitor yes. Voice commands get rid of it, it's buggy. Notes, dictation, web tabs, AI connection gone. AI
assistant and agent manager kill it, merge everything into the assistant in the console. Walkthrough video kill it. Open
pages on phone keep it. Notifications keep it. Audio recorder, remove it out of console and put the whole thing in the
phone app. Wake word listener kill it. Do we need a whole console app?"

Answer to the last question: no. There is no console app on the phone. A console plugin holds everything, and a small
native companion shows only an overlay.

## What shipped

| Part | Where |
| --- | --- |
| Contract phone-connect@1, reference core, fixture (31 checks), migration | `framework/spec/PHONE-CONNECT.md`, `framework/core/phone-connect.mjs`, `phone-connect/migrate.mjs` (phase 1) |
| Console plugin | `apps/console-web/plugins/phone-connect`: device registry + pairing (personOnly claim), command queue with acks, open_url (https on amberxai.com only), notify (FYI, fix updates, alerts, approvals through axf.notify@1), the whole Audio Output Recorder (capability `axf.phone-recorder@1`), auto-approval rules, Overlay settings synced live (phone-overlay@1), QR pairing, a systems check item for the retirement gate |
| Android companion | `apps/phone-connect-droid` (ai.amberx.axf.phoneconnect, API 35): one-time setup page; overlay toolbar → draggable button with badge; popups acted on in place; Monitor (WatchService); command channel and open page; channels per notify type; the recorder moved in whole from AmberX; Kotlin unit tests |
| axHub | `phone` device service with `phone.*` tools, `amberx.*` kept as alias: MossesX/axHub PR #46 (16/16 tests) |
| Removed | console plugins `wake-listener` and `output-recorder` (lifecycle uninstall, nothing left behind); the AmberX APK CI job |
| Merged | AmberX assistant / agent manager → console AI Assistant (every feature covered; an Assistant button on the phone toolbar) |

Removal list: `_claude/builds/reports/phone-connect-small-android-companion-inventory.md`.

## API reach for each feature

| Feature | Deep link | REST `/api/plugins/phone-connect/…` | MCP | CLI | Voice / console action |
| --- | --- | --- | --- | --- | --- |
| Phone (status, pair, revoke) | `view:phone-connect/tab:phone-connect.tabs=phone`; Settings sub-tab `…subtabs=phone-connect` | `status`, `devices`, `devices/{id}`, `pair`, `devices/{id}/revoke`, `…/forget` | `phone_status`, `phone_devices`, `phone_device`, `phone_pair`, `phone_pair_waiting`, `phone_pair_cancel`, `phone_revoke`, `phone_forget` | `axf phone status|devices|device|pair [cancel]|revoke|forget` | `phone.pair`, `phone-connect.open phone` |
| Open a page on the phone | — (an action, no screen) | `open`, `commands`, `commands/{id}` | `phone_open_url` (+ `amberx_open_url`), `phone_commands`, `phone_command` | `axf phone open <url>`, `axf phone commands` | `phone.open <url>` |
| Notifications | `…tabs=notifications` | `notify`, `settings` | `phone_notify`, `phone_settings`, `phone_settings_set` | `axf phone notify <kind> "<title>"`, `axf phone settings --notify-<kind> on|off --browser … --monitor …` | `phone.notify <kind> <title>` |
| Recorder | `view:phone-recorder`, `…tabs=recorder` | `recorder/start|stop|status`, `recorder/transcripts(/run)` | `phone_recorder_start|stop|status` (+ `amberx_recorder_*`), `phone_recorder_transcripts(_run)` | `axf phone recorder start|stop|status|transcripts` | `phone.recorder.start|stop|status` |
| Auto-approval rules | `view:phone-rules`, `…tabs=rules` | `rules`, `rules/{id}/enable`, `rules/{id}` (DELETE), `rules/evaluate` | `phone_rules_list|add|enable|remove|evaluate` | `axf phone rules list|add|remove|enable|check` | `phone-connect.open rules` |
| Overlay (toolbar, popups, button) | `…tabs=overlay` | `overlay`, `overlay/presets`, `overlay/presets/{id}` | `phone_overlay`, `phone_overlay_set`, `phone_overlay_presets`, `phone_overlay_preset` | `axf phone overlay [presets|preset <id>|set '<json>']` | `phone.overlay.preset <id>` |

Every button and setting carries a `data-axf-target` (`phone-connect.*`); console-control coverage passes.

## Rules kept

- Pairing: only Brett's own signed-in hub session claims a code (personOnly); a machine can issue a code, never use it.
- Recorder start: a straight approval on axHub (`phone.recorder_start`, explicitApproval); with an approval id the
  console queues it; `mic` is never sent; "Record my mic too" only turns on from Brett's click.
- Auto-approval: never destructive tools, personOnly actions, recorder_start or vps.run; a rule a command adds is only
  proposed until Brett turns it on; the phone keeps its own never-list so a sync can only add to it.
- Lock screen: only "Approval waiting" (private content with a public version; VISIBILITY_SECRET would hide even that).
- open_url: https on amberxai.com only, checked on the console, axHub and the phone.

## Aliases

`amberx.open_url`, `amberx.recorder_start|stop|status` resolve to `phone.*` for one release: console routes
`amberx/*` (MCP `amberx_*`, answered with `deprecated`), axHub's `amberx` service, and `hub.py` falls back to the alias on
a hub without `phone.*`. Console files that still call the old names are listed by `migrate.mjs`.

## Tests

`phone-connect/test.py` 127 (the Python port replays the golden fixture; two divergences found and fixed), `test.mjs`
5, `test_transcripts.py` 20, `web/recorder/core.test.mts` 19, `claude-session/test.py` 75, `check-phone-connect.mjs`
31, Kotlin unit tests (lock screen, URL filter, overlay config, auto-approval, approvals feed) + the moved
RecorderControl / TwoTrack tests. Theme, controls, toolbars, chrome, console-control, help (100%), glossary, shared
assets, plugin lifecycle (all plugins) and `tsc` pass.

## Gaps and what waits

- **Android compile not verified locally:** there is no Android SDK on the VPS; the Gradle job in `android.yml` builds
  `phone-connect-debug.apk` and runs its unit tests. A compile error there needs a follow-up fix.
- **AmberX retirement waits on Brett's phone:** `retire-check.mjs` can't pass until this PR lands and the APK is paired.
  Nothing of AmberX was deleted (app folder, amberx.amberxai.com Coolify app + DNS, axHub amberx device). The systems
  check item "Phone Connect paired (AmberX retirement gate)" gives the steps. The AmberX APK job was dropped from CI
  because its native recorder moved; the installed AmberX keeps working.
- **axHub PR #46** must land for `phone.*`; until then the console uses the `amberx.*` alias.
- **No amberx device record on the console**, so the phone pairs fresh (the migration found none to move).
- **Alerts on the phone** arrive as notify commands from the console; the console's own alert feed is not mirrored.
- **UI Review waiting:** `r-20261115-w4ueo01` (settings, three Overlay layouts) and `r-20261115-usst701` (phone
  overlay, three presets as phone-overlay@1 assets, predicted from the console's live preview; real Android shots come
  from CI). Group "phone-connect-small-android-companion - Nov 15 4:25 PM".
- The wake-listener / output-recorder data folders on the live console go with their uninstall there after landing.
- `segno` joins the console image for the pairing QR; until the image is rebuilt the screen shows the typed code only.
