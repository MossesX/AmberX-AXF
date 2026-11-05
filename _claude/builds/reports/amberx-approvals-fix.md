# amberx-approvals-fix — report (Nov 5 2026)

## Brett said (verbatim, Nov 4 2026, voice)
> "Why isn't AmberX launching approvals on my phone? It used to always pop up approvals." ... "Nope, only when I open AmberX, and it says 'web page not available' in the approval waiting dialog." ... (Queue a fix?) "Yep."

## Root causes (from the live system)
**1. "Web page not available": two frame lists, each missing someone. Confirmed.**
The dialog (`approvals.review`, approvals-banner, loaded in AmberX) framed `/auth/admin/approvals/<id>`. That answers 302 to
`/#/approvals/<id>`, which is served by the axhub-web container, not the hub. Live headers:
- hub `/auth/admin/approvals/<id>`: `frame-ancestors https://console… https://amberx… https://patches…` (no Molly)
- axhub-web nginx `/`: `frame-ancestors 'self' https://console… https://molly…` (no AmberX)
So AmberX passed the first hop and died on the second: the WebView draws "Web page not available". Molly died on the first
hop (the sad face). A refused frame still fires `load`, so the dialog's 8 s fallback never ran.

**2. No alert with the app closed: the watch doesn't survive. Mechanism inferred; not seen on the phone.**
- AmberX has no FCM. The only road to the phone is `WatchService` reading the feed. ntfy goes to the ntfy app, not AmberX.
- Evidence: the hub restarted Nov 4 14:17 UTC, and AmberX's AXPP link (started with the watch) sent no `hello` until
  Nov 5 01:27:24, when Brett opened the app. 11 hours with no sign of the phone's watch.
- Weak points in the code: a `Handler` timer stops while the CPU sleeps (the mic used to keep it awake, Mic off doesn't);
  a sticky restart that Android refuses a foreground start ended in `stopSelf()` with nothing to bring it back; AmberX never
  asked for the battery exemption, so Samsung can put it to sleep.
- Not proven: which of these killed it on Brett's phone. The console can't read the phone's Android state.

**3. ntfy 429:** 236 refusals in 13 h, every held call. ntfy.sh's quota is gone. Unrelated to AmberX (it doesn't subscribe), but
any ntfy client on the phone got nothing.

**4. 'No such app file':** `/apps/download/amberx-droid/latest` never existed. The route only took real file names, so
`latest` always answered that. Catalog and files agree (b1312, 42.7 MB).

## Fix
axHub PR #38: approval pages framable by console + Molly (only those pages); `/apps/download/<project>/latest`; 30 min cooldown on 429.
AXF:
- `ReviewDialog` is native, from the feed: title, description, exact call folded, countdown, Deny / Approve first, Open in axHub. No iframe.
- nginx allows AmberX.
- `WatchAlarm` (new): exact alarm about once a minute under a short wake lock; brings the service back, or reads the feed itself (`WatchService.poll`) and alerts anyway.
- Battery exemption asked at most weekly. Approve / Deny on approval notifications; tap opens the native dialog.
- `HubWebActivity`: a failed page shows a card (Try again, Open in axHub), never the WebView error.
- Monitoring settings + Monitor page: *Phone gets approvals* (Android switches with Fix buttons) and **Send test approval** (a real held `vps.run` of `date`).
- Systems check row `phone-approvals`, Auto fix = send a test approval (ask first).

## Tests
- AmberX `test.mjs` 2214 → 2223; server 159; systems-check 228 → 233; check-theme, check-controls, check-toolbars pass; console + AmberX tsc clean.
- axHub vitest `packages/server`: 188 pass, 1 fail (`passes.test.ts`), 2 files can't load `node:sqlite` on this Node 20. Not compared against main; CI decides.
- Java (`WatchAlarm`, `HubRulesTest`) is **not compiled here**: no Android SDK. CI is the compiler.
- Round trip of approve / deny and push on a real phone: **not run**. Needs the new APK.

## Gaps
- Not a true push: latency is up to about a minute with the screen off, inside the 90 s veto. Real instant push needs FCM (a Firebase project, Brett's hands).
- A force-stopped app stays dead until opened (Android clears its alarms).
- `AXHUB_EMBED_FRAME_ANCESTORS` still names the retired Patches origin in the live env.
- Patches is still in the app catalog.
- During diagnosis the ntfy topic (which works like a password) was printed into this session's log. Rotate it.

## Shots
`amberx-approvals-fix/shots/` (mock feed): `approval-dialog-*`, `held-call-*`.
