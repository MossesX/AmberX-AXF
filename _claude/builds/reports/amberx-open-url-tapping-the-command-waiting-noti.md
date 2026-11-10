# AmberX open_url: the "command waiting" notification opens the page, not the AmberX app

Build `amberx-open-url-tapping-the-command-waiting-noti`, Phase 1 (Opus), Nov 10 2026.

Brett (Nov 10 2026, 16:41): "It says a command is waiting for you. I clicked it. I'm in the AmberX app. Are you gonna fix that?"

## Cause

The console's wake (`console-commands/server/wake.py`) calls `amberx.open_url` through axHub. axHub held that call
for approval, so the phone showed axHub's card for the held call. The card's text comes from the call's reason ("A
console command (from a Claude session) is waiting and no console is open…"). Every held-call and approval card opened
`MainActivity` (the AmberX app), so the tap never reached the page. AmberX's own "Tap to open the Dev Console"
notification (posted after the call reaches the phone) already opened Chrome directly. The wrong tap was the hub card's.

## Fix (apps/amberx-droid)

- `OpenUrlRules.pageOf(tool, entry)`: an axHub card for `amberx.open_url` carries its page (`args.url`, `arguments.url`
  or the url in the summary), checked against the same own-sites rule (https on amberxai.com). Any other tool or URL
  gets null, and the card behaves as before.
- `HubRules.Veto.page` / `HubRules.Approval.page` are filled from it (a shelved card keeps it through `VetoAlerts`'s store).
- New `OpenPageActivity` (translucent, no history, not exported). Tapping such a card starts Chrome (or the default
  browser) on the page at once and approves the call: approve-now for a held call, approve for a pending approval. The
  call only opens that page, so the tap is Brett's yes. A notification tap may start an activity, so Android's
  background-start block doesn't apply.
- `VetoAlerts.card` and `WatchService` approvals: open_url cards tap into `OpenPageActivity`. Their text reads
  "A console command is waiting. Tap to open the Dev Console in Chrome." Deny stays on the held card.
- `AxppLink.openUrl`: when the approved call then reaches the phone, a page opened from a tap in the last 10 minutes is
  not opened again (`how: "tap"`; each wake URL carries its own command id). The answer now always says `how`
  (`started` | `notification` | `tap` | `none`).
- "Display over other apps", asked once: when a page had to wait for a tap because the permission is off, AmberX asks
  once the next time it is on screen. It uses the system dialog and opens Android's own settings page. The "Tap to open
  the Dev Console" notification also gets an "Open pages by themselves" action straight to that setting while it is off.
- hello state: `open-url@1: {overlay}`, so the hub (and every client reading device state) sees whether pages can come
  to the front by themselves.
- Console side (`wake.py`): a `how: "tap"` answer reads "Brett opened the console from AmberX's notification".

## API reach

- Open a page: `amberx.open_url` (axHub MCP tool, the console's `/api/console-commands` wake, voice via AmberX's
  hub tools), unchanged.
- State: the phone's hello state `open-url@1.overlay`, plus `overlay` / `how` on every open_url answer.
- The overlay setting itself is Android's own permission page. No API can grant it: Android allows only the user to.

## Tests

- JUnit (`OpenUrlRulesTest`, `HubRulesTest`): 18 tests green locally (JDK 17 container), new: `hubCardsForOpenUrlCarryTheirPage`,
  `aTappedPageIsNotOpenedTwice`, `openUrlCardsKnowTheirPage`. The Android classes (activity, notifications) compile in CI
  (`./gradlew :app:testDebugUnitTest :app:assembleDebug`): no Android SDK on the VPS.
- `console-commands` server tests: 83 checks green (new: a tap-opened answer).
- `check-theme`, `check-controls`: green.

## Not done

- Test on the paired phone: no adb or phone link from this VPS, and the phone runs the old APK. Brett: install the APK from
  this PR's CI run. Then on the next "command waiting" card, one tap should open the Dev Console in Chrome.
- No web UI changed, so nothing goes to UI Review. The only visible pieces are Android notifications and one system dialog.
