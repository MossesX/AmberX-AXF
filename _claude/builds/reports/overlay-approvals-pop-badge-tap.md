# overlay-approvals-pop-badge-tap

Brett, voice, Nov 23 2026: two 90 s veto holds, nothing popped on the console app's overlay, the badge stuck at 2,
a tap went to the console instead of approvals, then the phone dinged over and over.

Four bugs, four fixes. Branch `claude/overlay-approvals-pop-badge-tap`.

## 1. Approvals did not pop

**Root cause.** The overlay never looked at axHub. It showed whatever the console page last told it
(`overlayItems`), and the page only reads axHub's list while it is on screen
(`approvals-banner/web/index.tsx`: the 5 s poll ran only when `document.visibilityState === 'visible'`). With another
app in front the page is hidden, so the overlay heard nothing until a tap on "Console" put the page back on screen.
That is the "2" that appeared after the tap.

**Fix.** The app reads axHub's list itself: `ApprovalFeed` (`GET /auth/admin/approvals.json` with the WebView's hub
session, read-only), rules in `ApprovalFeedRules`. A new item expands the overlay onto the console's approval card for
that call (Approve / Deny, the countdown) at once, over whatever is on screen. Inside the app the page also keeps
reading while hidden, so the card is ready when the overlay opens. The `expand` setting still decides what may pop;
an item already shown or dismissed does not pop again.

## 2. The badge stayed at 2

**Root cause.** Same single source. The approvals page he opened is axHub's, loaded in the app's one WebView, so the
console page (the only thing feeding the overlay) was gone. Nothing told the overlay the two calls were decided, and
the overlay kept its last count.

**Fix.** No stored count. The badge, the label and the bar are derived from axHub's list on every reading: every 2 s
while something waits, and at once when the overlay folds or expands, the app or the screen comes back, the page
reports a change, or a countdown ends. Approved, denied, expired or run after its veto: the next reading drops it,
wherever it was decided. With axHub unreachable, a held call still leaves 5 s after its countdown ends.

## 3. A tap went to the console

**Root cause.** The toolbar's button always ran `toggle` (the console). The badge ran the `approvals` verb, which
asked the console page for `approvals.view` with no id, and that action only toasted "That one is no longer waiting".
So no tap ever reached an approvals page.

**Fix.** `OverlayRules.tapVerb`: with a pending count, a tap on the toolbar opens
`https://axhub.amberxai.com/auth/admin/approvals` in the expanded overlay. With nothing waiting it opens the console
as before, and if the approvals page was left showing it goes back to the console. The `approvals` verb opens the
same page from the API, MCP, the CLI and voice.

## 4. The ding storm

**Root cause.** Not approvals. The console server's log shows it: at 16:19:40 UTC a Systems check routine run added
five new checks, and at 16:20:18 the next alerts pass raised eight Systems check alerts as new in one second. Each
went to the phone as its own Phone Connect notification, one a second from 16:20:20 to 16:20:28, each with its own
sound. Eight dings in a row, right after the approvals test. The alert engine already never re-pushes a repeat; the
gap was that a burst of new ones went out one by one.

**Fix.** `apps/console-web/server/alerts.py`: the delivery worker gathers what is raised within 2 s and sends one
push per channel ("8 new console alerts", a line per alert, the worst one's severity). One alert alone still goes out
as itself. The bell keeps every alert. The overlay itself makes no sound: the push for a held call is axHub's own,
one per call.

## Tests

- `ApprovalFeedRulesTest` (new, 11): a held call pops its card with another app in front; the badge goes to 0 after
  a decision or an auto-run; without the hub a run-out countdown still clears; only real ids and hub links count.
- `OverlayTapTest` (new, 4): pending count → approvals page; nothing waiting → console; expanded → fold.
- `test_alerts.py`: a burst of eight is one push per channel, through the real worker too; one alert goes out as
  itself; the bell lists all eight.
- `approvals-banner/test.mts`, `nativeRules.test.mjs`: the page keeps reading in the app; `approvals.open` with an id.
- Run here: 75 JUnit tests green in a JDK container, both Node tests green, the alerts self-test green. The Android
  build itself runs in CI.

## What to know

- Items 1 and 2 were started by the build `overlay-approvals-pop-and-badge-clear` (same voice note, first half). It
  stopped before committing. Its work was picked up, reviewed, fixed (one failing test: an entry with a link off the
  hub was still counted as an approval) and finished here. That build should be closed, not re-run.
- Not tested on a phone. No device here; the rules are unit-tested and CI builds the APK. The new APK has to be
  installed for 1 to 3. Fix 4 is server-side and live with the next console deploy.
- The popped card is the console's own approval card in the expanded overlay, not a separate native card.
- Recorded in Plan Studio 2.0: "Console app overlay: approvals pop, badge clears, tap opens approvals, no ding storm".
