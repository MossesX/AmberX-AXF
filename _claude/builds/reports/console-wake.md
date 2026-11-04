# console-wake: console commands always reach a console

Build `console-wake` (Urgent), Brett, Nov 3 2026 (voice). Agent: **Ping Paulie**. `AXF_AGENT` launcher support isn't on main yet, so the run is recorded here and in the builds store note. Model: Opus.
Branches: AmberX-AXF `claude/console-wake`; axHub `claude/amberx-open-url` (PR MossesX/axHub#35).

## Problem

`console_open` / `console_action` / … failed with `not_found: no console is open for you right now` whenever no browser tab was connected at that moment. That covered three cases: an approval made inside the console (client `cc-cq7hakm3a02p` dropped 17:18:49 → 17:18:51 UTC), redeploys or a sleeping phone tab, and a closed browser.

## Cause of the drop while the console was open

The tab sent `bye` on every React effect cleanup and on every `pagehide`, including bfcache (`persisted`). On `bye` the server set `lastSeen = 0`, so it dropped the console straight away. Any command in the gap before the next `hello` failed. Separately, after a server restart a reconnecting stream had no catalog until the next 30 s heartbeat, so a command resolved against nothing.

I couldn't replay the 17:18 event itself (no client logs are kept), so the trigger for the cleanup during that approval isn't proven. The queue below covers it whatever the trigger was.

## What changed

| Part | Before | After |
|---|---|---|
| No console connected | `not_found` straight away | Queued per user (TTL 2 min by default, 30 s to 15 min). Delivered **once** to the first console that says hello. The call waits up to 60 s. |
| Stream reconnecting | Held 30 s; the answer said "sent, not answered" after 4 s | Held for the TTL. The call waits for the ack, and the answer says `after reconnect`. |
| Wrong name while closed | n/a | Checked against the last catalog that user's console sent (kept on disk), so it still answers 404 at once |
| Browser closed | Nothing could happen | After 3 s with no console: axHub `amberx.open_url` → AmberX opens `https://console.amberxai.com/?axf-cmd=<id>` in Chrome, or posts a full-screen notification where Android blocks background starts |
| Server restart | Commands resolved against an empty catalog | The stream sends `console-hello@1`; the tab re-announces |
| `bye` | On React cleanup + every pagehide | Only on a real pagehide (`!persisted`) |
| Dedupe | none | Server: a queued entry goes `delivering` under the lock, so it is sent once. Tab: remembers the last 50 command ids and re-acks a repeat without running it. |
| Answer | `delivered` | + `delivery.how`: `live` · `after reconnect` · `woke via AmberX` · `queued` (+ `queued: true`, `expiresAt`, `wake`) |
| Toast | `mcp: opened Terminal` | `Amber: opening Terminal` for a queued or woken command (the session's own name when it gives one) |
| Settings | on/off, toast | + Settings → Plugins → Console commands → **When no console is open**: wake through AmberX (on), how long a command waits, browser (Chrome / default). Kept on the console server; only the owner changes them. Lists waiting commands; the last-commands list now shows how each was delivered. |
| CLI | `sent:` / `✓` | `queued: …` and `(woke via AmberX)` / `(after reconnect)` |

### Contract
- `core/engines/console-commands.mjs`: the no-console failure now carries `noConsole: true`. This adds a field and changes no meaning. `ConsoleMessage.delivery?: 'queued' | 'woke'`. Re-baked into console-web, axhub-web, amberx-droid and molly.
- `framework/spec/CONTROL.md` → Console: describes the queue and wake.
- New REST: `GET /api/console/queue`, `GET|POST /api/console/settings`. The `console-commands@1` capability adds `queue()`.
- Kotlin twin: none. The engine change is server-facing only, and the Android framework is on hold.

### AmberX (Android exception)
- `OpenUrlRules.java` (pure): https only, `amberxai.com` and its subdomains, no user info, port 443 at most, 2000 characters max.
- `AxppLink`: `browser.open` command; announces capability `open-url@1`. It opens with Chrome when installed (manifest `<queries>`), else the default browser. It always posts a high-priority notification with a full-screen intent (channel "Console opened by Amber", times out after 2 min).
- **The new APK has to be installed on Brett's phone** for the wake path. Until then the hub answers "install the new AmberX APK" and the command stays queued for its TTL. Added to his checklist.

### axHub (PR #35)
- `amberx.open_url {url, browser?}`: the same allowlist checked on the hub (`ownUrl`), policy `allow`, pinned. An existing `amberx` service gets the policy once at startup; a policy the owner already set is kept.

## Tests

| Suite | Before | After |
|---|---|---|
| `plugins/console-commands/server/test_console_commands.py` | 35 checks | **66 checks**: reconnect delivery, queue + wake with a fake phone and deep link, exactly-once with two hellos, reconnect inside the wake delay (no wake), wake off, TTL clamp + expiry (never delivered late), per-user queues (a user never wakes the owner's phone), named console still 404, re-hello after a restart |
| `plugins/console-commands/test.mjs` | 6 tests | 6 tests, more asserts (`noConsole` flag, CLI queued / how) |
| AmberX `OpenUrlRulesTest` (JUnit) | n/a | 4 tests (CI compiles it; no JDK on the VPS) |
| axHub `amberx.test.ts` | 13 | 19 (policy, allowlist, hub refusal, old APK, phone round trip, migration). Locally 151/151 for amberx + connectors. The sqlite/CLI suites need Node 22 (CI). |
| `check-theme`, `check-controls`, console `tsc` | pass | pass |

## Known gaps
- The queue is in memory. A console redeploy while a command waits drops it, and the waiting call dies with the server anyway.
- Android 14+ limits full-screen intents to calling and alarm apps unless the user allows it. There it shows as a heads-up notification, and one tap opens the console.
- Only the owner audience wakes a phone. Hub users' commands queue but never wake anything.

## UI Review
Desktop + phone shots of Settings → Plugins → Console commands are waiting in UI Review (group `console-wake - Nov 3 12:45 PM`).
