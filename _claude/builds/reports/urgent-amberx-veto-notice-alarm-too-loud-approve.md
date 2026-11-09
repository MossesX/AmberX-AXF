# URGENT: AmberX veto notice alarm too loud + Approve must go straight through

Build `urgent-amberx-veto-notice-alarm-too-loud-approve` · Opus · branch `claude/urgent-amberx-veto-notice-alarm-too-loud-approve` · Nov 8 2026

## Brett said (verbatim)
> The approve and deny dialogue is still saying open, and I received the alarm, so it's still stopping.

## What was wrong

1. **The alarm.** The hub's push was already normal priority (axHub `ee5706f`). The alarm came from the console's
   approvals-banner plugin, which AmberX loads too: `ALARM_DEFAULTS` had the alarm **on**, tone *Phone alarm*, starting
   with **30 s left**, **2 rings**, **through silent mode** (Android alarm stream), pulse vibration. On top of that the
   Android notices (`VetoAlerts.java`) used **IMPORTANCE_HIGH** channels with vibration and the **alarm category**, and the
   30 s left / running phases re-posted the card, so it alerted again.
2. **"Opened on axHub: approve or deny it there."** The console's relay probe only lent the relay when it answered yes,
   so the pop-up fell back to the *open* route; the console log shows probes but **no tap ever reached `/decide`**. On
   the phone, `decideFromPhone` called the native `approvalDecide` (added Nov 7); an APK older than that throws, and the
   code then opened the hub view and returned `opened`, which the pop-up shows as "Opened on axHub". The fix for the
   console (`approve-button-fix`) never landed (branch 247 commits behind main).

## What changed

**Notices and alarm** (`apps/console-web/plugins/approvals-banner/web/alarm.ts`, `veto.tsx`, `index.tsx`)
- Alarm **off by default**, under a **new key** `approvals-banner.alarm.on` (an old saved `alarm.enabled: true` no longer
  rings). When switched on: the notification tone, 1 ring of 5 s, no vibration, not through silent mode.
- New switches, Settings → Plugins → Approvals banner → *Veto notices and alarm*: **Notice sound** (on),
  **Notice vibration** (off), **Alert again at 30 s left and when it runs** (off), **Alarm** (off).
- They go to the phone with the alarm config (`noticeSound`, `noticeVibrate`, `noticeRepeat`).
- Browser notices: the 30 s / running updates are silent unless Repeat is on.
- API + voice: console action `approvals.notice:<sound|vibrate|repeat|alarm>:<on|off>`. Whether notices show at all
  stays Brett's own click (notify-control guards veto notices).

**AmberX Android** (`VetoAlerts.java`, `VetoAlarm.java`)
- One card per hold on **default-importance** channels `veto3_notice_s{0,1}v{0,1}` (sound / vibration as set),
  `CATEGORY_REMINDER`, `PRIORITY_DEFAULT`, `setOnlyAlertOnce`; later phases update silently unless Repeat is on.
  The old `veto2_*` high-importance channels are deleted.
- The native alarm rings only when the current plugin config says on (a config saved by an older plugin never rings).
- Needs the next APK; until then the web config already turns the native alarm off (`enabled: false`).

**Approve / Deny straight through**
- Console: `approve-button-fix` ported onto current main (relay always lent with the server's exact reason in place;
  owner sign-in fallback `AXF_HUB_RELAY_USER` / `AXF_HUB_RELAY_PASSWORD`; the pop-up closes on success).
- AmberX: new server routes `GET /api/approvals/relay`, `POST /api/approvals/decide` decide with the page's own
  `axhub_session` cookie (the hub sets it for `.amberxai.com`, so the AmberX web view always has it behind the wall).
  Shared logic: `framework/python/axf_server/approvals_relay.py`. Only a wall-session hub admin, same origin, JSON; a
  token is refused. `decideFromPhone` uses native first, then this route, and **never** just opens axHub.
  AmberX in a browser lends the same path as its veto host.

## Tests
- `approvals-banner/test.mts`: 17 → 18 checks (new: no alarm by default, new key, notice defaults, phone config).
- `approvals-banner/test.py`: 57 checks (relay incl. owner sign-in).
- `apps/amberx-droid/server/test_server.py`: 172 passed (new: 15 relay checks: approve held, approve waiting, hub
  refusal, no Origin, hub user, bad id/action, machine token, no session, stale session).
- `apps/amberx-droid/test.mjs`: 2316 → 2321 (Java: no high importance / alarm category, silent updates, old channels
  deleted, alarm off unless switched on; deny.ts never opens the hub).
- `framework/python/axf_server/test.py` 397 ok; console + AmberX typecheck clean; check-theme, check-controls,
  check-toolbars, plugin-lifecycle green.

## Known gaps / what Brett may need
- The console's owner sign-in fallback is only used when the browser's hub cookie doesn't arrive; it isn't set
  (`AXF_HUB_RELAY_USER` / `AXF_HUB_RELAY_PASSWORD` missing). With the hub's cookie domain `.amberxai.com`, a signed-in
  browser carries the cookie, so it should not be needed; if a tap still comes back with "no owner sign-in", the
  systems check item *Approvals relay* says what to set.
- The Android channel change needs a new AmberX APK (CI builds it); the alarm is already off through the web config.
- UI: only generated settings rows changed (no new screen); no UI Review options submitted.
- Plan Studio plan: `veto-notices-one-quiet-notice-per-hold-approve-g-74bz` (parked).
