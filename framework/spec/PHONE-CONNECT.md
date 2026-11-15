# PHONE-CONNECT — phone-connect@1, the small Android companion

Status: contract since Nov 15 2026 (build `phone-connect-small-android-companion`, Fable phase). Brett: "We're gonna build
phone connect. Plug in, and it's gonna contain these features. Approval page, add it. Monitor yes. Voice commands get rid
of it, it's buggy. Notes, dictation, web tabs, AI connection gone. AI assistant and agent manager kill it, merge
everything into the assistant in the console. Walkthrough video kill it. Open pages on phone keep it. Notifications keep
it. Audio recorder, remove it out of console and put the whole thing in the phone app. Wake word listener kill it. Do we
need a whole console app?"

Reference engine: `framework/core/phone-connect.mjs` (pure). Registry snapshot: `framework/schemas/phone-connect.json`.
JSON Schemas: `schemas/json/phone-device.schema.json`, `phone-pairing.schema.json`, `phone-command.schema.json`,
`phone-result.schema.json` (`axf schemas` regenerates them). Fixture: `framework/spec/fixtures/phone-connect.json`
(`spec/check-phone-connect.mjs`). Migration: the Phone Connect console plugin's `migrate.mjs`.
Kotlin twin deferred (PORTING.md).

## What the phone is

Phone Connect is one Android app with four jobs and nothing else: **approvals** (the axHub approval page and the watch
that rings once per new approval), **monitor** (the foreground watch that keeps the hub link up), **open pages** (a page
the console or an agent asks for opens on the phone) and **notifications** (console alerts as phone notifications), plus
the **audio recorder** moved out of the console and into the app whole. Everything AmberX did besides that (voice
commands, notes, dictation, web tabs, AI connection, the AI assistant and agent manager, the walkthrough video, the wake
word listener) is retired; the assistant lives in the console. There is no console app on the phone: the console is a
web page the phone opens.

The phone is a **device service** on axHub, as the `amberx` service was: the hub defines the tools, the phone only
answers them. One hub, one owner, one phone at a time in practice; the record allows more.

## Records

### phone-device@1

| Field | Meaning |
| --- | --- |
| `deviceId` | `^[A-Za-z0-9_-]{8,64}$`; the app makes `phone-<16 hex>` once and keeps it in its prefs. A migrated phone keeps its `amberx-<16 hex>` id, so nothing pairs again. |
| `name` | `Build.MANUFACTURER Build.MODEL`, up to 80 characters |
| `app` / `appVersion` | `phone-connect-droid` (`amberx-droid` only on a record not migrated yet) |
| `platform` | `android` |
| `capabilities` | the subset of `open-url@1`, `notify@1`, `approvals@1`, `recorder@1` this build has; a tool is never sent to a phone that lacks its capability |
| `state` | `unpaired` · `pending` · `paired` · `revoked` (below) |
| `owner` | the hub user who paired it (required when paired) |
| `pairedAt` / `lastSeenAt` / `revokedAt` / `updatedAt` | ISO date-times or empty |
| `capabilityState` | what each capability last reported, keyed by capability (`recorder@1`: running, since, session, parts, queue, mic) |
| `migratedFrom` | `{deviceId, app: amberx-droid, at}` once, set by the migration |

**Online** = paired and polled the hub within 45 s (`HUB.onlineSeconds`). `presence()` gives the words every surface
uses: `online`, `offline: last seen 12 min ago`, `not paired`, `revoked`.

### Pairing handshake (phone-pairing@1)

```
unpaired ──issue──▶ pending ──confirm──▶ paired ──revoke──▶ revoked
                      │  ▲                                    │
             expire / cancel                            issue / forget
                      ▼  │                                    ▼
                   unpaired                           pending / unpaired
```

1. **issue**: the console (Settings → Plugins → Phone Connect, `phone.pair` on REST / MCP / CLI / voice) asks the hub
   for a pairing; the hub makes an eight-character code (`^[A-HJ-NP-Z2-9]{8}$`, no 0 / O / 1 / I) good for **10
   minutes**, single use. The console shows it; nothing else carries it.
