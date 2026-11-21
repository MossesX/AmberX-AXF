# PHONE-CONNECT — phone-connect@1, the phone as a paired device

Status: contract since Nov 17 2026 (build `rebuild-fresh-main-phone-connect-small`, Fable phase 1). Brett, Nov 17 2026:
"What's up with the new phone connection? You gonna build it or what?" Built fresh on main; the Nov 15 attempt (PR #712)
is reference only. Inventory and gap table: `_claude/memory/docs/phone-connect.md`.

Reference engine: `framework/core/phone-connect.mjs` (pure, IO-free). Registry snapshot: `framework/schemas/phone-connect.json`.
JSON Schemas: `framework/schemas/json/phone-device.schema.json`, `phone-pairing.schema.json`, `phone-command.schema.json`,
`phone-result.schema.json` (`axf schemas` writes all five from the engine). Fixture: `framework/spec/fixtures/phone-connect.json`
(`spec/check-phone-connect.mjs`, CI). Data: data-store@1 namespace `phone` (DATA-STORE.md; `schemas/data-store-paths.json`).
Kotlin twin deferred (PORTING.md): the companion app is a later phase and Android is on hold.

## What Phone Connect is

One small Android companion with five jobs, and a console plugin that owns it. The phone **shows approvals** (the axHub
approval page, the lock screen saying only "Approval waiting", a veto countdown with its alarm), **keeps a watch** (a
foreground service that holds the link to the console open), **opens pages** the console or an agent asks for,
**shows notifications** (FYI, fix updates, alerts) and **records audio output** (the whole recorder lives in the app).
It can also **speak a line or listen once** for the console assistant. Nothing else: no notes, dictation, web tabs,
AI chat, agent manager, walkthrough, wake word or hands-free voice; those were AmberX and retire with it. There is no
console app on the phone: the console is a web page the phone opens.

The console plugin (phase 2, `apps/console-web/plugins/phone-connect`) is the server: it holds the device records, issues
pairing codes, queues commands, takes acks and results, and exposes everything four ways (REST, MCP, CLI, voice). axHub
keeps a `phone` device service whose `phone.*` tools relay to the plugin, so agents on the hub reach the phone the same
way they reached AmberX. The engine below is what every side runs: the plugin's server (Python port), the console's web
side, the hub's relay, and the Kotlin twin when Android work resumes.

## Records

### phone-device@1

| Field | Meaning |
| --- | --- |
| `deviceId` | `^[A-Za-z0-9_-]{8,64}$`; the app makes `phone-<16 hex>` once and keeps it. A migrated AmberX phone keeps its `amberx-<16 hex>` id. |
| `name` | `Build.MANUFACTURER Build.MODEL`, up to 80 characters |
| `app` / `appVersion` | `phone-connect-droid` (`amberx-droid` only on a record migrated and not yet updated) |
| `platform` | `android` |
| `capabilities` | the subset of `open-url@1`, `notify@1`, `approvals@1`, `recorder@1`, `voice@1` this app build has; a command is never sent to a phone that lacks its capability |
| `state` | `unpaired` · `pending` · `paired` · `revoked` |
| `owner` | the hub user who claimed the pairing (required once paired; always a person, never a session) |
| `token` | `{ prefix, hash, issuedAt, rotatedAt }`: the device token at rest (see Pairing). The token itself is never stored. |
| `watch` | `{ on, ring }`: the foreground watch and whether a new approval rings |
| `urlPolicy` | `{ mode: own · allowlist · any, allowlist: [hosts] }`; default `own` = the console's host plus every host on the console's own site (`OWN_SITES`: amberxai.com, so the hub and the apps open too; `ownSite(host)`) |
| `pairedAt` / `lastSeenAt` / `revokedAt` / `updatedAt` | ISO date-times or `''` |
| `capabilityState` | what each capability last reported, keyed by capability (`recorder@1`: running, since, session, parts, queue, mic) |
| `migratedFrom` | `{ deviceId, app, at }` once, set by the AmberX migration |

**Online** = `paired` and polled within 45 s (`HUB.onlineSeconds`). `presence()` gives the words every surface shows:
`online`, `offline: last seen 12 min ago`, `not paired`, `revoked`.

### Pairing: a one-time code becomes a device token (phone-pairing@1)

```
unpaired ──issue──▶ pending ──claim──▶ paired ──revoke──▶ revoked
                      │  ▲               │  ▲                │
             expire / cancel          rotate                issue / forget
                      ▼  │               ▼  │                ▼
                   unpaired            paired          pending / unpaired
```

| Field | Meaning |
| --- | --- |
| `code` | `^[A-HJ-NP-Z2-9]{8}$` (no 0 / O / 1 / I), eight characters, shown once in the console |
| `issuedAt` / `expiresAt` | ISO; `expiresAt` = `issuedAt` + 10 minutes (`HUB.pairingSeconds`) |
| `issuedBy` | who asked for the code: `{ kind: person · session · service, who, via }`; a session may issue, never claim |
| `state` | `pending` · `claimed` · `expired` · `cancelled` |
| `deviceId` / `claimedAt` / `claimedBy` | set on claim; `claimedBy` is always `{ kind: 'person', who: <hub user> }` |
| `ended` / `endedAt` | `claimed`, `expired` or `cancelled`, and when |

1. **issue**: the console (Settings → Plugins → Phone Connect, or `phone.pair` on REST / MCP / CLI / voice) makes a code.
   One pending code at a time per console; issuing again cancels the old one. Anyone may issue, a session included.
2. **claim** (personOnly): the phone sends `hello` with `{ code, device, person }` where `person` is Brett's own
   signed-in hub session, checked by the hub at claim time only. Right code from a person → the device is `paired`,
   `owner` = that person, and the answer carries the **device token** exactly once: `tok_` + 32 base64url characters
   (`TOKEN_PATTERN`). The console keeps only its SHA-256 `hash` and the first 8 characters as `prefix`. A claim with no
   person (a session, an agent, a service, a token) → `denied`, and the code stays pending. Wrong code → `denied`;
   past its time → `expired` (the console shows a new code); a malformed hello → `validation`. Nothing changes on an error.
3. **expire / cancel**: a pending code past its time, or cancelled in the console, ends; the device goes back to
   `unpaired` if it was `pending`.
4. **revoke**: the owner revokes a phone (a person's confirm; a session cannot). The token dies at once: every call
   with it answers `revoked`; every queued command for the device fails `revoked`. A revoked phone pairs again with a
   new code (`issue`) or is forgotten (`forget`: its record goes).
5. **rotate**: a paired phone asks for a new token with its current one; the old one dies when the new one is
   acknowledged. The console may force a rotation (the phone's next `hello` gets `rotate: true`).

### The link (carried over from AmberX's AXPP, credential changed)

- **One server.** The console's plugin origin, https only, exactly that origin; the phone sends nothing anywhere else.
  The hub's `phone` service relays `phone.*` tools to it; the phone never talks to the hub's MCP.
- **The device token, never the hub session, never the MCP token.** `Authorization: Bearer tok_…` and `X-AXPP: axpp@1`
  on every call after the claim; the claim itself carries the hub session once and gets the token back.
- **Replies** are capped at 256 KB, redirects are never followed, an approval id is a uuid and its page is rebuilt from
  it (a link in a reply is never followed as given).
- **The loop.** `hello` once (device record, `capabilityState`), then long poll `next` (`wait` 25 s; 204 = nothing;
  404 = the server restarted, hello again), `ack` when a command is taken, `answer` with the result. Backoff 5 s ·
  15 s · 30 s · 60 s on failures. Online = polled within 45 s. A command not acked within 20 s is `timeout`
  (retryable); one not answered within its `ttl` is `timeout`.
- **A rejected token is never retried** (Nov 21 2026; Fable audit F8: a phone sent a dead token 73 times in 2 h and
  sat disconnected without saying so). `linkVerdict(reply, uncoded)` says what the phone does after each `hello` /
  `next` reply: `ok`, `hello` (404: greet again), `retry` (the next backoff step) or `rejected`. `rejected` is a wire
  code in `LINK.rejectedCodes` (`denied` · `revoked` · `unpaired`), at once, or a bare 401 / 403 with no wire code (a
  proxy or the sign-in wall answered, not the plugin) `LINK.rejectLimit` (3) times in a row. On `rejected` the phone
  stops the loop, drops the token, and shows "Disconnected: tap to re-pair" (a notification and its pairing screen);
  pairing again is the only way back. The console answers a refused token with `detail.reason: "pair"`, records it
  (when, how often, the token's prefix, never the token), shows `link.state: disconnected` on `status` / `presence`
  with a Re-pair button, raises one banner alert and turns its systems check red. The console's wall lets the device
  routes through its token gate: they carry the device token, never the console token, and check it themselves.

### phone-command@1 (the command envelope)

```json
{ "$axf": "phone-command@1", "id": "<uuid>", "at": "2026-11-17T17:00:00Z", "deviceId": "phone-0123456789abcdef",
  "command": "open_url", "arguments": { "url": "https://console.amberxai.com/?axf-cmd=abc" },
  "policy": "allow", "ttl": 60,
  "from": { "kind": "session", "who": "axf-build-x", "via": "mcp" }, "correlationId": "cc-…", "approvalId": "" }
```

| Command | Arguments | Policy | Capability | On the wire |
| --- | --- | --- | --- | --- |
| `open_url` | `url` (required, ≤2000), `where` overlay · browser, `browser` chrome · default | allow | `open-url@1` | `browser.open` |
| `notify` | `kind` fyi · fix · alert (required), `title` (required, ≤120), `body` (≤600), `url`, `notifyId` (required: the notify-types@1 id that cleared the console's alert hub), `priority` normal · high | allow | `notify@1` | `notify.show` |
| `approval` | `approvalId` (required, uuid), `kind` approval · veto, `tool`, `title` (≤120, the caller's one line), `summary` (≤600), `rev` (the hub's revision, sent back with the decision), `url` (the hub page, rebuilt from the id), `secondsLeft`, `actions` ⊆ approve · deny · shelve | allow | `approvals@1` | `approval.show` |
| `recorder.start` | `session` (required, ≤120), `group`, `note` | **confirm** | `recorder@1` | `recorder.start` |
| `recorder.stop` | none | allow | `recorder@1` | `recorder.stop` |
| `recorder.status` | none | allow (read only) | `recorder@1` | `recorder.status` |
| `voice` | `mode` say · listen (required), `text` (say: required, ≤600), `timeoutSeconds` (listen: 1–30, default 10) | allow | `voice@1` | `voice.say` / `voice.listen` |

`policy` is fixed per command: the engine fills it in and an envelope saying otherwise is `validation`. `from.kind` is
`person` · `session` · `agent` · `service`; `from.via` is `console` · `mcp` · `cli` · `voice` · `hub` (one command, four
ways, Brett Nov 8 2026). `ttl` defaults per command (`TTL`: open_url 60 s, notify 60 s, approval = `secondsLeft` or
600 s, recorder.start 120 s, recorder.stop/status 30 s, voice = `timeoutSeconds` + 10 s).

`open_url` with `where: overlay` (the default) goes to the AXF Console app's floating overlay first when that app is
installed with its toolbar on (console-overlay@1, `apps/console-droid/OVERLAY.md` → "With Phone Connect"); the result
then says `how: "console-overlay"`. Otherwise, and always for `where: browser`, the phone opens the page itself, in
Chrome for `browser: chrome` (the default browser when Chrome is not installed), and brings it to the front:
`how: "direct"` when Android lets the app start it (the app is in front, or Brett allowed it to display over other
apps), else `how: "notification"`: a high-priority notification that opens the page with one tap (Android blocks
activity starts from the background).

**Approvals pop up on the phone** (Nov 21 2026). The console server watches the hub's approvals feed itself
(`approvals.py` in the plugin, through approvals-relay@1 `pending()`: the console's owner sign-in, read only), so it
works with no console open. Each new approval or veto countdown is queued once as an `approval` command while a paired
phone is online; one that failed before Brett answered is sent again while it still waits (at most 3 times). The phone
shows a high-priority notification with the command's `actions` on it. A tap on an action is the decision (below); a
tap on the body opens that approval in the console (`<origin>/?axf-open=hub.review:<id>`, rebuilt from the id).

**Follow Amber on the phone.** A Follow Amber show of a screen or settings tab also queues `open_url` for
`<origin>/?axf-open=<console-control@1 address>` (capability `axf.phone@1` `follow()`; the plugin's `follow` switch,
on by default), so the console comes to the front on the phone at that screen.

Three things a command can never carry:

- a **decision**: `approval` only *shows* the prompt. There is no `decide` command, no `decision` argument, and the API
  never exposes approve / deny / shelve as a command (console-control@1: approve / deny are never commands).
- **`mic`** on `recorder.start`: the mic track only joins from "Record my mic too" on the phone, Brett's own switch.
- a **url** outside the device's url policy or on another scheme: `intent:`, `file:`, `javascript:` and every other
  scheme, user info in the address, more than 2000 characters → `denied` (scheme / policy) or `validation` (shape).

`toWire(command)` gives the AXPP call `{ protocol: axpp@1, kind: call, id, payload: { tool, arguments } }`; the
phone answers an `ack` and then a `result` or `error` envelope with `correlationId` = the command id; `fromWire()` turns
either into a phone-result@1.

### Dispatch (`dispatchErrors(command, device, at)`), in this order, before anything is queued

1. unknown command → `not_found`
2. envelope malformed → `validation`
3. device `revoked` → `revoked`
4. device not `paired` → `unpaired`
5. the phone lacks the capability → `not_found` ("install the current app")
6. a confirm command with no `approvalId` → `confirmation_required`
7. url outside policy or scheme → `denied`
8. the phone not online → `offline`
9. the command's `ttl` already passed → `timeout`

### phone-result@1 (ack, then result)

```json
{ "$axf": "phone-result@1", "id": "<the command id>", "deviceId": "…", "command": "open_url", "at": "…",
  "stage": "ack", "ok": true, "status": "shown", "by": { "kind": "device" } }
{ "$axf": "phone-result@1", "id": "<the command id>", "deviceId": "…", "command": "recorder.status", "at": "…",
  "stage": "done", "ok": true, "data": { "running": true, "since": "…", "session": "Build review", "parts": 2, "queue": 0, "mic": false },
  "by": { "kind": "device" }, "state": { "recorder@1": { "running": true } } }
{ "$axf": "phone-result@1", "id": "<the command id>", "deviceId": "…", "command": "approval", "at": "…",
  "stage": "done", "ok": true, "data": { "decision": "approve" }, "by": { "kind": "person", "tap": "<uuid>" } }
{ "$axf": "phone-result@1", "id": "…", "deviceId": "…", "command": "open_url", "at": "…", "stage": "done",
  "ok": false, "error": { "code": "offline", "message": "Galaxy S26 Ultra is offline: last seen 12 min ago. Open the app or switch the watch on.", "retryable": true } }
```

`stage` is `ack` (the phone took it; `status` queued · shown · running) or `done` (`ok` with `data`, or `error`).
`by.kind` is `device` (the app answered) or `person` (Brett tapped; `by.tap` is the tap's uuid). An ack never changes
state; a result may carry `state` = the device's new `capabilityState` entries.

### personOnly (the approval decision rule)

An approval is decided only by Brett's own tap on the phone. The engine's `decisionErrors(result, auth)` accepts a
`data.decision` only when **all** hold: the result is for an `approval` command, `by.kind` is `person` with a `tap`
uuid, `auth.kind` is `device` (it arrived over the device token) and `data.decision` is one of the command's `actions`.
Otherwise `denied`, and the decision is dropped: a session, an agent, a console action, an MCP tool, the CLI or a
voice phrase cannot approve, deny or shelve, and neither can the device on its own. The console relays the decision to
the hub's approval api as the owner; the hub keeps its own guard. On the phone the tap is an action button on the
approval notification (Approve · Deny · Shelve): Android asks for the phone to be unlocked first, the lock screen says
only "Approval waiting", and the outcome ("Approved.", or why nothing was decided) replaces the prompt. Auto-approval rules on the phone never cover
`recorder.start`, `vps.run` or any destructive tool (`NEVER_AUTO`, `NOT_IN_ALL`, as AmberX's `HubRules`).

## Wire error codes

INTEROP.md's codes (`invalid` · `denied` · `not_found` · `unavailable` · `validation` · `unexpected` · `timeout` ·
`confirmation_required`) plus five phone-connect@1 adds:

| Code | Meaning | Retryable |
| --- | --- | --- |
| `offline` | the phone is paired but has not polled within 45 s | yes |
| `unpaired` | no phone is paired (or this device is not) | no |
| `revoked` | the owner revoked this phone; its token is dead | no |
| `consent_required` | the phone needs its own yes first (Android's capture prompt on a recorder start) | yes |
| `expired` | the pairing code is past its 10 minutes | no |

Retryable also covers `unavailable` and `timeout`. Every error carries `message` in plain words and `retryable`.
Unknown codes read as `unexpected`. Codes never change meaning (`ERROR_CODES` is frozen; the check script fails on a
change).

## Data (data-store@1)

Namespace `phone`: `devices/<deviceId>.json` (phone-device@1 records), `pairings/<code>.json` (phone-pairing@1),
`commands/<id>.json` (phone-command@1 with its results under `results`), journal `log` (one line per issue, claim,
revoke, command, ack, result, error). The plugin's data folder maps there (`data-store-paths.json`, plugins root:
`phone-connect/<kind>/<file>` → `phone/<kind>/<file>`, `phone-connect/log.jsonl` → `phone/log`).

## API (everything comes with an API)

The plugin phase exposes each feature four ways, the same command underneath: REST `/api/plugins/phone-connect/…` <!-- axf-plugin:phone-connect -->
(`status`, `presence`, `devices`, `devices/{id}`, `pair`, `pair/cancel`, `devices/{id}/revoke`, `…/rotate`, `…/forget`, `open`,
`open-url` (an amberxai.com page in Chrome, in front; MCP `phone_open_url`), `notify`, `recorder/start|stop|status`, `voice`, `commands`, `commands/{id}`), MCP `phone_*` (plugin commands), CLI
`axf phone …`, voice ("open the console on my phone", "start recording Build review"). Deep link: `console_open` target
`view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=phone-connect`, rows `row:device/<id>`. State: `GET status`
(presence, link, watch, capabilities, the approvals watcher, recorder state), `GET presence` (MCP `phone_status`: paired,
online, last check-in; what Amber reads before she calls the phone), `GET devices` and `GET state` (all of it plus the addresses). Approve / deny / shelve are not on any of them.

## Migration from AmberX

| Was | Is | How |
| --- | --- | --- |
| `amberx.open_url`, `amberx.recorder_start|stop|status` | `open_url`, `recorder.start|stop|status` (hub tools `phone.open_url`, `phone.recorder_start|stop|status`) | `ALIASES`: the old name resolves for one release, answered normally plus `deprecated: "amberx.recorder_start is deprecated: use phone.recorder_start"`; after that `not_found` |
| the phone's hub session as its credential | a device token from pairing | a migrated device record is `paired` with no token; its next `hello` is answered `unpaired` with a reason `pair`, and the console shows a code |
| console `output-recorder` plugin data | the companion's recorder, `phone` namespace | the plugin phase's migration script |

## axHub switch (MossesX/axHub; build step s23, Nov 17 2026)

Tool names stay, so no caller changes. What changed on the console side, and what the hub's `amberx` device service
(axHub repo, `packages/connectors/…`, decision #108) does next:

| Tool | Console today | Hub adapter (MossesX/axHub, to do there) |
| --- | --- | --- |
| `amberx.open_url` | the console's own callers (wake, overlay verbs, Vinny's `hub_call`) ask `axf.phone@1.hub_tool` first: a paired, online phone opens it (url policy applies); otherwise axHub → AmberX as before | relay to the console: `POST /api/plugins/phone-connect/open {url, where}` with the console token (`X-AXF-Via: hub`); keep AXPP to AmberX only while an AmberX device is still online | <!-- axf-plugin:phone-connect -->
| `amberx.recorder_stop` · `amberx.recorder_status` | same: the paired phone first (`recorder.stop`, `recorder.status`) | relay to `POST recorder/stop` · `GET recorder/status?ask=1` |
| `amberx.recorder_start` | **unchanged**: its approval is the hub's (a straight approval, never auto); the console never routes it around the hub | after the hub's approval, relay to `POST recorder/start {session, group, note, approvalId: <the hub approval id>}`; the phone then asks Android's capture consent (`consent_required` until Brett says yes) |
| push (notify-control channel `amberx`) | the alert hub sends what may buzz the phone to the paired phone (`notify`); AmberX still reads its feed while it exists | nothing: push never went through a hub tool |
| `phone.*` (new names) | `ALIASES` resolve them to the same commands | expose `phone.open_url`, `phone.notify`, `phone.recorder_*`, `phone.voice` as the relay names; answer `amberx.*` with `deprecated` for one release |

Decisions are never relayed this way: an approval on the phone opens the hub's own page; a tap that does reach the
console goes through approvals-relay@1 (the approvals banner) with the console's owner sign-in, never as a command.

## Deferred

- Kotlin twin (`ai.amberx.axf.phoneconnect`, `PhoneConnectEngine.kt`): still deferred (PORTING.md). The companion app
  (`apps/phone-connect`) keeps the rules it needs in `LinkRules.kt` (codes, the url shape, the backoff ladder,
  `verdict` = `linkVerdict`) with a unit test on the fixture's cases.
- Taking a prompt off the phone when the approval was decided elsewhere (the console, the hub): there is no "clear"
  command yet. A countdown's prompt goes by itself when it ends; a plain approval's stays until tapped, and a tap on
  one already decided says so.
- The console plugin, axHub `phone` relay, plugin removals (wake-listener, output-recorder) and AmberX retirement: later phases of this build.
