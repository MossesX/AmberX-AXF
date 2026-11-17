# Phone Connect (phone-connect@1): what the phone does today, what it keeps, what changes

Build `rebuild-fresh-main-phone-connect-small` (Nov 17 2026, Fable phase 1). Brett: "What's up with the new phone
connection? You gonna build it or what?" A fresh build on main of the Nov 15 attempt (`phone-connect-small-android-companion`,
PR #712, never merged: it carried a whole Android app, plugin removals and 176 files in one PR and drifted from main).
The old branch is reference only; nothing is cherry-picked from it.

Phase 1 (this doc, the contract, the schema, the engine, the check) is pure framework work: no plugin, no Android code
(Android on hold, Brett Oct 21 2026; AmberX is the exception but the companion is a new app, so its Kotlin side is a
deferred gap in `framework/spec/PORTING.md`).

## What AmberX does on the phone today (main, Nov 17 2026)

Source: `apps/amberx-droid` (Capacitor shell around the hosted site `amberx.amberxai.com`, native side
`android/app/src/main/java/ai/amberx/droid`), axHub's `amberx` device service (AXPP, decision #108), console plugins
that call it.

| Feature | Where it lives | Reached by | Phone Connect |
| --- | --- | --- | --- |
| Approvals page + lock screen "Approval waiting" | `src/views/Approvals.tsx`, `ApprovalOverlay.java`, `HubRules.java` (feed `/auth/admin/approvals.json`, api `/auth/api/approvals`) | the phone itself; notify ids `amberx.approval`, `amberx.veto` (guarded, device-enforced) | **Keep**: `approval` command prompts the phone; the decision is only ever Brett's tap on the phone (personOnly), never a command |
| Monitor (foreground `WatchService`, approvals watch, veto alarm, auto-approval rules) | `WatchService.java`, `VetoAlerts.java`, `VetoAlarm.java`, `src/plugins/monitor` | the phone itself; `amberx.auto-approved` notify | **Keep** as the companion's background link (`watch` capability); auto-approval rules stay on the phone, never cover `recorder.start` or `vps.run` |
| Open a page on the phone | `AxppLink.java` `browser.open`, `OpenUrlRules.java` (https on amberxai.com), overlay toolbar | axHub tool `amberx.open_url` (console wake `console-commands/server/wake.py`, approvals banner, planner item `amberx-open-any-url`: allowlist / any site) | **Keep** as `open_url` with a url policy (`own` default, `allowlist`, `any`); `intent:`, `file:`, `javascript:` always refused |
| Phone notifications (FYI, fix updates, alerts) | notify-control registry channel `amberx` (push: true items), `Channels` on the phone | console alert hub → AmberX push; no direct tool today | **Keep** as `notify` with kinds `fyi`, `fix`, `alert`; every one goes through the console's alert hub (`axf.notify@1`) first |
| Audio output recorder (playback capture, chunks to axHub, mic opt-in) | `OutputRecordService.java`, `OutputRecordQueue.java`, `OutputRecordUploader.java`, `TwoTrack.java`, `RecorderControl.java`; console side `apps/console-web/plugins/output-recorder` | axHub tools `amberx.recorder_start|stop|status` (claude-session `recording.py` starts one per session, claude-badge shows status) | **Keep** as `recorder.start|stop|status`; `start` is confirm-policy (a straight approval, never auto) and needs Android's own consent on the phone (`consent_required`) |
| Voice commands (`amberx.voice`, hands-free, spoken replies) | `src/plugins/voice`, `TalkService.java`, `SpeechTuning.java` | the phone's mic | **Drop** as a phone feature. Kept in the contract as one `voice` command (`say` a line, `listen` once with a result) so the console assistant can talk through the phone; nothing hands-free |
| Wake word listener | `WakeListener.java`, `WakeRules.java`, console plugin `wake-listener` | always-on mic | **Drop** (grabs the mic; Brett Nov 15). Plugin removal is a later phase |
| Notes, tasks, dictation, web tabs, AI connection, Gizmo companion, agent manager, walkthrough video | `src/plugins/{notes,tasks,dictation,web,ai,companion,commands,walkthrough}` | the phone UI, `amberx_*` control tools (notes) | **Drop** from the phone; the console AI Assistant covers chat. Notes through control@1 keep working from the console (`lib/amberx-core.gen.mjs` is console-side) |
| Mic off switch, mic guard | `MicGuard.java`, `MicTile.java`, `src/micguard.ts` | tile, watch notification | **Drop** with the mic features (nothing in Phone Connect opens the mic except the recorder's opt-in track) |
| Hub sign-in and session rules | `HubRules.java` (one hub, https, 256 KB cap, no redirects, uuid approval ids), `AxppLink.java` (hello, long poll 25 s, answer, backoff 5/15/30/60 s, online = polled within 45 s) | AXPP | **Keep** the transport rules word for word; **change** the credential: a device token from pairing, not the hub session cookie |

## axHub tools today → Phone Connect commands

| axHub `amberx.*` tool | Used by | Phone Connect command | Policy |
| --- | --- | --- | --- |
| `amberx.open_url` | console wake, approvals banner, planner | `open_url` | allow (url policy) |
| `amberx.recorder_start` | claude-session recording.py, claude-settings, output-recorder core | `recorder.start` | confirm (straight approval; `NEVER_AUTO`) |
| `amberx.recorder_stop` | claude-session | `recorder.stop` | allow |
| `amberx.recorder_status` | claude-badge, claude-session | `recorder.status` | allow, read-only |
| (none: push went through the alert hub) | notify-control push | `notify` | allow |
| (none: approvals are the hub's own page) | the phone reads the feed | `approval` | allow to *show*; deciding is personOnly |
| `amberx.voice` (web-only phrase registry) | AmberX voice plugin | `voice` | allow |

Aliases: `amberx.open_url`, `amberx.recorder_start|stop|status` resolve to the new commands for one release, answered
with a `deprecated` note; after that `not_found`.

## Gaps the old attempt left (PR #712) and what this build does about them

| Gap | Old attempt | This build |
| --- | --- | --- |
| Credential | the phone's hub admin session cookie on every AXPP call; no revoke short of signing out | pairing code → **device token** (random, hashed at rest, `tok_` prefix on the wire); `revoke` kills it at once; `rotate` for a new one |
| Pairing | hub-side only, code shown in the console, no ownership check on who claims it | code is issued by the console (personOnly claim: the phone must present Brett's signed-in hub session once, at claim time only), 10 min, single use, `pending → paired` |
| Who may decide an approval | not stated in the contract | **personOnly** rule in the engine: an `approval` command only *shows* the prompt; a `decide` result is accepted only when its `by.kind` is `person` with the device token and the tap id; a session, agent, console action or MCP call carrying a decision is refused `denied` |
| Command set | open_url, notify, approvals_watch, recorder_* | the same plus `approval` (prompt) and `voice` (say / listen); `approvals_watch` folded into the device `watch` setting |
| Ack | result only | **ack** (the phone took the command: `queued`, `shown`, `running`) and then **result**; a command without an ack in 20 s is `timeout`, retryable |
| Scope | one PR with the Android app, plugin removals, axHub PR | phase 1 is the contract + engine + check only; the console plugin, the companion and retirement are later phases with their own steps |
| Schema files | hand-written under `schemas/json/phone-*.schema.json` | one registry snapshot `framework/schemas/phone-connect.json` and the four JSON Schemas emitted from it by `axf schemas` |
| Data | plugin data dir `.axf-console/plugins/phone-connect` | data-store@1 namespace `phone` (`devices/<id>`, `pairings/<code>`, `commands/<id>`, journal `log`) registered in `data-store-paths.json` |

## Error codes (wire)

INTEROP.md's: `invalid` · `denied` · `not_found` · `unavailable` · `validation` · `unexpected` · `timeout` ·
`confirmation_required`. Phone Connect adds `offline` · `unpaired` · `revoked` · `consent_required` · `expired`
(a pairing code past its 10 minutes). Retryable: `unavailable`, `timeout`, `offline`, `consent_required`.

## Files of this build

| Step | File |
| --- | --- |
| s1 | this doc |
| s2 | `framework/spec/PHONE-CONNECT.md` |
| s3 | `framework/schemas/phone-connect.json`, `framework/schemas/json/phone-{device,pairing,command,result}.schema.json`, `framework/schemas/data-store-paths.json` (+ `data-store.json` namespace `phone`) |
| s4 | `framework/core/phone-connect.mjs`, `framework/spec/fixtures/phone-connect.json` |
| s5 | `framework/spec/check-phone-connect.mjs`, `.github/workflows/android.yml` |

## Phase 1 landed (Nov 17 2026, Fable)

- Engine `framework/core/phone-connect.mjs` is the one source: REGISTRY → `axf schemas` writes `framework/schemas/phone-connect.json` and the four JSON Schemas (with if/then cross-field rules: paired → owner, claimed → claimedBy / deviceId / claimedAt, ack never fails or carries state, `retryable` follows the code, a person carries a tap).
- data-store@1 namespace `phone` (plugin folder `phone-connect` is the namespace, like `ui-review`); `data-store-paths.json` maps `phone-connect/<kind>/<file>` → `phone/<kind>/<file>`, `log.jsonl` → `phone/log`. Nothing to migrate yet.
- Fixture `framework/spec/fixtures/phone-connect.json` is generated (`node framework/spec/check-phone-connect.mjs --write`) from seeded inputs: validators, makeCommand, wire, dispatch order, personOnly, presence, urls, the pairing flow, the AmberX migration, frozen error codes. 295 checks in CI (android.yml sweep).
- Kotlin twin and the companion app: deferred gap in `framework/spec/PORTING.md`. Next phase: the console plugin (`apps/console-web/plugins/phone-connect`, Python port reading the snapshot), the hub `phone` relay, then the app.

## Phase 2 landed (Nov 17 2026, Opus)

- Console plugin `apps/console-web/plugins/phone-connect`: Python engine port (fixture replay), pairing (personOnly claim through the wall), command queue + device link (`device_router`, long poll + websocket), capability `axf.phone@1`, approvals relay through the approvals banner's `approvals-relay@1`, alert hub → phone push, CLI `axf phone`, MCP `phone_connect_*`, console actions `phone.*`, Settings → Plugins → Phone Connect, `GET state`, systems-check item with auto-fix.
- App `apps/phone-connect` (Kotlin/Compose): pairing, watch service, open_url, notifications, approval prompts (hub page), recorder, voice.
- axHub switch: see PHONE-CONNECT.md → axHub switch. The console answers `amberx.open_url` / `recorder_stop` / `recorder_status` from a paired phone first; `recorder_start` stays with the hub's approval. The hub adapter relay is MossesX/axHub work.