2. **confirm**: the phone, **signed in to the hub in its own web view**, sends AXPP `hello` with `{code, deviceId, name,
   app, appVersion, capabilities, state}`. The hub checks the code against the one pending pairing. Right code → the
   device is `paired`, `owner` = the signed-in user, `pairedAt` = now. Wrong code → `denied`; expired → `timeout` (the
   console shows a new code); a hello that is not a device record → `invalid`. Nothing changes on an error.
3. **expire / cancel**: a pending code past its time, or cancelled on the console, goes back to `unpaired`; the pairing
   record keeps `ended` and `endedAt`.
4. **revoke**: the owner revokes a phone on the console. Its session is refused from then on; every command answers
   `revoked`. A revoked phone pairs again with a new code (`issue`) or is forgotten (`forget`: its record goes).

A hello without a code from a `paired` device updates `lastSeenAt` and `capabilityState` only (`seen()`); from an
unpaired or revoked device it answers `unpaired` / `revoked` and changes nothing.

### Hub sign-in and session security (carried over from AmberX)

The rules are AmberX's `HubRules.java` / `AxppLink.java`, unchanged, as `HUB` in the engine and `requestErrors()`:

- **One hub.** `https://axhub.amberxai.com`, exactly that origin, https only; every call is held to it. Nothing is ever
  sent anywhere else.
- **The phone's own session.** AXPP authenticates with the phone's signed-in hub admin session cookie, **never the MCP
  token**, never a bearer header. Signed out → the phone waits 60 s and tries again. 401 / 403 → the same.
- **Headers.** `X-AXPP: axpp@1` and a JSON body on every call; the hub refuses anything else.
- **Replies.** Capped at 256 KB; redirects are never followed; an approval id is a uuid and its page is rebuilt from it
  (a link in a reply is never used).
- **The loop.** `hello` once, then long poll `/axpp/v1/next` (`wait` 25 s; 204 = nothing, 404 = the hub restarted, hello
  again), answer on `/axpp/v1/answer`. Backoff 5 s · 15 s · 30 s · 60 s on failures. The hub counts the phone online if
  it polled within 45 s and waits 20 s for an answer.
- **Approvals.** `phone.recorder_start` is a straight approval (`explicitApproval`): no veto countdown, never runs by
  itself, no auto-approve window covers it, hub or phone (`NEVER_AUTO`). "Approve everything" never covers `vps.run`
  (`NOT_IN_ALL`). `autoApproves()` answers the same as AmberX's `HubRules.autoApproves`.
- **Open pages.** The owner's **url policy**: `own` (default: https on `amberxai.com` and its subdomains, default port),
  `allowlist` (those hosts and their subdomains) or `any` (any http(s) page). Always refused: `intent:`, `file:`,
  `javascript:` and every other scheme, user info in the address, more than 2000 characters. Every open is logged.

### phone-command@1 (the command envelope)

```json
{ "$axf": "phone-command@1", "id": "<uuid>", "at": "2026-11-15T14:00:00Z", "deviceId": "phone-0123456789abcdef",
  "tool": "phone.open_url", "arguments": { "url": "https://console.amberxai.com/?axf-cmd=abc" },
  "policy": "allow", "from": { "who": "brett", "via": "mcp" }, "correlationId": "cc-…", "approvalId": "" }
```

| Tool | Arguments | Policy | Capability | On the wire |
| --- | --- | --- | --- | --- |
| `phone.open_url` | `url` (required), `where` overlay · browser, `browser` chrome · default | allow | `open-url@1` | `browser.open` |
| `phone.notify` | `title` (required, ≤120), `body` (≤600), `url`, `channel` alerts · approvals · console · recorder, `priority` normal · high | allow | `notify@1` | `notify.show` |
| `phone.approvals_watch` | `on` (required), `ring` | allow | `approvals@1` | `approvals.watch` |
| `phone.recorder_start` | `session_name` (required, ≤120), `group`, `note`, `mic` | **confirm** | `recorder@1` | `recorder.start` |
| `phone.recorder_stop` | none | allow | `recorder@1` | `recorder.stop` |
| `phone.recorder_status` | none | allow (read only) | `recorder@1` | `recorder.status` |

`policy` is fixed per tool: the engine fills it in and a record saying otherwise is invalid. `from.via` is one of
`console`, `mcp`, `cli`, `voice`, `hub`: the same tool reached four ways (Brett, Nov 8 2026) and recorded as such.
`toWire()` gives the AXPP call envelope `{protocol: axpp@1, kind: call, id, payload: {tool, arguments}}`; the phone
answers a `result` or `error` envelope with `correlationId` = the command id, and `fromWire()` turns it into:

### phone-result@1

```json
{ "$axf": "phone-result@1", "id": "<the command id>", "tool": "phone.recorder_status", "deviceId": "…", "at": "…",
  "ok": true, "data": { "running": true, "since": "…", "session": "Build review", "parts": 2, "queue": 0, "mic": false }, "state": { "recorder@1": { … } } }
{ "$axf": "phone-result@1", "id": "…", "tool": "phone.open_url", "deviceId": "…", "at": "…",
  "ok": false, "error": { "code": "offline", "message": "Pixel 8 is offline: last seen 12 min ago. Open the app or switch the watch on.", "retryable": true } }
```

**Dispatch** (`dispatchErrors(command, device, at)`), in this order, before anything reaches the phone: unknown tool →
`invalid`; device `revoked` → `revoked`; not `paired` → `unpaired`; the phone lacks the capability → `not_found` ("install
the current app"); a confirm tool with no `approvalId` → `confirmation_required`; the phone not online → `offline`.

### Wire error codes

INTEROP.md's codes (`invalid` · `denied` · `not_found` · `unavailable` · `validation` · `unexpected` · `timeout` ·
`confirmation_required`) plus four phone-connect@1 adds:

| Code | Meaning | Retryable |
| --- | --- | --- |
| `offline` | the phone is paired but has not polled within 45 s | yes |
| `unpaired` | no phone is paired (or this device is not) | no |
| `revoked` | the owner revoked this phone | no |
| `consent_required` | the phone needs its own yes first (Android's capture prompt on a recorder start) | yes |

Retryable also covers `unavailable` and `timeout`. Every error carries `message` in plain words and `retryable`.
Unknown codes read as `unexpected`. Codes never change meaning.

## API (everything comes with an API)

The console plugin, when it ships (next phase), exposes every tool above the same four ways: REST
`devices`, `pair`, `revoke`, `command`, `status` under the plugin's route prefix, MCP `phone-connect_*` (plugin commands), CLI
`axf phone-connect …`, voice ("open the console on my phone", "start recording <name>"). The hub keeps the device tools
(`phone.*`) for agents on axHub's MCP. Deep link: `console_open` target `phone-connect` (Settings → Plugins → Phone
Connect); its state is `GET /devices` (`phone-device@1` records with `presence`).

## Migration from AmberX

| Was | Is | How |
| --- | --- | --- |
| `amberx.open_url`, `amberx.recorder_start`, `amberx.recorder_stop`, `amberx.recorder_status` | `phone.open_url`, `phone.recorder_start`, `phone.recorder_stop`, `phone.recorder_status` | `ALIASES`: the old name resolves for one release; a command sent with it is answered normally plus `deprecated: "amberx.recorder_start is deprecated: use phone.recorder_start"`. After that release the old name answers `not_found`. |
| output-recorder plugin's data dir `.axf-console/plugins/output-recorder` | `.axf-console/plugins/phone-connect` | `migrate.mjs` (dry run by default, `--apply` to do it): copies, verifies, then leaves a pointer file in the old place. | <!-- axf-not-plugin:output-recorder -->
| axHub's `amberx` device record (the hello: deviceId, name, app, capabilities, state) | a `phone-device@1`, same id, `migratedFrom` set, still paired | `deviceFromAmberx()`; the script writes `devices.json` in the new data dir. |

Plugins that are retired with AmberX (voice commands, notes, dictation, web tabs, AI connection, agent manager, the
walkthrough video, the wake word listener) are a later step of this build and are not part of this contract.
